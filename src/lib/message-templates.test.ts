import { describe, expect, it } from 'vitest';
import {
  MESSAGE_VARIABLES,
  messageContext,
  pendingVariables,
  renderTemplate,
  templateVariables,
  type MessageContext,
} from '@/lib/message-templates';

const FULL: MessageContext = {
  primeiro_nome: 'Ana',
  nome: 'Ana Souza',
  empresa: 'Padaria Boa Massa',
  oportunidade: 'Site novo',
  responsavel: 'Bruno Lima',
  meu_nome: 'Carla Dias',
  organizacao: 'Agência Exemplo',
};

describe('renderTemplate', () => {
  it('troca as sete variáveis', () => {
    expect(MESSAGE_VARIABLES.map((variable) => variable.key)).toEqual([
      'primeiro_nome',
      'nome',
      'empresa',
      'oportunidade',
      'responsavel',
      'meu_nome',
      'organizacao',
    ]);
    const text = MESSAGE_VARIABLES.map((variable) => `{{${variable.key}}}`).join(' | ');
    expect(renderTemplate(text, FULL)).toEqual({
      text: 'Ana | Ana Souza | Padaria Boa Massa | Site novo | Bruno Lima | Carla Dias | Agência Exemplo',
      missing: [],
      unknown: [],
    });
  });

  it('aceita espaços e maiúsculas dentro das chaves', () => {
    expect(renderTemplate('Olá, {{ Primeiro_Nome }}! {{EMPRESA}}', FULL).text).toBe('Olá, Ana! Padaria Boa Massa');
  });

  it('deixa no texto a variável sem dado e a desconhecida, e lista as duas', () => {
    const result = renderTemplate('{{primeiro_nome}}, da {{empresa}}: {{ver anexo}} e {{cupom}}', {
      ...FULL,
      empresa: '  ',
    });
    expect(result).toEqual({
      text: 'Ana, da {{empresa}}: {{ver anexo}} e {{cupom}}',
      missing: ['empresa'],
      unknown: ['ver anexo', 'cupom'],
    });
  });

  it('faz uma passada só: um valor com {{…}} não é trocado de novo', () => {
    expect(renderTemplate('Olá, {{nome}} da {{empresa}}', { ...FULL, nome: '{{empresa}}' }).text).toBe(
      'Olá, {{empresa}} da Padaria Boa Massa',
    );
  });

  it('não interpreta os padrões especiais de replace no valor', () => {
    expect(renderTemplate('Valor: {{oportunidade}}', { oportunidade: 'R$ 100 $& $1 $$' }).text).toBe(
      'Valor: R$ 100 $& $1 $$',
    );
  });

  it('troca quebras de linha e tabulações do valor por um espaço', () => {
    expect(renderTemplate('[{{empresa}}]', { empresa: ' Padaria\nBoa\t\tMassa ' }).text).toBe('[Padaria Boa Massa]');
  });

  it('devolve igual um texto sem variável', () => {
    const text = 'Oi! Tudo bem? {chaves simples} e [colchetes] ficam.';
    expect(renderTemplate(text, {})).toEqual({ text, missing: [], unknown: [] });
  });
});

describe('templateVariables', () => {
  it('separa as variáveis do CRM das desconhecidas, sem repetir', () => {
    expect(templateVariables('{{nome}} {{ NOME }} {{empresa}} {{desconto}} {{desconto}}')).toEqual({
      known: ['nome', 'empresa'],
      unknown: ['desconto'],
    });
  });
});

describe('pendingVariables', () => {
  it('lista o que sobrou no texto revisado, com o motivo', () => {
    expect(pendingVariables('{{empresa}} {{cupom}} {{primeiro_nome}} {{empresa}}', { primeiro_nome: null })).toEqual([
      { token: '{{empresa}}', reason: 'sem empresa nesta mensagem' },
      { token: '{{cupom}}', reason: 'variável desconhecida' },
      { token: '{{primeiro_nome}}', reason: 'esta mensagem não tem contato' },
    ]);
  });

  it('libera quando a pessoa completa ou apaga', () => {
    expect(pendingVariables('Olá, Ana, da Padaria.', {})).toEqual([]);
  });
});

describe('messageContext', () => {
  it('monta o contexto a partir dos dados da tela', () => {
    expect(
      messageContext({
        contact: { first_name: ' Ana Maria ', last_name: 'Souza' },
        companyName: 'Padaria',
        dealTitle: 'Site',
        ownerName: 'Bruno',
        myName: 'Carla',
        organizationName: 'Agência',
      }),
    ).toEqual({
      primeiro_nome: 'Ana',
      nome: 'Ana Maria Souza',
      empresa: 'Padaria',
      oportunidade: 'Site',
      responsavel: 'Bruno',
      meu_nome: 'Carla',
      organizacao: 'Agência',
    });
  });

  it('sem contato (canal da empresa), as variáveis do contato ficam sem dado', () => {
    const context = messageContext({ companyName: 'Padaria', organizationName: 'Agência' });
    expect(context.primeiro_nome).toBeNull();
    expect(context.nome).toBeNull();
    expect(renderTemplate('Olá, {{primeiro_nome}}', context).missing).toEqual(['primeiro_nome']);
  });
});
