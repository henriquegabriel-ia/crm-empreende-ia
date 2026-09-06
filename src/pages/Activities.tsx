import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Phone, Mail, Calendar, FileText, CheckSquare, List,
  CalendarDays, Clock, AlertTriangle, Trash2, Edit2, MoreHorizontal,
  ChevronLeft, ChevronRight, Search, Stethoscope, Building2,
} from "lucide-react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Panel } from "@/components/foundation/Panel";
import { SidePanel } from "@/components/foundation/SidePanel";
import { EmptyState } from "@/components/foundation/EmptyState";
import { StatusChip } from "@/components/foundation/StatusChip";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";

type Activity = any;
type ActivityType = string;
type Contact = any;
type Company = any;
type Deal = any;
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const typeIcons: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  call: Phone, email: Mail, meeting: Calendar, note: FileText, task: CheckSquare, visit: Calendar, whatsapp: Mail, appointment: Stethoscope,
};
const typeLabels: Record<ActivityType, string> = {
  call: "Ligação", email: "Email", meeting: "Reunião", note: "Nota", task: "Tarefa", visit: "Visita", whatsapp: "WhatsApp", appointment: "Consulta",
};
// Cores por tipo em tokens do DS (chaves preservadas — lookup por `type`)
const typeColors: Record<ActivityType, string> = {
  call: "text-success",
  email: "text-primary",
  meeting: "text-warning",
  note: "text-muted-foreground",
  task: "text-accent",
  visit: "text-warning",
  whatsapp: "text-success",
  appointment: "text-primary",
};

type ViewMode = "list" | "calendar";
type DateFilter = "todo" | "overdue" | "today" | "tomorrow" | "this_week" | "next_week";

const dateFilterLabels: Record<DateFilter, string> = {
  todo: "Para fazer",
  overdue: "Vencido",
  today: "Hoje",
  tomorrow: "Amanhã",
  this_week: "Esta semana",
  next_week: "Próxima semana",
};

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }

function getWeekRange(offset: number) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: startOfDay(monday), end: endOfDay(sunday) };
}

