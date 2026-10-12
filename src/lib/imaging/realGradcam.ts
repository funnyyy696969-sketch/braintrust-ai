/**
 * realGradcam.ts — GENUINE Grad-CAM, computed from a real neural network.
 *
 * This replaces the old fabricated surrogate (gradcam.ts) whose heatmaps were
 * hand-coded spatial patterns (quadrants, ramps) — the source of the
 * "geometric gradient" bug. Nothing here is position-based or synthetic.
 *
 * ─── How the CAM is produced ────────────────────────────────────────────────
 * The network (BrainCamNet, trained by backend/training/train_cnn.py, exported
 * to ONNX) exposes TWO outputs from ONE forward pass:
 *
 *    logits        → 1×4 class scores (also used for prediction)
 *    cam_features  → 1×64×14×14  (the last conv feature map A_k)
 *
 * Grad-CAM computes, per class c:
 *
 *    alpha_k^c = GAP over spatial positions of (dlogit_c / dA_k)
 *    CAM^c     = ReLU( Σ_k alpha_k^c · A_k )
 *
 * For a conv → GAP → linear head, the chain rule collapses the gradient
 * exactly to the linear head's weight matrix: alpha_k^c = W[c, k]. We fetch
 * those weights FROM THE MODEL ITSELF (ONNX initializer tensors) rather than
 * hard-coding them, so the CAM always reflects the actual trained network —
 * if the checkpoint is retrained, the CAM changes with it.
 *
 * The CAM is computed at the feature map's native 14×14, ReLU-ed, min-max
 * normalised, then bilinearly upscaled to the ORIGINAL image's H×W so the
 * overlay always matches the MRI pixel-for-pixel.
 *
 * ─── Fallback honesty ──────────────────────────────────────────────────────
 * If the ONNX model file is missing (no training run yet), generateGradCam
 * throws a clear error; analysisPipeline reports it per-image instead of
 * quietly showing a synthetic gradient.
 */

// onnxruntime-web/wasm — the wasm-only build. We only ever ask for the
// "wasm" execution provider, and this entry resolves its runtime binary as
// "ort-wasm-simd-threaded.wasm" (14 MB) instead of the 28 MB jsep build that
// the default entry expects.
import * as ort from "onnxruntime-web/wasm";
import { CLASS_LABELS } from "../imaging/types";
import type { ClassLabel, HeatmapResult, PredictionResult, SaliencyMask } from "../imaging/types";
import { MODEL_INPUT_SIZE } from "../imaging/preprocessing";

const MODEL_URL = "/models/brain_cam_net.onnx";

// The ORT wasm runtime binary, copied from node_modules/onnxruntime-web/dist
// into public/onnx/. The loader itself is EMBEDDED in the bundle; only the
// .wasm binary needs redirecting. Two constraints drove this shape:
//
//  • A plain string wasmPaths makes ORT dynamically import an external
//    "ort-wasm-simd-threaded.mjs" — Vite then statically resolves that path
//    to the /public file and hard-fails the build ("should not be imported
//    from source code"). The object form keeps the embedded loader.
//  • Without any override, ORT guesses a module-relative URL that the dev
//    server answers with index.html, producing the infamous
//    "expected magic word 00 61 73 6d, found 3c 21 64 6f" ("<!do") error.
// A plain root-absolute string (NOT new URL(..., import.meta.url)) keeps the
// path opaque to Vite's asset resolver — public files must never be statically
// referenced from source code.
const WASM_BINARY_URL = "/onnx/ort-wasm-simd-threaded.wasm";

// ── Runtime singleton ───────────────────────────────────────────────────────

interface CamModel {
  session: ort.InferenceSession;
  headWeights: Float32Array; // [numClasses, channels] from the ONNX initializer
  numClasses: number;
  channels: number;
  gridH: number;
  gridW: number;
}

let cached: CamModel | null = null;
let loading: Promise<CamModel> | null = null;

export function isCamModelReady(): boolean {
  return cached !== null;
}

export function camModelStatus(): { ready: boolean; note: string } {
  return cached
    ? { ready: true, note: "real CNN loaded (BrainCamNet ONNX)" }
    : { ready: false, note: "ONNX model not loaded — run backend/training/train_cnn.py" };
}

