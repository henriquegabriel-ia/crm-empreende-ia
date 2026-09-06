import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Check, UserPlus, Calendar, Rocket, PartyPopper } from "lucide-react";
import confetti from "canvas-confetti";
import type { OnboardingStepProps } from "./types";

interface CheckItem {
  key: string;
  label: string;
  value?: string;
  configured: boolean;
}

export function CompleteStep({ stepData, completedSteps, onComplete }: OnboardingStepProps) {
  useEffect(() => {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    const t = setTimeout(() => confetti({ particleCount: 50, spread: 100, origin: { y: 0.5 } }), 400);
    return () => clearTimeout(t);
  }, []);

  const items: CheckItem[] = [
    {
      key: "company",
      label: "Clínica",
      value: stepData.orgName || undefined,
      configured: completedSteps.has("company") || !!stepData.orgName,
    },
    {
      key: "pipeline",
      label: "Primeira consulta",
      value: stepData.pipelineName
        ? `${stepData.pipelineName} — ${stepData.stageCount} etapas`
        : undefined,
      configured: completedSteps.has("pipeline") || !!stepData.pipelineName,
    },
    {
      key: "ai",
      label: "IA Clínica",
      value: stepData.aiConfigured ? "Claude ativo" : "Não configurado",
      configured: !!stepData.aiConfigured,
    },
    {
      key: "email",
      label: "Email (Resend)",
      value: stepData.emailFrom || "Não configurado",
      configured: !!stepData.emailConfigured,
    },
    {
      key: "slack",
      label: "Slack",
      value: stepData.slackWorkspace || "Não configurado",
      configured: !!stepData.slackConfigured,
    },
  ];

  const configuredCount = items.filter((i) => i.configured).length;

  const handleAction = (route: string) => {
    onComplete(route);
  };

  return (
    <div className="space-y-6 py-4">
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-success/10 text-success">
          <PartyPopper className="h-5 w-5" />
        </div>
        <h2 className="font-display text-xl font-semibold tracking-tight">Tudo pronto!</h2>
        <p className="text-sm text-muted-foreground">
          Comece cadastrando seus pacientes. {configuredCount}/{items.length} itens configurados:
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {items.map((item) => (
          <div key={item.key} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                item.configured ? "bg-primary" : "bg-muted"
              }`}
            >
              {item.configured ? (
                <Check className="h-3.5 w-3.5 text-primary-foreground" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground truncate">
                {item.value || "Não configurado"}
              </p>
            </div>
            {!item.configured && (
              <button
                onClick={() => handleAction("/settings")}
                className="text-xs text-primary hover:underline shrink-0"
              >
                configurar
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Tudo que ficou pendente pode ser configurado a qualquer momento em{" "}
        <span className="font-medium text-foreground">Configurações → Integrações</span>.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Button
          variant="outline"
          className="h-auto py-3 flex-col gap-1"
          onClick={() => handleAction("/patients")}
        >
          <UserPlus className="h-5 w-5" />
          <span className="text-xs">Cadastrar primeiro paciente</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-3 flex-col gap-1"
          onClick={() => handleAction("/agenda")}
        >
          <Calendar className="h-5 w-5" />
          <span className="text-xs">Abrir agenda</span>
        </Button>
        <Button
          className="h-auto py-3 flex-col gap-1"
          onClick={() => handleAction("/dashboard")}
        >
          <Rocket className="h-5 w-5" />
          <span className="text-xs">Ir para o Dashboard</span>
        </Button>
      </div>
    </div>
  );
}
