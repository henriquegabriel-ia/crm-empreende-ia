import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppRail } from "@/components/shell/AppRail";
import { ShellContext } from "@/components/shell/ShellContext";
import { MobileBottomNav } from "./MobileBottomNav";
import { RouteTransition } from "@/components/RouteTransition";
import { CommandPalette } from "@/components/CommandPalette";
import { AICopilot } from "@/components/crm/AICopilot";
import { OnboardingChecklist } from "@/components/crm/OnboardingChecklist";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { LoadingState } from "@/components/foundation/LoadingState";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";

export function AppLayout() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const shell = useMemo(() => ({ openSearch: () => setSearchOpen(true) }), []);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/");
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoadingState label="Carregando…" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <AppRail />
        <main className="min-h-0 min-w-0 flex-1 pb-14 md:pb-0">
          <RouteTransition />
        </main>
      </div>
      {isMobile && <MobileBottomNav />}
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <AICopilot />
      <OnboardingChecklist />
      <OnboardingModal />
    </ShellContext.Provider>
  );
}