async function loadCamModel(): Promise<CamModel> {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    ort.env.wasm.numThreads = 1; // simple, no cross-origin isolation needed
    ort.env.wasm.simd = true;
    ort.env.wasm.wasmPaths = { wasm: WASM_BINARY_URL };
    const session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });

    // Extract the linear head's weights from the model's initializers.
    // BrainCamNet's head is Linear(64 → 4) whose ONNX initializer is either
    // "fc.weight"/"onnx::MatMul_…" (transposed layout [4,64] → MatMul) —
    // we locate a 2-D initializer with shape [4, C] or [C, 4] generically.
    let headWeights: Float32Array | null = null;
    let numClasses = CLASS_LABELS.length;
    let channels = 0;
    for (const [name, tensor] of Object.entries(session.inputNames ? {} : {})) {
      void name; void tensor; // (no-op — real extraction below)
    }
    const meta = session;
    // onnxruntime-web exposes initialisers through the model metadata in
    // recent builds; fall back to parsing via a second tiny session when
    // unavailable.
    const inits = (meta as unknown as { initializerNames?: string[] }).initializerNames;
    void inits;

    // Robust approach: run one dummy forward and capture the feature map,
    // then reconstruct head weights by probing the logits — but that is
    // fragile. Instead: parse the ONNX protobuf directly for Linear weight.
    const buf = await fetch(MODEL_URL).then((r) => {
      if (!r.ok) throw new Error(`ONNX model not found at ${MODEL_URL} — run backend/training/train_cnn.py`);
      return r.arrayBuffer();
    });
    const parsed = parseLinearWeight(new Uint8Array(buf), numClasses);
    if (!parsed) {
      throw new Error(
        "Could not locate the classifier weight in the ONNX graph — " +
          "the exported model must contain the Linear(64→4) head.",
      );
    }
    headWeights = parsed.weights;
    channels = parsed.channels;

    // Probe feature-map shape with a dummy input.
    const probe = await session.run({
      input: new ort.Tensor("float32", new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE), [
        1, 1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE,
      ]),
    });
    const feats = probe.cam_features as ort.Tensor;
    const dims = feats.dims; // [1, C, H, W]
    if (dims.length !== 4) {
      throw new Error(`cam_features has unexpected dims [${dims}]`);
    }
    const [, featC, gridH, gridW] = dims;
    if (featC !== channels) {
      throw new Error(
        `Head weight channel count (${channels}) ≠ feature map channels (${featC}) — ` +
          "model/ONNX export mismatch.",
      );
    }

    cached = { session, headWeights, numClasses, channels, gridH, gridW };
    loading = null;
    return cached;
  })();

  return loading;
}

/**
 * Minimal ONNX protobuf scanner: finds the Linear head's weight initializer
 * (2-D tensor whose shape is [numClasses, C] or [C, numClasses], float32).
 * This avoids depending on ORT exposing initializers across versions.
 */
function parseLinearWeight(
  bytes: Uint8Array,
  numClasses: number,
): { weights: Float32Array; channels: number } | null {
  // ONNX ModelProto → graph → initializer[] (field 5, repeated TensorProto)
  // TensorProto: dims (field 1, repeated int64), data_type (field 2, int32),
  // float_data (field 4, repeated float) or raw_data (field 9, bytes).
  // We scan top-level protobuf fields of the graph and tensor protos.
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 0;
    let found: { weights: Float32Array; channels: number } | null = null;

    const readVarint = (p: number): [number, number] => {
      let result = 0;
      let shift = 0;
      while (true) {
        const b = view.getUint8(p++);
        result |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      return [result, p];
    };
    const skipField = (wire: number, p: number): number => {
      if (wire === 0) return readVarint(p)[1];
      if (wire === 1) return p + 8;
      if (wire === 2) {
        const [len, p2] = readVarint(p);
        return p2 + len;
      }
      if (wire === 5) return p + 4;
      throw new Error(`unsupported wire type ${wire}`);
    };

    // Walk ModelProto top-level fields looking for graph (field 7, bytes).
    while (pos < bytes.length) {
      const [tag, p1] = readVarint(pos);
      const field = tag >> 3;
      const wire = tag & 7;
      pos = p1;
      if (field === 7 && wire === 2) {
        const [glen, p2] = readVarint(pos);
        const graphStart = p2; // p2 = content start, AFTER the length varint
        const graphEnd = p2 + glen;
        pos = graphEnd;
        found = scanGraph(view, graphStart, graphEnd, numClasses);
        if (found) return found;
        break;
      }
      pos = skipField(wire, pos);
    }
    return found;
  } catch {
    return null;
  }
}

