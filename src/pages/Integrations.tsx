import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Calendar, FileSpreadsheet, Mail, MessageCircle } from 'lucide-react';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useAuth } from '@/contexts/AuthContext';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { allCrmRows } from '@/lib/crm-pagination';
import { calendarText, CONTACT_EXPORT_BASIC_COLUMNS, CONTACT_EXPORT_COLUMNS } from '@/lib/crm-import';
import {
  analyzeContactImportInChunks,
  IMPORT_MESSAGES,
  MAX_CONTACT_IMPORT_ROWS,
  readContactSheet,
  type ContactImportAnalysis,
} from '@/lib/contact-import';
import { CONTACT_IMPORT_FIELDS, CONTACT_TEMPLATE_HEADERS } from '@/lib/contact-import-headers';
import { downloadCsv, downloadText, MAX_CSV_BYTES } from '@/lib/csv';
import { exportFileName } from '@/lib/brand';
import { loadContactExportRows } from '@/components/privacy/data';
import { ContactImportDialog } from '@/components/contact-import/ContactImportDialog';
import { loadImportContext } from '@/components/contact-import/data';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';

/** Modelo para baixar (item 1.11): só o cabeçalho, com as 13 colunas em português. */
const TEMPLATE_COLUMNS = CONTACT_TEMPLATE_HEADERS.map((header) => ({ header, value: () => '' }));
/**
 * O seletor mostra também as planilhas que o CRM não lê (.xlsx, .xls, .ods) e o .txt do "Texto Unicode" do Excel: a
 * planilha escolhida é recusada com o passo a passo para salvar em CSV, em vez de ficar escondida pelo filtro (revisão do
 * item 1.11).
 */
const IMPORT_ACCEPT = '.csv,.txt,.xlsx,.xls,.ods,text/csv,text/plain';
const READ_STEPS = { reading: 'Lendo a planilha…', checking: 'Conferindo contatos, empresas e equipe…' } as const;

/**
 * Importar contatos é um recurso nativo, sempre disponível para quem pode editar. Exportar fica com dono e
 * administradores até existir a exportação auditada (roteiro, item 2B.7): a RLS deixa qualquer membro ler
 * os registros, então esconder o botão orienta o uso, mas não é um controle de segurança.
 *
 * Item 1.11 (docs/arquitetura/1.11.md): a importação aceita a planilha como a pessoa já tem (cabeçalhos em português e
 * sinônimos, o CSV do Excel brasileiro), até 5.000 contatos, com a prévia de "Revisar importação" e a gravação em lotes
 * (src/components/contact-import).
 */
