/**
 * verify_head_parser.ts — clean standalone replica of the FIXED browser
 * protobuf parser (realGradcam.ts): verifies it finds m.21.weight [4,64] in
 * the real served ONNX and that the extracted floats match python ground
 * truth bit-for-bit. One-shot; exits 0 on success.
 */

const bytes = new Uint8Array(
  await Bun.file("public/models/brain_cam_net.onnx").arrayBuffer(),
);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function readVarintAt(p: number): [number, number] {
  let r = 0, s = 0;
  for (;;) {
    const b = view.getUint8(p++);
    r |= (b & 0x7f) << s;
    if ((b & 0x80) === 0) break;
    s += 7;
  }
  return [r, p];
}

function parseLinearWeight(numClasses: number) {
  let pos = 0;
  const skipField = (wire: number, p: number): number => {
    if (wire === 0) return readVarintAt(p)[1];
    if (wire === 1) return p + 8;
    if (wire === 2) {
      const [len, p2] = readVarintAt(p);
      return p2 + len;
    }
    if (wire === 5) return p + 4;
    throw new Error(`unsupported wire type ${wire}`);
  };
  while (pos < bytes.length) {
    const [tag, p1] = readVarintAt(pos);
    const field = tag >> 3, wire = tag & 7;
    pos = p1;
    if (field === 7 && wire === 2) {
      const [glen, p2] = readVarintAt(pos);
      const found = scanGraph(p2, p2 + glen, numClasses); // p2 = content start
      if (found) return found;
      break;
    }
    pos = skipField(wire, pos);
  }
  return null;
}

function scanGraph(start: number, end: number, numClasses: number) {
  let pos = start;
  let scanned = 0;
  while (pos < end) {
    const [tag, p1] = readVarintAt(pos);
    const field = tag >> 3, wire = tag & 7;
    pos = p1;
    if (field === 5 && wire === 2) {
      const [len, p2] = readVarintAt(pos);
      const tStart = p2, tEnd = p2 + len; // p2 = content start
      pos = tEnd;
      scanned++;
      const parsed = parseTensor(tStart, tEnd, numClasses);
      if (parsed) return parsed;
    } else if (wire === 0) pos = readVarintAt(pos)[1];
    else if (wire === 1) pos += 8;
    else if (wire === 2) {
      const [len, p2] = readVarintAt(pos);
      pos = p2 + len;
    } else if (wire === 5) pos += 4;
    else return null;
  }
  return null;
}

function parseTensor(start: number, end: number, numClasses: number) {
  let pos = start;
  let dataType = 0;
  let dims: number[] = [];
  let rawDataStart = -1;
  let rawDataLen = 0;
  while (pos < end) {
    const [tag, p1] = readVarintAt(pos);
    const field = tag >> 3, wire = tag & 7;
    pos = p1;
    if (field === 1 && wire === 2) {
      // packed dims (plain varints — int64 is NOT zigzag)
      const [len, p2] = readVarintAt(pos);
      let p = pos;
      pos = p2;
      while (p < p2) {
        const [v, np] = readVarintAt(p);
        p = np;
        dims.push(v);
      }
    } else if (field === 1 && wire === 0) {
      // non-packed dims: one varint per tag (python-protobuf form)
      const [v, np] = readVarintAt(pos);
      dims.push(v);
      pos = np;
    } else if (field === 2 && wire === 0) {
      dataType = readVarintAt(pos)[0];
      pos = readVarintAt(pos)[1];
    } else if (field === 9 && wire === 2) {
      const [len, p2] = readVarintAt(pos);
      rawDataStart = p2; // p2 = content start, AFTER the length varint
      rawDataLen = len;
      pos = p2 + len; // SKIP the raw float bytes — they are not protobuf
    } else if (wire === 0) pos = readVarintAt(pos)[1];
    else if (wire === 2) {
      const [len, p2] = readVarintAt(pos);
      pos = p2 + len;
    } else if (wire === 5) pos += 4;
    else if (wire === 1) pos += 8;
    else return null;
  }
  if (dataType !== 1 || dims.length !== 2 || rawDataStart < 0) return null;
  const [a, b] = dims;
  let transposed: boolean;
  if (a === numClasses) transposed = false;
  else if (b === numClasses) transposed = true;
  else return null;
  const floats = new Float32Array(rawDataLen / 4);
  for (let i = 0; i < floats.length; i++) {
    floats[i] = view.getFloat32(rawDataStart + i * 4, true);
  }
  return { weights: floats, channels: transposed ? a : b, transposed, dims };
}

const result = parseLinearWeight(4);
if (!result) {
  console.log("FAIL: head weight not found");
  process.exit(1);
}
console.log(
  "FOUND head weight | dims:", result.dims.join("x"),
  "| channels:", result.channels,
  "| floats:", result.weights.length,
);

// Ground truth (python onnx, m.21.weight, row-major [4,64]):
const truth00 = 0.12992662;
const truth03 = -0.17019206;
const truth30 = -0.09895292;
const got = (r: number, c: number) => result.weights[r * 64 + c];
console.log("w[0][0]:", got(0, 0).toFixed(8), "(expect", truth00 + ")");
console.log("w[0][3]:", got(0, 3).toFixed(8), "(expect", truth03 + ")");
console.log("w[3][0]:", got(3, 0).toFixed(8), "(expect", truth30 + ")");
const ok =
  Math.abs(got(0, 0) - truth00) < 1e-6 &&
  Math.abs(got(0, 3) - truth03) < 1e-6 &&
  Math.abs(got(3, 0) - truth30) < 1e-6;
console.log(ok ? "PARSER VERIFIED — matches python ground truth" : "PARSER MISMATCH");
process.exit(ok ? 0 : 1);
