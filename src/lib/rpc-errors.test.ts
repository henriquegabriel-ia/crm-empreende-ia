import { describe, expect, it } from 'vitest';
import { rpcRefusalMessage } from './rpc-errors';
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
