/**
 * Dados de demonstração do CRM (item 1.15 do roteiro; docs/arquitetura/1.15.md). Gera `supabase/seed-demo.sql`, que
 * enche uma instância vazia com dados fictícios para aulas e para o beta, e `supabase/seed-demo-remove.sql`, que os
 * apaga depois. Os dois arquivos são gerados por `npm run seed:demo` e conferidos por `npm run seed:demo:check`, pelo
 * Vitest (demo-seed.test.mjs) e pelo `test:db`, que roda os dois numa instância migrada.
 *
 * A base é o gerador do item 0.10 (scripts/lib/volume-data.mjs), com quantidades menores e outra semente, mais um
 * conjunto fixo de registros que mostra o que a F1 entregou: o segundo funil, o catálogo com um item mensal e um
 * arquivado, oportunidades com itens (gravadas por private.save_deal), ligações com resultado, WhatsApp, e-mail, visita,
 * um contato "Não contatar", bases legais diferentes com um consentimento registrado, um contato anonimizado (pela
 * função privada), uma atividade vencida e uma do dia para o lembrete do menu, automações (com uma movimentação que
 * dispara uma delas), modelos com variáveis e recebimentos.
 *
 * Nada é dado real: nomes combinados de listas fixas, e-mails e sites em example.test (domínio reservado) e telefones
 * celulares no formato "+55 DDD 9 0000-NNNN". O Brasil não tem faixa reservada para ficção; os celulares antigos de oito
 * dígitos nunca começaram com 0, então "9 0000" não corresponde a um número herdado, e os zeros deixam claro que o
 * número é de exemplo. Telefones fixos ficam de fora: todo fixo válido (2 a 5) pode existir.
 *
 * As datas são relativas ao momento da execução: o gerador usa o instante de referência VOLUME_NOW, e cada data vira um
 * deslocamento em segundos (ou em dias, para as colunas `date`) somado ao now() do banco. As contas vêm da instância:
 * os responsáveis são "vagas" (0, 1, 2…) que o SQL troca pelas pessoas ativas da empresa (Dono primeiro, depois
 * administradores e colaboradores), em rodízio; com só o Dono, tudo fica com ele. O seed não cria contas no Auth
 * (admissão do item 1.1): a empresa e o Dono já existem, pelo primeiro cadastro.
 *
 * JavaScript puro (ESM, sem dependências), como o gerador do 0.10.
 */
import { createRandom, generateVolumeData, VOLUME_NOW } from './volume-data.mjs';

export const DEMO_SEED = 20261015;
/** Quantidades tiradas do gerador do 0.10; o conjunto fixo vem por cima. */
export const DEMO_VOLUME_COUNTS = Object.freeze({ companies: 16, contacts: 48, deals: 32, activities: 100 });
export const SEED_FILE = 'supabase/seed-demo.sql';
export const REMOVE_FILE = 'supabase/seed-demo-remove.sql';
/** Fuso do "fim do dia" da atividade do dia (o lembrete do 1.12 usa o dia local de quem abre o CRM). */
export const DEMO_TIME_ZONE = 'America/Sao_Paulo';

const DAY_SECONDS = 86_400;
const HOUR_SECONDS = 3_600;
const REFERENCE = Date.parse(VOLUME_NOW);
const REFERENCE_DAY = Date.parse(VOLUME_NOW.slice(0, 10));

