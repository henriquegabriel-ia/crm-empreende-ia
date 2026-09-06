import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Check, UserPlus, CalendarCheck2 } from "lucide-react";
import type { OnboardingStepProps } from "./types";

export function PipelineStep({ orgId, setCanContinue, setStepData }: OnboardingStepProps) {
  const [patientCount, setPatientCount] = useState<number | null>(null);
  const [appointmentCount, setAppointmentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const [{ count: p }, { count: a }] = await Promise.all([
        (supabase as any).from("patients").select("id", { count: "exact", head: true }).eq("org_id", orgId),
        (supabase as any)
          .from("activities")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .not("appointment_status", "is", null),
      ]);
      if (cancelled) return;
      setPatientCount(p ?? 0);
      setAppointmentCount(a ?? 0);
      // User can continue at any time — this step is informational
      setCanContinue(true);
      if ((a ?? 0) > 0) setStepData("pipelineName", "Primeira consulta agendada");
    })();
    return () => { cancelled = true; };
  }, [orgId, setCanContinue, setStepData]);

  const hasPatient = (patientCount ?? 0) > 0;
  const hasAppointment = (appointmentCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Sua primeira consulta</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Em dois passos você está com o app no ar: cadastra um paciente e agenda a primeira consulta.
          Pode pular agora e voltar quando quiser.
        </p>
      </div>

      <div className="grid gap-3">
        <div className={`flex items-start gap-3 rounded-xl border p-4 ${hasPatient ? "border-success/40 bg-success/5" : "border-border"}`}>
          <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${hasPatient ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}>
            {hasPatient ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium">1. Cadastre seu primeiro paciente</p>
            <p className="text-sm text-muted-foreground">Você pode usar dados reais ou um paciente fictício para testar.</p>
            {!hasPatient && (
              <Button asChild size="sm" variant="outline" className="mt-2">
                <Link to="/patients">Cadastrar paciente</Link>
              </Button>
            )}
          </div>
        </div>

        <div className={`flex items-start gap-3 rounded-xl border p-4 ${hasAppointment ? "border-success/40 bg-success/5" : "border-border"}`}>
          <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${hasAppointment ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}>
            {hasAppointment ? <Check className="h-4 w-4" /> : <CalendarCheck2 className="h-4 w-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium">2. Agende a primeira consulta</p>
            <p className="text-sm text-muted-foreground">Defina data, hora e profissional. O paciente recebe lembrete via WhatsApp.</p>
            {!hasAppointment && hasPatient && (
              <Button asChild size="sm" variant="outline" className="mt-2">
                <Link to="/agenda">Agendar consulta</Link>
              </Button>
            )}
            {!hasPatient && (
              <p className="mt-2 text-xs text-muted-foreground">Disponível após cadastrar o primeiro paciente.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
