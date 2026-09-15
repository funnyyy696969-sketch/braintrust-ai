import { useState } from "react";
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
} from "lucide-react";

export default function Evaluation() {
  const navigate = useNavigate();
  const [rmaResult, setRmaResult] = useState<{
    rmaScore: number | null;
    hasGroundTruth: boolean;
    precision: number | null;
    recall: number | null;
    f1Score: number | null;
  } | null>(null);

  const [gamResult, setGamResult] = useState<{
    summary: string;
    devianceExplained: number;
    gcvScore: number;
  } | null>(null);

  const [gamMissingData, setGamMissingData] = useState(false);
  const [missingDataWarning, setMissingDataWarning] = useState(false);

  const [needsGroundTruthWarning, setNeedsGroundTruthWarning] = useState(false);

  const runRMAEvaluation = async () => {
    setMissingDataWarning(true);
    setRmaResult({
      rmaScore: null,
      hasGroundTruth: false,
      precision: null,
      recall: null,
      f1Score: null,
    });
  };

  const runGAMAnalysis = async () => {
    setGamResult(null);
    setGamMissingData(true);
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
              segmentation masks are available. This demo uses simulated data.
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
                  onChange={() => {
                    // In real implementation, handle file upload
                    runRMAEvaluation();
                  }}
                />
              </div>
              <div>
                {missingDataWarning && !rmaResult?.hasGroundTruth ? (
                  <div className="p-4 bg-[#E58A2B]/5 border border-[#E58A2B]/25 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-[#E58A2B]">Missing Ground-Truth Data</p>
                        <p className="text-sm text-neutral-600 mt-1">
                          Fragility vs. Tumor analysis requires valid tumor measurements and
                          completed OFI_res results. RMA evaluation requires ground-truth
                          segmentation masks (e.g., BraTS format) to compare against the
                          saliency maps.
                        </p>
                        <p className="text-sm text-neutral-600 mt-1">
                          Without ground-truth masks, RMA cannot be meaningfully computed.
                          Upload a ground-truth mask or run the full pipeline first.
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

        {/* GAM Analysis Section */}
        <Card className="border-neutral-200 mb-8">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-[#008C95]" />
              <CardTitle className="text-lg">Generalized Additive Model (GAM) Analysis</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-neutral-600 mb-4">
                  GAM analysis models the relationship between tumor characteristics
                  (e.g., volume) and output fragility. It can reveal non-linear
                  associations that linear models might miss.
                </p>
                <Button
                  onClick={runGAMAnalysis}
                  className="bg-[#008C95] hover:bg-[#00a3a3]"
                >
                  Run GAM Analysis
                </Button>
              </div>
              <div>
                {gamMissingData ? (
                  <div className="p-4 bg-[#E58A2B]/5 border border-[#E58A2B]/25 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-[#E58A2B]">Insufficient Data for GAM Analysis</p>
                        <p className="text-sm text-neutral-600 mt-1">
                          GAM analysis requires:
                        </p>
                        <ul className="text-sm text-neutral-600 mt-1 list-disc pl-5">
                          <li>Valid OFI_res results from completed image analyses</li>
                          <li>Tumor measurements (volume, area, or other quantitative data)</li>
                          <li>Sufficient data points for reliable smooth function fitting</li>
                        </ul>
                        <p className="text-sm text-neutral-600 mt-1">
                          Without these, GAM cannot be fitted. Run the multi-image analysis
                          pipeline first, then provide tumor measurements if available.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : gamResult ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-[#008C95]/5 rounded-lg border border-[#008C95]/20">
                      <p className="text-sm text-neutral-600 mb-2">Model Summary</p>
                      <p className="text-sm text-neutral-900 leading-relaxed">
                        {gamResult.summary}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-neutral-50 rounded-lg">
                        <p className="text-xs text-neutral-500">Deviance Explained</p>
                        <p className="text-lg font-semibold text-[#008C95]">{(gamResult.devianceExplained * 100).toFixed(1)}%</p>
                      </div>
                      <div className="p-3 bg-neutral-50 rounded-lg">
                        <p className="text-xs text-neutral-500">GCV Score</p>
                        <p className="text-lg font-semibold">{gamResult.gcvScore.toFixed(3)}</p>
                      </div>
                    </div>
                    <div className="p-3 bg-neutral-100 rounded-lg">
                      <p className="text-xs text-neutral-500 mb-1">Formula</p>
                      <p className="text-sm font-mono">g(E[OFI_res]) = β₀ + f₁(volume) + ε</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 bg-neutral-50 rounded-lg border border-dashed border-neutral-300">
                    <p className="text-neutral-500">Run GAM analysis to see results</p>
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
                  the degradation in performance.
                </p>
                <div className="space-y-2">
                  <Button variant="outline" className="border-neutral-300 w-full justify-start">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Run Sanity Check
                  </Button>
                  <p className="text-xs text-neutral-500">No ground-truth needed for this check</p>
                </div>
              </div>
              <div>
                <div className="h-32 bg-neutral-50 rounded-lg border border-dashed border-neutral-300 flex items-center justify-center">
                  <p className="text-neutral-500">Sanity check results will appear here</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tumor Volume vs Fragility Visualization */}
        <Card className="border-neutral-200 mb-8">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Tumor Volume vs. Fragility Visualization</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 bg-neutral-50 rounded-lg border border-dashed border-neutral-300 flex items-center justify-center">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
                <p className="text-neutral-500">Visualization requires evaluation data</p>
                <p className="text-xs text-neutral-400 mt-1">
                  Run GAM analysis with tumor volume and fragility data to generate plot
                </p>
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
              <Button variant="outline" className="border-neutral-300">
                Export to CSV
              </Button>
              <Button variant="outline" className="border-neutral-300">
                Export to JSON
              </Button>
              <Button variant="outline" className="border-neutral-300">
                Export Report PDF
              </Button>
            </div>
            <p className="text-xs text-neutral-500 mt-3">
              Export current evaluation results for further analysis or reporting.
            </p>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-neutral-600">
              All evaluation metrics shown are from demo mode with simulated data.
              Real evaluation requires properly labeled datasets and validated models.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
