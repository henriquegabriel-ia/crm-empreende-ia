import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ds/button";
import { Input } from "@/components/ds/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ds/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ds/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Panel, PanelHeader, PanelBody } from "@/components/foundation/Panel";
import { StatusChip } from "@/components/foundation/StatusChip";
import { SidePanel } from "@/components/foundation/SidePanel";
import { EmptyState } from "@/components/foundation/EmptyState";
import { LoadingState } from "@/components/foundation/LoadingState";
import {
  MessageSquare, Webhook, Key, Plus, Trash2, Copy, Check, RefreshCw,
  Eye, EyeOff, Loader2, Globe, Zap, Mail, Phone, Cable, AlertTriangle,
  ArrowDownUp, Users, Stethoscope, Calendar, ClipboardList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ──
type IntegrationConfig = {
  id: string; org_id: string; provider: string; config: any; is_active: boolean;
  connected_at: string | null; connected_by: string | null;
};
type ApiKey = {
  id: string; org_id: string; name: string; key_prefix: string; key_hash: string;
  created_at: string | null; last_used_at: string | null; is_active: boolean; request_count: number;
};
type WebhookRow = {
  id: string; org_id: string; name: string; url: string; events: string[];
  secret: string | null; is_active: boolean; created_at: string | null;
  last_triggered_at: string | null; failure_count: number;
};

const WEBHOOK_EVENTS = [
  { value: "deal.won", label: "Negócio Ganho" },
  { value: "deal.lost", label: "Negócio Perdido" },
  { value: "deal.stage_changed", label: "Mudança de Stage" },
  { value: "contact.created", label: "Contato Criado" },
  { value: "deal.created", label: "Negócio Criado" },
  { value: "activity.created", label: "Atividade Criada" },
];

export default function Integrations() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const { toast } = useToast();

  return (
    <Tabs defaultValue="integrations" className="contents">
      <PageScaffold
        title="Integrações & API"
        toolbar={
          <TabsList className="border-b-0">
            <TabsTrigger value="integrations" className="gap-2">
              <Cable className="h-4 w-4" />
              Integrações
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-2">
              <Webhook className="h-4 w-4" />
              Webhooks
            </TabsTrigger>
            <TabsTrigger value="api" className="gap-2">
              <Key className="h-4 w-4" />
              API Keys
            </TabsTrigger>
            <TabsTrigger value="tracking" className="gap-2">
              <Globe className="h-4 w-4" />
              Rastreamento
            </TabsTrigger>
            <TabsTrigger value="import-export" className="gap-2">
              <ArrowDownUp className="h-4 w-4" />
              Import/Export
            </TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="integrations" className="mt-0">
          <IntegrationsTab orgId={orgId} userId={user?.id} />
        </TabsContent>
        <TabsContent value="webhooks" className="mt-0">
          <WebhooksTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="api" className="mt-0">
          <ApiKeysTab orgId={orgId} userId={user?.id} />
        </TabsContent>
        <TabsContent value="tracking" className="mt-0">
          <TrackingTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="import-export" className="mt-0">
          <ImportExportTab orgId={orgId} userId={user?.id} />
        </TabsContent>
      </PageScaffold>
    </Tabs>
  );
}

// ── Integrations Tab ──
function IntegrationsTab({ orgId, userId }: { orgId: string | null; userId?: string }) {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<IntegrationConfig[]>([]);
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<any>({});

  const fetchConfigs = useCallback(async () => {
    if (!orgId) return;
    const { data } = await (supabase as any).from("integration_configs").select("*").eq("org_id", orgId) as any;
    setConfigs(data || []);
  }, [orgId]);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const getConfig = (provider: string) => configs.find((c) => c.provider === provider);

  const saveConfig = async (provider: string) => {
    if (!orgId) return;
    const existing = getConfig(provider);
    if (existing) {
      await (supabase as any).from("integration_configs").update({ config: editConfig, is_active: true } as any).eq("id", existing.id);
    } else {
      await (supabase as any).from("integration_configs").insert({ org_id: orgId, provider, config: editConfig, connected_by: userId } as any);
    }
    toast({ title: `${provider} configurado` });
    setEditProvider(null);
    fetchConfigs();
  };

  const toggleActive = async (id: string, active: boolean) => {
    await (supabase as any).from("integration_configs").update({ is_active: active } as any).eq("id", id);
    fetchConfigs();
  };

  const [slackConnecting, setSlackConnecting] = useState(false);
  const [slackChannels, setSlackChannels] = useState<{ id: string; name: string }[]>([]);
  const [slackWorkspace, setSlackWorkspace] = useState<string | null>(null);
  const [slackSetupGuide, setSlackSetupGuide] = useState(false);

  const handleSlackConnect = async () => {
    if (!orgId) return;
    setSlackConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("slack-connect", {
        body: { org_id: orgId },
      });
      if (error) throw error;
      if (data?.error?.includes("API_KEY")) {
        setSlackSetupGuide(true);
        setSlackConnecting(false);
        return;
      }
      if (data?.workspace_name) {
        setSlackWorkspace(data.workspace_name);
        setSlackChannels(data.channels || []);
        toast({ title: `Conectado ao workspace ${data.workspace_name}` });
        fetchConfigs();
      } else {
        setSlackSetupGuide(true);
      }
    } catch {
      setSlackSetupGuide(true);
    }
    setSlackConnecting(false);
  };

  // Load Slack channels when opening Slack config dialog
  useEffect(() => {
    if (editProvider !== "slack" || !orgId) return;
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("slack-connect", {
          body: { org_id: orgId },
        });
        if (!active) return;
        if (data?.workspace_name) setSlackWorkspace(data.workspace_name);
        if (Array.isArray(data?.channels)) setSlackChannels(data.channels);
      } catch {
        // keep fallback input
      }
    })();
    return () => { active = false; };
  }, [editProvider, orgId]);

  const integrations = [
    {
      provider: "slack", name: "Slack", icon: MessageSquare,
      description: "Notificações de negócios e resumo diário no canal",
      connectAction: handleSlackConnect,
      connectLoading: slackConnecting,
      fields: [
        { key: "channel", label: "Canal de notificações", placeholder: "#vendas" },
        { key: "daily_summary", label: "Resumo diário às 9h", type: "switch" },
        { key: "notify_won", label: "Notificar negócio ganho", type: "switch" },
        { key: "notify_lost", label: "Notificar negócio perdido", type: "switch" },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map((intg) => {
          const cfg = getConfig(intg.provider);
          const Icon = intg.icon;
          return (
            <Panel key={intg.provider}>
              <div className="flex items-center justify-between gap-3 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{intg.name}</h3>
                    <p className="text-xs text-muted-foreground">{intg.description}</p>
                  </div>
                </div>
                {cfg && <Switch checked={cfg.is_active} onCheckedChange={(v) => toggleActive(cfg.id, v)} />}
              </div>
              <div className="flex items-center gap-2 border-t border-border/60 px-5 py-3">
                {cfg ? (
                  <>
                    <StatusChip tone={cfg.is_active ? "success" : "neutral"}>
                      {cfg.is_active ? "Conectado" : "Inativo"}
                    </StatusChip>
                    <Button variant="outline" size="sm" className="ml-auto"
                      onClick={() => { setEditProvider(intg.provider); setEditConfig(cfg.config || {}); }}>
                      Configurar
                    </Button>
                  </>
                ) : (
                  <Button size="sm" className="ml-auto"
                    disabled={intg.connectLoading}
                    onClick={() => intg.connectAction ? intg.connectAction() : (() => { setEditProvider(intg.provider); setEditConfig({}); })()}>
                    {intg.connectLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Conectando...</> : <><Plus className="h-3.5 w-3.5" />Conectar</>}
                  </Button>
                )}
              </div>
            </Panel>
          );
        })}
        {/* Email — Resend */}
        <ResendCard orgId={orgId} />
        {/* WhatsApp — Evolution API */}
        <EvolutionApiCard orgId={orgId} />
      </div>

      {/* Config SidePanel */}
      <SidePanel
        open={!!editProvider}
        onOpenChange={() => setEditProvider(null)}
        kicker="Integrações"
        title={<>Configurar {integrations.find((i) => i.provider === editProvider)?.name}</>}
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditProvider(null)}>Cancelar</Button>
            <Button size="sm" onClick={() => editProvider && saveConfig(editProvider)}>Salvar</Button>
          </>
        }
      >
        <div className="space-y-4">
          {editProvider === "slack" && slackWorkspace && (
            <p className="text-xs text-muted-foreground">
              Workspace conectado: <span className="font-medium text-foreground">{slackWorkspace}</span>
            </p>
          )}
          {integrations.find((i) => i.provider === editProvider)?.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">{field.label}</Label>
              {field.type === "switch" ? (
                <div className="flex items-center gap-2">
                  <Switch checked={!!editConfig[field.key]} onCheckedChange={(v) => setEditConfig({ ...editConfig, [field.key]: v })} />
                  <span className="text-xs text-muted-foreground">{editConfig[field.key] ? "Sim" : "Não"}</span>
                </div>
              ) : editProvider === "slack" && field.key === "channel" && slackChannels.length > 0 ? (
                <Select
                  value={editConfig.channel || ""}
                  onValueChange={(v) => setEditConfig({ ...editConfig, channel: v })}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Selecione um canal" />
                  </SelectTrigger>
                  <SelectContent>
                    {slackChannels.map((c) => (
                      <SelectItem key={c.id} value={`#${c.name}`} className="text-sm">
                        #{c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={editConfig[field.key] || ""} onChange={(e) => setEditConfig({ ...editConfig, [field.key]: e.target.value })}
                  placeholder={field.placeholder} className="h-9 text-sm" />
              )}
            </div>
          ))}
        </div>
      </SidePanel>

      {/* Slack Setup Guide */}
      <SidePanel
        open={slackSetupGuide}
        onOpenChange={setSlackSetupGuide}
        kicker="Integrações"
        title={
          <span className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Configurar integração com o Slack
          </span>
        }
        width="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setSlackSetupGuide(false)}>Fechar</Button>
            <Button size="sm" onClick={() => { setSlackSetupGuide(false); handleSlackConnect(); }}>
              <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Para conectar o Slack ao Empreende.IA CRM, siga os passos abaixo:
          </p>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">1</span>
              <div>
                <p className="text-sm font-medium">Acesse as configurações do projeto no Lovable</p>
                <p className="text-xs text-muted-foreground">Clique no nome do projeto (canto superior esquerdo) → "Settings"</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">2</span>
              <div>
                <p className="text-sm font-medium">Vá em "Connectors"</p>
                <p className="text-xs text-muted-foreground">Na aba de conectores, procure por "Slack" e clique em "Connect"</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">3</span>
              <div>
                <p className="text-sm font-medium">Autorize o acesso ao seu workspace</p>
                <p className="text-xs text-muted-foreground">Selecione o workspace do Slack e autorize as permissões necessárias (enviar mensagens, listar canais)</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">4</span>
              <div>
                <p className="text-sm font-medium">Volte aqui e clique em "Conectar"</p>
                <p className="text-xs text-muted-foreground">Após vincular o conector, o Empreende.IA CRM detectará automaticamente seus canais</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">
              <strong>Permissões necessárias:</strong> <code className="rounded bg-muted px-1 text-xs">chat:write</code> <code className="rounded bg-muted px-1 text-xs">channels:read</code> <code className="rounded bg-muted px-1 text-xs">channels:history</code>
            </p>
          </div>
        </div>
      </SidePanel>
    </div>
  );
}

