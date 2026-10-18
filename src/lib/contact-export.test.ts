import { describe, expect, it } from 'vitest';
import { readZip, zipText } from '@/test/zip-reader';
import { parseCsv } from './csv';
import {
  buildContactExportFiles,
  buildContactExportZip,
  CONTACT_EXPORT_FILES,
  contactExportBaseName,
  parseContactExportData,
  type ContactExportData,
} from './contact-export';

function exportData(overrides: Partial<ContactExportData> = {}): ContactExportData {
  return {
    format: 1,
    generated_at: '2026-10-13T15:30:00.123456+00:00',
    organization: { name: 'Acme Comércio' },
    contact: {
      id: '1a2b3c4d-0000-0000-0000-000000000001',
      first_name: 'Ana',
      last_name: 'Souza',
      email: 'ana@example.test',
      phone: '+5511999990000',
      job_title: 'Compradora',
      source: 'Site',
      notes: '=HIPERLINK("x") prefere e-mail',
      status: 'customer',
      created_at: '2026-09-01T12:00:00+00:00',
      updated_at: '2026-10-12T12:00:00+00:00',
      legal_basis: 'consent',
      legal_basis_note: 'Marcou a caixa do formulário em 10/10/2026.',
      legal_basis_at: '2026-10-10T12:00:00+00:00',
      do_not_contact: true,
      do_not_contact_at: '2026-10-11T12:00:00+00:00',
      do_not_contact_reason: 'Prefere só e-mail.',
      anonymized_at: null,
    },
    company: { id: 'company-1', name: 'Souza Comércio' },
    activities: [
      {
        id: 'activity-1',
        type: 'call',
        title: 'Ligação de boas-vindas',
        body: 'Confirmou o plano.',
        due_date: '2026-10-01T13:00:00+00:00',
        end_date: null,
        completed_at: '2026-10-01T13:10:00+00:00',
        outcome: 'answered',
        created_at: '2026-09-30T12:00:00+00:00',
        deal_id: 'deal-1',
        relation: 'person',
      },
      {
        id: 'activity-2',
        type: 'task',
        title: 'Enviar o contrato',
        body: null,
        due_date: '2026-10-20T13:00:00+00:00',
        end_date: null,
        completed_at: null,
        outcome: null,
        created_at: '2026-10-01T12:00:00+00:00',
        deal_id: null,
        relation: 'person',
      },
      {
        id: 'activity-3',
        type: 'note',
        title: 'Nota do plano',
        body: 'Pediu prazo.',
        due_date: null,
        end_date: null,
        completed_at: null,
        outcome: null,
        created_at: '2026-10-02T12:00:00+00:00',
        deal_id: 'deal-1',
        relation: 'no_contact',
      },
      {
        id: 'activity-4',
        type: 'task',
        title: 'Alinhar o plano com o financeiro',
        body: null,
        due_date: '2026-10-21T13:00:00+00:00',
        end_date: null,
        completed_at: null,
        outcome: null,
        created_at: '2026-10-02T12:00:00+00:00',
        deal_id: 'deal-1',
        relation: 'other_contact',
      },
    ],
    deals: [
      {
        id: 'deal-1',
        title: 'Plano anual',
        value: 1234.5,
        currency: 'BRL',
        status: 'won',
        pipeline: 'Comercial',
        stage: 'Negociação',
        close_date: '2026-10-05',
        closed_at: '2026-10-05T18:00:00+00:00',
        lost_reason: null,
        created_at: '2026-09-02T12:00:00+00:00',
      },
    ],
    payments: [
      {
        id: 'payment-1',
        description: 'Adesão',
        amount: 150,
        currency: 'BRL',
        status: 'pending',
        due_date: '2026-11-01',
        paid_at: null,
        deal_id: null,
        created_at: '2026-10-01T12:00:00+00:00',
      },
      {
        id: 'payment-2',
        description: 'Primeira parcela',
        amount: 99.9,
        currency: 'BRL',
        status: 'paid',
        due_date: '2026-10-10',
        paid_at: '2026-10-10T12:00:00+00:00',
        deal_id: 'deal-1',
        created_at: '2026-10-01T12:00:00+00:00',
      },
    ],
    ...overrides,
  };
}
const fileOf = (files: { name: string; data: string | Uint8Array }[], name: string) =>
  files.find((file) => file.name === name)!.data as string;

describe('parseContactExportData', () => {
  it('aceita a resposta da RPC e recusa o que está fora do contrato', () => {
    expect(parseContactExportData(exportData()).contact.first_name).toBe('Ana');
    expect(() => parseContactExportData({ ...exportData(), format: 2 })).toThrow();
    expect(() => parseContactExportData({ ...exportData(), contact: null })).toThrow();
    expect(() => parseContactExportData({ ...exportData(), payments: undefined })).toThrow();
    expect(() => parseContactExportData(null)).toThrow();
  });
});

