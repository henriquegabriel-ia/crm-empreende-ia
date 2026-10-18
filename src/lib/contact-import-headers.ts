/**
 * Cabeçalhos da planilha de contatos (item 1.11; docs/arquitetura/1.11.md, seção 5.2): a fonte única do modelo para
 * baixar, da tela "Como usar", da Ajuda e da leitura do arquivo. Cada campo do CRM tem a coluna do modelo, em português,
 * e os sinônimos aceitos, já normalizados (sem acento, maiúscula, pontuação nem asterisco). Os nomes em inglês da
 * importação do 0.5 (`first_name`, `last_name`, `email`, `phone`) continuam aceitos, para um arquivo antigo voltar.
 *
 * Só o nome é obrigatório. Duas colunas para o mesmo campo recusam o arquivo, nomeando as duas: o CRM guarda um telefone
 * e uma empresa por contato, e escolher sozinho entre "Telefone" e "Celular" seria o De>Para do item 2B.1.
 */

export type ContactImportField =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'company'
  | 'job_title'
  | 'source'
  | 'owner'
  | 'status'
  | 'notes'
  | 'do_not_contact'
  | 'legal_basis'
  | 'legal_basis_note';

export interface ContactImportFieldDefinition {
  field: ContactImportField;
  /** Nome da coluna no modelo e na exportação. */
  column: string;
  /** Como o campo aparece na prévia ("Nome completo → Nome"). */
  label: string;
  /** Sinônimos aceitos, já normalizados por `normalizeHeader`; a coluna do modelo normalizada está entre eles. */
  synonyms: readonly string[];
  /** Exemplos de sinônimos como as pessoas escrevem, para "Como usar" (cada um casa com um dos sinônimos). */
  examples: readonly string[];
}

export const CONTACT_IMPORT_FIELDS: readonly ContactImportFieldDefinition[] = [
  {
    field: 'first_name',
    examples: ['Nome completo', 'Primeiro nome'],
    column: 'nome',
    label: 'Nome',
    synonyms: [
      'nome',
      'nome completo',
      'primeiro nome',
      'nome do contato',
      'nome e sobrenome',
      'first name',
      'firstname',
      'name',
      'full name',
    ],
  },
  {
    field: 'last_name',
    examples: ['Último nome'],
    column: 'sobrenome',
    label: 'Sobrenome',
    synonyms: ['sobrenome', 'ultimo nome', 'last name', 'lastname', 'surname'],
  },
  {
    field: 'email',
    examples: ['E-mail', 'Endereço de e-mail'],
    column: 'email',
    label: 'E-mail',
    synonyms: ['email', 'e mail', 'endereco de email', 'endereco de e mail', 'correio eletronico', 'mail'],
  },
  {
    field: 'phone',
    examples: ['Celular', 'WhatsApp'],
    column: 'telefone',
    label: 'Telefone',
    synonyms: [
      'telefone',
      'celular',
      'whatsapp',
      'whats',
      'fone',
      'tel',
      'telefone celular',
      'numero de telefone',
      'telefone whatsapp',
      'celular whatsapp',
      'whatsapp celular',
      'phone',
      'mobile',
    ],
  },
  {
    field: 'company',
    examples: ['Razão social', 'Nome fantasia'],
    column: 'empresa',
    label: 'Empresa',
    synonyms: ['empresa', 'nome da empresa', 'organizacao', 'companhia', 'razao social', 'nome fantasia', 'company'],
  },
  {
    field: 'job_title',
    examples: ['Função'],
    column: 'cargo',
    label: 'Cargo',
    synonyms: ['cargo', 'funcao', 'job title', 'position'],
  },
  {
    field: 'source',
    examples: ['Fonte', 'Origem do lead'],
    column: 'origem',
    label: 'Origem',
    synonyms: ['origem', 'fonte', 'origem do lead', 'canal de origem', 'como conheceu', 'lead source', 'source'],
  },
  {
    field: 'owner',
    examples: ['Vendedor', 'Consultora'],
    column: 'responsavel',
    label: 'Responsável',
    synonyms: ['responsavel', 'vendedor', 'vendedora', 'consultor', 'consultora', 'dono do contato', 'owner'],
  },
  {
    field: 'status',
    examples: ['Situação', 'Status'],
    column: 'relacionamento',
    label: 'Relacionamento',
    synonyms: ['relacionamento', 'situacao', 'status', 'tipo de relacionamento'],
  },
  {
    field: 'notes',
    examples: ['Obs', 'Anotações'],
    column: 'observacoes',
    label: 'Observações',
    synonyms: ['observacoes', 'observacao', 'obs', 'notas', 'anotacoes', 'comentarios', 'notes'],
  },
  {
    field: 'do_not_contact',
    examples: ['Não contatar', 'Opt-out'],
    column: 'nao_contatar',
    label: 'Não contatar',
    synonyms: ['nao contatar', 'nao contactar', 'do not contact', 'opt out', 'optout'],
  },
  {
    field: 'legal_basis',
    examples: ['Base legal'],
    column: 'base_legal',
    label: 'Base legal',
    synonyms: ['base legal', 'base legal lgpd', 'legal basis'],
  },
  {
    field: 'legal_basis_note',
    examples: ['Registro do consentimento', 'Como consentiu'],
    column: 'registro_base_legal',
    label: 'Registro da base legal',
    synonyms: [
      'registro base legal',
      'registro da base legal',
      'registro do consentimento',
      'como consentiu',
      'legal basis note',
    ],
  },
];

