import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft,
  Settings as SettingsIcon,
  Info,
  AlertTriangle,
} from "lucide-react";

export default function Settings() {
  const navigate = useNavigate();
  const [demoMode, setDemoMode] = useState(true);
  const [modelName, setModelName] = useState("resnet50");
  const [ofiFormulaVersion, setOfiFormulaVersion] = useState("1.0.0");

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
              <h1 className="font-semibold text-[#12355B]">Settings</h1>
              <p className="text-xs text-neutral-500">Configure your workspace</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* App Info */}
        <Card className="border-neutral-200 mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <SettingsIcon className="w-5 h-5 text-[#12355B]" />
              <CardTitle className="text-lg">Application Settings</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Demo Mode */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-neutral-900 font-medium">Demo Mode</p>
                <p className="text-sm text-neutral-600">
                  Use simulated predictions and visualizations
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={demoMode}
                  onChange={(e) => setDemoMode(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#12355B]"></div>
              </label>
            </div>

            {/* Model Selection */}
            <div>
              <Label className="text-neutral-700">Default Model</Label>
              <div className="mt-2 flex gap-2">
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

            {/* OFI Formula Version */}
            <div>
              <Label className="text-neutral-700">OFI_res Formula Version</Label>
              <select
                value={ofiFormulaVersion}
                onChange={(e) => setOfiFormulaVersion(e.target.value)}
                className="mt-2 w-full px-3 py-2 border border-neutral-300 rounded-md text-neutral-900 bg-white focus:outline-none focus:ring-1 focus:ring-[#12355B] focus:border-[#12355B]"
              >
                <option value="1.0.0">v1.0.0 — Basic absolute difference</option>
                <option value="1.1.0">v1.1.0 — Weighted confidence change</option>
                <option value="2.0.0">v2.0.0 — Multi-class fragility score</option>
              </select>
              <p className="text-xs text-neutral-500 mt-1">
                The formula version determines how OFI_res is calculated.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* API Configuration */}
        <Card className="border-neutral-200 mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5 text-[#008C95]" />
              <CardTitle className="text-lg">API Configuration</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Label className="text-neutral-700">Backend API URL</Label>
                <input
                  type="url"
                  defaultValue="http://localhost:8000"
                  className="mt-1 w-full px-3 py-2 border border-neutral-300 rounded-md text-neutral-900 bg-white focus:outline-none focus:ring-1 focus:ring-[#008C95] focus:border-[#008C95]"
                />
              </div>
              <p className="text-xs text-neutral-500">
                Configure the URL of the FastAPI backend server. For local development, use{" "}
                <code className="bg-neutral-100 px-1 rounded">http://localhost:8000</code>.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Model Configuration */}
        <Card className="border-neutral-200 mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <SettingsIcon className="w-5 h-5 text-[#6C4AB6]" />
              <CardTitle className="text-lg">Model Configuration</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-neutral-700">Model Checkpoint Path</Label>
                <input
                  type="text"
                  defaultValue="./models/checkpoints/resnet50.pth"
                  className="mt-1 w-full px-3 py-2 border border-neutral-300 rounded-md text-neutral-900 bg-white focus:outline-none focus:ring-1 focus:ring-[#6C4AB6] focus:border-[#6C4AB6]"
                />
              </div>
              <div>
                <Label className="text-neutral-700">Class Mapping</Label>
                <p className="mt-1 text-sm text-neutral-600 bg-neutral-50 p-3 rounded-md">
                  {`{
                    "0": "No Tumor",
                    "1": "Glioma",
                    "2": "Meningioma",
                    "3": "Pituitary Tumor"
                  }`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card className="border-neutral-200 mb-6">
          <CardHeader className="pb-4">              <CardTitle className="text-lg">About</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-neutral-600">
              <p>
                <strong>Version:</strong> 1.0.0 (Development)
              </p>
              <p>
                <strong>Type:</strong> Personal research environment
              </p>
              <p>
                <strong>Framework:</strong> Inference-Time Manifold-Preserving Perturbation
              </p>
              <p className="text-xs text-neutral-500 mt-2">
                For understanding AI, not for diagnosis.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Legal */}
        <Card className="border-neutral-200">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-[#E58A2B]" />
              <CardTitle className="text-lg">Legal & Disclaimer</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="p-4 bg-[#E58A2B]/5 rounded-lg border border-[#E58A2B]/20">
              <p className="text-sm text-[#E58A2B] font-medium mb-2">Research Prototype Warning</p>
              <p className="text-sm text-neutral-600">
                BrainTrust AI is a research prototype developed for academic purposes.
                It is not intended for clinical use, medical diagnosis, or treatment decisions.
                The predictions, visualizations, and metrics provided are for research
                evaluation only and should not be relied upon for patient care.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
