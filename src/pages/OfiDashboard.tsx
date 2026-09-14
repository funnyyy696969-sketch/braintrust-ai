import { useNavigate, useParams } from "react-router";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  AlertCircle,
  Info,
  TrendingUp,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { Id } from "../convex/_generated/dataModel";

/** OFI dashboard — per-image OFI_res results with charts and documentation. */
export default function OfiDashboard() {
  const { scanId } = useParams<{ scanId: string }>();
  const navigate = useNavigate();
  const scan = useQuery(
    api.scans.getScan,
    scanId ? { scanId: scanId as Id<"scans"> } : "skip",
  );
  const images = useQuery(
    api.scans.listImages,
    scanId ? { scanId: scanId as Id<"scans"> } : "skip",
  );

  const analyzed = (images ?? []).filter((im) => im.analysisStatus === "done" && im.ofiValue !== undefined);
  const reviewList = analyzed.filter((im) => im.ofiReliable === false);

  const comparisonData = analyzed.map((im) => ({
    name: im.imageId,
    original: Math.round((im.confidence ?? 0) * 1000) / 10,
    perturbed: Math.round((im.perturbedConfidence ?? 0) * 1000) / 10,
  }));

  const ofiData = analyzed.map((im) => ({
    name: im.imageId,
    ofi: Math.round((im.ofiValue ?? 0) * 1000) / 1000,
  }));

  const values = analyzed.map((im) => im.ofiValue ?? 0);
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const std =
    values.length > 1 && mean !== null
      ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1))
      : null;

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
              <h1 className="font-semibold text-[#12355B]">OFI_res Dashboard</h1>
              <p className="text-xs text-neutral-500">{scan?.fileName ?? "Loading…"}</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#2E8B57]/10 text-[#2E8B57] rounded">
            {analyzed.length} analyzed
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Formula explainer */}
        <Card className="border-[#2E8B57]/25 bg-[#2E8B57]/5">
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-[#2E8B57] flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-neutral-900">What OFI_res measures</p>
                <p className="text-neutral-600 mt-1">
                  OFI<sub>res</sub> = ( p<sub>orig</sub>(target) − p<sub>perturbed</sub>(target) ) /
                  ( p<sub>orig</sub>(target) + ε ), where <em>target</em> is the class predicted on
                  the clean image. It captures how much confidence in the model's own answer
                  collapses once the region it attended to is realistically perturbed.
                </p>
                <ul className="list-disc ml-5 mt-2 text-neutral-600 space-y-0.5">
                  <li>≈ 0 — prediction is robust under salient-region perturbation.</li>
                  <li>≈ 1 — confidence in the target class fully collapsed.</li>
                  <li>&gt; 1 — confidence flipped to other classes.</li>
                </ul>
                <p className="text-xs text-neutral-500 mt-2">
                  Formula version OFI_res-v1.0 — a project-defined metric, not a clinically
                  validated standard. Values are computed per image and never fabricated.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Group summary (clearly labelled aggregation) */}
        <Card className="border-neutral-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-[#12355B]" />
              Group-level summary
              <span className="text-xs font-normal text-neutral-400">
                (aggregation of {analyzed.length} image-level results)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-3 bg-[#F3F6F9] rounded-lg">
                <p className="text-xs text-neutral-500">Mean OFI_res</p>
                <p className="text-xl font-semibold text-[#12355B]">{mean !== null ? mean.toFixed(3) : "—"}</p>
              </div>
              <div className="p-3 bg-[#F3F6F9] rounded-lg">
                <p className="text-xs text-neutral-500">Std dev</p>
                <p className="text-xl font-semibold text-[#12355B]">{std !== null ? `± ${std.toFixed(3)}` : "—"}</p>
              </div>
              <div className="p-3 bg-[#F3F6F9] rounded-lg">
                <p className="text-xs text-neutral-500">Images requiring review</p>
                <p className="text-xl font-semibold text-[#E58A2B]">{reviewList.length}</p>
              </div>
            </div>
            {reviewList.length > 0 && (
              <div className="mt-4 p-3 bg-[#E58A2B]/5 border border-[#E58A2B]/25 rounded-lg flex items-start gap-2 text-sm">
                <AlertCircle className="w-4 h-4 text-[#E58A2B] mt-0.5 flex-shrink-0" />
                <p className="text-neutral-700">
                  Unreliable values (baseline confidence below the 35% floor):{" "}
                  {reviewList.map((im) => im.imageId).join(", ")}
                </p>
              </div>
            )}
            <p className="text-xs text-neutral-500 mt-3">
              Aggregates are descriptive statistics only. They are not a combined diagnosis, and no
              per-scan prediction is derived from them.
            </p>
          </CardContent>
        </Card>

        {/* Charts */}
        {analyzed.length > 0 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="border-neutral-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Original vs perturbed confidence (%)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="original" fill="#12355B" name="Original" />
                      <Bar dataKey="perturbed" fill="#E58A2B" name="Perturbed" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-neutral-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Per-image OFI_res</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ofiData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <ReferenceLine y={1} stroke="#E58A2B" strokeDasharray="4 4" />
                      <Bar dataKey="ofi" fill="#2E8B57" name="OFI_res" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-neutral-500 mt-2">Dashed line: OFI_res = 1 (full confidence collapse).</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Per-image cards */}
        <div className="space-y-3">
          {analyzed.map((im) => (
            <Card key={im._id} className="border-neutral-200">
              <CardContent className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
                  <div>
                    <p className="font-semibold text-neutral-900">{im.imageId}</p>
                    <p className="text-xs text-neutral-500">
                      {im.perturbationMethod ?? "—"} · target {im.predictedClass}
                    </p>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-xs text-neutral-500">p_orig → p_pert</p>
                      <p className="font-medium text-neutral-900">
                        {((im.confidence ?? 0) * 100).toFixed(1)}% → {((im.perturbedConfidence ?? 0) * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-neutral-500">Δ confidence</p>
                      <p className="font-medium text-[#E58A2B]">
                        {(((im.confidence ?? 0) - (im.perturbedConfidence ?? 0)) * 100).toFixed(1)} pp
                      </p>
                    </div>
                    <div className="text-right min-w-20">
                      <p className="text-xs text-neutral-500">OFI_res</p>
                      <p className={`font-semibold ${im.ofiReliable === false ? "text-[#E58A2B]" : "text-[#2E8B57]"}`}>
                        {(im.ofiValue ?? 0).toFixed(3)}
                        {im.ofiReliable === false && " ⚠"}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {analyzed.length === 0 && (
          <p className="text-sm text-neutral-500">
            No analyzed images yet — run the pipeline from the Multi-Image Analysis page first.
          </p>
        )}
      </main>
    </div>
  );
}
