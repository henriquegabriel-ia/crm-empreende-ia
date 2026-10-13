import { describe, expect, it } from 'vitest';
import { INCOMPLETE_INVITE_MESSAGE, isInvitationId, normalizeInvitationId, parseInviteLink } from './invite-link';

const ID = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';

describe('ID do convite', () => {
  it('aceita o UUID com maiúsculas e espaços nas pontas e devolve em minúsculas', () => {
    expect(isInvitationId(ID)).toBe(true);
    expect(normalizeInvitationId(`  ${ID.toUpperCase()} `)).toBe(ID);
  });

  it.each([null, undefined, '', 'convite-1', ID.slice(0, -1), `${ID}0`, `${ID}/`, 'g'.repeat(36)])(
    'recusa %s',
    (value) => {
      expect(isInvitationId(value)).toBe(false);
      expect(normalizeInvitationId(value)).toBeNull();
    },
  );
});

describe('parseInviteLink', () => {
  it.each([
    [ID, 'o UUID puro'],
    [` ${ID.toUpperCase()}\n`, 'o UUID com maiúsculas, espaços e quebra de linha'],
    [`https://crm.empresa.com.br/?invite=${ID}`, 'o link inteiro'],
    [`https://crm.empresa.com.br/?next=%2Fpipeline&invite=${ID}#topo`, 'o link com outros parâmetros e âncora'],
    [`http://localhost:8080/?invite=${ID.toUpperCase()}`, 'o link de outra origem, com o ID em maiúsculas'],
    [`crm.empresa.com.br/?invite=${ID}`, 'o link sem https://'],
    [`<https://crm.empresa.com.br/?invite=${ID}>`, 'o link entre < >, como alguns e-mails mostram'],
    [`https://crm.empresa.com.br/?invite=${ID}&invite=${ID.toUpperCase()}`, 'o mesmo convite repetido'],
  ])('lê %s (%s)', (input) => {
    expect(parseInviteLink(input)).toEqual({ ok: true, id: ID });
  });

  it.each([
    ['', 'vazio'],
    ['   ', 'só espaços'],
    ['https://crm.empresa.com.br/', 'link sem convite'],
    [`https://crm.empresa.com.br/?invite=${ID.slice(0, 20)}`, 'link cortado'],
    [
      `https://crm.empresa.com.br/?invite=${ID}&invite=0f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60`,
      'dois convites diferentes',
    ],
    ['meu convite chegou por e-mail', 'texto sem ID'],
    [`https://crm.empresa.com.br/?next=${ID}`, 'ID em outro parâmetro'],
  ])('recusa %s (%s) com a mensagem de link incompleto', (input) => {
    expect(parseInviteLink(input)).toEqual({ ok: false, message: INCOMPLETE_INVITE_MESSAGE });
  });
});
