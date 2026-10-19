import { describe, expect, it, vi } from 'vitest';
import {
  analyzeContactImport,
  IMPORT_MESSAGES,
  planContactImport,
  readContactSheet,
  type CompanyPayload,
  type ContactPayload,
} from '@/lib/contact-import';
import { PRIVACY_MIGRATION_MISSING } from '@/lib/rpc-errors';
import {
  emptyProgress,
  MISSING_LINK_MESSAGE,
  pendingRows,
  ROLE_REFUSED_MESSAGE,
  runContactImport,
  writeFailure,
  writeFailureMessage,
  type ContactImportWriterDeps,
} from './useContactImportWriter';

vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: vi.fn(), rpc: vi.fn() } }));

/**
 * Um plano com `rows` contatos e e-mails únicos; os de índice múltiplo de `companyEvery` (7, por padrão) com uma empresa
 * nova.
 */
function planOf(rows: number, companyEvery = 7) {
  const text = [
    'nome;email;empresa',
    ...Array.from(
      { length: rows },
      (_, i) => `Pessoa ${i};p${i}@example.test;${i % companyEvery === 0 ? `Empresa ${i}` : ''}`,
    ),
  ].join('\n');
  const sheet = readContactSheet(new TextEncoder().encode(text), 'a.csv').sheet!;
  let id = 0;
  const analysis = analyzeContactImport(
    sheet,
    {
      orgId: 'org-1',
      existingContacts: [],
      companies: [],
      members: [{ id: 'me', name: 'Pessoa', email: 'me@example.test', active: true }],
      columns: { doNotContact: true, legalBasis: true },
    },
    { newId: () => `id-${String(++id).padStart(5, '0')}` },
  );
  return planContactImport(analysis, { ownerMode: 'me', meId: 'me' });
}

function fakeDb() {
  const order: string[] = [];
  const contacts: ContactPayload[][] = [];
  const companies: CompanyPayload[][] = [];
  const stored = new Map<string, ContactPayload>();
  const failures: unknown[] = [];
  const deps: ContactImportWriterDeps = {
    writeCompanies: vi.fn(async (batch) => {
      order.push(`companies:${batch.length}`);
      companies.push([...batch]);
      return batch.map((company) => company.id);
    }),
    writeContacts: vi.fn(async (batch) => {
      order.push(`contacts:${batch.length}`);
      contacts.push([...batch]);
      const failure = failures.shift();
      if (failure === 'lose') {
        for (const payload of batch) stored.set(payload.id, payload);
        throw new TypeError('Failed to fetch');
      }
      if (failure) throw failure;
      const inserted = batch.filter((payload) => !stored.has(payload.id));
      for (const payload of inserted) stored.set(payload.id, payload);
      return inserted.map((payload) => payload.id);
    }),
    readExistingContacts: vi.fn(async () =>
      [...stored.values()].map((payload) => ({ id: payload.id, email: payload.email, phone: payload.phone })),
    ),
  };
  return { deps, order, contacts, companies, stored, failures };
}

const controls = (shouldStop = () => false) => ({ shouldStop, onProgress: vi.fn() });

