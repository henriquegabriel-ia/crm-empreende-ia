import React, { useId } from "react";

interface FiberStrandsProps {
  /** Quantidade de fios que se abrem em leque. */
  count?: number;
  /** Anima um leve fluxo nos fios (data viajando). */
  animated?: boolean;
  /** Espelha horizontalmente (leque abrindo para a esquerda). */
  flip?: boolean;
  className?: string;
}

/**
 * Motivo de fibras ópticas da identidade base ativa — fios que se abrem
 * em leque a partir de um ponto focal, no gradiente cyan → navy.
 * Decorativo; herda as cores da marca via CSS vars (segue tema claro/escuro).
 */
const FiberStrands: React.FC<FiberStrandsProps> = ({
  count = 9,
  animated = true,
  flip = false,
  className,
}) => {
  const gid = useId().replace(/[:]/g, "");
  const focalX = 452;
  const focalY = 180;

  const strands = Array.from({ length: count }).map((_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const yEnd = 32 + t * 296; // distribui no eixo vertical
    const ctrl2y = focalY + (yEnd - focalY) * 0.62;
    const d = `M${focalX},${focalY} C320,${focalY} 196,${ctrl2y} 16,${yEnd}`;
    const width = 1 + Math.abs(0.5 - t) * 2.4; // mais grosso nas pontas
    const opacity = 0.32 + (1 - Math.abs(0.5 - t) * 1.6) * 0.55;
    return { d, width, opacity, key: i };
  });

  return (
    <svg
      viewBox="0 0 480 360"
      fill="none"
      role="presentation"
      aria-hidden="true"
      className={className}
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <defs>
        <linearGradient id={`fiber-${gid}`} x1="480" y1="180" x2="0" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "hsl(var(--brand-navy))" }} />
          <stop offset="0.5" style={{ stopColor: "hsl(var(--brand-blue))" }} />
          <stop offset="1" style={{ stopColor: "hsl(var(--brand-cyan))" }} />
        </linearGradient>
      </defs>
      <circle cx={focalX} cy={focalY} r="5" style={{ fill: "hsl(var(--brand-cyan))" }} />
      {strands.map((s) => (
        <path
          key={s.key}
          d={s.d}
          stroke={`url(#fiber-${gid})`}
          strokeWidth={s.width}
          strokeLinecap="round"
          style={{ opacity: s.opacity }}
          strokeDasharray={animated ? "1 0" : undefined}
          className={animated ? "animate-fiber-flow" : undefined}
        />
      ))}
    </svg>
  );
};

export default FiberStrands;
