import { describe, expect, it } from 'vitest';
import { encodingNotice, importButtonLabel, newCompaniesNotice, plural } from './text';

describe('textos da importação', () => {
  it('contagens em pt-BR, com o singular', () => {
    expect(plural(1, 'linha', 'linhas')).toBe('1 linha');
    expect(plural(2441, 'linha', 'linhas')).toBe('2.441 linhas');
    expect(importButtonLabel(1, false)).toBe('Importar 1 contato');
    expect(importButtonLabel(4981, false)).toBe('Importar 4.981 contatos');
    expect(importButtonLabel(500, true)).toBe('Continuar importação de 500 contatos');
  });

  it('o formato aparece só quando não é UTF-8, sem o nome técnico da codificação, e manda conferir os acentos', () => {
    expect(encodingNotice('utf-8')).toBeNull();
    expect(encodingNotice('windows-1252')).toBe(
      'Arquivo no formato CSV comum do Excel. Confira os acentos nos nomes; se algum aparecer trocado, salve a planilha como CSV UTF-8 e escolha o arquivo de novo.',
    );
    expect(encodingNotice('utf-16le')).toBe('Arquivo no formato Texto Unicode do Excel.');
    for (const encoding of ['windows-1252', 'utf-16le', 'utf-16be'] as const)
      expect(encodingNotice(encoding)).not.toMatch(/Windows-1252|UTF-16/);
  });

  it('as empresas novas: até três nomes, o resto contado e sem ponto duplo', () => {
    expect(newCompaniesNotice(['Acme Ltda.'])).toBe('1 empresa nova: Acme Ltda.');
    expect(newCompaniesNotice(['Alfa', 'Beta'])).toBe('2 empresas novas: Alfa, Beta.');
    expect(newCompaniesNotice(['Alfa', 'Beta', 'Gama', 'Delta', 'Épsilon'])).toBe(
      '5 empresas novas: Alfa, Beta, Gama e mais 2.',
    );
  });
});
