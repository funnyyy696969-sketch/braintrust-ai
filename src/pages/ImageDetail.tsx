import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Eye,
  Layers,
  Thermometer,
  AlertTriangle,
  Info,
  Download,
  ShieldCheck,
} from "lucide-react";
import type { ExtractedImage, ImageAnalysis } from "@/lib/imaging/types";
import { validateAnalysisBinding } from "@/lib/imaging/analysisPipeline";
import { getImage, getAnalysis, getSession } from "@/lib/imaging/sessionStore";

/** Panel/grid description from an image's extraction source. */
function panelInfo(source: ExtractedImage["source"]): {
  panelNumber: number | null;
  gridPosition: string | null;
} {
  switch (source.type) {
    case "composite-panel":
      return {
        panelNumber: source.panelIndex + 1,
        gridPosition: `row ${source.row + 1}, column ${source.col + 1}`,
      };
    case "tiff-page":
      return { panelNumber: source.page + 1, gridPosition: `TIFF page ${source.page + 1}` };
    case "dicom-frame":
      return { panelNumber: source.frame + 1, gridPosition: `DICOM frame ${source.frame + 1}` };
    case "nifti-slice":
      return {
        panelNumber: source.index + 1,
        gridPosition: `${source.axis} slice ${source.index + 1}`,
      };
    case "zip-entry":
      return { panelNumber: null, gridPosition: `archive entry: ${source.entryName}` };
    default:
      return { panelNumber: 1, gridPosition: "whole file" };
  }
}

function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Human-readable per-image research report (JSON export). */
function buildReport(
  image: ExtractedImage,
  analysis: ImageAnalysis,
  modelName: string,
  fileName: string | null,
) {
  const { panelNumber, gridPosition } = panelInfo(image.source);
  return {
    exportedAt: new Date().toISOString(),
    image: {
      id: image.id,
      sourceFileName: fileName,
      panelNumber,
      gridPosition,
      sourceType: image.source.type,
      dimensions: { width: image.width, height: image.height, channels: image.channels },
    },
    analysisStatus: analysis.status,
    preprocessing:
      "Luma (Rec.601) → 224×224 bilinear resize → intensity normalisation (x − 0.449) / 0.226",
    classification: analysis.prediction
      ? {
          model: modelName,
          predictedClass: analysis.prediction.predictedClass,
          confidence: analysis.prediction.confidence,
          classProbabilities: analysis.prediction.probabilities,
        }
      : null,
    gradCam: analysis.heatmap
      ? {
          targetClass: analysis.heatmap.targetClass,
          resolution: `${analysis.heatmap.activations[0].length}×${analysis.heatmap.activations.length} (upsampled to the image for display)`,
          note: "Regions contributing to the selected model output. Not a tumour segmentation or confirmed tumour location.",
        }
      : null,
    saliency: analysis.saliency
      ? {
          coverage: analysis.saliency.coverage,
          boundingBoxModelView: analysis.saliency.bbox,
          note: "High-attribution region from the model explanation; not a clinical delineation.",
        }
      : null,
    perturbation: analysis.perturbation
      ? {
          method: analysis.perturbation.method,
          perturbedPixelCount: analysis.perturbation.perturbedPixelCount,
          perturbedPrediction: analysis.perturbedPrediction,
        }
      : null,
    ofi_res: analysis.ofi
      ? {
          value: analysis.ofi.value,
          confidenceChange: analysis.ofi.confidenceChange,
          formulaVersion: analysis.ofi.formulaVersion,
          unreliable: analysis.ofi.unreliable ?? false,
          note: analysis.ofi.note ?? null,
          interpretation:
            "OFI_res is an experimental model-output fragility measure (0 = unchanged output, 1 = full confidence collapse). It is NOT a clinically validated standard.",
        }
      : null,
    error: analysis.error,
  };
}

/** One-row CSV of the per-image metrics (matches the multi-image summary schema). */
function buildCsv(
  image: ExtractedImage,
  analysis: ImageAnalysis,
): string {
  const { panelNumber, gridPosition } = panelInfo(image.source);
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = [
    "image_id",
    "panel_number",
    "grid_position",
    "width",
    "height",
    "predicted_class",
    "original_confidence",
    "gradcam_status",
    "target_class",
    "perturbation_method",
    "perturbed_class",
    "perturbed_confidence",
    "confidence_change",
    "ofi_res",
    "ofi_formula_version",
    "ofi_status",
    "analysis_status",
  ];
  const row = [
    image.id,
    panelNumber,
    gridPosition,
    image.width,
    image.height,
    analysis.prediction?.predictedClass ?? "",
    analysis.prediction?.confidence ?? "",
    analysis.heatmap ? "generated" : "not generated",
    analysis.heatmap?.targetClass ?? "",
    analysis.perturbation?.method ?? "",
    analysis.perturbedPrediction?.predictedClass ?? "",
    analysis.perturbedPrediction?.confidence ?? "",
    analysis.ofi?.confidenceChange ?? "",
    analysis.ofi?.value ?? "",
    analysis.ofi?.formulaVersion ?? "",
    analysis.ofi ? (analysis.ofi.unreliable ? "unreliable" : "computed") : "not computed",
    analysis.status,
  ].map(esc);
  return `${header.join(",")}\n${row.join(",")}\n`;
}

