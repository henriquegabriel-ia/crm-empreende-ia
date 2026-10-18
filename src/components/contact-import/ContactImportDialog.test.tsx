import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportFileName } from '@/lib/brand';
import {
  analyzeContactImport,
  readContactSheet,
  type CompanyPayload,
  type ContactImportContext,
  type ContactPayload,
} from '@/lib/contact-import';

const mocks = vi.hoisted(() => ({
  writeCompanies: vi.fn(),
  writeContacts: vi.fn(),
  loadExisting: vi.fn(),
  loadContext: vi.fn(),
  download: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('./data', () => ({
  writeCompanyBatch: mocks.writeCompanies,
  writeContactBatch: mocks.writeContacts,
  loadExistingContacts: mocks.loadExisting,
  loadImportContext: mocks.loadContext,
}));
vi.mock('@/lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csv')>()),
  downloadText: mocks.download,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { ContactImportDialog } from './ContactImportDialog';

const MEMBERS = [
  { id: 'me', name: 'Pessoa de Teste', email: 'owner@example.test', active: true },
  { id: 'bruna', name: 'Bruna Recebedora', email: 'bruna@example.test', active: true },
  { id: 'carla', name: 'Carla Administradora', email: 'carla@example.test', active: true },
  { id: 'fulano', name: 'Fulano Vendedor', email: 'fulano@example.test', active: false },
];
const CONTEXT: ContactImportContext = {
  orgId: 'org-1',
  existingContacts: [{ id: 'c1', email: 'ana@example.test', phone: null }],
  companies: [{ id: 'acme', name: 'Acme Ltda.', created_at: '2026-01-01T00:00:00Z' }],
  members: MEMBERS,
  columns: { doNotContact: true, legalBasis: true },
};
const FILE = [
  'Nome completo;E-mail;Celular;Empresa;Responsável;Não contatar;Cidade',
  'Ana;ana@example.test;;;;;Recife',
  'Bia;bia@example.test;(11) 99999-0001;ACME LTDA;;sim;Olinda',
  ';sem-nome@example.test;;;;;Natal',
  'Caio;caio@example.test;ramal 22;Nova Empresa;Carla Administradora;;Salvador',
  'Davi;davi@example.test;;;Fulano Vendedor;;Fortaleza',
  'Eva;eva@example.test;;;;;Recife',
].join('\r\n');

function analysisOf(text: string, context: ContactImportContext = CONTEXT) {
  const sheet = readContactSheet(new TextEncoder().encode(text), 'contatos.csv').sheet!;
  let id = 0;
  return analyzeContactImport(sheet, context, { newId: () => `id-${++id}` });
}

let cache: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;
function mount(text = FILE, context = CONTEXT) {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidate = vi.spyOn(cache, 'invalidateQueries');
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <ContactImportDialog analysis={analysisOf(text, context)} orgId="org-1" meId="me" onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onClose, dialog: () => screen.getByRole('dialog') };
}
const written = () => mocks.writeContacts.mock.calls.flatMap(([batch]) => batch as ContactPayload[]);
/** Cada item de uma lista da prévia, com os parágrafos separados por " | ". */
const listItems = (container: HTMLElement) =>
  within(container)
    .getAllByRole('listitem')
    .map((item) => [...item.querySelectorAll('p')].map((line) => line.textContent).join(' | '));

beforeEach(() => {
  mocks.writeCompanies.mockImplementation(async (batch: CompanyPayload[]) => batch.map((row) => row.id));
  mocks.writeContacts.mockImplementation(async (batch: ContactPayload[]) => batch.map((row) => row.id));
  mocks.loadExisting.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('prévia', () => {
  it('mostra as contagens, as colunas, os avisos, as opções e as listas, sem gravar nada', () => {
    const { dialog } = mount();
    expect(screen.getByRole('heading', { name: 'Revisar importação' })).toBeTruthy();
    expect(dialog().textContent).toContain(
      '“contatos.csv”: 6 linhas. 3 prontas para importar, 1 repetida e 2 com erro.',
    );
    expect(screen.getByText(/Nome completo → Nome, E-mail → E-mail, Celular → Telefone/)).toBeTruthy();
    expect(screen.getByText('Colunas ignoradas: Cidade.')).toBeTruthy();
    const warnings = screen.getByRole('status');
    expect(within(warnings).getByText(/1 telefone não foi reconhecido/)).toBeTruthy();
    expect(within(warnings).getByText('1 empresa nova: Nova Empresa.')).toBeTruthy();
    expect(within(warnings).getByText('1 contato chega marcado “Não contatar”.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Você' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Prontas (3)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Repetidas (1)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Com erro (2)' })).toBeTruthy();
    expect(within(dialog()).getByText(/Empresa: Nova Empresa · Responsável: Carla Administradora/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importar 3 contatos' })).toBeTruthy();
    expect(mocks.writeContacts).not.toHaveBeenCalled();
    expect(mocks.writeCompanies).not.toHaveBeenCalled();
  });

  it('lista as linhas com erro e repetidas com o número da linha, quem é a linha e os motivos', () => {
    mount();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Com erro (2)' }), { button: 0 });
    fireEvent.click(screen.getByRole('tab', { name: 'Com erro (2)' }));
    // Revisão do item 1.11: "Linha 4 · quem", como nas prontas, e os motivos abaixo, sem "Sem nome" duas vezes.
    expect(listItems(screen.getByRole('tabpanel'))).toEqual([
      'Linha 4 · sem-nome@example.test | Falta o nome: preencha a coluna do nome.',
      'Linha 6 · Davi | A pessoa “Fulano Vendedor” está desativada na equipe e não recebe contatos. Escolha uma pessoa ativa.',
    ]);
  });

  it('sem e-mail nem telefone, a linha aparece como "(sem nome)", e os motivos ficam juntos com espaço', () => {
    mount('nome;email;telefone;cidade\n;;;Recife\n;bia@;;Olinda\n;;(11) 3333-4444;Natal\nAna;ana.nova@example.test;;');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Com erro (3)' }), { button: 0 });
    fireEvent.click(screen.getByRole('tab', { name: 'Com erro (3)' }));
    expect(listItems(screen.getByRole('tabpanel'))).toEqual([
      'Linha 2 · (sem nome) | Falta o nome: preencha a coluna do nome.',
      'Linha 3 · bia@ | Falta o nome: preencha a coluna do nome. E-mail inválido. Use um e-mail por contato, como ana@empresa.com.br.',
      'Linha 4 · (11) 3333-4444 | Falta o nome: preencha a coluna do nome.',
    ]);
  });

  // Revisão do item 1.11: a regra do botão sem linha pronta e os limites das listas tinham ficado sem teste.
  it('sem linha pronta, "Importar" fica desabilitado com o motivo ligado ao botão', () => {
    mount('nome;email\nAna;ana@example.test\n;sem-nome@example.test');
    const button = screen.getByRole('button', { name: 'Importar 0 contatos' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Nenhuma linha está pronta para importar.',
    );
    expect(screen.getByText('Nenhuma linha está pronta para importar.', { selector: 'p.text-sm' })).toBeTruthy();
  });

  it('as listas mostram as primeiras 20 prontas e as primeiras 50 repetidas e com erro, com o resto contado', () => {
    const rows = [
      'nome;email',
      ...Array.from({ length: 25 }, (_, i) => `P${i};p${i}@example.test`),
      ...Array.from({ length: 53 }, (_, i) => `R${i};p0@example.test`),
      ...Array.from({ length: 51 }, (_, i) => `;erro${i}@example.test`),
    ].join('\n');
    mount(rows, { ...CONTEXT, existingContacts: [] });
    expect(listItems(screen.getByRole('tabpanel'))).toHaveLength(20);
    expect(screen.getByText('Prévia das primeiras 20.')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Repetidas (53)' }), { button: 0 });
    expect(listItems(screen.getByRole('tabpanel'))).toHaveLength(50);
    expect(screen.getByText('Mais 3 na planilha de contatos não importados.')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Com erro (51)' }), { button: 0 });
    expect(listItems(screen.getByRole('tabpanel'))).toHaveLength(50);
    expect(screen.getByText('Mais 1 na planilha de contatos não importados.')).toBeTruthy();
  });

  it('avisa a repetida que pede "Não contatar" quando o contato cadastrado não tem a marca', () => {
    mount('nome;email;nao_contatar\nAna;ana@example.test;sim\nBia;bia@example.test;', {
      ...CONTEXT,
      existingContacts: [{ id: 'c1', email: 'ana@example.test', phone: null, do_not_contact: false }],
    });
    expect(within(screen.getByRole('status')).getByText(/1 linha repetida pede “Não contatar”/)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Repetidas (1)' }), { button: 0 });
    expect(listItems(screen.getByRole('tabpanel'))).toEqual([
      'Linha 2 · Ana | Já existe um contato com este e-mail. A linha pede “Não contatar”, e o contato que fica no CRM não tem a marca: marque na ficha dele.',
    ]);
  });

  it('um nome de arquivo longo sem espaços pode quebrar em qualquer ponto', () => {
    const { dialog } = mount();
    const name = within(dialog()).getByText('“contatos.csv”');
    expect(name.className).toContain('[overflow-wrap:anywhere]');
  });

  it('a divisão sem ninguém marcado desabilita "Importar", com o motivo ligado ao botão, e mostra a contagem por pessoa', () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Distribuir igualmente entre' }));
    const button = screen.getByRole('button', { name: 'Importar 3 contatos' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const reason = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(reason?.textContent).toBe('Marque ao menos uma pessoa para distribuir.');
    // Só pessoas ativas: o Fulano, desativado, não aparece.
    expect(screen.queryByRole('checkbox', { name: 'Fulano Vendedor' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Carla Administradora' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bruna Recebedora' }));
    expect(screen.getByText('Bruna Recebedora: 1 · Carla Administradora: 1')).toBeTruthy();
    expect(button.disabled).toBe(false);
  });

  it('baixa os contatos não importados da prévia, só as repetidas e as com erro', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Baixar contatos não importados' }));
    const [name, text] = mocks.download.mock.calls[0] as [string, string];
    expect(name).toBe(exportFileName('contatos-nao-importados', 'csv'));
    const lines = text.split('\r\n');
    expect(lines[0]).toContain('"linha_planilha";"resultado_importacao";"motivo_importacao";"Nome completo"');
    expect(lines.slice(1).map((line) => line.split(';').slice(0, 2).join(';'))).toEqual([
      '"2";"Repetida"',
      '"4";"Com erro"',
      '"6";"Com erro"',
    ]);
  });
});

describe('gravação', () => {
  it('grava as empresas e depois os contatos, com a origem padrão, o progresso e o resultado, e invalida uma vez', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Origem dos contatos sem origem na planilha (opcional)'), {
      target: { value: 'Feira' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    expect(mocks.writeCompanies).toHaveBeenCalledTimes(1);
    expect(mocks.writeCompanies.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.writeContacts.mock.invocationCallOrder[0],
    );
    expect(mocks.writeCompanies.mock.calls[0][0]).toEqual([
      { id: expect.any(String), org_id: 'org-1', name: 'Nova Empresa', owner_id: 'carla' },
    ]);
    expect(
      written().map(({ first_name, owner_id, source, company_id }) => ({ first_name, owner_id, source, company_id })),
    ).toEqual([
      { first_name: 'Bia', owner_id: 'me', source: 'Feira', company_id: 'acme' },
      {
        first_name: 'Caio',
        owner_id: 'carla',
        source: 'Feira',
        company_id: mocks.writeCompanies.mock.calls[0][0][0].id,
      },
      { first_name: 'Eva', owner_id: 'me', source: 'Feira', company_id: null },
    ]);
    expect(
      screen.getByText('3 contatos importados. 1 empresa criada. 1 repetida e 2 com erro ficaram de fora.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir Contatos' }).getAttribute('href')).toBe('/contacts?sort=updated');
    expect(mocks.toast.success).toHaveBeenCalledWith('3 contatos importados');
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('mostra a barra de progresso, não fecha durante a gravação e "Parar" termina o lote em andamento', async () => {
    const rows = ['nome;email', ...Array.from({ length: 1200 }, (_, i) => `P${i};p${i}@example.test`)].join('\n');
    const releases: (() => void)[] = [];
    mocks.writeContacts.mockImplementation(
      (batch: ContactPayload[]) => new Promise((resolve) => releases.push(() => resolve(batch.map((row) => row.id)))),
    );
    const { onClose } = mount(rows, { ...CONTEXT, existingContacts: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Importar 1.200 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importando contatos' })).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Importação de contatos' });
    expect(bar.getAttribute('aria-valuemax')).toBe('1200');
    expect(screen.getByText('0 de 1.200 contatos gravados')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    // Revisão do item 1.11: o aviso do navegador ao sair da página, durante a gravação.
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    await act(async () => releases.shift()!());
    expect(await screen.findByText('500 de 1.200 contatos gravados')).toBeTruthy();
    expect(bar.getAttribute('aria-valuenow')).toBe('500');
    fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    expect(screen.getByRole('button', { name: 'Parando…' })).toBeTruthy();
    await act(async () => releases.shift()!());
    expect(await screen.findByRole('heading', { name: 'Importação parada' })).toBeTruthy();
    expect(screen.getByText('1.000 de 1.200 contatos gravados.')).toBeTruthy();
    expect(mocks.writeContacts).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
    // Fora da gravação, o navegador não avisa mais.
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar importação' }));
    await waitFor(() => expect(mocks.writeContacts).toHaveBeenCalledTimes(3));
    await act(async () => releases.shift()!());
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    expect(new Set(written().map((row) => row.id)).size).toBe(1200);
    expect(written()).toHaveLength(1200);
  });

  it('depois de uma falha, mostra a mensagem, e "Continuar importação" grava só o que falta', async () => {
    mocks.writeContacts.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação parada' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('A gravação de um lote não foi confirmada.');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar importação' }));
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    // A empresa não é criada de novo; o lote de contatos vai com os mesmos ids.
    expect(mocks.writeCompanies).toHaveBeenCalledTimes(1);
    expect(mocks.writeContacts.mock.calls[0][0]).toEqual(mocks.writeContacts.mock.calls[1][0]);
  });

  // Revisão do item 1.11: o "Voltar" do navegador e o do celular trocavam a rota sem aviso durante a gravação.
  it('durante a gravação, o "Voltar" do navegador mantém a tela, com um aviso; depois, não mais', async () => {
    const releases: (() => void)[] = [];
    mocks.writeContacts.mockImplementation(
      (batch: ContactPayload[]) => new Promise((resolve) => releases.push(() => resolve(batch.map((row) => row.id)))),
    );
    const before = window.history.length;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importando contatos' })).toBeTruthy();
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state).toMatchObject({ contactImportGuard: true });
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    expect(mocks.toast.info).toHaveBeenCalledWith('A importação continua', {
      description: 'Espere terminar ou use “Parar”.',
    });
    expect(window.history.state).toMatchObject({ contactImportGuard: true });
    expect(screen.getByRole('heading', { name: 'Importando contatos' })).toBeTruthy();
    // Uma volta que ainda cai numa entrada de guarda (a do próprio diálogo, atrasada) passa sem aviso.
    mocks.toast.info.mockClear();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { contactImportGuard: true } }));
    });
    expect(mocks.toast.info).not.toHaveBeenCalled();
    await act(async () => releases.shift()!());
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    mocks.toast.info.mockClear();
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(mocks.toast.info).not.toHaveBeenCalled();
  });

  it('fechar uma importação parada com contatos por gravar pede confirmação', async () => {
    mocks.writeContacts.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação parada' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/^3 contatos que faltam não serão gravados\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar sem gravar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('com tudo gravado, "Fechar" fecha sem perguntar', async () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a planilha de não importados do resultado inclui as não gravadas', async () => {
    mocks.writeContacts.mockRejectedValueOnce({ code: '42501', message: 'new row violates row-level security policy' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByText(/Seu papel não permite mais importar contatos/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Baixar contatos não importados' }));
    const text = mocks.download.mock.calls[0][1] as string;
    expect(text.match(/"Não gravada"/g)).toHaveLength(3);
  });

  it('um e-mail cadastrado no meio vira repetida e a importação segue', async () => {
    mocks.writeContacts.mockRejectedValueOnce({ code: '23505', message: 'contacts_org_email_unique' });
    mocks.loadExisting.mockResolvedValue([{ id: 'colega', email: 'eva@example.test', phone: null }]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    expect(mocks.writeContacts.mock.calls[1][0].map((row: ContactPayload) => row.first_name)).toEqual(['Bia', 'Caio']);
    expect(
      screen.getByText('2 contatos importados. 1 empresa criada. 2 repetidas e 2 com erro ficaram de fora.'),
    ).toBeTruthy();
  });

  it('uma recusa do banco volta à prévia do que falta, com a mensagem, e continua de onde parou', async () => {
    const message = 'A pessoa escolhida como responsável foi desativada. Escolha outra pessoa em “Responsável”.';
    const rows = [
      'nome;email;responsavel',
      ...Array.from({ length: 700 }, (_, i) => `P${i};p${i}@example.test;${i < 600 ? '' : 'Bruna Recebedora'}`),
    ].join('\n');
    mocks.writeContacts
      .mockImplementationOnce(async (batch: ContactPayload[]) => batch.map((row) => row.id))
      .mockRejectedValueOnce({ code: 'P0001', message });
    mocks.loadContext.mockResolvedValue({
      ...CONTEXT,
      existingContacts: [],
      members: MEMBERS.map((member) => (member.id === 'bruna' ? { ...member, active: false } : member)),
    });
    mount(rows, { ...CONTEXT, existingContacts: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Importar 700 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Revisar importação' })).toBeTruthy();
    const alert = await screen.findByText(/^A importação parou:/);
    expect(alert.textContent).toBe(
      `A importação parou: ${message} 500 contatos já foram gravados. Confira a prévia dos que faltam e use “Continuar importação”.`,
    );
    // As linhas da Bruna, desativada, viram erro; as que dependem da escolha seguem com você.
    expect(screen.getByRole('tab', { name: 'Com erro (100)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar importação de 100 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    const ids = written().map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length - 100);
    expect(screen.getByText(/^600 contatos importados\./)).toBeTruthy();
  });

  // Revisão do item 1.11: o gatilho roda antes do ON CONFLICT, e a nova tentativa de um lote que entrou sem a resposta
  // chegar pode ser recusada (o responsável desativado no intervalo). Os ids já gravados contam como gravados.
  it('resposta perdida e P0001 na nova tentativa: os ids que estão no banco contam como gravados', async () => {
    const message = 'A pessoa escolhida como responsável foi desativada. Escolha outra pessoa em “Responsável”.';
    const rows = [
      'nome;email;responsavel',
      ...Array.from({ length: 1000 }, (_, i) => `P${i};p${i}@example.test;Bruna Recebedora`),
    ].join('\n');
    mocks.writeContacts
      .mockImplementationOnce(async (batch: ContactPayload[]) => batch.map((row) => row.id))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce({ code: 'P0001', message });
    mocks.loadContext.mockImplementation(async () => ({
      ...CONTEXT,
      // O lote 2 entrou: os 1.000 estão no banco.
      existingContacts: [...new Map(written().map((row) => [row.id, row])).values()].map((row) => ({
        id: row.id,
        email: row.email,
        phone: null,
      })),
      members: MEMBERS.map((member) => (member.id === 'bruna' ? { ...member, active: false } : member)),
    }));
    mount(rows, { ...CONTEXT, existingContacts: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Importar 1.000 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação parada' })).toBeTruthy();
    expect(screen.getByText('500 de 1.000 contatos gravados.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar importação' }));
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    expect(screen.getByText('1.000 contatos importados.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Baixar contatos não importados' })).toBeNull();
    expect(mocks.toast.success).toHaveBeenCalledWith('1.000 contatos importados');
  });
});

// Achados de baixa severidade da revisão do item 1.11 (docs/arquitetura/1.12.md, seção 9).
describe('recusas e resultado (revisão do item 1.11)', () => {
  const refusal = 'A pessoa escolhida como responsável foi desativada. Escolha outra pessoa em “Responsável”.';

  it('achado 1: a recusa no primeiro lote diz que nada foi gravado, oferece "Continuar importação" e fechar pede confirmação', async () => {
    mocks.writeContacts.mockRejectedValueOnce({ code: 'P0001', message: refusal });
    mocks.loadContext.mockResolvedValue({
      ...CONTEXT,
      members: MEMBERS.map((member) => (member.id === 'carla' ? { ...member, active: false } : member)),
    });
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    const alert = await screen.findByText(/^A importação parou:/);
    expect(alert.textContent).toBe(
      `A importação parou: ${refusal} Nenhum contato foi gravado. Confira a prévia dos que faltam e use “Continuar importação”.`,
    );
    // O botão segue o alerta: "Continuar importação de …", e não "Importar …".
    expect(screen.queryByRole('button', { name: /^Importar/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Continuar importação de 2 contatos' })).toBeTruthy();
    // A empresa nova já foi criada: "Cancelar" pede a confirmação antes de fechar.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/^2 contatos que faltam não serão gravados\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar sem gravar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('achados 2 e 4: a linha recusada pelo e-mail no meio e reanalisada depois de outra recusa conta uma vez', async () => {
    const rows = ['nome;email', ...Array.from({ length: 700 }, (_, i) => `P${i};p${i}@example.test`)].join('\n');
    // Lote 1: um colega cadastrou p3 (23505), e o lote é reenviado sem a linha; lote 2: uma recusa (P0001).
    mocks.writeContacts
      .mockRejectedValueOnce({ code: '23505', message: 'contacts_org_email_unique' })
      .mockImplementationOnce(async (batch: ContactPayload[]) => batch.map((row) => row.id))
      .mockRejectedValueOnce({ code: 'P0001', message: refusal });
    mocks.loadExisting.mockResolvedValue([{ id: 'colega', email: 'p3@example.test', phone: null }]);
    mocks.loadContext.mockImplementation(async () => ({
      ...CONTEXT,
      existingContacts: [
        { id: 'colega', email: 'p3@example.test', phone: null },
        // Só o lote reenviado entrou (a segunda gravação).
        ...(mocks.writeContacts.mock.calls[1][0] as ContactPayload[]).map((row) => ({
          id: row.id,
          email: row.email,
          phone: null,
        })),
      ],
    }));
    mount(rows, { ...CONTEXT, existingContacts: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Importar 700 contatos' }));
    await screen.findByText(/^A importação parou:/);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar importação de 200 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    expect(screen.getByText('699 contatos importados. 1 repetida e 0 com erro ficou de fora.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Baixar contatos não importados' }));
    const text = mocks.download.mock.calls[0][1] as string;
    expect(text.match(/"Repetida"/g)).toHaveLength(1);
  });

  it('achado 6a: a empresa nova excluída por um colega (23503) volta a ser criada com o mesmo id', async () => {
    mocks.writeContacts.mockRejectedValueOnce({
      code: '23503',
      message: 'insert or update on table "contacts" violates foreign key constraint',
    });
    // Relida depois da recusa: a empresa nova sumiu do banco.
    mocks.loadContext.mockResolvedValue(CONTEXT);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByText(/^A importação parou: Uma empresa ou uma pessoa da equipe/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar importação de 3 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    expect(mocks.writeCompanies).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.writeCompanies.mock.calls.map(([batch]) => (batch as CompanyPayload[])[0].id);
    expect(second).toBe(first);
    expect(written().find((row) => row.first_name === 'Caio')?.company_id).toBe(first);
  });

  it('achado 8: o resultado avisa a repetida do meio da gravação que pedia "Não contatar"', async () => {
    mocks.writeContacts.mockRejectedValueOnce({ code: '23505', message: 'contacts_org_email_unique' });
    mocks.loadExisting.mockResolvedValue([
      { id: 'colega', email: 'bia@example.test', phone: null, do_not_contact: false },
    ]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação concluída' })).toBeTruthy();
    expect(
      screen.getByText(
        '1 linha repetida pede “Não contatar”, e o contato no CRM não tem a marca: marque na ficha dele (a linha está em “Baixar contatos não importados”).',
      ),
    ).toBeTruthy();
    // A releitura pede a marca, porque o banco tem a coluna do 1.9.
    expect(mocks.loadExisting).toHaveBeenCalledWith('org-1', true);
  });

  it('achado 9: a recusa com código não oferece "Continuar importação"; a orientação é a planilha, também ao fechar', async () => {
    mocks.writeContacts.mockRejectedValueOnce({ code: '22001', message: 'value too long' });
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação parada' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('(código 22001)');
    expect(screen.queryByRole('button', { name: 'Continuar importação' })).toBeNull();
    const download = screen.getByRole('button', { name: 'Baixar contatos não importados' });
    expect(download.className).not.toContain('border-input');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).not.toHaveBeenCalled();
    const warning = screen.getByText(/^3 contatos que faltam não serão gravados\./);
    expect(warning.textContent).toContain('Antes de fechar, use “Baixar contatos não importados”');
    expect(warning.textContent).not.toContain('Continuar importação');
  });

  // Revisão do item 1.12: a recusa de uma regra de conferência (23514) também é a recusa com código, e a falha no
  // primeiro lote diz "Nenhum contato foi gravado." (e não "0 contatos já foram gravados.").
  it('a recusa 23514 no primeiro lote diz o código e que nada foi gravado, sem "Continuar importação"', async () => {
    mocks.writeContacts.mockRejectedValueOnce({
      code: '23514',
      message: 'new row for relation "contacts" violates check constraint "contacts_status_check"',
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Importar 3 contatos' }));
    expect(await screen.findByRole('heading', { name: 'Importação parada' })).toBeTruthy();
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain('(código 23514). Nenhum contato foi gravado.');
    expect(alert).not.toMatch(/\b0 contatos|Verifique a conexão|preenchimento/);
    expect(screen.queryByRole('button', { name: 'Continuar importação' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Baixar contatos não importados' })).toBeTruthy();
  });
});

// Revisão do item 1.11, achado 12: "Exportar contatos" escreve "Não informada" para quem não tem base, e o banco aplica
// o padrão da empresa; a prévia avisa, em vez de a troca acontecer em silêncio.
describe('base padrão da empresa na prévia', () => {
  it('avisa quantos contatos sem base legal recebem a base padrão, com o nome dela', () => {
    mount('nome;base_legal\nAna;\nBia;Não informada\nCaio;Contrato', {
      ...CONTEXT,
      defaultLegalBasis: 'legitimate_interest',
    });
    expect(
      within(screen.getByRole('status')).getByText(
        '2 contatos sem base legal na planilha (vazia ou “Não informada”) recebem a base padrão da empresa: Legítimo interesse.',
      ),
    ).toBeTruthy();
  });

  it('sem base padrão na empresa, não há aviso', () => {
    mount('nome;base_legal\nAna;\nBia;Não informada', { ...CONTEXT, defaultLegalBasis: 'not_informed' });
    expect(screen.queryByText(/base padrão da empresa/)).toBeNull();
  });
});
