import { buildCsv, type CsvColumn } from '@/lib/csv';
import { ACTIVITY_LABELS, CONTACT_STATUS_LABELS, OUTCOME_LABELS } from '@/lib/contact-model';
import { DEAL_STATUS_LABELS } from '@/lib/deal-logic';
import type { DealStatus } from '@/lib/deal-types';
import { PAYMENT_LABELS } from '@/lib/operation-logic';
import { legalBasisLabel } from '@/lib/privacy';
import { buildZip, type ZipEntry } from '@/lib/zip';

/**
 * "Exportar dados deste contato" (item 1.10; docs/arquitetura/1.10.md, seção 5.3): o pedido de acesso do titular. A
 * RPC export_contact_data lê os dados e registra a exportação; aqui o navegador monta o pacote .zip com o LEIA-ME, o
 * JSON completo (chaves e rótulos em pt-BR, datas ISO 8601 com fuso, valores numéricos e ids) e uma planilha por seção
 * (";" com BOM, como as demais exportações). Os nomes da equipe não vêm da RPC e não entram no pacote. Funções puras.
 */

export interface ExportedContact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  source: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  legal_basis: string;
  legal_basis_note: string | null;
  legal_basis_at: string | null;
  do_not_contact: boolean;
  do_not_contact_at: string | null;
  do_not_contact_reason: string | null;
  anonymized_at: string | null;
}
/**
 * Com quem foi a atividade: com a pessoa, com outro contato de uma oportunidade dela ou, numa oportunidade dela, sem
 * contato. São os mesmos registros que a anonimização trata como dela. Nos ligados a outro contato, o banco troca o
 * nome, o e-mail e o telefone gravados no cadastro dele (cada número do campo) por "[anonimizado]" no título e nos
 * detalhes (e na descrição dos recebimentos), e o vínculo não leva o id nem o nome dele. Um telefone antigo ou que não
 * está no cadastro continua no texto: por isso a tela pede a revisão antes do envio.
 */
