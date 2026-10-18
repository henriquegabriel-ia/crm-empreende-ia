import { describe, expect, it } from 'vitest';
import {
  CATALOG_MIGRATION_MISSING,
  catalogMigrationMissing,
  CHANNELS_MIGRATION_MISSING,
  channelsMigrationMissing,
  PRIVACY_MIGRATION_MISSING,
  privacyMigrationMissing,
  rpcRefusalMessage,
} from './rpc-errors';
import { OFFLINE_REQUEST_MESSAGE } from './offline';

const FALLBACK = 'Não foi possível concluir. Seu preenchimento foi preservado.';

describe('rpcRefusalMessage', () => {
  it('mostra a recusa do banco (raise exception, P0001) como está', () => {
    expect(rpcRefusalMessage({ code: 'P0001', message: 'Esta pessoa já faz parte da equipe.' }, FALLBACK)).toBe(
      'Esta pessoa já faz parte da equipe.',
    );
  });

  it('sem conexão, a mensagem de sempre', () => {
    expect(rpcRefusalMessage({ code: '', message: `OfflineRequestError: ${OFFLINE_REQUEST_MESSAGE}` }, FALLBACK)).toBe(
      OFFLINE_REQUEST_MESSAGE,
    );
  });

  it.each([
    { code: '42501', message: 'permission denied for function create_invitation' },
    { code: 'PGRST202', message: 'Could not find the function public.create_invitation' },
    { code: 'P0001', message: '  ' },
    { message: 'TypeError: Failed to fetch' },
    null,
    'texto',
  ])('as demais falhas viram o texto de reserva (%j)', (error) => {
    expect(rpcRefusalMessage(error, FALLBACK)).toBe(FALLBACK);
  });
});

// Item 1.9: o frontend novo num banco ainda sem a migração dos canais.
describe('channelsMigrationMissing', () => {
  it.each([
    { code: 'PGRST202', message: 'Could not find the function public.complete_activity' },
    { code: 'PGRST204', message: "Could not find the 'outcome' column of 'activities' in the schema cache" },
    { code: '42703', message: 'column "do_not_contact" does not exist' },
    { code: '23514', message: 'new row for relation "activities" violates check constraint "activities_type_check"' },
  ])('reconhece %j', (error) => {
    expect(channelsMigrationMissing(error)).toBe(true);
  });

  it.each([
    { code: '23514', message: 'violates check constraint "activities_outcome_valid"' },
    { code: 'P0001', message: 'Esta atividade mudou ou não está mais disponível.' },
    { code: '42501', message: 'permission denied' },
    null,
    'texto',
  ])('não confunde %j com a migração ausente', (error) => {
    expect(channelsMigrationMissing(error)).toBe(false);
  });

  it('a mensagem diz o que fazer, em pt-BR', () => {
    expect(CHANNELS_MIGRATION_MISSING).toBe(
      'Este CRM ainda não tem a atualização dos canais. Peça a quem administra para aplicar a migração mais recente.',
    );
  });
});

// Item 1.10: o frontend novo num banco ainda sem a migração de privacidade.
describe('privacyMigrationMissing', () => {
  it.each([
    {
      code: 'PGRST202',
      message: 'Could not find the function public.export_contact_data(p_contact_id) in the schema cache',
    },
    {
      code: 'PGRST202',
      message: 'Could not find the function public.contact_privacy_summary(p_contact_id) in the schema cache',
    },
    {
      code: 'PGRST202',
      message: 'Could not find the function public.anonymize_contact(p_contact_id, p_version) in the schema cache',
    },
    { code: 'PGRST204', message: "Could not find the 'legal_basis' column of 'contacts' in the schema cache" },
    {
      code: 'PGRST204',
      message: "Could not find the 'default_legal_basis' column of 'organizations' in the schema cache",
    },
    { code: '42703', message: 'column contacts.anonymized_at does not exist' },
    { code: '42703', message: 'column organizations.default_legal_basis does not exist' },
    { code: 'PGRST205', message: "Could not find the table 'public.privacy_actions' in the schema cache" },
    { code: '42P01', message: 'relation "public.privacy_actions" does not exist' },
  ])('reconhece %j', (error) => {
    expect(privacyMigrationMissing(error)).toBe(true);
  });

  it.each([
    { code: '42703', message: 'column "do_not_contact" does not exist' },
    { code: 'PGRST202', message: 'Could not find the function public.complete_activity' },
    { code: 'PGRST204', message: "Could not find the 'outcome' column of 'activities' in the schema cache" },
    { code: 'P0001', message: 'Somente donos e administradores anonimizam contatos.' },
    { code: '42501', message: 'permission denied for table privacy_actions' },
    { code: 'PGRST202' },
    null,
    'texto',
  ])('não confunde %j com a migração ausente', (error) => {
    expect(privacyMigrationMissing(error)).toBe(false);
  });

  it('a mensagem diz o que fazer, em pt-BR', () => {
    expect(PRIVACY_MIGRATION_MISSING).toBe(
      'Este CRM ainda não tem a atualização de privacidade (LGPD). Peça a quem administra para aplicar a migração mais recente.',
    );
  });
});

describe('catalogMigrationMissing (item 1.16)', () => {
  it.each([
    { code: 'PGRST205', message: "Could not find the table 'public.products' in the schema cache" },
    { code: '42P01', message: 'relation "public.deal_items" does not exist' },
    {
      code: 'PGRST202',
      message: 'Could not find the function public.save_deal(p_deal_id, p_items) in the schema cache',
    },
    { code: '42703', message: 'column deals.item_count does not exist' },
    { code: 'PGRST204', message: "Could not find the 'monthly_value' column of 'deals' in the schema cache" },
  ])('reconhece %j', (error) => {
    expect(catalogMigrationMissing(error)).toBe(true);
  });

  it.each([
    { code: '42P01', message: 'relation "public.privacy_actions" does not exist' },
    { code: 'P0001', message: 'Uma oportunidade tem no máximo 100 itens.' },
    { code: '42501', message: 'permission denied for table deal_items' },
    { code: '23505', message: 'duplicate key value violates unique constraint "products_org_code"' },
    { code: 'PGRST205' },
    null,
  ])('não confunde %j com a migração ausente', (error) => {
    expect(catalogMigrationMissing(error)).toBe(false);
  });

  it('a mensagem diz o que fazer, em pt-BR', () => {
    expect(CATALOG_MIGRATION_MISSING).toBe(
      'Este CRM ainda não tem a atualização do catálogo. Peça a quem administra para aplicar a migração mais recente.',
    );
  });
});