// ── Email (Resend) card ──
function ResendCard({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchCfg = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("integration_configs")
      .select("*")
      .eq("org_id", orgId)
      .eq("provider", "resend")
      .maybeSingle();
    setCfg(data || null);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { fetchCfg(); }, [fetchCfg]);

  const openEdit = () => {
    setFromEmail(cfg?.config?.from_email || "");
    setFromName(cfg?.config?.from_name || "");
    setApiKey("");
    setOpen(true);
  };

  const toggleActive = async (v: boolean) => {
    if (!cfg) return;
    await (supabase as any).from("integration_configs").update({ is_active: v }).eq("id", cfg.id);
    fetchCfg();
  };

  const save = async () => {
    if (!orgId || !fromEmail.trim()) return;
    setSaving(true);
    try {
      // If user did not provide a new key, fetch stored one
      let keyToUse = apiKey.trim();
      if (!keyToUse) {
        const { data: secret } = await (supabase as any)
          .from("org_secrets")
          .select("key_value")
          .eq("org_id", orgId)
          .eq("key_name", "resend_api_key")
          .maybeSingle();
        keyToUse = secret?.key_value || "";
      }
      if (!keyToUse) {
        toast({ title: "Informe a API Key do Resend", variant: "destructive" });
        setSaving(false);
        return;
      }
      // Resolve test_to (current user email)
      const { data: { user } } = await supabase.auth.getUser();
      const testTo = user?.email || fromEmail.trim();
      const { data, error } = await supabase.functions.invoke("validate-resend-key", {
        body: {
          api_key: keyToUse,
          from_email: fromEmail.trim(),
          from_name: fromName.trim() || undefined,
          test_to: testTo,
          org_id: orgId,
        },
      });
      if (error) throw error;
      if (data?.valid) {
        toast({ title: "Email configurado", description: `Teste enviado para ${testTo}` });
      } else if (data?.error === "domain_not_verified") {
        toast({ title: "Salvo", description: "Domínio não verificado no Resend — verifique em resend.com/domains" });
      } else if (data?.error === "invalid_key") {
        toast({ title: "Chave inválida", variant: "destructive" });
        setSaving(false);
        return;
      } else {
        toast({ title: "Erro ao validar", description: data?.error || "Tente novamente", variant: "destructive" });
        setSaving(false);
        return;
      }
      setOpen(false);
      fetchCfg();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Mail className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Email (Resend)</h3>
            <p className="text-xs text-muted-foreground">Envio de lembretes e emails de automação</p>
          </div>
        </div>
        {cfg && (
          <div className="flex shrink-0 items-center gap-2">
            <StatusChip tone={cfg.is_active ? "success" : "neutral"}>
              {cfg.is_active ? "Ativo" : "Inativo"}
            </StatusChip>
            <Switch checked={cfg.is_active} onCheckedChange={toggleActive} />
          </div>
        )}
      </div>
      <div className="border-t border-border/60 px-5 py-3">
        {loading ? (
          <LoadingState className="py-2" />
        ) : cfg ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs">
              <div><span className="text-muted-foreground">De: </span><span className="font-medium">{cfg.config?.from_name || ""}</span> <span className="text-muted-foreground">&lt;{cfg.config?.from_email}&gt;</span></div>
            </div>
            <Button variant="outline" size="sm" onClick={openEdit}>Editar</Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Resend não configurado.</p>
            <Button size="sm" onClick={openEdit}><Plus className="h-3.5 w-3.5" />Conectar</Button>
          </div>
        )}
      </div>

      <SidePanel
        open={open}
        onOpenChange={setOpen}
        kicker="Integrações"
        title="Configurar Resend"
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button size="sm" onClick={save} disabled={saving || !fromEmail.trim()}>
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Validando…</> : "Salvar e testar"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">API Key Resend</Label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={cfg ? "Deixe vazio para manter a atual" : "re_..."}
                className="h-9 pr-9 text-sm"
              />
              <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Email de envio</Label>
            <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="contato@suaempresa.com" className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Nome de exibição</Label>
            <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Clínica Acme" className="h-9 text-sm" />
          </div>
        </div>
      </SidePanel>
    </Panel>
  );
}