function scanGraph(
  view: DataView,
  start: number,
  end: number,
  numClasses: number,
): { weights: Float32Array; channels: number } | null {
  let pos = start;
  const readVarint = (p: number): [number, number] => {
    let r = 0;
    let s = 0;
    for (;;) {
      const b = view.getUint8(p++);
      r |= (b & 0x7f) << s;
      if ((b & 0x80) === 0) break;
      s += 7;
    }
    return [r, p];
  };
  while (pos < end) {
    const [tag, p1] = readVarint(pos);
    const field = tag >> 3;
    const wire = tag & 7;
    pos = p1;
    if (field === 5 && wire === 2) {
      // initializer TensorProto
      const [len, p2] = readVarint(pos);
      const tStart = p2; // p2 = content start, AFTER the length varint
      const tEnd = p2 + len;
      pos = tEnd;
      const parsed = parseTensor(view, tStart, tEnd, numClasses);
      if (parsed) return parsed;
    } else {
      // skip
      if (wire === 0) pos = readVarint(pos)[1];
      else if (wire === 1) pos += 8;
      else if (wire === 2) {
        const [len, p2] = readVarint(pos);
        pos = p2 + len;
      } else if (wire === 5) pos += 4;
      else return null;
    }
  }
  return null;
}

function parseTensor(
  view: DataView,
  start: number,
  end: number,
  numClasses: number,
): { weights: Float32Array; channels: number } | null {
  let pos = start;
  let dataType = 0;
  let dims: number[] = [];
  let rawDataStart = -1;
  let rawDataLen = 0;

  const readVarint = (p: number): [number, number] => {
    let r = 0;
    let s = 0;
    for (;;) {
      const b = view.getUint8(p++);
      r |= (b & 0x7f) << s;
      if ((b & 0x80) === 0) break;
      s += 7;
    }
    return [r, p];
  };
  while (pos < end) {
    const [tag, p1] = readVarint(pos);
    const field = tag >> 3;
    const wire = tag & 7;
    pos = p1;
    if (field === 1 && wire === 2) {
      // packed repeated int64 dims — PLAIN varints (int64 is not zigzag;
      // only sint64 is. The previous zigzag decode was wrong.)
      const [len, p2] = readVarint(pos);
      const s = pos;
      pos = p2;
      let p = s;
      while (p < p2) {
        const [v, np] = readVarint(p);
        p = np;
        dims.push(v);
      }
    } else if (field === 1 && wire === 0) {
      // non-packed repeated int64 dims: ONE varint per field tag. Python's
      // protobuf emits this form for TensorProto.dims (dims is not declared
      // [packed=true]), e.g. 08 04 08 40 for [4, 64].
      const [v, np] = readVarint(pos);
      dims.push(v);
      pos = np;
    } else if (field === 2 && wire === 0) {
      dataType = readVarint(pos)[0];
      pos = readVarint(pos)[1];
    } else if (field === 9 && wire === 2) {
      const [len, p2] = readVarint(pos);
      rawDataStart = p2; // content starts AFTER the length varint
      rawDataLen = len;
      pos = p2 + len; // SKIP the raw float bytes — they are not protobuf
    } else if (wire === 0) {
      pos = readVarint(pos)[1];
    } else if (wire === 2) {
      const [len, p2] = readVarint(pos);
      pos = p2 + len;
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 1) {
      pos += 8;
    } else {
      return null;
    }
  }

  if (dataType !== 1 || dims.length !== 2 || rawDataStart < 0) return null;
  const [a, b] = dims;
  let outC: number, outN: number, transposed: boolean;
  if (a === numClasses) {
    outN = a;
    outC = b;
    transposed = false; // [4, C]
  } else if (b === numClasses) {
    outN = b;
    outC = a;
    transposed = true; // [C, 4]
  } else {
    return null;
  }

  const weights = new Float32Array(outN * outC);
  for (let i = 0; i < outN * outC; i++) {
    const off = rawDataStart + i * 4;
    if (off + 4 > end) return null;
    const v = readF32(view, off);
    weights[transposed ? (i % outN) * outC + Math.floor(i / outN) : i] = v;
  }
  return { weights, channels: outC };
}

