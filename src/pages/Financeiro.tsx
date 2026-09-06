import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ds/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ds/select";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as ChartTooltip,
} from "recharts";
import { Plus, DollarSign, Wallet, Clock3, PiggyBank, Landmark } from "lucide-react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Panel, PanelHeader, PanelBody } from "@/components/foundation/Panel";
import { StatStrip, type StatItem } from "@/components/foundation/StatStrip";
import { StatusChip, type StatusTone } from "@/components/foundation/StatusChip";
import { EmptyState } from "@/components/foundation/EmptyState";
import { LoadingState } from "@/components/foundation/LoadingState";
import { PaymentModal } from "@/components/health/PaymentModal";
import { BRL, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/components/health/types";

interface PaymentRow {
  id: string;
  patient_id: string;
  procedure_name: string;
  amount: number;
  payment_method: string;
  status: string;
  paid_at: string | null;
  created_at: string;
  notes: string | null;
  patient_name?: string;
}

const PAYMENT_TONES: Record<string, StatusTone> = {
  pending: "warning",
  paid: "success",
  overdue: "danger",
  refunded: "neutral",
};

export default function Financeiro() {
  const { orgId } = useOrg();
  const { toast } = useToast();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("month");
  const [createOpen, setCreateOpen] = useState(false);

  const fetchPayments = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      let q = (supabase as any)
        .from("payments")
        .select("id,patient_id,procedure_name,amount,payment_method,status,paid_at,created_at,notes")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (methodFilter !== "all") q = q.eq("payment_method", methodFilter);
      if (periodFilter !== "all") {
        const now = new Date();
        const start = new Date(now);
        if (periodFilter === "today") start.setHours(0, 0, 0, 0);
        else if (periodFilter === "week") start.setDate(now.getDate() - 7);
        else if (periodFilter === "month") start.setMonth(now.getMonth() - 1);
        else if (periodFilter === "year") start.setFullYear(now.getFullYear() - 1);
        q = q.gte("created_at", start.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      const payments = (data ?? []) as PaymentRow[];

      const patientIds = Array.from(new Set(payments.map((p) => p.patient_id)));
      if (patientIds.length) {
        const { data: pats } = await (supabase as any)
          .from("patients")
          .select("id,first_name,last_name")
          .in("id", patientIds);
        const pMap = new Map<string, string>((pats ?? []).map((p: any) => [p.id, `${p.first_name} ${p.last_name ?? ""}`.trim()]));
        setRows(payments.map((r) => ({ ...r, patient_name: pMap.get(r.patient_id) ?? "Paciente" })));
      } else {
        setRows(payments);
      }
    } catch (err: any) {
      toast({ title: "Erro ao carregar pagamentos", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [orgId, statusFilter, methodFilter, periodFilter, toast]);

  useEffect(() => { void fetchPayments(); }, [fetchPayments]);

  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

    const paid = rows.filter((r) => r.status === "paid");
    const monthRevenue = paid
      .filter((r) => r.paid_at && new Date(r.paid_at) >= monthStart)
      .reduce((acc, r) => acc + Number(r.amount), 0);
    const pending = rows.filter((r) => r.status === "pending").reduce((acc, r) => acc + Number(r.amount), 0);
    const paidToday = paid
      .filter((r) => r.paid_at && new Date(r.paid_at) >= todayStart)
      .reduce((acc, r) => acc + Number(r.amount), 0);

    const insuranceTotal = paid
      .filter((r) => r.payment_method === "insurance")
      .reduce((acc, r) => acc + Number(r.amount), 0);
    const totalPaid = paid.reduce((acc, r) => acc + Number(r.amount), 0);
    const insurancePct = totalPaid > 0 ? Math.round((insuranceTotal / totalPaid) * 100) : 0;

    // Daily revenue series (last 30 days, by paid_at)
    const days: { date: string; value: number }[] = [];
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const byDay = new Map<string, number>();
    for (const r of paid) {
      if (!r.paid_at) continue;
      const k = dayKey(new Date(r.paid_at));
      byDay.set(k, (byDay.get(k) ?? 0) + Number(r.amount));
    }
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(now.getDate() - i); d.setHours(0, 0, 0, 0);
      const k = dayKey(d);
      days.push({ date: k.slice(5), value: byDay.get(k) ?? 0 });
    }

    return { monthRevenue, pending, paidToday, insurancePct, particularPct: 100 - insurancePct, days };
  }, [rows]);

  const statItems: StatItem[] = [
    { label: "Receita do mês", value: BRL.format(stats.monthRevenue), icon: Wallet },
    {
      label: "Pendente",
      value: <span className="text-warning">{BRL.format(stats.pending)}</span>,
      icon: Clock3,
    },
    { label: "Pago hoje", value: BRL.format(stats.paidToday), icon: PiggyBank },
    {
      label: "Convênio vs Particular",
      value: `${stats.insurancePct}%`,
      hint: `convênio · ${stats.particularPct}% particular`,
      icon: Landmark,
    },
  ];

  const toolbar = (
    <>
      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos status</SelectItem>
          {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
        </SelectContent>
      </Select>
      <Select value={methodFilter} onValueChange={setMethodFilter}>
        <SelectTrigger className="w-[180px]"><SelectValue placeholder="Método" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos métodos</SelectItem>
          {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}
        </SelectContent>
      </Select>
      <Select value={periodFilter} onValueChange={setPeriodFilter}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Período" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Sempre</SelectItem>
          <SelectItem value="today">Hoje</SelectItem>
          <SelectItem value="week">Semana</SelectItem>
          <SelectItem value="month">Mês</SelectItem>
          <SelectItem value="year">Ano</SelectItem>
        </SelectContent>
      </Select>
    </>
  );

  return (
    <PageScaffold
      title="Financeiro"
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Registrar pagamento
        </Button>
      }
      toolbar={toolbar}
    >
      <div className="space-y-4">
      <StatStrip stats={statItems} />

      <Panel>
        <PanelHeader title="Receita diária (últimos 30 dias)" />
        <PanelBody className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.days}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `R$${v}`} />
              <ChartTooltip formatter={(v: number) => BRL.format(Number(v))} />
              <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" fill="url(#rev)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </PanelBody>
      </Panel>

      {loading ? (
        <LoadingState label="Carregando pagamentos…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="Nenhum pagamento registrado"
          description="Registre o primeiro pagamento para começar a acompanhar a receita."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Registrar pagamento
            </Button>
          }
        />
      ) : (
        <Panel className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paciente</TableHead>
                <TableHead>Procedimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Método</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.patient_name ?? "Paciente"}</TableCell>
                  <TableCell>{r.procedure_name}</TableCell>
                  <TableCell className="font-mono">{BRL.format(Number(r.amount))}</TableCell>
                  <TableCell>{PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method}</TableCell>
                  <TableCell>
                    <StatusChip tone={PAYMENT_TONES[r.status] ?? "neutral"}>
                      {PAYMENT_STATUS_LABELS[r.status] ?? r.status}
                    </StatusChip>
                  </TableCell>
                  <TableCell className="text-sm">
                    {(r.paid_at ? new Date(r.paid_at) : new Date(r.created_at)).toLocaleDateString("pt-BR")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      <PaymentModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void fetchPayments()}
      />
      </div>
    </PageScaffold>
  );
}
