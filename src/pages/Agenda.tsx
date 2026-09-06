import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Search, Calendar as CalendarIcon, Check, XCircle, AlertTriangle, ListChecks,
  ChevronLeft, ChevronRight, List as ListIcon, LayoutGrid,
} from "lucide-react";
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay,
  isSameMonth, startOfMonth, startOfWeek, subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Panel, SectionLabel } from "@/components/foundation/Panel";
import { StatusChip, type StatusTone } from "@/components/foundation/StatusChip";
import { LoadingState } from "@/components/foundation/LoadingState";
import { EmptyState } from "@/components/crm/EmptyState";
import { AppointmentCreateModal } from "@/components/health/AppointmentCreateModal";
import { PatientDrawer } from "@/components/health/PatientDrawer";
import {
  APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS,
  AppointmentStatus, AppointmentType, fullName,
} from "@/components/health/types";

interface AppointmentRow {
  id: string;
  title: string;
  body: string | null;
  due_date: string | null;
  appointment_status: AppointmentStatus;
  appointment_type: AppointmentType | null;
  duration_minutes: number | null;
  professional_id: string | null;
  contact_id: string | null;
  patient?: { id: string; first_name: string; last_name: string | null; phone: string } | null;
  professional?: { id: string; name: string } | null;
}

/** Tom semântico por status de consulta (tokens light+dark). */
const STATUS_TONE: Record<AppointmentStatus, StatusTone> = {
  scheduled: "info",
  confirmed: "success",
  attended: "neutral",
  no_show: "warning",
  cancelled: "danger",
};

/** Versão compacta pros chips do calendário. */
const STATUS_CELL_CLASS: Record<AppointmentStatus, string> = {
  scheduled: "bg-primary/10 text-primary",
  confirmed: "bg-success/10 text-success",
  attended: "bg-muted text-muted-foreground",
  no_show: "bg-warning/10 text-warning",
  cancelled: "bg-destructive/10 text-destructive",
};

