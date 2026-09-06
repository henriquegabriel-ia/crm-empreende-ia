import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ds/button";
import { LoadingState } from "@/components/foundation/LoadingState";
import { EmptyState } from "@/components/foundation/EmptyState";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Lightbulb, AlertTriangle, CheckCircle2, Info, XCircle, RefreshCw } from "lucide-react";
import { useOrg } from "@/hooks/useOrg";
import { supabase } from "@/integrations/supabase/client";

type Insight = {
  title: string;
  description: string;
  type: "warning" | "success" | "info" | "danger";
  action_label: string;
  action_route: string;
};

const typeConfig = {
  warning: { icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10", border: "border-warning/20" },
  success: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10", border: "border-success/20" },
  info: { icon: Info, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  danger: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
};

export function AIInsightsPanel() {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(false);

  const fetchInsights = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-insights", {
        body: { org_id: orgId },
      });
      if (error) throw error;
      setInsights(data?.insights || []);
      setDismissed(new Set());
    } catch (e) {
      console.error("Failed to fetch insights:", e);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    if (open && insights.length === 0 && !loading) fetchInsights();
  }, [open, orgId]);

  const visibleInsights = insights.filter((_, i) => !dismissed.has(i));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8 rounded-full" aria-label="AI Insights">
          <Lightbulb className="h-4 w-4" />
          {insights.length > 0 && visibleInsights.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-warning text-[8px] font-bold flex items-center justify-center text-warning-foreground">
              {visibleInsights.length}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 space-y-0.5 border-b border-border px-6 py-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
                Inteligência
              </span>
              <SheetTitle className="text-base font-semibold">AI Insights</SheetTitle>
              <SheetDescription className="text-xs">Análise automática do seu CRM</SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              onClick={fetchInsights}
              disabled={loading}
              aria-label="Atualizar insights"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {loading && insights.length === 0 && (
              <LoadingState label="Analisando seus dados…" />
            )}

            {!loading && visibleInsights.length === 0 && (
              <EmptyState
                icon={CheckCircle2}
                title="Tudo em dia!"
                description="Nenhum insight pendente."
                action={
                  <Button variant="outline" size="sm" className="text-xs" onClick={fetchInsights}>
                    Verificar novamente
                  </Button>
                }
              />
            )}

            {visibleInsights.map((insight, idx) => {
              const originalIdx = insights.indexOf(insight);
              const config = typeConfig[insight.type] || typeConfig.info;
              const Icon = config.icon;
              return (
                <div
                  key={originalIdx}
                  className={`rounded-lg border ${config.border} ${config.bg} p-3 space-y-2`}
                >
                  <div className="flex items-start gap-2">
                    <Icon className={`h-4 w-4 ${config.color} shrink-0 mt-0.5`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">{insight.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{insight.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => { navigate(insight.action_route); setOpen(false); }}
                    >
                      {insight.action_label}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => setDismissed((prev) => new Set(prev).add(originalIdx))}
                    >
                      Descartar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
