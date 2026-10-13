import { describe, expect, it } from 'vitest';
import { FAQ_CATEGORIES } from './faq-content';

// Respostas de acesso da Central de ajuda contra o comportamento do item 1.1 e do reforço de 12/10/2026
// (docs/arquitetura/1.1.md, seções 16.12 e 16.13): a conta nasce pelo link do e-mail e cria a senha no CRM.
const access = FAQ_CATEGORIES.find((category) => category.id === 'acesso')!;
const answer = (question: string) => {
  const item = access.items.find((entry) => entry.q === question);
  if (!item) throw new Error(`Pergunta ausente na Ajuda: ${question}`);
  return item.a;
};
const allAnswers = FAQ_CATEGORIES.flatMap((category) => category.items.map((item) => item.a));

describe('Ajuda: acesso e convites', () => {
  it('nenhuma resposta promete o passo da senha de antes do reforço', () => {
    for (const text of allAnswers) {
      expect(text).not.toMatch(/pode ser a mesma do cadastro/);
      expect(text).not.toMatch(/acessos abertos .* são encerrados/);
      expect(text).not.toMatch(/se cadastra com o e-mail convidado, confirma/);
    }
  });

  it('"Gerar novo link" aparece só para o convite expirado', () => {
    for (const text of allAnswers.filter((entry) => entry.includes('Gerar novo link'))) {
      for (const sentence of text.split(/(?<=[.;])\s/).filter((part) => part.includes('Gerar novo link'))) {
        expect(sentence).toMatch(/expirou|expirado/);
        expect(sentence).not.toMatch(/revogado|trocado/);
      }
    }
  });

  it('a entrada de uma pessoa nova segue o fluxo pelo link do e-mail', () => {
    const text = answer('Como uma pessoa nova entra na equipe?');
    expect(text).toContain('só um dono convida outro dono');
    expect(text).toContain('na aba Cadastrar');
    expect(text).toContain('abre o link de confirmação');
    expect(text).toContain('crie a senha e aceite o convite');
    expect(text).toContain('Enviar link para o meu e-mail');
    expect(text).toContain('cola o link ou só o código do convite');
    expect(text).not.toContain('link inteiro');
  });

  it('o cadastro recusado separa o convite expirado do revogado', () => {
    const text = answer('Recebi um convite e o cadastro foi recusado. E agora?');
    expect(text).toContain('Se o convite expirou, peça a quem administra que use Gerar novo link');
    expect(text).toContain('se foi revogado, que crie outro em Criar convite');
    // O cadastro pelo link não diz se o e-mail já tem conta.
    expect(text).not.toMatch(/já tem conta/);
  });

  it('a recuperação do dono começa pela senha esquecida e cobre o primeiro acesso tomado e o convite de dono', () => {
    const text = answer('Quem administra o CRM perdeu o acesso de dono. Como recuperar?');
    expect(text).toMatch(/^Se só esqueceu a senha, use Esqueceu a senha\?/);
    expect(text).toContain('administradores não alteram o papel de donos');
    expect(text).toContain('outra pessoa ficou com o papel de Dono no primeiro acesso');
    expect(text).toContain('cria um convite de dono');
  });

  it('quem entrou pelo link sem criar a senha sabe como entrar de novo', () => {
    const text = answer('Entrei pelo link do e-mail e não criei uma senha. Como entro de novo?');
    expect(text).toContain('crie a senha');
    // Sem organização, a sessão da recuperação também conta como aberta pelo link, e o aceite pediria a senha de novo:
    // o caminho é o Link por e-mail, e o Esqueceu a senha? fica para quem já está na equipe.
    expect(text).toMatch(/^Se ainda falta aceitar o convite ou criar a empresa, use Link por e-mail/);
    expect(text).toContain('você a criaria duas vezes');
    expect(text).toContain('Se você já está na equipe e esqueceu a senha, use Esqueceu a senha?');
    expect(text).not.toMatch(/Esqueceu a senha\? para criar/);
  });

  it('o link que não chegou: corrigir o e-mail ou pedir de novo, como as telas oferecem', () => {
    const text = answer('O link do e-mail não chegou. O que faço?');
    expect(text).toContain('Usar outro e-mail');
    expect(text).toContain('Enviar de novo');
    expect(text).toContain('só o link e o código do e-mail mais recente funcionam');
  });

  it('o link gasto aponta o toque em Continuar e, sem ele, os modelos de e-mail do CRM (revisão de 13/10/2026)', () => {
    const text = answer('O link do e-mail diz que expirou ou já foi usado. O que faço?');
    expect(text).toContain('use Continuar');
    expect(text).toContain('os filtros de segurança do e-mail, que abrem os links antes de você, não o gastem');
    expect(text).toContain('os modelos de e-mail do CRM podem não estar aplicados no Supabase');
  });

  it('o e-mail aberto em outro aparelho: o código no aviso de link enviado', () => {
    const text = answer('Pedi o link no computador, mas abri o e-mail no celular. E agora?');
    expect(text).toContain('digite o código em Código do e-mail e use Entrar com o código');
  });
});

// Os nomes de botão citados na Ajuda existem nas telas da entrada e da conta sem organização.
describe('Ajuda: botões citados nas respostas de acesso', () => {
  it.each([
    ['Usar outro e-mail', 'src/pages/Login.tsx'],
    ['Enviar de novo', 'src/components/workspace/WorkspaceSetup.tsx'],
    ['Enviar link para o meu e-mail', 'src/components/workspace/WorkspaceSetup.tsx'],
    ['Código do e-mail', 'src/components/workspace/EmailCodeForm.tsx'],
    ['Entrar com o código', 'src/components/workspace/EmailCodeForm.tsx'],
    ['Continuar', 'src/components/workspace/EmailLinkGate.tsx'],
  ])('"%s" está em %s', async (label, file) => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(file, 'utf8')).toContain(label);
  });
});
