import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ds/button";
import { Input } from "@/components/ds/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ds/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ds/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  UserPlus, Shield, Trash2, Plus, Users, Crown, Mail,
} from "lucide-react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Panel, PanelHeader, PanelBody, SectionLabel } from "@/components/foundation/Panel";
import { StatusChip, type StatusTone } from "@/components/foundation/StatusChip";
import { InitialsAvatar } from "@/components/foundation/InitialsAvatar";
import { EmptyState } from "@/components/foundation/EmptyState";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const PERMISSIONS = [
  { key: "view_all_data", label: "Ver todos os dados" },
  { key: "edit_any_record", label: "Editar qualquer registro" },
  { key: "manage_users", label: "Gerenciar usuários" },
  { key: "create_automations", label: "Criar automações" },
  { key: "export_data", label: "Exportar dados" },
  { key: "view_reports", label: "Ver relatórios" },
  { key: "manage_billing", label: "Gerenciar cobrança" },
  { key: "view_own_records", label: "Ver registros próprios" },
];

const ROLES: Array<{ value: string; label: string }> = [
  { value: "owner",    label: "Dono" },
  { value: "admin",    label: "Administrador" },
  { value: "director", label: "Diretor" },
  { value: "manager",  label: "Gerente de Equipe" },
  { value: "member",   label: "Profissional" },
];