export default function Integrations() {
  const { profile } = useAuth();
  const orgId = profile?.org_id;
  const { canManage, canWrite, loading: permissionsLoading } = useCrmPermissions();
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [readStep, setReadStep] = useState<keyof typeof READ_STEPS | ''>(''),
    [session, setSession] = useState<{ key: number; analysis: ContactImportAnalysis } | null>(null);
  // A instrução de como salvar em CSV fica ligada ao campo do arquivo, para quem navega por Tab com leitor de tela
  // (revisão do item 1.11, achado 17).
  const excelHelpId = useId();
  async function loadFile(file: File) {
    if (!orgId) return;
    setBusy('file');
    setError('');
    setReadStep('reading');
    try {
      if (file.size > MAX_CSV_BYTES) {
        setError(IMPORT_MESSAGES.tooLarge);
        return;
      }
      const read = readContactSheet(new Uint8Array(await file.arrayBuffer()), file.name);
      if (read.error) {
        setError(read.error);
        return;
      }
      setReadStep('checking');
      let context;
      try {
        context = await loadImportContext(orgId);
      } catch {
        setError(
          'Não foi possível conferir os contatos já cadastrados. Verifique a conexão e escolha o arquivo de novo.',
        );
        return;
      }
      const analysis = await analyzeContactImportInChunks(read.sheet, context);
      setSession({ key: Date.now(), analysis });
    } catch {
      setError('Não foi possível ler o arquivo. Escolha o arquivo de novo.');
    } finally {
      setBusy('');
      setReadStep('');
    }
  }
  async function exportData(provider: 'csv' | 'calendar') {
    if (!canManage || !orgId) return;
    setBusy('export');
    setError('');
    try {
      if (provider === 'csv') {
        // Item 1.10: com "Não contatar" e a base legal, sem os contatos anonimizados; item 1.11: com os cabeçalhos do
        // modelo e o registro da base legal. Num banco sem a migração, as quatro colunas de antes.
        const { rows, privacy } = await loadContactExportRows(orgId);
        downloadCsv(
          exportFileName('contatos', 'csv'),
          rows,
          privacy ? CONTACT_EXPORT_COLUMNS : CONTACT_EXPORT_BASIC_COLUMNS,
        );
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
                Importação de até {MAX_CONTACT_IMPORT_ROWS.toLocaleString('pt-BR')} contatos com prévia, colunas em
                português, repetidos identificados e divisão entre a equipe. Exportação dos contatos da organização,
                pronta para o Excel e para voltar ao CRM.
              </p>
              {canWrite && (
                <div data-tour="integrations-import" className="space-y-3">
                  <Button variant="ghost" onClick={() => downloadCsv('modelo-contatos.csv', [], TEMPLATE_COLUMNS)}>
                    Baixar modelo CSV
                  </Button>
                  <label className="block space-y-2 text-sm">
                    <span>Importar arquivo CSV (até {MAX_CONTACT_IMPORT_ROWS.toLocaleString('pt-BR')} contatos)</span>
                    <Input
                      type="file"
                      accept={IMPORT_ACCEPT}
                      disabled={!!busy}
                      aria-describedby={excelHelpId}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void loadFile(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <p id={excelHelpId} className="text-xs text-muted-foreground">
                    No Excel, use Arquivo &gt; Salvar como (no Microsoft 365 com o salvamento automático ligado, Arquivo
                    &gt; Salvar uma Cópia) e escolha “CSV UTF-8 (delimitado por vírgulas)”; no Windows, “CSV (separado
                    por vírgulas)” também serve, e no Mac, use só o CSV UTF-8. No Google Planilhas, Arquivo &gt; Fazer
                    download &gt; Valores separados por vírgula (.csv).
                  </p>
                  {readStep && (
                    <p role="status" className="text-sm text-muted-foreground">
                      {READ_STEPS[readStep]}
                    </p>
                  )}
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
          <section data-tour="integrations-help" className="space-y-3 rounded-2xl border border-border p-5">
            <h2 className="font-semibold">Como usar</h2>
            <p className="text-sm text-muted-foreground">
              CSV: use o modelo ou a sua planilha salva em CSV, com ponto e vírgula, vírgula ou TAB, em UTF-8 ou no
              formato do Excel, até {MAX_CONTACT_IMPORT_ROWS.toLocaleString('pt-BR')} linhas e 5 MB. Arquivos .xlsx,
              .xls e .ods não são lidos: salve como CSV antes. A primeira linha é o cabeçalho, e só o nome é
              obrigatório. O CRM reconhece estas colunas, sem diferença de acento ou maiúscula:
            </p>
            <ul className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
              {CONTACT_IMPORT_FIELDS.map((field) => (
                <li key={field.field} className="break-words">
                  <code className="text-foreground">{field.column}</code>: também “{field.examples.join('” ou “')}”
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">Os valores de cada coluna:</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                <code className="text-foreground">responsavel</code>: o nome ou o e-mail de uma pessoa ativa da
                “Equipe”. Sem a coluna, ou com a célula vazia, a prévia oferece você, outra pessoa ou “Distribuir
                igualmente entre” pessoas ativas.
              </li>
              <li>
                <code className="text-foreground">relacionamento</code>: Lead, Em prospecção, Cliente ou Encerrado.
              </li>
              {/* Item 1.14: a origem em lista fixa; o valor fora dela entra como está. */}
              <li>
                <code className="text-foreground">origem</code>: WhatsApp, Telefone, E-mail, Site ou Indicação, que o
                CRM reconhece mesmo sem acento ou em minúsculas. Outra origem, como o nome de uma feira, entra como
                está.
              </li>
              <li>
                <code className="text-foreground">nao_contatar</code>: “sim” marca o contato novo. Um contato já
                cadastrado não muda; a prévia avisa, e a marca é feita na ficha dele.
              </li>
              <li>
                <code className="text-foreground">base_legal</code>: o nome da base. Vazia ou “Não informada” (como a
                exportação escreve para quem não tem base), vale a base padrão da empresa, e a prévia avisa quantos
                contatos a recebem. Consentimento precisa de{' '}
                <code className="text-foreground">registro_base_legal</code>.
              </li>
              <li>
                <code className="text-foreground">empresa</code>: ligada a uma empresa cadastrada com o mesmo nome, ou
                criada só com o nome.
              </li>
            </ul>
            <p className="text-sm text-muted-foreground">
              Linhas com o e-mail ou o telefone de um contato já cadastrado, ou de uma linha anterior, ficam de fora
              como repetidas, e as com erro mostram o motivo. Nada é gravado antes de “Importar”; a gravação acontece em
              partes, com o progresso na tela, e “Baixar contatos não importados” traz as linhas para corrigir e
              importar de novo.
            </p>
            <p className="text-sm text-muted-foreground">
              Telefones do Brasil com DDD são gravados no padrão +55, como +5511999990000. Um telefone não reconhecido
              entra como está, sem descartar o contato. A exportação usa as mesmas colunas do modelo, com nao_contatar,
              base_legal e registro_base_legal, deixa de fora os contatos anonimizados e pode ser importada de novo sem
              perder o “+” do telefone. Os dados de uma pessoa só, para atender um pedido dela, saem pela ficha do
              contato, em “Exportar dados deste contato”.
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
        {session && orgId && profile && (
          <ContactImportDialog
            key={session.key}
            analysis={session.analysis}
            orgId={orgId}
            meId={profile.id}
            onClose={() => setSession(null)}
          />
        )}
      </PageScaffold>
    </div>
  );
}
