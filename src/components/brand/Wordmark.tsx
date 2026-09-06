import React, { useId } from "react";
import { cn } from "@/lib/utils";

type WordmarkVariant = "full" | "compact" | "wordmark" | "icon";

interface WordmarkProps {
  variant?: WordmarkVariant;
  className?: string;
  /** Classe extra para o texto "CRM Saúde". */
  wordClassName?: string;
}

/** Nome do produto exibido no wordmark. */
const PRODUCT = "CRM Saúde";

/** Glyph da marca: badge arredondado com fibras se abrindo (gradiente base ativa). */
export const BrandGlyph: React.FC<{ className?: string }> = ({ className }) => {
  const gid = useId().replace(/[:]/g, "");
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded-xl bg-brand-gradient shadow-brand-sm",
        className
      )}
    >
      <svg viewBox="0 0 48 48" className="h-[62%] w-[62%]" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={`g-${gid}`} x1="42" y1="24" x2="6" y2="24" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <circle cx="40" cy="24" r="2.4" fill="#ffffff" />
        {[6, 16, 24, 32, 42].map((y, i) => (
          <path
            key={i}
            d={`M40,24 C30,24 22,${24 + (y - 24) * 0.6} 6,${y}`}
            stroke={`url(#g-${gid})`}
            strokeWidth={i === 2 ? 2.4 : 1.6}
            strokeLinecap="round"
          />
        ))}
      </svg>
    </span>
  );
};

/** Wordmark "CRM Saúde · by base ativa" da identidade base ativa. */
const Wordmark: React.FC<WordmarkProps> = ({ variant = "full", className, wordClassName }) => {
  if (variant === "icon") {
    return <BrandGlyph className={cn("h-10 w-10", className)} />;
  }

  const word = (
    <span
      className={cn(
        "font-display font-bold tracking-tight text-gradient-brand leading-none whitespace-nowrap",
        wordClassName
      )}
    >
      {PRODUCT}
    </span>
  );

  if (variant === "wordmark") {
    return (
      <span className={cn("inline-flex flex-col", className)}>
        <span className="text-xl">{word}</span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          by base ativa
        </span>
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <span className={cn("inline-flex items-center gap-2", className)}>
        <BrandGlyph className="h-8 w-8" />
        <span className="inline-flex items-baseline gap-1.5">
          <span className="text-base">{word}</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            base ativa
          </span>
        </span>
      </span>
    );
  }

  // full
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <BrandGlyph className="h-11 w-11" />
      <span className="inline-flex flex-col">
        <span className="text-xl">{word}</span>
        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          by base ativa
        </span>
      </span>
    </span>
  );
};

export default Wordmark;
