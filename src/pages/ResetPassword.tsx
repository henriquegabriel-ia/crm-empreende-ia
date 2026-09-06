import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ds/button";
import { Input } from "@/components/ds/input";
import { Label } from "@/components/ui/label";
import Wordmark from "@/components/brand/Wordmark";
import { AuthBrandPanel } from "@/components/brand/AuthBrandPanel";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { useToast } from "@/hooks/use-toast";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("type=recovery")) {
      navigate("/");
    }
  }, [navigate]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Senha atualizada!" });
      navigate("/");
    }
    setLoading(false);
  };

  return (
    <div className="eia-auth flex min-h-screen">
      <AuthBrandPanel recovery />

      {/* Coluna do formulário */}
      <div className="eia-auth-form relative flex flex-1 items-center justify-center px-6 py-12">
        <ThemeToggle className="absolute right-6 top-6" />
        <div className="eia-auth-form-panel w-full max-w-md">
          <div className="mb-10 lg:hidden"><Wordmark variant="wordmark" /></div>

          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Redefinir senha</h2>
          <p className="mt-1 text-sm text-muted-foreground">Digite sua nova senha para continuar</p>

          <form onSubmit={handleReset} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="new-password">Nova senha</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? "Salvando..." : "Salvar nova senha"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
