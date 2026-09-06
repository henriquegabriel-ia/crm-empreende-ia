import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandGlyph } from "@/components/brand/Wordmark";
import FiberStrands from "@/components/brand/FiberStrands";
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
    <div className="flex min-h-screen">
      {/* Painel de marca (fixo escuro nos dois temas) */}
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-[hsl(214_60%_10%)] p-10 lg:flex xl:p-14">
        <FiberStrands
          count={13}
          className="pointer-events-none absolute -right-28 top-1/2 w-[780px] max-w-none -translate-y-1/2 opacity-30"
        />

        <div className="relative z-10 flex items-center gap-3">
          <BrandGlyph className="h-11 w-11" />
          <span className="flex flex-col">
            <span className="font-display text-2xl font-bold leading-none tracking-tight text-white">
              CRM Saúde
            </span>
            <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/60">
              by base ativa
            </span>
          </span>
        </div>

        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-3xl font-bold leading-tight text-white">
            Defina uma nova senha e volte ao trabalho.
          </h1>
        </div>

        <p className="relative z-10 text-xs text-white/50">
          Feito para clínicas e consultórios brasileiros.
        </p>
      </div>

      {/* Coluna do formulário */}
      <div className="flex flex-1 items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <BrandGlyph className="h-9 w-9" />
            <span className="flex flex-col">
              <span className="font-display text-xl font-bold leading-none tracking-tight text-gradient-brand">
                CRM Saúde
              </span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                by base ativa
              </span>
            </span>
          </div>

          <h2 className="text-xl font-semibold tracking-tight text-foreground">Redefinir senha</h2>
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
