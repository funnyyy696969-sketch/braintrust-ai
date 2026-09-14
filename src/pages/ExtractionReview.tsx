import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  Check,
  X,
  Grid3x3,
  Loader2,
  Save,
} from "lucide-react";
import { extractPanels } from "@/lib/imaging/compositeDetection";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Image Extraction Review — inspect every extracted image before analysis,
 * reject bad crops, and correct the grid manually when detection is unsure.
 */
export default function ExtractionReview() {
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
  const setReview = useMutation(api.scans.setReviewStatus);
  const logCorrection = useMutation(api.scans.logManualCorrection);

  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [manualGrid, setManualGrid] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const toggle = useCallback(
    (imageId: string) => {
      setRejected((prev) => {
        const next = new Set(prev);
        if (next.has(imageId)) next.delete(imageId);
        else next.add(imageId);
        return next;
      });
    },
    [],
  );

  const saveReviews = useCallback(async () => {
    if (!scanId) return;
    setBusy(true);
    try {
      for (const id of rejected) {
        await setReview({ scanId: scanId as Id<"scans">, imageId: id, reviewStatus: "rejected" });
      }
      if (rejected.size) {
        await logCorrection({
          scanId: scanId as Id<"scans">,
          detail: `Reviewer rejected ${rejected.size} image(s): ${[...rejected].join(", ")}`,
        });
      }
      navigate(`/analysis/${scanId}`);
    } finally {
      setBusy(false);
    }
  }, [scanId, rejected, setReview, logCorrection, navigate]);

  const reExtract = useCallback(async () => {
    setNote("Manual grid re-extraction starts from the Upload page, where the original file is still in memory.");
  }, []);

  const acceptedCount = (dbImages?.length ?? 0) - rejected.size;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(scanId ? `/analysis/${scanId}` : "/dashboard")} className="text-neutral-600 hover:text-neutral-900 p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="font-semibold text-[#12355B]">Image Extraction Review</h1>
              <p className="text-xs text-neutral-500">
                {scan?.fileName ?? "Loading…"} · {acceptedCount} of {dbImages?.length ?? 0} accepted
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="bg-[#12355B] hover:bg-[#1a4570]"
            disabled={busy || !dbImages?.length}
            onClick={saveReviews}
          >
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Confirm &amp; continue
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <Card className="border-neutral-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Grid3x3 className="w-5 h-5 text-[#008C95]" />
              Review extracted images
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-neutral-600">
              Click a thumbnail to reject a bad crop (e.g. a panel that caught a label bar or a
              gutter). Rejected images are excluded from analysis and recorded in the audit log.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">
                  Detection looked wrong? Re-run with a forced grid
                </label>
                <div className="flex gap-2">
                  <input
                    value={manualGrid}
                    onChange={(e) => setManualGrid(e.target.value)}
                    placeholder="e.g. 2x2"
                    className="border border-neutral-300 rounded-md px-3 py-2 text-sm w-32"
                  />
                  <Button variant="outline" className="border-neutral-300" onClick={reExtract}>
                    Re-extract
                  </Button>
                </div>
              </div>
            </div>

            {note && <p className="text-xs text-[#B36A1D]">{note}</p>}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {dbImages?.map((im) => {
                const isRejected = rejected.has(im.imageId);
                return (
                  <button
                    key={im._id}
                    onClick={() => toggle(im.imageId)}
                    className={`text-left rounded-lg overflow-hidden border-2 transition-all ${
                      isRejected
                        ? "border-red-300 opacity-50"
                        : "border-neutral-200 hover:border-[#008C95]"
                    }`}
                  >
                    <div className="bg-neutral-50 h-24 flex items-center justify-center text-neutral-300">
                      <Grid3x3 className="w-6 h-6" />
                    </div>
                    <div className="p-2 text-xs">
                      <p className="font-medium text-neutral-800 flex items-center justify-between">
                        {im.imageId}
                        {isRejected ? (
                          <X className="w-3.5 h-3.5 text-red-500" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-[#2E8B57]" />
                        )}
                      </p>
                      <p className="text-neutral-500">{im.width} × {im.height}</p>
                      <p className="text-neutral-400">{im.sourceDetail}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="text-xs text-neutral-400">
              Thumbnails are structural placeholders here — pixel previews stay in the browser
              session and are visible on the analysis page.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
