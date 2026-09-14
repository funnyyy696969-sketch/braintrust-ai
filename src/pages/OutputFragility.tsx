import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  ChevronLeft,
  Calculator,
  TrendingDown,
  TrendingUp,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface OutputFragilityState {
  originalPrediction: {
    predictedClass: string;
    confidence: number;
    probabilities: Record<string, number>;
  } | null;
  perturbedPrediction: {
    predictedClass: string;
    confidence: number;
    probabilities: Record<string, number>;
  } | null;
  ofiResult: {
    ofiValue: number;
    confidenceChange: number;
    formulaVersion: string;
    explanation: string;
  } | null;
  isProcessing: boolean;
  error: string | null;
}

export default function OutputFragility() {
  const navigate = useNavigate();
  const [state, setState] = useState<OutputFragilityState>({
    originalPrediction: null,
    perturbedPrediction: null,
    ofiResult: null,
    isProcessing: false,
    error: null,
  });

  const runAnalysis = async () => {
    setState((prev) => ({ ...prev, isProcessing: true, error: null }));

    try {
      // Simulate original prediction
      const originalConf = 0.85 + Math.random() * 0.1;
      const perturbedConf = originalConf - (0.02 + Math.random() * 0.15);

      const originalPred = {
        predictedClass: "Glioma",
        confidence: originalConf,
        probabilities: {
          "No Tumor": 0.05 + Math.random() * 0.1,
          Glioma: originalConf,
          Meningioma: 0.05 + Math.random() * 0.1,
          "Pituitary Tumor": 0.05 + Math.random() * 0.1,
        },
      };

      const perturbedPred = {
        predictedClass: Math.random() > 0.3 ? "Glioma" : "Meningioma",
        confidence: Math.max(0.3, perturbedConf),
        probabilities: {
          "No Tumor": 0.05 + Math.random() * 0.15,
          Glioma: Math.random() * 0.4,
          Meningioma: 0.3 + Math.random() * 0.3,
          "Pituitary Tumor": 0.05 + Math.random() * 0.15,
        },
      };

      // Calculate OFI_res
      const ofiValue = Math.abs(originalConf - perturbedConf);
      const confidenceChange = originalConf - perturbedConf;

      setState({
        originalPrediction: originalPred,
        perturbedPrediction: perturbedPred,
        ofiResult: {
          ofiValue,
          confidenceChange,
          formulaVersion: "1.0.0",
          explanation: `OFI_res measures the absolute change in model confidence: |${originalConf.toFixed(3)} - ${perturbedConf.toFixed(3)}| = ${ofiValue.toFixed(3)}. Higher values indicate greater fragility.`,
        },
        isProcessing: false,
        error: null,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: err instanceof Error ? err.message : "Analysis failed",
      }));
    }
  };

  const getConfidenceChangeIcon = () => {
    if (state.ofiResult) {
      if (state.ofiResult.confidenceChange > 0) {
        return <TrendingDown className="w-5 h-5 text-[#E58A2B]" />;
      } else if (state.ofiResult.confidenceChange < 0) {
        return <TrendingUp className="w-5 h-5 text-[#2E8B57]" />;
      }
    }
    return null;
  };

  const getOFIValueColor = () => {
    if (!state.ofiResult) return "text-neutral-900";
    const value = state.ofiResult.ofiValue;
    if (value < 0.05) return "text-[#2E8B57]";
    if (value < 0.1) return "text-[#E58A2B]";
    return "text-red-600";
  };

  const formatConfidence = (val: number) => `${(val * 100).toFixed(1)}%`;

  // Prepare chart data
  const chartData = state.originalPrediction && state.perturbedPrediction
    ? Object.keys(state.originalPrediction!.probabilities).map((className) => ({
        name: className,
        original: state.originalPrediction!.probabilities[className] || 0,
        perturbed: state.perturbedPrediction!.probabilities[className] || 0,
      }))
    : [];

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
              <h1 className="font-semibold text-[#12355B]">Fragility</h1>
              <p className="text-xs text-neutral-500">How much does the prediction change?</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#2E8B57]/10 text-[#2E8B57] rounded">
            Statistical Analysis
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Run Button */}
        {!state.originalPrediction ? (
          <Card className="border-neutral-200 mb-8">
            <CardContent className="pt-8 pb-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#2E8B57]/10 flex items-center justify-center">
                <Calculator className="w-8 h-8 text-[#2E8B57]" />
              </div>
              <h2 className="text-xl font-semibold text-[#12355B] mb-2">
                Measure Prediction Stability
              </h2>
              <p className="text-neutral-600 mb-6 max-w-md mx-auto">
                See how much the model's confidence changes when you perturb the scan.
                A stable prediction is more trustworthy — a fragile one is not.
              </p>
              <Button
                onClick={runAnalysis}
                disabled={state.isProcessing}
                className="bg-[#2E8B57] hover:bg-[#38a068] px-8"
              >
                {state.isProcessing ? (
                  <>
                    <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Calculator className="w-4 h-4 mr-2" />
                    Run Fragility Analysis
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* OFI_res Result Card */}
            <Card className="border-[#2E8B57]/30 bg-[#2E8B57]/5">
              <CardContent className="pt-6 pb-6">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-3 mb-3">
                    <span className="text-sm text-neutral-600">OFI_res Value:</span>
                    <span className={`text-4xl font-bold ${getOFIValueColor()}`}>
                      {state.ofiResult?.ofiValue.toFixed(4)}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-600 mb-4">
                    Output Fragility Index (residual) — Formula v{state.ofiResult?.formulaVersion}
                  </p>
                  <div className="flex justify-center">
                    {getConfidenceChangeIcon()}
                    <span className="text-sm text-neutral-600 ml-2">
                      Confidence Change:{" "}
                      <span className={state.ofiResult!.confidenceChange > 0 ? "text-[#E58A2B]" : "text-[#2E8B57]"}>
                        {(state.ofiResult!.confidenceChange * 100).toFixed(1)}%
                      </span>
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Original vs Perturbed */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Original Prediction */}
              <Card className="border-neutral-200">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-lg bg-[#12355B]/10 flex items-center justify-center">
                      <span className="text-[#12355B]">1</span>
                    </div>
                    <CardTitle className="text-lg">Original Prediction</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-neutral-600">Predicted Class</p>
                      <p className="text-xl font-semibold text-[#12355B]">
                        {state.originalPrediction?.predictedClass}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-neutral-600">Confidence</p>
                      <p className="text-2xl font-semibold text-[#008C95]">
                        {formatConfidence(state.originalPrediction!.confidence)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Perturbed Prediction */}
              <Card className="border-neutral-200">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-lg bg-[#E58A2B]/10 flex items-center justify-center">
                      <span className="text-[#E58A2B]">2</span>
                    </div>
                    <CardTitle className="text-lg">Perturbed Prediction</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-neutral-600">Predicted Class</p>
                      <p className="text-xl font-semibold text-[#12355B]">
                        {state.perturbedPrediction?.predictedClass}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-neutral-600">Confidence</p>
                      <p className="text-2xl font-semibold text-[#E58A2B]">
                        {formatConfidence(state.perturbedPrediction!.confidence)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Comparison Chart */}
            {chartData.length > 0 && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">How the Probabilities Shifted</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: "#6b7280", fontSize: 12 }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fill: "#6b7280", fontSize: 12 }}
                          tickLine={false}
                          tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                        />
                        <Tooltip
                          formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, undefined]}
                          contentStyle={{
                            backgroundColor: "white",
                            border: "1px solid #e5e7eb",
                            borderRadius: "8px",
                            fontSize: "13px",
                          }}
                        />
                        <Legend />
                        <Bar dataKey="original" fill="#12355B" radius={[4, 4, 0, 0]} name="Original" />
                        <Bar dataKey="perturbed" fill="#E58A2B" radius={[4, 4, 0, 0]} name="Perturbed" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Explanation */}
            {state.ofiResult?.explanation && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2">
                    <Info className="w-5 h-5 text-[#2E8B57]" />
                    <CardTitle className="text-lg">What OFI_res Means</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-neutral-600 leading-relaxed">
                    {state.ofiResult.explanation}
                  </p>
                  <div className="mt-4 p-3 bg-neutral-50 rounded-lg border border-neutral-200">
                    <p className="text-xs text-neutral-500">
                      <strong>Formula:</strong> OFI_res = |C_original - C_perturbed|
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      This measures how much the model's confidence changes when the input
                      is perturbed. Higher values indicate greater output fragility.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Disclaimer */}
            <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-neutral-600">
                <span className="font-medium">For research use. </span>
                OFI_res helps you understand if the model is relying on robust features.
                A high value means the prediction is fragile. A low value means it is stable.
              </p>
              </div>
            </div>
          </div>
        )}

        {state.error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{state.error}</p>
          </div>
        )}
      </main>
    </div>
  );
}
