import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACME_BRAND, resetMockBrand } from '@/test/brand-mock';
import { BrandFooter } from './BrandFooter';

const mock = vi.hoisted(() => ({ brand: {} as Record<string, unknown> }));
vi.mock('@/lib/brand', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/brand')>()),
  BRAND: mock.brand,
}));

beforeEach(() => resetMockBrand(mock.brand));
afterEach(cleanup);

// Item 1.6 (D3): o rodapé das telas de entrada mostra o nome da marca e, ligado, o crédito da base.
describe('BrandFooter', () => {
  it('mostra o nome e o crédito "Feito com Empreende.IA" quando ligado', () => {
    render(<BrandFooter />);
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent(`${ACME_BRAND.productName}Feito com Empreende.IA`);
    expect(footer).toHaveClass('mt-8', 'text-center', 'text-xs', 'text-muted-foreground');
    expect(footer.querySelector('a')).toBeNull();
  });

  it('com o crédito desligado, só o nome', () => {
    mock.brand.baseCredit = false;
    render(<BrandFooter />);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(new RegExp(`^${ACME_BRAND.productName}$`));
    expect(screen.queryByText('Feito com Empreende.IA')).not.toBeInTheDocument();
  });
});
