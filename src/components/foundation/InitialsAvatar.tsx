import React from 'react';
import { cn } from '@/lib/utils';

/** Paleta determinística dentro da família azul da base ativa. */
const PALETTE = [
  'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
  'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300',
  'bg-slate-200 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300',
];

const SIZES = {
  xs: 'h-6 w-6 rounded-md text-[10px]',
  sm: 'h-8 w-8 rounded-lg text-xs',
  md: 'h-9 w-9 rounded-lg text-sm',
  lg: 'h-11 w-11 rounded-xl text-base',
} as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hueIndex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % PALETTE.length;
}

interface InitialsAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  size?: keyof typeof SIZES;
  /** Foto real (ex.: avatar do WhatsApp) — cai pras iniciais se ausente ou falhar */
  src?: string | null;
}

/** Avatar squircle com iniciais (ou foto, quando disponível) — substitui os círculos com gradiente do template. */
export const InitialsAvatar: React.FC<InitialsAvatarProps> = ({ name, size = 'md', src, className, ...props }) => {
  const [imgFailed, setImgFailed] = React.useState(false);
  const showImg = Boolean(src) && !imgFailed;

  return (
    <div
      className={cn(
        'flex shrink-0 select-none items-center justify-center overflow-hidden font-semibold',
        SIZES[size],
        !showImg && PALETTE[hueIndex(name || '?')],
        className
      )}
      {...props}
    >
      {showImg ? (
        <img
          src={src as string}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        initialsOf(name || '?')
      )}
    </div>
  );
};

export default InitialsAvatar;
