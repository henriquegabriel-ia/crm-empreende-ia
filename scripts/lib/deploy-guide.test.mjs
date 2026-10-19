// Item 1.4 (docs/arquitetura/1.4.md, seções 4, 5 e 9): o guia de implantação, o roteiro do ensaio e o índice que ficou
// no lugar do guia provisório. Reprova: um documento vivo apontando para o índice antigo (só as notas históricas do
// roteiro e os desenhos continuam nele), o índice voltando a ter conteúdo, uma etapa do guia fora de ordem ou faltando,
// um guia existente que o guia novo deixou de apontar e o ensaio sem os três marcos da Saída da F1 ou sem o formulário.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './embedded-db.mjs';

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const OLD_GUIDE = ['PUBLICACAO', 'CRM.md'].join('-');
const GUIDE = 'docs/IMPLANTACAO.md';
const REHEARSAL = 'docs/ENSAIO-IMPLANTACAO.md';
const THIS_FILE = 'scripts/lib/deploy-guide.test.mjs';
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-e2e',
  'dist-perf',
  'test-results',
  'playwright-report',
]);

function filesUnder(dir, accept) {
  const found = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (SKIPPED_DIRS.has(name)) continue;
    const relative = dir ? `${dir}/${name}` : name;
    if (statSync(path.join(ROOT, relative)).isDirectory()) found.push(...filesUnder(relative, accept));
    else if (accept(relative)) found.push(relative);
  }
  return found;
}

/**
 * Os documentos vivos (AC-3): README, AGENTS.md, CLAUDE.md, DESIGN.md, docs/ (fora o roteiro, os desenhos e o próprio
 * índice), supabase/ e scripts/. As notas "Feito em" do roteiro e os desenhos registram o passado e ficam como estão.
 */
const LIVING = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'DESIGN.md',
  ...filesUnder(
    'docs',
    (file) =>
      file.endsWith('.md') &&
      file !== 'docs/ROADMAP-FINALIZACAO.md' &&
      file !== `docs/${OLD_GUIDE}` &&
      !file.startsWith('docs/arquitetura/'),
  ),
  ...filesUnder('supabase', (file) => /\.(md|sql|toml|example)$/.test(file) || file.endsWith('.env.example')),
  ...filesUnder('scripts', (file) => /\.(mjs|mts|md)$/.test(file) && file !== THIS_FILE),
];

/** As etapas do guia, na ordem da seção 4.2 do desenho. */
const STEPS = [
  '## 0. Antes de começar',
  '## 1. O código da empresa',
  '## 2. Escolha o plano',
  '## 3. Crie o projeto Supabase',
  '## 4. Crie o banco (migrações)',
  '## 5. Confira o banco',
  '## 6. Marca (opcional, antes de publicar)',
  '## 7. Publique na Vercel',
  '## 8. E-mail da instância (SMTP)',
  '## 9. Acesso e modelos de e-mail',
  '## 10. Confira a URL publicada',
  '## 11. Primeiro dono, logo depois de publicar',
  '## 12. Equipe',
  '## 13. Dados de demonstração (opcional, só aula e beta)',
  '## 14. Backup, LGPD, personalizar e atualizar',
  '## Checklist',
  '## Solução de problemas',
  '## Apêndice A. Referência técnica',
];
/** Os 13 títulos do guia provisório, mantidos no índice para os links antigos (com ou sem âncora) continuarem valendo. */
const OLD_HEADINGS = [
  'Artefato preparado',
  'Cabeçalhos de segurança',
  'Configuração do projeto de hospedagem',
  'Marca',
  'Acesso e e-mails',
  'Primeiro dono e convites',
  'Canais',
  'Privacidade e LGPD',
  'Catálogo e itens da oportunidade',
  'Dados de demonstração (instâncias de aula e beta)',
  'Plano do Supabase e backup',
  'Personalizar e atualizar',
  'Aceite na URL escolhida',
];

