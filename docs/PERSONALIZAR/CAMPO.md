# Campo novo numa tabela da base

Exemplo: o CNPJ da empresa cliente, em **Empresas**. Leia antes o [índice da personalização](README.md) e a seção 4 de [Personalizar sem quebrar a atualização](../PROTECAO-ATUALIZACAO.md#4-a-sua-migração). Os arquivos completos estão em [exemplos/](exemplos/supabase/migrations/20261101090000_custom_cnpj.sql).

## 1. A migração

Crie o arquivo `supabase/migrations/<data e hora>_custom_cnpj.sql`, com data e hora posteriores à última migração da pasta (o exemplo se chama `20261101090000_custom_cnpj.sql`, mas não copie o número). A data e a hora são as do momento em que você cria o arquivo (por exemplo, `20261125143000` para 25/11/2026 às 14h30), nunca uma data futura nem a do exemplo: uma migração sua com data à frente das próximas migrações da base faz o `npx supabase@2.119.0 db push` recusá-las na atualização. No Windows, pelo VS Code: botão direito na pasta `supabase/migrations` → **New File**.

<!-- exemplo: supabase/migrations/20261101090000_custom_cnpj.sql -->

```sql
alter table public.companies add column custom_cnpj text
 constraint custom_companies_cnpj_digits check (custom_cnpj is null or custom_cnpj ~ '^[0-9]{14}$');
-- Um CNPJ por empresa cliente na organização (o índice também deixa rápida a busca pelo número).
create unique index custom_companies_cnpj on public.companies(org_id, custom_cnpj) where custom_cnpj is not null;
```

- O nome da coluna, da restrição e do índice começa com `custom_`: uma versão futura da base nunca cria um objeto com esse nome.
- A regra (só os 14 dígitos) fica no banco, num `check`. A tela confere a mesma regra antes de salvar, para a mensagem ser clara, mas quem protege é o banco.
- Aplique no projeto de desenvolvimento, conferindo antes qual projeto está ligado ([Testar a sua migração](README.md#testar-a-sua-migração)), e rode `npm run gen:types`: o tipo de `companies` ganha `custom_cnpj: string | null` ([o tipo gerado do exemplo](exemplos/database.types.ts)).

### Quando a tabela pede mais

- **`companies`, `contacts`, `deals`, `activities` e as outras tabelas com `grant` da tabela inteira**: a coluna nova já é lida e gravada por quem edita a tabela, com a mesma RLS. Nada a acrescentar.
- **`organizations`, `profiles`, `invitations` e `automation_logs`** têm permissão por coluna: acrescente `grant select (custom_<nome>) on public.<tabela> to authenticated` e, se a tela grava, `grant update (custom_<nome>) ...`.
- **`deals`**: o formulário grava pela função `save_deal`, que recusa campo desconhecido. Grave a coluna nova com um `update` à parte, depois do `save_deal`, na sua tela.
- **Dado pessoal** (um documento da pessoa, por exemplo): a coluna precisa ser limpa na anonimização. Use o gancho `private.custom_after_contact_saved` para apagar o valor quando `p_new.anonymized_at` vier preenchido ([LGPD da instância](../LGPD-INSTANCIA.md)). A exportação do titular não leva colunas suas sem uma mudança da base: anote esse limite.

## 2. A regra na tela

As funções puras ficam em `src/custom/contratos/cnpj.ts`, testadas no Vitest:

<!-- exemplo: src/custom/contratos/cnpj.ts -->

```ts
export function cnpjToSave(value: string): { value: string | null; problem: string | null } {
  const digits = cnpjDigits(value);
  if (!digits) return { value: null, problem: null };
  if (digits.length !== 14) return { value: null, problem: 'O CNPJ tem 14 dígitos. Confira o número.' };
  return { value: digits, problem: null };
}
```

O campo é um componente seu, `src/custom/contratos/CnpjField.tsx`, com os componentes do design system (`Input`, `Label`): formata ao sair do campo e mostra o problema.

## 3. A linha no formulário da base

O formulário de empresa é `src/components/commercial/RecordEditor.tsx`. Mude só o necessário, sempre com o comentário `custom:`, para achar e resolver um conflito na atualização (mantenha as duas partes):

```tsx
// custom: cnpj
import { CnpjField } from '@/custom/contratos/CnpjField';
import { cnpjToSave, formatCnpj } from '@/custom/contratos/cnpj';
```

No estado do formulário, `custom_cnpj: formatCnpj(company?.custom_cnpj), // custom: cnpj`; na validação, `const cnpj = cnpjToSave(form.custom_cnpj); if (cnpj.problem) { setError(cnpj.problem); return; } // custom: cnpj`; no `payload` de empresas, `custom_cnpj: cnpj.value, // custom: cnpj`; e, depois do campo "Site", `<CnpjField value={form.custom_cnpj} onChange={(value) => change('custom_cnpj', value)} /> {/* custom: cnpj */}`.

## 4. Ajuda e testes

- Se o campo muda o que a equipe faz, acrescente uma pergunta à Central de ajuda (como em [Tela nova](TELA.md#4-ajuda)).
- O teste do campo é `src/custom/contratos/CnpjField.test.tsx`. Rode `npm test` e o resto da [suíte](../../AGENTS.md#como-validar).
