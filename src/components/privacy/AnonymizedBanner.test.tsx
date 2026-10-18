import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AnonymizedBanner } from './AnonymizedBanner';

afterEach(cleanup);

// Achado 2 da revisão do item 1.10 (corrigido no 1.11): a faixa do anonimizado tinha o texto corrigido na rodada 2
// ("vincula", e não "liga") sem teste; voltar ao texto antigo reprova aqui.
describe('AnonymizedBanner', () => {
  it('diz quem anonimizou, quando e que o CRM não vincula novos registros ao cadastro', () => {
    render(
      <AnonymizedBanner
        contact={{ anonymized_at: '2026-10-13T12:00:00Z', anonymized_by: 'user-1' }}
        members={[{ id: 'user-1', name: 'Carla Dias', email: 'carla@example.test' }]}
      />,
    );
    const band = screen.getByRole('region', { name: 'Contato anonimizado' });
    expect(band).toHaveTextContent(
      /^Contato anonimizadoAnonimizado por Carla Dias em \d{2}\/\d{2}\/2026\. Os dados pessoais foram apagados; o histórico comercial ficou sem nomes e anotações\. O CRM não vincula novos registros a este cadastro: para um novo relacionamento com a pessoa, cadastre um novo contato\.$/,
    );
    expect(band).not.toHaveTextContent(/não liga/);
  });

  it('sem a data ou o autor, a faixa explica o mesmo, sem o carimbo', () => {
    render(<AnonymizedBanner contact={{ anonymized_at: null, anonymized_by: null }} members={[]} />);
    expect(screen.getByRole('region', { name: 'Contato anonimizado' })).toHaveTextContent(
      /^Contato anonimizadoOs dados pessoais foram apagados;.*O CRM não vincula novos registros a este cadastro/,
    );
  });
});
