import { useRef } from "react";

import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Upload,
  Scissors,
  ChevronLeft,
  Info,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { inspectFile } from "@/lib/imaging/fileInspection";
import { extractPanels } from "@/lib/imaging/compositeDetection";
import { extractAll } from "@/lib/imaging/extraction";
import { analyzeImage, type StageListener } from "@/lib/imaging/analysisPipeline";
import { PERTURBATION_METHODS, type PerturbationMethod, perturbImage } from "@/lib/imaging/perturbation";
import type { ExtractedImage, ImageAnalysis, SaliencyMask, PerturbationResult } from "@/lib/imaging/types";

const ACCEPT =
  ".png,.jpg,.jpeg,.tif,.tiff,.dcm,.nii,.gz,.zip,image/png,image/jpeg,image/tiff";

/**
 * Perturb — real per-image perturbation flow.
 *
 * Upload → inspect → extract → analyze (to get saliency mask) → perturb the
 * salient region with the selected method → show original vs perturbed side by side.
 */
export default function Perturbation() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [report, setReport] = useState<import("@/lib/imaging/types").FileInspectionReport | null>(null);

  const [images, setImages] = useState<ExtractedImage[]>([]);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [gridInfo, setGridInfo] = useState<string | null>(null);
  const [manualGrid, setManualGrid] = useState("");

  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [method, setMethod] = useState<PerturbationMethod>("gaussian-blur");

  const [perturbedResult, setPerturbedResult] = useState<PerturbationResult | null>(null);
  const [showMask, setShowMask] = useState(false);

  const [stageMsg, setStageMsg] = useState("Upload a scan to begin");

  const handleFileSelect = useCallback(async (file: File) => {
    setError(null);
    setAnalysis(null);
    setImages([]);
    setOverlayUrl(null);
    setGridInfo(null);
    setPerturbedResult(null);
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

  const runAnalysisAndPerturb = useCallback(async () => {
    if (!images.length || !file) return;
    setError(null);
    setAnalysis(null);
    setPerturbedResult(null);

    const target = images[0];
    setStageMsg(`Analyzing ${target.id}…`);

    const listener: StageListener = (imageId, stage) => {
      if (imageId === target.id) setStageMsg(stage);
    };

    try {
      // First run the full analysis to get the saliency mask
      const result = await analyzeImage(target, method, listener);
      setAnalysis(result);
      setStageMsg("Perturbing salient region…");

      if (result.saliency && result.perturbation) {
        // Use the already-computed perturbation
        setPerturbedResult(result.perturbation);
        setStageMsg("Done");
      } else if (result.saliency) {
        // Perturb using the saliency mask
        const pert = await perturbImage(target.dataUrl, result.saliency, method);
        setPerturbedResult(pert);
        setStageMsg("Done");
      } else {
        setError("No saliency mask available for perturbation.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    }
  }, [images, file, method]);

  const resetAll = useCallback(() => {
    setFile(null);
    setPreviewUrl(null);
    setReport(null);
    setImages([]);
    setOverlayUrl(null);
    setGridInfo(null);
    setAnalysis(null);
    setPerturbedResult(null);
    setManualGrid("");
    setStageMsg("Upload a scan to begin");
    setError(null);
  }, []);

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
              <h1 className="font-semibold text-[#12355B]">Perturb</h1>
              <p className="text-xs text-neutral-500">Perturb the salient region</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#E58A2B]/10 text-[#E58A2B] rounded">
            Demo Mode
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {!file ? (
          <Card className="border-neutral-200">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-[#E58A2B]" />
                <CardTitle className="text-lg">Upload Scan</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]); }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => inputRef.current?.click()}
                className="border-2 border-dashed border-neutral-300 rounded-lg p-10 text-center hover:border-[#E58A2B]/40 transition-colors cursor-pointer"
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
                    <img src={previewUrl} alt="preview" className="w-full md:w-56 h-48 object-contain bg-neutral-50 border border-neutral-200 rounded-lg" />
                    <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                      <Row label="File name" value={report.fileName} />
                      <Row label="Structure" value={report.structure} />
                      <Row label="Images / slices" value={String(report.imageCount)} />
                      <Row label="Status" value={report.status} />
                    </div>
                  </div>
                  <div className={`mt-4 p-3 rounded-lg border flex items-start gap-2 text-sm ${report.status === "ok" ? "bg-[#2E8B57]/5 border-[#2E8B57]/25 text-[#2E8B57]" : "bg-red-50 border-red-200 text-red-700"}`}>
                    {report.status === "ok" ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                    <div>
                      <p className="font-medium">Processing status: {report.status}</p>
                      <p className="mt-0.5 text-neutral-600">{report.statusMessage}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Panel detection */}
            {overlayUrl && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Panel detection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-neutral-600">
                    Method: <span className="font-medium">{gridInfo}</span>.
                  </p>
                  <img src={overlayUrl} alt="panel boundaries" className="w-full rounded-lg border border-neutral-200" />
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">Force a grid</label>
                      <input value={manualGrid} onChange={(e) => setManualGrid(e.target.value)} placeholder="e.g. 2x2 or 3x3" className="border border-neutral-300 rounded-md px-3 py-2 text-sm w-40" />
                    </div>
                    <Button variant="outline" className="border-neutral-300" onClick={reExtractWithGrid}>
                      Re-extract
                    </Button>
                  </div>
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
                        <figcaption className="p-2 text-xs text-neutral-600">
                          <p className="font-medium text-neutral-800">{im.id}</p>
                          <p>{im.width} × {im.height}</p>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
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
                  <Button onClick={runAnalysisAndPerturb} disabled={busy !== null || !images.length || analysis?.status === "running"} className="bg-[#E58A2B] hover:bg-[#f09845]">
                    {analysis?.status === "running" ? (
                      <><div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />{stageMsg}</>
                    ) : (
                      <><Scissors className="w-4 h-4 mr-2" />Analyze & Perturb</>
                    )}
                  </Button>
                  <Button variant="outline" className="border-neutral-300" onClick={resetAll}>
                    <ChevronLeft className="w-4 h-4 mr-1" />New scan
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Results */}
            {analysis && analysis.status === "done" && (
              <div className="grid md:grid-cols-2 gap-6">
                <Card className="border-neutral-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Original MRI — {images[0]?.id}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="aspect-square bg-neutral-100 rounded-lg flex items-center justify-center overflow-hidden">
                      <img src={images[0]?.dataUrl ?? ""} alt="original" className="max-w-full max-h-full object-contain" />
                    </div>
                  </CardContent>
                </Card>

                {perturbedResult && (
                  <Card className="border-neutral-200">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">Perturbed MRI</CardTitle>
                        <span className="px-2 py-0.5 text-xs bg-[#E58A2B]/10 text-[#E58A2B] rounded">
                          {method.replace("-", " ")}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="aspect-square bg-neutral-100 rounded-lg flex items-center justify-center overflow-hidden">
                        <img src={perturbedResult.dataUrl} alt="perturbed" className="max-w-full max-h-full object-contain" />
                      </div>
                      <p className="text-xs text-neutral-500 mt-2">
                        {perturbedResult.perturbedPixelCount} pixels perturbed in the salient region.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Saliency mask toggle */}
            {analysis?.saliency && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Saliency Mask</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-neutral-600">
                      <input type="checkbox" checked={showMask} onChange={(e) => setShowMask(e.target.checked)} className="rounded" />
                      Show mask
                    </label>
                    <p className="text-xs text-neutral-500">
                      Coverage: {(100 * (analysis.saliency.coverage)).toFixed(1)}%
                    </p>
                  </div>
                  {showMask && (
                    <div className="aspect-square bg-neutral-100 rounded-lg flex items-center justify-center overflow-hidden mt-3">
                      <img src={analysis.saliency.dataUrl} alt="saliency mask" className="max-w-full max-h-full object-contain" />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Side-by-side */}
            {images[0]?.dataUrl && perturbedResult && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2">
                    <Scissors className="w-5 h-5 text-[#E58A2B]" />
                    <CardTitle className="text-lg">Side-by-Side Comparison</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <p className="text-sm text-neutral-600 mb-2">Original</p>
                      <div className="bg-neutral-100 rounded-lg overflow-hidden">
                        <img src={images[0]?.dataUrl} alt="Original" className="w-full h-48 object-cover" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-neutral-600 mb-2">Perturbed ({method.replace("-", " ")})</p>
                      <div className="bg-neutral-100 rounded-lg overflow-hidden">
                        <img src={perturbedResult.dataUrl} alt="Perturbed" className="w-full h-48 object-cover" />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {analysis.error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{analysis.error}</p>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-neutral-600">
              Perturbation results are for research evaluation only. Do not use for
              clinical assessment or diagnostic purposes.
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

import { renderPanelOverlay } from "@/lib/imaging/compositeDetection";