export default function Team() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const { toast } = useToast();

  const [members, setMembers] = useState<(Profile & { role?: string })[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  // RBAC permissions
  const [permissions, setPermissions] = useState<any[]>([]);

  // Teams
  const [teams, setTeams] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [newTeamName, setNewTeamName] = useState("");

  // Directorates
  const [directorates, setDirectorates] = useState<any[]>([]);
  const [directorateMembers, setDirectorateMembers] = useState<any[]>([]);
  const [newDirectorateName, setNewDirectorateName] = useState("");

  const currentUserRole = useMemo(() => {
    const m = members.find((m) => m.id === user?.id);
    return m?.role || "member";
  }, [members, user]);

  const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    const [
      { data: profs }, { data: rl }, { data: inv }, { data: perms },
      { data: tms }, { data: tmem }, { data: dirs }, { data: dmem },
    ] = await Promise.all([
      (supabase as any).from("profiles").select("*").eq("org_id", orgId),
      (supabase as any).from("user_roles").select("*").eq("org_id", orgId),
      (supabase as any).from("invitations").select("*").eq("org_id", orgId).is("accepted_at", null),
      (supabase as any).from("role_permissions").select("*").eq("org_id", orgId),
      (supabase as any).from("teams").select("*").eq("org_id", orgId),
      (supabase as any).from("team_members").select("*"),
      (supabase as any).from("directorates" as any).select("*").eq("org_id", orgId),
      (supabase as any).from("directorate_members" as any).select("*"),
    ]);
    setInvitations(inv || []);
    setPermissions(perms || []);
    setTeams(tms || []);
    setTeamMembers(tmem || []);
    setDirectorates((dirs as any[]) || []);
    setDirectorateMembers((dmem as any[]) || []);
    const merged = (profs || []).map((p) => {
      const r = (rl || []).find((r: any) => r.user_id === p.id);
      return { ...p, role: r?.role || "member" };
    });
    setMembers(merged);
  }, [orgId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Seed default permissions if empty
  useEffect(() => {
    if (!orgId || permissions.length > 0) return;
    const defaults: any[] = [];
    for (const role of ["owner", "admin", "director", "manager", "member"] as const) {
      for (const p of PERMISSIONS) {
        let allowed = true;
        if (role === "member") {
          allowed = p.key === "view_own_records" || p.key === "view_reports";
        } else if (role === "manager") {
          allowed = ["view_own_records", "view_reports", "export_data"].includes(p.key);
        } else if (role === "director") {
          allowed = ["view_own_records", "view_reports", "export_data", "create_automations"].includes(p.key);
        }
        if (p.key === "manage_billing" && role !== "owner") allowed = false;
        defaults.push({ org_id: orgId, role, permission: p.key, allowed });
      }
    }
    (supabase as any).from("role_permissions").insert(defaults).then(() => fetchAll());
  }, [orgId, permissions.length]);

  const sendInvite = async () => {
    if (!orgId || !inviteEmail) return;
    setInviting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("invite-member", {
        body: { email: inviteEmail, role: inviteRole, org_id: orgId },
      });
      if (res.error || res.data?.error) {
        toast({ title: "Erro ao convidar", description: res.data?.error || res.error?.message, variant: "destructive" });
      } else {
        toast({ title: "Convite enviado!", description: `Magic link enviado para ${inviteEmail}` });
        setInviteEmail("");
        fetchAll();
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (userId: string, newRole: string) => {
    if (!orgId) return;
    if (userId === user?.id) {
      toast({ title: "Você não pode alterar seu próprio papel", variant: "destructive" });
      return;
    }
    const { error } = await (supabase as any)
      .from("user_roles")
      .update({ role: newRole } as any)
      .eq("user_id", userId)
      .eq("org_id", orgId);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Papel atualizado" });
      fetchAll();
    }
  };

  const removeMember = async (uid: string) => {
    if (!orgId) return;
    if (uid === user?.id) {
      toast({ title: "Você não pode remover a si mesmo", variant: "destructive" });
      return;
    }
    await (supabase as any).from("user_roles").delete().eq("user_id", uid).eq("org_id", orgId);
    await (supabase as any).from("profiles").update({ org_id: null }).eq("id", uid);
    fetchAll();
    toast({ title: "Membro removido" });
  };

  const cancelInvite = async (id: string) => {
    await (supabase as any).from("invitations").delete().eq("id", id);
    fetchAll();
    toast({ title: "Convite cancelado" });
  };

  const togglePermission = async (role: string, permission: string, currentlyAllowed: boolean) => {
    if (!orgId) return;
    const existing = permissions.find((p: any) => p.role === role && p.permission === permission);
    if (existing) {
      await (supabase as any).from("role_permissions").update({ allowed: !currentlyAllowed }).eq("id", existing.id);
    } else {
      await (supabase as any).from("role_permissions").insert({
        org_id: orgId, role: role as any, permission, allowed: !currentlyAllowed,
      });
    }
    fetchAll();
  };

  const getPermissionValue = (role: string, permission: string): boolean => {
    const p = permissions.find((p: any) => p.role === role && p.permission === permission);
    return p ? p.allowed : false;
  };

  const createTeam = async () => {
    if (!orgId || !newTeamName) return;
    await (supabase as any).from("teams").insert({ org_id: orgId, name: newTeamName });
    setNewTeamName("");
    fetchAll();
    toast({ title: "Equipe criada" });
  };

  const deleteTeam = async (id: string) => {
    await (supabase as any).from("teams").delete().eq("id", id);
    fetchAll();
    toast({ title: "Equipe excluída" });
  };

  const toggleTeamMember = async (teamId: string, uid: string) => {
    const exists = teamMembers.find((tm: any) => tm.team_id === teamId && tm.user_id === uid);
    if (exists) {
      await (supabase as any).from("team_members").delete().eq("team_id", teamId).eq("user_id", uid);
    } else {
      await (supabase as any).from("team_members").insert({ team_id: teamId, user_id: uid });
    }
    fetchAll();
  };

  // ── Directorates ──
  const createDirectorate = async () => {
    if (!orgId || !newDirectorateName) return;
    await ((supabase as any).from("directorates" as any) as any).insert({ org_id: orgId, name: newDirectorateName });
    setNewDirectorateName("");
    fetchAll();
    toast({ title: "Diretoria criada" });
  };
  const deleteDirectorate = async (id: string) => {
    await ((supabase as any).from("directorates" as any) as any).delete().eq("id", id);
    fetchAll();
    toast({ title: "Diretoria excluída" });
  };
  const toggleDirectorateMember = async (dirId: string, uid: string) => {
    const exists = directorateMembers.find((d: any) => d.directorate_id === dirId && d.user_id === uid);
    if (exists) {
      await ((supabase as any).from("directorate_members" as any) as any)
        .delete().eq("directorate_id", dirId).eq("user_id", uid);
    } else {
      await ((supabase as any).from("directorate_members" as any) as any)
        .insert({ directorate_id: dirId, user_id: uid });
    }
    fetchAll();
  };
  const setTeamDirectorate = async (teamId: string, dirId: string | null) => {
    await ((supabase as any).from("teams") as any).update({ directorate_id: dirId }).eq("id", teamId);
    fetchAll();
  };

  const roleIcon = (role: string) => {
    if (role === "owner") return <Crown className="h-3 w-3" />;
    if (role === "admin") return <Shield className="h-3 w-3" />;
    return null;
  };

  const roleColor = (role: string) => {
    if (role === "owner") return "text-warning border-warning/40";
    if (role === "admin") return "text-primary border-primary/30";
    return "text-muted-foreground";
  };

  const roleTone = (role: string): StatusTone => {
    if (role === "owner") return "warning";
    if (role === "admin") return "info";
    return "neutral";
  };

  return (
    <Tabs defaultValue="members" className="contents">
      <PageScaffold
        title="Equipe"
        toolbar={
          <TabsList className="border-b-0">
            <TabsTrigger value="members">Membros</TabsTrigger>
            <TabsTrigger value="directorates">Diretorias</TabsTrigger>
            <TabsTrigger value="teams">Equipes</TabsTrigger>
            <TabsTrigger value="permissions">Permissões</TabsTrigger>
          </TabsList>
        }
      >
        <div className="w-full">
        {/* ── Members Tab ── */}
        <TabsContent value="members" className="mt-0 space-y-4">
          {isAdmin && (
            <Panel>
              <PanelHeader
                title="Convidar via Magic Link"
                description="O convidado receberá um link de acesso por email"
              />
              <PanelBody>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="email@exemplo.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-9 text-sm flex-1"
                    onKeyDown={(e) => e.key === "Enter" && sendInvite()}
                  />
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger className="h-9 text-sm w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Profissional</SelectItem>
                      <SelectItem value="manager">Gerente de Equipe</SelectItem>
                      <SelectItem value="director">Diretor</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-9" onClick={sendInvite} disabled={inviting || !inviteEmail}>
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    {inviting ? "Enviando..." : "Convidar"}
                  </Button>
                </div>
              </PanelBody>
            </Panel>
          )}

          {/* Pending invitations */}
          {invitations.length > 0 && (
            <Panel>
              <PanelHeader title={`Convites pendentes (${invitations.length})`} />
              <PanelBody>
                <div className="space-y-2">
                  {invitations.map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between rounded-lg border border-dashed border-border p-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs">
                          <Mail className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <p className="text-sm">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">
                            {ROLES.find((r) => r.value === inv.role)?.label || inv.role}
                          </p>
                        </div>
                      </div>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => cancelInvite(inv.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </PanelBody>
            </Panel>
          )}

          {/* Members list */}
          <Panel>
            <PanelHeader title={`Membros (${members.length})`} />
            <PanelBody className="py-1">
              <div className="divide-y divide-border/60">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 py-3 transition-colors hover:bg-muted/30">
                    <InitialsAvatar name={m.name || m.email || "U"} src={m.avatar_url} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.name || "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.email} {m.title ? `· ${m.title}` : ""}</p>
                    </div>
                    {isAdmin && m.id !== user?.id ? (
                      <Select value={m.role || "member"} onValueChange={(v) => changeRole(m.id, v)}>
                        <SelectTrigger className={`h-7 text-xs w-36 gap-1 ${roleColor(m.role || "member")}`}>
                          {roleIcon(m.role || "member")}
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {currentUserRole === "owner" && <SelectItem value="owner">Dono</SelectItem>}
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="director">Diretor</SelectItem>
                          <SelectItem value="manager">Gerente de Equipe</SelectItem>
                          <SelectItem value="member">Profissional</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <StatusChip tone={roleTone(m.role || "member")} dot={false} className="gap-1 text-xs">
                        {roleIcon(m.role || "member")}
                        {ROLES.find((r) => r.value === m.role)?.label || "Membro"}
                      </StatusChip>
                    )}
                    {isAdmin && m.id !== user?.id && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeMember(m.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </PanelBody>
          </Panel>
        </TabsContent>

        {/* ── Permissions Tab ── */}
        <TabsContent value="permissions" className="mt-0">
          <Panel>
            <PanelHeader
              title="Controle de acesso (RBAC)"
              description="Configure o que cada papel pode fazer na organização"
            />
            <PanelBody>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-[200px]">Permissão</TableHead>
                      {ROLES.map((r) => (
                        <TableHead key={r.value} className="text-xs text-center">{r.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PERMISSIONS.map((perm) => (
                      <TableRow key={perm.key}>
                        <TableCell className="text-sm font-medium">{perm.label}</TableCell>
                        {ROLES.map((r) => {
                          const allowed = getPermissionValue(r.value, perm.key);
                          const isOwnerPerm = r.value === "owner";
                          return (
                            <TableCell key={r.value} className="text-center">
                              {isAdmin && !isOwnerPerm ? (
                                <Select
                                  value={allowed ? "yes" : "no"}
                                  onValueChange={() => togglePermission(r.value, perm.key, allowed)}
                                >
                                  <SelectTrigger className={`h-7 text-xs w-20 mx-auto ${allowed ? "text-success" : "text-destructive"}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="yes">Sim</SelectItem>
                                    <SelectItem value="no">Não</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <StatusChip tone={allowed ? "success" : "neutral"} dot={false} className="text-xs">
                                  {allowed ? "Sim" : "Não"}
                                </StatusChip>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </PanelBody>
          </Panel>
        </TabsContent>

        {/* ── Teams Tab ── */}
        {/* ── Directorates Tab ── */}
        <TabsContent value="directorates" className="mt-0 space-y-4">
          <Panel>
            <PanelHeader
              className="border-b-0"
              title="Como funciona a hierarquia"
              description={
                <>
                  <span className="font-medium">Dono / Admin</span> vê tudo.{" "}
                  <span className="font-medium">Diretor</span> vê todas as equipes da sua diretoria.{" "}
                  <span className="font-medium">Gerente de Equipe</span> vê os profissionais da sua equipe.{" "}
                  <span className="font-medium">Profissional</span> vê apenas os próprios dados.
                </>
              }
            />
          </Panel>

          {isAdmin && (
            <Panel>
              <PanelHeader title="Nova diretoria" />
              <PanelBody>
                <div className="flex gap-2">
                  <Input
                    placeholder="Nome da diretoria (ex: Diretoria Comercial)"
                    value={newDirectorateName}
                    onChange={(e) => setNewDirectorateName(e.target.value)}
                    className="h-9 text-sm flex-1"
                    onKeyDown={(e) => e.key === "Enter" && createDirectorate()}
                  />
                  <Button size="sm" className="h-9" onClick={createDirectorate}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />Criar
                  </Button>
                </div>
              </PanelBody>
            </Panel>
          )}

          {directorates.length === 0 ? (
            <EmptyState
              icon={Crown}
              title="Nenhuma diretoria criada ainda"
              description="Crie uma diretoria para agrupar equipes e dar visibilidade aos diretores."
            />
          ) : (
            directorates.map((d: any) => {
              const linkedTeams = teams.filter((t: any) => t.directorate_id === d.id);
              const directors = members.filter((m) => m.role === "director");
              return (
                <Panel key={d.id}>
                  <PanelHeader
                    title={
                      <span className="flex items-center gap-2">
                        <Crown className="h-4 w-4 text-warning" />
                        {d.name}
                      </span>
                    }
                    actions={
                      isAdmin ? (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteDirectorate(d.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : undefined
                    }
                  />
                  <PanelBody className="space-y-4">
                    <div>
                      <SectionLabel className="mb-2">Diretores</SectionLabel>
                      {directors.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Nenhum membro com papel "Diretor". Promova alguém em Membros.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {directors.map((m) => {
                            const linked = directorateMembers.some(
                              (dm: any) => dm.directorate_id === d.id && dm.user_id === m.id,
                            );
                            return (
                              <button
                                key={m.id}
                                onClick={() => isAdmin && toggleDirectorateMember(d.id, m.id)}
                                disabled={!isAdmin}
                                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                                  linked
                                    ? "border-warning/40 bg-warning/10 text-warning"
                                    : "border-border bg-background text-muted-foreground hover:border-warning/30"
                                } ${!isAdmin ? "cursor-default" : "cursor-pointer"}`}
                              >
                                <InitialsAvatar name={m.name || m.email || "U"} src={m.avatar_url} size="xs" className="h-5 w-5 rounded-md text-[8px]" />
                                {m.name || m.email}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div>
                      <SectionLabel className="mb-2">Equipes vinculadas ({linkedTeams.length})</SectionLabel>
                      {linkedTeams.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Nenhuma equipe vinculada. Vá em Equipes e selecione esta diretoria no menu da equipe.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {linkedTeams.map((t: any) => (
                            <Badge key={t.id} variant="outline" className="text-xs">
                              <Users className="h-3 w-3 mr-1" />{t.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </PanelBody>
                </Panel>
              );
            })
          )}
        </TabsContent>

        {/* ── Teams Tab ── */}
        <TabsContent value="teams" className="mt-0 space-y-4">
          {isAdmin && (
            <Panel>
              <PanelHeader title="Nova equipe" />
              <PanelBody>
                <div className="flex gap-2">
                  <Input
                    placeholder="Nome da equipe"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    className="h-9 text-sm flex-1"
                    onKeyDown={(e) => e.key === "Enter" && createTeam()}
                  />
                  <Button size="sm" className="h-9" onClick={createTeam}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />Criar
                  </Button>
                </div>
              </PanelBody>
            </Panel>
          )}

          {teams.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nenhuma equipe criada ainda"
              description="Crie equipes para agrupar profissionais e delimitar a visibilidade dos gerentes."
            />
          ) : (
            teams.map((team: any) => (
              <Panel key={team.id}>
                <PanelHeader
                  title={
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      {team.name}
                    </span>
                  }
                  actions={
                    isAdmin ? (
                      <>
                        <Select
                          value={team.directorate_id || "none"}
                          onValueChange={(v) => setTeamDirectorate(team.id, v === "none" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-xs w-48">
                            <SelectValue placeholder="Sem diretoria" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem diretoria</SelectItem>
                            {directorates.map((d: any) => (
                              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteTeam(team.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : undefined
                  }
                />
                <PanelBody>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => {
                      const inTeam = teamMembers.some((tm: any) => tm.team_id === team.id && tm.user_id === m.id);
                      return (
                        <button
                          key={m.id}
                          onClick={() => isAdmin && toggleTeamMember(team.id, m.id)}
                          disabled={!isAdmin}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                            inTeam
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground hover:border-primary/20"
                          } ${!isAdmin ? "cursor-default" : "cursor-pointer"}`}
                        >
                          <InitialsAvatar name={m.name || m.email || "U"} src={m.avatar_url} size="xs" className="h-5 w-5 rounded-md text-[8px]" />
                          {m.name || m.email}
                        </button>
                      );
                    })}
                  </div>
                </PanelBody>
              </Panel>
            ))
          )}
        </TabsContent>
        </div>
      </PageScaffold>
    </Tabs>
  );
}
