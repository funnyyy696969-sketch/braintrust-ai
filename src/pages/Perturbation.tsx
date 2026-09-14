import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Upload,
  Scissors,
  ChevronLeft,
  Info,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

interface PerturbationState {
  originalImage: string | null;
  saliencyMask: string | null;
  perturbedImage: string | null;
  isProcessing: boolean;
  error: string | null;
  method: string;
  methodDescription: string;
}

const perturbationMethods = [
  {
    id: "generative_inpainting",
    name: "Generative Inpainting",
    description: "Localized generative inpainting that replaces salient regions with realistic tissue textures",
    color: "#12355B",
    isValidated: false,
  },
  {
    id: "adversarial_masking",
    name: "Adversarial Masking (AIM)",
    description: "Adversarial Information Masking - suppresses informative features while maintaining visual realism",
    color: "#E58A2B",
    isValidated: false,
  },
  {
    id: "demo_fallback",
    name: "Demo Fallback",
    description: "Demo fallback perturbation for development and testing (not a validated method)",
    color: "#6C4AB6",
    isValidated: false,
  },
];

export default function Perturbation() {
  const navigate = useNavigate();
  const [state, setState] = useState<PerturbationState>({
    originalImage: null,
    saliencyMask: null,
    perturbedImage: null,
    isProcessing: false,
    error: null,
    method: "demo_fallback",
    methodDescription: perturbationMethods[2].description,
  });

  const [showMask, setShowMask] = useState(false);

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
        saliencyMask: null,
        perturbedImage: null,
        isProcessing: false,
        error: null,
        method: "demo_fallback",
        methodDescription: perturbationMethods[2].description,
      });
    };
    reader.readAsDataURL(file);
  }, []);

  const applyPerturbation = async () => {
    if (!state.originalImage) return;

    setState((prev) => ({ ...prev, isProcessing: true, error: null }));

    try {
      // For demo, create synthetic perturbation
      setTimeout(() => {
        // In production, this would call the backend
        const canvas = document.createElement("canvas");
        canvas.width = 224;
        canvas.height = 224;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Draw original
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0);

          // Apply perturbation effect
          ctx.fillStyle = "rgba(200, 200, 200, 0.3)";
          ctx.fillRect(50, 50, 124, 124);

          // Add noise
          const imageData = ctx.getImageData(50, 50, 124, 124);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            data[i] = data[i] + (Math.random() - 0.5) * 40;
            data[i + 1] = data[i + 1] + (Math.random() - 0.5) * 40;
            data[i + 2] = data[i + 2] + (Math.random() - 0.5) * 40;
          }
          ctx.putImageData(imageData, 50, 50);

          setState({
            ...state,
            perturbedImage: canvas.toDataURL("image/png"),
            isProcessing: false,
          });
        };
        img.src = state.originalImage!;
      }, 500);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: err instanceof Error ? err.message : "Perturbation failed",
      }));
    }
  };

  const handleMethodChange = (methodId: string) => {
    const method = perturbationMethods.find((m) => m.id === methodId);
    if (method) {
      setState((prev) => ({
        ...prev,
        method: methodId,
        methodDescription: method.description,
      }));
    }
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
              <h1 className="font-semibold text-[#12355B]">Perturb</h1>
              <p className="text-xs text-neutral-500">Test how predictions hold up</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#E58A2B]/10 text-[#E58A2B] rounded">
            Demo Mode
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Warning Banner */}
        <div className="mb-8 p-4 bg-[#E58A2B]/10 border border-[#E58A2B]/30 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[#E58A2B]">Research Prototype Warning</p>
            <p className="text-sm text-neutral-600 mt-1">
              This application uses demo perturbation methods for development and testing.
              These are not validated clinical perturbation techniques.
            </p>
          </div>
        </div>

        {/* Upload Section */}
        <Card className="border-neutral-200 mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-[#E58A2B]" />
              <CardTitle className="text-lg">Upload Scan</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {!state.originalImage ? (
              <div
                className="border-2 border-dashed border-neutral-300 rounded-lg p-8 text-center hover:border-[#E58A2B]/40 transition-colors cursor-pointer"
                onClick={() => document.getElementById("perturbation-file")?.click()}
              >
                <Upload className="w-10 h-10 text-neutral-400 mx-auto mb-4" />                  <p className="text-neutral-600">Drop a scan here, or click to upload</p>
                <input
                  id="perturbation-file"
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />
              </div>
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
                  <p className="text-sm font-medium text-neutral-700">
                    Scan loaded
                  </p>
                  <Button
                    onClick={applyPerturbation}
                    disabled={state.isProcessing}
                    className="bg-[#E58A2B] hover:bg-[#f09845] mt-4"
                  >
                    {state.isProcessing ? (
                      <>
                        <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />
                        Perturbing...
                      </>
                    ) : (
                      <>
                        <Scissors className="w-4 h-4 mr-2" />
                        Apply Perturbation
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Method Selection */}
        <Card className="border-neutral-200 mb-6">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Perturbation Method</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-3 gap-4">
              {perturbationMethods.map((method) => (
                <button
                  key={method.id}
                  onClick={() => handleMethodChange(method.id)}
                  className={`text-left p-4 rounded-lg border transition-all ${
                    state.method === method.id
                      ? `border-${method.color}-500 bg-${method.color}/5`
                      : "border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <div
                    className="w-10 h-10 rounded-lg mb-3 flex items-center justify-center"
                    style={{
                      backgroundColor: `${method.color}15`,
                    }}
                  >
                    <Scissors
                      className="w-5 h-5"
                      style={{ color: method.color }}
                    />
                  </div>
                  <p className="font-medium text-neutral-900 text-sm">{method.name}</p>
                  <p className="text-xs text-neutral-500 mt-1">{method.description}</p>
                  {state.method === method.id && (
                    <div className="mt-2">
                      <span
                        className="px-2 py-0.5 text-xs rounded-full"
                        style={{
                          backgroundColor: `${method.color}20`,
                          color: method.color,
                        }}
                      >
                        Selected
                      </span>
                    </div>
                  )}
                </button>
              ))}
            </div>
            {state.methodDescription && (
              <p className="text-sm text-neutral-600 mt-4 bg-neutral-50 p-3 rounded-lg">
                {state.methodDescription}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Results Grid */}
        {state.originalImage && (state.perturbedImage || state.saliencyMask) && (
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            {/* Original */}
            <Card className="border-neutral-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Original MRI</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="aspect-square bg-neutral-100 rounded-lg flex items-center justify-center overflow-hidden">
                  <img
                    src={state.originalImage}
                    alt="Original MRI"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Saliency Mask */}
            {state.saliencyMask && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Saliency Mask</CardTitle>
                    <label className="flex items-center gap-2 text-sm text-neutral-600">
                      <input
                        type="checkbox"
                        checked={showMask}
                        onChange={(e) => setShowMask(e.target.checked)}
                        className="rounded"
                      />
                      Show Mask
                    </label>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="aspect-square bg-neutral-100 rounded-lg flex items-center justify-center overflow-hidden">
                    {showMask ? (
                      <img
                        src={state.saliencyMask}
                        alt="Saliency Mask"
                        className="max-w-full max-h-full object-contain"
                      />
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Perturbed */}
            {state.perturbedImage && (
              <Card className="border-neutral-200">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Perturbed MRI</CardTitle>
                    <span className="px-2 py-0.5 text-xs bg-[#E58A2B]/10 text-[#E58A2B] rounded">
                      Perturbed
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="aspect-square bg-neutral-100 rounded-lg flex items-center justify-center overflow-hidden">
                    <img
                      src={state.perturbedImage}
                      alt="Perturbed MRI"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Comparison Section */}
        {state.originalImage && state.perturbedImage && (
          <Card className="border-neutral-200 mb-8">
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
                    <img
                      src={state.originalImage}
                      alt="Original"
                      className="w-full h-48 object-cover"
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-neutral-600 mb-2">Perturbed</p>
                  <div className="bg-neutral-100 rounded-lg overflow-hidden">
                    <img
                      src={state.perturbedImage}
                      alt="Perturbed"
                      className="w-full h-48 object-cover"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info Section */}
        <Card className="border-neutral-200">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5 text-[#E58A2B]" />
              <CardTitle className="text-lg">About Perturbation</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-neutral-600">
              <p>
                <strong>Manifold-Preserving Perturbation</strong> aims to modify input
                images in ways that maintain the underlying data manifold structure while
                testing model robustness.
              </p>
              <p>
                Realistic perturbations should produce images that could plausibly occur
                in real-world scenarios, unlike simple masking or blurring operations.
              </p>
              <div className="p-3 bg-[#E58A2B]/5 rounded-lg border border-[#E58A2B]/20">
                <p className="text-sm text-[#E58A2B]">
                  <strong>Note:</strong> Current implementation uses demo perturbation
                  for development. Validated manifold-preserving methods require trained
                  generative models or specialized perturbation networks.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
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