export type ExportedActivityRelation = 'person' | 'other_contact' | 'no_contact';
export const ACTIVITY_RELATION_LABELS: Readonly<Record<ExportedActivityRelation, string>> = {
  person: 'Com a pessoa',
  other_contact: 'Com outro contato da oportunidade',
  no_contact: 'Sem contato, na oportunidade',
};
export interface ExportedActivity {
  id: string;
  type: string;
  title: string;
  body: string | null;
  due_date: string | null;
  end_date: string | null;
  completed_at: string | null;
  outcome: string | null;
  created_at: string;
  deal_id: string | null;
  /** Ausente numa resposta anterior à revisão do item 1.10, que só trazia as atividades com a pessoa. */
  relation?: ExportedActivityRelation;
}
export interface ExportedDeal {
  id: string;
  title: string;
  value: number;
  currency: string;
  status: string;
  pipeline: string | null;
  stage: string | null;
  close_date: string | null;
  closed_at: string | null;
  lost_reason: string | null;
  created_at: string;
}
export interface ExportedPayment {
  id: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  due_date: string;
  paid_at: string | null;
  deal_id: string | null;
  created_at: string;
}
/** A resposta de export_contact_data (formato 1). */
export interface ContactExportData {
  format: 1;
  generated_at: string;
  organization: { name: string } | null;
  contact: ExportedContact;
  company: { id: string; name: string } | null;
  activities: ExportedActivity[];
  deals: ExportedDeal[];
  payments: ExportedPayment[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Lê a resposta da RPC; fora do contrato (formato desconhecido, seção ausente), erro, sem pacote incompleto. */
export function parseContactExportData(value: unknown): ContactExportData {
  if (!isRecord(value) || value.format !== 1) throw new Error('Resposta inesperada do banco: formato da exportação.');
  const { contact, activities, deals, payments } = value;
  if (!isRecord(contact) || typeof contact.id !== 'string' || typeof contact.first_name !== 'string')
    throw new Error('Resposta inesperada do banco: contato.');
  if (!Array.isArray(activities) || !Array.isArray(deals) || !Array.isArray(payments))
    throw new Error('Resposta inesperada do banco: seções da exportação.');
  return value as unknown as ContactExportData;
}

/** Arquivos do pacote, na ordem em que entram no .zip. */
export const CONTACT_EXPORT_FILES = [
  'LEIA-ME.txt',
  'dados.json',
  'contato.csv',
  'atividades.csv',
  'oportunidades.csv',
  'recebimentos.csv',
] as const;

/**
 * Base do nome do arquivo: "dados-contato-1a2b3c4d". Nas telas, `exportFileName(base, 'zip', localDateKey())` acrescenta
 * a marca e a data. O nome da pessoa não vai no nome do arquivo (ele fica na lista de downloads do navegador); o trecho
 * do id evita dois arquivos com o mesmo nome no mesmo dia.
 */
export const contactExportBaseName = (contactId: string) => `dados-contato-${contactId.slice(0, 8)}`;

const dateTime = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR') : '';
};
/** Data sem hora ("AAAA-MM-DD") como "DD/MM/AAAA", sem passar pelo fuso. */
const day = (value: string | null | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (value ?? '');
};
const money = (value: number) => (Number.isFinite(value) ? value.toFixed(2).replace('.', ',') : '');
const label = (labels: Readonly<Record<string, string>>, value: string | null | undefined) =>
  value ? (labels[value] ?? value) : null;
const fullName = (contact: Pick<ExportedContact, 'first_name' | 'last_name'>) =>
  [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
const relationLabel = (activity: ExportedActivity) => ACTIVITY_RELATION_LABELS[activity.relation ?? 'person'];
/** A hora da geração, do banco; ilegível, a do navegador. */
const generatedDate = (data: ContactExportData) => {
  const date = new Date(data.generated_at);
  return Number.isFinite(date.getTime()) ? date : new Date();
};

/** O conteúdo inteiro, com chaves em pt-BR e os rótulos da tela. */
export function contactExportJson(data: ContactExportData) {
  const { contact } = data;
  return {
    formato: data.format,
    gerado_em: data.generated_at,
    empresa_controladora: data.organization ? { nome: data.organization.name } : null,
    contato: {
      id: contact.id,
      nome: contact.first_name,
      sobrenome: contact.last_name,
      email: contact.email,
      telefone: contact.phone,
      cargo: contact.job_title,
      origem: contact.source,
      observacoes: contact.notes,
      situacao: label(CONTACT_STATUS_LABELS, contact.status),
      cadastrado_em: contact.created_at,
      atualizado_em: contact.updated_at,
      base_legal: legalBasisLabel(contact.legal_basis),
      registro_da_base_legal: contact.legal_basis_note,
      base_legal_registrada_em: contact.legal_basis_at,
      nao_contatar: contact.do_not_contact,
      nao_contatar_desde: contact.do_not_contact_at,
      motivo_nao_contatar: contact.do_not_contact_reason,
      anonimizado_em: contact.anonymized_at,
    },
    empresa_vinculada: data.company ? { id: data.company.id, nome: data.company.name } : null,
    atividades: data.activities.map((activity) => ({
      id: activity.id,
      tipo: label(ACTIVITY_LABELS, activity.type),
      vinculo: relationLabel(activity),
      titulo: activity.title,
      detalhes: activity.body,
      prazo: activity.due_date,
      termino: activity.end_date,
      concluida_em: activity.completed_at,
      resultado: label(OUTCOME_LABELS, activity.outcome),
      criada_em: activity.created_at,
      oportunidade_id: activity.deal_id,
    })),
    oportunidades: data.deals.map((deal) => ({
      id: deal.id,
      titulo: deal.title,
      valor: deal.value,
      moeda: deal.currency,
      situacao: DEAL_STATUS_LABELS[deal.status as DealStatus] ?? deal.status,
      funil: deal.pipeline,
      etapa: deal.stage,
      previsao_de_fechamento: deal.close_date,
      fechada_em: deal.closed_at,
      motivo_da_perda: deal.lost_reason,
      criada_em: deal.created_at,
    })),
    recebimentos: data.payments.map((payment) => ({
      id: payment.id,
      descricao: payment.description,
      valor: payment.amount,
      moeda: payment.currency,
      situacao: label(PAYMENT_LABELS, payment.status),
      vencimento: payment.due_date,
      recebido_em: payment.paid_at,
      oportunidade_id: payment.deal_id,
      criado_em: payment.created_at,
    })),
  };
}

function readme(data: ContactExportData, organizationName: string, generatedAt: Date) {
  const who = fullName(data.contact) || 'o contato';
  const lines = [
    `Dados de ${who} guardados por ${organizationName}`,
    `Arquivo gerado em ${generatedAt.toLocaleString('pt-BR')} pelo CRM de ${organizationName}, a pedido da pessoa (Lei 13.709/2018, a LGPD).`,
    '',
    'O que cada arquivo traz:',
    '- dados.json: todos os dados deste pacote num formato que outro sistema consegue ler, para levar os dados a outro fornecedor.',
    '- contato.csv: o cadastro, com a base legal e a marca “Não contatar”.',
    '- atividades.csv: ligações, mensagens, e-mails, reuniões, visitas, tarefas e notas registradas com a pessoa e nas negociações dela. A coluna "Vínculo" diz se a atividade foi com a pessoa, com outro contato da negociação ou sem contato.',
    '- oportunidades.csv: as negociações em que a pessoa é o contato.',
    '- recebimentos.csv: os recebimentos ligados à pessoa ou às negociações dela.',
    '',
    'Nas atividades e nos recebimentos das negociações ligados a outro contato, o nome, o e-mail e o telefone gravados no cadastro dessa outra pessoa foram trocados por "[anonimizado]", para proteger os dados dela.',
    '',
    'As planilhas (.csv) abrem no Excel, no LibreOffice ou no Google Planilhas, com as colunas separadas por ponto e vírgula.',
    'Os nomes das pessoas da equipe da empresa não fazem parte deste arquivo.',
    '',
    `Dúvidas e pedidos de correção ou de exclusão dos dados: fale com ${organizationName} pelo canal de privacidade da empresa.`,
  ];
  // BOM e CRLF: o Bloco de Notas antigo do Windows abre com acentos e quebras de linha.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const CONTACT_COLUMNS: CsvColumn<{ data: ContactExportData }>[] = [
  { header: 'Nome', value: ({ data }) => data.contact.first_name },
  { header: 'Sobrenome', value: ({ data }) => data.contact.last_name },
  { header: 'E-mail', value: ({ data }) => data.contact.email },
  { header: 'Telefone', value: ({ data }) => data.contact.phone },
  { header: 'Cargo', value: ({ data }) => data.contact.job_title },
  { header: 'Origem', value: ({ data }) => data.contact.source },
  { header: 'Observações', value: ({ data }) => data.contact.notes },
  { header: 'Situação', value: ({ data }) => label(CONTACT_STATUS_LABELS, data.contact.status) },
  { header: 'Empresa vinculada', value: ({ data }) => data.company?.name },
  { header: 'Cadastrado em', value: ({ data }) => dateTime(data.contact.created_at) },
  { header: 'Base legal', value: ({ data }) => legalBasisLabel(data.contact.legal_basis) },
  { header: 'Registro da base legal', value: ({ data }) => data.contact.legal_basis_note },
  { header: 'Base legal registrada em', value: ({ data }) => dateTime(data.contact.legal_basis_at) },
  { header: 'Não contatar', value: ({ data }) => (data.contact.do_not_contact ? 'Sim' : 'Não') },
  { header: 'Não contatar desde', value: ({ data }) => dateTime(data.contact.do_not_contact_at) },
  { header: 'Motivo do “Não contatar”', value: ({ data }) => data.contact.do_not_contact_reason },
  { header: 'Anonimizado em', value: ({ data }) => dateTime(data.contact.anonymized_at) },
];

/** Os arquivos do pacote: LEIA-ME.txt, dados.json e as quatro planilhas. */
export function buildContactExportFiles(
  data: ContactExportData,
  options: { organizationName?: string | null; generatedAt?: Date } = {},
): ZipEntry[] {
  const organizationName = options.organizationName?.trim() || data.organization?.name?.trim() || 'a empresa';
  const generatedAt = options.generatedAt ?? generatedDate(data);
  const dealTitle = new Map(data.deals.map((deal) => [deal.id, deal.title]));
  return [
    { name: 'LEIA-ME.txt', data: readme(data, organizationName, generatedAt) },
    { name: 'dados.json', data: JSON.stringify(contactExportJson(data), null, 2) + '\n' },
    { name: 'contato.csv', data: buildCsv([{ data }], CONTACT_COLUMNS) },
    {
      name: 'atividades.csv',
      data: buildCsv(data.activities, [
        { header: 'Tipo', value: (activity) => label(ACTIVITY_LABELS, activity.type) },
        { header: 'Vínculo', value: relationLabel },
        { header: 'Título', value: (activity) => activity.title },
        { header: 'Detalhes', value: (activity) => activity.body },
        { header: 'Prazo', value: (activity) => dateTime(activity.due_date) },
        { header: 'Término', value: (activity) => dateTime(activity.end_date) },
        { header: 'Concluída em', value: (activity) => dateTime(activity.completed_at) },
        { header: 'Resultado', value: (activity) => label(OUTCOME_LABELS, activity.outcome) },
        { header: 'Oportunidade', value: (activity) => (activity.deal_id ? dealTitle.get(activity.deal_id) : '') },
        { header: 'Criada em', value: (activity) => dateTime(activity.created_at) },
      ]),
    },
    {
      name: 'oportunidades.csv',
      data: buildCsv(data.deals, [
        { header: 'Oportunidade', value: (deal) => deal.title },
        { header: 'Funil', value: (deal) => deal.pipeline },
        { header: 'Etapa', value: (deal) => deal.stage },
        { header: 'Situação', value: (deal) => DEAL_STATUS_LABELS[deal.status as DealStatus] ?? deal.status },
        { header: 'Valor BRL', value: (deal) => money(deal.value) },
        { header: 'Previsão de fechamento', value: (deal) => day(deal.close_date) },
        { header: 'Fechada em', value: (deal) => dateTime(deal.closed_at) },
        { header: 'Motivo de perda', value: (deal) => deal.lost_reason },
        { header: 'Criada em', value: (deal) => dateTime(deal.created_at) },
      ]),
    },
    {
      name: 'recebimentos.csv',
      data: buildCsv(data.payments, [
        { header: 'Descrição', value: (payment) => payment.description },
        { header: 'Valor BRL', value: (payment) => money(payment.amount) },
        { header: 'Situação', value: (payment) => label(PAYMENT_LABELS, payment.status) },
        { header: 'Vencimento', value: (payment) => day(payment.due_date) },
        { header: 'Recebido em', value: (payment) => dateTime(payment.paid_at) },
        { header: 'Oportunidade', value: (payment) => (payment.deal_id ? dealTitle.get(payment.deal_id) : '') },
        { header: 'Criado em', value: (payment) => dateTime(payment.created_at) },
      ]),
    },
  ];
}

/** O pacote .zip pronto para baixar (`downloadBytes`, de src/lib/csv.ts). */
export function buildContactExportZip(
  data: ContactExportData,
  options: { organizationName?: string | null; generatedAt?: Date } = {},
): Uint8Array {
  const generatedAt = options.generatedAt ?? generatedDate(data);
  return buildZip(buildContactExportFiles(data, { ...options, generatedAt }), generatedAt);
}
