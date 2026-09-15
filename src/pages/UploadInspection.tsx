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
  RotateCcw,
  Check,
  Crop,
} from "lucide-react";
import {
  extractPanels,
  renderPanelOverlay,
  recropPanel,
  validateGridInput,
  MAX_GRID_DIM,
  type PanelRect,
} from "@/lib/imaging/compositeDetection";
import { extractAll } from "@/lib/imaging/extraction";
import { inspectFile } from "@/lib/imaging/fileInspection";
import { confirmGrid, setSession } from "@/lib/imaging/sessionStore";
import type { FileInspectionReport, ExtractedImage } from "@/lib/imaging/types";
import type { Id } from "../convex/_generated/dataModel";

interface Session {
  file: File;
  previewUrl: string;
  report: FileInspectionReport;
  /** For composites: data URL of the original image (needed for re-cropping). */
  compositeDataUrl: string | null;
  overlayUrl: string | null;
  images: ExtractedImage[];
  gridInfo: string | null;
  /** Whether the current layout still needs explicit user confirmation. */
  gridConfirmed: boolean;
  /** Detected rows×cols from automatic detection (null for manual/medical). */
  autoLayout: { rows: number; cols: number } | null;
  /** Panel rects in ORIGINAL pixels — drives the crop-coordinate table. */
  panelRects: PanelRect[];
  originalWidth: number;
  originalHeight: number;
}

const ACCEPT =
  ".png,.jpg,.jpeg,.tif,.tiff,.dcm,.nii,.gz,.zip,image/png,image/jpeg,image/tiff";

