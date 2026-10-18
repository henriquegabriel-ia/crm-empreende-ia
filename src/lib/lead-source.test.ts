import { describe, expect, it } from 'vitest';
import {
  LEAD_SOURCE_FILTER_LABELS,
  LEAD_SOURCES,
  isLeadSourceFilter,
  leadSourceChoice,
  leadSourceFromChoice,
  leadSourceKey,
  leadSourceLabel,
  matchesLeadSource,
} from './lead-source';
import { ACTIVITY_LABELS } from './contact-model';

// Item 1.14: a origem do lead em lista fixa, com o valor livre antigo preservado.
describe('origem do lead', () => {
  it('a lista é a do roteiro, em pt-BR, com os nomes dos canais do item 1.9', () => {
    expect(LEAD_SOURCES.map((source) => source.label)).toEqual(['WhatsApp', 'Telefone', 'E-mail', 'Site', 'Indicação']);
    expect(ACTIVITY_LABELS.whatsapp).toBe('WhatsApp');
    expect(ACTIVITY_LABELS.email).toBe('E-mail');
  });

  it('reconhece a origem pelo texto inteiro, sem acento, maiúscula, espaço nem pontuação', () => {
    for (const [value, key] of [
      ['WhatsApp', 'whatsapp'],
      [' whats app ', 'whatsapp'],
      ['Zap', 'whatsapp'],
      ['telefone', 'phone'],
      ['Ligação', 'phone'],
      ['e-mail', 'email'],
      ['EMAIL', 'email'],
      ['Site', 'website'],
      ['web site', 'website'],
      ['indicacao', 'referral'],
      ['Indicada', 'referral'],
    ] as const)
      expect(leadSourceKey(value), value).toBe(key);
    for (const value of ['Indicação do João', 'Feira de outubro', 'Instagram', 'celular', '', '   ', null, undefined])
      expect(leadSourceKey(value), String(value)).toBeNull();
  });

  it('mostra o nome da lista ou, fora dela, o texto como foi escrito, numa linha', () => {
    expect(leadSourceLabel('whatsapp')).toBe('WhatsApp');
    expect(leadSourceLabel('INDICACAO')).toBe('Indicação');
    expect(leadSourceLabel('  Feira   de\noutubro ')).toBe('Feira de outubro');
    expect(leadSourceLabel('Indicação de [anonimizado]')).toBe('Indicação de [anonimizado]');
    expect(leadSourceLabel('  ')).toBeNull();
    expect(leadSourceLabel(null)).toBeNull();
  });

  it('filtra por uma origem da lista, pelas de fora dela e pelas vazias', () => {
    const values = ['WhatsApp', 'zap', 'Feira', 'Indicação', null, ' '];
    const pass = (filter: Parameters<typeof matchesLeadSource>[1]) =>
      values.filter((value) => matchesLeadSource(value, filter));
    expect(pass('all')).toEqual(values);
    expect(pass('whatsapp')).toEqual(['WhatsApp', 'zap']);
    expect(pass('referral')).toEqual(['Indicação']);
    expect(pass('other')).toEqual(['Feira']);
    expect(pass('none')).toEqual([null, ' ']);
    expect(pass('phone')).toEqual([]);
  });

  it('o filtro tem os rótulos da tela e recusa valores desconhecidos', () => {
    expect(Object.values(LEAD_SOURCE_FILTER_LABELS)).toEqual([
      'Todas as origens',
      'WhatsApp',
      'Telefone',
      'E-mail',
      'Site',
      'Indicação',
      'Outras origens',
      'Sem origem',
    ]);
    expect(isLeadSourceFilter('other')).toBe(true);
    expect(isLeadSourceFilter('toString')).toBe(false);
    expect(isLeadSourceFilter('tv')).toBe(false);
    expect(isLeadSourceFilter(undefined)).toBe(false);
  });

  it('o campo abre a escolha pelo valor gravado e grava o nome da lista ou o texto de "Outra"', () => {
    expect(leadSourceChoice('zap')).toEqual({ choice: 'whatsapp', other: '' });
    expect(leadSourceChoice(' Feira ')).toEqual({ choice: 'other', other: 'Feira' });
    expect(leadSourceChoice(null)).toEqual({ choice: 'none', other: '' });
    expect(leadSourceFromChoice('referral', 'ignorado')).toBe('Indicação');
    expect(leadSourceFromChoice('other', ' Instagram ')).toBe('Instagram');
    expect(leadSourceFromChoice('other', 'site')).toBe('Site');
    expect(leadSourceFromChoice('other', '')).toBe('');
    expect(leadSourceFromChoice('none', 'Feira')).toBe('');
  });
});
