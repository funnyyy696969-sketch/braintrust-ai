import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Upload,
  X,
  Loader2,
  Brain,
  Info,
  AlertCircle,
  CheckCircle,
} from "lucide-react";

interface MRIAnalysisState {
  imagePreview: string | null;
  originalFile: File | null;
  isProcessing: boolean;
  error: string | null;
  prediction: {
    predictedClass: string;
    confidence: number;
    probabilities: Record<string, number>;
  } | null;
  preprocessingInfo: {
    originalSize: string;
    resizedSize: string;
    normalization: string;
  } | null;
}

export default function MRIAnalysis() {
  const navigate = useNavigate();
  const [state, setState] = useState<MRIAnalysisState>({
    imagePreview: null,
    originalFile: null,
    isProcessing: false,
    error: null,
    prediction: null,
    preprocessingInfo: null,
  });

  const [modelName, setModelName] = useState("resnet50");

  const handleFileSelect = useCallback((file: File) => {
    // Validate file type
    const validTypes = ["image/png", "image/jpeg", "image/jpg"];
    if (!validTypes.includes(file.type)) {
      setState((prev) => ({
        ...prev,
        error: "Invalid file type. Please upload PNG, JPG, or JPEG images.",
      }));
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setState((prev) => ({
        ...prev,
        error: "File too large. Maximum size is 10MB.",
      }));
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setState({
        imagePreview: reader.result as string,
        originalFile: file,
        isProcessing: false,
        error: null,
        prediction: null,
        preprocessingInfo: null,
      });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const resetAnalysis = () => {
    setState({
      imagePreview: null,
      originalFile: null,
      isProcessing: false,
      error: null,
      prediction: null,
      preprocessingInfo: null,
    });
  };

  const runAnalysis = async () => {
    if (!state.originalFile) return;

    setState((prev) => ({ ...prev, isProcessing: true, error: null }));

    try {
      const formData = new FormData();
      formData.append("file", state.originalFile);
      formData.append("model_name", modelName);

      const response = await fetch("http://localhost:8000/api/predict", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setState({
          ...state,
          isProcessing: false,
          prediction: {
            predictedClass: data.predicted_class,
            confidence: data.confidence,
            probabilities: data.probabilities,
          },
          preprocessingInfo: {
            originalSize: JSON.stringify(data.preprocessing_info?.original_size),
            resizedSize: JSON.stringify(data.preprocessing_info?.resized_size),
            normalization: data.preprocessing_info?.normalization || "ImageNet",
          },
        });
      } else {
        throw new Error(data.error || "Prediction failed");
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: err instanceof Error ? err.message : "Analysis failed",
      }));
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
              <h1 className="font-semibold text-[#12355B]">MRI Analysis</h1>
              <p className="text-xs text-neutral-500">Upload and analyze brain MRI images</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 text-xs bg-[#12355B]/10 text-[#12355B] rounded">
              Demo Mode
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Upload Section */}
        <Card className="border-neutral-200 mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-[#12355B]" />
              <CardTitle className="text-lg">Upload MRI Image</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {!state.imagePreview ? (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-neutral-300 rounded-lg p-8 text-center hover:border-[#12355B]/40 transition-colors cursor-pointer"
                onClick={() => document.getElementById("file-input")?.click()}
              >
                <Upload className="w-10 h-10 text-neutral-400 mx-auto mb-4" />
                <p className="text-neutral-600 mb-2">Drag and drop an MRI image here</p>
                <p className="text-sm text-neutral-500 mb-4">or click to browse</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-neutral-300"
                  onClick={() => document.getElementById("file-input")?.click()}
                >
                  Choose File
                </Button>
                <input
                  id="file-input"
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <p className="text-xs text-neutral-400 mt-4">
                  Supported: PNG, JPG, JPEG (max 10MB)
                </p>
              </div>
            ) : (
              <div className="flex gap-6">
                <div className="flex-shrink-0">
                  <img
                    src={state.imagePreview}
                    alt="MRI Preview"
                    className="w-48 h-48 object-cover rounded-lg border border-neutral-200"
                  />
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-medium text-neutral-900">
                        {state.originalFile?.name}
                      </p>
                      <p className="text-sm text-neutral-500">
                        {formatFileSize(state.originalFile?.size || 0)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetAnalysis}
                      className="text-neutral-500"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Model Selection */}
                  <div className="mb-4">
                    <Label className="text-sm text-neutral-700">Model</Label>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => setModelName("resnet50")}
                        className={`px-4 py-2 text-sm rounded-md border transition-colors ${
                          modelName === "resnet50"
                            ? "border-[#12355B] bg-[#12355B]/5 text-[#12355B]"
                            : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                        }`}
                      >
                        ResNet50
                      </button>
                      <button
                        onClick={() => setModelName("efficientnet")}
                        className={`px-4 py-2 text-sm rounded-md border transition-colors ${
                          modelName === "efficientnet"
                            ? "border-[#008C95] bg-[#008C95]/5 text-[#008C95]"
                            : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                        }`}
                      >
                        EfficientNet
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <Button
                      onClick={runAnalysis}
                      disabled={state.isProcessing}
                      className="bg-[#12355B] hover:bg-[#1a4570]"
                    >
                      {state.isProcessing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Brain className="w-4 h-4 mr-2" />
                          Run Analysis
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={resetAnalysis}
                      className="border-neutral-300"
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {state.error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{state.error}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Prediction Result */}
        {state.prediction && (
          <Card className="border-neutral-200 mb-6">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-[#2E8B57]" />
                <CardTitle className="text-lg">Prediction Result</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                {/* Prediction Info */}
                <div>
                  <div className="p-4 bg-[#12355B]/5 rounded-lg border border-[#12355B]/20 mb-4">
                    <p className="text-sm text-neutral-600 mb-1">Predicted Class</p>
                    <p className="text-2xl font-semibold text-[#12355B]">
                      {state.prediction.predictedClass}
                    </p>
                  </div>
                  <div className="p-4 bg-[#008C95]/5 rounded-lg border border-[#008C95]/20">
                    <p className="text-sm text-neutral-600 mb-1">Confidence</p>
                    <p className="text-2xl font-semibold text-[#008C95]">
                      {(state.prediction.confidence * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* Probabilities */}
                <div>
                  <p className="text-sm font-medium text-neutral-700 mb-3">Class Probabilities</p>
                  <div className="space-y-2">
                    {Object.entries(state.prediction.probabilities).map(([className, prob]) => (
                      <div key={className} className="flex items-center justify-between">
                        <span className="text-sm text-neutral-700">{className}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-neutral-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#008C95] rounded-full"
                              style={{ width: `${prob * 100}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium text-neutral-900 w-16 text-right">
                            {(prob * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Preprocessing Info */}
              <div className="mt-6 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="w-4 h-4 text-neutral-500" />
                  <p className="text-sm font-medium text-neutral-700">Preprocessing Information</p>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-neutral-500">Original Size</p>
                    <p className="text-neutral-900">{state.preprocessingInfo?.originalSize}</p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Resized</p>
                    <p className="text-neutral-900">{state.preprocessingInfo?.resizedSize}</p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Normalization</p>
                    <p className="text-neutral-900">{state.preprocessingInfo?.normalization}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Disclaimer */}
        <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-neutral-600">
              <span className="font-medium">Research Prototype: </span>
              This is an experimental model prediction, not a clinical diagnosis.
              Results should be interpreted by qualified medical professionals.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
