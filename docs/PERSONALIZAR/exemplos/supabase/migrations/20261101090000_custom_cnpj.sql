-- Exemplo de docs/PERSONALIZAR/CAMPO.md: o CNPJ da empresa cliente, um campo novo numa tabela da base.
-- Guardado só com os 14 dígitos, sem pontuação (a tela formata e confere a mesma regra antes de salvar). Não é dado
-- pessoal: não entra na anonimização nem na exportação do titular.
-- public.companies já tem grant de tabela inteira para authenticated e a RLS por organização: a coluna nova já é lida e
-- gravada por quem edita empresas, com as mesmas regras das outras colunas.
alter table public.companies add column custom_cnpj text
 constraint custom_companies_cnpj_digits check (custom_cnpj is null or custom_cnpj ~ '^[0-9]{14}$');
-- Um CNPJ por empresa cliente na organização (o índice também deixa rápida a busca pelo número).
create unique index custom_companies_cnpj on public.companies(org_id, custom_cnpj) where custom_cnpj is not null;
