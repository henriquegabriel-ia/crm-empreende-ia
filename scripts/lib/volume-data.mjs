/**
 * Dados sintéticos volumosos e determinísticos (item 0.10 do roteiro): 1 mil empresas, 5 mil contatos, 2 mil
 * oportunidades e 15 mil atividades, com a mesma semente e o mesmo instante de referência gerando as mesmas linhas.
 * Servem ao benchmark (`npm run test:perf`), aos testes de paridade do Vitest e, depois, ao seed de demonstração
 * (item 1.15), que pode transformar estas linhas em SQL.
 *
 * Nada aqui é dado real: nomes combinados de listas fixas, e-mails e sites em example.test (domínio reservado) e
 * telefones fictícios no formato E.164. As linhas respeitam as restrições do schema: perdida tem motivo, ganha tem
 * responsável, `closed_at` só nas encerradas e entre a criação e o instante de referência, compromisso com término
 * depois do início, nota concluída sem prazo, e-mail único por organização e `updated_at` nunca antes de `created_at`.
 *
 * Perfil do volume, pensado para os casos difíceis das telas Hoje e Contatos:
 * - 10% dos contatos cadastrados nas últimas 24 horas (importação do dia) e 30% há 2 ou 3 dias (importação da
 *   semana), quase todos sem próxima ação;
 * - 12% dos contatos e 10% das oportunidades sem responsável;
 * - atividades pendentes vencidas, de hoje, futuras e sem prazo, concluídas e notas.
 *
 * Arquivo em JavaScript puro (ESM, sem dependências) para rodar no Node, no Vitest e no Playwright sem compilação.
 */

export const VOLUME_SEED = 20261011;
/** Instante de referência padrão. O benchmark usa o relógio atual, para "hoje" e "vencida" fazerem sentido. */
export const VOLUME_NOW = '2026-10-11T15:00:00.000Z';
export const VOLUME_COUNTS = Object.freeze({ companies: 1000, contacts: 5000, deals: 2000, activities: 15000 });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const FIRST_NAMES = [
  'Ana',
  'Bruno',
  'Camila',
  'Daniel',
  'Eduarda',
  'Felipe',
  'Gabriela',
  'Henrique',
  'Isabela',
  'João',
  'Larissa',
  'Marcos',
  'Natália',
  'Otávio',
  'Patrícia',
  'Rafael',
  'Sofia',
  'Thiago',
  'Valéria',
  'Wagner',
  'Yasmin',
  'Álvaro',
  'Beatriz',
  'César',
  'Débora',
  'Érico',
  'Fernanda',
  'Guilherme',
  'Helena',
  'Igor',
];
const LAST_NAMES = [
  'Almeida',
  'Barbosa',
  'Cardoso',
  'Dias',
  'Esteves',
  'Ferreira',
  'Gomes',
  'Honório',
  'Ibrahim',
  'Jardim',
  'Lima',
  'Moraes',
  'Nogueira',
  'Oliveira',
  'Pereira',
  'Queiroz',
  'Ribeiro',
  'Santos',
  'Teixeira',
  'Uchôa',
  'Vasconcelos',
  'Xavier',
  'Zanetti',
  'Araújo',
  'Brandão',
  'Conceição',
  'Damasceno',
  'Freitas',
  'Gonçalves',
  'Leão',
];
const COMPANY_WORDS = [
  'Alfa',
  'Aurora',
  'Bela Vista',
  'Cerrado',
  'Delta',
  'Estrela',
  'Horizonte',
  'Ipê',
  'Jatobá',
  'Litoral',
  'Mantiqueira',
  'Nova Era',
  'Pampa',
  'Pioneira',
  'Rio Claro',
  'Serra Azul',
  'Sol Nascente',
  'Tupã',
  'Vale Verde',
  'Vitória',
];
const COMPANY_KINDS = [
  'Alimentos',
  'Arquitetura',
  'Consultoria',
  'Contabilidade',
  'Educação',
  'Engenharia',
  'Logística',
  'Marketing',
  'Odontologia',
  'Software',
  'Turismo',
  'Varejo',
];
const COMPANY_SUFFIXES = ['Ltda.', 'S.A.', 'ME', 'EPP', 'Comércio', 'Serviços'];
const INDUSTRIES = ['Serviços', 'Varejo', 'Indústria', 'Tecnologia', 'Saúde', 'Educação', 'Agronegócio', 'Construção'];
const SIZES = ['1-10', '11-50', '51-200', '201-500'];
const JOB_TITLES = ['Diretora comercial', 'Sócio', 'Gerente de compras', 'Analista', 'CEO', 'Coordenadora', null];
const SOURCES = ['whatsapp', 'telefone', 'e-mail', 'site', 'indicação', 'importação', null];
const DDDS = ['11', '21', '31', '41', '47', '48', '51', '61', '62', '71', '81', '85', '92'];
const DEAL_TOPICS = [
  'Implantação',
  'Renovação anual',
  'Expansão de licenças',
  'Projeto piloto',
  'Consultoria mensal',
  'Treinamento da equipe',
  'Contrato de suporte',
  'Pacote de serviços',
];
const LOST_REASONS = ['Preço acima do orçamento', 'Escolheu concorrente', 'Projeto adiado', 'Sem retorno do cliente'];
const TASK_TITLES = {
  task: ['Enviar proposta', 'Revisar contrato', 'Preparar apresentação', 'Atualizar cadastro'],
  call: ['Ligar para retomar conversa', 'Ligação de qualificação', 'Retorno sobre a proposta'],
  email: ['Enviar material por e-mail', 'Responder dúvidas por e-mail', 'Mandar resumo da reunião'],
  meeting: ['Reunião de diagnóstico', 'Apresentação da solução', 'Reunião de fechamento'],
  note: ['Cliente pediu desconto', 'Contato prefere WhatsApp', 'Decisão depende do sócio'],
};

