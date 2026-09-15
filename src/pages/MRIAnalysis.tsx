import { useRef } from "react";
import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Upload,
  X,
  Loader2,
  Brain,
  Info,
  AlertCircle,
  CheckCircle,
  Circle,
  ChevronRight,
} from "lucide-react";
import { inspectFile } from "@/lib/imaging/fileInspection";
import { extractPanels, renderPanelOverlay } from "@/lib/imaging/compositeDetection";
import { extractAll } from "@/lib/imaging/extraction";
import { analyzeImage, type StageListener } from "@/lib/imaging/analysisPipeline";
import { PERTURBATION_METHODS, type PerturbationMethod } from "@/lib/imaging/perturbation";
import { MODEL_NAME } from "@/lib/imaging/prediction";
import { OFI_FORMULA_VERSION } from "@/lib/imaging/fragility";
import type { ExtractedImage, ImageAnalysis, FileInspectionReport } from "@/lib/imaging/types";

const ACCEPT =
  ".png,.jpg,.jpeg,.tif,.tiff,.dcm,.nii,.gz,.zip,image/png,image/jpeg,image/tiff";

/** Single-image analysis state, wired through the real per-image pipeline. */
export default function MRIAnalysis() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [report, setReport] = useState<FileInspectionReport | null>(null);

  // For composites: detected panels + optional manual grid
  const [images, setImages] = useState<ExtractedImage[]>([]);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [gridInfo, setGridInfo] = useState<string | null>(null);
  const [manualGrid, setManualGrid] = useState("");

  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [method, setMethod] = useState<PerturbationMethod>("gaussian-blur");

  const [stageMsg, setStageMsg] = useState("Upload a scan to begin");

  const handleFileSelect = useCallback(async (file: File) => {
    setError(null);
    setAnalysis(null);
    setImages([]);
    setOverlayUrl(null);
    setGridInfo(null);
    try {
      setBusy("Inspecting file structure…");
      const r = await inspectFile(file);
      setReport(r);
      setPreviewUrl(URL.createObjectURL(file));
      setFile(file);
      setStageMsg(`${r.kind.toUpperCase()} · ${r.structure} · ${r.imageCount} image${r.imageCount === 1 ? "" : "s"}`);

      if (r.status === "error") {
        setError(r.statusMessage);
        return;
      }

      if (r.kind === "png" || r.kind === "jpeg") {
        // Composite panel detection for PNG/JPEG
        const dataUrl = await fileToDataUrl(file);
        setBusy("Detecting panels / image structure…");
        const result = await extractPanels(dataUrl);
        setImages(result.images);
        setGridInfo(`${result.grid.method} · ${result.grid.rows}×${result.grid.cols} · confidence: ${result.grid.confidence}`);
        setOverlayUrl(await renderPanelOverlay(dataUrl, result.grid.panels));
      } else if (r.kind !== "unknown") {
        setBusy("Extracting slices / frames…");
        const extracted = await extractAll(file, r);
        setImages(extracted);
        setGridInfo(`${r.structure} · ${extracted.length} extracted`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "File inspection failed");
    } finally {
      setBusy(null);
    }
  }, []);

  const reExtractWithGrid = useCallback(async () => {
    if (!file) return;
    const m = manualGrid.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!m) {
      setError("Enter a grid like 2x2 or 3x3.");
      return;
    }
    setError(null);
    try {
      setBusy("Re-extracting with manual grid…");
      const dataUrl = await fileToDataUrl(file);
      const result = await extractPanels(dataUrl, {
        rows: parseInt(m[1], 10),
        cols: parseInt(m[2], 10),
      });
      setImages(result.images);
      setGridInfo(`manual ${m[1]}×${m[2]} grid`);
      setOverlayUrl(await renderPanelOverlay(dataUrl, result.grid.panels));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-extraction failed");
    } finally {
      setBusy(null);
    }
  }, [file, manualGrid]);

  const runAnalysis = useCallback(async () => {
    if (!images.length || !file) return;
    setError(null);
    setAnalysis(null);

    // Always analyze the first image for the single-image view
    const target = images[0];
    setStageMsg(`Analyzing ${target.id}…`);

    const listener: StageListener = (imageId, stage) => {
      if (imageId === target.id) setStageMsg(stage);
    };

    try {
      const result = await analyzeImage(target, method, listener);
      setAnalysis(result);
      setStageMsg(result.status === "done" ? "Analysis complete" : result.error ?? "Analysis failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    }
  }, [images, file, method]);

  const resetAnalysis = useCallback(() => {
    setFile(null);
    setPreviewUrl(null);
    setReport(null);
    setImages([]);
    setOverlayUrl(null);
    setGridInfo(null);
    setAnalysis(null);
    setManualGrid("");
    setStageMsg("Upload a scan to begin");
    setError(null);
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/dashboard")} className="text-neutral-600 hover:text-neutral-900 p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="font-semibold text-[#12355B]">Analyze MRI</h1>
              <p className="text-xs text-neutral-500">Single-image analysis (per-image pipeline)</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#12355B]/10 text-[#12355B] rounded">
            Demo Mode
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {!file ? (
          <Card className="border-neutral-200">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-[#12355B]" />
                <CardTitle className="text-lg">Upload Scan</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]); }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => inputRef.current?.click()}
                className="border-2 border-dashed border-neutral-300 rounded-lg p-10 text-center hover:border-[#12355B]/40 transition-colors cursor-pointer"
              >
                <Upload className="w-10 h-10 text-neutral-400 mx-auto mb-4" />
                <p className="text-neutral-700 mb-1">Drop a brain MRI file here, or click to browse</p>
                <p className="text-xs text-neutral-500">PNG · JPG · multi-page TIFF · DICOM · NIfTI · ZIP</p>
              </div>
              <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ""; }} />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* File report */}
            {report && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">File inspection</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col md:flex-row gap-6">
                    <img src={previewUrl ?? undefined} alt="preview" className="w-full md:w-56 h-48 object-contain bg-neutral-50 border border-neutral-200 rounded-lg" />
                    <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                      <Row label="File name" value={report.fileName ?? ""} />
                      <Row label="File size" value={formatBytes(report.fileSize)} />
                      <Row label="Detected type" value={`${report.kind.toUpperCase()} — ${report.mimeType}`} />
                      <Row label="Structure" value={report.structure} />
                      <Row label="Images / slices" value={String(report.imageCount)} />
                      <Row label="Dimensions" value={report.dimensions.length ? report.dimensions.map((d) => `${d.width} × ${d.height}`).join(", ") : "—"} />
                      <Row label="Channels" value={report.channels.join(", ") || "—"} />
                      <Row label="Status" value={report.status} />
                    </div>
                  </div>
                  <div className={`mt-4 p-3 rounded-lg border flex items-start gap-2 text-sm ${report.status === "ok" ? "bg-[#2E8B57]/5 border-[#2E8B57]/25 text-[#2E8B57]" : "bg-red-50 border-red-200 text-red-700"}`}>
                    {report.status === "ok" ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                    <div>
                      <p className="font-medium">Processing status: {report.status}</p>
                      <p className="mt-0.5 text-neutral-600">{report.statusMessage}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Composite panel detection (PNG/JPEG) */}
            {overlayUrl && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Panel detection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-neutral-600">
                    Method: <span className="font-medium">{gridInfo}</span>.
                    The image was scanned for uniform separator rows/columns; each panel is cropped
                    from the original full-resolution image.
                  </p>
                  <img src={overlayUrl} alt="panel boundaries" className="w-full rounded-lg border border-neutral-200" />
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">Force a grid (if detection is unsure)</label>
                      <input value={manualGrid} onChange={(e) => setManualGrid(e.target.value)} placeholder="e.g. 2x2 or 3x3" className="border border-neutral-300 rounded-md px-3 py-2 text-sm w-40" />
                    </div>
                    <Button variant="outline" className="border-neutral-300" onClick={reExtractWithGrid}>
                      Re-extract
                    </Button>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Selecting 3×3 extracts 9 panels, 4×4 extracts 16, 6×6 extracts 36.
                    The grid controls the actual extraction, not just the displayed count.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Extracted panels */}
            {images.length > 0 && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Extracted images ({images.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {images.map((im) => (
                      <figure key={im.id} className="border border-neutral-200 rounded-lg overflow-hidden">
                        <img src={im.dataUrl} alt={im.id} className="w-full h-32 object-contain bg-neutral-50" />
                        <figcaption className="p-2 text-xs text-neutral-600 space-y-0.5">
                          <p className="font-medium text-neutral-800">{im.id}</p>
                          <p>{im.width} × {im.height} · {im.channels} ch</p>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                  <p className="text-xs text-neutral-500 mt-3">
                    {images.length === 1 ? "Single image — will be analyzed as-is." : `${images.length} panels detected. The first panel will be analyzed in this view; use Multi-Image Analysis for all panels.`}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Controls */}
            <Card className="border-neutral-200">
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">Perturbation method</label>
                    <select value={method} onChange={(e) => setMethod(e.target.value as PerturbationMethod)} className="border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white">
                      {PERTURBATION_METHODS.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <Button onClick={runAnalysis} disabled={busy !== null || !images.length || analysis?.status === "running"} className="bg-[#12355B] hover:bg-[#1a4570]">
                    {analysis?.status === "running" ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{stageMsg}</>
                    ) : (
                      <><Brain className="w-4 h-4 mr-2" />Run Analysis</>
                    )}
                  </Button>
                  <Button variant="outline" className="border-neutral-300" onClick={resetAnalysis}>
                    <X className="w-4 h-4 mr-1" />Reset
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Analysis result */}
            {analysis && analysis.status === "done" && analysis.prediction && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-[#2E8B57]" />
                    <CardTitle className="text-lg">Prediction — {analysis.imageId}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <div className="p-4 bg-[#12355B]/5 rounded-lg border border-[#12355B]/20 mb-4">
                        <p className="text-sm text-neutral-500 mb-1">Prediction</p>
                        <p className="text-2xl font-semibold text-[#12355B]">{analysis.prediction.predictedClass}</p>
                        <p className="text-sm text-neutral-600 mt-1">confidence {(analysis.prediction.confidence * 100).toFixed(1)}%</p>
                      </div>
                      <div className="p-4 bg-[#008C95]/5 rounded-lg border border-[#008C95]/20">
                        <p className="text-sm text-neutral-500 mb-1">Model</p>
                        <p className="text-lg font-medium text-[#008C95]">{MODEL_NAME} (demo surrogate)</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-neutral-700 mb-3">Class Probabilities</p>
                      <div className="space-y-2">
                        {Object.entries(analysis.prediction.probabilities).map(([className, prob]) => (
                          <div key={className} className="flex items-center justify-between">
                            <span className="text-sm text-neutral-700">{className}</span>
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-2 bg-neutral-200 rounded-full overflow-hidden">
                                <div className="h-full bg-[#008C95] rounded-full" style={{ width: `${prob * 100}%` }} />
                              </div>
                              <span className="text-sm font-medium text-neutral-900 w-16 text-right">{(prob * 100).toFixed(1)}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* OFI_res */}
                  {analysis.ofi && (
                    <div className="mt-6 p-4 bg-[#2E8B57]/5 rounded-lg border border-[#2E8B57]/25">
                      <div className="flex items-center gap-2 mb-2">
                        <Info className="w-4 h-4 text-[#2E8B57]" />
                        <p className="text-sm font-medium text-[#2E8B57]">OFI_res — {analysis.ofi.formulaVersion}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-neutral-500">OFI_res value</p>
                          <p className={`text-xl font-semibold ${analysis.ofi.unreliable ? "text-[#E58A2B]" : "text-[#2E8B57]"}`}>
                            {analysis.ofi.value.toFixed(3)}{analysis.ofi.unreliable ? " ⚠" : ""}
                          </p>
                        </div>
                        <div>
                          <p className="text-neutral-500">Confidence change</p>
                          <p className="text-xl font-semibold text-[#E58A2B]">{(analysis.ofi.confidenceChange * 100).toFixed(1)} pp</p>
                        </div>
                        <div>
                          <p className="text-neutral-500">Perturbed prediction</p>
                          <p className="text-xl font-semibold text-[#E58A2B]">{analysis.perturbedPrediction?.predictedClass ?? "—"}</p>
                        </div>
                      </div>
                      {analysis.ofi.note && <p className="text-xs text-neutral-500 mt-2">{analysis.ofi.note}</p>}
                    </div>
                  )}

                  {/* Preprocessing info */}
                  <div className="mt-6 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
                    <div className="flex items-center gap-2 mb-3">
                      <Info className="w-4 h-4 text-neutral-500" />
                      <p className="text-sm font-medium text-neutral-700">What We Did</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-neutral-500">Original size</p>
                        <p className="text-neutral-900">{analysis.imageId} · {images[0]?.width ?? "?"} × {images[0]?.height ?? "?"}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500">Preprocessing</p>
                        <p className="text-neutral-900">224×224 bilinear → (x − 0.449) / 0.226</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {analysis && analysis.status === "error" && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{analysis.error}</p>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-neutral-600">
              <span className="font-medium">For research only. </span>
              This is an experimental prediction, not a diagnosis.
            </p>
          </div>
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

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

