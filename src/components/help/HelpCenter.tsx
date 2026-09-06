import { useMemo, useState } from "react";
import { SidePanel } from "@/components/foundation/SidePanel";
import { SectionLabel } from "@/components/foundation/Panel";
import { Input } from "@/components/ds/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Search, Mail } from "lucide-react";
import { FAQ_CATEGORIES } from "./faq-content";
import { SUPPORT_EMAIL } from "@/lib/support";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function HelpCenter({ open, onOpenChange }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ_CATEGORIES;
    return FAQ_CATEGORIES.map((c) => ({
      ...c,
      items: c.items.filter(
        (i) => i.q.toLowerCase().includes(q) || i.a.toLowerCase().includes(q),
      ),
    })).filter((c) => c.items.length > 0);
  }, [query]);

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      kicker="Ajuda"
      title="Central de Ajuda"
      description="Tire suas dúvidas sobre como usar a plataforma."
      width="md"
      contentClassName="flex flex-col overflow-hidden p-0"
      footer={
        <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
          <span>{SUPPORT_EMAIL ? "Precisa de ajuda?" : "Precisa de ajuda? Fale com o administrador da sua equipe."}</span>
          {SUPPORT_EMAIL && <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <Mail className="h-3 w-3" /> Falar com suporte
          </a>}
        </div>
      }
    >
      <div className="shrink-0 border-b border-border px-6 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar na ajuda..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhum resultado para "{query}".
          </p>
        ) : (
          <Accordion type="multiple" className="space-y-3">
            {filtered.map((cat) => (
              <div key={cat.id}>
                <SectionLabel className="mb-1.5">{cat.title}</SectionLabel>
                {cat.items.map((item, idx) => (
                  <AccordionItem
                    key={`${cat.id}-${idx}`}
                    value={`${cat.id}-${idx}`}
                    className="border border-border rounded-md mb-1.5 px-3"
                  >
                    <AccordionTrigger className="text-sm py-2.5 hover:no-underline text-left">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </div>
            ))}
          </Accordion>
        )}
      </div>
    </SidePanel>
  );
}