/** Gerador pseudoaleatório mulberry32: rápido, de 32 bits e reproduzível em qualquer plataforma. */
export function createRandom(seed = VOLUME_SEED) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    chance: (probability) => next() < probability,
    pick: (list) => list[Math.floor(next() * list.length)],
    /** UUID versão 4 com bits vindos da semente: único na prática e igual a cada execução. */
    uuid() {
      const bytes = Array.from({ length: 16 }, () => int(0, 255));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  };
}

function slug(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Gera o volume para uma organização.
 *
 * @param {object} options
 * @param {string} options.orgId organização dona de todas as linhas.
 * @param {string[]} options.ownerIds perfis que podem ser responsáveis (pelo menos um).
 * @param {{ id: string, pipeline_id: string }[]} options.stages etapas válidas para as oportunidades.
 * @param {number} [options.seed] semente; o padrão é VOLUME_SEED.
 * @param {string | Date} [options.now] instante de referência; o padrão é VOLUME_NOW.
 * @param {Partial<typeof VOLUME_COUNTS>} [options.counts] quantidades; o padrão é VOLUME_COUNTS.
 */
export function generateVolumeData({ orgId, ownerIds, stages, seed = VOLUME_SEED, now = VOLUME_NOW, counts = {} }) {
  if (!orgId) throw new Error('Informe a organização (orgId).');
  if (!ownerIds?.length) throw new Error('Informe pelo menos um responsável (ownerIds).');
  if (!stages?.length) throw new Error('Informe pelo menos uma etapa (stages).');
  const total = { ...VOLUME_COUNTS, ...counts };
  const reference = new Date(now).getTime();
  if (!Number.isFinite(reference)) throw new Error('Instante de referência inválido.');
  const random = createRandom(seed);
  const iso = (ms) => new Date(ms).toISOString();
  const pastWithin = (days) => reference - random.int(1, Math.max(1, Math.round(days * DAY)));
  const owner = (unassignedChance) => (random.chance(unassignedChance) ? null : random.pick(ownerIds));
  const updatedAfter = (created) => iso(Math.min(reference, created + random.int(0, 20 * DAY)));
  const phone = (mobile) =>
    `+55${random.pick(DDDS)}${mobile ? `9${random.int(1000, 9999)}${random.int(1000, 9999)}` : `${random.int(2, 5)}${random.int(100, 999)}${random.int(1000, 9999)}`}`;

  const companies = Array.from({ length: total.companies }, (_, i) => {
    const name = `${random.pick(COMPANY_WORDS)} ${random.pick(COMPANY_KINDS)} ${random.pick(COMPANY_SUFFIXES)}`;
    const domain = `${slug(name)}-${String(i + 1).padStart(4, '0')}.example.test`;
    const created = pastWithin(720);
    return {
      id: random.uuid(),
      org_id: orgId,
      name,
      domain,
      industry: random.pick(INDUSTRIES),
      size: random.pick(SIZES),
      revenue: random.chance(0.4) ? random.int(100, 50_000) * 1000 : null,
      website: `https://${domain}`,
      linkedin_url: null,
      owner_id: owner(0.15),
      phone: phone(false),
      created_at: iso(created),
      updated_at: updatedAfter(created),
    };
  });

  const contacts = Array.from({ length: total.contacts }, (_, i) => {
    const first = random.pick(FIRST_NAMES);
    const last = random.pick(LAST_NAMES);
    const band = i % 10;
    // Importação do dia (menos de 24 h), importação da semana (2 a 3 dias) e cadastros de 4 dias a 2 anos atrás.
    const created =
      band === 0
        ? reference - random.int(5 * MINUTE, 23 * HOUR)
        : band <= 3
          ? reference - random.int(2 * DAY, 3 * DAY)
          : reference - random.int(4 * DAY, 720 * DAY);
    const company = random.chance(0.8) ? random.pick(companies) : null;
    const roll = random.next();
    return {
      id: random.uuid(),
      org_id: orgId,
      first_name: first,
      last_name: last,
      email: `${slug(first)}.${slug(last)}.${i + 1}@example.test`,
      phone: random.chance(0.85) ? phone(random.chance(0.8)) : null,
      company_id: company?.id ?? null,
      owner_id: owner(0.12),
      status: roll < 0.5 ? 'lead' : roll < 0.75 ? 'prospect' : roll < 0.95 ? 'customer' : 'churned',
      job_title: random.pick(JOB_TITLES),
      source: random.pick(SOURCES),
      notes: null,
      created_at: iso(created),
      updated_at: updatedAfter(created),
    };
  });
  // Contatos com algum histórico, para vincular oportunidades e atividades (os importados recentes ficam sem).
  const established = contacts.filter((_, i) => i % 10 > 3);

  const deals = Array.from({ length: total.deals }, () => {
    const contact = random.chance(0.9) ? random.pick(established) : null;
    const companyId = contact?.company_id ?? (random.chance(0.5) ? random.pick(companies).id : null);
    const stage = random.pick(stages);
    const roll = random.next();
    const status = roll < 0.6 ? 'open' : roll < 0.85 ? 'won' : 'lost';
    const ownerId = status === 'won' ? random.pick(ownerIds) : owner(0.1);
    const created = pastWithin(365);
    const closed = status === 'open' ? null : Math.min(reference, created + random.int(HOUR, 90 * DAY));
    const entered = Math.min(reference, created + random.int(0, 30 * DAY));
    const updated = Math.max(entered, closed ?? 0, Math.min(reference, created + random.int(0, 120 * DAY)));
    const closeDate = status === 'open' && random.chance(0.5) ? iso(reference + random.int(1, 120) * DAY) : null;
    return {
      id: random.uuid(),
      org_id: orgId,
      pipeline_id: stage.pipeline_id,
      stage_id: stage.id,
      title: `${random.pick(DEAL_TOPICS)} · ${contact ? `${contact.first_name} ${contact.last_name}` : 'Conta sem contato'}`,
      value: random.int(500, 50_000) + random.int(0, 99) / 100,
      currency: 'BRL',
      contact_id: contact?.id ?? null,
      company_id: companyId,
      owner_id: ownerId,
      close_date: closeDate ? closeDate.slice(0, 10) : null,
      // NULL = herda a probabilidade da etapa (decisão D8); ganha = 100 e perdida = 0, como o gatilho do banco.
      probability: status === 'won' ? 100 : status === 'lost' ? 0 : random.chance(0.7) ? null : random.int(1, 19) * 5,
      status,
      lost_reason: status === 'lost' ? random.pick(LOST_REASONS) : null,
      closed_at: closed === null ? null : iso(closed),
      stage_entered_at: iso(entered),
      created_at: iso(created),
      updated_at: iso(updated),
    };
  });

  const activities = Array.from({ length: total.activities }, () => {
    const kindRoll = random.next();
    const type =
      kindRoll < 0.4
        ? 'task'
        : kindRoll < 0.6
          ? 'call'
          : kindRoll < 0.75
            ? 'email'
            : kindRoll < 0.9
              ? 'meeting'
              : 'note';
    const linkRoll = random.next();
    const deal = linkRoll < 0.5 ? random.pick(deals) : null;
    const contact = deal
      ? deal.contact_id
        ? { id: deal.contact_id, company_id: deal.company_id }
        : null
      : linkRoll < 0.9
        ? random.pick(established)
        : null;
    const companyId = deal ? deal.company_id : (contact?.company_id ?? random.pick(companies).id);
    const created = pastWithin(365);
    let due = null;
    let completed = null;
    if (type === 'note') completed = created;
    else if (random.chance(0.6)) {
      due = Math.min(reference, created + random.int(HOUR, 30 * DAY));
      completed = Math.min(reference, due + random.int(0, 2 * DAY));
    } else {
      const when = random.next();
      due =
        when < 0.25
          ? reference - random.int(HOUR, 30 * DAY)
          : when < 0.35
            ? reference + random.int(10 * MINUTE, 4 * HOUR)
            : when < 0.85
              ? reference + random.int(DAY, 60 * DAY)
              : null;
    }
    const end = type === 'meeting' && due !== null ? due + random.pick([30, 60, 90]) * MINUTE : null;
    const updated = Math.min(reference, Math.max(created, completed ?? created) + random.int(0, DAY));
    return {
      id: random.uuid(),
      org_id: orgId,
      type,
      title: random.pick(TASK_TITLES[type]),
      body: random.chance(0.3) ? 'Registro sintético para medir desempenho.' : null,
      contact_id: contact?.id ?? null,
      company_id: companyId,
      deal_id: deal?.id ?? null,
      user_id: owner(0.1),
      due_date: due === null ? null : iso(due),
      end_date: end === null ? null : iso(end),
      completed_at: completed === null ? null : iso(completed),
      created_at: iso(created),
      updated_at: iso(updated),
      created_by: random.pick(ownerIds),
    };
  });

  return { companies, contacts, deals, activities };
}
