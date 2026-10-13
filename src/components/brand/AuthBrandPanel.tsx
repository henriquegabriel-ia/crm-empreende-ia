import { Check } from 'lucide-react';
import { BRAND } from '@/lib/brand';
import Wordmark from './Wordmark';

/**
 * Painel escuro das telas de entrada (desktop, a partir de 1024 px), com a marca da instância: a arte (`authImage`, a
 * 40% sob o degradê; sem ela, o painel fica escuro), o logo para fundo escuro e o slogan (`tagline`, que some vazio).
 */
export function AuthBrandPanel({ recovery = false }: { recovery?: boolean }) {
  return (
    <aside className="eia-auth-brand relative hidden flex-col justify-between overflow-hidden lg:flex">
      {BRAND.authImage && <img src={BRAND.authImage} alt="" className="eia-auth-art" aria-hidden="true" />}
      <div className="relative z-10">
        <Wordmark variant="wordmark" onDark />
        {/* O nome já está no texto alternativo do logo, como no Wordmark: o rótulo é só visual. */}
        {BRAND.logoOnDark && (
          <p className="mt-3 text-sm text-white/60" aria-hidden="true">
            CRM
          </p>
        )}
      </div>
      <div className="eia-auth-story relative z-10">
        <span className="eia-auth-label">Seu próximo passo começa aqui</span>
        <h1>{recovery ? 'Volte a cuidar dos seus relacionamentos.' : 'Mais clareza em cada relacionamento.'}</h1>
        {!recovery && (
          <ul className="mt-8 space-y-4">
            {[
              'Acompanhe cada oportunidade',
              'Organize a agenda e os próximos passos',
              'Mantenha sua equipe no mesmo contexto',
            ].map((item) => (
              <li key={item} className="flex items-center gap-3 text-base text-white/80">
                <Check className="h-4 w-4 shrink-0 text-[#8de7bb]" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
      {BRAND.tagline && <p className="relative z-10 text-sm text-white/55">{BRAND.tagline}</p>}
    </aside>
  );
}