export default function Activities() {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [imoveis, setImoveis] = useState<Array<{ id: string; titulo: string; bairro: string | null; cidade: string | null }>>([]);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("todo");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [editActivity, setEditActivity] = useState<Activity | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setCreateOpen(true);
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Calendar state
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    const [aRes, cRes, coRes, dRes, mRes, iRes] = await Promise.all([
      (supabase as any).from("activities").select("*").eq("org_id", orgId).order("due_date", { ascending: true, nullsFirst: false }),
      (supabase as any).from("contacts").select("*").eq("org_id", orgId),
      (supabase as any).from("companies").select("*").eq("org_id", orgId),
      (supabase as any).from("deals").select("*").eq("org_id", orgId),
      (supabase as any).from("profiles").select("*").eq("org_id", orgId),
      (supabase as any).from("imoveis").select("id, titulo, bairro, cidade").eq("org_id", orgId).order("titulo"),
    ]);
    setActivities(aRes.data || []);
    setContacts(cRes.data || []);
    setCompanies(coRes.data || []);
    setDeals(dRes.data || []);
    setMembers(mRes.data || []);
    setImoveis(iRes.data || []);
  }, [orgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleComplete = async (activity: Activity) => {
    const completed_at = activity.completed_at ? null : new Date().toISOString();
    await (supabase as any).from("activities").update({ completed_at }).eq("id", activity.id);
    fetchData();
  };

  const deleteActivity = async (id: string) => {
    await (supabase as any).from("activities").delete().eq("id", id);
    fetchData();
    toast({ title: "Atividade excluída" });
  };

  const getContact = (id: string | null) => id ? contacts.find((c) => c.id === id) : null;
  const getCompany = (id: string | null) => id ? companies.find((c) => c.id === id) : null;
  const getDeal = (id: string | null) => id ? deals.find((d) => d.id === id) : null;
  const getMember = (id: string | null) => id ? members.find((m) => m.id === id) : null;

  const isOverdue = (a: Activity) => !a.completed_at && a.due_date && new Date(a.due_date) < new Date();

  const filtered = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const tomorrowStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const tomorrowEnd = endOfDay(tomorrowStart);
    const thisWeek = getWeekRange(0);
    const nextWeek = getWeekRange(1);

    return activities.filter((a) => {
      // Type filter
      if (typeFilter !== "all" && a.type !== typeFilter) return false;

      // Owner filter
      if (ownerFilter !== "all" && a.user_id !== ownerFilter) return false;

      // Search
      if (search) {
        const q = search.toLowerCase();
        const contact = getContact(a.contact_id);
        const deal = getDeal(a.deal_id);
        const haystack = `${a.title} ${contact?.first_name || ""} ${contact?.last_name || ""} ${contact?.email || ""} ${deal?.title || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Date filter
      const dueDate = a.due_date ? new Date(a.due_date) : null;
      switch (dateFilter) {
        case "todo":
          return !a.completed_at;
        case "overdue":
          return !a.completed_at && dueDate !== null && dueDate < now;
        case "today":
          return !a.completed_at && dueDate !== null && dueDate >= todayStart && dueDate <= todayEnd;
        case "tomorrow":
          return !a.completed_at && dueDate !== null && dueDate >= tomorrowStart && dueDate <= tomorrowEnd;
        case "this_week":
          return !a.completed_at && dueDate !== null && dueDate >= thisWeek.start && dueDate <= thisWeek.end;
        case "next_week":
          return !a.completed_at && dueDate !== null && dueDate >= nextWeek.start && dueDate <= nextWeek.end;
      }
      return true;
    });
  }, [activities, typeFilter, dateFilter, ownerFilter, search, contacts, deals]);

  // Count per date filter (for badges)
  const counts = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const tomorrowStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const tomorrowEnd = endOfDay(tomorrowStart);
    const thisWeek = getWeekRange(0);
    const nextWeek = getWeekRange(1);

    const pending = activities.filter((a) => !a.completed_at);
    return {
      todo: pending.length,
      overdue: pending.filter((a) => a.due_date && new Date(a.due_date) < now).length,
      today: pending.filter((a) => a.due_date && new Date(a.due_date) >= todayStart && new Date(a.due_date) <= todayEnd).length,
      tomorrow: pending.filter((a) => a.due_date && new Date(a.due_date) >= tomorrowStart && new Date(a.due_date) <= tomorrowEnd).length,
      this_week: pending.filter((a) => a.due_date && new Date(a.due_date) >= thisWeek.start && new Date(a.due_date) <= thisWeek.end).length,
      next_week: pending.filter((a) => a.due_date && new Date(a.due_date) >= nextWeek.start && new Date(a.due_date) <= nextWeek.end).length,
    };
  }, [activities]);

  // Calendar helpers
  const calendarDays = useMemo(() => {
    const { year, month } = calMonth;
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDay = first.getDay();
    const days: { date: Date; inMonth: boolean }[] = [];
    for (let i = startDay - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month, -i), inMonth: false });
    }
    for (let d = 1; d <= last.getDate(); d++) {
      days.push({ date: new Date(year, month, d), inMonth: true });
    }
    while (days.length % 7 !== 0) {
      days.push({ date: new Date(year, month + 1, days.length - last.getDate() - startDay + 1), inMonth: false });
    }
    return days;
  }, [calMonth]);

  const activitiesByDate = useMemo(() => {
    const map = new Map<string, Activity[]>();
    filtered.forEach((a) => {
      const dateStr = a.due_date
        ? new Date(a.due_date).toISOString().split("T")[0]
        : a.created_at
          ? new Date(a.created_at).toISOString().split("T")[0]
          : null;
      if (dateStr) {
        if (!map.has(dateStr)) map.set(dateStr, []);
        map.get(dateStr)!.push(a);
      }
    });
    return map;
  }, [filtered]);

  const monthNames = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  if (!orgId) {
    return (
      <PageScaffold title="Atividades">
        <EmptyState
          icon={CheckSquare}
          title="Nenhuma organização"
          description="Crie uma organização em Configurações primeiro."
        />
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      title="Atividades"
      meta={
        <>
          <StatusChip tone="neutral" dot={false}>{filtered.length} atividades</StatusChip>
          {counts.overdue > 0 && (
            <StatusChip tone="danger">{counts.overdue} atrasadas</StatusChip>
          )}
        </>
      }
      actions={
        <>
          <div className="flex rounded-full border border-border p-0.5">
            <button onClick={() => setViewMode("list")} aria-label="Visualizar em lista" className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <List className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setViewMode("calendar")} aria-label="Visualizar em calendário" className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${viewMode === "calendar" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <CalendarDays className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />Atividade
          </Button>
        </>
      }
      toolbar={
        <>
          <div className="relative shrink-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-8 w-44 text-xs"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setTypeFilter("all")}
              className={`h-7 rounded-full border px-3 text-xs font-medium transition-colors ${typeFilter === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
            >
              Tudo
            </button>
            {(["call", "meeting", "task", "email", "note"] as ActivityType[]).map((t) => {
              const Icon = typeIcons[t] ?? FileText;
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${typeFilter === t ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="h-3 w-3" />
                  {typeLabels[t]}
                </button>
              );
            })}
          </div>

          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="ml-auto h-8 w-36 shrink-0 text-xs">
              <SelectValue placeholder="Responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
    >
      {/* Date filter tabs */}
      <div className="flex flex-wrap items-center gap-0.5 pb-3 text-xs">
        {(Object.keys(dateFilterLabels) as DateFilter[]).map((key) => {
          const count = counts[key];
          const isActive = dateFilter === key;
          const isOverdueTab = key === "overdue";
          return (
            <button
              key={key}
              onClick={() => setDateFilter(key)}
              className={`h-7 whitespace-nowrap rounded-full px-3 font-medium transition-colors ${
                isActive
                  ? isOverdueTab && count > 0
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              }`}
            >
              {dateFilterLabels[key]}
              {count > 0 && (
                <span className={`ml-1 text-[10px] ${isOverdueTab ? "text-destructive" : ""}`}>
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table view */}
      {viewMode === "list" && (filtered.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="Nenhuma atividade encontrada"
          description="Ajuste os filtros acima ou crie uma nova atividade."
          action={
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Criar atividade
            </Button>
          }
        />
      ) : (
        <Panel className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-10"></TableHead>
                <TableHead className="min-w-[200px]">Assunto</TableHead>
                <TableHead>Negócio</TableHead>
                <TableHead>Pessoa de contato</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Organização</TableHead>
                <TableHead>Data de venc.</TableHead>
                <TableHead>Atribuído a</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const Icon = typeIcons[a.type] ?? FileText;
                const contact = getContact(a.contact_id);
                const deal = getDeal(a.deal_id);
                const company = getCompany(a.company_id) || (contact?.company_id ? getCompany(contact.company_id) : null);
                const member = getMember(a.user_id);
                const overdue = isOverdue(a);

                return (
                  <TableRow
                    key={a.id}
                    className={`group ${a.completed_at ? "opacity-40" : ""} ${overdue ? "bg-destructive/[0.03]" : ""}`}
                  >
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={!!a.completed_at}
                        onCheckedChange={() => toggleComplete(a)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${typeColors[a.type]}`} />
                        <span className={`text-sm font-medium truncate ${a.completed_at ? "line-through" : ""}`}>
                          {a.title}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {deal && (
                        <Badge variant="secondary" className="text-[10px] font-normal max-w-[160px] truncate">
                          {deal.title}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {contact && (
                        <span className="text-sm">
                          {contact.first_name} {contact.last_name || ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {contact?.email && (
                        <a href={`mailto:${contact.email}`} className="text-xs text-primary hover:underline truncate block max-w-[180px]">
                          {contact.email}
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      {contact?.phone && (
                        <span className="text-xs text-muted-foreground">{contact.phone}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {company && (
                        <span className="text-xs text-muted-foreground">{company.name}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.due_date && (
                        <span className={`text-xs whitespace-nowrap ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                          {new Date(a.due_date).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {member && (
                        <span className="text-xs text-muted-foreground">{member.name || member.email}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-secondary/60 transition-all">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditActivity(a)}>
                            <Edit2 className="mr-2 h-3.5 w-3.5" />Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => deleteActivity(a.id)} className="text-destructive">
                            <Trash2 className="mr-2 h-3.5 w-3.5" />Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      ))}

      {/* Calendar View */}
      {viewMode === "calendar" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setCalMonth((p) => {
              const d = new Date(p.year, p.month - 1);
              return { year: d.getFullYear(), month: d.getMonth() };
            })}><ChevronLeft className="h-4 w-4" /></Button>
            <h3 className="text-sm font-semibold">{monthNames[calMonth.month]} {calMonth.year}</h3>
            <Button variant="outline" size="sm" onClick={() => setCalMonth((p) => {
              const d = new Date(p.year, p.month + 1);
              return { year: d.getFullYear(), month: d.getMonth() };
            })}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="grid grid-cols-7 gap-px rounded-xl border border-border bg-border overflow-hidden">
            {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((d) => (
              <div key={d} className="bg-muted px-2 py-1.5 text-center text-[10px] font-medium text-muted-foreground">{d}</div>
            ))}
            {calendarDays.map((day, i) => {
              const dateStr = day.date.toISOString().split("T")[0];
              const dayActivities = activitiesByDate.get(dateStr) || [];
              const isToday = dateStr === new Date().toISOString().split("T")[0];
              return (
                <div key={i} className={`min-h-[80px] bg-background p-1 ${!day.inMonth ? "opacity-40" : ""}`}>
                  <div className={`text-xs font-medium mb-0.5 ${isToday ? "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                    {day.date.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayActivities.slice(0, 3).map((a) => {
                      const ActIcon = typeIcons[a.type] ?? FileText;
                      return (
                        <div key={a.id} className={`flex items-center gap-1 rounded px-1 py-0.5 text-[9px] truncate bg-muted/50 ${isOverdue(a) ? "ring-1 ring-destructive" : ""}`}>
                          <ActIcon className={`h-2.5 w-2.5 shrink-0 ${typeColors[a.type]}`} />
                          <span className="truncate">{a.title}</span>
                        </div>
                      );
                    })}
                    {dayActivities.length > 3 && (
                      <span className="text-[9px] text-muted-foreground px-1">+{dayActivities.length - 3}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      <ActivityCreateEditModal
        open={createOpen || !!editActivity}
        onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditActivity(null); } }}
        activity={editActivity}
        contacts={contacts}
        companies={companies}
        deals={deals}
        members={members}
        imoveis={imoveis}
        onSaved={fetchData}
      />
    </PageScaffold>
  );
}

// ─── Create / Edit Modal ────────────────────────────────────────────
interface ModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  activity: Activity | null;
  contacts: Contact[];
  companies: Company[];
  deals: Deal[];
  members: Profile[];
  imoveis: Array<{ id: string; titulo: string; bairro: string | null; cidade: string | null }>;
  onSaved: () => void;
}

const visitaStatusOptions = [
  { value: "agendada", label: "Agendada" },
  { value: "realizada", label: "Realizada" },
  { value: "reagendada", label: "Reagendada" },
  { value: "desmarcada", label: "Desmarcada" },
  { value: "nao_compareceu", label: "Não compareceu" },
];

function ActivityCreateEditModal({ open, onOpenChange, activity, contacts, companies, deals, members, imoveis, onSaved }: ModalProps) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();
  const isEdit = !!activity;

  const [type, setType] = useState<ActivityType>("task");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dealId, setDealId] = useState<string>("none");
  const [contactId, setContactId] = useState<string>("none");
  const [assignee, setAssignee] = useState<string>("none");
  const [imovelId, setImovelId] = useState<string>("none");
  const [visitaStatus, setVisitaStatus] = useState<string>("agendada");
  const [visitaFeedback, setVisitaFeedback] = useState("");

  const selectedDeal = deals.find((d) => d.id === dealId);
  const resolvedContactId = dealId !== "none" && selectedDeal?.contact_id
    ? selectedDeal.contact_id
    : contactId !== "none" ? contactId : null;
  const selectedContact = contacts.find((c) => c.id === resolvedContactId);
  const resolvedCompanyId = selectedDeal?.company_id || selectedContact?.company_id || null;
  const resolvedCompany = companies.find((c) => c.id === resolvedCompanyId);

  useEffect(() => {
    if (activity) {
      setType(activity.type);
      setTitle(activity.title);
      setBody(activity.body || "");
      setDueDate(activity.due_date ? activity.due_date.slice(0, 16) : "");
      setDealId(activity.deal_id || "none");
      setContactId(activity.contact_id || "none");
      setAssignee(activity.user_id || "none");
      setImovelId(activity.imovel_id || (selectedDeal?.imovel_id ?? "none"));
      setVisitaStatus(activity.visita_status || "agendada");
      setVisitaFeedback(activity.visita_feedback || "");
    } else {
      setType("task");
      setTitle("");
      setBody("");
      setDueDate("");
      setDealId("none");
      setContactId("none");
      setAssignee("none");
      setImovelId("none");
      setVisitaStatus("agendada");
      setVisitaFeedback("");
    }
  }, [activity, open]);

  const handleDealChange = (val: string) => {
    setDealId(val);
    if (val !== "none") {
      const deal = deals.find((d) => d.id === val);
      if (deal?.contact_id) setContactId(deal.contact_id);
      if (deal?.imovel_id && imovelId === "none") setImovelId(deal.imovel_id);
    }
  };

  const handleSave = async () => {
    if (!orgId || !title.trim()) return;
    if ((type === "meeting" || type === "visit") && !dueDate) {
      toast({ title: "Data/hora obrigatória", description: `Informe a data e hora da ${type === "visit" ? "visita" : "reunião"}.`, variant: "destructive" });
      return;
    }
    if (type === "visit" && imovelId === "none") {
      toast({ title: "Imóvel obrigatório", description: "Selecione o imóvel da visita.", variant: "destructive" });
      return;
    }
    const payload = {
      org_id: orgId,
      type,
      title: title.trim(),
      body: body || null,
      due_date: dueDate || null,
      deal_id: dealId !== "none" ? dealId : null,
      contact_id: resolvedContactId,
      company_id: resolvedCompanyId,
      user_id: assignee !== "none" ? assignee : user?.id,
      imovel_id: type === "visit" && imovelId !== "none" ? imovelId : null,
      visita_status: type === "visit" ? visitaStatus : null,
      visita_feedback: type === "visit" && visitaStatus === "realizada" ? (visitaFeedback || null) : null,
    };

    const { error } = isEdit
      ? await (supabase as any).from("activities").update(payload).eq("id", activity!.id)
      : await (supabase as any).from("activities").insert(payload);

    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    onOpenChange(false);
    onSaved();
    toast({ title: isEdit ? "Atividade atualizada" : "Atividade criada" });
  };

  const typeHints: Record<ActivityType, string> = {
    note: "Registre observações sobre contatos, negócios ou empresas",
    task: "Crie uma tarefa com prazo e responsável",
    meeting: "Agende uma reunião com data, horário e participantes",
    call: "Registre uma ligação com contato e resultado",
    email: "Crie um rascunho de email para acompanhamento",
    visit: "Agende uma visita ao imóvel. Atualize o status conforme acontece.",
    whatsapp: "Registre uma conversa pelo WhatsApp",
  };

  const availableContacts = dealId !== "none" && selectedDeal?.company_id
    ? contacts.filter((c) => c.company_id === selectedDeal.company_id || !c.company_id)
    : contacts;

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      kicker="Atividades"
      title={isEdit ? "Editar Atividade" : "Nova Atividade"}
      description={typeHints[type]}
      width="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={!title.trim()}>
            {isEdit ? "Salvar Alterações" : "Criar Atividade"}
          </Button>
        </>
      }
    >
        <div className="space-y-4">
          <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1 flex-wrap">
            {(["task", "note", "call", "meeting", "visit", "email"] as ActivityType[]).map((t) => {
              const Icon = typeIcons[t] ?? FileText;
              return (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${type === t ? "bg-background text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {typeLabels[t]}
                </button>
              );
            })}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              {type === "note" ? "Assunto" : type === "call" ? "Resumo da ligação" : type === "visit" ? "Título da visita" : "Título"} *
            </Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={
              type === "note" ? "Assunto da nota..." : type === "call" ? "Resumo da ligação..." : type === "meeting" ? "Nome da reunião..." : type === "email" ? "Assunto do email..." : type === "visit" ? "Ex.: Visita com cliente João" : "Título da tarefa..."
            } />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              {type === "note" ? "Conteúdo" : type === "call" ? "Notas da ligação" : type === "meeting" ? "Pauta / Notas" : type === "email" ? "Corpo do email" : type === "visit" ? "Observações" : "Descrição"}
            </Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={type === "note" || type === "email" ? 6 : 3} />
          </div>

          {(type === "task" || type === "meeting" || type === "call" || type === "visit") && (
            <div className="space-y-1">
              <Label className="text-xs">
                {type === "meeting" ? "Data/hora" : type === "call" ? "Data/hora da ligação" : type === "visit" ? "Data/hora da visita" : "Prazo"}
                {(type === "meeting" || type === "visit") && " *"}
              </Label>
              <Input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required={type === "meeting" || type === "visit"} />
            </div>
          )}

          {type === "visit" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Imóvel *</Label>
                <Select value={imovelId} onValueChange={setImovelId}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione o imóvel" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Selecione...</SelectItem>
                    {imoveis.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.titulo}{i.bairro ? ` — ${i.bairro}` : ""}{i.cidade ? `, ${i.cidade}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Status da visita</Label>
                <Select value={visitaStatus} onValueChange={setVisitaStatus}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {visitaStatusOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {visitaStatus === "realizada" && (
                <div className="space-y-1">
                  <Label className="text-xs">Feedback da visita</Label>
                  <Textarea value={visitaFeedback} onChange={(e) => setVisitaFeedback(e.target.value)} rows={3} placeholder="Impressões do cliente, próximos passos..." />
                </div>
              )}
            </>
          )}


          <div className="space-y-1">
            <Label className="text-xs">Negócio</Label>
            <Select value={dealId} onValueChange={handleDealChange}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {deals.map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Contato</Label>
            <Select
              value={resolvedContactId || "none"}
              onValueChange={(v) => setContactId(v)}
              disabled={dealId !== "none" && !!selectedDeal?.contact_id}
            >
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {availableContacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dealId !== "none" && selectedDeal?.contact_id && (
              <p className="text-[10px] text-muted-foreground">Preenchido automaticamente pelo negócio</p>
            )}
          </div>

          {resolvedCompany && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Empresa (vinculada automaticamente)</Label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <Building2 className="h-4 w-4 shrink-0" />
                {resolvedCompany.name}
              </div>
            </div>
          )}

          {(type === "task" || type === "meeting") && (
            <div className="space-y-1">
              <Label className="text-xs">Responsável</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Eu</SelectItem>
                  {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

        </div>
    </SidePanel>
  );
}
