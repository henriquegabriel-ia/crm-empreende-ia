import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACME_BRAND, resetMockBrand } from '@/test/brand-mock';
import Wordmark, { BrandGlyph } from './Wordmark';

const mock = vi.hoisted(() => ({ brand: {} as Record<string, unknown> }));
vi.mock('@/lib/brand', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/brand')>();
  return {
    ...actual,
    BRAND: mock.brand,
    brandMonogram: (name?: string) => actual.brandMonogram(name ?? String(mock.brand.productName)),
  };
});

const NAME = ACME_BRAND.productName;
beforeEach(() => resetMockBrand(mock.brand));
afterEach(cleanup);

// Item 1.6: o logo vem da marca da instância, com o nome em texto no tema sem logo.
describe('Wordmark', () => {
  it('mostra o logo de cada tema, com o nome no texto alternativo e o rótulo CRM escondido do leitor de tela', () => {
    const { container } = render(<Wordmark variant="full" />);
    const images = container.querySelectorAll('img');
    expect([...images].map((image) => [image.getAttribute('src'), image.className.split(' ')[0]])).toEqual([
      [ACME_BRAND.logoOnDark, 'eia-logo-for-dark'],
      [ACME_BRAND.logoOnLight, 'eia-logo-for-light'],
    ]);
    for (const image of images) {
      expect(image).toHaveAttribute('alt', NAME);
      expect(image).toHaveClass('max-h-12', 'w-auto', 'max-w-full', 'object-contain');
    }
    expect(screen.getByText('CRM')).toHaveAttribute('aria-hidden', 'true');
    // A caixa continua com 176 px (w-44); no compacto, 128 px e no máximo 36 px de altura.
    expect(container.querySelector('.w-44')).not.toBeNull();
    const compact = render(<Wordmark variant="compact" />).container;
    expect(compact.querySelector('.w-32')).not.toBeNull();
    expect(compact.querySelector('img')).toHaveClass('max-h-9');
  });

  it('sem o logo de um tema, mostra o nome em texto nesse tema', () => {
    mock.brand.logoOnLight = null;
    const { container } = render(<Wordmark variant="wordmark" />);
    expect(container.querySelector('img.eia-logo-for-dark')).toHaveAttribute('src', ACME_BRAND.logoOnDark);
    const text = container.querySelector('.eia-logo-for-light');
    expect(text?.tagName).toBe('SPAN');
    expect(text).toHaveTextContent(NAME);
    expect(text?.firstElementChild).toHaveClass('line-clamp-2', 'break-words');
    expect(text?.firstElementChild).toHaveAttribute('title', NAME);
  });

  it('sem nenhum logo, o nome aparece em texto nos dois temas e o rótulo CRM some', () => {
    mock.brand.logoOnLight = null;
    mock.brand.logoOnDark = null;
    const { container } = render(<Wordmark variant="full" />);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getAllByText(NAME)).toHaveLength(2);
    expect(screen.queryByText('CRM')).not.toBeInTheDocument();
  });

  it('sobre o painel escuro (onDark), só o logo para fundo escuro, ou o nome em branco', () => {
    const { container, unmount } = render(<Wordmark variant="wordmark" onDark />);
    expect([...container.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual([
      ACME_BRAND.logoOnDark,
    ]);
    unmount();
    mock.brand.logoOnDark = null;
    render(<Wordmark variant="wordmark" onDark />);
    expect(screen.getByText(NAME)).toHaveClass('text-white');
  });

  it('BrandGlyph usa o ícone ou, sem ele, a primeira letra do nome', () => {
    const { container, unmount } = render(<BrandGlyph className="h-9 w-9" />);
    expect(container.querySelector('img')).toHaveAttribute('src', ACME_BRAND.icon);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    unmount();
    mock.brand.icon = null;
    const glyph = render(<Wordmark variant="icon" />).container.firstElementChild;
    expect(glyph).toHaveTextContent(/^A$/);
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveClass('bg-primary', 'text-primary-foreground');
    expect(glyph?.querySelector('img')).toBeNull();
  });
});