describe('runContactImport', () => {
  it('grava primeiro as empresas e depois os contatos, em lotes de até 500, um por vez', async () => {
    const plan = planOf(1203);
    const db = fakeDb();
    const progress = emptyProgress();
    const control = controls();
    await expect(runContactImport(plan, progress, db.deps, control)).resolves.toEqual({ kind: 'done' });
    expect(db.order).toEqual(['companies:172', 'contacts:500', 'contacts:500', 'contacts:203']);
    expect(progress.written.size).toBe(1203);
    expect(progress.companies.size).toBe(172);
    expect(control.onProgress.mock.calls.map(([phase]) => phase)).toEqual([
      'companies',
      'contacts',
      'contacts',
      'contacts',
    ]);
    // O plano é o mesmo do começo ao fim: os ids são os gerados na análise.
    expect(db.contacts.flat().map((payload) => payload.id)).toEqual(plan.ready.map((row) => row.row.id));
  });

  it('"Parar" termina o lote em andamento, e a continuação grava só o que falta, sem duplicar', async () => {
    const plan = planOf(1100);
    const db = fakeDb();
    const progress = emptyProgress();
    let stop = false;
    const control = { shouldStop: () => stop, onProgress: vi.fn(() => (stop = true)) };
    await expect(runContactImport(plan, progress, db.deps, control)).resolves.toEqual({ kind: 'stopped' });
    expect(progress.written.size).toBe(0);
    stop = false;
    let batches = 0;
    const second = {
      shouldStop: () => batches >= 1,
      onProgress: vi.fn((phase: string) => phase === 'contacts' && batches++),
    };
    await expect(runContactImport(plan, progress, db.deps, second)).resolves.toEqual({ kind: 'stopped' });
    expect(progress.written.size).toBe(500);
    await expect(runContactImport(plan, progress, db.deps, controls())).resolves.toEqual({ kind: 'done' });
    expect(db.order).toEqual(['companies:158', 'contacts:500', 'contacts:500', 'contacts:100']);
    expect(db.stored.size).toBe(1100);
  });

  // Revisão do item 1.11: "Parar" também entre os lotes de empresas, e não só antes de cada lote de contatos.
  it('"Parar" durante a criação das empresas termina o lote de empresas em andamento e para', async () => {
    const plan = planOf(1200, 1);
    expect(plan.companies).toHaveLength(1200);
    const db = fakeDb();
    const progress = emptyProgress();
    let stop = false;
    const control = {
      shouldStop: () => stop,
      onProgress: vi.fn((phase: string) => {
        if (phase === 'companies') stop = true;
      }),
    };
    await expect(runContactImport(plan, progress, db.deps, control)).resolves.toEqual({ kind: 'stopped' });
    expect(db.order).toEqual(['companies:500']);
    expect(progress.companies.size).toBe(500);
    expect(db.deps.writeContacts).not.toHaveBeenCalled();
    await expect(runContactImport(plan, progress, db.deps, controls())).resolves.toEqual({ kind: 'done' });
    expect(db.order).toEqual([
      'companies:500',
      'companies:500',
      'companies:200',
      'contacts:500',
      'contacts:500',
      'contacts:200',
    ]);
  });

  it('uma falha de rede para com a mensagem, e "Continuar" reenvia o lote com os mesmos ids', async () => {
    const plan = planOf(800);
    const db = fakeDb();
    const progress = emptyProgress();
    db.failures.push(undefined, new TypeError('Failed to fetch'));
    const outcome = await runContactImport(plan, progress, db.deps, controls());
    expect(outcome).toEqual({
      kind: 'failed',
      message:
        'A gravação de um lote não foi confirmada. 500 contatos já foram gravados. “Continuar importação” tenta de novo os que faltam, sem duplicar.',
      retryable: true,
    });
    await runContactImport(plan, progress, db.deps, controls());
    expect(db.contacts.map((batch) => batch.length)).toEqual([500, 300, 300]);
    expect(db.contacts[1].map((payload) => payload.id)).toEqual(db.contacts[2].map((payload) => payload.id));
    expect(progress.written.size).toBe(800);
  });

  it('com a resposta perdida, os ids que não voltam já estavam gravados e contam como gravados', async () => {
    const plan = planOf(600);
    const db = fakeDb();
    const progress = emptyProgress();
    db.failures.push('lose');
    expect((await runContactImport(plan, progress, db.deps, controls())).kind).toBe('failed');
    expect(db.stored.size).toBe(500);
    expect(progress.written.size).toBe(0);
    await expect(runContactImport(plan, progress, db.deps, controls())).resolves.toEqual({ kind: 'done' });
    expect(progress.written.size).toBe(600);
    expect(db.stored.size).toBe(600);
  });

  it('um e-mail cadastrado no meio (23505) relê os contatos, tira a linha e reenvia o lote uma vez', async () => {
    const plan = planOf(30);
    const db = fakeDb();
    const progress = emptyProgress();
    const colleague = { ...plan.ready[3].payload!, id: 'colega' };
    db.stored.set('colega', colleague);
    db.failures.push({
      code: '23505',
      message: 'duplicate key value violates unique constraint "contacts_org_email_unique"',
    });
    await expect(runContactImport(plan, progress, db.deps, controls())).resolves.toEqual({ kind: 'done' });
    expect(db.deps.readExistingContacts).toHaveBeenCalledTimes(1);
    expect(db.contacts.map((batch) => batch.length)).toEqual([30, 29]);
    expect(progress.late).toEqual(new Map([[plan.ready[3].row.id, IMPORT_MESSAGES.existingEmail]]));
    expect(progress.written.size).toBe(29);
    expect(pendingRows(plan, progress)).toEqual([]);
  });

  it('um segundo 23505 no mesmo lote para, com a mensagem da importação, e "Continuar" pode resolver', async () => {
    const plan = planOf(10);
    const db = fakeDb();
    db.failures.push({ code: '23505', message: 'x' }, { code: '23505', message: 'x' });
    await expect(runContactImport(plan, emptyProgress(), db.deps, controls())).resolves.toEqual({
      kind: 'failed',
      message:
        'Um e-mail da planilha foi cadastrado no CRM durante a gravação. Nenhum contato foi gravado. “Continuar importação” confere os contatos de novo e grava os que faltam, sem duplicar.',
      retryable: true,
    });
  });

  // Revisão do item 1.11, achado 6b: sem a conferência dos ids, os contatos já gravados por uma resposta perdida seriam
  // marcados "Repetida" (o e-mail deles já está no banco) e sairiam na planilha de não importados.
  it('resposta perdida e 23505 na nova tentativa: os ids já gravados contam como gravados, e só a colisão vira repetida', async () => {
    const plan = planOf(600);
    const db = fakeDb();
    const progress = emptyProgress();
    db.failures.push('lose');
    expect((await runContactImport(plan, progress, db.deps, controls())).kind).toBe('failed');
    expect(db.stored.size).toBe(500);
    // Antes da nova tentativa, um colega cadastra um contato com o e-mail de uma linha do lote 2.
    db.stored.set('colega', { ...plan.ready[510].payload!, id: 'colega' });
    db.failures.push({ code: '23505', message: 'duplicate key value violates unique constraint' });
    await expect(runContactImport(plan, progress, db.deps, controls())).resolves.toEqual({ kind: 'done' });
    expect(progress.late).toEqual(new Map([[plan.ready[510].row.id, IMPORT_MESSAGES.existingEmail]]));
    expect(progress.written.size).toBe(599);
    expect(plan.ready.slice(0, 500).every((row) => progress.written.has(row.row.id))).toBe(true);
  });

  // Revisão do item 1.11, achado 8: a linha que pede "Não contatar" e colide no meio da gravação com um contato sem a
  // marca não perde o pedido: ganha o motivo que manda marcar na ficha, como na prévia.
  it('o 23505 de uma linha que pede "Não contatar" contra um contato sem a marca leva o motivo de marcar na ficha', async () => {
    const text = [
      'nome;email;nao_contatar',
      'Ana;ana@example.test;sim',
      'Bia;bia@example.test;sim',
      'Caio;caio@example.test;',
    ].join('\n');
    const sheet = readContactSheet(new TextEncoder().encode(text), 'a.csv').sheet!;
    let id = 0;
    const plan = planContactImport(
      analyzeContactImport(
        sheet,
        {
          orgId: 'org-1',
          existingContacts: [],
          companies: [],
          members: [{ id: 'me', name: 'Pessoa', email: 'me@example.test', active: true }],
          columns: { doNotContact: true, legalBasis: true },
        },
        { newId: () => `id-${++id}` },
      ),
      { ownerMode: 'me', meId: 'me' },
    );
    const db = fakeDb();
    db.deps.readExistingContacts = vi.fn(async () => [
      { id: 'c-ana', email: 'ana@example.test', phone: null, do_not_contact: false },
      { id: 'c-bia', email: 'bia@example.test', phone: null, do_not_contact: true },
      { id: 'c-caio', email: 'caio@example.test', phone: null, do_not_contact: false },
    ]);
    db.failures.push({ code: '23505', message: 'duplicate key value violates unique constraint' });
    const progress = emptyProgress();
    await expect(runContactImport(plan, progress, db.deps, controls())).resolves.toEqual({ kind: 'done' });
    expect(progress.late.get('id-1')).toBe(
      'Já existe um contato com este e-mail. A linha pede “Não contatar”, e o contato que fica no CRM não tem a marca: marque na ficha dele.',
    );
    // O contato da Bia já tem a marca, e a linha do Caio não pede: só a repetida.
    expect(progress.late.get('id-2')).toBe(IMPORT_MESSAGES.existingEmail);
    expect(progress.late.get('id-3')).toBe(IMPORT_MESSAGES.existingEmail);
  });

  it('uma recusa do banco (P0001) para e devolve a mensagem para a prévia', async () => {
    const plan = planOf(700);
    const db = fakeDb();
    const message = 'A pessoa escolhida como responsável foi desativada. Escolha outra pessoa em “Responsável”.';
    db.failures.push(undefined, { code: 'P0001', message });
    const progress = emptyProgress();
    await expect(runContactImport(plan, progress, db.deps, controls())).resolves.toEqual({ kind: 'refused', message });
    expect(progress.written.size).toBe(500);
  });

  // Item 1.13: a recusa de um gancho de validação da empresa (private.custom_validate_contact) chega como P0001 e para
  // a importação no lote inteiro, com a mensagem do gancho como está.
  it('a recusa de uma regra da empresa (gancho, P0001) para no lote e devolve a mensagem do gancho', async () => {
    const plan = planOf(700);
    const db = fakeDb();
    const message = 'Regra da empresa: contatos sem cargo não entram. Preencha a coluna cargo de todas as linhas.';
    db.failures.push(undefined, { code: 'P0001', message });
    const progress = emptyProgress();
    await expect(runContactImport(plan, progress, db.deps, controls())).resolves.toEqual({ kind: 'refused', message });
    // O primeiro lote entrou; o segundo, recusado inteiro, fica para depois.
    expect(progress.written.size).toBe(500);
  });

  // Revisão do item 1.11: a empresa excluída por um colega depois da prévia (ou o perfil do responsável removido) faz o
  // lote falhar sempre igual; volta à prévia, relida, como o P0001, em vez de prometer que "Continuar" resolve.
  it('um vínculo que sumiu (23503) para e volta à prévia, nos contatos e nas empresas', async () => {
    const plan = planOf(700);
    const db = fakeDb();
    db.failures.push(undefined, {
      code: '23503',
      message: 'insert or update on table "contacts" violates foreign key',
    });
    const progress = emptyProgress();
    await expect(runContactImport(plan, progress, db.deps, controls())).resolves.toEqual({
      kind: 'refused',
      message: MISSING_LINK_MESSAGE,
    });
    expect(progress.written.size).toBe(500);
    const companies = fakeDb();
    companies.deps.writeCompanies = vi.fn(async () => {
      throw { code: '23503', message: 'insert or update on table "companies" violates foreign key' };
    });
    await expect(runContactImport(planOf(10), emptyProgress(), companies.deps, controls())).resolves.toEqual({
      kind: 'refused',
      message: MISSING_LINK_MESSAGE,
    });
  });

  it('a recusa nas empresas para antes dos contatos', async () => {
    const plan = planOf(10);
    const db = fakeDb();
    db.deps.writeCompanies = vi.fn(async () => {
      throw { code: '42501', message: 'new row violates row-level security policy' };
    });
    await expect(runContactImport(plan, emptyProgress(), db.deps, controls())).resolves.toEqual({
      kind: 'failed',
      message: ROLE_REFUSED_MESSAGE,
      retryable: true,
    });
    expect(db.deps.writeContacts).not.toHaveBeenCalled();
  });

  // Revisão do item 1.11, achado 9: a recusa do banco com código se repetiria igual, e a tela não oferece "Continuar".
  it('a recusa com outro código não é repetível; a falha de rede, o papel e o e-mail repetido são', async () => {
    const db = fakeDb();
    db.failures.push({ code: '22001', message: 'value too long for type character varying' });
    const outcome = await runContactImport(planOf(10), emptyProgress(), db.deps, controls());
    expect(outcome).toMatchObject({ kind: 'failed', retryable: false });
    expect(writeFailure({ code: '22001', message: 'x' }, 0).retryable).toBe(false);
    for (const error of [
      new TypeError('Failed to fetch'),
      { code: '57014', message: 'x' },
      { code: '42501', message: 'x' },
      { code: '23505', message: 'x' },
      { code: 'PGRST204', message: "Could not find the 'legal_basis' column" },
    ])
      expect(writeFailure(error, 0).retryable, JSON.stringify(error)).toBe(true);
  });

  // Revisão do item 1.12: a recusa de uma regra de conferência (CHECK, 23514) que a prévia não conhece se repetiria
  // igual; diz o código e manda baixar os não importados, sem a mensagem genérica do formulário.
  it('a recusa de uma regra de conferência (23514) não é repetível e diz o código', async () => {
    for (const message of [
      'new row for relation "contacts" violates check constraint "contacts_status_check"',
      'new row for relation "contacts" violates check constraint "contacts_legal_basis_consent_note"',
    ]) {
      const failure = writeFailure({ code: '23514', message }, 0);
      expect(failure.retryable, message).toBe(false);
      expect(failure.message).toBe(
        'O banco recusou a gravação de um lote (código 23514). Nenhum contato foi gravado. Baixe os contatos não importados, confira as linhas e importe esse arquivo. Se a recusa continuar, informe o código a quem administra o CRM.',
      );
    }
    const db = fakeDb();
    db.failures.push({ code: '23514', message: 'violates check constraint "contacts_status_check"' });
    await expect(runContactImport(planOf(10), emptyProgress(), db.deps, controls())).resolves.toMatchObject({
      kind: 'failed',
      retryable: false,
    });
  });
});

