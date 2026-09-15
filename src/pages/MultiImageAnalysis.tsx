import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Play,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  BarChart3,
  ChevronRight,
  Info,
  ShieldAlert,
} from "lucide-react";
import type { ExtractedImage, ImageAnalysis } from "@/lib/imaging/types";
import { analyzeAll, summarizeGroup } from "@/lib/imaging/analysisPipeline";
import { PERTURBATION_METHODS, type PerturbationMethod } from "@/lib/imaging/perturbation";
import {
  getSession,
  isGridConfirmed,
  setAnalyses as persistAnalyses,
} from "@/lib/imaging/sessionStore";
import type { Id } from "../convex/_generated/dataModel";

type InMemoryImage = import("@/lib/imaging/types").ExtractedImage;

/**
 * Multi-Image Analysis — runs the full pipeline once per extracted image.
 * Every image gets its OWN prediction, heatmap, saliency mask, perturbation,
 * and OFI_res. Results are never shared between images.
 */
export default function MultiImageAnalysis() {
  const { scanId } = useParams<{ scanId: string }>();
  const navigate = useNavigate();

  const scan = useQuery(
    api.scans.getScan,
    scanId ? { scanId: scanId as Id<"scans"> } : "skip",
  );
  const dbImages = useQuery(
    api.scans.listImages,
    scanId ? { scanId: scanId as Id<"scans"> } : "skip",
  );

  const patchAnalysis = useMutation(api.scans.patchImageAnalysis);
  const logAnalysis = useMutation(api.scans.logAnalysis);

  // In-memory copy of the extracted images (data URLs). Extracted in the
  // upload session on the same machine; re-extract if the page was reloaded.
  const [images, setImages] = useState<InMemoryImage[] | null>(null);
  /** False when the session has images but the grid layout was never confirmed. */
  const [gridLocked, setGridLocked] = useState(false);

  // Hydrate from the session store when the page mounts.
  useMemo(() => {
    const s = getSession();
    if (s?.images.length) {
      setImages(s.images);
      // Composite uploads must pass through grid confirmation before analysis.
      const isComposite = s.images.some((im) => im.source.type === "composite-panel");
      setGridLocked(isComposite && !s.gridConfirmed);
    }
  }, []);
  const [method, setMethod] = useState<PerturbationMethod>("gaussian-blur");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ id: string; stage: string } | null>(null);
  const [analyses, setAnalyses] = useState<Map<string, ImageAnalysis>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const done = scan?.inspectionStatus !== "error" && !!scan;
  const summary = useMemo(
    () => (analyses.size ? summarizeGroup(analyses) : null),
    [analyses],
  );

  const runPipeline = useCallback(async () => {
    if (!images || !scanId) return;
    if (!isGridConfirmed()) {
      setGridLocked(true);
      setError("The grid layout has not been confirmed. Return to Upload & Inspection and confirm the extraction before running analysis.");
      return;
    }
    setRunning(true);
    setError(null);
    setAnalyses(new Map());

    await logAnalysis({
      scanId: scanId as Id<"scans">,
      action: "analyze",
      detail: `Batch started: ${images.length} images, perturbation=${method}`,
    });

    const result = await analyzeAll(images, method, (id, stage) => {
      setProgress({ id, stage });
      setAnalyses((prev) => {
        const next = new Map(prev);
        const cur = next.get(id);
        next.set(id, {
          imageId: id,
          status: "running",
          stage,
          prediction: cur?.prediction ?? null,
          perturbedPrediction: cur?.perturbedPrediction ?? null,
          heatmap: cur?.heatmap ?? null,
          saliency: cur?.saliency ?? null,
          perturbation: cur?.perturbation ?? null,
          ofi: cur?.ofi ?? null,
          error: null,
        });
        return next;
      });
    });

    setAnalyses(result.analyses);
    persistAnalyses(result.analyses);
    setProgress(null);
    setRunning(false);

    // Persist per-image results to Convex (per-image record, per-image values)
    for (const a of result.analyses.values()) {
      if (a.status === "done" && a.prediction && a.ofi) {
        await patchAnalysis({
          scanId: scanId as Id<"scans">,
          imageId: a.imageId,
          analysisStatus: "done",
          analysisStage: "Complete",
          predictedClass: a.prediction.predictedClass,
          confidence: a.prediction.confidence,
          probabilities: JSON.stringify(a.prediction.probabilities),
          perturbedPredictedClass: a.perturbedPrediction?.predictedClass,
          perturbedConfidence: a.perturbedPrediction?.confidence,
          perturbationMethod: method,
          ofiValue: a.ofi.value,
          ofiConfidenceChange: a.ofi.confidenceChange,
          ofiFormulaVersion: a.ofi.formulaVersion,
          ofiReliable: !a.ofi.unreliable,
        });
      } else {
        await patchAnalysis({
          scanId: scanId as Id<"scans">,
          imageId: a.imageId,
          analysisStatus: a.status === "error" ? "error" : "done",
          analysisStage: a.stage,
          analysisError: a.error ?? undefined,
        });
      }
      await logAnalysis({
        scanId: scanId as Id<"scans">,
        action: "analyze_image",
        detail:
          a.status === "done"
            ? `${a.imageId}: predicted ${a.prediction?.predictedClass} (p=${(a.prediction?.confidence ?? 0).toFixed(3)}), OFI_res=${a.ofi?.value.toFixed(3)} (${method})`
            : `${a.imageId}: ${a.status} — ${a.error ?? a.stage}`,
      });
    }
  }, [images, scanId, method, logAnalysis, patchAnalysis]);

  const summaryBlocks = summary
    ? [
        { label: "Images analyzed", value: `${summary.analyzed}/${summary.totalImages}` },
        { label: "Failures", value: String(summary.failed) },
        {
          label: "Mean OFI_res",
          value: summary.ofiMean !== null ? summary.ofiMean.toFixed(3) : "—",
        },
        {
          label: "Std dev of OFI_res",
          value: summary.ofiStdDev !== null ? `± ${summary.ofiStdDev.toFixed(3)}` : "—",
        },
      ]
    : [];

  if (!done) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#12355B] mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Loading scan…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/dashboard")} className="text-neutral-600 hover:text-neutral-900 p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="font-semibold text-[#12355B]">Multi-Image Analysis</h1>
              <p className="text-xs text-neutral-500">
                {scan?.fileName} · {scan?.imageCount} image{scan?.imageCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="border-neutral-300" onClick={() => navigate(`/extraction-review/${scanId}`)}>
              Extraction review
            </Button>
            <Button variant="outline" size="sm" className="border-neutral-300" onClick={() => navigate(`/ofi/${scanId}`)}>
              OFI dashboard
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {!images && (
          <Card className="border-[#E58A2B]/30 bg-[#E58A2B]/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-[#B36A1D]">Extraction data lives in your browser session</p>
                  <p className="text-sm text-neutral-600 mt-1">
                    For privacy, extracted images are not uploaded to the server. If you refreshed
                    the page, re-run extraction to load them again.
                  </p>
                  <Button
                    className="mt-3 bg-[#12355B] hover:bg-[#1a4570]"
                    onClick={() => navigate("/upload")}
                  >
                    Re-run extraction
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {images && gridLocked && (
          <Card className="border-[#E58A2B]/30 bg-[#E58A2B]/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-[#B36A1D]">Grid layout not confirmed</p>
                  <p className="text-sm text-neutral-600 mt-1">
                    These panels were extracted from a composite image, but the grid layout was not
                    explicitly confirmed. Analysis is locked until the layout is verified so that
                    Grad-CAM and OFI<sub>res</sub> are computed on correctly separated panels.
                  </p>
                  <Button
                    className="mt-3 bg-[#12355B] hover:bg-[#1a4570]"
                    onClick={() => navigate("/upload")}
                  >
                    Confirm grid layout
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {images && (
          <Card className={`border-neutral-200 ${gridLocked ? "opacity-50 pointer-events-none" : ""}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Play className="w-5 h-5 text-[#008C95]" />
                Run the pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-neutral-600 mb-4">
                Each image is processed independently: preprocess → classify → Grad-CAM → salient
                perturbation → re-classify → OFI<sub>res</sub>. No values are shared between images.
              </p>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Perturbation method</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PerturbationMethod)}
                    className="border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white"
                  >
                    {PERTURBATION_METHODS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <Button
                  onClick={runPipeline}
                  disabled={running}
                  className="bg-[#12355B] hover:bg-[#1a4570]"
                >
                  {running ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {progress ? `${progress.id}: ${progress.stage}` : "Starting…"}
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Analyze all {images.length} images
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Group summary */}
        {summary && (
          <Card className="border-neutral-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-[#12355B]" />
                Group summary
                <span className="text-xs font-normal text-neutral-400">(aggregation of {summary.totalImages} individual results)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {summaryBlocks.map((b) => (
                  <div key={b.label} className="p-3 bg-[#F3F6F9] rounded-lg">
                    <p className="text-xs text-neutral-500">{b.label}</p>
                    <p className="text-xl font-semibold text-[#12355B]">{b.value}</p>
                  </div>
                ))}
              </div>
              {summary.imagesRequiringReview.length > 0 && (
                <div className="mt-4 p-3 bg-[#E58A2B]/5 border border-[#E58A2B]/25 rounded-lg flex items-start gap-2 text-sm">
                  <AlertCircle className="w-4 h-4 text-[#E58A2B] mt-0.5 flex-shrink-0" />
                  <p className="text-neutral-700">
                    Review recommended: {summary.imagesRequiringReview.join(", ")} — the OFI_res
                    baseline confidence was too low for a stable ratio.
                  </p>
                </div>
              )}
              <p className="mt-3 text-xs text-neutral-500 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                This is a statistical aggregation across images, not a combined diagnosis. Image-level
                predictions are listed below and must not be merged without a validated aggregation method.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Per-image cards */}
        {images && analyses.size > 0 && (
          <div className="space-y-3">
            {images.map((im) => {
              const a = analyses.get(im.id);
              return (
                <Card key={im.id} className="border-neutral-200">
                  <CardContent className="pt-5">
                    <div className="flex flex-col lg:flex-row gap-5">
                      <img
                        src={im.dataUrl}
                        alt={`Extracted image ${im.id}`}
                        className="w-36 h-36 object-contain bg-neutral-50 border border-neutral-200 rounded-lg flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3 mb-2">
                        <div>
                          <p className="font-semibold text-neutral-900">
                            {im.id}
                            {im.source.type === "composite-panel" && (
                              <span className="ml-2 text-xs font-normal text-neutral-500">
                                panel {im.source.panelIndex + 1} · row {im.source.row + 1}, col {im.source.col + 1}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {im.width} × {im.height} · {im.channels} channel{im.channels === 1 ? "" : "s"}
                          </p>
                        </div>
                          {a?.status === "done" && (
                            <CheckCircle className="w-5 h-5 text-[#2E8B57] flex-shrink-0" />
                          )}
                          {a?.status === "running" && (
                            <Loader2 className="w-5 h-5 text-[#12355B] animate-spin flex-shrink-0" />
                          )}
                          {a?.status === "error" && (
                            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                          )}
                        </div>

                        {a?.status === "running" && (
                          <p className="text-sm text-[#12355B]">{a.stage}</p>
                        )}
                        {a?.status === "error" && (
                          <p className="text-sm text-red-600">{a.error}</p>
                        )}

                        {a?.status === "done" && a.prediction && (
                          <div className="grid sm:grid-cols-3 gap-3 text-sm">
                            <div>
                              <p className="text-xs text-neutral-500">Prediction</p>
                              <p className="font-medium text-[#12355B]">
                                {a.prediction.predictedClass} ({(a.prediction.confidence * 100).toFixed(1)}%)
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500">Perturbed prediction</p>
                              <p className="font-medium text-[#E58A2B]">
                                {a.perturbedPrediction?.predictedClass} ({((a.perturbedPrediction?.confidence ?? 0) * 100).toFixed(1)}%)
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500">OFI_res</p>
                              <p className="font-medium text-[#2E8B57]">
                                {a.ofi?.value.toFixed(3)}
                                {a.ofi?.unreliable && <span className="text-[#E58A2B]"> ⚠</span>}
                              </p>
                            </div>
                          </div>
                        )}
                        {a?.status === "done" && (
                          <p className="mt-2 text-xs text-neutral-500">
                            Grad-CAM: {a.heatmap ? "generated for this image" : "not generated"} ·
                            target class {a.heatmap?.targetClass ?? "—"} ·
                            binding validated ✓
                          </p>
                        )}

                        <div className="mt-3 flex items-center justify-between">
                          <p className="text-xs text-neutral-400">{a?.status === "pending" || !a ? "Not analyzed yet" : ""}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-neutral-300"
                            disabled={a?.status !== "done"}
                            onClick={() => navigate(`/image/${scanId}/${im.id}`)}
                          >
                            Detail view <ChevronRight className="w-4 h-4 ml-1" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {dbImages && !images && (
          <p className="text-xs text-neutral-400">
            {dbImages.length} image record(s) stored for this scan.
          </p>
        )}
      </main>
    </div>
  );
}
