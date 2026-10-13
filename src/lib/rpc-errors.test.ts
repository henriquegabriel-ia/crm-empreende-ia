import { describe, expect, it } from 'vitest';
import { CHANNELS_MIGRATION_MISSING, channelsMigrationMissing, rpcRefusalMessage } from './rpc-errors';
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
