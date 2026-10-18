import type { AnonymizationCounts } from '@/lib/privacy';

/** Textos do diálogo de anonimização (item 1.10), com as contagens no singular e no plural. */

const count = (value: number, singular: string, plural: string) => `${value} ${value === 1 ? singular : plural}`;

/**
 * O que sai do cadastro, como o UPDATE final de anonymize_contact: os campos apagados e, da origem, só os termos da
 * pessoa (o resto da origem fica).
 */
export const REMOVED_FROM_RECORD =
  'Nome, e-mail, telefone, cargo, observações, a empresa, o motivo do “Não contatar” e o registro da base legal; da origem, saem o nome, o e-mail e o telefone.';

/** As linhas de "O que sai", com as contagens do resumo; uma contagem zerada não vira linha. */
export function removedLines(counts: AnonymizationCounts): string[] {
  const lines = [REMOVED_FROM_RECORD];
  if (counts.activities_scrubbed)
    lines.push(
      `${count(counts.activities_scrubbed, 'atividade com a pessoa fica', 'atividades com a pessoa ficam')} sem título e sem anotações.`,
    );
  // As ações pendentes com a pessoa saem também das oportunidades dela; sem oportunidade, não há o que combinar.
  if (counts.activities_deleted)
    lines.push(
      `${count(counts.activities_deleted, 'ação pendente com a pessoa será excluída', 'ações pendentes com a pessoa serão excluídas')}${
        counts.deals ? ', inclusive as das oportunidades; combine de novo a próxima ação dessas oportunidades' : ''
      }.`,
    );
  if (counts.deals || counts.payments) {
    const records = [
      counts.deals ? count(counts.deals, 'oportunidade', 'oportunidades') : '',
      counts.payments ? count(counts.payments, 'recebimento', 'recebimentos') : '',
    ].filter(Boolean);
    const many = counts.deals + counts.payments > 1;
    lines.push(
      `${records.join(' e ')} ${many ? 'deixam' : 'deixa'} de apontar para a pessoa, e o nome, o e-mail e o telefone dela saem dos títulos.`,
    );
  }
  if (counts.other_records)
    lines.push(
      `${count(counts.other_records, 'outro registro cita', 'outros registros citam')} o nome completo, o e-mail ou o telefone e também ${counts.other_records === 1 ? 'será ajustado' : 'serão ajustados'}.`,
    );
  return lines;
}

/** O aviso de sucesso, com as contagens devolvidas pela anonimização. */
export function anonymizedSummary(counts: AnonymizationCounts): string {
  const changed = counts.activities_scrubbed + counts.deals + counts.payments + counts.other_records;
  const parts = [
    changed ? `${count(changed, 'registro ajustado', 'registros ajustados')}` : '',
    counts.activities_deleted
      ? count(counts.activities_deleted, 'ação pendente excluída', 'ações pendentes excluídas')
      : '',
  ].filter(Boolean);
  return parts.length
    ? `${parts.join(' e ')}. O histórico comercial ficou sem nomes e anotações.`
    : 'O cadastro ficou sem dados pessoais.';
}
