import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Eye,
  Layers,
  Thermometer,
  AlertTriangle,
  Info,
} from "lucide-react";

/** View-model passed through the analysis store. */
interface DetailProps {
  image: { id: string; dataUrl: string; width: number; height: number; channels: number };
  analysis: import("@/lib/imaging/types").ImageAnalysis;
  modelName: string;
}

export default function ImageDetailView({ image, analysis, modelName }: DetailProps) {
  const navigate = useNavigate();
  const [opacity, setOpacity] = useState(0.5);

  const a = analysis;
  const preprocessedNote = useMemo(
    () => "Luma → 224×224 bilinear → (x − 0.449) / 0.226",
    [],
  );

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-neutral-600 hover:text-neutral-900 p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="font-semibold text-[#12355B]">Image detail — {image.id}</h1>
              <p className="text-xs text-neutral-500">
                {image.width} × {image.height} · {image.channels} channel{image.channels === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#12355B]/10 text-[#12355B] rounded">Demo Mode</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Prediction + OFI header cards */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="p-4 bg-[#12355B]/5 border border-[#12355B]/20 rounded-lg">
            <p className="text-xs text-neutral-500">Original prediction</p>
            <p className="text-2xl font-semibold text-[#12355B]">
              {a.prediction?.predictedClass ?? "—"}
            </p>
            <p className="text-sm text-neutral-600">
              confidence {((a.prediction?.confidence ?? 0) * 100).toFixed(1)}%
            </p>
          </div>
          <div className="p-4 bg-[#E58A2B]/5 border border-[#E58A2B]/20 rounded-lg">
            <p className="text-xs text-neutral-500">Perturbed prediction</p>
            <p className="text-2xl font-semibold text-[#E58A2B]">
              {a.perturbedPrediction?.predictedClass ?? "—"}
            </p>
            <p className="text-sm text-neutral-600">
              confidence {((a.perturbedPrediction?.confidence ?? 0) * 100).toFixed(1)}%
            </p>
          </div>
          <div className="p-4 bg-[#2E8B57]/5 border border-[#2E8B57]/20 rounded-lg">
            <p className="text-xs text-neutral-500">
              OFI<sub>res</sub> ({a.ofi?.formulaVersion ?? "—"})
            </p>
            <p className="text-2xl font-semibold text-[#2E8B57]">
              {a.ofi ? a.ofi.value.toFixed(3) : "—"}
              {a.ofi?.unreliable && <AlertTriangle className="inline w-5 h-5 text-[#E58A2B] ml-1" />}
            </p>
            <p className="text-sm text-neutral-600">
              Δ confidence {(100 * (a.ofi?.confidenceChange ?? 0)).toFixed(1)} pp
            </p>
          </div>
        </div>

        {/* Grad-CAM */}
        <Card className="border-neutral-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Thermometer className="w-5 h-5 text-[#6C4AB6]" />
              Grad-CAM explanation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <figure>
                <img src={image.dataUrl} alt="Original" className="w-full rounded-lg border border-neutral-200" />
                <figcaption className="text-xs text-neutral-500 mt-1">Original</figcaption>
              </figure>
              <figure>
                <img src={a.heatmap?.dataUrl ?? image.dataUrl} alt="Grad-CAM heatmap" className="w-full rounded-lg border border-neutral-200" />
                <figcaption className="text-xs text-neutral-500 mt-1">
                  Heatmap → target class {a.heatmap?.targetClass ?? "—"}
                </figcaption>
              </figure>
              <figure>
                <div className="relative">
                  <img src={image.dataUrl} alt="Overlay base" className="w-full rounded-lg border border-neutral-200" />
                  <img
                    src={a.heatmap?.dataUrl ?? ""}
                    alt="Overlay"
                    className="absolute inset-0 w-full h-full rounded-lg"
                    style={{ opacity, mixBlendMode: "multiply" }}
                  />
                </div>
                <figcaption className="text-xs text-neutral-500 mt-1">
                  Adjustable overlay ({Math.round(opacity * 100)}%)
                </figcaption>
              </figure>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Overlay opacity</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full accent-[#6C4AB6]"
              />
            </div>
            <div className="p-3 bg-[#F3F6F9] rounded-lg text-xs text-neutral-600 space-y-1">
              <p><span className="font-medium text-neutral-800">Model:</span> {modelName} (demo surrogate)</p>
              <p><span className="font-medium text-neutral-800">Explanation status:</span> generated for THIS image — dimensions match by construction ({image.width}×{image.height} source, 224×224 model view)</p>
              <p><span className="font-medium text-neutral-800">Preprocessing:</span> {preprocessedNote}</p>
            </div>
          </CardContent>
        </Card>

        {/* Saliency + perturbation */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card className="border-neutral-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Eye className="w-5 h-5 text-[#6C4AB6]" />
                Salient region mask
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <figure>
                <img src={a.saliency?.dataUrl ?? image.dataUrl} alt="Saliency mask" className="w-full rounded-lg border border-neutral-200" />
                <figcaption className="text-xs text-neutral-500 mt-1">
                  Coverage {(100 * (a.saliency?.coverage ?? 0)).toFixed(1)}% of the image
                </figcaption>
              </figure>
              {a.saliency && (
                <p className="text-xs text-neutral-600">
                  Approximate region of interest: x {a.saliency.bbox.x}–{a.saliency.bbox.x + a.saliency.bbox.w}, y{" "}
                  {a.saliency.bbox.y}–{a.saliency.bbox.y + a.saliency.bbox.h} (model view px).
                </p>
              )}
              <p className="text-xs text-neutral-500">
                Grad-CAM highlights where the model looked — it is NOT an accurate tumor
                segmentation and must not be read as one.
              </p>
            </CardContent>
          </Card>

          <Card className="border-neutral-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Layers className="w-5 h-5 text-[#E58A2B]" />
                Perturbation — side by side
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <figure>
                  <img src={image.dataUrl} alt="Original" className="w-full rounded-lg border border-neutral-200" />
                  <figcaption className="text-xs text-neutral-500 mt-1">Original</figcaption>
                </figure>
                <figure>
                  <img src={a.perturbation?.dataUrl ?? image.dataUrl} alt="Perturbed" className="w-full rounded-lg border border-neutral-200" />
                  <figcaption className="text-xs text-neutral-500 mt-1">
                    {a.perturbation?.method ?? "—"} ({a.perturbation?.perturbedPixelCount ?? 0} px changed)
                  </figcaption>
                </figure>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200 flex items-start gap-3">
          <Info className="w-5 h-5 text-neutral-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-neutral-600">
            <span className="font-medium">For research only.</span> Tumor stage/grade prediction is
            not available in this model. Brain tumor grading requires a validated clinical framework
            and expert review — no stage is inferred from these results.
          </p>
        </div>
      </main>
    </div>
  );
}

// Route wrapper so the detail page can be mounted from the router too.
export function ImageDetailRoute() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center max-w-md">
        <AlertTriangle className="w-8 h-8 text-[#E58A2B] mx-auto mb-3" />
        <p className="text-sm text-neutral-700 font-medium">Detail view needs session data</p>
        <p className="text-xs text-neutral-500 mt-2 mb-4">
          Extracted images stay in your browser for privacy. Start from Upload to (re)build the
          analysis session, then open a detail view from the results list.
        </p>
        <Button className="bg-[#12355B] hover:bg-[#1a4570]" onClick={() => navigate("/upload")}>
          Go to Upload
        </Button>
      </div>
    </div>
  );
}
