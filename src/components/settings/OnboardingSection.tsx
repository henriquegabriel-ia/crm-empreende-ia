import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ds/button";
import { Input } from "@/components/ds/input";
import { Label } from "@/components/ui/label";
import { Panel, PanelHeader, PanelBody } from "@/components/foundation/Panel";
import { StatusChip } from "@/components/foundation/StatusChip";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ds/dialog";
import { RotateCcw, Eye, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { loadPersistedOnboardingState } from "@/components/onboarding/persistence";

const TOTAL_STEPS = 7;

export function OnboardingSection() {
  const { user, profile, refreshProfile } = useAuth();
  const { orgId } = useOrg();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [completedCount, setCompletedCount] = useState<number>(0);
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const isCompleted = (profile as any)?.onboarding_completed === true;

  const refreshStatus = useCallback(async () => {
    if (!user?.id) return;
    const { completedSteps } = await loadPersistedOnboardingState(user.id, orgId ?? null);
    // +2 = Welcome + Complete contam quando onboarding_completed = true
    setCompletedCount(completedSteps.size + (isCompleted ? 2 : 0));
  }, [user?.id, orgId, isCompleted]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const handleReview = async () => {
    if (!user?.id) return;
    setReviewing(true);
    const { error } = await (supabase as any).from("profiles")
      .update({ onboarding_completed: false, onboarding_step: 1 } as any)
      .eq("id", user.id);
    if (error) {
      toast({ title: "Erro ao reabrir", description: error.message, variant: "destructive" });
      setReviewing(false);
      return;
    }
    await refreshProfile();
    toast({ title: "Assistente reaberto", description: "Suas configurações foram preservadas." });
    navigate("/dashboard");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("empreende-crm:open-onboarding", { detail: { reason: "review" } }));
    }, 50);
  };

  const handleReset = async () => {
    if (!user?.id || !orgId) return;
    setResetting(true);
    try {
      await Promise.all([
        (supabase as any).from("pipeline_stages").delete().eq("org_id", orgId),
        (supabase as any).from("integration_configs").delete().eq("org_id", orgId),
        (supabase as any).from("org_secrets").delete().eq("org_id", orgId),
        (supabase as any).from("onboarding_progress").delete().eq("user_id", user.id),
      ]);
      await (supabase as any).from("pipelines").delete().eq("org_id", orgId);
      await (supabase as any).from("organizations")
        .update({ name: "Minha Empresa", settings: {} } as any)
        .eq("id", orgId);
      await (supabase as any).from("profiles")
        .update({ onboarding_completed: false, onboarding_step: 1 } as any)
        .eq("id", user.id);
      await refreshProfile();
      toast({ title: "Configuração resetada", description: "Iniciando onboarding do zero." });
      navigate("/dashboard");
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("empreende-crm:open-onboarding", { detail: { reason: "reset" } }));
      }, 50);
    } catch (e: any) {
      toast({ title: "Erro ao resetar", description: e?.message, variant: "destructive" });
      setResetting(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            Onboarding
            {isCompleted && <StatusChip tone="success" className="text-xs">Concluído</StatusChip>}
          </span>
        }
        description="Refaça ou revise a configuração inicial da plataforma."
      />
      <PanelBody className="space-y-4">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{completedCount}</span> de {TOTAL_STEPS} passos configurados
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleReview} disabled={reviewing}>
            <Eye className="mr-1 h-3 w-3" /> Revisar configuração
          </Button>

          <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={() => setResetOpen(true)}>
            <RotateCcw className="mr-1 h-3 w-3" /> Resetar e refazer
          </Button>

          <Dialog
            open={resetOpen}
            onOpenChange={(o) => {
              if (resetting) return;
              setResetOpen(o);
              if (!o) setConfirmText("");
            }}
          >
            <DialogContent className="max-w-sm gap-3">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Resetar onboarding
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Esta ação <strong>apaga permanentemente</strong> os itens abaixo.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-xs">
                <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                  <li>Todos os pipelines e estágios</li>
                  <li>Integrações conectadas (AI, Email, Slack)</li>
                  <li>Segredos e chaves de API armazenados</li>
                  <li>Configurações da organização (nome, segmento, moeda)</li>
                </ul>
                <div className="text-muted-foreground">
                  Contatos, empresas, negócios, atividades e imóveis <strong>não</strong> são apagados.
                </div>
                <div className="pt-2 space-y-1">
                  <Label className="text-xs">Digite <code className="px-1 py-0.5 bg-muted rounded text-xs">RESETAR</code> para confirmar:</Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="h-8 text-xs"
                    autoFocus
                  />
                </div>
              </div>
              <DialogFooter className="mt-2 gap-2 sm:gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={resetting}
                  onClick={() => { setResetOpen(false); setConfirmText(""); }}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={confirmText !== "RESETAR" || resetting}
                  onClick={handleReset}
                >
                  {resetting ? "Resetando..." : "Resetar tudo"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
          <div><strong>Revisar:</strong> reabre o assistente preservando dados existentes.</div>
          <div><strong>Resetar:</strong> apaga pipeline, integrações e configurações da organização.</div>
        </div>
      </PanelBody>
    </Panel>
  );
}