// ── WhatsApp (Evolution API) card ──
function EvolutionApiCard({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [instance, setInstance] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [fromPhone, setFromPhone] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchCfg = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("integration_configs")
      .select("*")
      .eq("org_id", orgId)
      .eq("provider", "evolution_api")
      .maybeSingle();
    setCfg(data || null);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { fetchCfg(); }, [fetchCfg]);

  const openEdit = () => {
    setBaseUrl(cfg?.config?.base_url || "");
    setInstance(cfg?.config?.instance || "");
    setFromPhone(cfg?.config?.from_phone || "");
    setApiKey("");
    setOpen(true);
  };

  const toggleActive = async (v: boolean) => {
    if (!cfg) return;
    await (supabase as any).from("integration_configs").update({ is_active: v }).eq("id", cfg.id);
    fetchCfg();
  };

  const save = async () => {
    if (!orgId || !baseUrl.trim() || !instance.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-evolution-key", {
        body: {
          org_id: orgId,
          base_url: baseUrl.trim(),
          instance: instance.trim(),
          api_key: apiKey.trim() || undefined,
          from_phone: fromPhone.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.valid) {
        toast({ title: "Evolution API conectada", description: `Estado: ${data.state || "ok"}` });
        setOpen(false);
        fetchCfg();
      } else if (data?.error === "invalid_key") {
        toast({ title: "API key inválida", variant: "destructive" });
      } else if (data?.error === "instance_not_found") {
        toast({ title: "Instância não encontrada", description: "Verifique o nome da instância na Evolution.", variant: "destructive" });
      } else if (data?.error === "unreachable") {
        toast({ title: "Servidor inacessível", description: "Confira a Base URL.", variant: "destructive" });
      } else if (data?.error === "missing_api_key") {
        toast({ title: "Informe a API key", variant: "destructive" });
      } else {
        toast({ title: "Falha ao validar", description: data?.error || "Erro desconhecido", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Phone className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">WhatsApp (Evolution API)</h3>
            <p className="text-xs text-muted-foreground">Lembretes e mensagens automáticas via WhatsApp</p>
          </div>
        </div>
        {cfg && (
          <div className="flex shrink-0 items-center gap-2">
            <StatusChip tone={cfg.is_active ? "success" : "neutral"}>
              {cfg.is_active ? "Ativo" : "Inativo"}
            </StatusChip>
            <Switch checked={cfg.is_active} onCheckedChange={toggleActive} />
          </div>
        )}
      </div>
      <div className="border-t border-border/60 px-5 py-3">
        {loading ? (
          <LoadingState className="py-2" />
        ) : cfg ? (
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5 text-xs">
              <div><span className="text-muted-foreground">Servidor: </span><span className="font-mono">{cfg.config?.base_url}</span></div>
              <div><span className="text-muted-foreground">Instância: </span><span className="font-medium">{cfg.config?.instance}</span></div>
              {cfg.config?.last_state && (
                <div><span className="text-muted-foreground">Estado: </span><span className="font-medium">{cfg.config.last_state}</span></div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={openEdit}>Editar</Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">WhatsApp não configurado.</p>
            <Button size="sm" onClick={openEdit}><Plus className="h-3.5 w-3.5" />Conectar</Button>
          </div>
        )}
      </div>

      <SidePanel
        open={open}
        onOpenChange={setOpen}
        kicker="Integrações"
        title="Configurar Evolution API"
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button size="sm" onClick={save} disabled={saving || !baseUrl.trim() || !instance.trim()}>
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Testando…</> : "Testar e salvar"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <details className="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs">
            <summary className="cursor-pointer font-medium">Onde encontro estes dados?</summary>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-muted-foreground">
              <li>Acesse o painel da sua Evolution API auto-hospedada</li>
              <li>Base URL é o endereço público do servidor (ex.: <code>https://evo.suaempresa.com</code>)</li>
              <li>Crie ou copie o nome da Instância conectada ao WhatsApp</li>
              <li>Pegue a API Key (apikey) gerada pelo servidor</li>
            </ol>
          </details>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://evo.suaempresa.com" className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Nome da instância</Label>
            <Input value={instance} onChange={(e) => setInstance(e.target.value)} placeholder="clinica-principal" className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={cfg ? "Deixe vazio para manter a atual" : "Seu apikey"}
                className="h-9 pr-9 text-sm"
              />
              <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Telefone remetente (opcional)</Label>
            <Input value={fromPhone} onChange={(e) => setFromPhone(e.target.value)} placeholder="5511999999999" className="h-9 text-sm" />
          </div>
        </div>
      </SidePanel>
    </Panel>
  );
}
// ── Meta Ads — Lead Ads card ──
function MetaAdsCard({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastLeadAt, setLastLeadAt] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const webhookUrl = orgId
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-ads-webhook?org_id=${orgId}`
    : "";

  const fetchStatus = useCallback(async () => {
    if (!orgId) return;
    setStatusLoading(true);
    const { data } = await ((supabase as any).from("meta_ads_leads" as never) as any)
      .select("created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1);
    setLastLeadAt(data?.[0]?.created_at || null);
    setStatusLoading(false);
  }, [orgId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const copyUrl = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    toast({ title: "URL copiada" });
  };

  const saveToken = async () => {
    if (!orgId || !token.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("save-meta-webhook-token", {
        body: { org_id: orgId, token: token.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Token salvo", description: "Use o mesmo valor no Meta Business Manager." });
      setToken("");
    } catch (e: any) {
      toast({ title: "Erro ao salvar token", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isReceiving = !!lastLeadAt;
  const lastLeadLabel = lastLeadAt
    ? new Date(lastLeadAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Meta Ads — Lead Ads</h3>
            <p className="text-xs text-muted-foreground">Receba leads do Facebook/Instagram em tempo real</p>
          </div>
        </div>
        {statusLoading ? (
          <StatusChip tone="neutral">Verificando…</StatusChip>
        ) : isReceiving ? (
          <StatusChip tone="success">Recebendo leads · {lastLeadLabel}</StatusChip>
        ) : (
          <StatusChip tone="neutral">Aguardando</StatusChip>
        )}
      </div>
      <div className="space-y-3 border-t border-border/60 px-5 py-4">
        {/* URL */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">URL do Webhook</Label>
          <div className="flex gap-2">
            <Input value={webhookUrl} readOnly className="h-9 font-mono text-xs" />
            <Button variant="outline" size="sm" className="h-9" onClick={copyUrl} disabled={!webhookUrl}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Token */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Token de verificação</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Defina um token secreto (string aleatória)"
              className="h-9 text-sm"
            />
            <Button size="sm" className="h-9" disabled={saving || !token.trim() || !orgId} onClick={saveToken}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Salvar token
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            O token é salvo cifrado em <code className="rounded bg-muted px-1">org_secrets</code> via Edge Function. Use o mesmo valor no campo "Token de verificação" do Meta.
          </p>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            Configure esta URL no <strong>Meta Business Manager → Lead Ads → Webhooks</strong>. O Meta vai bater um <code className="rounded bg-muted px-1">GET</code> para verificar o token antes de começar a entregar leads via <code className="rounded bg-muted px-1">POST</code>.
          </p>
        </div>
      </div>
    </Panel>
  );
}

function WebhooksTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", events: [] as string[], secret: "" });

  const fetchWebhooks = useCallback(async () => {
    if (!orgId) return;
    const { data } = await (supabase as any).from("webhooks").select("*").eq("org_id", orgId) as any;
    setWebhooks(data || []);
  }, [orgId]);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const createWebhook = async () => {
    if (!orgId || !form.name || !form.url) return;
    await (supabase as any).from("webhooks").insert({
      org_id: orgId, name: form.name, url: form.url, events: form.events,
      secret: form.secret || null,
    } as any);
    toast({ title: "Webhook criado" });
    setShowCreate(false);
    setForm({ name: "", url: "", events: [], secret: "" });
    fetchWebhooks();
  };

  const deleteWebhook = async (id: string) => {
    await (supabase as any).from("webhooks").delete().eq("id", id);
    toast({ title: "Webhook excluído" });
    fetchWebhooks();
  };

  const toggleWebhook = async (id: string, active: boolean) => {
    await (supabase as any).from("webhooks").update({ is_active: active } as any).eq("id", id);
    fetchWebhooks();
  };

  const inboundUrl = orgId
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbound-webhook?org_id=${orgId}`
    : "";

  return (
    <div className="space-y-4">
      {/* Outbound Webhooks */}
      <Panel>
        <PanelHeader
          title="Webhooks de Saída"
          description="Envie notificações para URLs externas quando eventos ocorrerem"
          actions={
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5" />Novo Webhook
            </Button>
          }
        />
        <PanelBody>
          {webhooks.length === 0 ? (
            <EmptyState
              icon={Webhook}
              title="Nenhum webhook configurado"
              description="Crie um webhook para notificar sistemas externos quando eventos acontecerem no CRM."
            />
          ) : (
            <div className="space-y-2">
              {webhooks.map((wh) => (
                <div key={wh.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{wh.name}</span>
                      <StatusChip tone={wh.is_active ? "success" : "neutral"}>
                        {wh.is_active ? "Ativo" : "Inativo"}
                      </StatusChip>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{wh.url}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {wh.events?.map((e) => (
                        <StatusChip key={e} tone="neutral" dot={false} className="text-xs">{e}</StatusChip>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={wh.is_active} onCheckedChange={(v) => toggleWebhook(wh.id, v)} />
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteWebhook(wh.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* Inbound Webhook */}
      <Panel>
        <PanelHeader
          title="Webhook de Entrada"
          description="Receba dados de ferramentas externas (Zapier, Make, etc.) via POST"
        />
        <PanelBody className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">URL do Webhook</Label>
            <div className="flex gap-2">
              <Input value={inboundUrl} readOnly className="h-9 font-mono text-xs" />
              <Button variant="outline" size="sm" className="h-9"
                onClick={() => { navigator.clipboard.writeText(inboundUrl); toast({ title: "Copiado!" }); }}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Payload esperado (JSON POST):</p>
            <pre className="font-mono text-xs text-muted-foreground">{`{
  "entity": "contact",
  "action": "create",
  "data": {
    "first_name": "João",
    "email": "joao@empresa.com"
  }
}`}</pre>
          </div>
        </PanelBody>
      </Panel>

      {/* Create Webhook SidePanel */}
      <SidePanel
        open={showCreate}
        onOpenChange={setShowCreate}
        kicker="Webhooks"
        title="Novo Webhook"
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button size="sm" onClick={createWebhook}>Criar</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Nome</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Zapier — Deals Ganhos" className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">URL</Label>
            <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://hooks.zapier.com/..." className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Secret (para HMAC)</Label>
            <Input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })}
              placeholder="Opcional" className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Eventos</Label>
            <div className="grid grid-cols-2 gap-2">
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev.value} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={form.events.includes(ev.value)}
                    onCheckedChange={(checked) => {
                      setForm({
                        ...form,
                        events: checked
                          ? [...form.events, ev.value]
                          : form.events.filter((e) => e !== ev.value),
                      });
                    }}
                  />
                  {ev.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </SidePanel>
    </div>
  );
}

// ── API Keys Tab ──
function ApiKeysTab({ orgId, userId }: { orgId: string | null; userId?: string }) {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("Default");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const fetchKeys = useCallback(async () => {
    if (!orgId) return;
    const { data } = await (supabase as any).from("api_keys").select("*").eq("org_id", orgId) as any;
    setKeys(data || []);
  }, [orgId]);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const generateKey = async () => {
    if (!orgId) return;
    // Generate a random API key
    const rawKey = `fc_${crypto.randomUUID().replace(/-/g, "")}`;
    const prefix = rawKey.slice(0, 8);
    // Hash it (simplified — in production use edge function)
    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const { error } = await (supabase as any).from("api_keys").insert({
      org_id: orgId, name: newKeyName, key_hash: hashHex, key_prefix: prefix, created_by: userId,
    } as any);

    if (error) {
      const msg = error.message.includes("policy") || error.code === "42501"
        ? "Sem permissão. Apenas Owners e Admins podem gerar API keys."
        : error.message;
      toast({ title: "Erro ao gerar chave", description: msg, variant: "destructive" });
      return;
    }
    setGeneratedKey(rawKey);
    setShowKey(true);
    fetchKeys();
    toast({ title: "API Key gerada" });
  };

  const revokeKey = async (id: string) => {
    await (supabase as any).from("api_keys").update({ is_active: false } as any).eq("id", id);
    toast({ title: "Chave revogada" });
    fetchKeys();
  };

  const deleteKey = async (id: string) => {
    await (supabase as any).from("api_keys").delete().eq("id", id);
    toast({ title: "Chave excluída" });
    fetchKeys();
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="API Keys"
          description="Gere chaves para acessar a API REST do CRM. Rate limit: 1000 req/hora."
        />
        <PanelBody className="space-y-4">
          <div className="flex gap-2">
            <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Nome da chave" className="h-9 flex-1 text-sm" />
            <Button size="sm" className="h-9" onClick={generateKey}>
              <Key className="h-3.5 w-3.5" />Gerar Chave
            </Button>
          </div>

          {generatedKey && showKey && (
            <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Copie esta chave agora — ela não será exibida novamente
              </p>
              <div className="flex gap-2">
                <Input value={generatedKey} readOnly className="h-9 font-mono text-xs" />
                <Button variant="outline" size="sm" className="h-9"
                  onClick={() => { navigator.clipboard.writeText(generatedKey); toast({ title: "Copiado!" }); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Button variant="ghost" size="sm"
                onClick={() => { setShowKey(false); setGeneratedKey(null); }}>
                Esconder
              </Button>
            </div>
          )}

          {keys.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Nome</TableHead>
                  <TableHead className="text-xs">Prefixo</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Requests</TableHead>
                  <TableHead className="text-xs">Criada</TableHead>
                  <TableHead className="text-xs" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="text-xs">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs">{k.key_prefix}...</TableCell>
                    <TableCell>
                      <StatusChip tone={k.is_active ? "success" : "danger"}>
                        {k.is_active ? "Ativa" : "Revogada"}
                      </StatusChip>
                    </TableCell>
                    <TableCell className="text-xs">{k.request_count}</TableCell>
                    <TableCell className="text-xs">{k.created_at ? new Date(k.created_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {k.is_active && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => revokeKey(k.id)}>
                            <EyeOff className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteKey(k.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>

      {/* API Docs link */}
      <Panel>
        <PanelHeader
          title="Documentação da API"
          description="Endpoints REST disponíveis: contacts, companies, deals, activities"
        />
        <PanelBody>
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/40 p-4">
            <p className="text-xs font-medium">Base URL</p>
            <code className="rounded bg-background px-2 py-1 font-mono text-xs">
              {import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-api
            </code>

            <div className="mt-3 grid gap-2">
              {["GET /contacts", "POST /contacts", "PUT /contacts/:id", "DELETE /contacts/:id",
                "GET /companies", "POST /companies", "GET /deals", "POST /deals",
                "GET /activities", "POST /activities"].map((endpoint) => (
                <div key={endpoint} className="flex items-center gap-2">
                  <StatusChip tone="neutral" dot={false} className="w-16 justify-center font-mono text-xs">
                    {endpoint.split(" ")[0]}
                  </StatusChip>
                  <code className="font-mono text-xs text-muted-foreground">{endpoint.split(" ")[1]}</code>
                </div>
              ))}
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              Headers: <code className="rounded bg-background px-1">Authorization: Bearer fc_xxx</code>
            </p>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

// ── Tracking Tab ──
function TrackingTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const trackingUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tracking`;
  const snippet = `<!-- Empreende.IA CRM Tracking -->
<script>
(function() {
  var ORG_ID = "${orgId || 'SEU_ORG_ID'}";
  var ENDPOINT = "${trackingUrl}";
  var vid = localStorage.getItem("fc_vid") || (function() {
    var id = "v_" + Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
    localStorage.setItem("fc_vid", id);
    return id;
  })();

  function track(eventType, extra) {
    var payload = {
      org_id: ORG_ID,
      visitor_id: vid,
      event_type: eventType || "pageview",
      page_url: location.href,
      page_title: document.title,
      referrer: document.referrer,
      metadata: extra || {}
    };
    navigator.sendBeacon(ENDPOINT, JSON.stringify(payload));
  }

  // Track pageview on load
  track("pageview");

  // Track navigation (SPA support)
  var oldPush = history.pushState;
  history.pushState = function() {
    oldPush.apply(this, arguments);
    setTimeout(function() { track("pageview"); }, 100);
  };

  // Expose for custom events
  window.CRMSaude = {
    track: track,
    identify: function(email) {
      vid = email;
      localStorage.setItem("fc_vid", email);
      track("identify", { email: email });
    }
  };
})();
</script>`;

  const copySnippet = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    toast({ title: "Snippet copiado!" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title={
            <span className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Rastreamento de Website
            </span>
          }
          description="Adicione este snippet ao seu site para rastrear visitantes e aumentar o lead score automaticamente"
        />
        <PanelBody className="space-y-4">
          <div className="relative">
            <pre className="max-h-64 overflow-y-auto overflow-x-auto whitespace-pre rounded-lg border border-border/60 bg-muted/40 p-4 font-mono text-xs">
              {snippet}
            </pre>
            <Button
              variant="outline" size="sm"
              className="absolute right-2 top-2"
              onClick={copySnippet}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copiado!" : "Copiar"}
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <p className="text-xs font-medium">Como funciona:</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• <strong>Pageviews</strong> são registrados automaticamente como atividades</li>
              <li>• <strong>Identificação</strong>: chame <code className="rounded bg-muted px-1">CRMSaude.identify("email@exemplo.com")</code> após formulários</li>
              <li>• <strong>Eventos customizados</strong>: <code className="rounded bg-muted px-1">{'CRMSaude.track("demo_request", {"plan": "pro"})'}</code></li>
              <li>• Suporte a SPA (intercepta <code className="rounded bg-muted px-1">history.pushState</code>)</li>
            </ul>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

// ── Import/Export Tab ──
function ImportExportTab({ orgId, userId }: { orgId: string | null; userId?: string }) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState<string | null>(null);

  const exportEntity = async (entity: string) => {
    if (!orgId) return;
    setExporting(entity);
    try {
      // "consultas" é um subset de activities (appointment_type = 'consulta')
      const isConsultas = entity === "consultas";
      const table = isConsultas ? "activities" : entity;
      let query = (supabase as any).from(table as any).select("*").eq("org_id", orgId);
      if (isConsultas) query = query.eq("appointment_type", "consulta");
      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) { toast({ title: "Sem dados para exportar" }); return; }

      const headers = Object.keys(data[0]);
      const csv = [
        headers.join(","),
        ...data.map((row: any) => headers.map((h) => {
          const val = row[h];
          if (val === null || val === undefined) return "";
          const str = typeof val === "object" ? JSON.stringify(val) : String(val);
          return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(",")),
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entity}_export_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `${data.length} registros exportados` });
    } catch (e: any) {
      toast({ title: "Erro na exportação", description: e.message, variant: "destructive" });
    }
    setExporting(null);
  };

  const entities = [
    { key: "patients", label: "Pacientes", icon: Users },
    { key: "professionals", label: "Profissionais", icon: Stethoscope },
    { key: "consultas", label: "Consultas", icon: Calendar },
    { key: "activities", label: "Atividades", icon: ClipboardList },
  ];

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Exportar Dados"
          description="Exporte qualquer entidade como arquivo CSV"
        />
        <PanelBody>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {entities.map((ent) => {
              const EntIcon = ent.icon;
              return (
                <Button
                  key={ent.key}
                  variant="outline"
                  className="h-auto flex-col gap-1.5 rounded-xl py-3"
                  onClick={() => exportEntity(ent.key)}
                  disabled={exporting === ent.key}
                >
                  {exporting === ent.key ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <EntIcon className="text-primary" />
                  )}
                  <span className="text-xs">{ent.label}</span>
                </Button>
              );
            })}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Importar Dados"
          description={'Importe pacientes e profissionais via CSV. Acesse a lista de pacientes ou profissionais e use o botão "Importar CSV".'}
        />
        <PanelBody>
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-4">
            <p className="text-xs font-medium">Formatos suportados:</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• <strong>CSV genérico</strong> — mapeamento de colunas manual</li>
              <li>• <strong>HubSpot Export</strong> — detecta automaticamente colunas "First Name", "Last Name", "Email"</li>
              <li>• <strong>Pipedrive Export</strong> — detecta "Person - Name", "Organization - Name"</li>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              A importação inclui preview, mapeamento e detecção de duplicatas por email.
            </p>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
