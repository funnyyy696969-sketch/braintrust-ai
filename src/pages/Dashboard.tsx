import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router";
import {
  Brain,
  Scan,
  Eye,
  Scissors,
  AlertTriangle,
  LayoutDashboard,
  FileText,
  Settings,
  LogOut,
} from "lucide-react";

interface NavCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  href: string;
}

import React from "react";

function NavCard({ icon, title, description, color, href }: NavCardProps) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(href)}
      className="text-left w-full p-0 rounded-lg border border-neutral-200 bg-white hover:border-opacity-60 transition-all group"
    >
      <Card className="border-0 shadow-none h-full" style={{ borderColor: `${color}25` }}>
        <CardHeader className="pb-2">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 transition-colors"
            style={{ backgroundColor: `${color}15` }}
          >{icon}</div
          >
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-600">{description}</p>
        </CardContent>
      </Card>
    </button>
  );
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const navCards = [
    {
      icon: <Scan className="w-5 h-5" />,
      title: "Analyze MRI",
      description: "Upload a scan and get an AI prediction",
      color: "#12355B",
      href: "/mri-analysis",
    },
    {
      icon: <Eye className="w-5 h-5" />,
      title: "Explain",
      description: "See where the model is focusing its attention",
      color: "#6C4AB6",
      href: "/explainability",
    },
    {
      icon: <Scissors className="w-5 h-5" />,
      title: "Perturb",
      description: "Apply realistic changes to test prediction stability",
      color: "#E58A2B",
      href: "/perturbation",
    },
    {
      icon: <AlertTriangle className="w-5 h-5" />,
      title: "Measure Fragility",
      description: "Quantify how much predictions change under perturbation",
      color: "#2E8B57",
      href: "/output-fragility",
    },
    {
      icon: <LayoutDashboard className="w-5 h-5" />,
      title: "Evaluate",
      description: "Run RMA, GAM analysis, and statistical checks",
      color: "#12355B",
      href: "/evaluation",
    },
    {
      icon: <FileText className="w-5 h-5" />,
      title: "Documentation",
      description: "How the framework works and why it matters",
      color: "#6C4AB6",
      href: "/documentation",
    },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[#12355B] flex items-center justify-center">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-[#12355B]">Your Dashboard</h1>
              <p className="text-xs text-neutral-500">Analysis workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {user && (
              <span className="text-sm text-neutral-600">
                {user.name || "User"}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="text-neutral-600"
            >
              <LogOut className="w-4 h-4 mr-1" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Session Info */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <Card className="bg-white border-neutral-200 shadow-none">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#12355B]/10 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-[#12355B]" />
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Your Analyses</p>
                  <p className="text-xl font-semibold text-[#12355B]">0</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-neutral-200 shadow-none">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#008C95]/10 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-[#008C95]" />
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Current Model</p>
                  <p className="text-xl font-semibold text-[#12355B]">ResNet50</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-neutral-200 shadow-none">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center">
                  <Scan className="w-4 h-4 text-neutral-500" />
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Last Analysis</p>
                  <p className="text-xl font-semibold text-neutral-600">—</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-neutral-200 shadow-none">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#E58A2B]/10 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-[#E58A2B]" />
                </div>
                <div>
                  <p className="text-xs text-neutral-500">OFI_res Overview</p>
                  <p className="text-xl font-semibold text-neutral-600">—</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Navigation Cards */}
        <section>
          <h2 className="text-lg font-semibold text-[#12355B] mb-4">Quick Navigation</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {navCards.map((card) => (
              <NavCard key={card.href} {...card} />
            ))}
          </div>
        </section>

        {/* Settings */}
        <section className="mt-8 pt-8 border-t border-neutral-200">
          <Button
            variant="outline"
            className="border-neutral-300"
            onClick={() => navigate("/settings")}
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
        </section>
      </main>
    </div>
  );
}
