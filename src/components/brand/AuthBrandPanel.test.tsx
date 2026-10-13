import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACME_BRAND, resetMockBrand } from '@/test/brand-mock';
import { AuthBrandPanel } from './AuthBrandPanel';

const mock = vi.hoisted(() => ({ brand: {} as Record<string, unknown> }));
vi.mock('@/lib/brand', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/brand')>()),
  BRAND: mock.brand,
}));

beforeEach(() => resetMockBrand(mock.brand));
afterEach(cleanup);

// Item 1.6: a arte e o slogan do painel da entrada vêm da marca e somem quando ela não os tem.
describe('AuthBrandPanel', () => {
  it('com a arte, o logo para fundo escuro e o slogan da marca', () => {
    mock.brand.authImage = '/brand/acme-arte.jpg?v=44444444';
    const { container } = render(<AuthBrandPanel />);
    expect(container.querySelector('img.eia-auth-art')).toHaveAttribute('src', '/brand/acme-arte.jpg?v=44444444');
    expect(container.querySelector('img.eia-logo-for-dark')).toHaveAttribute('src', ACME_BRAND.logoOnDark);
    expect(screen.getByText(ACME_BRAND.tagline)).toBeInTheDocument();
    // O rótulo "CRM" é só visual: o texto alternativo do logo já é o nome inteiro, e o leitor de tela não o repete.
    expect(screen.getByText('CRM')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('img', { name: ACME_BRAND.productName })).toBeInTheDocument();
  });

  it('sem arte, o painel fica escuro e sem imagem; sem slogan, a linha de baixo some', () => {
    mock.brand.tagline = '';
    const { container } = render(<AuthBrandPanel recovery />);
    expect(container.querySelector('img.eia-auth-art')).toBeNull();
    expect(container.querySelector('aside')?.lastElementChild).toHaveClass('eia-auth-story');
    expect(screen.getByRole('heading', { name: 'Volte a cuidar dos seus relacionamentos.' })).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/\/brand\/eia-|\/materials\/|Empreende/);
  });

  it('sem logo para fundo escuro, o nome aparece em branco e o rótulo CRM some', () => {
    mock.brand.logoOnDark = null;
    render(<AuthBrandPanel />);
    expect(screen.getByText(ACME_BRAND.productName)).toHaveClass('text-white');
    expect(screen.queryByText('CRM')).not.toBeInTheDocument();
  });
});