describe('writeFailureMessage', () => {
  it('explica o papel, a migração ausente e a falha de rede', () => {
    expect(writeFailureMessage({ code: '42501', message: 'x' }, 0)).toBe(ROLE_REFUSED_MESSAGE);
    expect(writeFailureMessage({ code: 'PGRST204', message: "Could not find the 'legal_basis' column" }, 0)).toBe(
      PRIVACY_MIGRATION_MISSING,
    );
    expect(writeFailureMessage(new Error('x'), 1)).toBe(
      'A gravação de um lote não foi confirmada. 1 contato já foi gravado. “Continuar importação” tenta de novo os que faltam, sem duplicar.',
    );
  });

  // Revisão do item 1.12: sem nenhum contato gravado, a frase do achado 1 da revisão do 1.11 também nas falhas.
  it('sem nenhum contato gravado, diz "Nenhum contato foi gravado.", na falha de rede e na recusa com código', () => {
    expect(writeFailureMessage({ message: 'Failed to fetch' }, 0)).toBe(
      'A gravação de um lote não foi confirmada. Nenhum contato foi gravado. “Continuar importação” tenta de novo os que faltam, sem duplicar.',
    );
    expect(writeFailureMessage({ code: '22001', message: 'x' }, 0)).toContain(
      '(código 22001). Nenhum contato foi gravado. Baixe',
    );
    for (const written of [0, 1, 2, 1500])
      expect(writeFailureMessage(new Error('x'), written)).not.toMatch(/\b0 contatos/);
  });

  // Revisão do item 1.11: só a falha de rede ou passageira promete que "Continuar importação" resolve.
  it('uma recusa do banco com código diz o código e não promete que "Continuar" resolve; a passageira promete', () => {
    expect(writeFailureMessage({ code: '22P05', message: 'unsupported Unicode escape sequence' }, 1500)).toBe(
      'O banco recusou a gravação de um lote (código 22P05). 1.500 contatos já foram gravados. Baixe os contatos não importados, confira as linhas e importe esse arquivo. Se a recusa continuar, informe o código a quem administra o CRM.',
    );
    expect(writeFailureMessage({ code: '23502', message: 'null value' }, 0)).toContain('(código 23502)');
    for (const code of ['57014', '40001', '08006', '53300', 'PGRST000', 'PGRST003', ''])
      expect(writeFailureMessage({ code, message: 'x' }, 0), code).toContain('“Continuar importação” tenta de novo');
    expect(writeFailureMessage({ code: 'PGRST116', message: 'x' }, 0)).toContain('(código PGRST116)');
  });
});
