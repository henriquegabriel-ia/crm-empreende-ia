import { describe, expect, it } from 'vitest';
import { codeShowsLabel, codeWithoutComments, screenCode, screenFiles, showsLabel } from '@/test/ui-labels';

describe('apoio dos testes da Ajuda: nome mostrado inteiro na tela', () => {
  it.each([
    ["{verifying ? 'Verificando…' : 'Continuar'}", 'Continuar'],
    ['<Button variant="outline">\n  <Copy className="h-4 w-4" />\n  Copiar\n</Button>', 'Copiar'],
    ["{automation.is_active ? 'Pausar' : 'Revisar e ativar'}", 'Pausar'],
    ['`Prévia: ${format(parsed)}`', 'Prévia'],
    ['<h2>Fila de atenção · {attention.length}</h2>', 'Fila de atenção'],
    ['<Label htmlFor="payment-paid">Recebido em *</Label>', 'Recebido em'],
    [
      "{busy === 'import' ? 'Importando…' : `Confirmar importação de ${preview.length} contatos`}",
      'Confirmar importação',
    ],
  ])('%s mostra “%s”', (code, label) => {
    expect(codeShowsLabel(codeWithoutComments(code), label)).toBe(true);
  });

  // O que deixava passar a troca de “Continuar”, “Copiar” e “Pausar” nas telas: a palavra numa frase, em outro botão
  // ou num comentário.
  it.each([
    ["'Você abriu o link enviado ao seu e-mail. Use “Continuar” para entrar no CRM.'", 'Continuar'],
    ['// o token só é conferido quando a pessoa toca em "Continuar"\nconst ok = true;', 'Continuar'],
    ["/* {verifying ? 'Verificando…' : 'Continuar'} */", 'Continuar'],
    ['<Button>Copiar link</Button>', 'Copiar'],
    ['<p>Pausar interrompe novos disparos; tarefas já criadas permanecem disponíveis.</p>', 'Pausar'],
    ['<p>Para só interromper os disparos, use Pausar.</p>', 'Pausar'],
    ['aria-label="Pausar tour"', 'Pausar'],
    ['`Confirmar importação (${count})`', 'Confirmar importação'],
  ])('%s não mostra “%s”', (code, label) => {
    expect(codeShowsLabel(codeWithoutComments(code), label)).toBe(false);
  });

  it('os textos de ajuda e o apoio dos testes nunca provam que um nome existe', () => {
    for (const file of [
      'src/components/help/faq-content.ts',
      'src/components/tours/catalog.ts',
      'src/components/onboarding/setup-state.ts',
      'src/test/ui-labels.ts',
    ])
      expect(() => showsLabel(file, 'Equipe'), file).toThrow(/não prova/);
    expect(() => showsLabel('supabase/templates/preview.html', 'Ative sua conta')).toThrow(/não é um e-mail/);
    expect(showsLabel('supabase/templates/invite.html', 'Ative sua conta')).toBe(true);
  });
});

// Os avisos de permissão das telas dizem quem pode fazer o quê com os papéis da Equipe: "donos e administradores", e
// não "o administrador", que esquece os donos, nem "um editor" ou "membros autorizados", papéis que a Equipe não tem. A
// Ajuda e os tours têm a mesma trava nos próprios testes.
const VAGUE_ROLE_COPY =
  /(?:somente|só|apenas) (?:os )?administradores\b|\b(?:ao|um|do|pelo) administrador\b|administrador da sua equipe|\bum editor\b|membros autorizados|depende de permissão/i;

describe('textos das telas: quem pode fazer o quê', () => {
  it('a trava reconhece os textos antigos e aceita os atuais', () => {
    for (const text of [
      'Somente administradores podem alterar estas configurações.',
      'Solicite acesso de edição ao administrador.',
      'Um administrador pode configurar os critérios de atenção.',
      'Peça a um editor para criar um cadastro.',
      'Edição disponível para membros autorizados.',
      'A edição depende de permissão do administrador.',
      'Detalhe técnico (só administradores veem)',
    ])
      expect(text, text).toMatch(VAGUE_ROLE_COPY);
    for (const text of [
      'Somente donos e administradores podem alterar estas configurações.',
      'Peça acesso de edição a um dono ou administrador.',
      'Faz tudo o que o administrador faz e também convida donos.',
      'Donos, administradores e colaboradores registram e editam lançamentos.',
    ])
      expect(text, text).not.toMatch(VAGUE_ROLE_COPY);
  });

  it('nenhuma tela fala só do administrador nem de papéis que a Equipe não tem', () => {
    const found = screenFiles().flatMap((file) => {
      const match = screenCode(file).match(VAGUE_ROLE_COPY);
      return match ? [`${file}: “${match[0]}”`] : [];
    });
    expect(found).toEqual([]);
  });
});
