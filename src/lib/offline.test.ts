import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserOffline,
  isOfflineRequestError,
  OFFLINE_BANNER_MESSAGE,
  OFFLINE_REQUEST_MESSAGE,
  OfflineRequestError,
} from './offline';
import { errorMessage } from '@/components/pipeline/data';
import { relationshipError } from '@/lib/contact-model';

afterEach(() => vi.restoreAllMocks());

describe('mensagens sem conexão', () => {
  it('não prometem sincronização nem envio posterior', () => {
    expect(OFFLINE_BANNER_MESSAGE).toBe('Sem conexão. As alterações não serão salvas até a conexão voltar.');
    for (const message of [OFFLINE_BANNER_MESSAGE, OFFLINE_REQUEST_MESSAGE]) {
      expect(message).not.toMatch(/sincroniz|quando reconectar|serão enviad/i);
    }
    expect(OFFLINE_REQUEST_MESSAGE).toMatch(/Nada foi salvo/);
  });

  it('reconhece a recusa no próprio erro, no erro do PostgREST e no do Auth', () => {
    expect(isOfflineRequestError(new OfflineRequestError())).toBe(true);
    // O PostgREST grava `${name}: ${message}` quando o fetch rejeita; o Auth repete a mensagem.
    expect(isOfflineRequestError({ message: `OfflineRequestError: ${OFFLINE_REQUEST_MESSAGE}`, code: '' })).toBe(true);
    expect(isOfflineRequestError({ name: 'AuthRetryableFetchError', message: OFFLINE_REQUEST_MESSAGE })).toBe(true);
    for (const other of [new TypeError('Failed to fetch'), { message: 'permission denied' }, null, 'texto', undefined])
      expect(isOfflineRequestError(other)).toBe(false);
  });

  it('as mensagens de erro compartilhadas mostram o motivo sem o prefixo técnico', () => {
    const postgrest = { message: `OfflineRequestError: ${OFFLINE_REQUEST_MESSAGE}`, details: '', hint: '', code: '' };
    expect(errorMessage(postgrest)).toBe(OFFLINE_REQUEST_MESSAGE);
    expect(relationshipError(postgrest)).toBe(`${OFFLINE_REQUEST_MESSAGE} Seu preenchimento foi preservado.`);
    // Uma falha de rede comum continua com a mensagem genérica de conexão.
    expect(errorMessage({ message: 'TypeError: Failed to fetch' })).toBe(
      'Não foi possível conectar. Verifique sua conexão e tente novamente.',
    );
  });

  it('só considera sem conexão quando o navegador diz explicitamente', () => {
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get');
    onLine.mockReturnValue(false);
    expect(browserOffline()).toBe(true);
    onLine.mockReturnValue(true);
    expect(browserOffline()).toBe(false);
  });
});
