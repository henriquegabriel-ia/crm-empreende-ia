import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { browserOffline, OFFLINE_BANNER_MESSAGE } from '@/lib/offline';

/**
 * Aviso honesto de falta de conexão: o CRM não guarda alterações para enviar depois. Enquanto o navegador estiver sem
 * conexão, o cliente Supabase recusa as requisições na hora (createSupabaseFetch), e cada tela mostra que não salvou.
 */
export function OfflineDetector() {
  const [isOffline, setIsOffline] = useState(browserOffline);

  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    // O estado pode ter mudado entre a primeira renderização e o registro dos ouvintes.
    setIsOffline(browserOffline());
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-center text-sm font-medium text-destructive-foreground"
      role="alert"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      {OFFLINE_BANNER_MESSAGE}
    </div>
  );
}
