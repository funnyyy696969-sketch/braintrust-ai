import { useState } from "react";
import { useNavigate } from "react-router";
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronLeft,
  BookOpen,
  Brain,
  Eye,
  Target,
  AlertTriangle,
  FileText,
  RefreshCw,
  TrendingUp,
} from "lucide-react";

interface DocSection {
  id: string;
  icon: React.ReactNode;
  title: string;
  content: string[];
}

const docSections: DocSection[] = [
  {
    id: "mri-classification",
    icon: <Brain className="w-5 h-5" />,
    title: "Brain Tumor MRI Classification",
    content: [
      "Brain tumor classification from MRI images is a critical task in medical image analysis. Deep learning models, particularly Convolutional Neural Networks (CNNs), have shown promising results in automated tumor detection and classification.",
      "The BrainTrust AI framework uses pre-trained models (ResNet50, EfficientNet) fine-tuned on brain MRI datasets to classify images into categories: No Tumor, Glioma, Meningioma, and Pituitary Tumor.",
      "These models learn hierarchical features from MRI scans, from low-level textures to high-level anatomical structures, enabling them to distinguish between different tumor types.",
    ],
  },
  {
    id: "explainable-ai",
    icon: <Eye className="w-5 h-5" />,
    title: "Explainable AI (XAI)",
    content: [
      "Explainable AI refers to methods and techniques that make the decisions of AI models understandable to humans. In medical applications, interpretability is crucial for building trust and enabling clinical validation.",
      "Without explainability, deep learning models are often considered 'black boxes' — they produce predictions without revealing the reasoning behind them. This is problematic in healthcare where understanding why a model made a decision is as important as the decision itself.",
      "BrainTrust AI implements Grad-CAM as its primary explainability method, providing visual explanations that highlight the regions of MRI scans most influential in the model's predictions.",
    ],
  },
  {
    id: "grad-cam",
    icon: <Target className="w-5 h-5" />,
    title: "Grad-CAM (Gradient-weighted Class Activation Mapping)",
    content: [
      "Grad-CAM is a gradient-based visualization technique that produces heatmaps highlighting the important regions in an image for a specific prediction. Unlike earlier methods, it doesn't require retraining or architectural changes.",
      "The technique works by computing the gradients of the target class score with respect to the feature maps of the final convolutional layer. These gradients are then used to weight the importance of each feature map.",
      "The resulting heatmap is upsampled to match the input image dimensions and overlaid to show which areas contributed most to the model's decision. Warmer colors (red, yellow) indicate higher importance.",
      "In the context of brain tumor MRI analysis, Grad-CAM can help radiologists verify that the model is focusing on actual tumor regions rather than irrelevant features or artifacts.",
    ],
  },
  {
    id: "ood-bias",
    icon: <AlertTriangle className="w-5 h-5" />,
    title: "Out-of-Distribution (OOD) Bias",
    content: [
      "Out-of-distribution (OOD) bias occurs when a model encounters data that differs from its training distribution. This is a significant challenge in medical AI, where imaging protocols, equipment, and patient populations can vary.",
      "Models trained on data from one hospital or scanner may perform poorly on data from another, even if both are valid brain MRI scans. This fragility undermines reliability in real-world deployment.",
      "The BrainTrust AI framework evaluates model fragility by applying perturbations to inputs and measuring how predictions change. This helps assess whether the model is robust to realistic variations or overly sensitive to specific features.",
      "Understanding OOD bias is essential for developing trustworthy medical AI systems that perform consistently across different clinical settings.",
    ],
  },
  {
    id: "manifold-preserving-perturbation",
    icon: <RefreshCw className="w-5 h-5" />,
    title: "Manifold-Preserving Perturbation",
    content: [
      "Manifold-preserving perturbation is a technique for modifying input data while maintaining the underlying structure (manifold) of the data distribution. Unlike arbitrary noise or masking, these perturbations produce realistic variations.",
      "The key idea is that real-world data lies on a lower-dimensional manifold within the high-dimensional input space. Valid perturbations should move data points along this manifold rather than off it.",
      "In medical imaging, manifold-preserving perturbations might include realistic tissue variations, scanner artifacts that could occur in practice, or subtle anatomical differences — not simple occlusions or pixel noise.",
      "BrainTrust AI implements perturbation methods including generative inpainting and adversarial information masking (AIM) to create realistic variations for fragility analysis. Note: These are research methods, not validated clinical perturbation techniques.",
    ],
  },
  {
    id: "ofi-res",
    icon: <TrendingUp className="w-5 h-5" />,
    title: "OFI_res (Output Fragility Index — Residual)",
    content: [
      "OFI_res is a metric developed in the BrainTrust AI research framework to quantify how much a model's output changes when its input is perturbed while preserving the underlying data manifold.",
      "Formula (Version 1.0.0):",
      "OFI_res = |C_original - C_perturbed|",
      "Where:",
      "- C_original is the model's confidence for the predicted class on the original input",
      "- C_perturbed is the model's confidence for the predicted class on the perturbed input",
      "- |·| denotes absolute value",
      "The metric ranges from 0 to 1, where higher values indicate greater fragility. An OFI_res of 0 means the model's confidence is unchanged by the perturbation.",
      "OFI_res is a research metric and not a clinically validated diagnostic measure. It should be interpreted with caution and in conjunction with other evaluation methods.",
    ],
  },
  {
    id: "relevance-mass-accuracy",
    icon: <FileText className="w-5 h-5" />,
    title: "Relevance Mass Accuracy (RMA)",
    content: [
      "Relevance Mass Accuracy is an evaluation metric for saliency maps that measures how well the generated explanation aligns with ground-truth segmentation masks.",
      "RMA compares the spatial distribution of relevance scores (from Grad-CAM or similar methods) against expert-annotated tumor regions. Higher RMA scores indicate better alignment between model attention and clinically relevant areas.",
      "RMA is particularly important in medical imaging to ensure that models are focusing on actual pathological features rather than spurious correlations or imaging artifacts.",
      "RMA can only be calculated when ground-truth segmentation masks are available. In the absence of such masks, the metric cannot be meaningfully computed.",
    ],
  },
  {
    id: "generalized-additive-models",
    icon: <RefreshCw className="w-5 h-5" />,
    title: "Generalized Additive Models (GAMs)",
    content: [
      "Generalized Additive Models are a class of statistical models that extend linear regression by allowing non-linear relationships between predictors and the response variable through smooth functions.",
      "Unlike linear models that assume straight-line relationships, GAMs can capture curved, threshold, and other non-linear patterns. The general form is:",
      "g(E[Y]) = β₀ + f₁(X₁) + f₂(X₂) + ... + fₚ(Xₚ)",
      "Where g is a link function, β₀ is the intercept, and fᵢ are smooth functions (splines) for each predictor.",
      "In the BrainTrust AI framework, GAMs are used to analyze the relationship between tumor characteristics (like volume) and output fragility (OFI_res). This helps researchers understand whether larger tumors tend to be more or less fragile to perturbation.",
      "GAM analysis requires sufficient data points to fit the smooth functions reliably. Small sample sizes may lead to overfitting or unstable estimates.",
    ],
  },
  {
    id: "research-limitations",
    icon: <AlertTriangle className="w-5 h-5" />,
    title: "Research Limitations",
    content: [
      "This application is a research prototype developed for a B.Tech Computer Science and Engineering project. It is not a clinical diagnostic tool and should not be used for medical decision-making.",
      "Key limitations include:",
      "- Demo mode uses simulated predictions and visualizations, not real model inference",
      "- Perturbation methods are for demonstration purposes and not validated clinical techniques",
      "- OFI_res is a research metric with no established clinical standards",
      "- Evaluation metrics require ground-truth data that may not be available",
      "- The model has not been validated on clinical populations or real-world data",
      "- Results should be interpreted by qualified medical professionals if used for research purposes",
      "Future work may include integration with real trained models, validated perturbation methods, clinical dataset evaluation, and comparison with established benchmarks.",
    ],
  },
];

