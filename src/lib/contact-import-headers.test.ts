import { describe, expect, it } from 'vitest';
import {
  CONTACT_IMPORT_FIELDS,
  CONTACT_TEMPLATE_HEADERS,
  IMPORT_RESULT_HEADERS,
  mapContactHeaders,
  MISSING_NAME_COLUMN,
  normalizeHeader,
  UNNAMED_COLUMN,
} from '@/lib/contact-import-headers';

describe('normalizeHeader', () => {
  it.each([
    ['E-mail', 'e mail'],
    ['e_mail', 'e mail'],
    ['E-MAIL *', 'e mail'],
    ['  Responsável  ', 'responsavel'],
    ['Observações:', 'observacoes'],
    ['NÃO CONTATAR', 'nao contatar'],
    ['nao_contatar', 'nao contatar'],
    ['Razão  social', 'razao social'],
    ['', ''],
  ])('%s vira %s', (header, expected) => {
    expect(normalizeHeader(header)).toBe(expected);
  });
});

describe('mapContactHeaders', () => {
  it('leva cada sinônimo de cada campo ao campo certo', () => {
    for (const definition of CONTACT_IMPORT_FIELDS)
      for (const synonym of definition.synonyms) {
        const headers = definition.field === 'first_name' ? [synonym] : ['nome', synonym];
        const result = mapContactHeaders(headers);
        expect(result.error, `${synonym} → ${definition.field}`).toBeNull();
        expect(result.mapping[definition.field], `${synonym} → ${definition.field}`).toBe(headers.length - 1);
      }
  });

  it('não diferencia acento, maiúscula, pontuação, espaço e asterisco', () => {
    const result = mapContactHeaders(['NOME COMPLETO *', 'E-Mail', 'Celular/WhatsApp', 'Responsável', 'Não-Contatar']);
    expect(result.error).toBeNull();
    expect(result.mapping).toEqual({ first_name: 0, email: 1, phone: 2, owner: 3, do_not_contact: 4 });
    expect(result.recognized.map(({ header, label }) => `${header} → ${label}`)).toEqual([
      'NOME COMPLETO * → Nome',
      'E-Mail → E-mail',
      'Celular/WhatsApp → Telefone',
      'Responsável → Responsável',
      'Não-Contatar → Não contatar',
    ]);
  });

  it('continua aceitando os nomes em inglês do item 0.5', () => {
    expect(mapContactHeaders(['first_name', 'last_name', 'email', 'phone']).mapping).toEqual({
      first_name: 0,
      last_name: 1,
      email: 2,
      phone: 3,
    });
  });

  it('recusa o arquivo sem coluna de nome', () => {
    expect(mapContactHeaders(['email', 'telefone']).error).toBe(MISSING_NAME_COLUMN);
    expect(mapContactHeaders(['Relatório de clientes']).error).toBe(MISSING_NAME_COLUMN);
  });

  it('recusa duas colunas para o mesmo campo, nomeando as duas', () => {
    expect(mapContactHeaders(['Nome', 'Telefone', 'Celular']).error).toBe(
      'As colunas “Telefone” e “Celular” são o mesmo campo do CRM (telefone). Deixe só uma e importe de novo.',
    );
    expect(mapContactHeaders(['Nome', 'Razão social', 'Nome fantasia']).error).toBe(
      'As colunas “Razão social” e “Nome fantasia” são o mesmo campo do CRM (empresa). Deixe só uma e importe de novo.',
    );
    expect(mapContactHeaders(['Nome', 'Nome completo']).error).toContain('“Nome” e “Nome completo”');
  });

  it('lista as colunas desconhecidas e ignora as da planilha de não importados', () => {
    const result = mapContactHeaders([...IMPORT_RESULT_HEADERS, 'nome', 'Data de nascimento', '', 'Cidade']);
    expect(result.error).toBeNull();
    expect(result.mapping).toEqual({ first_name: 3 });
    expect(result.ignored).toEqual(['Data de nascimento', UNNAMED_COLUMN, 'Cidade']);
  });

  it('o modelo tem as 13 colunas, todas reconhecidas por elas mesmas', () => {
    expect(CONTACT_TEMPLATE_HEADERS).toEqual([
      'nome',
      'sobrenome',
      'email',
      'telefone',
      'empresa',
      'cargo',
      'origem',
      'responsavel',
      'relacionamento',
      'observacoes',
      'nao_contatar',
      'base_legal',
      'registro_base_legal',
    ]);
    const result = mapContactHeaders(CONTACT_TEMPLATE_HEADERS);
    expect(result.error).toBeNull();
    expect(result.ignored).toEqual([]);
    expect(Object.keys(result.mapping)).toHaveLength(13);
  });

  it('os exemplos de "Como usar" são sinônimos do próprio campo', () => {
    for (const definition of CONTACT_IMPORT_FIELDS) {
      expect(definition.examples.length).toBeGreaterThan(0);
      for (const example of definition.examples) expect(definition.synonyms).toContain(normalizeHeader(example));
    }
  });

  it('cada sinônimo é de um campo só, e a coluna do modelo normalizada está entre os sinônimos', () => {
    const all = CONTACT_IMPORT_FIELDS.flatMap((definition) => definition.synonyms);
    expect(new Set(all).size).toBe(all.length);
    for (const definition of CONTACT_IMPORT_FIELDS) {
      expect(definition.synonyms).toContain(normalizeHeader(definition.column));
      for (const synonym of definition.synonyms) expect(normalizeHeader(synonym)).toBe(synonym);
    }
  });
});
