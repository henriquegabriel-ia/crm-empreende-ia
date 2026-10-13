import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HelpCenter } from './HelpCenter';
import { FAQ_CATEGORIES } from './faq-content';

// Sem os provedores do shell, o checklist e o catálogo de tours não aparecem: o teste olha só as perguntas e a busca.
function renderHelp() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <HelpCenter open onOpenChange={() => {}} />
    </MemoryRouter>,
  );
  return screen.getByRole('dialog', { name: 'Ajuda do CRM' });
}
const search = (help: HTMLElement, value: string) =>
  fireEvent.change(within(help).getByRole('searchbox', { name: 'Buscar nas perguntas frequentes' }), {
    target: { value },
  });

afterEach(cleanup);

describe('Central de ajuda', () => {
  it('mostra as categorias e as perguntas, com os nomes da interface em destaque', () => {
    const help = renderHelp();
    for (const category of FAQ_CATEGORIES) expect(within(help).getByText(category.title)).toBeInTheDocument();
    fireEvent.click(within(help).getByRole('button', { name: 'Esqueci minha senha. O que faço?' }));
    const label = within(help).getByText('“Salvar nova senha”');
    expect(label.tagName).toBe('SPAN');
    expect(label).toHaveClass('font-medium', 'text-foreground');
  });

  it('busca sem acentos nem hífen e conta as respostas encontradas', () => {
    const help = renderHelp();
    search(help, 'email nao chegou');
    expect(within(help).getByRole('button', { name: 'O link do e-mail não chegou. O que faço?' })).toBeInTheDocument();
    expect(within(help).queryByRole('button', { name: 'Como digito valores em reais?' })).not.toBeInTheDocument();
    expect(within(help).getByRole('status')).toHaveTextContent(/^\d+ respostas? encontradas?$/);
  });

  it('mantém aberta a resposta que continua no resultado da busca', () => {
    const help = renderHelp();
    fireEvent.click(within(help).getByRole('button', { name: 'Que e-mails o CRM envia?' }));
    expect(within(help).getByText(/Só e-mails de acesso/)).toBeVisible();
    search(help, 'e-mail');
    expect(within(help).getByText(/Só e-mails de acesso/)).toBeVisible();
  });

  it('sem resultado, sugere outras palavras, limpa a busca e devolve o foco ao campo', () => {
    const help = renderHelp();
    const status = within(help).getByRole('status');
    search(help, 'xilofone');
    // A mesma região de status, montada desde a abertura, troca só o texto: o leitor de tela anuncia a mudança.
    expect(within(help).getByRole('status')).toBe(status);
    expect(status).toHaveTextContent(
      'Nenhuma resposta encontrada para “xilofone”. Tente outra palavra, como senha, convite ou planilha.',
    );
    fireEvent.click(within(help).getByRole('button', { name: 'Limpar busca' }));
    expect(within(help).getByRole('button', { name: 'Como começo a usar o CRM?' })).toBeInTheDocument();
    expect(within(help).getByRole('searchbox', { name: 'Buscar nas perguntas frequentes' })).toHaveFocus();
    expect(within(help).getByRole('status')).toBe(status);
    expect(status).toHaveTextContent(/^$/);
  });

  it('a contagem e o aviso sem resultado usam a mesma região de status', () => {
    const help = renderHelp();
    const status = within(help).getByRole('status');
    expect(status).toBeEmptyDOMElement();
    search(help, 'senha');
    expect(status).toHaveTextContent(/^\d+ respostas encontradas$/);
    search(help, 'xilofone');
    expect(within(help).getAllByRole('status')).toEqual([status]);
    expect(status).toHaveTextContent(/^Nenhuma resposta encontrada/);
  });

  it('só pontuação não é busca: nada é filtrado nem anunciado', () => {
    const help = renderHelp();
    for (const value of ['?', ' - ', '...']) {
      search(help, value);
      expect(within(help).getByRole('status')).toBeEmptyDOMElement();
      for (const category of FAQ_CATEGORIES) expect(within(help).getByText(category.title)).toBeInTheDocument();
    }
  });
});
