import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEMO_SCHEMA,
  DEMO_VOLUME_COUNTS,
  REMOVE_FILE,
  SEED_FILE,
  buildDemoDataset,
  buildDemoSeedFiles,
  demoExpectedCounts,
  renderSeedSql,
} from './demo-seed.mjs';

// Item 1.15 (docs/arquitetura/1.15.md): o conjunto de demonstração e os dois arquivos SQL gerados. O test:db roda os
// arquivos numa instância migrada; aqui ficam as regras do conjunto, que não dependem do banco.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataset = buildDemoDataset();
const byId = (rows) => new Map(rows.map((row) => [row.id, row]));
const contacts = byId(dataset.contacts);
const companies = byId(dataset.companies);
const deals = byId(dataset.deals);
const products = byId(dataset.products);

describe('dados de demonstração', () => {
  it('os arquivos versionados batem com o gerador (rode npm run seed:demo depois de mudar o conjunto)', () => {
    for (const { file, content } of buildDemoSeedFiles())
      expect(readFileSync(path.join(ROOT, file), 'utf8'), file).toBe(content);
    expect(buildDemoSeedFiles().map(({ file }) => file)).toEqual([SEED_FILE, REMOVE_FILE]);
  });

  it('é determinístico e parte do gerador do 0.10 com quantidades menores', () => {
    expect(JSON.stringify(buildDemoDataset())).toBe(JSON.stringify(dataset));
    expect(renderSeedSql(buildDemoDataset())).toBe(renderSeedSql(dataset));
    expect(dataset.companies).toHaveLength(DEMO_VOLUME_COUNTS.companies);
    expect(dataset.contacts.length).toBe(DEMO_VOLUME_COUNTS.contacts + 3);
    expect(dataset.deals).toHaveLength(DEMO_VOLUME_COUNTS.deals);
    expect(dataset.activities.length).toBeGreaterThan(DEMO_VOLUME_COUNTS.activities);
    const ids = [dataset.companies, dataset.contacts, dataset.deals, dataset.activities, dataset.products]
      .flat()
      .map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('nada é dado real: e-mails em example.test e celulares fictícios "+55 DDD 9 0000-NNNN", sem repetir', () => {
    const phones = [...dataset.contacts, ...dataset.companies].map((row) => row.phone).filter(Boolean);
    for (const phone of phones) expect(phone).toMatch(/^\+55[1-9][0-9]90000[0-9]{4}$/);
    expect(new Set(phones).size).toBe(phones.length);
    for (const row of dataset.contacts) expect(row.email).toMatch(/@example\.test$/);
    for (const row of dataset.companies) expect(row.website).toMatch(/^https:\/\/[a-z0-9-]+\.example\.test$/);
  });

  it('a turma lê nomes sem repetir, cargos que concordam com o nome e observações neutras', () => {
    const names = dataset.contacts.map((row) => `${row.first_name} ${row.last_name}`);
    expect(new Set(names).size).toBe(names.length);
    const emails = dataset.contacts.map((row) => row.email);
    expect(new Set(emails).size).toBe(emails.length);
    const feminine =
      /^(Ana|Camila|Eduarda|Gabriela|Isabela|Larissa|Natália|Patrícia|Sofia|Valéria|Yasmin|Beatriz|Débora|Fernanda|Helena)$/;
    for (const row of dataset.contacts) {
      const title = row.job_title ?? '';
      if (feminine.test(row.first_name)) expect(title, row.first_name).not.toMatch(/^(Diretor |Sócio|Coordenador$)/);
      else expect(title, row.first_name).not.toMatch(/^(Diretora|Sócia|Coordenadora)/);
      expect(row.notes ?? '').not.toMatch(/contatad[ao]/);
    }
    // O título da oportunidade cita o contato com o nome que ficou.
    for (const row of dataset.deals)
      if (row.contact_id && row.title.includes(' · ')) {
        const contact = contacts.get(row.contact_id);
        expect(row.title).toContain(`${contact.first_name} ${contact.last_name}`);
      }
  });

  it('todo vínculo aponta para uma linha do conjunto', () => {
    for (const row of dataset.contacts) if (row.company_id) expect(companies.has(row.company_id)).toBe(true);
    for (const row of dataset.deals) {
      if (row.contact_id) expect(contacts.has(row.contact_id)).toBe(true);
      if (row.company_id) expect(companies.has(row.company_id)).toBe(true);
      for (const item of row.items ?? []) if (item.product_id) expect(products.has(item.product_id)).toBe(true);
    }
    for (const row of [...dataset.activities, ...dataset.payments]) {
      if (row.contact_id) expect(contacts.has(row.contact_id), row.id).toBe(true);
      if (row.company_id) expect(companies.has(row.company_id), row.id).toBe(true);
      if (row.deal_id) expect(deals.has(row.deal_id), row.id).toBe(true);
    }
    expect(deals.get(dataset.move.deal)).toMatchObject({ status: 'open', items: null });
  });

  it('mostra o que a F1 entregou: origens, bases legais, "Não contatar", anonimização e canais', () => {
    const sources = new Set(dataset.contacts.map((row) => row.source));
    for (const source of ['WhatsApp', 'Telefone', 'E-mail', 'Site', 'Indicação', 'Feira'])
      expect(sources).toContain(source);
    const bases = new Set(dataset.contacts.map((row) => row.legal_basis));
    expect(bases.size).toBeGreaterThanOrEqual(4);
    for (const row of dataset.contacts.filter((contact) => contact.legal_basis === 'consent'))
      expect(row.legal_basis_note).toBeTruthy();
    expect(contacts.get(dataset.doNotContact)).toMatchObject({ do_not_contact: true });
    // O banco recusa ação de contato pendente para quem pediu "Não contatar" (item 1.10).
    const blocked = dataset.activities.filter(
      (row) =>
        row.contact_id === dataset.doNotContact &&
        row.completed === null &&
        ['call', 'whatsapp', 'email', 'meeting', 'visit'].includes(row.type),
    );
    expect(blocked).toEqual([]);
    const types = new Set(dataset.activities.map((row) => row.type));
    for (const type of ['task', 'call', 'email', 'meeting', 'note', 'whatsapp', 'visit']) expect(types).toContain(type);
    const outcomes = dataset.activities.filter((row) => row.outcome);
    for (const row of outcomes) expect(row).toMatchObject({ type: 'call', completed: expect.any(Number) });
    expect(new Set(outcomes.map((row) => row.outcome))).toEqual(new Set(['answered', 'no_answer', 'voicemail']));
  });

  it('o Dono (vaga 0) tem uma atividade vencida e uma do dia, para o lembrete do menu', () => {
    const own = dataset.activities.filter((row) => row.user === 0 && row.completed === null && row.type !== 'note');
    expect(own.some((row) => row.due !== null && row.due < 0)).toBe(true);
    expect(own.some((row) => row.due_today)).toBe(true);
  });

  it('o catálogo tem produto e serviço, um mensal e um arquivado usado numa ganha, e itens com desconto e avulso', () => {
    expect(new Set(dataset.products.map((row) => row.kind))).toEqual(new Set(['product', 'service']));
    expect(dataset.products.some((row) => row.billing === 'monthly')).toBe(true);
    const archived = dataset.products.filter((row) => row.archived !== null);
    expect(archived).toHaveLength(1);
    const withItems = dataset.deals.filter((row) => row.items);
    expect(withItems.map((row) => row.status).sort()).toEqual(['lost', 'open', 'open', 'open', 'won', 'won', 'won']);
    expect(
      withItems.some((row) => row.status === 'won' && row.items.some((item) => item.product_id === archived[0].id)),
    ).toBe(true);
    const items = withItems.flatMap((row) => row.items);
    expect(items.some((item) => item.product_id === null)).toBe(true);
    expect(new Set(items.map((item) => item.discount_type).filter(Boolean))).toEqual(new Set(['percent', 'amount']));
    // Com item mensal, os meses do contrato são obrigatórios (save_deal).
    for (const row of withItems)
      expect(row.contract_months !== null, row.title).toBe(row.items.some((item) => item.billing === 'monthly'));
  });

  it('datas relativas: nada criado no futuro, e as encerradas fecham entre a criação e agora', () => {
    for (const row of [...dataset.companies, ...dataset.contacts, ...dataset.deals, ...dataset.activities])
      expect(row.created).toBeLessThanOrEqual(0);
    for (const row of dataset.deals.filter((deal) => deal.status !== 'open')) {
      expect(row.closed).toBeLessThanOrEqual(0);
      expect(row.closed).toBeGreaterThanOrEqual(row.created);
    }
    expect(dataset.contacts.filter((row) => row.created > -86_400).length).toBeGreaterThanOrEqual(4);
  });

  it('as contagens esperadas descontam a ação que a anonimização exclui e somam a tarefa da automação', () => {
    const counts = demoExpectedCounts(dataset);
    expect(counts.activities).toBe(dataset.activities.length);
    expect(counts.deal_items).toBe(14);
    expect(counts.automation_logs).toBe(1);
  });

  it('cada tabela classificada em DEMO_SCHEMA é gravada pelo seed ou tem o motivo de ficar de fora', () => {
    const sql = renderSeedSql(dataset);
    for (const [table, declared] of Object.entries(DEMO_SCHEMA)) {
      if (declared.skipped) {
        expect(declared.skipped.length, table).toBeGreaterThan(10);
        continue;
      }
      // Os itens entram só por private.save_deal (item 1.16), nunca direto em deal_items.
      if (table === 'deal_items') {
        expect(sql).not.toMatch(/public\.deal_items\b/);
        expect(sql).toMatch(/perform private\.save_deal\(/);
      } else expect(sql, table).toMatch(new RegExp(`public\\.${table}\\b`));
      expect(
        declared.written.filter((column) => declared.automatic.includes(column)),
        table,
      ).toEqual([]);
    }
  });

  it('o seed não é servido pelo navegador: nenhum arquivo do app ou de public/ o cita', () => {
    const offenders = [];
    const walk = (directory) => {
      for (const entry of readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) walk(relative);
        else if (/seed-demo/.test(entry.name) || /seed-demo/.test(readFileSync(path.join(ROOT, relative), 'latin1')))
          offenders.push(relative);
      }
    };
    walk('src');
    walk('public');
    expect(offenders).toEqual([]);
  });
});
