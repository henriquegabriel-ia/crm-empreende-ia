import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ds/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ds/select";
import { Loader2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import { useAuth } from "@/contexts/AuthContext";
import type { OnboardingStepProps } from "./types";

const SEGMENTS = [
  "Clínica geral", "Cardiologia", "Dermatologia", "Pediatria", "Ginecologia",
  "Psicologia", "Psiquiatria", "Odontologia", "Fisioterapia", "Nutrição",
  "Endocrinologia", "Oftalmologia", "Ortopedia", "Estética", "Outro",
];
const TEAM_SIZES = ["Só eu", "2 a 5 profissionais", "6 a 15 profissionais", "16 a 50 profissionais", "Mais de 50 profissionais"];
const CURRENCIES = [
  { value: "BRL", label: "R$ BRL" },
  { value: "USD", label: "$ USD" },
  { value: "EUR", label: "€ EUR" },
];
const TIMEZONES = [
  "America/Sao_Paulo", "America/Manaus", "America/Fortaleza", "America/Recife",
  "America/Cuiaba", "America/Belem", "America/Rio_Branco", "UTC",
  "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Tokyo",
];

export function CompanyStep({ orgId, userId, setCanContinue, onNext, setOrgId, setStepData }: OnboardingStepProps) {
  const { toast } = useToast();
  const { refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [alreadyConfigured, setAlreadyConfigured] = useState(false);
  const debouncedName = useDebounce(name, 500);

  // If org already exists, pre-fill — but only mark configured if segment exists
  useEffect(() => {
    if (!orgId) return;
    supabase.from("organizations").select("name, settings").eq("id", orgId).single().then(({ data }) => {
      if (data) {
        setName(data.name);
        const s = data.settings as any;
        if (s?.segment) {
          setSegment(s.segment);
          setAlreadyConfigured(true);
          setCanContinue(true);
        }
        if (s?.team_size) setTeamSize(s.team_size);
        if (s?.default_currency) setCurrency(s.default_currency);
        setStepData("orgName", data.name);
        setStepData("currency", s?.default_currency || "BRL");
      }
    });
  }, [orgId, setCanContinue, setStepData]);

  // Clearbit logo fetch
  useEffect(() => {
    if (!debouncedName || debouncedName.length < 3) { setLogoUrl(null); return; }
    const slug = debouncedName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const img = new Image();
    img.onload = () => setLogoUrl(`https://logo.clearbit.com/${slug}.com`);
    img.onerror = () => setLogoUrl(null);
    img.src = `https://logo.clearbit.com/${slug}.com`;
  }, [debouncedName]);

  const isValid = name.trim().length >= 2 && segment && teamSize;

  useEffect(() => {
    if (!alreadyConfigured) setCanContinue(false);
  }, [alreadyConfigured, setCanContinue]);

  const handleSubmit = useCallback(async () => {
    if (!isValid || loading) return;
    setLoading(true);
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "org";
      const settings = { segment, team_size: teamSize, default_currency: currency };

      if (orgId) {
        await supabase.from("organizations").update({ name: name.trim(), settings } as any).eq("id", orgId);
      } else {
        const { data: newOrgId, error } = await supabase.rpc("create_organization_for_user" as any, {
          p_user_id: userId,
          p_name: name.trim(),
          p_slug: `${slug}-${Date.now().toString(36)}`,
          p_settings: settings,
        });
        if (error || !newOrgId) throw error || new Error("Falha ao criar empresa");
        setOrgId(newOrgId as string);
      }
      await supabase.from("profiles").update({ timezone } as any).eq("id", userId);
      await refreshProfile();
      setStepData("orgName", name.trim());
      setStepData("currency", currency);
      setCanContinue(true);
    } catch (err: any) {
      toast({ title: "Erro ao salvar empresa", description: err?.message, variant: "destructive" });
    }
    setLoading(false);
  }, [name, segment, teamSize, currency, timezone, orgId, userId, isValid, loading, onNext, setOrgId, setStepData, setCanContinue, toast, refreshProfile]);

  // Override the footer "Continue" button - submit form first
  useEffect(() => {
    if (alreadyConfigured) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && isValid && !loading) handleSubmit();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSubmit, isValid, loading, alreadyConfigured]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Sua clínica</h3>
        <p className="text-sm text-muted-foreground mt-1">Essas informações personalizam o app para a sua rotina clínica.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2 space-y-2">
          <Label htmlFor="org-name">Nome da clínica *</Label>
          <div className="relative">
            {logoUrl && (
              <img src={logoUrl} alt="" className="absolute left-3 top-2.5 h-5 w-5 rounded object-contain" />
            )}
            <Input
              id="org-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setAlreadyConfigured(false); setCanContinue(false); }}
              placeholder="Clínica Saúde+"
              className={logoUrl ? "pl-10" : ""}
              aria-invalid={name.length > 0 && name.trim().length < 2}
            />
            {logoUrl && (
              <span className="absolute right-3 top-3 flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="h-3 w-3 text-success" /> Logo detectada
              </span>
            )}
          </div>
          {name.length > 0 && name.trim().length < 2 && (
            <p className="text-xs text-destructive flex items-center gap-1"><X className="h-3 w-3" /> Mínimo 2 caracteres</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Especialidade *</Label>
          <Select value={segment} onValueChange={(v) => { setSegment(v); setAlreadyConfigured(false); setCanContinue(false); }}>
            <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent className="z-[200]">
              {SEGMENTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Número de profissionais *</Label>
          <Select value={teamSize} onValueChange={(v) => { setTeamSize(v); setAlreadyConfigured(false); setCanContinue(false); }}>
            <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent className="z-[200]">
              {TEAM_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Moeda padrão *</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="z-[200]">
              {CURRENCIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Fuso horário *</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="z-[200]">
              {TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <button
        onClick={alreadyConfigured ? undefined : handleSubmit}
        disabled={alreadyConfigured || !isValid || loading}
        className={`w-full rounded-full px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
          alreadyConfigured
            ? "bg-muted text-muted-foreground cursor-default"
            : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        }`}
      >
        {loading ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
        ) : alreadyConfigured ? (
          <><Check className="h-4 w-4" /> Salvo com sucesso</>
        ) : (
          <><Check className="h-4 w-4" /> Salvar e continuar</>
        )}
      </button>
    </div>
  );
}