export default function Agenda() {
  const { orgId } = useOrg();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const defaultPatient = params.get("patient") ?? undefined;

  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [professionalFilter, setProfessionalFilter] = useState<string>("all");
  const [professionals, setProfessionals] = useState<{ id: string; name: string }[]>([]);
  const [createOpen, setCreateOpen] = useState<boolean>(Boolean(defaultPatient));
  const [drawerPatientId, setDrawerPatientId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [cursor, setCursor] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  const fetchProfessionals = useCallback(async () => {
    if (!orgId) return;
    const { data } = await (supabase as any)
      .from("professionals")
      .select("id,name")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("name");
    setProfessionals((data ?? []) as { id: string; name: string }[]);
  }, [orgId]);

  const fetchAppointments = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      let q = (supabase as any)
        .from("activities")
        .select(
          "id,title,body,due_date,appointment_status,appointment_type,duration_minutes,professional_id,contact_id," +
          "patient:patients!activities_contact_id_fkey(id,first_name,last_name,phone)," +
          "professional:profiles!activities_professional_id_fkey(id,name)"
        )
        .eq("org_id", orgId)
        .not("appointment_status", "is", null)
        .order("due_date", { ascending: false })
        .limit(200);

      if (statusFilter !== "all") q = q.eq("appointment_status", statusFilter);
      if (typeFilter !== "all") q = q.eq("appointment_type", typeFilter);
      if (professionalFilter !== "all") q = q.eq("professional_id", professionalFilter);

      const { data, error } = await q;
      if (error) {
        // Fall back to query without FK aliases (when types not yet present)
        const { data: rawData, error: rawErr } = await (supabase as any)
          .from("activities")
          .select("id,title,body,due_date,appointment_status,appointment_type,duration_minutes,professional_id,contact_id")
          .eq("org_id", orgId)
          .not("appointment_status", "is", null)
          .order("due_date", { ascending: false })
          .limit(200);
        if (rawErr) throw rawErr;
        setRows((rawData ?? []) as AppointmentRow[]);
      } else {
        setRows((data ?? []) as AppointmentRow[]);
      }
    } catch (err: any) {
      toast({ title: "Erro ao carregar agenda", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [orgId, statusFilter, typeFilter, professionalFilter, toast]);

  useEffect(() => { void fetchProfessionals(); }, [fetchProfessionals]);
  useEffect(() => { void fetchAppointments(); }, [fetchAppointments]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      const name = r.patient ? fullName(r.patient).toLowerCase() : "";
      return name.includes(term) || (r.title ?? "").toLowerCase().includes(term);
    });
  }, [rows, search]);

  const grouped = useMemo(() => {
    const byDay: Record<string, AppointmentRow[]> = {};
    for (const r of filtered) {
      const key = r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : "sem-data";
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(r);
    }
    return Object.entries(byDay).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [filtered]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const byDayMap = useMemo(() => {
    const m = new Map<string, AppointmentRow[]>();
    for (const r of filtered) {
      if (!r.due_date) continue;
      const key = format(new Date(r.due_date), "yyyy-MM-dd");
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    // sort each day by time
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));
    }
    return m;
  }, [filtered]);

  const selectedDayAppts = byDayMap.get(format(selectedDay, "yyyy-MM-dd")) ?? [];

  const updateStatus = async (id: string, status: AppointmentStatus) => {
    try {
      const { error } = await (supabase as any)
        .from("activities")
        .update({ appointment_status: status })
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Status atualizado", description: APPOINTMENT_STATUS_LABELS[status] });
      void fetchAppointments();
    } catch (err: any) {
      toast({ title: "Erro ao atualizar", description: err?.message ?? String(err), variant: "destructive" });
    }
  };

  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  return (
    <PageScaffold
      title="Agenda"
      meta={
        <StatusChip tone="neutral" dot={false} className="capitalize">
          {today}
        </StatusChip>
      }
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Nova consulta
        </Button>
      }
      toolbar={
        <>
          <div className="relative w-full max-w-xs shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar paciente ou consulta…"
              className="h-9 rounded-lg pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[160px] shrink-0 rounded-lg"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              {Object.entries(APPOINTMENT_STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 w-[160px] shrink-0 rounded-lg"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos tipos</SelectItem>
              {Object.entries(APPOINTMENT_TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={professionalFilter} onValueChange={setProfessionalFilter}>
            <SelectTrigger className="h-9 w-[180px] shrink-0 rounded-lg"><SelectValue placeholder="Médico" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os médicos</SelectItem>
              {professionals.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
            </SelectContent>
          </Select>
          <span aria-hidden className="hidden h-5 w-px shrink-0 bg-border sm:block" />
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors",
                view === "list"
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <ListIcon className="h-3.5 w-3.5" /> Lista
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              aria-pressed={view === "calendar"}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors",
                view === "calendar"
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Calendário
            </button>
          </div>
        </>
      }
    >
      {loading ? (
        <LoadingState label="Carregando agenda…" className="py-16" />
      ) : view === "list" && filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon className="h-7 w-7" />}
          title="Nenhuma consulta encontrada"
          description="Agende a primeira consulta para começar a montar a agenda."
          actionLabel="Agendar primeira consulta"
          onAction={() => setCreateOpen(true)}
        />
      ) : view === "list" ? (
        <div className="space-y-5">
          {grouped.map(([day, list]) => (
            <div key={day} className="space-y-2">
              <SectionLabel className="capitalize">
                {day === "sem-data" ? "Sem data" : new Date(day + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </SectionLabel>
              <div className="space-y-2">
                {list.map((a) => (
                  <Panel key={a.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <StatusChip tone={STATUS_TONE[a.appointment_status] ?? "neutral"}>
                            {APPOINTMENT_STATUS_LABELS[a.appointment_status] ?? a.appointment_status}
                          </StatusChip>
                          {a.appointment_type && (
                            <span className="text-xs text-muted-foreground">
                              {APPOINTMENT_TYPE_LABELS[a.appointment_type] ?? a.appointment_type}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 font-medium truncate">
                          {a.patient ? fullName(a.patient) : a.title || "Sem paciente"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {a.due_date ? new Date(a.due_date).toLocaleString("pt-BR") : "Sem data"}
                          {a.duration_minutes ? ` · ${a.duration_minutes} min` : ""}
                          {a.professional?.name ? ` · ${a.professional.name}` : ""}
                        </p>
                        {a.body && <p className="mt-2 text-sm">{a.body}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1 shrink-0">
                        {a.appointment_status === "scheduled" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus(a.id, "confirmed")}>
                            <Check className="mr-1 h-3 w-3" /> Confirmar
                          </Button>
                        )}
                        {a.appointment_status === "confirmed" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus(a.id, "attended")}>
                            <ListChecks className="mr-1 h-3 w-3" /> Atendido
                          </Button>
                        )}
                        {a.appointment_status !== "no_show" && a.appointment_status !== "attended" && a.appointment_status !== "cancelled" && (
                          <Button size="sm" variant="ghost" onClick={() => updateStatus(a.id, "no_show")}>
                            <AlertTriangle className="mr-1 h-3 w-3" /> No-show
                          </Button>
                        )}
                        {a.appointment_status !== "cancelled" && a.appointment_status !== "attended" && (
                          <Button size="sm" variant="ghost" onClick={() => updateStatus(a.id, "cancelled")}>
                            <XCircle className="mr-1 h-3 w-3" /> Cancelar
                          </Button>
                        )}
                      </div>
                    </div>
                  </Panel>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Panel className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold capitalize">
                {format(cursor, "MMMM yyyy", { locale: ptBR })}
              </h3>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => setCursor((d) => subMonths(d, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => { const t = new Date(); setCursor(t); setSelectedDay(t); }}>
                  Hoje
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setCursor((d) => addMonths(d, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-px text-xs">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                <div key={d} className="px-2 py-1 text-center font-medium text-muted-foreground">{d}</div>
              ))}
              {monthDays.map((d) => {
                const key = format(d, "yyyy-MM-dd");
                const dayAppts = byDayMap.get(key) ?? [];
                const inMonth = isSameMonth(d, cursor);
                const isSelected = isSameDay(d, selectedDay);
                const isToday = isSameDay(d, new Date());
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDay(d)}
                    className={cn(
                      "min-h-[80px] rounded-md border p-1.5 text-left transition-colors hover:bg-secondary/60",
                      !inMonth && "opacity-40",
                      isSelected && "border-primary ring-1 ring-primary",
                      !isSelected && "border-border",
                    )}
                  >
                    <div className={cn(
                      "text-xs font-medium",
                      isToday && "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    )}>
                      {format(d, "d")}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {dayAppts.slice(0, 3).map((a) => (
                        <div
                          key={a.id}
                          className={cn(
                            "truncate rounded px-1 py-0.5 text-[10px] font-medium",
                            STATUS_CELL_CLASS[a.appointment_status] ?? "bg-muted text-muted-foreground"
                          )}
                        >
                          {a.due_date ? format(new Date(a.due_date), "HH:mm") : ""} {a.patient ? fullName(a.patient) : a.title}
                        </div>
                      ))}
                      {dayAppts.length > 3 && (
                        <div className="text-[10px] text-muted-foreground">+{dayAppts.length - 3} mais</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel className="space-y-3 p-4">
            <div className="space-y-1">
              <SectionLabel>Detalhes do dia</SectionLabel>
              <h3 className="text-sm font-semibold capitalize">
                {format(selectedDay, "EEEE, dd 'de' MMMM", { locale: ptBR })}
              </h3>
              <p className="text-xs text-muted-foreground">{selectedDayAppts.length} consulta(s)</p>
            </div>
            {selectedDayAppts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Sem consultas neste dia.</p>
            ) : (
              <div className="space-y-2">
                {selectedDayAppts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => a.patient?.id && setDrawerPatientId(a.patient.id)}
                    disabled={!a.patient?.id}
                    className="w-full text-left rounded-md border border-border p-2.5 transition-colors hover:bg-secondary/60 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono">
                        {a.due_date ? format(new Date(a.due_date), "HH:mm") : "--:--"}
                        {a.duration_minutes ? ` · ${a.duration_minutes}min` : ""}
                      </span>
                      <StatusChip tone={STATUS_TONE[a.appointment_status] ?? "neutral"}>
                        {APPOINTMENT_STATUS_LABELS[a.appointment_status] ?? a.appointment_status}
                      </StatusChip>
                    </div>
                    <p className="mt-1 text-sm font-medium truncate">
                      {a.patient ? fullName(a.patient) : a.title || "Sem paciente"}
                    </p>
                    {a.professional?.name && (
                      <p className="text-xs text-muted-foreground truncate">{a.professional.name}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      <AppointmentCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultPatientId={defaultPatient}
        onCreated={() => void fetchAppointments()}
      />

      <PatientDrawer
        patientId={drawerPatientId}
        open={drawerPatientId !== null}
        onOpenChange={(o) => { if (!o) setDrawerPatientId(null); }}
        onUpdated={() => void fetchAppointments()}
      />
    </PageScaffold>
  );
}
