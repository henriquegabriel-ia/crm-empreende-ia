import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ds/button";
import { Input } from "@/components/ds/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ds/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ds/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ds/dropdown-menu";
import {
  Plus, CheckSquare, Clock, AlertTriangle, Trash2, Edit2, MoreHorizontal,
  Search, User, Users,
} from "lucide-react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Panel } from "@/components/foundation/Panel";
import { SidePanel } from "@/components/foundation/SidePanel";
import { EmptyState } from "@/components/foundation/EmptyState";
import { StatusChip } from "@/components/foundation/StatusChip";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";

type Activity = any;
type Contact = any;
type Deal = any;
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type DateFilter = "todo" | "overdue" | "today" | "tomorrow" | "this_week" | "done";

const dateFilterLabels: Record<DateFilter, string> = {
  todo: "Para fazer",
  overdue: "Vencidas",
  today: "Hoje",
  tomorrow: "Amanhã",
  this_week: "Esta semana",
  done: "Concluídas",
};

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: startOfDay(monday), end: endOfDay(sunday) };
}

export default function Tasks() {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();

  const [tasks, setTasks] = useState<Activity[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [dateFilter, setDateFilter] = useState<DateFilter>("todo");
  const [ownerFilter, setOwnerFilter] = useState<string>("mine");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<Activity | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [formContactId, setFormContactId] = useState("none");
  const [formDealId, setFormDealId] = useState("none");
  const [formUserId, setFormUserId] = useState("");

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    const [tRes, cRes, dRes, mRes] = await Promise.all([
      (supabase as any).from("activities").select("*").eq("org_id", orgId).eq("type", "task").order("due_date", { ascending: true, nullsFirst: false }),
      (supabase as any).from("contacts").select("*").eq("org_id", orgId),
      (supabase as any).from("deals").select("*").eq("org_id", orgId),
      (supabase as any).from("profiles").select("*").eq("org_id", orgId),
    ]);
    setTasks(tRes.data || []);
    setContacts(cRes.data || []);
    setDeals(dRes.data || []);
    setMembers(mRes.data || []);
  }, [orgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleComplete = async (task: Activity) => {
    const completed_at = task.completed_at ? null : new Date().toISOString();
    await (supabase as any).from("activities").update({ completed_at }).eq("id", task.id);
    fetchData();
  };

  const deleteTask = async (id: string) => {
    await (supabase as any).from("activities").delete().eq("id", id);
    fetchData();
    toast({ title: "Tarefa excluída" });
  };

  const getContact = (id: string | null) => id ? contacts.find((c) => c.id === id) : null;
  const getDeal = (id: string | null) => id ? deals.find((d) => d.id === id) : null;
  const getMember = (id: string | null) => id ? members.find((m) => m.id === id) : null;

  const isOverdue = (t: Activity) => !t.completed_at && t.due_date && new Date(t.due_date) < new Date();

  const filtered = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const tomorrowStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const tomorrowEnd = endOfDay(tomorrowStart);
    const thisWeek = getWeekRange();

    return tasks.filter((t) => {
      // Owner filter
      if (ownerFilter === "mine" && t.user_id !== user?.id) return false;
      if (ownerFilter !== "mine" && ownerFilter !== "all" && t.user_id !== ownerFilter) return false;

      // Search
      if (search) {
        const q = search.toLowerCase();
        const contact = getContact(t.contact_id);
        const deal = getDeal(t.deal_id);
        const haystack = `${t.title} ${contact?.first_name || ""} ${contact?.last_name || ""} ${deal?.title || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Date filter
      const dueDate = t.due_date ? new Date(t.due_date) : null;
      switch (dateFilter) {
        case "todo":
          return !t.completed_at;
        case "overdue":
          return !t.completed_at && dueDate !== null && dueDate < now;
        case "today":
          return !t.completed_at && dueDate !== null && dueDate >= todayStart && dueDate <= todayEnd;
        case "tomorrow":
          return !t.completed_at && dueDate !== null && dueDate >= tomorrowStart && dueDate <= tomorrowEnd;
        case "this_week":
          return !t.completed_at && dueDate !== null && dueDate >= thisWeek.start && dueDate <= thisWeek.end;
        case "done":
          return !!t.completed_at;
      }
      return true;
    });
  }, [tasks, dateFilter, ownerFilter, search, user, contacts, deals]);

  const counts = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const tomorrowStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const tomorrowEnd = endOfDay(tomorrowStart);
    const thisWeek = getWeekRange();

    const pending = tasks.filter((t) => !t.completed_at);
    const mine = pending.filter((t) => t.user_id === user?.id);
    const base = ownerFilter === "mine" ? mine : pending;

    return {
      todo: base.length,
      overdue: base.filter((t) => t.due_date && new Date(t.due_date) < now).length,
      today: base.filter((t) => t.due_date && new Date(t.due_date) >= todayStart && new Date(t.due_date) <= todayEnd).length,
      tomorrow: base.filter((t) => t.due_date && new Date(t.due_date) >= tomorrowStart && new Date(t.due_date) <= tomorrowEnd).length,
      this_week: base.filter((t) => t.due_date && new Date(t.due_date) >= thisWeek.start && new Date(t.due_date) <= thisWeek.end).length,
      done: tasks.filter((t) => !!t.completed_at).length,
    };
  }, [tasks, user, ownerFilter]);

  const openCreate = () => {
    setFormTitle("");
    setFormBody("");
    setFormDueDate(new Date().toISOString().split("T")[0]);
    setFormContactId("none");
    setFormDealId("none");
    setFormUserId(user?.id || "");
    setEditTask(null);
    setCreateOpen(true);
  };

  const openEdit = (task: Activity) => {
    setFormTitle(task.title);
    setFormBody(task.body || "");
    setFormDueDate(task.due_date ? task.due_date.split("T")[0] : "");
    setFormContactId(task.contact_id || "none");
    setFormDealId(task.deal_id || "none");
    setFormUserId(task.user_id || user?.id || "");
    setEditTask(task);
    setCreateOpen(true);
  };

  const handleSave = async () => {
    if (!orgId || !formTitle.trim()) return;
    const payload = {
      org_id: orgId,
      type: "task" as const,
      title: formTitle.trim(),
      body: formBody.trim() || null,
      due_date: formDueDate ? new Date(formDueDate).toISOString() : null,
      contact_id: formContactId !== "none" ? formContactId : null,
      deal_id: formDealId !== "none" ? formDealId : null,
      user_id: formUserId || user?.id || null,
    };

    if (editTask) {
      await (supabase as any).from("activities").update(payload).eq("id", editTask.id);
      toast({ title: "Tarefa atualizada" });
    } else {
      await (supabase as any).from("activities").insert(payload);
      toast({ title: "Tarefa criada" });
    }
    setCreateOpen(false);
    fetchData();
  };

  if (!orgId) {
    return (
      <PageScaffold title="Tarefas">
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
      title="Tarefas"
      meta={
        <>
          <StatusChip tone="neutral" dot={false}>{filtered.length} tarefas</StatusChip>
          {counts.overdue > 0 && (
            <StatusChip tone="danger">{counts.overdue} vencidas</StatusChip>
          )}
        </>
      }
      actions={
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" />Tarefa
        </Button>
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

          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setOwnerFilter("mine")}
              className={`flex h-7 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors ${ownerFilter === "mine" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
            >
              <User className="h-3 w-3" />Minhas
            </button>
            <button
              onClick={() => setOwnerFilter("all")}
              className={`flex h-7 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors ${ownerFilter === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
            >
              <Users className="h-3 w-3" />Equipe
            </button>
          </div>

          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

          <div className="flex shrink-0 items-center gap-0.5 text-xs">
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
                    <span className={`ml-1 text-xs ${isOverdueTab ? "text-destructive" : ""}`}>
                      ({count})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

        </>
      }
    >
      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title={dateFilter === "done" ? "Nenhuma tarefa concluída" : "Nenhuma tarefa pendente"}
          description={dateFilter === "done" ? undefined : "Crie uma tarefa para organizar os próximos passos."}
          action={
            dateFilter !== "done" ? (
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />Nova tarefa
              </Button>
            ) : undefined
          }
        />
      ) : (
      <Panel className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-10"></TableHead>
              <TableHead className="min-w-[200px]">Tarefa</TableHead>
              <TableHead>Negócio</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Data de venc.</TableHead>
              <TableHead>Atribuído a</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((t) => {
              const contact = getContact(t.contact_id);
              const deal = getDeal(t.deal_id);
              const member = getMember(t.user_id);
              const overdue = isOverdue(t);

              return (
                <TableRow
                  key={t.id}
                  className={`group ${t.completed_at ? "opacity-40" : ""} ${overdue ? "bg-destructive/[0.03]" : ""}`}
                >
                  <TableCell className="pr-0">
                    <Checkbox
                      checked={!!t.completed_at}
                      onCheckedChange={() => toggleComplete(t)}
                    />
                  </TableCell>
                  <TableCell>
                    <button onClick={() => openEdit(t)} className="text-left">
                      <span className={`text-sm font-medium ${t.completed_at ? "line-through" : ""}`}>
                        {t.title}
                      </span>
                      {t.body && <p className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{t.body}</p>}
                    </button>
                  </TableCell>
                  <TableCell>
                    {deal && (
                      <Badge variant="secondary" className="text-xs font-normal max-w-[160px] truncate">
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
                    {t.due_date && (
                      <span className={`text-xs flex items-center gap-1 ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {overdue && <AlertTriangle className="h-3 w-3" />}
                        <Clock className="h-3 w-3" />
                        {new Date(t.due_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
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
                        <button className="opacity-0 group-hover:opacity-100 rounded p-1 text-muted-foreground hover:bg-secondary/60 transition-all">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(t)}>
                          <Edit2 className="mr-2 h-3.5 w-3.5" />Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => deleteTask(t.id)} className="text-destructive">
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
      )}

      {/* Create/Edit side panel */}
      <SidePanel
        open={createOpen}
        onOpenChange={setCreateOpen}
        kicker="Tarefas"
        title={editTask ? "Editar tarefa" : "Nova tarefa"}
        description={editTask ? "Atualize os dados da tarefa." : "Preencha os detalhes para criar uma nova tarefa."}
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleSave} disabled={!formTitle.trim()}>{editTask ? "Salvar" : "Criar"}</Button>
          </>
        }
      >
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Título *</Label>
              <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Ex: Enviar proposta" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Textarea value={formBody} onChange={(e) => setFormBody(e.target.value)} placeholder="Detalhes da tarefa..." rows={2} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Data de vencimento</Label>
                <Input type="date" value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Atribuir a</Label>
                <Select value={formUserId} onValueChange={setFormUserId}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Contato</Label>
                <Select value={formContactId} onValueChange={setFormContactId}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name || ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Negócio</Label>
                <Select value={formDealId} onValueChange={setFormDealId}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {deals.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
      </SidePanel>
    </PageScaffold>
  );
}
