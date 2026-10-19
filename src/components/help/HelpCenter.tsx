import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { SidePanel } from '@/components/foundation/SidePanel';
import { SectionLabel } from '@/components/foundation/Panel';
import { Input } from '@/components/ds/input';
import { Button } from '@/components/ds/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Search, Mail } from 'lucide-react';
import { TourHelpCatalog } from '@/components/tours';
import { CrmSetupChecklist } from '@/components/onboarding/CrmSetupChecklist';
import { useOnboardingGuide } from '@/components/onboarding/CrmOnboardingContext';
import { normalizeHelpText, searchFaq, visibleFaqCategories } from './faq-content';
import { SUPPORT_EMAIL } from '@/lib/support';
import { BASE_CREDIT_TEXT, BRAND } from '@/lib/brand';
import { APP_VERSION } from '@/lib/app-version';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Destaca os nomes da interface que as respostas citam entre aspas curvas (“Criar convite”), mantendo as aspas. */
function AnswerText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(“[^”]+”)/).map((part, index) =>
        index % 2 ? (
          <span key={index} className="font-medium text-foreground">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function HelpCenter({ open, onOpenChange }: Props) {
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const setup = useOnboardingGuide();
  const refresh = setup?.refresh;
  useEffect(() => {
    if (open) void refresh?.();
  }, [open, refresh]);
  // Sem acentos, maiúsculas e hífens: "email", "nao chegou" e "Não chegou" acham as mesmas respostas.
  // A pergunta do crédito "Feito com Empreende.IA" só aparece quando o crédito aparece (item 1.6).
  const categories = useMemo(() => visibleFaqCategories(), []);
  const filtered = useMemo(() => searchFaq(query, categories), [query, categories]);
  // Só pontuação ("?", "...") não é busca: a Central continua como sem pesquisa, com o guia e os tours.
  const searching = Boolean(normalizeHelpText(query));
  const found = filtered.reduce((total, category) => total + category.items.length, 0);
  const empty = searching && found === 0;
  // Uma só região de status, sempre montada: o leitor de tela anuncia a primeira contagem e cada troca de texto.
  const status = !searching
    ? ''
    : empty
      ? `Nenhuma resposta encontrada para “${query.trim()}”. Tente outra palavra, como senha, convite ou planilha.`
      : found === 1
        ? '1 resposta encontrada'
        : `${found} respostas encontradas`;
  function clearSearch() {
    setQuery('');
    // O botão some com o resultado vazio; o foco volta ao campo de busca, e não ao contorno do painel.
    searchInput.current?.focus();
  }

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      kicker="Aprender e configurar"
      title="Ajuda do CRM"
      description="Prepare sua operação, explore as ferramentas e tire dúvidas."
      width="lg"
      contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
      footer={
        <div className="w-full space-y-1 text-xs leading-relaxed text-muted-foreground">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span>{SUPPORT_EMAIL ? 'Precisa de ajuda?' : 'Fale com quem administra o CRM se precisar de ajuda.'}</span>
            {SUPPORT_EMAIL && (
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Mail className="h-3 w-3" aria-hidden="true" />
                Falar com suporte
              </a>
            )}
          </div>
          {/* Versão da base em uso (item 1.7b), sem o nome do programa: vale também no serviço com marca própria. */}
          <p>Versão {APP_VERSION}</p>
          {/* Crédito da base (D3, item 1.6): só com a marca de outra empresa e o crédito ligado. */}
          {BRAND.baseCredit && <p>{BASE_CREDIT_TEXT}</p>}
        </div>
      }
    >
      <div className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
        <label className="relative block">
          <span className="sr-only">Buscar nas perguntas frequentes</span>
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={searchInput}
            type="search"
            placeholder="Buscar: senha, convite, planilha…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 pl-9"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-4 py-5 sm:px-6">
        {!searching && (
          <>
            <CrmSetupChecklist
              onOpenGuide={(stepId) => {
                onOpenChange(false);
                setup?.openGuide(stepId);
              }}
            />
            <TourHelpCatalog onNavigate={() => onOpenChange(false)} />
          </>
        )}
        <section aria-labelledby="crm-faq-title">
          <h2 id="crm-faq-title" className="mb-4 text-base font-semibold">
            Perguntas frequentes
          </h2>
          <div className={empty ? 'rounded-xl border border-dashed border-border p-5 text-center' : undefined}>
            <p
              role="status"
              className={
                !searching
                  ? 'sr-only'
                  : empty
                    ? 'break-words text-sm text-muted-foreground'
                    : 'mb-4 text-xs text-muted-foreground'
              }
            >
              {status}
            </p>
            {empty && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={clearSearch}>
                Limpar busca
              </Button>
            )}
          </div>
          {/* Sempre montado: a resposta aberta continua aberta depois de uma busca sem resultado. */}
          <Accordion type="multiple" className="space-y-5">
            {filtered.map((category) => (
              <div key={category.id}>
                <SectionLabel className="mb-2">{category.title}</SectionLabel>
                {category.items.map((item) => (
                  // A pergunta identifica o item: com a busca, o que estava aberto continua aberto.
                  <AccordionItem
                    key={item.q}
                    value={`${category.id}:${item.q}`}
                    className="mb-2 rounded-xl border border-border px-3"
                  >
                    <AccordionTrigger className="py-3 text-left text-sm hover:no-underline">{item.q}</AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                      <AnswerText text={item.a} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </div>
            ))}
          </Accordion>
        </section>
      </div>
    </SidePanel>
  );
}