interface DetailProps {
  image: ExtractedImage;
  analysis: ImageAnalysis;
  modelName: string;
  fileName: string | null;
}

export default function ImageDetailView({ image, analysis, modelName, fileName }: DetailProps) {
  const navigate = useNavigate();
  const [opacity, setOpacity] = useState(0.5);

  const a = analysis;
  const { panelNumber, gridPosition } = useMemo(() => panelInfo(image.source), [image.source]);

  // Binding validation — this page must never display artifacts that belong
  // to a different image ID, class, or dimensions.
  const bindingError = useMemo(() => {
    try {
      validateAnalysisBinding(image, a);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Result validation failed.";
    }
  }, [image, a]);

  const reportJson = useMemo(
    () => (bindingError ? null : JSON.stringify(buildReport(image, a, modelName, fileName), null, 2)),
    [image, a, modelName, fileName, bindingError],
  );
  const reportCsv = useMemo(() => (bindingError ? null : buildCsv(image, a)), [image, a, bindingError]);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-neutral-600 hover:text-neutral-900 p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="font-semibold text-[#12355B]">Image detail — {image.id}</h1>
              <p className="text-xs text-neutral-500">
                {fileName ? `${fileName} · ` : ""}
                {panelNumber ? `panel ${panelNumber} · ` : ""}
                {gridPosition ?? ""} · {image.width} × {image.height} · {image.channels} channel
                {image.channels === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#12355B]/10 text-[#12355B] rounded">
            {a.status === "done" ? "Analysis complete" : `Analysis ${a.status}`}
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {bindingError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">Result integrity check failed</p>
              <p className="text-sm text-red-600 mt-1">{bindingError}</p>
              <p className="text-xs text-red-500 mt-1">
                This detail view is blocked so mismatched artifacts are never displayed.
              </p>
            </div>
          </div>
        )}

        {/* Identification */}
        <Card className="border-neutral-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#2E8B57]" />
              Image identification
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              <Row label="Image ID" value={image.id} />
              <Row label="Original file" value={fileName ?? "—"} />
              <Row label="Panel number" value={panelNumber ? String(panelNumber) : "—"} />
              <Row label="Grid position" value={gridPosition ?? "—"} />
              <Row
                label="Extraction source"
                value={describeSource(image.source)}
              />
              <Row label="Extracted dimensions" value={`${image.width} × ${image.height} px`} />
              <Row label="Channels" value={String(image.channels)} />
              <Row label="Analysis status" value={a.status} />
            </div>
          </CardContent>
        </Card>

        {/* Prediction + OFI header cards */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="p-4 bg-[#12355B]/5 border border-[#12355B]/20 rounded-lg">
            <p className="text-xs text-neutral-500">Original prediction</p>
            <p className="text-2xl font-semibold text-[#12355B]">
              {a.prediction?.predictedClass ?? "—"}
            </p>
            <p className="text-sm text-neutral-600">
              confidence {((a.prediction?.confidence ?? 0) * 100).toFixed(1)}%
            </p>
          </div>
          <div className="p-4 bg-[#E58A2B]/5 border border-[#E58A2B]/20 rounded-lg">
            <p className="text-xs text-neutral-500">Perturbed prediction</p>
            <p className="text-2xl font-semibold text-[#E58A2B]">
              {a.perturbedPrediction?.predictedClass ?? "—"}
            </p>
            <p className="text-sm text-neutral-600">
              confidence {((a.perturbedPrediction?.confidence ?? 0) * 100).toFixed(1)}%
            </p>
          </div>
          <div className="p-4 bg-[#2E8B57]/5 border border-[#2E8B57]/20 rounded-lg">
            <p className="text-xs text-neutral-500">
              OFI<sub>res</sub> ({a.ofi?.formulaVersion ?? "—"})
            </p>
            <p className="text-2xl font-semibold text-[#2E8B57]">
              {a.ofi ? a.ofi.value.toFixed(3) : "—"}
              {a.ofi?.unreliable && <AlertTriangle className="inline w-5 h-5 text-[#E58A2B] ml-1" />}
            </p>
            <p className="text-sm text-neutral-600">
              Δ confidence {(100 * (a.ofi?.confidenceChange ?? 0)).toFixed(1)} pp
              {a.ofi?.unreliable ? " · flagged unreliable" : ""}
            </p>
          </div>
        </div>

        {/* Grad-CAM */}
        <Card className="border-neutral-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Thermometer className="w-5 h-5 text-[#6C4AB6]" />
              Grad-CAM explanation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <figure>
                <img src={image.dataUrl} alt="Original" className="w-full rounded-lg border border-neutral-200" />
                <figcaption className="text-xs text-neutral-500 mt-1">Original</figcaption>
              </figure>
              <figure>
                <img src={a.heatmap?.dataUrl ?? image.dataUrl} alt="Grad-CAM heatmap" className="w-full rounded-lg border border-neutral-200" />
                <figcaption className="text-xs text-neutral-500 mt-1">
                  Heatmap → target class {a.heatmap?.targetClass ?? "—"}
                </figcaption>
              </figure>
              <figure>
                <div className="relative">
                  <img src={image.dataUrl} alt="Overlay base" className="w-full rounded-lg border border-neutral-200" />
                  <img
                    src={a.heatmap?.dataUrl ?? ""}
                    alt="Overlay"
                    className="absolute inset-0 w-full h-full rounded-lg"
                    style={{ opacity, mixBlendMode: "multiply" }}
                  />
                </div>
                <figcaption className="text-xs text-neutral-500 mt-1">
                  Adjustable overlay ({Math.round(opacity * 100)}%)
                </figcaption>
              </figure>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Overlay opacity</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full accent-[#6C4AB6]"
              />
            </div>
            <div className="p-3 bg-[#F3F6F9] rounded-lg text-xs text-neutral-600 space-y-1">
              <p><span className="font-medium text-neutral-800">Model:</span> {modelName} (demo surrogate)</p>
              <p>
                <span className="font-medium text-neutral-800">Explanation status:</span>{" "}
                {a.heatmap
                  ? `generated for THIS image (${image.id}) — heatmap upsampled to ${image.width}×${image.height} for display, 224×224 model view`
                  : "not generated"}
              </p>
              <p><span className="font-medium text-neutral-800">Preprocessing:</span> Luma → 224×224 bilinear → (x − 0.449) / 0.226</p>
              <p className="text-neutral-500">
                Grad-CAM indicates model-attributed regions only. It does not prove tumour
                location and is not an accurate tumour segmentation method.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Saliency + perturbation */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card className="border-neutral-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Eye className="w-5 h-5 text-[#6C4AB6]" />
                Salient region mask
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <figure>
                <img src={a.saliency?.dataUrl ?? image.dataUrl} alt="Saliency mask" className="w-full rounded-lg border border-neutral-200" />
                <figcaption className="text-xs text-neutral-500 mt-1">
                  Coverage {(100 * (a.saliency?.coverage ?? 0)).toFixed(1)}% of the image
                </figcaption>
              </figure>
              {a.saliency && (
                <p className="text-xs text-neutral-600">
                  Approximate region of interest: x {a.saliency.bbox.x}–{a.saliency.bbox.x + a.saliency.bbox.w}, y{" "}
                  {a.saliency.bbox.y}–{a.saliency.bbox.y + a.saliency.bbox.h} (model view px).
                </p>
              )}
              <p className="text-xs text-neutral-500">
                Grad-CAM highlights where the model looked — it is NOT an accurate tumour
                segmentation. Reliable localization requires a trained segmentation model and
                is not available in this build.
              </p>
            </CardContent>
          </Card>

          <Card className="border-neutral-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Layers className="w-5 h-5 text-[#E58A2B]" />
                Perturbation — side by side
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <figure>
                  <img src={image.dataUrl} alt="Original" className="w-full rounded-lg border border-neutral-200" />
                  <figcaption className="text-xs text-neutral-500 mt-1">Original</figcaption>
                </figure>
                <figure>
                  <img src={a.perturbation?.dataUrl ?? image.dataUrl} alt="Perturbed" className="w-full rounded-lg border border-neutral-200" />
                  <figcaption className="text-xs text-neutral-500 mt-1">
                    {a.perturbation?.method ?? "—"} ({a.perturbation?.perturbedPixelCount ?? 0} px changed)
                  </figcaption>
                </figure>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* OFI_res detail */}
        <Card className="border-neutral-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              OFI<sub>res</sub> calculation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {a.ofi ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                <Row label="OFI_res value" value={a.ofi.value.toFixed(4)} />
                <Row label="Formula version" value={a.ofi.formulaVersion} />
                <Row label="Original confidence" value={((a.prediction?.confidence ?? 0) * 100).toFixed(1) + "%"} />
                <Row label="Perturbed confidence" value={((a.perturbedPrediction?.confidence ?? 0) * 100).toFixed(1) + "%"} />
                <Row label="Confidence change" value={(100 * a.ofi.confidenceChange).toFixed(1) + " pp"} />
                <Row label="Perturbation method" value={a.perturbation?.method ?? "—"} />
                <Row label="Calculation status" value={a.ofi.unreliable ? "computed — unreliable" : "computed"} />
                <Row
                  label="Interpretation"
                  value={
                    a.ofi.unreliable
                      ? "Baseline confidence too low for a stable ratio — treat with caution."
                      : a.ofi.value < 0.15
                        ? "Output stable under perturbation of the salient region."
                        : a.ofi.value < 0.5
                          ? "Moderate output change under perturbation."
                          : "Large output change — prediction is fragile for this image."
                  }
                />
              </div>
            ) : (
              <p className="text-sm text-neutral-500">
                OFI_res was not computed for this image{a.error ? ` (${a.error})` : ""}.
              </p>
            )}
            <p className="text-xs text-neutral-500 mt-3">
              OFI<sub>res</sub> is an experimental model-output fragility measure, not a clinically
              validated standard. It evaluates how much the model's own output changes when the
              region its explanation highlights is realistically perturbed.
            </p>
          </CardContent>
        </Card>

        {/* Report export */}
        <Card className="border-neutral-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Analysis report export</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                className="border-neutral-300"
                disabled={!reportJson}
                onClick={() =>
                  reportJson &&
                  downloadFile(`${image.id}-report.json`, reportJson, "application/json")
                }
              >
                <Download className="w-4 h-4 mr-2" /> Export JSON
              </Button>
              <Button
                variant="outline"
                className="border-neutral-300"
                disabled={!reportCsv}
                onClick={() =>
                  reportCsv && downloadFile(`${image.id}-summary.csv`, reportCsv, "text/csv")
                }
              >
                <Download className="w-4 h-4 mr-2" /> Export CSV
              </Button>
            </div>
            <p className="text-xs text-neutral-500 mt-3">
              Exports cover this image only. Research records — no clinical claims.
            </p>
          </CardContent>
        </Card>

        <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200 flex items-start gap-3">
          <Info className="w-5 h-5 text-neutral-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-neutral-600">
            <span className="font-medium">For research only.</span> Tumor stage/grade prediction is
            not available in this model. Brain tumor grading requires a validated clinical framework
            and expert review — no stage is inferred from these results.
          </p>
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-neutral-500 text-xs">{label}</p>
      <p className="text-neutral-900 font-medium break-words">{value}</p>
    </div>
  );
}

function describeSource(source: ExtractedImage["source"]): string {
  switch (source.type) {
    case "single-file": return "whole file";
    case "composite-panel": return `composite panel ${source.panelIndex + 1}`;
    case "tiff-page": return `TIFF page ${source.page + 1}`;
    case "dicom-frame": return `DICOM frame ${source.frame + 1}`;
    case "nifti-slice": return `${source.axis} slice ${source.index + 1}`;
    case "zip-entry": return `archive entry: ${source.entryName}`;
  }
}

/**
 * Route wrapper — hydrates THIS image's record from the in-memory session
 * store, validates the result binding, and only then renders the detail view.
 */
export function ImageDetailRoute() {
  const navigate = useNavigate();
  const { imageId } = useParams<{ imageId: string }>();

  const session = getSession();
  const image = imageId ? getImage(imageId) : null;
  const analysis = imageId ? getAnalysis(imageId) : null;

  if (!image || !analysis) {
    const hasSession = !!session?.images.length;
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-8 h-8 text-[#E58A2B] mx-auto mb-3" />
          <p className="text-sm text-neutral-700 font-medium">
            {hasSession
              ? `No completed analysis found for "${imageId}".`
              : "Detail view needs session data"}
          </p>
          <p className="text-xs text-neutral-500 mt-2 mb-4">
            {hasSession
              ? "Run the analysis first, then open a detail view from the results list."
              : "Extracted images stay in your browser for privacy. Start from Upload to (re)build the analysis session, then open a detail view from the results list."}
          </p>
          <Button className="bg-[#12355B] hover:bg-[#1a4570]" onClick={() => navigate("/upload")}>
            Go to Upload
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ImageDetailView
      image={image}
      analysis={analysis}
      modelName={session?.modelName ?? "demo-pixel-stats-v1"}
      fileName={session?.file.name ?? null}
    />
  );
}
