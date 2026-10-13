import { describe, expect, it } from 'vitest';
import { EMAIL_CODE, EMAIL_LINK_TYPES, emailLinkFromHash, normalizeEmailCode } from './email-link';

const HASH = '3f9a1c27b84e5d6030c1f2e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0';

describe('link do e-mail no fragmento da URL', () => {
  it('sem token_hash, não é um link do e-mail', () => {
    expect(emailLinkFromHash('')).toBeNull();
    expect(emailLinkFromHash('#access_token=abc&type=signup')).toBeNull();
    expect(emailLinkFromHash('#error=access_denied&error_code=otp_expired')).toBeNull();
  });

  it.each(EMAIL_LINK_TYPES)('lê o token e o tipo %s', (type) => {
    expect(emailLinkFromHash(`#token_hash=${HASH}&type=${type}`)).toEqual({ tokenHash: HASH, type });
  });

  it('aceita o token com o prefixo do PKCE e sem o # inicial', () => {
    expect(emailLinkFromHash(`token_hash=pkce_${HASH}&type=email`)).toEqual({
      tokenHash: `pkce_${HASH}`,
      type: 'email',
    });
  });

  it.each([
    `#token_hash=${HASH}`,
    `#token_hash=${HASH}&type=email_change`,
    `#token_hash=${HASH}&type=signup`,
    '#token_hash=&type=email',
    `#token_hash=${HASH}%22%3E&type=email`,
  ])('link incompleto ou alterado: %s', (hash) => {
    expect(emailLinkFromHash(hash)).toEqual({ incomplete: true });
  });
});

describe('código do e-mail', () => {
  it('aceita de 6 a 10 dígitos, depois de tirar espaços, hifens e pontos', () => {
    expect(normalizeEmailCode(' 4820 3917 ')).toBe('48203917');
    expect(normalizeEmailCode('482-039.17')).toBe('48203917');
    for (const code of ['123456', '1234567890']) expect(EMAIL_CODE.test(code)).toBe(true);
    for (const code of ['12345', '12345678901', '12a456', '']) expect(EMAIL_CODE.test(code)).toBe(false);
  });
});