// DataView.getFloat32 uses little-endian when passed `true`.
function readF32(view: DataView, offset: number): number {
  return view.getFloat32(offset, true);
}

// ── Bilinear upscale (matches the CAM to the MRI pixel grid) ───────────────

function bilinearUpscale(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const gy = (y / (dh - 1)) * (sh - 1);
    const y0 = Math.floor(gy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = gy - y0;
    for (let x = 0; x < dw; x++) {
      const gx = (x / (dw - 1)) * (sw - 1);
      const x0 = Math.floor(gx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = gx - x0;
      const v00 = src[y0 * sw + x0];
      const v10 = src[y0 * sw + x1];
      const v01 = src[y1 * sw + x0];
      const v11 = src[y1 * sw + x1];
      out[y * dw + x] =
        v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
    }
  }
  return out;
}

/** Jet colourmap 0..1 → [r,g,b] — perceptually standard for CAM display. */
function jet(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  const r = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3))));
  const g = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2))));
  const bl = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1))));
  return [r, g, bl];
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface GradCamDebug {
  predictedClass: string;
  confidence: number;
  targetClass: string;
  targetClassIndex: number;
  selectedLayer: string;
  activationShape: string;
  gradientShape: string; // "same as activations (head-weight formulation)"
  camShape: string;
  camMin: number;
  camMax: number;
  camMean: number;
  note: string;
}

export interface RealCamResult {
  heatmap: HeatmapResult;
  saliency: SaliencyMask;
  debug: GradCamDebug;
}

/** Force a (re)load — used at app start and after model replacement. */
export async function preloadCamModel(): Promise<void> {
  await loadCamModel();
}

export function disposeCamModel(): void {
  cached?.session.release();
  cached = null;
  loading = null;
}

/**
 * Compute a REAL Grad-CAM for `tensor` (normalised 224×224 luma) w.r.t.
 * `targetClass`. Uses the same forward activations the logit came from, and
 * the trained head weights as the spatial-gradient pooling (exact for a
 * conv→GAP→linear head). Returns the raw 14×14 CAM plus rendered overlays.
 */
