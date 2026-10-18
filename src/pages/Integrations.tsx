import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Calendar, FileSpreadsheet, Mail, MessageCircle } from 'lucide-react';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useAuth } from '@/contexts/AuthContext';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { allCrmRows } from '@/lib/crm-pagination';
import {
  calendarText,
  CONTACT_CSV_COLUMNS,
  CONTACT_EXPORT_COLUMNS,
  MAX_CONTACT_IMPORT_ROWS,
  parseContactCsv,
  type ContactImportRow,
} from '@/lib/crm-import';
import { decodeCsvBytes, downloadCsv, downloadText, MAX_CSV_BYTES } from '@/lib/csv';
import { exportFileName } from '@/lib/brand';
import { formatPhoneBR, normalizePhoneBR } from '@/lib/phone';
import { invalidateCrmTables } from '@/lib/crm-cache';
import { loadContactExportRows } from '@/components/privacy/data';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ds/dialog';

/**
 * Importar contatos é um recurso nativo, sempre disponível para quem pode editar. Exportar fica com dono e
 * administradores até existir a exportação auditada (roteiro, item 2B.7): a RLS deixa qualquer membro ler
 * os registros, então esconder o botão orienta o uso, mas não é um controle de segurança.
 */
export default function Integrations() {
  const { profile } = useAuth();
  const orgId = profile?.org_id;
  const { canManage, canWrite, loading: permissionsLoading } = useCrmPermissions();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<(ContactImportRow & { id: string })[] | null>(null),
    [parseErrors, setParseErrors] = useState<string[]>([]),
    [duplicates, setDuplicates] = useState(0);
  const unrecognizedPhones = preview?.filter((row) => row.phone && !normalizePhoneBR(row.phone).e164).length ?? 0;
  async function loadFile(file: File) {
    setBusy('file');
    setError('');
    setParseErrors([]);
    setPreview(null);
    try {
      if (file.size > MAX_CSV_BYTES) throw new Error('O arquivo deve ter até 2 MB.');
      const parsed = parseContactCsv(decodeCsvBytes(await file.arrayBuffer()));
      setParseErrors(parsed.errors);
      if (parsed.errors.length) return;
      const contacts = await allCrmRows((from, to) =>
        crmDb.from('contacts').select('email').eq('org_id', orgId!).order('id').range(from, to),
      );
      const known = new Set(contacts.map((c) => c.email?.trim().toLowerCase()).filter(Boolean));
      const rows = parsed.rows.filter((r) => !r.email || !known.has(r.email));
      setDuplicates(parsed.rows.length - rows.length);
      setPreview(rows.map((row) => ({ ...row, id: crypto.randomUUID() })));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Não foi possível ler o arquivo ou consultar duplicidades.',
      );
    } finally {
      setBusy('');
    }
  }
  async function importRows() {
    if (!preview?.length || !canWrite || !orgId) return;
    setBusy('import');
    setError('');
    try {
      const contacts = await allCrmRows((from, to) =>
        crmDb.from('contacts').select('id,email').eq('org_id', orgId).order('id').range(from, to),
      );
      const knownIds = new Set(contacts.map((c) => c.id));
      const knownEmails = new Set(contacts.map((c) => c.email?.trim().toLowerCase()).filter(Boolean));
      const pending = preview.filter(
        (row) => !knownIds.has(row.id) && (!row.email || !knownEmails.has(row.email.trim().toLowerCase())),
      );
      if (pending.length !== preview.length) {
        setDuplicates((count) => count + preview.length - pending.length);
        setPreview(pending);
        await invalidateCrmTables(qc, ['contacts']);
        setError(
          pending.length
            ? 'A prévia foi atualizada: alguns contatos já foram cadastrados. Confira os contatos restantes e confirme novamente.'
            : 'Todos os contatos desta prévia já estão cadastrados. Você pode fechar esta janela.',
        );
        return;
      }
      const { error: failure } = await crmDb.from('contacts').upsert(
        pending.map((row) => ({ ...row, org_id: orgId, owner_id: profile!.id, status: 'lead' })),
        { onConflict: 'id', ignoreDuplicates: true },
      );
      if (failure) throw failure;
      await invalidateCrmTables(qc, ['contacts']);
      toast.success(`${pending.length} contatos importados`);
      setPreview(null);
    } catch (failure) {
      setError(
        failure && typeof failure === 'object' && 'code' in failure && failure.code === '23505'
          ? 'Outro cadastro passou a usar um e-mail desta prévia. Tente novamente para atualizar a lista de contatos restantes.'
          : 'A importação não foi confirmada. A prévia foi preservada; ao tentar novamente, conferiremos quais contatos ainda precisam ser importados.',
      );
    } finally {
      setBusy('');
    }
  }
  async function exportData(provider: 'csv' | 'calendar') {
    if (!canManage || !orgId) return;
    setBusy('export');
    setError('');
    try {
      if (provider === 'csv') {
        // Item 1.10: com "Não contatar" e a base legal, sem os contatos anonimizados; num banco sem a migração, as quatro
        // colunas de antes.
        const { rows, privacy } = await loadContactExportRows(orgId);
        downloadCsv(exportFileName('contatos', 'csv'), rows, privacy ? CONTACT_EXPORT_COLUMNS : CONTACT_CSV_COLUMNS);
      } else {
        const rows = await allCrmRows((from, to) =>
          crmDb
            .from('activities')
            .select('id,title,body,due_date,end_date')
            .eq('org_id', orgId)
            // Reuniões e visitas pendentes (item 1.9): a visita é a reunião presencial.
            .in('type', ['meeting', 'visit'])
            .is('completed_at', null)
            .not('due_date', 'is', null)
            .order('id')
            .range(from, to),
        );
        downloadText(exportFileName('agenda', 'ics'), calendarText(rows), 'text/calendar;charset=utf-8');
      }
      toast.success('Arquivo exportado');
    } catch {
      setError('Não foi possível exportar os registros. Verifique a conexão e tente novamente.');
    } finally {
      setBusy('');
    }
  }
  const exportNotice = (what: string) =>
    !permissionsLoading && !canManage ? (
      <p className="text-xs text-muted-foreground">Exportar {what} fica disponível para donos e administradores.</p>
    ) : null;
  return (
    <div data-product-tour="integrations" className="h-full">
      <PageScaffold title="Integrações">
        <div className="mx-auto max-w-5xl space-y-6">
          <p className="text-sm text-muted-foreground">
            Importe contatos de uma planilha e leve dados e compromissos para outras ferramentas. Cada recurso informa o
            que está disponível e como funciona.
          </p>
          {error && (
            <p role="alert" className="rounded-xl border border-destructive p-4 text-sm">
              {error}
            </p>
          )}
          <div data-tour="integrations-catalog" className="grid gap-4 md:grid-cols-2">
            <section className="space-y-4 rounded-2xl border border-border p-5">
              <FileSpreadsheet className="h-6 w-6 text-primary" />
              <h2 className="text-lg font-semibold">Contatos por CSV</h2>
              <p className="text-sm text-muted-foreground">
                Importação com prévia, validação, identificação de e-mails existentes e telefones no padrão +55.
                Exportação dos contatos da organização, pronta para o Excel.
              </p>
              {canWrite && (
                <div data-tour="integrations-import" className="space-y-3">
                  <Button variant="ghost" onClick={() => downloadCsv('modelo-contatos.csv', [], CONTACT_CSV_COLUMNS)}>
                    Baixar modelo CSV
                  </Button>
                  <label className="block space-y-2 text-sm">
                    <span>Importar arquivo CSV (até {MAX_CONTACT_IMPORT_ROWS} contatos)</span>
                    <Input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={!!busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void loadFile(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              )}
              {!permissionsLoading && !canWrite && (
                <p className="text-xs text-muted-foreground">
                  Seu acesso é somente para consulta. Importar contatos exige permissão de edição.
                </p>
              )}
              {canManage && (
                <Button
                  data-tour="integrations-export"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => void exportData('csv')}
                >
                  Exportar contatos
                </Button>
              )}
              {exportNotice('contatos')}
            </section>
            <section className="space-y-4 rounded-2xl border border-border p-5">
              <Calendar className="h-6 w-6 text-primary" />
              <h2 className="text-lg font-semibold">Agenda por arquivo ICS</h2>
              <p className="text-sm text-muted-foreground">
                Exporte reuniões e visitas pendentes para importar no Google Calendar, Outlook ou Apple Calendar. A
                atualização é manual.
              </p>
              {canManage && (
                <Button variant="outline" disabled={!!busy} onClick={() => void exportData('calendar')}>
                  Exportar reuniões
                </Button>
              )}
              {exportNotice('reuniões')}
            </section>
          </div>
          {parseErrors.length > 0 && (
            <div role="alert" className="rounded-xl border border-destructive p-4">
              <p className="font-medium">Revise o arquivo antes de importar</p>
              <ul className="mt-2 list-inside list-disc text-sm">
                {parseErrors.slice(0, 10).map((msg, index) => (
                  <li key={index}>{msg}</li>
                ))}
              </ul>
              {parseErrors.length > 10 && (
                <p className="mt-2 text-sm">Mais {parseErrors.length - 10} linhas precisam de correção.</p>
              )}
            </div>
          )}
          <section data-tour="integrations-help" className="space-y-3 rounded-2xl border border-border p-5">
            <h2 className="font-semibold">Como usar</h2>
            <p className="text-sm text-muted-foreground">
              CSV: use first_name, last_name, email e phone no cabeçalho, separados por ponto e vírgula ou vírgula. O
              arquivo pode vir em UTF-8 ou no formato salvo pelo Excel. Nomes não serão unidos automaticamente. E-mails
              já existentes são ignorados e informados na prévia.
            </p>
            <p className="text-sm text-muted-foreground">
              Telefones do Brasil com DDD são gravados no padrão +55, como +5511999990000. Um telefone não reconhecido
              entra como está, sem descartar o contato. A exportação usa ponto e vírgula e acentos em UTF-8 e pode ser
              reimportada sem perder o “+” do telefone.
            </p>
            <p className="text-sm text-muted-foreground">
              A exportação de contatos traz também as colunas nao_contatar (“sim” para quem pediu para não ser
              procurado) e base_legal, e deixa de fora os contatos anonimizados. A importação ignora essas duas colunas
              por enquanto. Os dados de uma pessoa só, para atender um pedido dela, saem pela ficha do contato, em
              “Exportar dados deste contato”.
            </p>
            <p className="text-sm text-muted-foreground">
              Calendário: importe o arquivo ICS na sua ferramenta. Ele contém os compromissos do momento da exportação;
              alterações posteriores exigem nova exportação.
            </p>
            <Link className="text-sm text-primary underline" to="/agenda">
              Abrir agenda
            </Link>
          </section>
          <section className="space-y-3 rounded-2xl border border-dashed border-border p-5">
            <h2 className="font-semibold">Canais externos</h2>
            <p className="text-sm text-muted-foreground">
              <Mail className="mr-2 inline h-4 w-4" />
              E-mail, <MessageCircle className="mx-1 inline h-4 w-4" />
              WhatsApp e telefone: os botões das fichas, das oportunidades e das atividades abrem o seu aplicativo com o
              contato e o texto, e quem envia é você. Depois, registre a conversa no CRM. O envio pelo próprio CRM
              precisa de provedores e credenciais e não existe nesta versão.
            </p>
            <Link to="/templates" className="text-sm text-primary underline">
              Preparar modelos para a equipe
            </Link>
          </section>
        </div>
        <Dialog
          open={preview !== null}
          onOpenChange={(open) => {
            if (!open && !busy) setPreview(null);
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Revisar importação</DialogTitle>
              <DialogDescription>
                {preview?.length} novos contatos. {duplicates} linhas já cadastradas foram ignoradas. Os contatos terão
                você como responsável.
                {unrecognizedPhones === 1 && ' 1 telefone não foi reconhecido e será importado como está no arquivo.'}
                {unrecognizedPhones > 1 &&
                  ` ${unrecognizedPhones} telefones não foram reconhecidos e serão importados como estão no arquivo.`}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[40dvh] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="p-2">Nome</th>
                    <th className="p-2">E-mail</th>
                    <th className="p-2">Telefone</th>
                  </tr>
                </thead>
                <tbody>
                  {preview?.slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      <td className="p-2">
                        {row.first_name} {row.last_name}
                      </td>
                      <td className="break-all p-2">{row.email ?? 'Sem e-mail'}</td>
                      <td className="p-2">
                        {row.phone ? (
                          <>
                            <span className="whitespace-nowrap">{formatPhoneBR(row.phone)}</span>
                            {!normalizePhoneBR(row.phone).e164 && (
                              <span className="block text-xs text-muted-foreground">não reconhecido</span>
                            )}
                          </>
                        ) : (
                          'Sem telefone'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(preview?.length ?? 0) > 20 && (
                <p className="p-2 text-xs text-muted-foreground">Prévia dos primeiros 20 contatos.</p>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button disabled={!!busy || !preview?.length} onClick={() => void importRows()}>
              {busy === 'import' ? 'Importando…' : `Confirmar importação de ${preview?.length ?? 0} contatos`}
            </Button>
          </DialogContent>
        </Dialog>
      </PageScaffold>
    </div>
  );
}
