export type DealStatus = 'open' | 'won' | 'lost';
export type Deal = {
  id: string;
  org_id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value: number;
  currency: string;
  contact_id: string | null;
  company_id: string | null;
  owner_id: string | null;
  close_date: string | null;
  probability: number | null;
  status: DealStatus;
  lost_reason: string | null;
  closed_at: string | null;
  stage_entered_at: string;
  created_at: string;
  updated_at: string;
  /**
   * Item 1.16: itens da oportunidade. Com itens (item_count > 0), `value` é o valor do contrato = total único +
   * mensalidade × meses, e as partes vêm aqui; sem itens, as partes ficam nulas e `value` é o digitado. Opcionais: num
   * banco sem a migração, `select('*')` não as traz, e a tela conta como sem itens.
   */
  item_count?: number;
  one_time_value?: number | null;
  monthly_value?: number | null;
  contract_months?: number | null;
};
/** Cobrança de um item do catálogo ou da oportunidade (item 1.16). */
export type DealItemBilling = 'one_time' | 'monthly';
/** Item do catálogo (tabela products, item 1.16). `archived_at` preenchido = fora das escolhas dos itens novos. */
export type CatalogProduct = {
  id: string;
  org_id: string;
  name: string;
  code: string | null;
  kind: 'product' | 'service';
  unit: string | null;
  price: number;
  billing: DealItemBilling;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
/** Item gravado de uma oportunidade (tabela deal_items, item 1.16); `line_total` é calculado pelo banco. */
export type DealItem = {
  id: string;
  org_id: string;
  deal_id: string;
  product_id: string | null;
  position: number;
  name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_type: 'percent' | 'amount' | null;
  discount_value: number;
  billing: DealItemBilling;
  line_total: number;
  created_at: string;
  updated_at: string;
};
/**
 * Item no editor (rascunho), com os textos como a pessoa digita: quantidade ("1,5"), preço no padrão brasileiro (D7)
 * e desconto ("10" para 10%, "50,00" para R$ 50,00). O id vem do navegador e é mantido do rascunho à gravação.
 */
export type DealItemDraft = {
  id: string;
  product_id: string | null;
  name: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_type: 'none' | 'percent' | 'amount';
  discount_value: string;
  billing: DealItemBilling;
};
export type DealPipeline = { id: string; org_id: string; name: string; currency: string; is_default: boolean };
export type DealStage = {
  id: string;
  org_id: string;
  pipeline_id: string;
  name: string;
  order: number;
  color: string | null;
  win_probability: number;
};
/** Pessoa da equipe no Pipeline; `active` falso para quem foi desativado (item 1.2). */
export type DealPerson = { id: string; full_name: string; active?: boolean };
/**
 * Contato e empresa no Pipeline. Telefone, e-mail e a marca "Não contatar" chegaram com os canais do item 1.9; num
 * banco sem a migração, a marca não vem e conta como falsa.
 */
export type DealContact = {
  id: string;
  full_name: string;
  company_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  owner_id?: string | null;
  do_not_contact?: boolean;
  do_not_contact_at?: string | null;
  do_not_contact_by?: string | null;
  do_not_contact_reason?: string | null;
  /** Item 1.10: o contato anonimizado sai do seletor de contato. */
  anonymized_at?: string | null;
};
export type DealCompany = {
  id: string;
  name: string;
  phone?: string | null;
  owner_id?: string | null;
  do_not_contact?: boolean;
  do_not_contact_at?: string | null;
  do_not_contact_by?: string | null;
  do_not_contact_reason?: string | null;
};
/**
 * Próxima ação de uma oportunidade (consulta 'deal-actions' do Pipeline). Os vínculos e a versão vêm junto para os
 * canais e o "Concluir e agendar a próxima" do painel (item 1.9).
 */
export type DealActivity = {
  id: string;
  org_id: string;
  deal_id: string | null;
  title: string;
  type: string;
  due_date: string | null;
  end_date?: string | null;
  completed_at: string | null;
  user_id: string | null;
  contact_id?: string | null;
  company_id?: string | null;
  updated_at?: string;
};
export type DealHistory = {
  id: string;
  org_id: string;
  deal_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  changed_by: string | null;
  created_at: string;
};
export type DealDraft = {
  title: string;
  pipeline_id: string;
  stage_id: string;
  value: string;
  currency: string;
  contact_id: string;
  company_id: string;
  owner_id: string;
  close_date: string;
  /** Vazio = herda a probabilidade da etapa (D8). */
  probability: string;
  status: DealStatus;
  lost_reason: string;
  /** Dia do fechamento (AAAA-MM-DD), editável só em oportunidade ganha ou perdida. */
  closed_at: string;
};
export type DealFilters = { pipelineId: string; ownerId: string; status: string; search: string };
