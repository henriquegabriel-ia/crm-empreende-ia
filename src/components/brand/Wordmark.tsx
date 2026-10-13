import { BRAND, brandMonogram } from '@/lib/brand';
import { cn } from '@/lib/utils';

interface WordmarkProps {
  variant?: 'full' | 'compact' | 'wordmark' | 'icon';
  className?: string;
  wordClassName?: string;
  onDark?: boolean;
}
/**
 * Ícone da marca da instância (menu recolhido e cabeçalho das telas no celular). Sem `icon` no brand.json, o monograma:
 * a primeira letra do nome num quadrado da cor primária.
 */
export function BrandGlyph({ className }: { className?: string }) {
  if (BRAND.icon)
    return (
      <span className={cn('eia-brand-icon inline-flex shrink-0', className)} aria-hidden="true">
        <img src={BRAND.icon} alt="" className="h-full w-full object-contain" />
      </span>
    );
  return (
    <span
      className={cn(
        'eia-brand-icon inline-flex shrink-0 items-center justify-center bg-primary text-sm font-semibold leading-none text-primary-foreground',
        className,
      )}
      aria-hidden="true"
    >
      {brandMonogram()}
    </span>
  );
}

type LogoTheme = 'eia-logo-for-dark' | 'eia-logo-for-light';

/**
 * Logo da marca da instância (public/brand/brand.json): `logoOnDark` no tema escuro e no painel da entrada (`onDark`),
 * `logoOnLight` no tema claro. A caixa tem largura fixa (176 px, ou 128 px no `compact`) e altura máxima de 48 px (36 px):
 * um logo quadrado ou alto fica contido nela. Sem o logo de um tema, o nome aparece em texto nesse tema, em até duas
 * linhas; o desenho do logo do programa nunca é recriado em texto.
 */
export default function Wordmark({ variant = 'full', className, wordClassName, onDark = false }: WordmarkProps) {
  if (variant === 'icon') return <BrandGlyph className={cn('h-10 w-10', className)} />;
  const compact = variant === 'compact';
  const name = BRAND.productName;
  const logo = (src: string | null, theme: LogoTheme) =>
    src ? (
      <img
        src={src}
        alt={name}
        className={cn(theme, 'h-auto w-auto max-w-full object-contain object-left', compact ? 'max-h-9' : 'max-h-12')}
      />
    ) : (
      // O invólucro leva a classe do tema (que mostra ou esconde), e o texto, o corte em duas linhas.
      <span className={theme}>
        <span
          title={name}
          className={cn(
            'line-clamp-2 break-words font-semibold tracking-tight',
            compact ? 'text-base leading-tight' : 'text-xl leading-tight',
            onDark ? 'text-white' : 'text-foreground',
          )}
        >
          {name}
        </span>
      </span>
    );
  // O rótulo "CRM" acompanha o tema (achado 7 da revisão do item 1.6, corrigido no item 1.9): um por tema, só quando o
  // logo daquele tema existe. Com só o logo claro, o tema escuro mostra o nome em texto, sem o "CRM" repetido abaixo.
  const crmLabel = (theme: LogoTheme) => (
    <span className={cn(theme, 'mt-2 text-xs font-medium text-muted-foreground')} aria-hidden="true">
      CRM
    </span>
  );
  return (
    <span className={cn('eia-wordmark inline-flex flex-col items-start', onDark && 'eia-wordmark-on-dark', className)}>
      <span className={cn('relative block', compact ? 'w-32' : 'w-44', wordClassName)}>
        {logo(BRAND.logoOnDark, 'eia-logo-for-dark')}
        {!onDark && logo(BRAND.logoOnLight, 'eia-logo-for-light')}
      </span>
      {/* O nome já está no texto alternativo do logo; sem logo, o nome em texto dispensa o rótulo. */}
      {variant === 'full' && BRAND.logoOnDark && crmLabel('eia-logo-for-dark')}
      {variant === 'full' && !onDark && BRAND.logoOnLight && crmLabel('eia-logo-for-light')}
    </span>
  );
}