export default function Documentation() {
  const navigate = useNavigate();
  const [expandedSection, setExpandedSection] = useState<string | null>(docSections[0].id);

  const toggleSection = (id: string) => {
    setExpandedSection(expandedSection === id ? null : id);
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
              <h1 className="font-semibold text-[#12355B]">Documentation</h1>
              <p className="text-xs text-neutral-500">Research Framework Documentation</p>
            </div>
          </div>
          <span className="px-2 py-1 text-xs bg-[#12355B]/10 text-[#12355B] rounded">
            v1.0.0
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Introduction */}
        <Card className="border-neutral-200 mb-8">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-[#12355B]/10 flex items-center justify-center flex-shrink-0">
                <BookOpen className="w-6 h-6 text-[#12355B]" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-[#12355B] mb-2">
                  BrainTrust AI Documentation
                </h2>
                <p className="text-neutral-600 leading-relaxed">
                  This documentation provides an overview of the BrainTrust AI research framework,
                  including the methodology, key concepts, and technical approach for evaluating
                  AI model robustness in brain tumor MRI classification.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Documentation Sections */}
        <div className="space-y-4">
          {docSections.map((section) => (
            <Card
              key={section.id}
              className="border-neutral-200 overflow-hidden"
              onClick={() => toggleSection(section.id)}
              style={{ cursor: "pointer" }}
            >
              <CardHeader
                className={`pb-${expandedSection === section.id ? "0" : "4"} transition-all ${
                  expandedSection === section.id ? "bg-neutral-50" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                      expandedSection === section.id ? "bg-[#12355B]/10" : "bg-neutral-100"
                    }`}
                  >
                    {section.icon}
                  </div>
                  <div>
                    <CardTitle
                      className={`text-lg transition-all ${
                        expandedSection === section.id ? "text-[#12355B]" : "text-neutral-900"
                      }`}
                    >
                      {section.title}
                    </CardTitle>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {expandedSection === section.id ? "Click to collapse" : "Click to expand"}
                    </p>
                  </div>
                  <div className="ml-auto">
                    <svg
                      className={`w-5 h-5 text-neutral-400 transition-transform ${
                        expandedSection === section.id ? "rotate-180" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
              </CardHeader>
              {expandedSection === section.id && (
                <CardContent className="pt-2 border-t border-neutral-100">
                  <div className="space-y-3 text-sm text-neutral-600 leading-relaxed">
                    {section.content.map((paragraph, idx) => (
                      <p key={idx}>{paragraph}</p>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        {/* Research context */}
        <Card className="border-[#12355B]/20 bg-[#12355B]/5 mt-8">
          <CardContent className="pt-6">
            <h3 className="text-lg font-semibold text-[#12355B] mb-3">Research Context</h3>
            <p className="text-sm text-neutral-600 leading-relaxed mb-4">
              BrainTrust AI is developed as part of a B.Tech Computer Science and Engineering
              project focused on evaluating AI reasoning through inference-time perturbation analysis.
              The framework combines explainable AI, realistic image perturbation, and statistical
              modeling to assess how brain tumor classification models respond to input variations.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 text-xs bg-[#12355B]/10 text-[#12355B] rounded">
                BCE
              </span>
              <span className="px-2 py-1 text-xs bg-[#008C95]/10 text-[#008C95] rounded">
                ResNet50
              </span>
              <span className="px-2 py-1 text-xs bg-[#6C4AB6]/10 text-[#6C4AB6] rounded">
                Grad-CAM
              </span>
              <span className="px-2 py-1 text-xs bg-[#E58A2B]/10 text-[#E58A2B] rounded">
                OFI_res
              </span>
              <span className="px-2 py-1 text-xs bg-[#2E8B57]/10 text-[#2E8B57] rounded">
                GAM
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#E58A2B] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-neutral-600">
              This documentation is for educational and research purposes. The methods and
              metrics described are research prototypes and not validated clinical tools.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
