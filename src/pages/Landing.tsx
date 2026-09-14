import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Brain, ArrowRight, FileText, Activity, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router";

// Brain MRI-inspired SVG illustration
function BrainIllustration() {
  return (
    <svg
      viewBox="0 0 400 300"
      className="w-full max-w-md h-auto opacity-80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="brainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#12355B" stopOpacity="0.1"/>
          <stop offset="100%" stopColor="#008C95" stopOpacity="0.1"/>
        </linearGradient>
      </defs>
      {/* Brain outline */}
      <ellipse
        cx="200"
        cy="150"
        rx="140"
        ry="100"
        fill="url(#brainGrad)"
        stroke="#12355B"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      {/* Brain folds - simplified */}
      <path
        d="M120 120 Q160 100 200 120 T280 120"
        stroke="#12355B"
        strokeWidth="1"
        fill="none"
        opacity="0.4"
      />
      <path
        d="M100 160 Q160 140 200 160 T300 160"
        stroke="#12355B"
        strokeWidth="1"
        fill="none"
        opacity="0.4"
      />
      <path
        d="M140 200 Q180 180 220 200 T300 200"
        stroke="#12355B"
        strokeWidth="1"
        fill="none"
        opacity="0.4"
      />
      {/* Highlight regions */}
      <ellipse cx="180" cy="140" rx="25" ry="20" fill="#008C95" opacity="0.2"/>
      <ellipse cx="230" cy="170" rx="20" ry="15" fill="#6C4AB6" opacity="0.2"/>
      <ellipse cx="160" cy="180" rx="15" ry="12" fill="#E58A2B" opacity="0.15"/>
      {/* Neural connections */}
      <circle cx="180" cy="140" r="3" fill="#008C95"/>
      <circle cx="230" cy="170" r="2.5" fill="#6C4AB6"/>
      <circle cx="160" cy="180" r="2" fill="#E58A2B"/>
      <line x1="180" y1="140" x2="230" y2="170" stroke="#12355B" strokeWidth="0.5" opacity="0.3"/>
      <line x1="180" y1="140" x2="160" y2="180" stroke="#12355B" strokeWidth="0.5" opacity="0.3"/>
    </svg>
  );
}

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white text-foreground">
      {/* Header - minimal */}
      <header className="border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[#12355B] flex items-center justify-center">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-[#12355B] text-lg">BrainTrust AI</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-neutral-300 text-neutral-700 hover:bg-neutral-100"
            onClick={() => navigate("/auth")}
          >
            Sign In
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            {/* Tagline */}
            <span className="inline-block px-3 py-1 text-xs font-medium text-[#008C95] bg-[#008C95]/10 rounded-full mb-6">
              B.Tech CSE Research Project
            </span>

            {/* Title */}
            <h1 className="text-4xl font-semibold text-[#12355B] leading-tight mb-6">
              Inference-Time Manifold-Preserving
              <br />
              <span className="text-[#008C95]">Perturbation Framework</span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg text-neutral-600 leading-relaxed mb-8 max-w-lg">
              A research prototype for evaluating AI reasoning in brain tumor MRI classification.
              Analyze model predictions, visualize Grad-CAM explanations, and measure output fragility
              under realistic perturbations.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-wrap gap-4 mb-8">
              <Button
                size="lg"
                className="bg-[#12355B] text-white hover:bg-[#1a4570] px-6 h-12"
                onClick={() => navigate("/auth")}
              >
                Start MRI Analysis
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="border-[#12355B] text-[#12355B] hover:bg-[#12355B]/5 px-6 h-12"
                onClick={() => navigate("/documentation")}
              >
                Explore Methodology
              </Button>
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-3 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
              <ShieldAlert className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-neutral-600">
                <span className="font-medium text-[#E58A2B]">Research Prototype: </span>
                This application is for educational and research purposes only.
                It is not a clinical diagnostic tool and should not be used for medical decisions.
              </p>
            </div>
          </motion.div>

          {/* Right illustration */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex justify-center"
          >
            <div className="relative">
              <BrainIllustration />
              {/* Floating elements */}
              <div className="absolute -top-4 -right-4 bg-white rounded-lg border border-neutral-200 p-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#008C95]" />
                  <span className="text-xs text-neutral-600">ResNet50 + Grad-CAM</span>
                </div>
              </div>
              <div className="absolute -bottom-4 -left-4 bg-white rounded-lg border border-neutral-200 p-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-[#6C4AB6]" />
                  <span className="text-xs text-neutral-600">OFI_res Analysis</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Features Section */}
        <section className="mt-20">
          <h2 className="text-2xl font-semibold text-[#12355B] mb-2">Research Framework</h2>
          <p className="text-neutral-600 mb-8">
            A comprehensive pipeline for evaluating AI model robustness in medical imaging
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <Card className="bg-white border-neutral-200 shadow-none hover:border-[#008C95]/30 transition-colors">
              <CardHeader className="pb-2">
                <div className="w-10 h-10 rounded-lg bg-[#12355B]/10 flex items-center justify-center mb-3">
                  <Brain className="w-5 h-5 text-[#12355B]" />
                </div>
                <CardTitle className="text-lg">MRI Classification</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-neutral-600">
                  Upload brain MRI images and obtain predictions using ResNet50 or EfficientNet
                  models trained for brain tumor classification.
                </p>
              </CardContent>
            </Card>

            {/* Feature 2 */}
            <Card className="bg-white border-neutral-200 shadow-none hover:border-[#6C4AB6]/30 transition-colors">
              <CardHeader className="pb-2">
                <div className="w-10 h-10 rounded-lg bg-[#6C4AB6]/10 flex items-center justify-center mb-3">
                  <Activity className="w-5 h-5 text-[#6C4AB6]" />
                </div>
                <CardTitle className="text-lg">Explainable AI</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-neutral-600">
                  Visualize Grad-CAM heatmaps to understand which regions of the MRI
                  influenced the model's prediction, improving interpretability.
                </p>
              </CardContent>
            </Card>

            {/* Feature 3 */}
            <Card className="bg-white border-neutral-200 shadow-none hover:border-[#E58A2B]/30 transition-colors">
              <CardHeader className="pb-2">
                <div className="w-10 h-10 rounded-lg bg-[#E58A2B]/10 flex items-center justify-center mb-3">
                  <ShieldAlert className="w-5 h-5 text-[#E58A2B]" />
                </div>
                <CardTitle className="text-lg">Output Fragility</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-neutral-600">
                  Measure how model predictions change under realistic perturbations using
                  OFI_res and statistical analysis with Generalized Additive Models.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-20 pt-8 border-t border-neutral-200">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-neutral-500">
              BrainTrust AI — Research Prototype for B.Tech CSE
            </p>
            <p className="text-sm text-neutral-400">
              Not for clinical use
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
