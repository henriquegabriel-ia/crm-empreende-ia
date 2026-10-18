import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ds/tabs';
import {
  importMemberName,
  joinReasons,
  PREVIEW_ISSUE_ROWS,
  PREVIEW_READY_ROWS,
  type ContactImportPlan,
  type ImportMember,
  type PlannedContactRow,
} from '@/lib/contact-import';
import { formatPhoneBR } from '@/lib/phone';
import { formatCount } from './text';

interface Props {
  plan: ContactImportPlan;
  members: readonly ImportMember[];
}

/** Quem é a linha: o nome; sem ele, o e-mail ou o telefone; sem nenhum, "(sem nome)". */
const contactLabel = (row: PlannedContactRow) => {
  const { first_name, last_name, email, phone } = row.row.values;
  return (
    [first_name, last_name].filter(Boolean).join(' ') || email || (phone ? formatPhoneBR(phone) : '') || '(sem nome)'
  );
};

/**
 * As listas da prévia (item 1.11; docs/arquitetura/1.11.md, seções 6.2 e 6.6): as primeiras 20 prontas, com o contato,
 * a empresa e o responsável empilhados numa célula (cabe em 320 px), e as primeiras 50 repetidas e com erro, com o
 * número da linha no Excel e quem é a linha ("Linha 4 · Ana", como nas prontas) e, abaixo, os motivos numa frase.
 */
export function ImportIssues({ plan, members }: Props) {
  const companyName = (row: PlannedContactRow) =>
    row.row.values.company ?? (row.companyId ? 'Empresa cadastrada' : null);
  const issueList = (rows: readonly PlannedContactRow[], empty: string) =>
    rows.length ? (
      <>
        <ul className="divide-y rounded-lg border text-sm">
          {rows.slice(0, PREVIEW_ISSUE_ROWS).map((row) => (
            <li key={row.row.index} className="space-y-0.5 p-2">
              <p className="[overflow-wrap:anywhere]">
                <span className="text-xs text-muted-foreground">Linha {formatCount(row.row.line)} · </span>
                <span className="font-medium">{contactLabel(row)}</span>
              </p>
              <p className="break-words text-muted-foreground">{joinReasons(row.reasons)}</p>
            </li>
          ))}
        </ul>
        {rows.length > PREVIEW_ISSUE_ROWS && (
          <p className="mt-2 text-xs text-muted-foreground">
            Mais {formatCount(rows.length - PREVIEW_ISSUE_ROWS)} na planilha de contatos não importados.
          </p>
        )}
      </>
    ) : (
      <p className="text-sm text-muted-foreground">{empty}</p>
    );
  return (
    <Tabs defaultValue="ready" className="space-y-2">
      <TabsList className="flex h-auto w-full flex-wrap justify-start">
        <TabsTrigger value="ready" className="eia-touch-target whitespace-normal">
          Prontas ({formatCount(plan.ready.length)})
        </TabsTrigger>
        <TabsTrigger value="duplicates" className="eia-touch-target whitespace-normal">
          Repetidas ({formatCount(plan.duplicates.length)})
        </TabsTrigger>
        <TabsTrigger value="errors" className="eia-touch-target whitespace-normal">
          Com erro ({formatCount(plan.errors.length)})
        </TabsTrigger>
      </TabsList>
      <TabsContent value="ready">
        {plan.ready.length ? (
          <>
            <ul className="divide-y rounded-lg border text-sm">
              {plan.ready.slice(0, PREVIEW_READY_ROWS).map((row) => {
                const { email, phone, phoneRecognized } = row.row.values;
                const company = companyName(row);
                return (
                  <li key={row.row.index} className="space-y-0.5 p-2">
                    <p className="[overflow-wrap:anywhere]">
                      <span className="text-xs text-muted-foreground">Linha {formatCount(row.row.line)} · </span>
                      <span className="font-medium">{contactLabel(row)}</span>
                    </p>
                    <p className="break-all text-muted-foreground">{email ?? 'Sem e-mail'}</p>
                    <p className="text-muted-foreground">
                      {phone ? (
                        <>
                          <span className="whitespace-nowrap">{formatPhoneBR(phone)}</span>
                          {!phoneRecognized && <span className="ml-1 text-xs">(não reconhecido)</span>}
                        </>
                      ) : (
                        'Sem telefone'
                      )}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      {company ? `Empresa: ${company} · ` : ''}Responsável: {importMemberName(members, row.ownerId)}
                    </p>
                  </li>
                );
              })}
            </ul>
            {plan.ready.length > PREVIEW_READY_ROWS && (
              <p className="mt-2 text-xs text-muted-foreground">Prévia das primeiras {PREVIEW_READY_ROWS}.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma linha está pronta para importar.</p>
        )}
      </TabsContent>
      <TabsContent value="duplicates">{issueList(plan.duplicates, 'Nenhuma linha repetida.')}</TabsContent>
      <TabsContent value="errors">{issueList(plan.errors, 'Nenhuma linha com erro.')}</TabsContent>
    </Tabs>
  );
}
