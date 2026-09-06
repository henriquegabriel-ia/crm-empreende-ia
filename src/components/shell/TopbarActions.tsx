import { useNavigate } from "react-router-dom";
import { Search, Plus, Users, Stethoscope, Calendar, ClipboardList } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/crm/NotificationBell";
import { AIInsightsPanel } from "@/components/crm/AIInsightsPanel";
import { useShell } from "./ShellContext";

const quickActions = [
  { label: "Novo Paciente", icon: Users, path: "/patients?action=new" },
  { label: "Novo Profissional", icon: Stethoscope, path: "/professionals?action=new" },
  { label: "Nova Consulta", icon: Calendar, path: "/agenda?action=new" },
  { label: "Nova Atividade", icon: ClipboardList, path: "/activities?action=new" },
];

/**
 * Cluster global de ações do topbar (busca ⌘K, criação rápida, insights de IA,
 * notificações) — renderizado pelo PageScaffold em toda página autenticada.
 */
export function TopbarActions() {
  const navigate = useNavigate();
  const { openSearch } = useShell();

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={openSearch}
        aria-label="Buscar (⌘K)"
        className="flex h-8 items-center gap-2 rounded-full border border-border bg-transparent px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
      >
        <Search className="h-4 w-4" />
        <span className="hidden lg:inline">Buscar</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground lg:flex">
          ⌘K
        </kbd>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Ações rápidas"
            className="hidden h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 md:flex"
          >
            <Plus className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {quickActions.map((action) => (
            <DropdownMenuItem key={action.path} onClick={() => navigate(action.path)}>
              <action.icon className="mr-2 h-4 w-4" />
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="hidden md:block">
        <AIInsightsPanel />
      </div>
      <NotificationBell />
    </div>
  );
}

export default TopbarActions;
