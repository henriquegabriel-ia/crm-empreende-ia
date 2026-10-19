/**
 * Só a URL do projeto Supabase da instância e a chave pública configuram o CRM: URL sem credenciais, consulta ou
 * fragmento, https:// (ou http:// local) e chave sb_publishable_ ou JWT anon. A exigência da variável de "ambiente
 * dedicado" saiu no item 1.3 (definida, ela só gera um aviso no build; scripts/lib/deploy-env.mjs).
 */
export function validCrmBackend(url: unknown, key: unknown): boolean {
  if (typeof url !== 'string' || typeof key !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    if (
      parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
    )
      return false;
  } catch {
    return false;
  }
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  try {
    const segments = key.split('.');
    if (segments.length !== 3) return false;
    const encoded = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))) as { role?: unknown };
    return payload.role === 'anon';
  } catch {
    return false;
  }
}
