import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Ruler,
  ChevronLeft,
  Info,
  AlertTriangle,
  Upload,
  RefreshCw,
  Download,
  CheckCircle,
} from "lucide-react";
import { getSession } from "@/lib/imaging/sessionStore";
import { OFI_FORMULA_VERSION } from "@/lib/imaging/fragility";
import type { ImageAnalysis } from "@/lib/imaging/types";

/** One matched per-image data point for the Fragility vs. Tumor analysis. */
interface FragilityPoint {
  imageId: string;
  ofiValue: number;
  saliencyCoverage: number;
  tumorMeasurement: number | null;
}

function describeSource(source: ImageAnalysis extends never ? never : never): string {
  return "";
}

export default function Evaluation() {
  const navigate = useNavigate();

  const [rmaResult, setRmaResult] = useState<{
    rmaScore: number | null;
    hasGroundTruth: boolean;
    precision: number | null;
    recall: number | null;
    f1Score: number | null;
  } | null>(null);

  const [fragilityPoints, setFragilityPoints] = useState<FragilityPoint[] | null>(null);
  const [gamRan, setGamRan] = useState(false);

  const session = getSession();
  const analyses = session?.analyses ?? new Map<string, ImageAnalysis>();
  const doneAnalyses = useMemo(
    () => [...analyses.values()].filter((a) => a.status === "done" && a.ofi),
    [analyses],
  );

  const runRMAEvaluation = () => {
    setRmaResult({
      rmaScore: null,
      hasGroundTruth: false,
      precision: null,
      recall: null,
      f1Score: null,
    });
  };

  /**
   * Fragility vs. Tumor — matched strictly by image ID. Tumour measurements
   * (volume, area, grade) do not exist in this build: no segmentation model or
   * annotations are available, so the tumour axis is always reported missing
   * rather than fabricated. The OFI_res axis uses real session values.
   */
  const runFragilityVsTumor = () => {
    setGamRan(true);
    const points: FragilityPoint[] = [];
    for (const a of doneAnalyses) {
      if (!a.ofi) continue;
      points.push({
        imageId: a.imageId,
        ofiValue: a.ofi.value,
        saliencyCoverage: a.saliency?.coverage ?? 0,
        tumorMeasurement: null, // no validated tumour measurement exists
      });
    }
    setFragilityPoints(points);
  };

  const hasOfiData = doneAnalyses.length > 0;

  /** Build the CSV of real session results for export. */
  const exportCsv = () => {
    const esc = (v: string | number | null | undefined) => {
      const s = v === null || v === undefined ? "" : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = [
      "image_id",
      "predicted_class",
      "original_confidence",
      "perturbed_confidence",
      "confidence_change",
      "ofi_res",
      "ofi_formula_version",
      "ofi_status",
      "saliency_coverage",
      "analysis_status",
    ];
    const rows = [...analyses.values()].map((a) =>
      [
        a.imageId,
        a.prediction?.predictedClass ?? "",
        a.prediction?.confidence ?? "",
        a.perturbedPrediction?.confidence ?? "",
        a.ofi?.confidenceChange ?? "",
        a.ofi?.value ?? "",
        a.ofi?.formulaVersion ?? "",
        a.ofi ? (a.ofi.unreliable ? "unreliable" : "computed") : "not computed",
        a.saliency?.coverage ?? "",
        a.status,
      ]
        .map(esc)
        .join(","),
    );
    downloadFile(
      "braintrust-evaluation.csv",
      `${header.map(esc).join(",")}\n${rows.join("\n")}\n`,
      "text/csv",
    );
  };

  const exportJson = () => {
    downloadFile(
      "braintrust-evaluation.json",
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          formulaVersion: OFI_FORMULA_VERSION,
          note: "Research export from BrainTrust AI demo mode. OFI_res is an experimental model-output fragility measure, not a clinically validated standard.",
          images: [...analyses.values()].map((a) => ({
            imageId: a.imageId,
            status: a.status,
            prediction: a.prediction,
            perturbedPrediction: a.perturbedPrediction,
            ofi: a.ofi,
            saliencyCoverage: a.saliency?.coverage ?? null,
          })),
        },
        null,
        2,
      ),
      "application/json",
    );
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
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
              <h1 className="font-semibold text-[#12355B]">Evaluate</h1>
              <p className="text-xs text-neutral-500">Deepen your understanding of model behavior</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#12355B]/10 text-[#12355B] rounded">
            Demo Mode
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Warning Banner */}
        <div className="mb-8 p-4 bg-[#E58A2B]/10 border border-[#E58A2B]/30 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[#E58A2B]">Evaluation Limitations</p>
            <p className="text-sm text-neutral-600 mt-1">
              RMA and other spatial metrics can only be calculated when ground-truth
              segmentation masks are available. Fragility vs. Tumor analysis additionally
              requires validated tumour measurements, which this build does not have.
            </p>
          </div>
        </div>

        {/* RMA Section */}
        <Card className="border-neutral-200 mb-8">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Ruler className="w-5 h-5 text-[#12355B]" />
              <CardTitle className="text-lg">Relevance Mass Accuracy (RMA)</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-neutral-600 mb-4">
                  RMA evaluates how well saliency maps match ground-truth segmentation masks.
                  Upload a ground-truth mask (BraTS format) for meaningful results.
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="border-neutral-300"
                    onClick={() => document.getElementById("rma-mask")?.click()}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Ground Truth
                  </Button>
                  <Button
                    onClick={runRMAEvaluation}
                    className="bg-[#12355B] hover:bg-[#1a4570]"
                  >
                    Run RMA
                  </Button>
                </div>
                <input
                  id="rma-mask"
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  className="hidden"
                  onChange={runRMAEvaluation}
                />
              </div>
              <div>
                {rmaResult && !rmaResult.hasGroundTruth ? (
                  <div className="p-4 bg-[#E58A2B]/5 border border-[#E58A2B]/25 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-[#E58A2B]">Missing Ground-Truth Data</p>
                        <p className="text-sm text-neutral-600 mt-1">
                          RMA evaluation requires ground-truth segmentation masks (e.g., BraTS
                          format) to compare against the saliency maps. Without them, RMA cannot
                          be meaningfully computed — no score is shown rather than an invented one.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : rmaResult && rmaResult.hasGroundTruth ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-[#12355B]/5 rounded-lg border border-[#12355B]/20">
                      <p className="text-sm text-neutral-600 mb-1">RMA Score</p>
                      <p className={`text-3xl font-bold ${rmaResult.rmaScore && rmaResult.rmaScore > 0.7 ? "text-[#2E8B57]" : rmaResult.rmaScore && rmaResult.rmaScore > 0.5 ? "text-[#E58A2B]" : "text-red-600"}`}>
                        {rmaResult.rmaScore?.toFixed(4) || "N/A"}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-neutral-50 rounded-lg"><p className="text-xs text-neutral-500">Precision</p><p className="text-lg font-semibold">{rmaResult.precision?.toFixed(3) || "—"}</p></div>
                      <div className="p-3 bg-neutral-50 rounded-lg"><p className="text-xs text-neutral-500">Recall</p><p className="text-lg font-semibold">{rmaResult.recall?.toFixed(3) || "—"}</p></div>
                      <div className="p-3 bg-neutral-50 rounded-lg"><p className="text-xs text-neutral-500">F1 Score</p><p className="text-lg font-semibold">{rmaResult.f1Score?.toFixed(3) || "—"}</p></div>
                      <div className="p-3 bg-neutral-50 rounded-lg"><p className="text-xs text-neutral-500">Ground Truth</p><p className={`text-lg font-semibold ${rmaResult.hasGroundTruth ? "text-[#2E8B57]" : "text-neutral-400"}`}>{rmaResult.hasGroundTruth ? "Available" : "Not provided"}</p></div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 bg-neutral-50 rounded-lg border border-dashed border-neutral-300">
                    <p className="text-neutral-500">Run RMA evaluation to see results</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fragility vs. Tumor / GAM Analysis Section */}
        <Card className="border-neutral-200 mb-8">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-[#008C95]" />
              <CardTitle className="text-lg">Fragility vs. Tumor (GAM)</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-neutral-600 mb-4">
                  This analysis models the relationship between tumour characteristics
                  (e.g., volume) and output fragility (OFI<sub>res</sub>). It requires BOTH:
                  completed per-image OFI<sub>res</sub> results from the analysis session AND
                  valid tumour measurements (volume, area, or grade) from a validated source.
                </p>
                <Button
                  onClick={runFragilityVsTumor}
                  className="bg-[#008C95] hover:bg-[#00a3a3]"
                >
                  Run Fragility vs. Tumor Analysis
                </Button>
                {hasOfiData && (
                  <p className="text-xs text-[#2E8B57] mt-3 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {doneAnalyses.length} completed OFI<sub>res</sub> result
                    {doneAnalyses.length === 1 ? "" : "s"} found in the current session.
                  </p>
                )}
              </div>
              <div>
                {gamRan && !hasOfiData ? (
                  <div className="p-4 bg-[#E58A2B]/5 border border-[#E58A2B]/25 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-[#E58A2B]">Insufficient Data for Fragility vs. Tumor Analysis</p>
                        <p className="text-sm text-neutral-600 mt-1">
                          Fragility vs. Tumor analysis requires valid tumor measurements and
                          completed OFI<sub>res</sub> results.
                        </p>
                        <ul className="text-sm text-neutral-600 mt-1 list-disc pl-5">
                          <li>OFI<sub>res</sub> results: <span className="font-medium text-[#E58A2B]">missing</span> — run the multi-image analysis first</li>
                          <li>Tumour measurements (volume, area, grade): <span className="font-medium text-[#E58A2B]">unavailable</span> — no validated segmentation model or annotations exist in this build</li>
                        </ul>
                        <p className="text-sm text-neutral-600 mt-1">
                          Because one required axis is entirely unavailable, no chart is shown —
                          a fabricated plot would be misleading.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : gamRan && fragilityPoints ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-[#E58A2B]/5 border border-[#E58A2B]/25 rounded-lg">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-[#E58A2B]">OFI_res axis available — tumour axis missing</p>
                          <p className="text-sm text-neutral-600 mt-1">
                            {fragilityPoints.length} image
                            {fragilityPoints.length === 1 ? "" : "s"} matched by image ID with
                            valid OFI<sub>res</sub> ({OFI_FORMULA_VERSION}). No valid tumour
                            measurements exist for any of them, so the relationship cannot be
                            modelled and no GAM is fitted. A GAM on illustrative data would not
                            be shown here as a real result.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 bg-[#F3F6F9] rounded-lg border border-[#12355B]/10">
                      <p className="text-xs font-medium text-neutral-700 mb-2">
                        Per-image OFI<sub>res</sub> values retrieved (real session data)
                      </p>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {fragilityPoints.map((p) => (
                          <div key={p.imageId} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-neutral-600">{p.imageId}</span>
                            <span className="font-medium text-neutral-800">
                              OFI<sub>res</sub> {p.ofiValue.toFixed(3)}
                              {p.saliencyCoverage > 0 && (
                                <span className="text-neutral-400 ml-2">
                                  saliency {p.saliencyCoverage.toFixed(1)}%
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 bg-neutral-50 rounded-lg border border-dashed border-neutral-300">
                    <p className="text-neutral-500">Run Fragility vs. Tumor analysis to see results</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cascading Weight Randomization */}
        <Card className="border-neutral-200 mb-8">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Cascading Weight Randomization Sanity Check</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-neutral-600 mb-4">
                  This sanity check validates that the model's predictions depend on
                  meaningful features by progressively randomizing weights and measuring
                  the degradation in performance. It requires the trained desktop backend
                  with a valid checkpoint and is not available in browser demo mode.
                </p>
                <Button variant="outline" className="border-neutral-300" disabled>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Run Sanity Check
                </Button>
                <p className="text-xs text-[#E58A2B] mt-2">
                  Not available: requires the trained backend checkpoint.
                </p>
              </div>
              <div>
                <div className="h-32 bg-neutral-50 rounded-lg border border-dashed border-neutral-300 flex items-center justify-center">
                  <p className="text-neutral-500">Requires trained backend — unavailable in demo mode</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Export Section */}
        <Card className="border-neutral-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Export Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Button variant="outline" className="border-neutral-300" onClick={exportCsv} disabled={!analyses.size}>
                <Download className="w-4 h-4 mr-2" />
                Export to CSV
              </Button>
              <Button variant="outline" className="border-neutral-300" onClick={exportJson} disabled={!analyses.size}>
                <Download className="w-4 h-4 mr-2" />
                Export to JSON
              </Button>
            </div>
            <p className="text-xs text-neutral-500 mt-3">
              {analyses.size
                ? `Exports the ${analyses.size} per-image analysis record${analyses.size === 1 ? "" : "s"} from the current session (matched by image ID).`
                : "Run the multi-image analysis first — exports are disabled until session data exists."}
            </p>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-neutral-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-neutral-600">
              All evaluation metrics come from the demo-mode surrogate model. OFI<sub>res</sub> is
              an experimental model-output fragility measure, not a clinically validated standard.
              Real evaluation requires properly labeled datasets and validated models.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
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