describe('buildContactExportFiles', () => {
  const data = exportData();
  const files = buildContactExportFiles(data);

  it('gera os seis arquivos, na ordem do pacote', () => {
    expect(files.map((file) => file.name)).toEqual([...CONTACT_EXPORT_FILES]);
    expect(CONTACT_EXPORT_FILES).toEqual([
      'LEIA-ME.txt',
      'dados.json',
      'contato.csv',
      'atividades.csv',
      'oportunidades.csv',
      'recebimentos.csv',
    ]);
  });

  it('o JSON tem as chaves em pt-BR, os rótulos da tela, as datas ISO com fuso, os valores numéricos e os ids', () => {
    const json = JSON.parse(fileOf(files, 'dados.json'));
    expect(Object.keys(json)).toEqual([
      'formato',
      'gerado_em',
      'empresa_controladora',
      'contato',
      'empresa_vinculada',
      'atividades',
      'oportunidades',
      'recebimentos',
    ]);
    expect(json.gerado_em).toBe('2026-10-13T15:30:00.123456+00:00');
    expect(json.empresa_controladora).toEqual({ nome: 'Acme Comércio' });
    expect(json.contato).toMatchObject({
      id: data.contact.id,
      nome: 'Ana',
      sobrenome: 'Souza',
      situacao: 'Cliente',
      base_legal: 'Consentimento',
      registro_da_base_legal: 'Marcou a caixa do formulário em 10/10/2026.',
      nao_contatar: true,
      motivo_nao_contatar: 'Prefere só e-mail.',
      anonimizado_em: null,
    });
    expect(json.empresa_vinculada).toEqual({ id: 'company-1', nome: 'Souza Comércio' });
    expect(json.atividades[0]).toMatchObject({
      tipo: 'Ligação',
      vinculo: 'Com a pessoa',
      resultado: 'Atendeu',
      oportunidade_id: 'deal-1',
    });
    expect(json.atividades[1]).toMatchObject({ tipo: 'Tarefa', resultado: null });
    // As atividades das oportunidades dela, sem contato ou com outro contato (o banco tira os termos dele), também vão.
    expect(json.atividades.map((activity: { vinculo: string }) => activity.vinculo)).toEqual([
      'Com a pessoa',
      'Com a pessoa',
      'Sem contato, na oportunidade',
      'Com outro contato da oportunidade',
    ]);
    expect(json.oportunidades[0]).toMatchObject({ situacao: 'Ganha', valor: 1234.5, funil: 'Comercial' });
    expect(json.recebimentos.map((payment: { situacao: string }) => payment.situacao)).toEqual([
      'Pendente',
      'Recebido',
    ]);
  });

  it('não leva nenhum campo nem nome da equipe', () => {
    const everything = files.map((file) => file.data as string).join('\n');
    expect(everything).not.toMatch(/owner|user_id|created_by|_by\b|"[a-z_]*_by"/);
    expect(everything).not.toMatch(/Respons[aá]vel/);
  });

  it('as planilhas usam ";", BOM, CRLF, os rótulos e a neutralização de fórmulas', () => {
    for (const name of ['contato.csv', 'atividades.csv', 'oportunidades.csv', 'recebimentos.csv']) {
      const text = fileOf(files, name);
      expect(text.startsWith('﻿"')).toBe(true);
      expect(text).toContain('";"');
      expect(text).toContain('\r\n');
    }
    const contact = parseCsv(fileOf(files, 'contato.csv'));
    const row = Object.fromEntries(contact.headers.map((header, index) => [header, contact.rows[0][index]]));
    expect(row).toMatchObject({
      Nome: 'Ana',
      'Base legal': 'Consentimento',
      'Não contatar': 'Sim',
      'Empresa vinculada': 'Souza Comércio',
      Situação: 'Cliente',
    });
    // A fórmula sai neutralizada no arquivo e volta como texto na leitura.
    expect(fileOf(files, 'contato.csv')).toContain(`"'=HIPERLINK(""x"") prefere e-mail"`);
    expect(row['Observações']).toBe('=HIPERLINK("x") prefere e-mail');
    const deals = parseCsv(fileOf(files, 'oportunidades.csv'));
    expect(deals.rows[0]).toEqual([
      'Plano anual',
      'Comercial',
      'Negociação',
      'Ganha',
      '1234,50',
      '05/10/2026',
      new Date('2026-10-05T18:00:00+00:00').toLocaleString('pt-BR'),
      '',
      new Date('2026-09-02T12:00:00+00:00').toLocaleString('pt-BR'),
    ]);
    const activities = parseCsv(fileOf(files, 'atividades.csv'));
    expect(activities.headers.slice(0, 3)).toEqual(['Tipo', 'Vínculo', 'Título']);
    expect(activities.rows[0][0]).toBe('Ligação');
    expect(activities.rows[0][1]).toBe('Com a pessoa');
    expect(activities.rows[0][7]).toBe('Atendeu');
    expect(activities.rows[0][8]).toBe('Plano anual');
    expect(activities.rows.map((activity) => [activity[1], activity[8]]).slice(2)).toEqual([
      ['Sem contato, na oportunidade', 'Plano anual'],
      ['Com outro contato da oportunidade', 'Plano anual'],
    ]);
    const payments = parseCsv(fileOf(files, 'recebimentos.csv'));
    expect(payments.rows.map((payment) => [payment[1], payment[2], payment[3], payment[5]])).toEqual([
      ['150,00', 'Pendente', '01/11/2026', ''],
      ['99,90', 'Recebido', '10/10/2026', 'Plano anual'],
    ]);
  });

  // Achado 4 da revisão do item 1.10 (corrigido no 1.11): "Não informada" é a ausência de registro, como na tela.
  it('com a base "Não informada", o pacote não mostra a data do registro; com outra base, mostra', () => {
    const notInformed = buildContactExportFiles(
      exportData({ contact: { ...data.contact, legal_basis: 'not_informed', legal_basis_note: null } }),
    );
    expect(JSON.parse(fileOf(notInformed, 'dados.json')).contato).toMatchObject({
      base_legal: 'Não informada',
      base_legal_registrada_em: null,
    });
    const row = (files: ReturnType<typeof buildContactExportFiles>) => {
      const sheet = parseCsv(fileOf(files, 'contato.csv'));
      return Object.fromEntries(sheet.headers.map((header, index) => [header, sheet.rows[0][index]]));
    };
    expect(row(notInformed)['Base legal registrada em']).toBe('');
    expect(JSON.parse(fileOf(files, 'dados.json')).contato.base_legal_registrada_em).toBe('2026-10-10T12:00:00+00:00');
    expect(row(files)['Base legal registrada em']).toBe(new Date('2026-10-10T12:00:00+00:00').toLocaleString('pt-BR'));
  });

  it('contato sem atividades, oportunidades nem recebimentos: as planilhas só com o cabeçalho', () => {
    const empty = buildContactExportFiles(exportData({ activities: [], deals: [], payments: [], company: null }));
    for (const name of ['atividades.csv', 'oportunidades.csv', 'recebimentos.csv']) {
      const parsed = parseCsv(fileOf(empty, name));
      expect(parsed.headers.length).toBeGreaterThan(0);
      expect(parsed.rows).toEqual([]);
    }
    expect(JSON.parse(fileOf(empty, 'dados.json')).empresa_vinculada).toBeNull();
  });

  it('o LEIA-ME diz de que empresa e de quando é o arquivo, e o que cada arquivo traz', () => {
    const readme = fileOf(files, 'LEIA-ME.txt');
    expect(readme.startsWith('﻿')).toBe(true);
    expect(readme).toContain('\r\n');
    expect(readme).toContain('Dados de Ana Souza guardados por Acme Comércio');
    expect(readme).toContain(new Date('2026-10-13T15:30:00.123456+00:00').toLocaleString('pt-BR'));
    for (const name of CONTACT_EXPORT_FILES.slice(1)) expect(readme).toContain(name);
    expect(readme).toContain('Os nomes das pessoas da equipe da empresa não fazem parte deste arquivo.');
    expect(readme).toContain('canal de privacidade');
    expect(readme).toContain('A coluna "Vínculo" diz se a atividade foi com a pessoa');
    // O LEIA-ME não promete o que o banco não faz: com outro contato, só o nome, o e-mail e o telefone gravados no
    // cadastro dele saem (um telefone antigo continua no texto).
    expect(readme).not.toContain('sem o nome dele');
    expect(readme).toContain(
      'Nas atividades e nos recebimentos das negociações ligados a outro contato, o nome, o e-mail e o telefone gravados no cadastro dessa outra pessoa foram trocados por "[anonimizado]"',
    );
    const renamed = fileOf(buildContactExportFiles(data, { organizationName: 'Outra Empresa' }), 'LEIA-ME.txt');
    expect(renamed).toContain('guardados por Outra Empresa');
  });
});

