import type { ContactImportAnalysis, ContactImportPlan } from '@/lib/contact-import';
import { PRIVACY_MIGRATION_MISSING } from '@/lib/rpc-errors';
import { formatCount, newCompaniesNotice, plural } from './text';

interface Props {
  analysis: ContactImportAnalysis;
  plan: ContactImportPlan;
}

/**
 * As colunas reconhecidas e ignoradas e os avisos da prévia (item 1.11; docs/arquitetura/1.11.md, seção 6.2): só os
 * avisos que existem, na caixa com `role="status"`, como os avisos dos diálogos de canais (item 1.9). Inclui as repetidas
 * que pedem "Não contatar" sem a marca no contato cadastrado (revisão do item 1.11).
 */
export function ImportSummary({ analysis, plan }: Props) {
  const { sheet } = analysis;
  const warnings = [
    plan.unrecognizedPhones > 0 &&
      (plan.unrecognizedPhones === 1
        ? '1 telefone não foi reconhecido e entra como está no arquivo; WhatsApp e ligação ficam desabilitados até a correção.'
        : `${formatCount(plan.unrecognizedPhones)} telefones não foram reconhecidos e entram como estão no arquivo; WhatsApp e ligação ficam desabilitados até a correção.`),
    plan.companies.length > 0 && newCompaniesNotice(plan.companies.map((company) => company.name)),
    plan.doNotContact > 0 &&
      (plan.doNotContact === 1
        ? '1 contato chega marcado “Não contatar”.'
        : `${formatCount(plan.doNotContact)} contatos chegam marcados “Não contatar”.`),
    // A importação não muda contatos cadastrados: o pedido de "Não contatar" de uma repetida é feito na ficha.
    plan.duplicateDoNotContact > 0 &&
      (plan.duplicateDoNotContact === 1
        ? '1 linha repetida pede “Não contatar”, e o contato no CRM não tem a marca: marque na ficha dele (veja “Repetidas”).'
        : `${formatCount(plan.duplicateDoNotContact)} linhas repetidas pedem “Não contatar”, e os contatos no CRM não têm a marca: marque na ficha de cada um (veja “Repetidas”).`),
    plan.consents > 0 &&
      `${plural(plan.consents, 'contato', 'contatos')} com consentimento: o registro vem da planilha, e você fica como quem registrou. Confira se ele prova o consentimento.`,
    plan.importedPhoneDuplicates > 0 &&
      `O telefone de ${plural(plan.importedPhoneDuplicates, 'contato', 'contatos')} já existe no CRM ou na planilha.`,
    analysis.privacyColumnsIgnored &&
      `As colunas base_legal e registro_base_legal ficam de fora. ${PRIVACY_MIGRATION_MISSING}`,
  ].filter((warning): warning is string => typeof warning === 'string');
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1 text-muted-foreground">
        <p className="break-words">
          Colunas reconhecidas: {sheet.recognized.map(({ header, label }) => `${header} → ${label}`).join(', ')}.
        </p>
        {sheet.ignored.length > 0 && <p className="break-words">Colunas ignoradas: {sheet.ignored.join(', ')}.</p>}
      </div>
      {warnings.length > 0 && (
        <div role="status" className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/5 p-3">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
    </div>
  );
}
