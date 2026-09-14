import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Eye,
  Upload,
  Sliders,
  ChevronLeft,
  Info,
  AlertCircle,
} from "lucide-react";

interface ExplainabilityState {
  originalImage: string | null;
  heatmap: string | null;
  saliencyMask: string | null;
  overlay: string | null;
  isProcessing: boolean;
  error: string | null;
  opacity: number;
}

export default function Explainability() {
  const navigate = useNavigate();
  const [state, setState] = useState<ExplainabilityState>({
    originalImage: null,
    heatmap: null,
    saliencyMask: null,
    overlay: null,
    isProcessing: false,
    error: null,
    opacity: 0.5,
  });

  const handleFileSelect = useCallback((file: File) => {
    const validTypes = ["image/png", "image/jpeg", "image/jpg"];
    if (!validTypes.includes(file.type)) {
      setState((prev) => ({
        ...prev,
        error: "Invalid file type. Please upload PNG, JPG, or JPEG images.",
      }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setState((prev) => ({
        ...prev,
        error: "File too large. Maximum size is 10MB.",
      }));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setState({
        originalImage: reader.result as string,
        heatmap: null,
        saliencyMask: null,
        overlay: null,
        isProcessing: false,
        error: null,
        opacity: 0.5,
      });
    };
    reader.readAsDataURL(file);
  }, []);

  const generateGradCAM = async () => {
    if (!state.originalImage) return;

    setState((prev) => ({ ...prev, isProcessing: true, error: null }));

    try {
      // For demo, create synthetic heatmap and mask
      // In production, this would call the backend
      setTimeout(() => {
        // Generate synthetic heatmap (in real app, this comes from backend)
        const canvas = document.createElement("canvas");
        canvas.width = 224;
        canvas.height = 224;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Create gradient heatmap
        const gradient = ctx.createRadialGradient(112, 112, 0, 112, 112, 100);
        gradient.addColorStop(0, "rgba(255, 0, 0, 0.8)");
        gradient.addColorStop(0.3, "rgba(255, 165, 0, 0.6)");
        gradient.addColorStop(0.6, "rgba(255, 255, 0, 0.3)");
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 224, 224);

        // Add some variation
        ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
        ctx.fillRect(50, 50, 124, 124);

        const heatmapData = canvas.toDataURL("image/png");

        // Create saliency mask
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = 224;
        maskCanvas.height = 224;
        const maskCtx = maskCanvas.getContext("2d");
        if (!maskCtx) return;
        maskCtx.fillStyle = "white";
        maskCtx.fillRect(50, 50, 124, 124);
        const maskData = maskCanvas.toDataURL("image/png");

        // Create overlay
        const overlayCanvas = document.createElement("canvas");
        overlayCanvas.width = 224;
        overlayCanvas.height = 224;
        const overlayCtx = overlayCanvas.getContext("2d");
        if (!overlayCtx) return;

        // Draw original image
        const img = new Image();
        img.onload = () => {
          overlayCtx.drawImage(img, 0, 0, 224, 224);

          // Draw heatmap overlay with opacity
          const heatmapImg = new Image();
          heatmapImg.onload = () => {
            overlayCtx.globalAlpha = state.opacity;
            overlayCtx.drawImage(heatmapImg, 0, 0, 224, 224);
            overlayCtx.globalAlpha = 1;

            setState({
              ...state,
              heatmap: heatmapData,
              saliencyMask: maskData,
              overlay: overlayCanvas.toDataURL("image/png"),
              isProcessing: false,
            });
          };
          img.src = state.originalImage!;
        };

        setState({
          ...state,
          heatmap: heatmapData,
          saliencyMask: maskData,
          overlay: null,
          isProcessing: false,
        });
      }, 500);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: err instanceof Error ? err.message : "Failed to generate Grad-CAM",
      }));
    }
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setState((prev) => ({
      ...prev,
      opacity: parseFloat(e.target.value),
      overlay: null, // Regenerate overlay with new opacity
    }));
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
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
              <h1 className="font-semibold text-[#12355B]">Explain</h1>
              <p className="text-xs text-neutral-500">See where the model is looking</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#6C4AB6]/10 text-[#6C4AB6] rounded">
            Grad-CAM
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Upload Section */}
        <div className="mb-8">
          {!state.originalImage ? (
            <Card className="border-neutral-200">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2">
                  <Upload className="w-5 h-5 text-[#6C4AB6]" />
                  <CardTitle className="text-lg">Upload Scan</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className="border-2 border-dashed border-neutral-300 rounded-lg p-8 text-center hover:border-[#6C4AB6]/40 transition-colors cursor-pointer"
                  onClick={() => document.getElementById("explainability-file")?.click()}
                >
                  <Upload className="w-10 h-10 text-neutral-400 mx-auto mb-4" />
                  <p className="text-neutral-600">Drop a scan here, or click to upload</p>
                  <input
                    id="explainability-file"
                    type="file"
                    accept=".png,.jpg,.jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex gap-6">
              <div className="flex-shrink-0">
                <Card className="border-neutral-200 p-2">
                  <img
                    src={state.originalImage}
                    alt="Original MRI"
                    className="w-48 h-48 object-cover rounded"
                  />
                </Card>
              </div>
              <div className="flex-1">
                <Button
                  onClick={generateGradCAM}
                  disabled={state.isProcessing}
                  className="bg-[#6C4AB6] hover:bg-[#7d5bc4] mb-4"
                >
                  {state.isProcessing ? (
                    <>
                      <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />
                      Generating Grad-CAM...
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4 mr-2" />
                      Generate Grad-CAM
                    </>
                  )}
                </Button>
                {state.error && (
                  <p className="text-sm text-red-600 mt-2">{state.error}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Visualization Grid */}
        {state.originalImage && (state.heatmap || state.saliencyMask) && (
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Original MRI */}
            <Card className="border-neutral-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your Scan</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="aspect-square bg-neutral-100 rounded-lg flex items-center justify-center overflow-hidden">
                  <img
                    src={state.originalImage}
                    alt="Your scan"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Heatmap */}
            <Card className="border-neutral-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Heatmap</CardTitle>
                  <span className="px-2 py-0.5 text-xs bg-[#6C4AB6]/10 text-[#6C4AB6] rounded">
                    Attention Map
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="aspect-square bg-neutral-100 rounded-lg flex items-center justify-center overflow-hidden">
                  <img
                    src={state.heatmap!}
                    alt="Model attention heatmap"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Saliency Mask */}
            <Card className="border-neutral-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Attention Region</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="aspect-square bg-neutral-100 rounded-lg flex items-center justify-center overflow-hidden">
                  <img
                    src={state.saliencyMask!}
                    alt="Attention region mask"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Overlay */}
            {state.overlay && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Scan with Overlay</CardTitle>
                  <span className="px-2 py-0.5 text-xs bg-[#6C4AB6]/10 text-[#6C4AB6] rounded">
                    Original + Heatmap
                  </span>
                </CardHeader>
                <CardContent>
                  <div className="aspect-square bg-neutral-100 rounded-lg flex items-center justify-center overflow-hidden">
                    <img
                      src={state.overlay}
                      alt="Scan with heatmap overlay"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Controls */}
        {state.heatmap && (
          <Card className="border-neutral-200 mb-8">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-[#6C4AB6]" />
                <CardTitle className="text-lg">Overlay Controls</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <span className="text-sm text-neutral-700 w-20">Opacity</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={state.opacity}
                  onChange={handleOpacityChange}
                  className="flex-1 h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-[#6C4AB6]"
                />
                <span className="text-sm text-neutral-900 w-12 text-right">
                  {Math.round(state.opacity * 100)}%
                </span>
              </div>
              <p className="text-xs text-neutral-500 mt-2">
                Adjust the opacity to see how the heatmap overlays on the original image
              </p>
            </CardContent>
          </Card>
        )}

        {/* Info Section */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card className="border-neutral-200">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-[#6C4AB6]" />
                <CardTitle className="text-lg">How This Works</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm text-neutral-600">
                <p>
                  <strong>Gradient-weighted Class Activation Mapping (Grad-CAM)</strong>
                  is a technique for producing visual explanations for decisions from
                  convolutional neural networks.
                </p>
                <p>
                  It uses the gradients of any target concept flowing into the final
                  convolutional layer to produce a coarse localization map highlighting
                  the important regions in the image for prediction.
                </p>
                <p className="text-[#6C4AB6]">
                  In this application, Grad-CAM highlights brain regions that most
                  influenced the model's tumor classification decision.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-neutral-200">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Method Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b border-neutral-100">
                  <span className="text-neutral-600">Method</span>
                  <span className="text-neutral-900 font-medium">Grad-CAM</span>
                </div>
                <div className="flex justify-between py-2 border-b border-neutral-100">
                  <span className="text-neutral-600">Model</span>
                  <span className="text-neutral-900 font-medium">ResNet50</span>
                </div>
                <div className="flex justify-between py-2 border-b border-neutral-100">
                  <span className="text-neutral-600">Target Layer</span>
                  <span className="text-neutral-900 font-medium">Final Conv Layer</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-neutral-600">Status</span>
                  <span className="text-[#6C4AB6] font-medium">Demo Mode</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-neutral-600">
              Heatmap visualization is for research and interpretability purposes.
              It does not constitute a medical diagnosis or guarantee model accuracy.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
