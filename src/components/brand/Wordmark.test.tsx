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
    const labels = screen.getAllByText('CRM');
    expect(labels.map((label) => label.className.split(' ')[0])).toEqual(['eia-logo-for-dark', 'eia-logo-for-light']);
    for (const label of labels) expect(label).toHaveAttribute('aria-hidden', 'true');
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

  // Achado 7 da revisão do item 1.6 (corrigido no item 1.9): com o logo de um tema só, o rótulo CRM aparece só nesse
  // tema; no outro, o nome em texto dispensa o rótulo. A visibilidade por tema dessas classes é conferida no E2E da marca.
  it.each([
    ['só o logo claro', { logoOnDark: null }, 'eia-logo-for-light'],
    ['só o logo escuro', { logoOnLight: null }, 'eia-logo-for-dark'],
  ] as const)('com %s, o rótulo CRM fica só no tema do logo', (_label, overrides, theme) => {
    resetMockBrand(mock.brand, overrides);
    render(<Wordmark variant="full" />);
    const labels = screen.getAllByText('CRM');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toHaveClass(theme);
    expect(labels[0]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(NAME)).toBeInTheDocument();
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