/** Como o slug do gerador do 0.10 (e-mail sem acento), para o e-mail de quem troca de sobrenome. */
function slug(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Vagas das etapas: as do funil padrão da empresa (pela ordem, em rodízio) e as do funil "Parcerias", criado aqui.
const DEFAULT_STAGE_SLOTS = 4;
const PARTNER_STAGES = [
  { name: 'Primeiro contato', order: 0, win_probability: 20 },
  { name: 'Proposta enviada', order: 1, win_probability: 50 },
  { name: 'Contrato', order: 2, win_probability: 85 },
];
// Rótulos da origem (src/lib/lead-source.ts); "importação" do gerador vira "Feira", fora da lista, para a aula do
// filtro "Outras origens" (item 1.14).
const SOURCE_LABELS = {
  whatsapp: 'WhatsApp',
  telefone: 'Telefone',
  'e-mail': 'E-mail',
  site: 'Site',
  indicação: 'Indicação',
  importação: 'Feira',
};
const LEGAL_BASES = ['legitimate_interest', 'contract', 'not_informed', 'legitimate_interest', 'contract'];
const CONSENT_NOTE = 'Marcou a caixa de consentimento no formulário do site para receber contato comercial.';
const OUTCOMES = ['answered', 'no_answer', 'voicemail'];
const BODIES = {
  task: 'Combinar o próximo passo com o cliente.',
  call: 'Conversa sobre prazos e orçamento.',
  email: 'Material enviado com o resumo da proposta.',
  meeting: 'Pauta: necessidades, prazos e próximos passos.',
  note: 'Cliente pediu para retomar a conversa no mês que vem.',
  whatsapp: 'Mensagem com o link da proposta.',
  visit: 'Visita ao escritório do cliente para conhecer a equipe.',
};
// O gerador do 0.10 sorteia nome e cargo sem olhar o gênero, e repete nomes. Aqui o cargo concorda com o primeiro nome
// (os femininos das listas do 0.10) e um nome repetido troca de sobrenome, para a busca e a fila da aula não confundirem.
const FEMININE_NAMES = new Set([
  'Ana',
  'Camila',
  'Eduarda',
  'Gabriela',
  'Isabela',
  'Larissa',
  'Natália',
  'Patrícia',
  'Sofia',
  'Valéria',
  'Yasmin',
  'Beatriz',
  'Débora',
  'Fernanda',
  'Helena',
]);
const TITLE_FORMS = {
  'Diretora comercial': { feminine: 'Diretora comercial', masculine: 'Diretor comercial' },
  Sócio: { feminine: 'Sócia', masculine: 'Sócio' },
  Coordenadora: { feminine: 'Coordenadora', masculine: 'Coordenador' },
};
const SPARE_LAST_NAMES = [
  'Amaral',
  'Bittencourt',
  'Campos',
  'Duarte',
  'Fonseca',
  'Macedo',
  'Neves',
  'Pacheco',
  'Rezende',
];
const WHATSAPP_TITLES = ['Mandar a proposta pelo WhatsApp', 'Confirmar a reunião pelo WhatsApp', 'Enviar o contrato'];
const VISIT_TITLES = ['Visita técnica', 'Visita de apresentação', 'Visita para assinatura'];

/** Classificação de cada tabela de `public` para o teste de defasagem (test:db e Vitest): toda tabela nova reprova. */
export const DEMO_SCHEMA = Object.freeze({
  activities: {
    written: [
      'id',
      'org_id',
      'type',
      'title',
      'body',
      'contact_id',
      'company_id',
      'deal_id',
      'user_id',
      'due_date',
      'end_date',
      'completed_at',
      'outcome',
      'created_at',
      'updated_at',
    ],
    automatic: ['created_by'],
  },
  audit_logs: { skipped: 'escrita só pelo gatilho de auditoria (as linhas do seed nascem com a data da execução)' },
  automation_logs: { skipped: 'gravada pelo gatilho das automações, na movimentação de demonstração' },
  automations: {
    written: ['id', 'org_id', 'name', 'trigger_type', 'pipeline_id', 'stage_id', 'is_active', 'task_title', 'due_days'],
    automatic: ['created_by', 'created_at', 'updated_at'],
  },
  companies: {
    written: [
      'id',
      'org_id',
      'name',
      'domain',
      'industry',
      'size',
      'revenue',
      'website',
      'owner_id',
      'phone',
      'created_at',
      'updated_at',
    ],
    automatic: ['linkedin_url', 'do_not_contact', 'do_not_contact_at', 'do_not_contact_by', 'do_not_contact_reason'],
  },
  contacts: {
    written: [
      'id',
      'org_id',
      'first_name',
      'last_name',
      'email',
      'phone',
      'company_id',
      'owner_id',
      'status',
      'job_title',
      'source',
      'notes',
      'legal_basis',
      'legal_basis_note',
      'legal_basis_at',
      'do_not_contact',
      'do_not_contact_reason',
      'do_not_contact_at',
      'created_at',
      'updated_at',
    ],
    automatic: ['legal_basis_by', 'do_not_contact_by', 'anonymized_at', 'anonymized_by'],
  },
  deal_items: {
    written: [
      'id',
      'product_id',
      'name',
      'quantity',
      'unit',
      'unit_price',
      'discount_type',
      'discount_value',
      'billing',
    ],
    automatic: ['org_id', 'deal_id', 'position', 'line_total', 'created_at', 'updated_at'],
  },
  deal_stage_history: {
    written: ['created_at'],
    automatic: ['id', 'org_id', 'deal_id', 'from_stage_id', 'to_stage_id', 'from_status', 'to_status', 'changed_by'],
  },
  deals: {
    written: [
      'id',
      'org_id',
      'pipeline_id',
      'stage_id',
      'title',
      'value',
      'contact_id',
      'company_id',
      'owner_id',
      'close_date',
      'probability',
      'status',
      'lost_reason',
      'closed_at',
      'stage_entered_at',
      'contract_months',
      'created_at',
      'updated_at',
    ],
    automatic: ['currency', 'item_count', 'one_time_value', 'monthly_value'],
  },
  email_templates: {
    written: ['id', 'org_id', 'name', 'subject', 'body'],
    automatic: ['created_at', 'updated_at'],
  },
  integration_configs: { skipped: 'configuração das integrações, feita na tela' },
  invitations: { skipped: 'o seed não cria contas nem convites (admissão do item 1.1)' },
  onboarding_progress: { skipped: 'preferência de cada pessoa' },
  organizations: { skipped: 'a empresa já existe: nasce no primeiro cadastro' },
  payments: {
    written: [
      'id',
      'org_id',
      'description',
      'amount',
      'status',
      'contact_id',
      'company_id',
      'deal_id',
      'due_date',
      'paid_at',
      'created_at',
      'updated_at',
    ],
    automatic: ['currency'],
  },
  pipeline_stages: {
    written: ['id', 'org_id', 'pipeline_id', 'name', 'order', 'win_probability'],
    automatic: ['color', 'created_at', 'updated_at'],
  },
  pipelines: { written: ['id', 'org_id', 'name', 'is_default'], automatic: ['currency', 'created_at', 'updated_at'] },
  portfolio_transfers: { skipped: 'passagem de carteira do item 1.2: a demonstração não desativa ninguém' },
  privacy_actions: { skipped: 'gravada pela anonimização de demonstração' },
  products: {
    written: [
      'id',
      'org_id',
      'name',
      'code',
      'kind',
      'unit',
      'price',
      'billing',
      'archived_at',
      'created_at',
      'updated_at',
    ],
    automatic: [],
  },
  profiles: { skipped: 'contas do Auth: o seed não cria contas' },
  risk_rules: { skipped: 'provisionadas com a empresa' },
  user_roles: { skipped: 'papéis da equipe: o seed não cria contas' },
});

const seconds = (iso) => Math.round((Date.parse(iso) - REFERENCE) / 1000);
const days = (date) => Math.round((Date.parse(date) - REFERENCE_DAY) / (DAY_SECONDS * 1000));
const slotOf = (owner) => (owner === null || owner === undefined ? null : Number(owner));
const stageRef = (id) => {
  const [pipeline, index] = id.split(':');
  return { pipeline, index: Number(index) };
};

/** O conjunto de dados, com vagas no lugar das pessoas e das etapas do funil padrão e datas relativas. */
export function buildDemoDataset() {
  const stageSlots = [
    ...Array.from({ length: DEFAULT_STAGE_SLOTS }, (_, index) => ({ id: `default:${index}`, pipeline_id: 'default' })),
    ...PARTNER_STAGES.map((_, index) => ({ id: `partners:${index}`, pipeline_id: 'partners' })),
  ];
  const volume = generateVolumeData({
    orgId: 'demo',
    ownerIds: ['0', '1', '2'],
    stages: stageSlots,
    seed: DEMO_SEED,
    now: VOLUME_NOW,
    counts: DEMO_VOLUME_COUNTS,
  });
  // Ids fixos do conjunto curado, de outra sequência da mesma semente.
  const random = createRandom(DEMO_SEED + 1);
  const id = () => random.uuid();
  let phoneSerial = 0;
  const phone = (original) => {
    phoneSerial += 1;
    const ddd = original ? original.slice(3, 5) : '11';
    return `+55${ddd}90000${String(phoneSerial).padStart(4, '0')}`;
  };

  const partnerPipeline = {
    id: id(),
    name: 'Parcerias',
    stages: PARTNER_STAGES.map((stage) => ({ id: id(), ...stage })),
  };

  const products = [
    ['Implantação do CRM', 'SRV-IMP', 'service', 'projeto', '3500.00', 'one_time'],
    ['Consultoria mensal', 'SRV-CON', 'service', 'mês', '1200.00', 'monthly'],
    ['Treinamento da equipe', 'SRV-TRE', 'service', 'hora', '180.00', 'one_time'],
    ['Licença por usuário', 'PRD-LIC', 'product', 'usuário', '89.90', 'monthly'],
    ['Kit de boas-vindas', 'PRD-KIT', 'product', 'unidade', '45.00', 'one_time'],
    ['Suporte estendido (descontinuado)', 'SRV-SUP', 'service', 'mês', '450.00', 'monthly'],
  ].map(([name, code, kind, unit, price, billing], index) => ({
    id: id(),
    name,
    code,
    kind,
    unit,
    price,
    billing,
    // O último sai do catálogo depois de usado numa oportunidade ganha: continua nela, arquivado.
    archived: index === 5 ? -20 * DAY_SECONDS : null,
    created: -(200 - index) * DAY_SECONDS,
  }));
  const product = Object.fromEntries(products.map((row) => [row.code, row]));

  const companies = volume.companies.map((row) => ({
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    size: row.size,
    revenue: row.revenue === null ? null : row.revenue.toFixed(2),
    website: row.website,
    owner: slotOf(row.owner_id),
    phone: phone(row.phone),
    created: seconds(row.created_at),
    updated: seconds(row.updated_at),
  }));

  // Os curados (abaixo) entram primeiro na lista de nomes usados.
  const usedNames = new Set(['Otávio Queiroz', 'Larissa Freitas', 'Igor Teixeira']);
  const renamed = new Map();
  const contacts = volume.contacts.map((row, index) => {
    let lastName = row.last_name;
    for (let spare = 0; usedNames.has(`${row.first_name} ${lastName}`); spare += 1) {
      if (spare >= SPARE_LAST_NAMES.length) throw new Error(`Sem sobrenome livre para ${row.first_name}.`);
      lastName = SPARE_LAST_NAMES[spare];
    }
    usedNames.add(`${row.first_name} ${lastName}`);
    if (lastName !== row.last_name)
      renamed.set(row.id, { from: `${row.first_name} ${row.last_name}`, to: `${row.first_name} ${lastName}` });
    const forms = TITLE_FORMS[row.job_title];
    const legal = index % 11 === 5 ? 'consent' : LEGAL_BASES[index % LEGAL_BASES.length];
    return {
      id: row.id,
      first_name: row.first_name,
      last_name: lastName,
      email:
        lastName === row.last_name ? row.email : `${slug(row.first_name)}.${slug(lastName)}.${index + 1}@example.test`,
      phone: row.phone ? phone(row.phone) : null,
      company_id: row.company_id,
      owner: slotOf(row.owner_id),
      status: row.status,
      job_title: forms ? forms[FEMININE_NAMES.has(row.first_name) ? 'feminine' : 'masculine'] : row.job_title,
      source: row.source ? SOURCE_LABELS[row.source] : null,
      notes: index % 9 === 4 ? 'Prefere contato pelo WhatsApp no fim da tarde.' : null,
      legal_basis: legal,
      legal_basis_note: legal === 'consent' ? CONSENT_NOTE : null,
      do_not_contact: false,
      do_not_contact_reason: null,
      created: seconds(row.created_at),
      updated: seconds(row.updated_at),
    };
  });
  // Contatos curados: quem pediu "Não contatar", quem consentiu e quem vai ser anonimizado.
  const curatedCompany = companies[0].id;
  const doNotContact = {
    id: id(),
    first_name: 'Otávio',
    last_name: 'Queiroz',
    email: 'otavio.queiroz.demo@example.test',
    phone: phone('+5541'),
    company_id: curatedCompany,
    owner: 0,
    status: 'churned',
    job_title: 'Gerente de compras',
    source: 'Telefone',
    notes: 'Ex-cliente. Pediu para não receber mais ofertas.',
    legal_basis: 'legitimate_interest',
    legal_basis_note: null,
    do_not_contact: true,
    do_not_contact_reason: 'Pediu por telefone para não receber mais ofertas.',
    created: -300 * DAY_SECONDS,
    updated: -12 * DAY_SECONDS,
  };
  const consented = {
    id: id(),
    first_name: 'Larissa',
    last_name: 'Freitas',
    email: 'larissa.freitas.demo@example.test',
    phone: phone('+5511'),
    company_id: companies[1].id,
    owner: 1,
    status: 'prospect',
    job_title: 'Coordenadora',
    source: 'Site',
    notes: null,
    legal_basis: 'consent',
    legal_basis_note: 'Pediu um orçamento pelo formulário do site e aceitou receber contato comercial.',
    do_not_contact: false,
    do_not_contact_reason: null,
    created: -40 * DAY_SECONDS,
    updated: -3 * DAY_SECONDS,
  };
  const anonymized = {
    id: id(),
    first_name: 'Igor',
    last_name: 'Teixeira',
    email: 'igor.teixeira.demo@example.test',
    phone: phone('+5531'),
    company_id: null,
    owner: 0,
    status: 'lead',
    job_title: 'Analista',
    source: 'Feira',
    notes: 'Conheceu a empresa no estande da feira.',
    legal_basis: 'legitimate_interest',
    legal_basis_note: null,
    do_not_contact: false,
    do_not_contact_reason: null,
    created: -90 * DAY_SECONDS,
    updated: -30 * DAY_SECONDS,
  };
  contacts.push(doNotContact, consented, anonymized);

  // Oportunidades: o gerador, com as do conjunto de itens escolhidas pela situação, e o resto com o valor digitado.
  const deals = volume.deals.map((row) => ({
    id: row.id,
    stage: stageRef(row.stage_id),
    // O título do gerador cita o nome do contato: acompanha a troca de sobrenome.
    title: renamed.has(row.contact_id)
      ? row.title.replace(renamed.get(row.contact_id).from, renamed.get(row.contact_id).to)
      : row.title,
    value: row.value.toFixed(2),
    contact_id: row.contact_id,
    company_id: row.company_id,
    owner: slotOf(row.owner_id),
    close_date: row.close_date === null ? null : days(row.close_date),
    probability: row.probability,
    status: row.status,
    lost_reason: row.lost_reason,
    closed: row.closed_at === null ? null : seconds(row.closed_at),
    entered: seconds(row.stage_entered_at),
    created: seconds(row.created_at),
    updated: seconds(row.updated_at),
    items: null,
    contract_months: null,
  }));
  const item = (code, quantity, extra = {}) => ({
    id: id(),
    product_id: product[code].id,
    name: product[code].name,
    quantity,
    unit: product[code].unit,
    unit_price: product[code].price,
    billing: product[code].billing,
    ...extra,
  });
  const loose = (name, quantity, unitPrice, unit) => ({
    id: id(),
    product_id: null,
    name,
    quantity,
    unit,
    unit_price: unitPrice,
    billing: 'one_time',
  });
  const plans = {
    won: [
      { months: 12, items: () => [item('SRV-IMP', '1.000'), item('SRV-CON', '1.000')] },
      {
        months: 6,
        items: () => [
          item('PRD-LIC', '10.000', { discount_type: 'percent', discount_value: '10.00' }),
          item('SRV-TRE', '8.000'),
        ],
      },
      {
        months: 12,
        items: () => [
          item('SRV-IMP', '1.000', { discount_type: 'amount', discount_value: '500.00' }),
          item('SRV-SUP', '1.000'),
        ],
      },
    ],
    open: [
      { months: 12, items: () => [item('SRV-CON', '1.000'), item('SRV-TRE', '4.000')] },
      {
        months: null,
        items: () => [loose('Integração com o site', '1.000', '2400.00', 'projeto'), item('PRD-KIT', '20.000')],
      },
      { months: 24, items: () => [item('PRD-LIC', '25.000'), item('SRV-IMP', '1.000')] },
    ],
    lost: [{ months: null, items: () => [item('SRV-IMP', '1.000'), item('SRV-TRE', '10.000')] }],
  };
  for (const [status, list] of Object.entries(plans)) {
    const candidates = deals.filter((deal) => deal.status === status && deal.owner !== null);
    list.forEach((plan, index) => {
      const deal = candidates[index];
      if (!deal)
        throw new Error(`O gerador não deu oportunidades ${status} suficientes para os itens de demonstração.`);
      deal.items = plan.items();
      deal.contract_months = plan.months;
    });
  }
  // A movimentação que dispara a automação "Preparar a proposta": uma aberta, sem itens, de outra etapa do funil padrão.
  const proposalStage = { pipeline: 'default', index: 2 };
  const moved = deals.find(
    (deal) =>
      deal.status === 'open' &&
      !deal.items &&
      deal.stage.pipeline === 'default' &&
      deal.stage.index !== proposalStage.index &&
      deal.owner !== null,
  );

  if (!moved) throw new Error('O gerador não deu uma oportunidade aberta para a movimentação de demonstração.');
  const established = volume.contacts.filter((_, index) => index % 10 > 3);
  const activities = volume.activities.map((row, index) => {
    let type = row.type;
    let title = row.title;
    let end = row.end_date === null ? null : seconds(row.end_date);
    if (type === 'task' && index % 10 === 3) {
      type = 'whatsapp';
      title = WHATSAPP_TITLES[index % WHATSAPP_TITLES.length];
    } else if (type === 'meeting' && index % 10 === 7) {
      type = 'visit';
      title = VISIT_TITLES[index % VISIT_TITLES.length];
    }
    const completed = row.completed_at === null ? null : seconds(row.completed_at);
    return {
      id: row.id,
      type,
      title,
      body: row.body === null ? null : BODIES[type],
      contact_id: row.contact_id,
      company_id: row.company_id,
      deal_id: row.deal_id,
      user: slotOf(row.user_id),
      due: row.due_date === null ? null : seconds(row.due_date),
      due_today: false,
      end,
      completed,
      outcome: type === 'call' && completed !== null ? OUTCOMES[index % OUTCOMES.length] : null,
      created: seconds(row.created_at),
      updated: seconds(row.updated_at),
    };
  });
  // Atividades curadas: a vencida e a do dia do Dono (o lembrete do menu, item 1.12), uma visita e uma reunião
  // pendentes, o histórico de quem pediu "Não contatar", de quem consentiu e de quem vai ser anonimizado.
  const person = established[0];
  const curated = (fields) => ({
    id: id(),
    body: null,
    contact_id: null,
    company_id: null,
    deal_id: null,
    user: 0,
    due: null,
    due_today: false,
    end: null,
    completed: null,
    outcome: null,
    created: -2 * DAY_SECONDS,
    updated: -2 * DAY_SECONDS,
    ...fields,
  });
  const ownDeal = deals.find((deal) => deal.status === 'open' && deal.contact_id === person.id) ?? null;
  activities.push(
    curated({
      type: 'call',
      title: 'Retornar a ligação sobre a proposta',
      body: 'Ficou de responder até hoje de manhã.',
      contact_id: person.id,
      company_id: person.company_id,
      deal_id: ownDeal?.id ?? null,
      due: -3 * HOUR_SECONDS,
    }),
    curated({
      type: 'whatsapp',
      title: 'Enviar a proposta pelo WhatsApp',
      body: BODIES.whatsapp,
      contact_id: person.id,
      company_id: person.company_id,
      due_today: true,
    }),
    curated({
      type: 'visit',
      title: 'Visita para apresentar a equipe de implantação',
      contact_id: established[1].id,
      company_id: established[1].company_id,
      due: 5 * DAY_SECONDS + 2 * HOUR_SECONDS,
      end: 5 * DAY_SECONDS + 4 * HOUR_SECONDS,
    }),
    curated({
      type: 'meeting',
      title: 'Reunião de alinhamento do contrato',
      contact_id: established[2].id,
      company_id: established[2].company_id,
      user: 1,
      due: DAY_SECONDS + HOUR_SECONDS,
      end: DAY_SECONDS + 2 * HOUR_SECONDS,
    }),
    curated({
      type: 'call',
      title: 'Ligação de apresentação',
      body: 'Atendeu, mas disse que não tem interesse.',
      contact_id: doNotContact.id,
      company_id: doNotContact.company_id,
      due: -13 * DAY_SECONDS,
      completed: -13 * DAY_SECONDS,
      outcome: 'answered',
      created: -14 * DAY_SECONDS,
      updated: -13 * DAY_SECONDS,
    }),
    curated({
      type: 'note',
      title: 'Pediu para não ser mais contatado',
      contact_id: doNotContact.id,
      company_id: doNotContact.company_id,
      completed: -12 * DAY_SECONDS,
      created: -12 * DAY_SECONDS,
      updated: -12 * DAY_SECONDS,
    }),
    curated({
      type: 'email',
      title: 'Enviar o orçamento pedido no site',
      contact_id: consented.id,
      company_id: consented.company_id,
      user: 1,
      due: -3 * DAY_SECONDS,
      completed: -3 * DAY_SECONDS,
      created: -4 * DAY_SECONDS,
      updated: -3 * DAY_SECONDS,
    }),
    curated({
      type: 'whatsapp',
      title: 'Conversa com Igor Teixeira sobre a feira',
      body: 'Igor pediu o catálogo.',
      contact_id: anonymized.id,
      due: -31 * DAY_SECONDS,
      completed: -31 * DAY_SECONDS,
      created: -32 * DAY_SECONDS,
      updated: -31 * DAY_SECONDS,
    }),
    // Ação pendente com quem vai ser anonimizado: a anonimização a exclui (item 1.10).
    curated({
      type: 'call',
      title: 'Ligar para o Igor',
      contact_id: anonymized.id,
      due: 2 * DAY_SECONDS,
    }),
  );

  // Recebimentos das ganhas com itens: pago, a receber, vencido e cancelado, e um avulso de uma empresa.
  const wonWithItems = deals.filter((deal) => deal.status === 'won' && deal.items);
  const payment = (deal, fields) => ({
    id: id(),
    deal_id: deal?.id ?? null,
    contact_id: deal?.contact_id ?? null,
    company_id: deal?.company_id ?? fields.company_id ?? null,
    paid: null,
    ...fields,
  });
  const payments = [
    payment(wonWithItems[0], {
      description: 'Entrada da implantação',
      amount: '3500.00',
      status: 'paid',
      due: -20,
      paid: -19 * DAY_SECONDS,
      created: -25 * DAY_SECONDS,
    }),
    payment(wonWithItems[0], {
      description: 'Mensalidade da consultoria',
      amount: '1200.00',
      status: 'pending',
      due: 10,
      created: -25 * DAY_SECONDS,
    }),
    payment(wonWithItems[1], {
      description: 'Licenças do mês',
      amount: '809.10',
      status: 'pending',
      due: -5,
      created: -35 * DAY_SECONDS,
    }),
    payment(wonWithItems[1], {
      description: 'Treinamento da equipe',
      amount: '1440.00',
      status: 'paid',
      due: -30,
      paid: -28 * DAY_SECONDS,
      created: -35 * DAY_SECONDS,
    }),
    payment(wonWithItems[2], {
      description: 'Parcela renegociada',
      amount: '1500.00',
      status: 'cancelled',
      due: -15,
      created: -45 * DAY_SECONDS,
    }),
    payment(null, {
      description: 'Diagnóstico avulso',
      amount: '650.00',
      status: 'pending',
      due: 25,
      company_id: companies[2].id,
      created: -6 * DAY_SECONDS,
    }),
  ];

  const automations = [
    {
      id: id(),
      name: 'Primeira ligação do negócio novo',
      trigger_type: 'deal_created',
      stage: null,
      is_active: true,
      task_title: 'Fazer a primeira ligação',
      due_days: 1,
    },
    {
      id: id(),
      name: 'Preparar a proposta',
      trigger_type: 'deal_moved',
      stage: proposalStage,
      is_active: true,
      task_title: 'Enviar a proposta em até 2 dias',
      due_days: 2,
    },
    {
      id: id(),
      name: 'Boas-vindas ao cliente',
      trigger_type: 'deal_won',
      stage: null,
      is_active: true,
      task_title: 'Agendar a reunião de implantação',
      due_days: 3,
    },
    {
      id: id(),
      name: 'Lembrete da negociação (pausada)',
      trigger_type: 'deal_moved',
      stage: { pipeline: 'default', index: 3 },
      is_active: false,
      task_title: 'Revisar as condições com o gestor',
      due_days: 1,
    },
  ];

  const templates = [
    {
      id: id(),
      name: 'Primeiro contato pelo WhatsApp',
      subject: '',
      body: 'Olá, {{primeiro_nome}}! Aqui é {{meu_nome}}, da {{organizacao}}. Podemos conversar sobre {{empresa}} esta semana?',
    },
    {
      id: id(),
      name: 'Envio da proposta',
      subject: 'Proposta para {{empresa}}',
      body: 'Olá, {{nome}}.\n\nSegue a proposta de {{oportunidade}}, como combinamos. Fico à disposição para tirar dúvidas.\n\n{{meu_nome}}\n{{organizacao}}',
    },
    {
      id: id(),
      name: 'Retomar a conversa',
      subject: 'Vamos retomar?',
      body: 'Oi, {{primeiro_nome}}! Passando para saber se faz sentido retomarmos a conversa sobre {{oportunidade}}.',
    },
  ];

  return {
    partnerPipeline,
    products,
    companies,
    contacts,
    deals,
    activities,
    payments,
    automations,
    templates,
    anonymize: anonymized.id,
    doNotContact: doNotContact.id,
    consented: consented.id,
    move: { deal: moved.id, stage: proposalStage },
  };
}

/**
 * O que a instância deve ter depois do seed (o test:db confere): as linhas do conjunto, menos a ação pendente que a
 * anonimização exclui, mais a tarefa da automação disparada pela movimentação de demonstração.
 */
export function demoExpectedCounts(dataset = buildDemoDataset()) {
  const deletedByAnonymization = dataset.activities.filter(
    (row) => row.contact_id === dataset.anonymize && row.completed === null && row.type !== 'note',
  ).length;
  return {
    pipelines: 1,
    pipeline_stages: dataset.partnerPipeline.stages.length,
    products: dataset.products.length,
    companies: dataset.companies.length,
    contacts: dataset.contacts.length,
    deals: dataset.deals.length,
    deal_items: dataset.deals.reduce((sum, deal) => sum + (deal.items?.length ?? 0), 0),
    activities: dataset.activities.length - deletedByAnonymization + 1,
    payments: dataset.payments.length,
    automations: dataset.automations.length,
    automation_logs: 1,
    email_templates: dataset.templates.length,
    privacy_actions: 1,
  };
}

// ---------------------------------------------------------------------------------------------
// SQL. Tudo num bloco DO: atômico, roda colado no editor SQL do painel e não deixa nada pela metade.
// ---------------------------------------------------------------------------------------------
const text = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const number = (value) => (value === null || value === undefined ? 'null' : String(value));
const bool = (value) => (value ? 'true' : 'false');
const json = (value) => `${text(JSON.stringify(value))}::jsonb`;
const values = (rows, render) => rows.map((row) => `   (${render(row).join(',')})`).join(',\n');
const ids = (rows) => `array[${rows.map((row) => text(row.id)).join(',')}]::uuid[]`;
const member = (slot) => (slot === null ? 'null::uuid' : `v_members[1+(${slot}%array_length(v_members,1))]`);
const at = (offset) => (offset === null ? 'null::timestamptz' : `v_now+make_interval(secs=>${offset})`);
const day = (offset) => (offset === null ? 'null::date' : `v_today+${offset}`);
const pipelineOf = (dataset, ref) =>
  ref.pipeline === 'default' ? 'v_pipeline' : `${text(dataset.partnerPipeline.id)}::uuid`;
const stageOf = (dataset, ref) =>
  ref.pipeline === 'default'
    ? `v_stages[1+(${ref.index}%array_length(v_stages,1))]`
    : `${text(dataset.partnerPipeline.stages[ref.index].id)}::uuid`;

const HEADER = `-- Dados de demonstração do CRM (item 1.15 do roteiro; docs/arquitetura/1.15.md).
-- ARQUIVO GERADO por \`npm run seed:demo\` a partir de scripts/lib/demo-seed.mjs: não edite à mão.
--
-- Para que serve: encher um CRM vazio com dados fictícios (empresas, contatos, oportunidades com itens do catálogo,
-- atividades de WhatsApp, e-mail, ligação e visita, recebimentos, automações e modelos) para aulas e para o beta.
-- Nada é dado real: e-mails e sites em example.test e celulares "(DDD) 90000-NNNN", que não são de ninguém conhecido.
-- Mesmo assim, não envie mensagens a esses números pelo botão "WhatsApp".
--
-- Quando NÃO usar: num CRM com dados reais ou que vai receber dados reais misturados aos de demonstração. O seed
-- recusa e não grava nada se o CRM já tiver qualquer contato, empresa, oportunidade, atividade, recebimento, item do
-- catálogo, automação ou modelo, ou se sobrou o funil "Parcerias" de uma demonstração anterior (nesse caso, rode antes
-- supabase/seed-demo-remove.sql).
--
-- Como rodar:
--   1. Publique o CRM e faça o primeiro cadastro: ele cria a empresa e o papel de Dono (o seed não cria contas).
--   2. Opcional: convide a equipe e espere os convites serem aceitos. Os dados se dividem entre as pessoas ativas
--      (Dono, administradores e colaboradores), em rodízio; com só o Dono, tudo fica com ele.
--   3. No painel do Supabase do projeto, abra "SQL Editor", "New query", cole este arquivo inteiro e clique em "Run".
--      Rode durante o dia: a atividade "do dia" vence até a meia-noite de Brasília.
--   4. O resultado é uma linha "Dados de demonstração criados" com as contagens. Atualize o CRM no navegador.
-- As datas são relativas ao momento da execução: contatos de ontem, oportunidades ganhas nos últimos meses, atividades
-- vencidas, de hoje e futuras.
--
-- Nunca rode este arquivo pelo navegador, pelo app ou pela API: ele usa funções internas do banco e só funciona no
-- editor SQL do painel (papel postgres).
--
-- Para apagar a demonstração depois: supabase/seed-demo-remove.sql, do mesmo jeito.
`;

/** O texto de `supabase/seed-demo.sql`. */
export function renderSeedSql(dataset = buildDemoDataset()) {
  const d = dataset;
  const counts = demoExpectedCounts(d);
  const lines = [];
  const push = (...parts) => lines.push(...parts);
  push(HEADER);
  push(`do $seed$
declare
 v_now timestamptz:=now();
 v_today date:=(now() at time zone '${DEMO_TIME_ZONE}')::date;
 v_end_of_day timestamptz;
 v_due_today timestamptz;
 v_org uuid;
 v_owner uuid;
 v_members uuid[];
 v_pipeline uuid;
 v_stages uuid[];
 v_existing text;
begin
 -- 1. Só no editor SQL do painel (papel postgres), nunca por uma sessão da API.
 if current_user in ('anon','authenticated','service_role') or coalesce(current_setting('request.jwt.claims',true),'')<>'' then
  raise exception 'O seed de demonstração roda só no editor SQL do painel do Supabase. Nada foi gravado.';
 end if;
 -- Duas execuções ao mesmo tempo: a segunda espera a primeira e, depois, encontra os dados e recusa.
 perform pg_advisory_xact_lock(hashtextextended('crm.demo_seed',0));

 -- 2. A empresa e o Dono que já existem (admissão do item 1.1: o seed não cria contas).
 if not exists(select 1 from public.organizations) then
  raise exception 'Este CRM ainda não tem empresa. Primeiro publique o CRM e faça o primeiro cadastro, que cria a empresa e o papel de Dono; depois rode o seed de novo. Nada foi gravado.';
 end if;
 if (select count(*) from public.organizations)>1 then
  raise exception 'Este CRM tem mais de uma empresa. O seed de demonstração é para um CRM com uma empresa só. Nada foi gravado.';
 end if;
 select o.id into v_org from public.organizations o;
 select array_agg(r.user_id order by r.role<>'owner',r.role<>'admin',p.created_at,r.user_id) into v_members
  from public.user_roles r join public.profiles p on p.id=r.user_id
  where r.org_id=v_org and r.deactivated_at is null and r.role in ('owner','admin','member');
 select r.user_id into v_owner from public.user_roles r join public.profiles p on p.id=r.user_id
  where r.org_id=v_org and r.deactivated_at is null and r.role='owner' order by p.created_at,r.user_id limit 1;
 if v_owner is null then
  raise exception 'Este CRM não tem um Dono ativo. Recupere o acesso do Dono (docs/RECUPERAR-ACESSO-DONO.md) e rode o seed de novo. Nada foi gravado.';
 end if;

 -- 3. Só numa instância vazia: nenhum registro comercial.
 select string_agg(format('%s %s',n,label),', ') into v_existing from (values
   ((select count(*) from public.contacts where org_id=v_org),'contato(s)'),
   ((select count(*) from public.companies where org_id=v_org),'empresa(s)'),
   ((select count(*) from public.deals where org_id=v_org),'oportunidade(s)'),
   ((select count(*) from public.activities where org_id=v_org),'atividade(s)'),
   ((select count(*) from public.payments where org_id=v_org),'recebimento(s)'),
   ((select count(*) from public.products where org_id=v_org),'item(ns) do catálogo'),
   ((select count(*) from public.automations where org_id=v_org),'automação(ões)'),
   ((select count(*) from public.email_templates where org_id=v_org),'modelo(s)')
  ) t(n,label) where n>0;
 if v_existing is not null then
  raise exception 'Este CRM já tem dados (%). O seed de demonstração só roda num CRM vazio, para não misturar dados fictícios com dados reais. Nada foi gravado.',v_existing;
 end if;
 -- O funil "Parcerias" de uma demonstração anterior (identificadores fixos), que sobra quando a equipe exclui todos os
 -- registros pela tela e mantém o funil: sem esta recusa, o seed falharia com o erro cru do PostgreSQL (achado 3 da
 -- revisão do item 1.15).
 if exists(select 1 from public.pipelines where id=${text(d.partnerPipeline.id)})
  or exists(select 1 from public.pipeline_stages where id=any(${ids(d.partnerPipeline.stages)})) then
  raise exception 'Sobrou o funil "Parcerias" de uma demonstração anterior (com % etapa(s)). Rode supabase/seed-demo-remove.sql antes e, depois, rode o seed de novo. Nada foi gravado.',
   (select count(*) from public.pipeline_stages where id=any(${ids(d.partnerPipeline.stages)}));
 end if;
 select p.id into v_pipeline from public.pipelines p where p.org_id=v_org order by p.is_default desc,p.created_at,p.id limit 1;
 select array_agg(s.id order by s."order",s.created_at,s.id) into v_stages from public.pipeline_stages s
  where s.org_id=v_org and s.pipeline_id=v_pipeline;
 if v_pipeline is null or coalesce(array_length(v_stages,1),0)<2 then
  raise exception 'O funil padrão precisa de pelo menos duas etapas. Confira em "Configurações", na aba "Funis", e rode o seed de novo. Nada foi gravado.';
 end if;
 v_end_of_day:=((v_today+1)::timestamp) at time zone '${DEMO_TIME_ZONE}';
 v_due_today:=v_now+(v_end_of_day-v_now)/2;

 -- 4. As gravações como o Dono: os gatilhos carimbam autor, base legal, "Não contatar" e auditoria com ele, e as
 -- funções privadas (save_deal, anonymize_contact, move_deal) conferem o papel dele.
 perform set_config('request.jwt.claims',json_build_object('sub',v_owner,'role','authenticated')::text,true);
`);

  // Funil "Parcerias".
  push(` insert into public.pipelines(id,org_id,name,is_default) values(${text(d.partnerPipeline.id)},v_org,${text(d.partnerPipeline.name)},false);
 insert into public.pipeline_stages(id,org_id,pipeline_id,name,"order",win_probability)
  select v.id::uuid,v_org,${text(d.partnerPipeline.id)}::uuid,v.name,v.ord,v.probability from (values
${values(d.partnerPipeline.stages, (row) => [text(row.id), text(row.name), number(row.order), number(row.win_probability)])}
  ) v(id,name,ord,probability);
`);

  // Catálogo (todos ativos; o arquivado sai depois de usado).
  push(` insert into public.products(id,org_id,name,code,kind,unit,price,billing)
  select v.id::uuid,v_org,v.name,v.code,v.kind,v.unit,v.price::numeric,v.billing from (values
${values(d.products, (row) => [text(row.id), text(row.name), text(row.code), text(row.kind), text(row.unit), text(row.price), text(row.billing)])}
  ) v(id,name,code,kind,unit,price,billing);
`);

  push(` insert into public.companies(id,org_id,name,domain,industry,size,revenue,website,owner_id,phone)
  select v.id::uuid,v_org,v.name,v.domain,v.industry,v.size,v.revenue::numeric,v.website,
   case when v.slot is null then null else v_members[1+(v.slot::integer%array_length(v_members,1))] end,v.phone from (values
${values(d.companies, (row) => [text(row.id), text(row.name), text(row.domain), text(row.industry), text(row.size), text(row.revenue), text(row.website), number(row.owner), text(row.phone)])}
  ) v(id,name,domain,industry,size,revenue,website,slot,phone);
`);

  push(` insert into public.contacts(id,org_id,first_name,last_name,email,phone,company_id,owner_id,status,job_title,source,notes,
  legal_basis,legal_basis_note,do_not_contact,do_not_contact_reason)
  select v.id::uuid,v_org,v.first_name,v.last_name,v.email,v.phone,v.company_id::uuid,
   case when v.slot is null then null else v_members[1+(v.slot::integer%array_length(v_members,1))] end,v.status,v.job_title,v.source,
   v.notes,v.legal_basis,v.legal_basis_note,v.do_not_contact,v.do_not_contact_reason from (values
${values(d.contacts, (row) => [text(row.id), text(row.first_name), text(row.last_name), text(row.email), text(row.phone), text(row.company_id), number(row.owner), text(row.status), text(row.job_title), text(row.source), text(row.notes), text(row.legal_basis), text(row.legal_basis_note), bool(row.do_not_contact), text(row.do_not_contact_reason)])}
  ) v(id,first_name,last_name,email,phone,company_id,slot,status,job_title,source,notes,legal_basis,legal_basis_note,
   do_not_contact,do_not_contact_reason);
`);

  // Oportunidades sem itens: inserção direta, com o valor digitado (os gatilhos de sempre passam).
  const plain = d.deals.filter((deal) => !deal.items);
  push(` insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,contact_id,company_id,owner_id,close_date,probability,
  status,lost_reason)
  select v.id::uuid,v_org,v.pipeline_id,v.stage_id,v.title,v.value::numeric,v.contact_id::uuid,v.company_id::uuid,v.owner_id,
   v.close_date,v.probability::numeric,v.status,v.lost_reason from (values
${values(plain, (row) => [text(row.id), pipelineOf(d, row.stage), stageOf(d, row.stage), text(row.title), text(row.value), text(row.contact_id), text(row.company_id), member(row.owner), day(row.close_date), number(row.probability), text(row.status), text(row.lost_reason)])}
  ) v(id,pipeline_id,stage_id,title,value,contact_id,company_id,owner_id,close_date,probability,status,lost_reason);
`);

  // Oportunidades com itens: só por private.save_deal (item 1.16), que calcula o valor do contrato.
  push(' -- Oportunidades com itens do catálogo: pela mesma função da tela, que calcula o valor do contrato.');
  for (const deal of d.deals.filter((row) => row.items)) {
    const fields = [
      `'title',${text(deal.title)}`,
      `'pipeline_id',${pipelineOf(d, deal.stage)}`,
      `'stage_id',${stageOf(d, deal.stage)}`,
      `'status',${text(deal.status)}`,
      `'owner_id',${member(deal.owner)}`,
      `'contact_id',${text(deal.contact_id)}`,
      `'company_id',${text(deal.company_id)}`,
      `'close_date',${day(deal.close_date)}`,
      `'probability',${number(deal.probability)}`,
      `'lost_reason',${text(deal.lost_reason)}`,
    ];
    push(
      ` perform private.save_deal(${text(deal.id)}::uuid,null,jsonb_build_object(${fields.join(',')}),\n  ${json(deal.items)},${number(deal.contract_months)});`,
    );
  }
  push(` update public.products set archived_at=v_now+make_interval(secs=>v.archived) from (values
${values(
  d.products.filter((row) => row.archived !== null),
  (row) => [text(row.id), number(row.archived)],
)}
  ) v(id,archived) where products.id=v.id::uuid;
`);

  push(` insert into public.activities(id,org_id,type,title,body,contact_id,company_id,deal_id,user_id,due_date,end_date,completed_at,outcome)
  select v.id::uuid,v_org,v.type,v.title,v.body,v.contact_id::uuid,v.company_id::uuid,v.deal_id::uuid,
   case when v.slot is null then null else v_members[1+(v.slot::integer%array_length(v_members,1))] end,
   case when v.due_today then v_due_today when v.due is null then null else v_now+make_interval(secs=>v.due::integer) end,
   case when v.ends is null then null else v_now+make_interval(secs=>v.ends::integer) end,
   case when v.completed is null then null else v_now+make_interval(secs=>v.completed::integer) end,v.outcome from (values
${values(d.activities, (row) => [text(row.id), text(row.type), text(row.title), text(row.body), text(row.contact_id), text(row.company_id), text(row.deal_id), number(row.user), number(row.due), bool(row.due_today), number(row.end), number(row.completed), text(row.outcome)])}
  ) v(id,type,title,body,contact_id,company_id,deal_id,slot,due,due_today,ends,completed,outcome);
`);

  push(` insert into public.payments(id,org_id,description,amount,status,contact_id,company_id,deal_id,due_date,paid_at)
  select v.id::uuid,v_org,v.description,v.amount::numeric,v.status,v.contact_id::uuid,v.company_id::uuid,v.deal_id::uuid,
   v_today+v.due::integer,case when v.paid is null then null else v_now+make_interval(secs=>v.paid::integer) end from (values
${values(d.payments, (row) => [text(row.id), text(row.description), text(row.amount), text(row.status), text(row.contact_id), text(row.company_id), text(row.deal_id), number(row.due), number(row.paid)])}
  ) v(id,description,amount,status,contact_id,company_id,deal_id,due,paid);
`);

  push(` insert into public.email_templates(id,org_id,name,subject,body)
  select v.id::uuid,v_org,v.name,v.subject,v.body from (values
${values(d.templates, (row) => [text(row.id), text(row.name), text(row.subject), text(row.body)])}
  ) v(id,name,subject,body);
`);

  push(` -- Anonimização de demonstração (item 1.10), pela função privada, como o Dono: exclui a ação pendente, limpa o texto
 -- do que ficou e grava o registro em "Segurança", "Exportações e anonimizações".
 perform private.anonymize_contact(${text(d.anonymize)}::uuid,(select c.updated_at from public.contacts c where c.id=${text(d.anonymize)}::uuid));
`);

  push(` insert into public.automations(id,org_id,name,trigger_type,pipeline_id,stage_id,is_active,task_title,due_days) values
${d.automations
  .map(
    (row) =>
      `   (${[text(row.id), 'v_org', text(row.name), text(row.trigger_type), row.stage ? pipelineOf(d, row.stage) : 'null', row.stage ? stageOf(d, row.stage) : 'null', bool(row.is_active), text(row.task_title), number(row.due_days)].join(',')})`,
  )
  .join(',\n')};
 -- A movimentação que dispara "Preparar a proposta": a tarefa nasce e o registro aparece em "Automações".
 perform public.move_deal(${text(d.move.deal)}::uuid,${stageOf(d, d.move.stage)});
`);

  // Datas relativas: os gatilhos gravaram a data da execução em created_at, stage_entered_at e closed_at. Com os
  // gatilhos de usuário desligados só nestas atualizações (as FKs e os CHECKs continuam), cada linha recebe a data
  // do conjunto. A trava da ALTER TABLE vale até o fim da transação.
  push(` -- 5. Datas relativas ao momento da execução. Os gatilhos gravaram agora em created_at, stage_entered_at e closed_at;
 -- com os gatilhos de usuário desligados só nesta etapa (FKs e CHECKs continuam valendo), cada linha recebe a sua data.
 alter table public.products disable trigger user;
 alter table public.companies disable trigger user;
 alter table public.contacts disable trigger user;
 alter table public.deals disable trigger user;
 alter table public.activities disable trigger user;
 alter table public.payments disable trigger user;
 update public.products p set created_at=v_now+make_interval(secs=>v.created),updated_at=v_now+make_interval(secs=>v.created)
  from (values
${values(d.products, (row) => [text(row.id), number(row.created)])}
  ) v(id,created) where p.id=v.id::uuid;
 update public.companies c set created_at=v_now+make_interval(secs=>v.created),updated_at=v_now+make_interval(secs=>v.updated)
  from (values
${values(d.companies, (row) => [text(row.id), number(row.created), number(row.updated)])}
  ) v(id,created,updated) where c.id=v.id::uuid;
 update public.contacts c set created_at=v_now+make_interval(secs=>v.created),legal_basis_at=v_now+make_interval(secs=>v.created),
  updated_at=case when c.anonymized_at is null then v_now+make_interval(secs=>v.updated) else c.updated_at end,
  do_not_contact_at=case when c.do_not_contact then v_now+make_interval(secs=>v.updated) end
  from (values
${values(d.contacts, (row) => [text(row.id), number(row.created), number(row.updated)])}
  ) v(id,created,updated) where c.id=v.id::uuid;
 update public.deals x set created_at=v_now+make_interval(secs=>v.created),updated_at=v_now+make_interval(secs=>v.updated),
  stage_entered_at=v_now+make_interval(secs=>v.entered),
  closed_at=case when x.status='open' then null else v_now+make_interval(secs=>v.closed::integer) end
  from (values
${values(
  d.deals.filter((row) => row.id !== d.move.deal),
  (row) => [text(row.id), number(row.created), number(row.updated), number(row.entered), number(row.closed)],
)}
  ) v(id,created,updated,entered,closed) where x.id=v.id::uuid;
 update public.deals x set created_at=v_now+make_interval(secs=>${d.deals.find((row) => row.id === d.move.deal).created})
  where x.id=${text(d.move.deal)}::uuid;
 update public.deal_stage_history h set created_at=x.created_at from public.deals x
  where h.deal_id=x.id and h.from_status is null and x.id=any(${ids(d.deals)});
 update public.activities a set created_at=v_now+make_interval(secs=>v.created),updated_at=v_now+make_interval(secs=>v.updated)
  from (values
${values(d.activities, (row) => [text(row.id), number(row.created), number(row.updated)])}
  ) v(id,created,updated) where a.id=v.id::uuid;
 update public.payments p set created_at=v_now+make_interval(secs=>v.created),updated_at=v_now+make_interval(secs=>v.created)
  from (values
${values(d.payments, (row) => [text(row.id), number(row.created)])}
  ) v(id,created) where p.id=v.id::uuid;
 alter table public.products enable trigger user;
 alter table public.companies enable trigger user;
 alter table public.contacts enable trigger user;
 alter table public.deals enable trigger user;
 alter table public.activities enable trigger user;
 alter table public.payments enable trigger user;

 perform set_config('request.jwt.claims','',true);
 raise notice 'Dados de demonstração criados: % contatos, % empresas, % oportunidades e % atividades.',${counts.contacts},${counts.companies},${counts.deals},${counts.activities};
end
$seed$;

-- Resumo, para o editor SQL mostrar o resultado.
select 'Dados de demonstração criados' as resultado,
 (select count(*) from public.contacts) as contatos,
 (select count(*) from public.companies) as empresas,
 (select count(*) from public.deals) as oportunidades,
 (select count(*) from public.activities) as atividades,
 (select count(*) from public.products) as itens_do_catalogo,
 (select count(*) from public.payments) as recebimentos;
`);
  return `${lines.join('\n')}`;
}

const REMOVE_HEADER = `-- Apaga os dados de demonstração do CRM (item 1.15 do roteiro; docs/arquitetura/1.15.md).
-- ARQUIVO GERADO por \`npm run seed:demo\` a partir de scripts/lib/demo-seed.mjs: não edite à mão.
--
-- O que apaga: só o que supabase/seed-demo.sql criou (reconhecido pelos identificadores fixos da demonstração) e o que
-- depende disso: as atividades e os recebimentos ligados a um contato, a uma empresa ou a uma oportunidade da
-- demonstração (inclusive os registrados em aula e as tarefas das automações) e os itens dessas oportunidades.
-- Contatos, empresas, oportunidades, itens do catálogo, automações e modelos criados por pessoas ficam.
--
-- Quando recusa (sem apagar nada): se um registro criado por uma pessoa aponta para a demonstração. São eles: um contato
-- ligado a uma empresa fictícia; uma oportunidade ligada a um contato, a uma empresa ou ao funil "Parcerias" da
-- demonstração; uma oportunidade que já passou por uma etapa do funil "Parcerias" (o histórico de etapas não muda, e
-- apagar o funil o quebraria); um item de oportunidade com um item do catálogo da demonstração; e uma automação com
-- filtro no funil "Parcerias" (apagar o funil a deixaria pausada e sem filtro). A mensagem diz quantos são e o que fazer
-- com cada um; depois de resolver esses registros, rode a remoção de novo.
--
-- O histórico de auditoria e o registro da anonimização de demonstração (em "Segurança", "Exportações e anonimizações")
-- ficam, como todo histórico.
--
-- Como rodar: no painel do Supabase, "SQL Editor", "New query", cole este arquivo inteiro e clique em "Run".
-- Nunca rode este arquivo pelo navegador, pelo app ou pela API.
`;

/** O texto de `supabase/seed-demo-remove.sql`. */
export function renderRemoveSql(dataset = buildDemoDataset()) {
  const d = dataset;
  return `${REMOVE_HEADER}
do $remove$
declare
 v_org uuid;
 v_owner uuid;
 v_contacts uuid[]:=${ids(d.contacts)};
 v_companies uuid[]:=${ids(d.companies)};
 v_deals uuid[]:=${ids(d.deals)};
 v_activities uuid[]:=${ids(d.activities)};
 v_payments uuid[]:=${ids(d.payments)};
 v_products uuid[]:=${ids(d.products)};
 v_automations uuid[]:=${ids(d.automations)};
 v_templates uuid[]:=${ids(d.templates)};
 v_pipeline uuid:=${text(d.partnerPipeline.id)};
 v_blocking text;
 v_removed jsonb:='{}'::jsonb;
 v_n integer;
begin
 if current_user in ('anon','authenticated','service_role') or coalesce(current_setting('request.jwt.claims',true),'')<>'' then
  raise exception 'A remoção da demonstração roda só no editor SQL do painel do Supabase. Nada foi apagado.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('crm.demo_seed',0));
 if (select count(*) from public.organizations)<>1 then
  raise exception 'Este CRM não tem exatamente uma empresa. Nada foi apagado.';
 end if;
 select o.id into v_org from public.organizations o;
 -- Qualquer registro com identificador fixo conta: a turma pode ter excluído pela tela só uma parte da demonstração.
 if not exists(select 1 from public.contacts where org_id=v_org and id=any(v_contacts))
  and not exists(select 1 from public.companies where org_id=v_org and id=any(v_companies))
  and not exists(select 1 from public.deals where org_id=v_org and id=any(v_deals))
  and not exists(select 1 from public.activities where org_id=v_org and id=any(v_activities))
  and not exists(select 1 from public.payments where org_id=v_org and id=any(v_payments))
  and not exists(select 1 from public.products where org_id=v_org and id=any(v_products))
  and not exists(select 1 from public.automations where org_id=v_org and id=any(v_automations))
  and not exists(select 1 from public.email_templates where org_id=v_org and id=any(v_templates))
  and not exists(select 1 from public.pipelines where org_id=v_org and id=v_pipeline) then
  raise exception 'Este CRM não tem dados de demonstração. Nada foi apagado.';
 end if;

 -- Registros criados por pessoas que apontam para a demonstração: recusa, sem apagar nada, com o que fazer em cada caso.
 select string_agg(format('%s %s',n,label),'; ') into v_blocking from (values
   ((select count(*) from public.contacts where org_id=v_org and id<>all(v_contacts) and company_id=any(v_companies)),
    'contato(s) ligado(s) a uma empresa da demonstração: tire a empresa do contato ou exclua o contato'),
   ((select count(*) from public.deals where org_id=v_org and id<>all(v_deals)
     and (contact_id=any(v_contacts) or company_id=any(v_companies) or pipeline_id=v_pipeline)),
    'oportunidade(s) ligada(s) a um contato, a uma empresa ou ao funil Parcerias da demonstração: troque o vínculo ou exclua a oportunidade'),
   -- O histórico de etapas aponta para as etapas sem ON DELETE e não pode ser alterado: apagar o funil falharia.
   ((select count(*) from public.deals d where d.org_id=v_org and d.id<>all(v_deals) and d.pipeline_id<>v_pipeline
     and exists(select 1 from public.deal_stage_history h join public.pipeline_stages s
      on s.org_id=h.org_id and s.id in (h.from_stage_id,h.to_stage_id)
      where h.org_id=v_org and h.deal_id=d.id and s.pipeline_id=v_pipeline)),
    'oportunidade(s) que já passaram pelo funil Parcerias da demonstração: o histórico de etapas não muda, então exclua a oportunidade ou mantenha a demonstração'),
   ((select count(*) from public.deal_items where org_id=v_org and deal_id<>all(v_deals) and product_id=any(v_products)),
    'item(ns) de oportunidade com um item do catálogo da demonstração: troque o item ou tire-o da oportunidade'),
   -- Apagar o funil tiraria o filtro dessas automações e as pausaria (ON DELETE SET NULL), sem aviso.
   ((select count(*) from public.automations a where a.org_id=v_org and a.id<>all(v_automations)
     and (a.pipeline_id=v_pipeline or a.stage_id in (select s.id from public.pipeline_stages s
      where s.org_id=v_org and s.pipeline_id=v_pipeline))),
    'automação(ões) com filtro no funil Parcerias da demonstração: troque o filtro ou exclua a automação')
  ) t(n,label) where n>0;
 if v_blocking is not null then
  raise exception 'Há registros criados por pessoas que apontam para a demonstração (%). Depois de resolver esses registros, rode a remoção de novo. Nada foi apagado.',v_blocking;
 end if;

 select r.user_id into v_owner from public.user_roles r join public.profiles p on p.id=r.user_id
  where r.org_id=v_org and r.deactivated_at is null and r.role='owner' order by p.created_at,r.user_id limit 1;
 if v_owner is not null then
  perform set_config('request.jwt.claims',json_build_object('sub',v_owner,'role','authenticated')::text,true);
 end if;

 delete from public.activities where org_id=v_org and (id=any(v_activities) or contact_id=any(v_contacts)
  or company_id=any(v_companies) or deal_id=any(v_deals));
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('atividades',v_n);
 delete from public.payments where org_id=v_org and (id=any(v_payments) or contact_id=any(v_contacts)
  or company_id=any(v_companies) or deal_id=any(v_deals));
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('recebimentos',v_n);
 delete from public.deals where org_id=v_org and id=any(v_deals);
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('oportunidades',v_n);
 delete from public.contacts where org_id=v_org and id=any(v_contacts);
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('contatos',v_n);
 delete from public.companies where org_id=v_org and id=any(v_companies);
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('empresas',v_n);
 delete from public.products where org_id=v_org and id=any(v_products);
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('itens_do_catalogo',v_n);
 delete from public.automations where org_id=v_org and id=any(v_automations);
 delete from public.email_templates where org_id=v_org and id=any(v_templates);
 delete from public.pipelines where org_id=v_org and id=v_pipeline;
 perform set_config('request.jwt.claims','',true);
 raise notice 'Dados de demonstração apagados: %',v_removed;
end
$remove$;

select 'Dados de demonstração apagados' as resultado,
 (select count(*) from public.contacts) as contatos_restantes,
 (select count(*) from public.deals) as oportunidades_restantes;
`;
}

/** Os dois arquivos gerados, com o caminho relativo à raiz do repositório. */
export function buildDemoSeedFiles() {
  const dataset = buildDemoDataset();
  return [
    { file: SEED_FILE, content: renderSeedSql(dataset) },
    { file: REMOVE_FILE, content: renderRemoveSql(dataset) },
  ];
}
