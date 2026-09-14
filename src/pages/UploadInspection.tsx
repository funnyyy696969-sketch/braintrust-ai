import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Upload,
  X,
  Loader2,
  FileSearch,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Layers,
  Grid3x3,
  Box,
  FileArchive,
  Image as ImageIcon,
} from "lucide-react";
import { inspectFile } from "@/lib/imaging/fileInspection";
import { extractPanels, renderPanelOverlay } from "@/lib/imaging/compositeDetection";
import { extractAll } from "@/lib/imaging/extraction";
import { setSession } from "@/lib/imaging/sessionStore";
import type { FileInspectionReport, ExtractedImage } from "@/lib/imaging/types";
import type { Id } from "../convex/_generated/dataModel";

interface Session {
  file: File;
  previewUrl: string;
  report: FileInspectionReport;
  /** For composites: overlay + panels before persisting. */
  overlayUrl: string | null;
  images: ExtractedImage[];
  gridInfo: string | null;
}

const ACCEPT =
  ".png,.jpg,.jpeg,.tif,.tiff,.dcm,.nii,.gz,.zip,image/png,image/jpeg,image/tiff";

const STRUCTURE_ICON: Record<string, React.ReactNode> = {
  single: <ImageIcon className="w-4 h-4" />,
  composite: <Grid3x3 className="w-4 h-4" />,
  "slice-stack": <Layers className="w-4 h-4" />,
  volume: <Box className="w-4 h-4" />,
  archive: <FileArchive className="w-4 h-4" />,
  invalid: <AlertCircle className="w-4 h-4" />,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadInspection() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [manualGrid, setManualGrid] = useState<string>("");

  const createScan = useMutation(api.scans.createScan);
  const createImages = useMutation(api.scans.createImages);
  const finalizeScan = useMutation(api.scans.finalizeScan);

  const inspectAndPrepare = useCallback(async (file: File) => {
    setError(null);
    setSession(null);
    try {
      setBusy("Inspecting file structure…");
      const report = await inspectFile(file);
      const previewUrl = URL.createObjectURL(file);

      let images: ExtractedImage[] = [];
      let overlayUrl: string | null = null;
      let gridInfo: string | null = null;

      if (report.kind === "png" || report.kind === "jpeg") {
        const dataUrl = await fileToDataUrl(file);
        setBusy("Detecting panels / image structure…");
        const result = await extractPanels(dataUrl);
        images = result.images;
        gridInfo = `${result.grid.method} · ${result.grid.rows}×${result.grid.cols} · confidence: ${result.grid.confidence}`;
        overlayUrl = await renderPanelOverlay(dataUrl, result.grid.panels);
      } else if (report.kind !== "unknown") {
        setBusy("Extracting slices / frames…");
        images = await extractAll(file, report);
        gridInfo = `${report.structure} · ${images.length} extracted`;
      }

      setSession({ file, previewUrl, report, overlayUrl, images, gridInfo });
      setSessionStoreData(file, images);
    } catch (err) {
      setError(err instanceof Error ? err.message : "File inspection failed");
    } finally {
      setBusy(null);
    }
  }, []);

  const reExtractWithGrid = useCallback(async () => {
    if (!session) return;
    const m = manualGrid.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!m) {
      setError("Enter a grid like 2x2 or 3x3.");
      return;
    }
    setError(null);
    try {
      setBusy("Re-extracting with manual grid…");
      const dataUrl = await fileToDataUrl(session.file);
      const result = await extractPanels(dataUrl, {
        rows: parseInt(m[1], 10),
        cols: parseInt(m[2], 10),
      });
      const overlayUrl = await renderPanelOverlay(dataUrl, result.grid.panels);
      setSession({
        ...session,
        images: result.images,
        overlayUrl,
        gridInfo: `manual ${m[1]}×${m[2]} grid`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-extraction failed");
    } finally {
      setBusy(null);
    }
  }, [session, manualGrid]);

  const acceptAndContinue = useCallback(async () => {
    if (!session) return;
    if (!session.images.length) {
      setError("No valid images were extracted from this file.");
      return;
    }
    try {
      setBusy("Saving extraction record…");
      const r = session.report;
      const scanId: Id<"scans"> = await createScan({
        fileName: r.fileName,
        fileSize: r.fileSize,
        mimeType: r.mimeType,
        kind: r.kind,
        structure: r.structure,
        imageCount: session.images.length,
        identificationNote: r.identificationNote,
        statusMessage: r.statusMessage,
        inspectionStatus: r.status,
        metadata: JSON.stringify({
          dimensions: r.dimensions,
          channels: r.channels,
          bitDepth: r.bitDepth,
          seriesInfo: r.seriesInfo,
          voxelSpacing: r.voxelSpacing,
          gridInfo: session.gridInfo,
        }),
      });
      await createImages({
        scanId,
        images: session.images.map((im) => ({
          imageId: im.id,
          sourceType: im.source.type,
          sourceDetail: describeSource(im.source),
          width: im.width,
          height: im.height,
          channels: im.channels,
        })),
      });
      await finalizeScan({
        scanId,
        extractionNote: `Extracted ${session.images.length} image(s): ${session.images
          .map((im) => `${im.id} ${im.width}×${im.height} (${im.source.type})`)
          .join(", ")}`,
      });
      navigate(`/analysis/${scanId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save extraction");
    } finally {
      setBusy(null);
    }
  }, [session, createScan, createImages, finalizeScan, navigate]);

  const r = session?.report;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/dashboard")}
              className="text-neutral-600 hover:text-neutral-900 p-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="font-semibold text-[#12355B]">Upload &amp; File Inspection</h1>
              <p className="text-xs text-neutral-500">
                Structure detection before any analysis
              </p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#12355B]/10 text-[#12355B] rounded">
            Demo Mode
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {!session && (
          <Card className="border-neutral-200">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-[#12355B]" />
                <CardTitle className="text-lg">Upload one file</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files[0]) inspectAndPrepare(e.dataTransfer.files[0]);
                }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => inputRef.current?.click()}
                className="border-2 border-dashed border-neutral-300 rounded-lg p-10 text-center hover:border-[#12355B]/40 transition-colors cursor-pointer"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-10 h-10 text-[#12355B] mx-auto mb-4 animate-spin" />
                    <p className="text-neutral-700">{busy}</p>
                  </>
                ) : (
                  <>
                    <FileSearch className="w-10 h-10 text-neutral-400 mx-auto mb-4" />
                    <p className="text-neutral-700 mb-1">Drop a brain MRI file here, or click to browse</p>
                    <p className="text-xs text-neutral-500">
                      PNG · JPG · multi-page TIFF · DICOM (single &amp; multi-frame) · NIfTI (.nii / .nii.gz) · ZIP — up to 200 MB
                    </p>
                  </>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) inspectAndPrepare(f);
                  e.target.value = "";
                }}
              />
              <p className="text-xs text-neutral-500 mt-4">
                The file type and internal structure are detected from the file contents — never
                assumed from the extension. A 3D volume with hundreds of slices and a composite
                image with four panels are treated as entirely different things.
              </p>
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {session && r && (
          <>
            <Card className="border-neutral-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileSearch className="w-5 h-5 text-[#12355B]" />
                  File inspection report
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row gap-6">
                  <img
                    src={session.previewUrl}
                    alt="Uploaded file preview"
                    className="w-full md:w-56 h-48 object-contain bg-neutral-50 border border-neutral-200 rounded-lg"
                  />
                  <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <Row label="File name" value={r.fileName} />
                    <Row label="File size" value={formatBytes(r.fileSize)} />
                    <Row label="Detected type" value={`${r.kind.toUpperCase()} — ${r.mimeType}`} />
                    <Row
                      label="Structure"
                      value={
                        <span className="inline-flex items-center gap-1.5">
                          {STRUCTURE_ICON[r.structure]}
                          {r.structure}
                        </span>
                      }
                    />
                    <Row label="Images / slices / frames" value={String(r.imageCount)} />
                    <Row
                      label="Dimensions"
                      value={
                        r.dimensions.length
                          ? r.dimensions.map((d) => `${d.width} × ${d.height}`).join(", ")
                          : "—"
                      }
                    />
                    <Row label="Channels" value={r.channels.join(", ") || "—"} />
                    <Row label="Bit depth" value={r.bitDepth ? `${r.bitDepth}-bit` : "—"} />
                    <Row label="Series info" value={r.seriesInfo || "—"} />
                    <Row
                      label="Voxel spacing"
                      value={
                        r.voxelSpacing
                          ? `${r.voxelSpacing.x} × ${r.voxelSpacing.y} × ${r.voxelSpacing.z} mm`
                          : "—"
                      }
                    />
                  </div>
                </div>

                <div
                  className={`mt-4 p-3 rounded-lg border flex items-start gap-2 text-sm ${
                    r.status === "ok"
                      ? "bg-[#2E8B57]/5 border-[#2E8B57]/25 text-[#2E8B57]"
                      : r.status === "warning"
                        ? "bg-[#E58A2B]/5 border-[#E58A2B]/25 text-[#B36A1D]"
                        : "bg-red-50 border-red-200 text-red-700"
                  }`}
                >
                  {r.status === "ok" ? (
                    <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-medium">Processing status: {r.status}</p>
                    <p className="mt-0.5 text-neutral-600">{r.statusMessage}</p>
                    <p className="mt-0.5 text-neutral-500 text-xs">{r.identificationNote}</p>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <Button variant="outline" className="border-neutral-300" onClick={() => setSession(null)}>
                    <X className="w-4 h-4 mr-1" /> Choose a different file
                  </Button>
                  <Button
                    onClick={acceptAndContinue}
                    disabled={busy !== null || !session.images.length}
                    className="bg-[#12355B] hover:bg-[#1a4570]"
                  >
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                    Continue with {session.images.length} extracted image{session.images.length === 1 ? "" : "s"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {session.overlayUrl && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Panel detection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-neutral-600">
                    Method: <span className="font-medium text-neutral-900">{session.gridInfo}</span>.
                    Boundaries were detected from image content (uniform separator rows and columns),
                    and every panel is cropped from the original full-resolution image — nothing is
                    resized, stretched, or rotated.
                  </p>
                  <img
                    src={session.overlayUrl}
                    alt="Detected panel boundaries"
                    className="w-full rounded-lg border border-neutral-200"
                  />
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">
                        Detection unsure? Force a grid
                      </label>
                      <input
                        value={manualGrid}
                        onChange={(e) => setManualGrid(e.target.value)}
                        placeholder="e.g. 2x2 or 3x3"
                        className="border border-neutral-300 rounded-md px-3 py-2 text-sm w-40"
                      />
                    </div>
                    <Button variant="outline" className="border-neutral-300" onClick={reExtractWithGrid}>
                      Re-extract
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {session.images.length > 0 && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">
                    Extracted images ({session.images.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {session.images.map((im) => (
                      <figure key={im.id} className="border border-neutral-200 rounded-lg overflow-hidden">
                        <img
                          src={im.dataUrl}
                          alt={`Extracted image ${im.id}`}
                          className="w-full h-32 object-contain bg-neutral-50"
                        />
                        <figcaption className="p-2 text-xs text-neutral-600 space-y-0.5">
                          <p className="font-medium text-neutral-800">{im.id}</p>
                          <p>{im.width} × {im.height} · {im.channels} ch</p>
                          <p className="text-neutral-500">{describeSource(im.source)}</p>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
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
    case "composite-panel": return `panel ${source.panelIndex} (row ${source.row + 1}, col ${source.col + 1})`;
    case "tiff-page": return `TIFF page ${source.page + 1}`;
    case "dicom-frame": return `frame ${source.frame + 1}`;
    case "nifti-slice": return `${source.axis} slice ${source.index + 1}`;
    case "zip-entry": return `zip: ${source.entryName}`;
  }
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/** Mirror the extraction into the in-memory session store for later pages. */
function setSessionStoreData(file: File, images: ExtractedImage[]) {
  setSession({
    file,
    images,
    modelName: "demo-pixel-stats-v1",
    formulaVersion: "OFI_res-v1.0",
  });
}