/** Quick-select layouts shown as chips (any M×N is still accepted via custom). */
const LAYOUT_CHIPS: { rows: number; cols: number }[] = [
  { rows: 1, cols: 1 },
  { rows: 2, cols: 2 },
  { rows: 2, cols: 3 },
  { rows: 3, cols: 2 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 },
  { rows: 5, cols: 5 },
  { rows: 6, cols: 6 },
];

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
  const [session, setSessionState] = useState<Session | null>(null);
  const [manualRows, setManualRows] = useState("");
  const [manualCols, setManualCols] = useState("");
  const [editingCrop, setEditingCrop] = useState<string | null>(null);
  const [cropDraft, setCropDraft] = useState({ x: "", y: "", w: "", h: "" });

  const createScan = useMutation(api.scans.createScan);
  const createImages = useMutation(api.scans.createImages);
  const finalizeScan = useMutation(api.scans.finalizeScan);

  const inspectAndPrepare = useCallback(async (file: File) => {
    setError(null);
    setSessionState(null);
    setEditingCrop(null);
    try {
      setBusy("Inspecting file structure…");
      const report = await inspectFile(file);
      const previewUrl = URL.createObjectURL(file);

      let images: ExtractedImage[] = [];
      let overlayUrl: string | null = null;
      let gridInfo: string | null = null;
      let compositeDataUrl: string | null = null;
      let gridConfirmed = true;
      let autoLayout: { rows: number; cols: number } | null = null;
      let panelRects: PanelRect[] = [];
      let originalWidth = 0;
      let originalHeight = 0;

      if (report.kind === "png" || report.kind === "jpeg") {
        compositeDataUrl = await fileToDataUrl(file);
        setBusy("Detecting panels / image structure…");
        const result = await extractPanels(compositeDataUrl);
        images = result.images;
        gridInfo = `${result.grid.method} · ${result.grid.rows}×${result.grid.cols} · confidence: ${result.grid.confidence}`;
        overlayUrl = await renderPanelOverlay(compositeDataUrl, result.grid.panels);
        panelRects = result.originalPanels;
        originalWidth = result.originalWidth;
        originalHeight = result.originalHeight;
        // A genuine single-panel image needs no confirmation; a multi-panel
        // composite must be confirmed before analysis runs.
        gridConfirmed = result.grid.confirmed;
        if (result.grid.rows * result.grid.cols > 1) {
          autoLayout = { rows: result.grid.rows, cols: result.grid.cols };
        }
      } else if (report.kind !== "unknown") {
        setBusy("Extracting slices / frames…");
        images = await extractAll(file, report);
        gridInfo = `${report.structure} · ${images.length} extracted`;
      }

      setSessionState({
        file,
        previewUrl,
        report,
        compositeDataUrl,
        overlayUrl,
        images,
        gridInfo,
        gridConfirmed,
        autoLayout,
        panelRects,
        originalWidth,
        originalHeight,
      });
      setSessionStoreData(file, images, gridInfo, gridConfirmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "File inspection failed");
    } finally {
      setBusy(null);
    }
  }, []);

  /** Re-extract using an explicit rows×cols grid — controls actual cropping. */
  const applyGrid = useCallback(
    async (rows: number, cols: number) => {
      if (!session?.compositeDataUrl) return;
      const invalid = validateGridInput(rows, cols);
      if (invalid) {
        setError(invalid);
        return;
      }
      setError(null);
      try {
        setBusy(`Extracting ${rows}×${cols} grid (${rows * cols} panels)…`);
        const result = await extractPanels(session.compositeDataUrl, { rows, cols });
        const overlayUrl = await renderPanelOverlay(session.compositeDataUrl, result.grid.panels);
        setSessionState({
          ...session,
          images: result.images,
          overlayUrl,
          gridInfo: `manual ${rows}×${cols} grid · ${result.images.length} panels`,
          gridConfirmed: false,
          autoLayout: null,
          panelRects: result.originalPanels,
          originalWidth: result.originalWidth,
          originalHeight: result.originalHeight,
        });
        setSessionStoreData(session.file, result.images, `manual ${rows}×${cols} grid`, false);
        setEditingCrop(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Re-extraction failed");
      } finally {
        setBusy(null);
      }
    },
    [session],
  );

  /** Reset back to automatic detection. */
  const resetToAuto = useCallback(async () => {
    if (!session?.compositeDataUrl) return;
    setError(null);
    try {
      setBusy("Recalculating automatic detection…");
      const result = await extractPanels(session.compositeDataUrl);
      const overlayUrl = await renderPanelOverlay(session.compositeDataUrl, result.grid.panels);
      setSessionState({
        ...session,
        images: result.images,
        overlayUrl,
        gridInfo: `${result.grid.method} · ${result.grid.rows}×${result.grid.cols} · confidence: ${result.grid.confidence}`,
        gridConfirmed: result.grid.confirmed,
        autoLayout:
          result.grid.rows * result.grid.cols > 1
            ? { rows: result.grid.rows, cols: result.grid.cols }
            : null,
        panelRects: result.originalPanels,
        originalWidth: result.originalWidth,
        originalHeight: result.originalHeight,
      });
      setSessionStoreData(
        session.file,
        result.images,
        `${result.grid.method} · ${result.grid.rows}×${result.grid.cols}`,
        result.grid.confirmed,
      );
      setManualRows("");
      setManualCols("");
      setEditingCrop(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recalculation failed");
    } finally {
      setBusy(null);
    }
  }, [session]);

  const submitManualGrid = useCallback(() => {
    const rows = parseInt(manualRows, 10);
    const cols = parseInt(manualCols, 10);
    if (Number.isNaN(rows) || Number.isNaN(cols)) {
      setError("Enter whole numbers for rows and columns, e.g. 3 and 3.");
      return;
    }
    void applyGrid(rows, cols);
  }, [manualRows, applyGrid]);

  /** Manual crop correction for a single panel — pixels change, identity does not. */
  const applyCropCorrection = useCallback(
    async (imageId: string) => {
      if (!session?.compositeDataUrl) return;
      const img = session.images.find((im) => im.id === imageId);
      const rect = session.panelRects.find((p) => `img-${p.index}` === imageId);
      if (!img || !rect) {
        setError("Could not match the panel being corrected.");
        return;
      }
      const x = parseInt(cropDraft.x, 10);
      const y = parseInt(cropDraft.y, 10);
      const w = parseInt(cropDraft.w, 10);
      const h = parseInt(cropDraft.h, 10);
      if ([x, y, w, h].some((n) => Number.isNaN(n))) {
        setError("Crop coordinates must be whole numbers.");
        return;
      }
      try {
        setBusy(`Re-cropping panel ${rect.index + 1}…`);
        const corrected = await recropPanel(
          session.compositeDataUrl,
          { x, y, w, h },
          { panelIndex: rect.index, row: rect.row, col: rect.col },
        );
        const newImages = session.images.map((im) => (im.id === imageId ? corrected : im));
        const newRects = session.panelRects.map((p) =>
          p.index === rect.index ? { ...p, x, y, w, h } : p,
        );
        setSessionState({ ...session, images: newImages, panelRects: newRects });
        setSessionStoreData(session.file, newImages, session.gridInfo, session.gridConfirmed);
        setEditingCrop(null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Crop correction failed");
      } finally {
        setBusy(null);
      }
    },
    [session, cropDraft],
  );

  /** Confirm the current layout and persist — the only path into analysis. */
  const confirmAndContinue = useCallback(async () => {
    if (!session) return;
    if (!session.images.length) {
      setError("No valid images were extracted from this file.");
      return;
    }
    confirmGrid(true);
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
          gridConfirmed: true,
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
  const isComposite = (session?.panelRects.length ?? 0) > 1;

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
              </CardContent>
            </Card>

            {session.overlayUrl && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Grid confirmation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 rounded-lg border bg-[#F3F6F9] border-[#12355B]/15 text-sm text-[#263238]">
                    Multiple image panels detected. Please confirm the grid layout before analysis —
                    the selected layout controls the actual extraction, not just the displayed count.
                    {session.autoLayout && (
                      <span className="block mt-1 text-neutral-600">
                        Automatic detection suggests{" "}
                        <span className="font-semibold">
                          {session.autoLayout.rows}×{session.autoLayout.cols}
                        </span>{" "}
                        ({session.autoLayout.rows * session.autoLayout.cols} panels) but is not certain.
                      </span>
                    )}
                  </div>

                  <img
                    src={session.overlayUrl}
                    alt="Panel boundaries over the original image"
                    className="w-full rounded-lg border border-neutral-200"
                  />

                  <div className="space-y-3">
                    <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                      Select a layout
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {LAYOUT_CHIPS.map(({ rows, cols }) => (
                        <button
                          key={`${rows}x${cols}`}
                          onClick={() => void applyGrid(rows, cols)}
                          disabled={busy !== null}
                          className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                            session.gridInfo?.includes(`manual ${rows}×${cols}`)
                              ? "bg-[#008C95] text-white border-[#008C95]"
                              : "bg-white text-neutral-700 border-neutral-300 hover:border-[#008C95] hover:text-[#008C95]"
                          } disabled:opacity-50`}
                        >
                          {rows}×{cols}
                          <span className="ml-1 text-xs opacity-70">({rows * cols})</span>
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-end gap-3 pt-1">
                      <div>
                        <label className="text-xs text-neutral-500 block mb-1">
                          Custom layout (rows × columns, up to {MAX_GRID_DIM}×{MAX_GRID_DIM})
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            value={manualRows}
                            onChange={(e) => setManualRows(e.target.value.replace(/[^\d]/g, ""))}
                            placeholder="rows"
                            inputMode="numeric"
                            className="border border-neutral-300 rounded-md px-3 py-2 text-sm w-20"
                          />
                          <span className="text-neutral-500">×</span>
                          <input
                            value={manualCols}
                            onChange={(e) => setManualCols(e.target.value.replace(/[^\d]/g, ""))}
                            placeholder="cols"
                            inputMode="numeric"
                            className="border border-neutral-300 rounded-md px-3 py-2 text-sm w-20"
                          />
                          <Button
                            variant="outline"
                            className="border-neutral-300"
                            onClick={submitManualGrid}
                            disabled={busy !== null || !manualRows || !manualCols}
                          >
                            Recalculate
                          </Button>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        className="border-neutral-300"
                        onClick={() => void resetToAuto()}
                        disabled={busy !== null}
                      >
                        <RotateCcw className="w-4 h-4 mr-1" /> Reset
                      </Button>
                    </div>

                    {isComposite && !session.gridConfirmed && (
                      <div className="p-3 rounded-lg border bg-[#E58A2B]/5 border-[#E58A2B]/30 text-sm text-[#B36A1D] flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>
                          The current layout has not been confirmed. Analysis stays locked until you
                          verify the {session.images.length} extracted panel
                          {session.images.length === 1 ? "" : "s"} below.
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {session.panelRects.length > 1 && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Crop coordinates</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200">
                          <th className="py-2 pr-4">Panel</th>
                          <th className="py-2 pr-4">Grid position</th>
                          <th className="py-2 pr-4">X, Y</th>
                          <th className="py-2 pr-4">Width × Height</th>
                          <th className="py-2">Correction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.panelRects.map((p) => {
                          const imageId = `img-${p.index}`;
                          const isEditing = editingCrop === imageId;
                          return (
                            <tr key={imageId} className="border-b border-neutral-100">
                              <td className="py-2 pr-4 font-medium text-neutral-800">
                                #{p.index + 1}
                              </td>
                              <td className="py-2 pr-4 text-neutral-600">
                                row {p.row + 1}, col {p.col + 1}
                              </td>
                              <td className="py-2 pr-4 text-neutral-600 font-mono text-xs">
                                {p.x}, {p.y}
                              </td>
                              <td className="py-2 pr-4 text-neutral-600 font-mono text-xs">
                                {p.w} × {p.h}
                              </td>
                              <td className="py-2">
                                <button
                                  onClick={() => {
                                    setEditingCrop(isEditing ? null : imageId);
                                    setCropDraft({ x: String(p.x), y: String(p.y), w: String(p.w), h: String(p.h) });
                                  }}
                                  className="text-[#008C95] hover:underline text-xs inline-flex items-center gap-1"
                                >
                                  <Crop className="w-3.5 h-3.5" /> Adjust
                                </button>
                                {isEditing && (
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {(["x", "y", "w", "h"] as const).map((k) => (
                                      <input
                                        key={k}
                                        value={cropDraft[k]}
                                        onChange={(e) =>
                                          setCropDraft((d) => ({ ...d, [k]: e.target.value.replace(/[^\d]/g, "") }))
                                        }
                                        placeholder={k}
                                        inputMode="numeric"
                                        className="border border-neutral-300 rounded px-2 py-1 text-xs w-16"
                                      />
                                    ))}
                                    <Button
                                      size="sm"
                                      className="bg-[#008C95] hover:bg-[#00767e] h-7 px-2 text-xs"
                                      onClick={() => void applyCropCorrection(imageId)}
                                      disabled={busy !== null}
                                    >
                                      Apply
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => setEditingCrop(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-neutral-500 mt-3">
                    Coordinates are in original image pixels ({session.originalWidth} ×{" "}
                    {session.originalHeight}). Corrections re-crop only the selected panel and keep
                    its image ID, panel number, and grid position unchanged.
                  </p>
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

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="border-neutral-300" onClick={() => setSessionState(null)}>
                <X className="w-4 h-4 mr-1" /> Choose a different file
              </Button>
              {isComposite && !session.gridConfirmed ? (
                <Button
                  onClick={() => void confirmAndContinue()}
                  disabled={busy !== null || !session.images.length}
                  className="bg-[#2E8B57] hover:bg-[#257349]"
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Confirm extraction ({session.images.length} panel
                  {session.images.length === 1 ? "" : "s"}) &amp; continue
                </Button>
              ) : (
                <Button
                  onClick={() => void confirmAndContinue()}
                  disabled={busy !== null || !session.images.length}
                  className="bg-[#12355B] hover:bg-[#1a4570]"
                >
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                  Continue with {session.images.length} extracted image{session.images.length === 1 ? "" : "s"}
                </Button>
              )}
            </div>
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
    case "composite-panel": return `panel ${source.panelIndex + 1} (row ${source.row + 1}, col ${source.col + 1})`;
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
function setSessionStoreData(file: File, images: ExtractedImage[], gridInfo: string | null, gridConfirmed: boolean) {
  setSession({
    file,
    images,
    modelName: "demo-pixel-stats-v1",
    formulaVersion: "OFI_res-v1.0",
    gridInfo,
    gridConfirmed,
  });
}