/** As seções do índice: o título e o texto até o título seguinte. */
const sectionsOf = (text) =>
  text
    .split(/^#{2,3} /m)
    .slice(1)
    .map((block) => {
      const [title, ...body] = block.split('\n');
      return { title: title.trim(), body: body.join('\n').trim() };
    });

/**
 * Os problemas do índice (AC-3): os 13 títulos antigos na ordem, cada um com um link para o guia novo e no máximo duas
 * frases, sem bloco de código nem a palavra "Provisório". A mesma função confere o arquivo real e as mutações.
 */
function indexProblems(text) {
  const problems = [];
  if (/Provisório/i.test(text)) problems.push('o índice ainda se diz provisório');
  if (text.includes('```')) problems.push('o índice tem bloco de código');
  const sections = sectionsOf(text);
  const titles = sections.map((section) => section.title);
  if (titles.join('|') !== OLD_HEADINGS.join('|'))
    problems.push(`os títulos do índice não são os 13 do guia provisório, na ordem: ${titles.join(', ')}`);
  for (const { title, body } of sections) {
    if (!body.includes('](IMPLANTACAO.md#')) problems.push(`${title}: sem link para o guia novo`);
    const sentences = body.split(/[.!?](?:\s|$)/).filter((sentence) => sentence.trim()).length;
    if (sentences > 2) problems.push(`${title}: ${sentences} frases, e o índice só redireciona (no máximo duas)`);
  }
  return problems;
}

describe('o índice que substituiu o guia provisório (item 1.4)', () => {
  it('nenhum documento vivo aponta para o índice antigo', () => {
    expect(LIVING.length).toBeGreaterThan(40);
    expect(LIVING.filter((file) => read(file).includes(OLD_GUIDE))).toEqual([]);
  });

  it('o índice mantém os 13 títulos, cada um com no máximo duas frases e um link para o guia novo', () => {
    expect(sectionsOf(read(`docs/${OLD_GUIDE}`))).toHaveLength(13);
    expect(indexProblems(read(`docs/${OLD_GUIDE}`))).toEqual([]);
  });

  it('a conferência do índice reprova um parágrafo novo de conteúdo, um link perdido e um título trocado', () => {
    const text = read(`docs/${OLD_GUIDE}`);
    const withParagraph = text.replace(
      '## Canais\n',
      '## Canais\n\nO CRM abre o WhatsApp por link. Nada é enviado pelo CRM. A integração é por link.\n',
    );
    expect(indexProblems(withParagraph)).toEqual([
      expect.stringMatching(/^Canais: \d+ frases, e o índice só redireciona/),
    ]);
    const canais = sectionsOf(text).find((section) => section.title === 'Canais');
    expect(indexProblems(text.replace(canais.body, 'Veja o guia novo.'))).toEqual([
      'Canais: sem link para o guia novo',
    ]);
    expect(indexProblems(text.replace('## Canais\n', '## Canais de venda\n')).join()).toContain(
      'os títulos do índice não são os 13',
    );
  });
});

describe('o guia de implantação (item 1.4)', () => {
  const guide = read(GUIDE);

  it('tem as etapas na ordem, do antes de começar ao apêndice', () => {
    const positions = STEPS.map((heading) => guide.split('\n').indexOf(heading));
    expect(STEPS.filter((_, index) => positions[index] === -1)).toEqual([]);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const appendix of ['### A.1 ', '### A.2 ', '### A.3 ', '### A.4 ', '### A.9 '])
      expect(guide).toContain(`\n${appendix}`);
  });

  it('cita as duas conferências, os comandos do Auth e os guias que já existem, em vez de repeti-los', () => {
    for (const cited of [
      'supabase/instance-check.sql',
      'npm run verify-instance',
      'npm run config:check',
      'npm run config:push',
      'RECUPERAR-ACESSO-DONO.md',
      'BACKUP-RESTAURACAO.md',
      'MARCA.md',
      'LGPD-INSTANCIA.md',
      'PERSONALIZAR/README.md',
      'AGENTS.md',
      'supabase/seed-demo.sql',
      'supabase/seed-demo-remove.sql',
      'supabase/db-drift-check.sql',
      'supabase/templates/README.md#aplicar-no-painel',
    ])
      expect(guide, cited).toContain(cited);
  });

  it('traz o Windows primeiro, o Prompt de Comando, o macOS, o Hobby, o Gmail com senha de app e o Free × Pro', () => {
    expect(guide).toContain('Prompt de Comando');
    expect(guide).toContain('npm.cmd');
    expect(guide).toMatch(/\*\*macOS:\*\*/);
    expect(guide.indexOf('Prompt de Comando')).toBeLessThan(guide.indexOf('**macOS:**'));
    expect(guide).toContain('O plano Hobby da Vercel é só para uso pessoal e não comercial');
    expect(guide).toContain('Gmail com senha de app');
    expect(guide).toContain('smtp.gmail.com');
    expect(guide).toContain('BACKUP-RESTAURACAO.md#1-qual-plano-escolher');
    expect(guide).toContain('Nunca desligue a confirmação de e-mail');
    expect(guide).toContain('Nunca rode `npx supabase config push` direto');
    expect(guide).toContain('### Outra pessoa virou Dono');
    expect(guide).toContain(
      'drop function private.discard_unproven_password(), private.record_email_proof(), private.refuse_email_change_without_org() cascade',
    );
  });

  it('a conferência do banco aponta para a seção do guia citada nas linhas dela', () => {
    const check = read('supabase/instance-check.sql');
    expect(check).toContain('"Outra pessoa virou Dono"');
    expect(check).toContain('etapa 10 do guia');
    expect(guide).toContain('## 10. Confira a URL publicada');
  });
});