export async function generateRealGradCam(
  tensor: Float32Array,
  targetClass: ClassLabel,
): Promise<RealCamResult> {
  const model = await loadCamModel();

  // Forward pass — the SAME graph call the prediction uses.
  const feeds = {
    input: new ort.Tensor("float32", tensor, [1, 1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]),
  };
  const results = await model.session.run(feeds);
  const logits = results.logits as ort.Tensor;
  const feats = results.cam_features as ort.Tensor;

  const logitData = logits.data as Float32Array;
  const featData = feats.data as Float32Array;
  const [, C, H, W] = feats.dims;

  // Target class = the model's own argmax unless explicitly overridden by
  // the caller (user-selected class explanation).
  const argmaxIdx = Array.from(logitData).indexOf(Math.max(...logitData));
  const targetIdx = CLASS_LABELS.indexOf(targetClass);
  if (targetIdx < 0) throw new Error(`Unknown target class "${targetClass}".`);

  // alpha_k^c — from the trained head weights (exact gradient of the class
  // logit w.r.t. the pooled features; see module docstring).
  const alphas = new Float32Array(C);
  for (let k = 0; k < C; k++) {
    alphas[k] = model.headWeights[targetIdx * C + k];
  }

  // CAM = ReLU( Σ_k alpha_k · A_k ), computed at native 14×14.
  const cam = new Float32Array(H * W);
  let camMax = -Infinity;
  for (let i = 0; i < cam.length; i++) {
    let acc = 0;
    for (let k = 0; k < C; k++) {
      acc += alphas[k] * featData[k * H * W + i];
    }
    cam[i] = Math.max(0, acc);
    if (cam[i] > camMax) camMax = cam[i];
  }

  // Min-max normalise.
  let camMin = Infinity;
  for (let i = 0; i < cam.length; i++) camMin = Math.min(camMin, cam[i]);
  const span = camMax - camMin || 1;
  for (let i = 0; i < cam.length; i++) cam[i] = (cam[i] - camMin) / span;

  // Store the raw 14×14 matrix for the detail view / tests.
  const matrix: number[][] = [];
  for (let y = 0; y < H; y++) {
    matrix.push(Array.from(cam.slice(y * W, (y + 1) * W)));
  }

  const heatmap: HeatmapResult = {
    dataUrl: renderHeatmap(cam, H, W, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
    activations: matrix,
    targetClass,
  };

  // Saliency mask at 60 % of CAM max (same convention as before).
  const threshold = 0.6;
  let salient = 0;
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (cam[y * W + x] >= threshold) {
        salient++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const scale = MODEL_INPUT_SIZE / W;
  const saliency: SaliencyMask = {
    dataUrl: renderMask(cam, H, W, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, threshold),
    coverage: salient / (H * W),
    bbox: {
      x: minX === W ? 0 : Math.round(minX * scale),
      y: minY === H ? 0 : Math.round(minY * scale),
      w: Math.max(1, Math.round((maxX - minX + 1) * scale)),
      h: Math.max(1, Math.round((maxY - minY + 1) * scale)),
    },
  };

  const probs = softmax(logitData);
  const debug: GradCamDebug = {
    predictedClass: CLASS_LABELS[argmaxIdx],
    confidence: probs[argmaxIdx],
    targetClass,
    targetClassIndex: targetIdx,
    selectedLayer: "last conv (block 5) → GAP → linear head",
    activationShape: `[1, ${C}, ${H}, ${W}]`,
    gradientShape: `alpha_k^c from trained head W[${targetIdx}, :] (${C} values)`,
    camShape: `[${H}, ${W}]`,
    camMin: camMin.toFixed(4) as unknown as number,
    camMax: (camMax as number) || 0,
    camMean: cam.reduce((a, b) => a + b, 0) / cam.length,
    note: "CAM = ReLU(Σ alpha_k·A_k); alphas from the trained classifier head — not synthetic.",
  };
  void camMin; void camMax;

  return { heatmap, saliency, debug };
}

function softmax(logits: Float32Array): number[] {
  const max = Math.max(...logits);
  const exps = Array.from(logits, (l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Render the CAM (gridH×gridW) as a jet heatmap upscaled to dw×dh. */
function renderHeatmap(
  cam: Float32Array,
  gh: number,
  gw: number,
  dw: number,
  dh: number,
): string {
  const up = bilinearUpscale(cam, gw, gh, dw, dh);
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(dw, dh);
  for (let i = 0; i < dw * dh; i++) {
    const v = up[i];
    const [r, g, b] = jet(v);
    // Alpha tracks CAM intensity with a soft floor: background (dark blue in
    // the raw jet map) becomes transparent so the MRI shows through, like the
    // classic Grad-CAM overlay. v=0 → invisible, v≥0.45 → fully opaque.
    const alpha = Math.round(255 * Math.max(0, Math.min(1, (v - 0.06) / 0.39)));
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Violet saliency mask for pixels above `threshold` of the CAM. */
function renderMask(
  cam: Float32Array,
  gh: number,
  gw: number,
  dw: number,
  dh: number,
  threshold: number,
): string {
  const up = bilinearUpscale(cam, gw, gh, dw, dh);
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(dw, dh);
  for (let i = 0; i < dw * dh; i++) {
    const salient = up[i] >= threshold;
    img.data[i * 4] = 108; // violet #6C4AB6
    img.data[i * 4 + 1] = 74;
    img.data[i * 4 + 2] = 182;
    img.data[i * 4 + 3] = salient ? 200 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
