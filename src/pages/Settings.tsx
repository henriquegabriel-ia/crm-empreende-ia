import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ds/button";
import { Input } from "@/components/ds/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ds/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ds/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Trash2, UserPlus, Shield, Moon, Sun, Monitor,
  Crown, Users, X, Check, Minus, ChevronUp, ChevronDown,
} from "lucide-react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Panel, PanelHeader, PanelBody } from "@/components/foundation/Panel";
import { StatusChip } from "@/components/foundation/StatusChip";
import { StatStrip } from "@/components/foundation/StatStrip";
import { SidePanel } from "@/components/foundation/SidePanel";
import { InitialsAvatar } from "@/components/foundation/InitialsAvatar";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/contexts/ThemeContext";
import { OnboardingSection } from "@/components/settings/OnboardingSection";
import { DemoDataSection } from "@/components/settings/DemoDataSection";
import { PermissionsAuditTab } from "@/components/settings/PermissionsAuditTab";
import type { Database } from "@/integrations/supabase/types";

type PipelineStage = Database["public"]["Tables"]["pipeline_stages"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export default function Settings() {
  const { user, profile } = useAuth();
  const { orgId } = useOrg();

  return (
    <Tabs defaultValue="general" className="contents">
      <PageScaffold
        title="Configurações"
        toolbar={
          <TabsList className="border-b-0">
            <TabsTrigger value="general">Geral</TabsTrigger>
            <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
            <TabsTrigger value="custom-fields">Campos</TabsTrigger>
            <TabsTrigger value="members">Membros</TabsTrigger>
            <TabsTrigger value="notifications">Notificações</TabsTrigger>
            <TabsTrigger value="appearance">Aparência</TabsTrigger>
            <TabsTrigger value="billing">Plano</TabsTrigger>
            <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
            <TabsTrigger value="permissions">Permissões</TabsTrigger>
            <TabsTrigger value="demo">Demonstração</TabsTrigger>
          </TabsList>
        }
      >
        <div className="mx-auto w-full max-w-4xl">
          <TabsContent value="general" className="mt-0">
            <GeneralTab orgId={orgId} userId={user?.id} profile={profile} />
          </TabsContent>
          <TabsContent value="pipelines" className="mt-0">
            <PipelinesTab orgId={orgId} />
          </TabsContent>
          <TabsContent value="custom-fields" className="mt-0">
            <CustomFieldsTab orgId={orgId} />
          </TabsContent>
          <TabsContent value="members" className="mt-0">
            <MembersTab orgId={orgId} userId={user?.id} />
          </TabsContent>
          <TabsContent value="notifications" className="mt-0">
            <NotificationsTab orgId={orgId} userId={user?.id} />
          </TabsContent>
          <TabsContent value="appearance" className="mt-0">
            <AppearanceTab />
          </TabsContent>
          <TabsContent value="billing" className="mt-0">
            <BillingTab orgId={orgId} />
          </TabsContent>
          <TabsContent value="onboarding" className="mt-0">
            <OnboardingSection />
          </TabsContent>
          <TabsContent value="permissions" className="mt-0">
            <PermissionsAuditTab />
          </TabsContent>
          <TabsContent value="demo" className="mt-0">
            <DemoDataSection orgId={orgId} userId={user?.id} />
          </TabsContent>
        </div>
      </PageScaffold>
    </Tabs>
  );
}

// ── General Tab ──
function GeneralTab({ orgId, userId, profile }: { orgId: string | null; userId?: string; profile: Profile | null }) {
  const { toast } = useToast();
  const [profileForm, setProfileForm] = useState({ name: "", title: "", timezone: "UTC" });
  const [orgForm, setOrgForm] = useState({ name: "", slug: "", currency: "BRL", timezone: "America/Sao_Paulo" });
  const [orgSettings, setOrgSettings] = useState<Record<string, unknown>>({});
  const [industries, setIndustries] = useState<string[]>([]);
  const [newIndustry, setNewIndustry] = useState("");

  const DEFAULT_INDUSTRIES = [
    "Tecnologia", "SaaS", "Serviços", "E-commerce", "Indústria",
    "Consultoria", "Educação", "Saúde", "Financeiro", "Varejo",
    "Logística", "Agronegócio", "Imobiliário", "Jurídico", "Marketing",
  ];

  useEffect(() => {
    if (profile) setProfileForm({ name: profile.name || "", title: profile.title || "", timezone: profile.timezone || "UTC" });
  }, [profile]);

  useEffect(() => {
    if (orgId) {
      (supabase as any).from("organizations").select("*").eq("id", orgId).single().then(({ data }) => {
        if (data) {
          const settings = (data.settings as Record<string, unknown>) || {};
          setOrgSettings(settings);
          setOrgForm({ name: data.name, slug: data.slug, currency: (settings.currency as string) || "BRL", timezone: (settings.timezone as string) || "America/Sao_Paulo" });
          const savedIndustries = settings.industries as string[] | undefined;
          setIndustries(savedIndustries && savedIndustries.length > 0 ? savedIndustries : DEFAULT_INDUSTRIES);
        }
      });
    }
  }, [orgId]);

  const saveProfile = async () => {
    if (!userId) return;
    const { error } = await (supabase as any).from("profiles").update({
      name: profileForm.name, title: profileForm.title, timezone: profileForm.timezone,
    }).eq("id", userId);
    toast(error ? { title: "Erro", description: error.message, variant: "destructive" } : { title: "Perfil atualizado" });
  };

  const saveOrg = async () => {
    if (!orgId) return;
    const mergedSettings = { ...orgSettings, currency: orgForm.currency, timezone: orgForm.timezone };
    const { error } = await (supabase as any).from("organizations").update({
      name: orgForm.name,
      slug: orgForm.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      settings: mergedSettings,
    }).eq("id", orgId);
    if (!error) setOrgSettings(mergedSettings);
    toast(error ? { title: "Erro", description: error.message, variant: "destructive" } : { title: "Organização atualizada" });
  };

  const saveIndustries = async (updated: string[]) => {
    if (!orgId) return;
    setIndustries(updated);
    const mergedSettings = { ...orgSettings, industries: updated };
    const { error } = await (supabase as any).from("organizations").update({ settings: mergedSettings }).eq("id", orgId);
    if (!error) setOrgSettings(mergedSettings);
    toast(error ? { title: "Erro", description: error.message, variant: "destructive" } : { title: "Indústrias atualizadas" });
  };

  const addIndustry = () => {
    const trimmed = newIndustry.trim();
    if (!trimmed || industries.includes(trimmed)) return;
    saveIndustries([...industries, trimmed]);
    setNewIndustry("");
  };

  const removeIndustry = (ind: string) => {
    saveIndustries(industries.filter((i) => i !== ind));
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Perfil pessoal" description="Suas informações pessoais" />
        <PanelBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} className="h-8 text-xs" /></div>
            <div className="space-y-1"><Label className="text-xs">Cargo</Label><Input value={profileForm.title} onChange={(e) => setProfileForm({ ...profileForm, title: e.target.value })} className="h-8 text-xs" /></div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fuso horário</Label>
            <Select value={profileForm.timezone} onValueChange={(v) => setProfileForm({ ...profileForm, timezone: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="America/Sao_Paulo">São Paulo (BRT)</SelectItem>
                <SelectItem value="America/New_York">New York (EST)</SelectItem>
                <SelectItem value="Europe/London">London (GMT)</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={saveProfile}>Salvar Perfil</Button>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Organização" description="Configurações gerais da organização" />
        <PanelBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} className="h-8 text-xs" /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Moeda padrão</Label>
              <Select value={orgForm.currency} onValueChange={(v) => setOrgForm({ ...orgForm, currency: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">BRL (R$)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fuso horário da organização</Label>
              <Select value={orgForm.timezone} onValueChange={(v) => setOrgForm({ ...orgForm, timezone: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/Sao_Paulo">São Paulo (BRT)</SelectItem>
                  <SelectItem value="America/New_York">New York (EST)</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={saveOrg}>Salvar Organização</Button>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Indústrias" description="Personalize as opções de indústria disponíveis ao cadastrar empresas" />
        <PanelBody className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Nova indústria"
              value={newIndustry}
              onChange={(e) => setNewIndustry(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addIndustry()}
              className="h-8 text-xs flex-1"
            />
            <Button size="sm" className="h-8" onClick={addIndustry}><Plus className="h-3 w-3" /></Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {industries.map((ind) => (
              <Badge key={ind} variant="secondary" className="text-xs gap-1">
                {ind}
                <button onClick={() => removeIndustry(ind)} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
              </Badge>
            ))}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}


// ── Pipelines Tab ──
function PipelinesTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [pipelines, setPipelines] = useState<Database["public"]["Tables"]["pipelines"]["Row"][]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState("");
  const [newPipelineName, setNewPipelineName] = useState("");
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#3b82f6");
  const [newStageProb, setNewStageProb] = useState("0");
  // Loss reasons
  const [lossReasons, setLossReasons] = useState<any[]>([]);
  const [newLossReason, setNewLossReason] = useState("");

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    const [{ data: p }, { data: s }, { data: lr }] = await Promise.all([
      (supabase as any).from("pipelines").select("*").eq("org_id", orgId),
      (supabase as any).from("pipeline_stages").select("*").eq("org_id", orgId).order("order"),
      (supabase as any).from("loss_reasons").select("*").eq("org_id", orgId) as any,
    ]);
    setPipelines(p || []);
    setStages(s || []);
    setLossReasons(lr || []);
    if (p?.length && !selectedPipeline) setSelectedPipeline(p[0].id);
  }, [orgId, selectedPipeline]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createPipeline = async () => {
    if (!orgId || !newPipelineName) return;
    const { data } = await (supabase as any).from("pipelines").insert({ org_id: orgId, name: newPipelineName, is_default: pipelines.length === 0 }).select().single();
    setNewPipelineName("");
    if (data) setSelectedPipeline(data.id);
    fetchAll();
    toast({ title: "Pipeline criado" });
  };

  const deletePipeline = async (id: string) => {
    await (supabase as any).from("pipeline_stages").delete().eq("pipeline_id", id);
    await (supabase as any).from("pipelines").delete().eq("id", id);
    setSelectedPipeline("");
    fetchAll();
    toast({ title: "Pipeline excluído" });
  };

  const addStage = async () => {
    if (!orgId || !selectedPipeline || !newStageName) return;
    const maxOrder = stages.filter((s) => s.pipeline_id === selectedPipeline).reduce((max, s) => Math.max(max, (s as any).position ?? -1), -1);
    await (supabase as any).from("pipeline_stages").insert({
      org_id: orgId, pipeline_id: selectedPipeline, name: newStageName,
      position: maxOrder + 1, color: newStageColor, probability: parseFloat(newStageProb) || 0,
    });
    setNewStageName("");
    fetchAll();
    toast({ title: "Estágio adicionado" });
  };

  const deleteStage = async (id: string) => {
    await (supabase as any).from("pipeline_stages").delete().eq("id", id);
    fetchAll();
    toast({ title: "Estágio excluído" });
  };

  const moveStage = async (stageId: string, direction: "up" | "down") => {
    const pStages = stages.filter((s) => s.pipeline_id === selectedPipeline).sort((a, b) => ((a as any).position ?? 0) - ((b as any).position ?? 0));
    const idx = pStages.findIndex((s) => s.id === stageId);
    if ((direction === "up" && idx === 0) || (direction === "down" && idx === pStages.length - 1)) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    await Promise.all([
      (supabase as any).from("pipeline_stages").update({ position: (pStages[swapIdx] as any).position }).eq("id", pStages[idx].id),
      (supabase as any).from("pipeline_stages").update({ position: (pStages[idx] as any).position }).eq("id", pStages[swapIdx].id),
    ]);
    fetchAll();
  };

  const addLossReason = async () => {
    if (!orgId || !newLossReason) return;
    await (supabase as any).from("loss_reasons").insert({ org_id: orgId, label: newLossReason } as any);
    setNewLossReason("");
    fetchAll();
    toast({ title: "Razão de perda adicionada" });
  };

  const deleteLossReason = async (id: string) => {
    await (supabase as any).from("loss_reasons").delete().eq("id", id);
    fetchAll();
  };

  const pipelineStages = stages.filter((s) => s.pipeline_id === selectedPipeline).sort((a, b) => ((a as any).position ?? 0) - ((b as any).position ?? 0));

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Pipelines" description="Gerencie seus pipelines de vendas" />
        <PanelBody className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Nome do pipeline" value={newPipelineName} onChange={(e) => setNewPipelineName(e.target.value)} className="h-8 text-xs" />
            <Button size="sm" className="h-8 text-xs" onClick={createPipeline}><Plus className="mr-1 h-3 w-3" />Criar</Button>
          </div>
          {pipelines.length > 0 && (
            <div className="flex gap-2">
              <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedPipeline && (
                <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => deletePipeline(selectedPipeline)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </PanelBody>
      </Panel>

      {selectedPipeline && (
        <Panel>
          <PanelHeader title="Estágios" description="Configure estágios do pipeline selecionado. Arraste para reordenar." />
          <PanelBody className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Nome" value={newStageName} onChange={(e) => setNewStageName(e.target.value)} className="h-8 text-xs flex-1" />
              <Input type="color" value={newStageColor} onChange={(e) => setNewStageColor(e.target.value)} className="w-10 h-8 p-0.5" />
              <Input type="number" placeholder="Prob %" value={newStageProb} onChange={(e) => setNewStageProb(e.target.value)} className="h-8 text-xs w-20" min="0" max="100" />
              <Button size="sm" className="h-8" onClick={addStage}><Plus className="h-3 w-3" /></Button>
            </div>
            <div className="space-y-1">
              {pipelineStages.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveStage(s.id, "up")} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Mover para cima"><ChevronUp className="h-3 w-3" /></button>
                    <button onClick={() => moveStage(s.id, "down")} disabled={i === pipelineStages.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Mover para baixo"><ChevronDown className="h-3 w-3" /></button>
                  </div>
                  <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: (s as any).color || "#888" }} />
                  <span className="text-xs font-medium flex-1">{s.name}</span>
                  <StatusChip tone="neutral" dot={false} className="text-xs px-1.5">{s.probability || 0}%</StatusChip>
                  <span className="text-xs text-muted-foreground">#{(s as any).position}</span>
                  <button onClick={() => deleteStage(s.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader title="Razões de perda" description="Motivos customizáveis quando um negócio é marcado como perdido" />
        <PanelBody className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Ex: Preço alto" value={newLossReason} onChange={(e) => setNewLossReason(e.target.value)} className="h-8 text-xs flex-1" />
            <Button size="sm" className="h-8" onClick={addLossReason}><Plus className="h-3 w-3" /></Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {lossReasons.map((lr: any) => (
              <Badge key={lr.id} variant="secondary" className="text-xs gap-1">
                {lr.label}
                <button onClick={() => deleteLossReason(lr.id)} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
              </Badge>
            ))}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

// ── Custom Fields Tab ──
function CustomFieldsTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [fields, setFields] = useState<any[]>([]);
  const [entityType, setEntityType] = useState("contacts");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    field_key: "", field_label: "", field_type: "text", is_required: false,
    show_in_table: true, show_in_card: true, options: "",
  });

  const fetchFields = useCallback(async () => {
    if (!orgId) return;
    const { data } = await (supabase as any).from("custom_field_definitions").select("*").eq("org_id", orgId).order("field_order") as any;
    setFields(data || []);
  }, [orgId]);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  const createField = async () => {
    if (!orgId || !form.field_key || !form.field_label) return;
    const opts = form.options ? form.options.split(",").map((o: string) => o.trim()).filter(Boolean) : [];
    await (supabase as any).from("custom_field_definitions").insert({
      org_id: orgId, entity_type: entityType, field_key: form.field_key.toLowerCase().replace(/\s+/g, "_"),
      field_label: form.field_label, field_type: form.field_type, is_required: form.is_required,
      show_in_table: form.show_in_table, show_in_card: form.show_in_card, options: opts,
      field_order: fields.filter((f: any) => f.entity_type === entityType).length,
    } as any);
    setShowCreate(false);
    setForm({ field_key: "", field_label: "", field_type: "text", is_required: false, show_in_table: true, show_in_card: true, options: "" });
    fetchFields();
    toast({ title: "Campo criado" });
  };

  const deleteField = async (id: string) => {
    await (supabase as any).from("custom_field_definitions").delete().eq("id", id);
    fetchFields();
    toast({ title: "Campo excluído" });
  };

  const entityFields = fields.filter((f: any) => f.entity_type === entityType);

  const fieldTypes: Record<string, string> = {
    text: "Texto", textarea: "Texto longo", number: "Número", currency: "Moeda",
    date: "Data", select: "Select", multi_select: "Multi-select", checkbox: "Checkbox",
    url: "URL", email: "Email", phone: "Telefone",
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Campos customizados"
          description="Adicione campos extras para suas entidades"
          actions={
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="mr-1 h-3 w-3" />Novo Campo
            </Button>
          }
        />
        <PanelBody className="space-y-3">
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="h-8 text-xs w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="contacts">Contatos</SelectItem>
              <SelectItem value="companies">Empresas</SelectItem>
              <SelectItem value="deals">Negócios</SelectItem>
            </SelectContent>
          </Select>

          {entityFields.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhum campo customizado para esta entidade</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Campo</TableHead>
                  <TableHead className="text-xs">Chave</TableHead>
                  <TableHead className="text-xs">Tipo</TableHead>
                  <TableHead className="text-xs">Obrigatório</TableHead>
                  <TableHead className="text-xs">Tabela</TableHead>
                  <TableHead className="text-xs">Card</TableHead>
                  <TableHead className="text-xs" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entityFields.map((f: any) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-xs font-medium">{f.field_label}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{f.field_key}</TableCell>
                    <TableCell><StatusChip tone="neutral" dot={false} className="text-xs">{fieldTypes[f.field_type] || f.field_type}</StatusChip></TableCell>
                    <TableCell>{f.is_required ? <Check className="h-3.5 w-3.5 text-success" /> : <Minus className="h-3 w-3 text-muted-foreground/50" />}</TableCell>
                    <TableCell>{f.show_in_table ? <Check className="h-3.5 w-3.5 text-success" /> : <Minus className="h-3 w-3 text-muted-foreground/50" />}</TableCell>
                    <TableCell>{f.show_in_card ? <Check className="h-3.5 w-3.5 text-success" /> : <Minus className="h-3 w-3 text-muted-foreground/50" />}</TableCell>
                    <TableCell>
                      <button onClick={() => deleteField(f.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>

      <SidePanel
        open={showCreate}
        onOpenChange={setShowCreate}
        kicker="Campos customizados"
        title={`Novo campo (${entityType})`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button size="sm" onClick={createField}>Criar</Button>
          </>
        }
      >
        <div className="space-y-3">
            <div className="grid gap-3 grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">Label</Label><Input value={form.field_label} onChange={(e) => setForm({ ...form, field_label: e.target.value, field_key: e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") })} className="h-8 text-xs" placeholder="Ex: Setor" /></div>
              <div className="space-y-1"><Label className="text-xs">Chave</Label><Input value={form.field_key} onChange={(e) => setForm({ ...form, field_key: e.target.value })} className="h-8 text-xs font-mono" /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={form.field_type} onValueChange={(v) => setForm({ ...form, field_type: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(fieldTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(form.field_type === "select" || form.field_type === "multi_select") && (
              <div className="space-y-1">
                <Label className="text-xs">Opções (separadas por vírgula)</Label>
                <Input value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} className="h-8 text-xs" placeholder="Opção 1, Opção 2, Opção 3" />
              </div>
            )}
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={form.is_required} onCheckedChange={(v) => setForm({ ...form, is_required: !!v })} />Obrigatório</label>
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={form.show_in_table} onCheckedChange={(v) => setForm({ ...form, show_in_table: !!v })} />Tabela</label>
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={form.show_in_card} onCheckedChange={(v) => setForm({ ...form, show_in_card: !!v })} />Card</label>
            </div>
        </div>
      </SidePanel>
    </div>
  );
}

// ── Members Tab ──
function MembersTab({ orgId, userId }: { orgId: string | null; userId?: string }) {
  const { toast } = useToast();
  const [members, setMembers] = useState<(Profile & { role?: string })[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("member");
  // Teams
  const [teams, setTeams] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [newTeamName, setNewTeamName] = useState("");

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    const [{ data: profs }, { data: rl }, { data: tms }, { data: tmem }] = await Promise.all([
      (supabase as any).from("profiles").select("*").eq("org_id", orgId),
      (supabase as any).from("user_roles").select("*").eq("org_id", orgId),
      (supabase as any).from("teams").select("*").eq("org_id", orgId) as any,
      (supabase as any).from("team_members").select("*") as any,
    ]);
    setRoles(rl || []);
    setTeams(tms || []);
    setTeamMembers(tmem || []);
    const merged = (profs || []).map((p) => {
      const r = (rl || []).find((r: any) => r.user_id === p.id);
      return { ...p, role: r?.role || "member" };
    });
    setMembers(merged);
  }, [orgId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const sendInvite = async () => {
    if (!orgId || !inviteEmail) return;
    const { error } = await (supabase as any).from("invitations").insert({
      org_id: orgId, email: inviteEmail, invited_by: userId, role: inviteRole as any,
    });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setInviteEmail("");
    toast({ title: "Convite enviado!" });
  };

  const removeUser = async (uid: string) => {
    if (uid === userId) { toast({ title: "Você não pode remover a si mesmo", variant: "destructive" }); return; }
    await (supabase as any).from("user_roles").delete().eq("user_id", uid).eq("org_id", orgId!);
    await (supabase as any).from("profiles").update({ org_id: null }).eq("id", uid);
    fetchAll();
    toast({ title: "Acesso revogado" });
  };

  const createTeam = async () => {
    if (!orgId || !newTeamName) return;
    await (supabase as any).from("teams").insert({ org_id: orgId, name: newTeamName } as any);
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
      await (supabase as any).from("team_members").insert({ team_id: teamId, user_id: uid } as any);
    }
    fetchAll();
  };

  const roleLabels: Record<string, string> = { owner: "Proprietário", admin: "Administrador", member: "Membro" };
  const roleTones: Record<string, "warning" | "info" | "neutral"> = { owner: "warning", admin: "info", member: "neutral" };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Convidar membro" description="Envie convites por email com papel definido" />
        <PanelBody>
          <div className="flex gap-2">
            <Input type="email" placeholder="email@exemplo.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="h-8 text-xs flex-1" />
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Membro</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 text-xs" onClick={sendInvite}><UserPlus className="mr-1 h-3 w-3" />Convidar</Button>
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title={`Membros (${members.length})`} />
        <PanelBody>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                <InitialsAvatar name={m.name || m.email || "U"} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{m.name || "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.email} · {m.title || "—"}</p>
                </div>
                <StatusChip tone={roleTones[m.role || "member"] || "neutral"} dot={false} className="gap-1 text-xs">
                  <Shield className="h-2.5 w-2.5" />
                  {roleLabels[m.role || "member"]}
                </StatusChip>
                {m.id !== userId && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeUser(m.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Equipes" description="Organize vendedores em grupos" />
        <PanelBody className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Nome da equipe" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} className="h-8 text-xs flex-1" />
            <Button size="sm" className="h-8 text-xs" onClick={createTeam}><Plus className="mr-1 h-3 w-3" />Criar</Button>
          </div>
          {teams.map((t: any) => (
            <div key={t.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium flex items-center gap-1.5"><Users className="h-3 w-3" />{t.name}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteTeam(t.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const inTeam = teamMembers.some((tm: any) => tm.team_id === t.id && tm.user_id === m.id);
                  return (
                    <button key={m.id} onClick={() => toggleTeamMember(t.id, m.id)}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${inTeam ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary/60"}`}>
                      {m.name || m.email}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </PanelBody>
      </Panel>

      {/* RBAC Reference */}
      <Panel>
        <PanelHeader title="Permissões (RBAC)" />
        <PanelBody>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Permissão</TableHead>
                <TableHead className="text-xs text-center">Owner</TableHead>
                <TableHead className="text-xs text-center">Admin</TableHead>
                <TableHead className="text-xs text-center">Member</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Ver todos os dados", true, true, false],
                ["Editar qualquer registro", true, true, false],
                ["Gerenciar usuários/config", true, true, false],
                ["Criar automações", true, true, false],
                ["Exportar dados", true, true, false],
                ["Ver relatórios", true, true, false],
                ["Billing / deletar org", true, false, false],
                ["Ver/editar próprios registros", true, true, true],
              ].map(([perm, o, a, m], i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{perm as string}</TableCell>
                  <TableCell className="text-center">{o ? <Check className="mx-auto h-3.5 w-3.5 text-success" /> : <Minus className="mx-auto h-3 w-3 text-muted-foreground/50" />}</TableCell>
                  <TableCell className="text-center">{a ? <Check className="mx-auto h-3.5 w-3.5 text-success" /> : <Minus className="mx-auto h-3 w-3 text-muted-foreground/50" />}</TableCell>
                  <TableCell className="text-center">{m ? <Check className="mx-auto h-3.5 w-3.5 text-success" /> : <Minus className="mx-auto h-3 w-3 text-muted-foreground/50" />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>
    </div>
  );
}

// ── Notifications Tab ──
function NotificationsTab({ orgId, userId }: { orgId: string | null; userId?: string }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState({
    daily_summary: true, daily_summary_hour: 9,
    notify_deal_won: true, notify_deal_lost: true,
    notify_task_overdue: true, notify_mention: true, notify_assignment: true,
    email_daily_summary: true, email_deal_won: false, email_task_overdue: false,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!orgId || !userId) return;
    (supabase as any).from("notification_preferences").select("*").eq("user_id", userId).eq("org_id", orgId).single()
      .then(({ data }: any) => {
        if (data) setPrefs(data);
        setLoaded(true);
      });
  }, [orgId, userId]);

  const save = async () => {
    if (!orgId || !userId) return;
    const { error } = await (supabase as any).from("notification_preferences").upsert({
      user_id: userId, org_id: orgId, ...prefs,
    } as any, { onConflict: "user_id,org_id" });
    toast(error ? { title: "Erro", variant: "destructive" } : { title: "Preferências salvas" });
  };

  const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Notificações in-app" description="Quais eventos geram notificação no CRM" />
        <PanelBody className="divide-y divide-border">
          <Toggle label="Negócio ganho" checked={prefs.notify_deal_won} onChange={(v) => setPrefs({ ...prefs, notify_deal_won: v })} />
          <Toggle label="Negócio perdido" checked={prefs.notify_deal_lost} onChange={(v) => setPrefs({ ...prefs, notify_deal_lost: v })} />
          <Toggle label="Tarefa vencida" checked={prefs.notify_task_overdue} onChange={(v) => setPrefs({ ...prefs, notify_task_overdue: v })} />
          <Toggle label="Menção (@)" checked={prefs.notify_mention} onChange={(v) => setPrefs({ ...prefs, notify_mention: v })} />
          <Toggle label="Atribuição de registro" checked={prefs.notify_assignment} onChange={(v) => setPrefs({ ...prefs, notify_assignment: v })} />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Notificações por email" description="Quais emails você deseja receber" />
        <PanelBody className="space-y-3">
          <div className="divide-y divide-border">
            <Toggle label="Resumo diário" checked={prefs.email_daily_summary} onChange={(v) => setPrefs({ ...prefs, email_daily_summary: v })} />
            <Toggle label="Negócio ganho" checked={prefs.email_deal_won} onChange={(v) => setPrefs({ ...prefs, email_deal_won: v })} />
            <Toggle label="Tarefa vencida" checked={prefs.email_task_overdue} onChange={(v) => setPrefs({ ...prefs, email_task_overdue: v })} />
          </div>
          {prefs.email_daily_summary && (
            <div className="flex items-center gap-2">
              <Label className="text-xs">Horário do resumo:</Label>
              <Select value={String(prefs.daily_summary_hour)} onValueChange={(v) => setPrefs({ ...prefs, daily_summary_hour: parseInt(v) })}>
                <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>{String(i).padStart(2, "0")}:00</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </PanelBody>
      </Panel>

      <Button size="sm" className="h-8 text-xs" onClick={save}>Salvar Preferências</Button>
    </div>
  );
}

// ── Appearance Tab ──
function AppearanceTab() {
  const { theme, setTheme, density, setDensity } = useTheme();

  const themes = [
    { value: "light" as const, label: "Claro", icon: Sun },
    { value: "dark" as const, label: "Escuro", icon: Moon },
    { value: "system" as const, label: "Sistema", icon: Monitor },
  ];

  const densities = [
    { value: "compact" as const, label: "Compacta", desc: "Menos espaçamento, mais dados visíveis" },
    { value: "normal" as const, label: "Normal", desc: "Espaçamento padrão" },
    { value: "comfortable" as const, label: "Confortável", desc: "Mais espaçamento, leitura facilitada" },
  ];

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Tema" description="Escolha entre modo claro, escuro ou automático" />
        <PanelBody>
          <div className="grid grid-cols-3 gap-3">
            {themes.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.value} onClick={() => setTheme(t.value)}
                  className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${theme === t.value ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/60"}`}>
                  <Icon className="h-5 w-5" />
                  <span className="text-xs font-medium">{t.label}</span>
                </button>
              );
            })}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Densidade da tabela" />
        <PanelBody>
          <div className="grid grid-cols-3 gap-3">
            {densities.map((d) => (
              <button key={d.value} onClick={() => setDensity(d.value)}
                className={`text-left rounded-lg border-2 p-3 transition-colors ${density === d.value ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/60"}`}>
                <p className="text-xs font-medium">{d.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{d.desc}</p>
              </button>
            ))}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

// ── Billing Tab ──
function BillingTab({ orgId }: { orgId: string | null }) {
  const [org, setOrg] = useState<any>(null);
  const [counts, setCounts] = useState({ contacts: 0, deals: 0, companies: 0 });

  useEffect(() => {
    if (!orgId) return;
    (supabase as any).from("organizations").select("*").eq("id", orgId).single().then(({ data }) => setOrg(data));
    Promise.all([
      (supabase as any).from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      (supabase as any).from("deals").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      (supabase as any).from("companies").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    ]).then(([c, d, co]) => setCounts({ contacts: c.count || 0, deals: d.count || 0, companies: co.count || 0 }));
  }, [orgId]);

  const plans = [
    { name: "Free", price: "R$ 0", features: ["500 contatos", "2 pipelines", "1 usuário", "Relatórios básicos"], limit: { contacts: 500, users: 1 }, current: org?.plan === "free" || !org?.plan },
    { name: "Pro", price: "R$ 149/mês", features: ["10.000 contatos", "Pipelines ilimitados", "10 usuários", "AI Copilot", "Automações", "API REST"], limit: { contacts: 10000, users: 10 }, current: org?.plan === "pro" },
    { name: "Enterprise", price: "Sob consulta", features: ["Contatos ilimitados", "Usuários ilimitados", "SSO / SAML", "SLA dedicado", "White-label", "Suporte prioritário"], limit: { contacts: Infinity, users: Infinity }, current: org?.plan === "enterprise" },
  ];

  const invoices = [
    { date: "01/03/2026", amount: "R$ 149,00", status: "Pago", plan: "Pro" },
    { date: "01/02/2026", amount: "R$ 149,00", status: "Pago", plan: "Pro" },
    { date: "01/01/2026", amount: "R$ 149,00", status: "Pago", plan: "Pro" },
  ];

  const contactLimit = plans.find((p) => p.current)?.limit.contacts || 500;

  return (
    <div className="space-y-4">
      {/* Usage */}
      <StatStrip
        stats={[
          { label: "Contatos", value: counts.contacts, hint: Number.isFinite(contactLimit) ? `Limite: ${contactLimit.toLocaleString()}` : "Sem limite" },
          { label: "Negócios", value: counts.deals, hint: "Sem limite" },
          { label: "Empresas", value: counts.companies, hint: "Sem limite" },
        ]}
      />
      {Number.isFinite(contactLimit) && (
        <div className="flex items-center gap-3 px-1">
          <Progress value={Math.min(100, (counts.contacts / contactLimit) * 100)} className="h-1.5 flex-1" />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {counts.contacts.toLocaleString()} de {contactLimit.toLocaleString()} contatos
          </span>
        </div>
      )}

      {/* Plans */}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <Panel key={plan.name} className={plan.current ? "border-primary" : ""}>
            <PanelBody className="space-y-3">
              <div className="flex items-center gap-2">
                {plan.name === "Enterprise" && <Crown className="h-4 w-4 text-warning" />}
                <h3 className="text-sm font-semibold text-foreground">{plan.name}</h3>
                {plan.current && <StatusChip tone="info" dot={false} className="text-xs">Atual</StatusChip>}
              </div>
              <p className="text-lg font-semibold tracking-tight">{plan.price}</p>
              <ul className="space-y-1.5">
                {plan.features.map((f) => (
                  <li key={f} className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Check className="h-3 w-3 shrink-0 text-success" />{f}
                  </li>
                ))}
              </ul>
              {!plan.current && (
                <Button variant="outline" size="sm" className="w-full mt-4 h-8 text-xs">
                  {plan.name === "Enterprise" ? "Falar com Vendas" : "Fazer Upgrade"}
                </Button>
              )}
            </PanelBody>
          </Panel>
        ))}
      </div>

      {/* Invoices */}
      <Panel>
        <PanelHeader title="Histórico de faturas" />
        <PanelBody>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Data</TableHead>
                <TableHead className="text-xs">Plano</TableHead>
                <TableHead className="text-xs">Valor</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{inv.date}</TableCell>
                  <TableCell className="text-xs">{inv.plan}</TableCell>
                  <TableCell className="text-xs">{inv.amount}</TableCell>
                  <TableCell><StatusChip tone="success" className="text-xs">{inv.status}</StatusChip></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>
    </div>
  );
}
