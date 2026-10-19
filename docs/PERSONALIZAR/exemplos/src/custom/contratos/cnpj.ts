// Exemplo de docs/PERSONALIZAR/CAMPO.md: as regras do CNPJ na tela, iguais ao check da migração
// 20261101090000_custom_cnpj.sql (só os 14 dígitos são gravados). Funções puras, testadas no Vitest.

/** Só os dígitos do que a pessoa digitou ("12.345.678/0001-90" vira "12345678000190"). */
export function cnpjDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** O CNPJ no formato de leitura, 12.345.678/0001-90; com outro tamanho, os dígitos como estão. */
export function formatCnpj(value: string | null | undefined): string {
  const digits = cnpjDigits(value ?? '');
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

/** O valor a gravar (nulo quando vazio) ou a mensagem para a pessoa corrigir. */
export function cnpjToSave(value: string): { value: string | null; problem: string | null } {
  const digits = cnpjDigits(value);
  if (!digits) return { value: null, problem: null };
  if (digits.length !== 14) return { value: null, problem: 'O CNPJ tem 14 dígitos. Confira o número.' };
  return { value: digits, problem: null };
}