describe('o roteiro do ensaio (item 1.4)', () => {
  const rehearsal = read(REHEARSAL);

  it('tem os três marcos da Saída da F1, nos dois sistemas, com o verify-instance', () => {
    for (const milestone of ['**Primeiro login do dono.**', '**Convite aceito.**', '**Senha recuperada.**'])
      expect(rehearsal).toContain(milestone);
    expect(rehearsal).toContain('Windows 11');
    expect(rehearsal).toContain('macOS');
    expect(rehearsal).toContain('nos dois sistemas');
    expect(rehearsal).toContain('npm run verify-instance');
  });

  it('cobre cada etapa do guia e as pendências de ensaio dos outros itens', () => {
    // Uma linha por etapa, com o link para a seção dela no guia (0 a 14).
    for (let step = 0; step <= 14; step += 1) expect(rehearsal, String(step)).toContain(`(IMPLANTACAO.md#${step}-`);
    for (const item of [
      '1.1',
      '1.2',
      '1.3',
      '1.5',
      '1.6',
      '1.8',
      '1.9',
      '1.11',
      '1.12',
      '1.13',
      '1.14',
      '1.15',
      '1.16',
    ])
      expect(rehearsal, item).toMatch(new RegExp(`(\\| |, )${item.replace('.', '\\.')}[ ,|]`));
  });

  it('traz o formulário de dificuldades, em tabela e em CSV, com os nove campos e as três gravidades', () => {
    const fields = [
      'Nº',
      'Data e sistema',
      'Etapa do guia',
      'Tempo na etapa',
      'O que a pessoa esperava',
      'O que aconteceu',
      'Como saiu',
      'Gravidade',
      'Sugestão',
    ];
    expect(rehearsal).toContain(`| ${fields.join(' | ')} |`);
    expect(rehearsal).toContain(
      'numero,data_e_sistema,etapa_do_guia,tempo_minutos,o_que_esperava,o_que_aconteceu,como_saiu,gravidade,sugestao',
    );
    for (const level of ['bloqueia', 'atrasa', 'incomoda']) expect(rehearsal).toContain(level);
    // O modelo vem vazio: nenhuma linha preenchida na tabela nem no CSV (o exemplo fica no texto, marcado "Exemplo:").
    const table = rehearsal
      .slice(rehearsal.indexOf(`| ${fields.join(' | ')} |`))
      .split('\n\n')[0]
      .split('\n');
    expect(table.slice(2).every((line) => /^\|(\s*\|)+$/.test(line))).toBe(true);
    expect(rehearsal).not.toMatch(/^\d+,"/m);
    expect(rehearsal).toContain('Exemplo:');
  });
});