describe('atividades de uma resposta sem o vínculo', () => {
  it('a resposta anterior à revisão, só com as atividades da pessoa, sai como "Com a pessoa"', () => {
    const [first] = exportData().activities;
    const { relation: _relation, ...withoutRelation } = first;
    const json = JSON.parse(
      fileOf(buildContactExportFiles(exportData({ activities: [withoutRelation] })), 'dados.json'),
    );
    expect(json.atividades[0].vinculo).toBe('Com a pessoa');
  });
});

describe('buildContactExportZip', () => {
  it('o .zip tem os seis arquivos, lidos de volta com o mesmo conteúdo', () => {
    const data = exportData();
    const entries = readZip(buildContactExportZip(data));
    expect(entries.map((entry) => entry.name)).toEqual([...CONTACT_EXPORT_FILES]);
    const json = JSON.parse(zipText(entries.find((entry) => entry.name === 'dados.json')!));
    expect(json.contato.email).toBe('ana@example.test');
    expect(json.recebimentos).toHaveLength(2);
  });
});

describe('contactExportBaseName', () => {
  it('usa o começo do id e nunca o nome da pessoa', () => {
    expect(contactExportBaseName('1a2b3c4d-0000-0000-0000-000000000001')).toBe('dados-contato-1a2b3c4d');
  });
});
