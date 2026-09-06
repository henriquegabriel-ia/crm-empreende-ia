import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/foundation/StatusChip";
import { BrandGlyph } from "@/components/brand/Wordmark";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import confetti from "canvas-confetti";
import { WelcomeStep } from "./WelcomeStep";
import { CompanyStep } from "./CompanyStep";

import { PipelineStep } from "./PipelineStep";
import { AICopilotStep } from "./AICopilotStep";
import { EmailStep } from "./EmailStep";
import { SlackStep } from "./SlackStep";
import { CompleteStep } from "./CompleteStep";
import { getResumeStep, loadPersistedOnboardingState } from "./persistence";
import type { OnboardingStepProps } from "./types";

const STEPS = [
  { key: "welcome", label: "Boas-vindas", required: true },
  { key: "company", label: "Empresa", required: true },
  { key: "pipeline", label: "Pipeline", required: true },
  { key: "ai", label: "AI Copilot", required: false },
  { key: "email", label: "Email", required: false },
  { key: "slack", label: "Slack", required: false },
  { key: "complete", label: "Conclusão", required: true },
];

export function OnboardingModal() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const modalRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [canContinue, setCanContinue] = useState(false);
  const [direction, setDirection] = useState<"left" | "right">("left");
  const [stepData, setStepData] = useState<Record<string, any>>({});
  const [orgId, setOrgId] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  const initializedRef = useRef(false);

  const hydrateAndOpen = useCallback(async (opts?: { reset?: boolean; forceStartAtZero?: boolean }) => {
    if (!user) return;
    setIsOpen(true);

    if (opts?.reset) {
      setCompletedSteps(new Set());
      setStepData({});
    }

    const orgIdToUse = (profile as any)?.org_id ?? null;
    const persisted = await loadPersistedOnboardingState(user.id, orgIdToUse);
    const savedStep = (profile as any)?.onboarding_step;
    const resumeStep = opts?.forceStartAtZero ? 0 : getResumeStep(savedStep, persisted.completedSteps);

    if (persisted.orgId) setOrgId(persisted.orgId);
    if (!opts?.reset && persisted.completedSteps.size > 0) {
      setCompletedSteps(new Set(persisted.completedSteps));
    }
    if (!opts?.reset && Object.keys(persisted.stepData).length > 0) {
      setStepData((prev) => ({ ...prev, ...persisted.stepData }));
    }

    setCurrentStep(resumeStep);

    if ((savedStep ?? 1) < resumeStep + 1) {
      await (supabase as any).from("profiles").update({ onboarding_step: resumeStep + 1 } as any).eq("id", user.id);
    }
  }, [user, profile]);

  useEffect(() => {
    if (!user || !profile || initializedRef.current) return;
    const p = profile as any;
    if (profile.org_id) setOrgId(profile.org_id);
    if (p.onboarding_completed) return;

    initializedRef.current = true;
    void hydrateAndOpen();
  }, [user, profile, hydrateAndOpen]);

  // Listen for explicit re-open requests from Settings > Onboarding
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ reason?: "review" | "reset" }>).detail;
      initializedRef.current = true;
      void hydrateAndOpen({
        reset: detail?.reason === "reset",
        forceStartAtZero: detail?.reason === "reset",
      });
    };
    window.addEventListener("flowcrm:open-onboarding", handler);
    return () => window.removeEventListener("flowcrm:open-onboarding", handler);
  }, [hydrateAndOpen]);

  // Focus trap + block Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); return; }
      if (e.key === "Tab" && modalRef.current) {
        const els = modalRef.current.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
        );
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const saveProgress = useCallback(async (step: number) => {
    if (!user) return;
    await (supabase as any).from("profiles").update({ onboarding_step: step + 1 } as any).eq("id", user.id);
  }, [user]);

  const advancingRef = useRef(false);

  const handleNext = useCallback(() => {
    if (advancingRef.current) return;
    if (currentStep < STEPS.length - 1) {
      advancingRef.current = true;
      const next = currentStep + 1;
      setDirection("left");
      setCompletedSteps(prev => new Set([...prev, STEPS[currentStep].key]));
      setCurrentStep(next);
      setCanContinue(false);
      // Save progress to profile (non-blocking, using setTimeout to avoid re-fetch loop)
      if (user) {
        setTimeout(() => {
          (supabase as any).from("profiles").update({ onboarding_step: next + 1 } as any).eq("id", user.id);
        }, 0);
      }
      setTimeout(() => { advancingRef.current = false; }, 300);
    }
  }, [currentStep, user]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setDirection("right");
      setCurrentStep(currentStep - 1);
      setCanContinue(true);
    }
  }, [currentStep]);

  const handleComplete = useCallback(async (navigateTo?: string) => {
    if (!user) return;
    confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });

    // Mark onboarding as completed in profile
    await (supabase as any).from("profiles").update({ onboarding_completed: true, onboarding_step: STEPS.length } as any).eq("id", user.id);

    // Update onboarding_progress table for full tracking
    if (orgId) {
      const progressData: Record<string, any> = {
        user_id: user.id,
        org_id: orgId,
        completed: true,
        profile_configured: completedSteps.has("company") || !!stepData.orgName,
        pipeline_created: completedSteps.has("pipeline") || !!stepData.pipelineName,
        email_connected: !!stepData.emailConfigured,
      };
      const { data: existing } = await (supabase as any)
        .from("onboarding_progress")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) {
        await (supabase as any).from("onboarding_progress").update(progressData).eq("id", (existing as any).id);
      } else {
        await (supabase as any).from("onboarding_progress").insert(progressData as any);
      }
    }

    setTimeout(() => {
      setIsOpen(false);
      if (navigateTo) navigate(navigateTo);
    }, 600);
  }, [user, navigate, orgId, completedSteps, stepData]);

  const updateStepData = useCallback((key: string, value: any) => {
    setStepData(prev => ({ ...prev, [key]: value }));
  }, []);

  if (!isOpen) return null;

  const step = STEPS[currentStep];
  const progress = ((currentStep + 1) / STEPS.length) * 100;
  const isWelcome = step.key === "welcome";
  const isComplete = step.key === "complete";
  const showFooter = !isWelcome && !isComplete;

  const stepProps: OnboardingStepProps = {
    orgId,
    userId: user?.id ?? "",
    userEmail: user?.email ?? "",
    userName: (profile as any)?.name ?? user?.email?.split("@")[0] ?? "",
    stepData,
    setStepData: updateStepData,
    setCanContinue,
    onNext: handleNext,
    onComplete: handleComplete,
    setOrgId,
    completedSteps,
  };

  const renderStep = () => {
    switch (step.key) {
      case "welcome": return <WelcomeStep {...stepProps} />;
      case "company": return <CompanyStep {...stepProps} />;
      case "pipeline": return <PipelineStep {...stepProps} />;
      case "ai": return <AICopilotStep {...stepProps} />;
      case "email": return <EmailStep {...stepProps} />;
      case "slack": return <SlackStep {...stepProps} />;
      case "complete": return <CompleteStep {...stepProps} />;
      default: return null;
    }
  };

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[100] flex bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="Configuração inicial"
    >
      {/* Rail esquerdo — mapa vertical dos passos (takeover full-screen) */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-3 px-5 pb-4 pt-6">
          <BrandGlyph className="h-9 w-9 rounded-xl" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-sidebar-foreground">Configuração inicial</p>
            <p className="text-xs text-muted-foreground">
              Passo {currentStep + 1} de {STEPS.length}
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Passos da configuração">
          {STEPS.map((s, index) => {
            const isCompleted = index < currentStep || completedSteps.has(s.key);
            const isActive = index === currentStep;
            return (
              <div
                key={s.key}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm",
                  isActive ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : isCompleted
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground"
                  )}
                >
                  {isCompleted && !isActive ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {!s.required && (
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">opcional</span>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Área do conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Progresso fino no mobile */}
        <div className="h-1 w-full bg-muted md:hidden" aria-hidden>
          <div
            className="h-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {showFooter && (
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              Passo {currentStep + 1} de {STEPS.length} · {step.label}
            </p>
            <StatusChip tone={step.required ? "info" : "neutral"}>
              {step.required ? "Obrigatório" : "Opcional"}
            </StatusChip>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div
            key={currentStep}
            className="onboarding-slide-in mx-auto w-full max-w-xl px-4 py-8 sm:px-6"
            style={{ animationName: direction === "left" ? "onboardingSlideLeft" : "onboardingSlideRight" }}
          >
            {renderStep()}
          </div>
        </div>

        {showFooter && (
          <footer className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-6">
            <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
              <Button variant="ghost" size="sm" onClick={handleBack} disabled={currentStep <= 1}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
              </Button>
              <div className="flex items-center gap-2">
                {!step.required && (
                  <Button variant="ghost" size="sm" onClick={handleNext}>
                    Pular por agora
                  </Button>
                )}
                <Button size="sm" onClick={handleNext} disabled={step.required && !canContinue}>
                  Continuar <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
