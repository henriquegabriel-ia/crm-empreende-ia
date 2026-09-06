import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Stethoscope, Calendar, ClipboardList, DollarSign,
  Activity, BarChart3, Settings, FileText, Zap, Target, Search as SearchIcon,
} from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { StatusChip } from "@/components/foundation/StatusChip";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useDebounce } from "@/hooks/useDebounce";

const pages = [
  { label: "Dashboard",     icon: LayoutDashboard, path: "/dashboard" },
  { label: "Pacientes",     icon: Users,           path: "/patients" },
  { label: "Médicos",       icon: Stethoscope,     path: "/professionals" },
  { label: "Agenda",        icon: Calendar,        path: "/agenda" },
  { label: "Prontuários",   icon: ClipboardList,   path: "/records" },
  { label: "Financeiro",    icon: DollarSign,      path: "/financeiro" },
  { label: "Atividades",    icon: Activity,        path: "/activities" },
  { label: "Automações",    icon: Zap,             path: "/automations" },
  { label: "Templates",     icon: FileText,        path: "/templates" },
  { label: "Relatórios",    icon: BarChart3,       path: "/reports" },
  { label: "Metas",         icon: Target,          path: "/health-goals" },
  { label: "Configurações", icon: Settings,        path: "/settings" },
];

const shortcuts = [
  { label: "Novo Paciente", keys: "N", desc: "Criar paciente" },
  { label: "Nova Consulta", keys: "D", desc: "Criar consulta" },
  { label: "Nova Tarefa", keys: "T", desc: "Criar tarefa" },
  { label: "Buscar", keys: "⌘K", desc: "Abrir busca" },
  { label: "Focar busca", keys: "/", desc: "Focar campo de busca" },
  { label: "Fechar", keys: "Esc", desc: "Fechar modal" },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { orgId } = useOrg();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [patients, setPatients] = useState<any[]>([]);
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("fc-recent-searches") || "[]"); }
    catch { return []; }
  });

  const searchEntities = useCallback(async (q: string) => {
    if (!orgId || !q || q.length < 2) {
      setPatients([]); setProfessionals([]);
      return;
    }
    const [pRes, prRes] = await Promise.all([
      (supabase as any).from("patients").select("id, first_name, last_name, email, status").eq("org_id", orgId).or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`).limit(5),
      (supabase as any).from("professionals").select("id, first_name, last_name, specialty").eq("org_id", orgId).or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`).limit(5),
    ]);
    setPatients(pRes.data || []);
    setProfessionals(prRes.data || []);
  }, [orgId]);

  useEffect(() => { searchEntities(debouncedSearch); }, [debouncedSearch, searchEntities]);

  const handleSelect = (path: string) => {
    if (search && !recentSearches.includes(search)) {
      const updated = [search, ...recentSearches].slice(0, 5);
      setRecentSearches(updated);
      localStorage.setItem("fc-recent-searches", JSON.stringify(updated));
    }
    navigate(path);
    onOpenChange(false);
    setSearch("");
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar páginas, contatos, negócios..." value={search} onValueChange={setSearch} />
      <CommandList>
        <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

        {/* Real-time entity results */}
        {patients.length > 0 && (
          <CommandGroup heading="Pacientes">
            {patients.map((p) => (
              <CommandItem key={p.id} onSelect={() => handleSelect(`/patients`)} className="gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>{p.first_name} {p.last_name}</span>
                {p.email && <span className="text-xs text-muted-foreground ml-auto">{p.email}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {professionals.length > 0 && (
          <CommandGroup heading="Médicos">
            {professionals.map((pr) => (
              <CommandItem key={pr.id} onSelect={() => handleSelect(`/professionals`)} className="gap-2">
                <Stethoscope className="h-4 w-4 text-muted-foreground" />
                <span>{pr.first_name} {pr.last_name}</span>
                {pr.specialty && <StatusChip tone="neutral" dot={false} className="ml-auto text-xs">{pr.specialty}</StatusChip>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Recent searches */}
        {!search && recentSearches.length > 0 && (
          <CommandGroup heading="Buscas Recentes">
            {recentSearches.map((s, i) => (
              <CommandItem key={i} onSelect={() => setSearch(s)} className="gap-2">
                <SearchIcon className="h-4 w-4 text-muted-foreground" />
                {s}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Páginas">
          {pages.map((page) => (
            <CommandItem key={page.path} onSelect={() => handleSelect(page.path)} className="gap-2">
              <page.icon className="h-4 w-4 text-muted-foreground" />
              {page.label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Atalhos de Teclado">
          {shortcuts.map((s) => (
            <CommandItem key={s.label} className="gap-2 justify-between" disabled>
              <span className="text-xs text-muted-foreground">{s.desc}</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
