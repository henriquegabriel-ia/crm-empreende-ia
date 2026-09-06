import { Calendar, Bot, MessageSquare, ArrowRight } from "lucide-react";
import { Button } from "@/components/ds/button";
import { BrandGlyph } from "@/components/brand/Wordmark";
import type { OnboardingStepProps } from "./types";

const features = [
  { icon: Calendar, label: "Agenda inteligente", desc: "Confirmações automáticas" },
  { icon: Bot, label: "IA Clínica", desc: "Resumo SOAP por Claude" },
  { icon: MessageSquare, label: "WhatsApp", desc: "Lembretes integrados" },
];

export function WelcomeStep({ userName, onNext }: OnboardingStepProps) {
  const firstName = userName?.split(" ")[0] || "usuário";

  return (
    <div className="text-center space-y-8 py-6">
      <BrandGlyph className="mx-auto h-14 w-14 rounded-2xl" />

      <div className="space-y-2">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Bem-vindo ao Empreende.IA CRM, {firstName}!
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Vamos configurar a sua clínica em menos de 5 minutos: você elimina o papel,
          automatiza confirmações e ganha um prontuário com IA. Pode pular qualquer integração e voltar nela em Configurações.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
        {features.map((f) => (
          <div key={f.label} className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-muted/40 p-4">
            <f.icon className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">{f.label}</span>
            <span className="text-xs text-muted-foreground">{f.desc}</span>
          </div>
        ))}
      </div>

      <Button size="lg" onClick={onNext} className="px-8">
        Vamos começar <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );
}