/** As 13 colunas do modelo para baixar (`modelo-contatos.csv`), na ordem da tabela. */
export const CONTACT_TEMPLATE_HEADERS: readonly string[] = CONTACT_IMPORT_FIELDS.map((definition) => definition.column);

/**
 * Colunas que a planilha de contatos não importados acrescenta antes das originais (seção 6.4). Escolhida de novo,
 * depois de corrigida, elas são ignoradas sem aparecer como desconhecidas.
 */
export const IMPORT_RESULT_HEADERS = ['linha_planilha', 'resultado_importacao', 'motivo_importacao'] as const;

/** Como uma coluna sem nome aparece entre as ignoradas. */
export const UNNAMED_COLUMN = '(sem nome)';

/**
 * Normaliza um cabeçalho (e o valor da coluna do responsável): sem acentos, em minúsculas, todo trecho que não é letra
 * nem dígito vira um espaço, sem espaços nas pontas. "E-mail", "e_mail" e "E-MAIL *" viram "e mail".
 */
export function normalizeHeader(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const FIELD_BY_SYNONYM = new Map<string, ContactImportFieldDefinition>(
  CONTACT_IMPORT_FIELDS.flatMap((definition) => definition.synonyms.map((synonym) => [synonym, definition] as const)),
);
const RESULT_HEADERS = new Set<string>(IMPORT_RESULT_HEADERS.map((header) => normalizeHeader(header)));

/** Índice da coluna de cada campo reconhecido. */
export type ContactHeaderMapping = Partial<Record<ContactImportField, number>>;

export interface ContactHeaderMap {
  mapping: ContactHeaderMapping;
  /** Colunas reconhecidas, na ordem do arquivo: o cabeçalho como está e o campo do CRM. */
  recognized: { header: string; field: ContactImportField; label: string }[];
  /** Colunas desconhecidas, como estão no arquivo ("(sem nome)" para o cabeçalho vazio). */
  ignored: string[];
  /** Motivo da recusa do arquivo, ou nulo. */
  error: string | null;
}

export const MISSING_NAME_COLUMN =
  'A primeira linha precisa ser o cabeçalho, com uma coluna para o nome do contato (nome, nome completo ou first_name). Use o modelo para conferir.';

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase('pt-BR') + text.slice(1);

/** Mapeia os cabeçalhos do arquivo para os campos do CRM. */
export function mapContactHeaders(headers: readonly string[]): ContactHeaderMap {
  const mapping: ContactHeaderMapping = {};
  const recognized: ContactHeaderMap['recognized'] = [];
  const ignored: string[] = [];
  for (const [index, raw] of headers.entries()) {
    const header = raw.trim();
    const key = normalizeHeader(header);
    const definition = FIELD_BY_SYNONYM.get(key);
    if (!definition) {
      if (!RESULT_HEADERS.has(key)) ignored.push(header || UNNAMED_COLUMN);
      continue;
    }
    const previous = mapping[definition.field];
    if (previous !== undefined)
      return {
        mapping: {},
        recognized: [],
        ignored: [],
        error: `As colunas “${headers[previous].trim()}” e “${header}” são o mesmo campo do CRM (${lowerFirst(definition.label)}). Deixe só uma e importe de novo.`,
      };
    mapping[definition.field] = index;
    recognized.push({ header, field: definition.field, label: definition.label });
  }
  if (mapping.first_name === undefined) return { mapping: {}, recognized: [], ignored: [], error: MISSING_NAME_COLUMN };
  return { mapping, recognized, ignored, error: null };
}
