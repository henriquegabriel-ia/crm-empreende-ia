import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ds/button';
import { contactName } from '@/lib/contact-model';
import { PRIVACY_ACTION_LABELS } from '@/lib/privacy';
import { PRIVACY_MIGRATION_MISSING, privacyMigrationMissing } from '@/lib/rpc-errors';
import { memberLabel } from '@/lib/team-members';
import { PRIVACY_ACTIONS_PAGE_SIZE, usePrivacyActionsPage, type PrivacyActionPageRow } from './data';

const contactLabel = (row: PrivacyActionPageRow) =>
  row.contact
    ? contactName({
        first_name: row.contact.first_name,
        last_name: row.contact.last_name,
        email: row.contact.email,
        phone: row.contact.phone,
      })
    : 'Contato excluído';

/**
 * "Exportações e anonimizações" em "Segurança" (item 1.10; docs/arquitetura/1.10.md, seção 5.6): os pedidos de acesso e
 * de exclusão atendidos pelo CRM, de privacy_actions, 30 por página, como o histórico de alterações. O registro guarda
 * o id do contato: a tabela mostra o nome atual (o anonimizado aparece como "Contato anonimizado"; o excluído, como
 * "Contato excluído") e quem fez, com a marca "(desativado)" de quem saiu da equipe (item 1.2). Só donos e
 * administradores leem (RLS); os demais veem o aviso.
 */
export function PrivacyActionsTable({ canManage }: { canManage: boolean }) {
  const [page, setPage] = useState(0);
  const query = usePrivacyActionsPage(page, canManage);
  return (
    <section className="space-y-4" aria-labelledby="privacy-actions-title">
      <h2 id="privacy-actions-title" className="text-lg font-semibold">
        Exportações e anonimizações
      </h2>
      <p className="text-sm text-muted-foreground">
        Os pedidos de acesso e de exclusão atendidos pelo CRM. O registro guarda o identificador do contato, e não o
        nome.
      </p>
      {!canManage ? (
        <p className="rounded-xl bg-muted p-4 text-sm">Disponível para donos e administradores.</p>
      ) : query.isPending ? (
        <p role="status">Carregando registros…</p>
      ) : query.isError ? (
        privacyMigrationMissing(query.error) ? (
          <p className="rounded-xl border border-border p-5 text-sm text-muted-foreground">
            {PRIVACY_MIGRATION_MISSING}
          </p>
        ) : (
          <div role="alert" className="space-y-2">
            <p>Não foi possível carregar os registros.</p>
            <Button onClick={() => void query.refetch()}>Tentar novamente</Button>
          </div>
        )
      ) : !query.data.rows.length ? (
        <p className="rounded-xl border border-border p-5 text-muted-foreground">
          Nenhuma exportação ou anonimização registrada.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3">Quando</th>
                  <th className="p-3">Ação</th>
                  <th className="p-3">Contato</th>
                  <th className="p-3">Quem fez</th>
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="whitespace-nowrap p-3">{new Date(row.created_at).toLocaleString('pt-BR')}</td>
                    <td className="p-3">{PRIVACY_ACTION_LABELS[row.action] ?? row.action}</td>
                    <td className="p-3">
                      {row.contact ? (
                        <Link
                          className="text-primary underline-offset-4 hover:underline"
                          to={`/contacts?contact=${encodeURIComponent(row.contact.id)}`}
                        >
                          {contactLabel(row)}
                        </Link>
                      ) : (
                        contactLabel(row)
                      )}
                    </td>
                    <td className="p-3">
                      {row.author ? memberLabel(row.author) : row.performed_by ? 'Pessoa indisponível' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {query.data.total} {query.data.total === 1 ? 'registro' : 'registros'} · página {page + 1}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button
                variant="outline"
                disabled={(page + 1) * PRIVACY_ACTIONS_PAGE_SIZE >= query.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
