// Tema antes da primeira pintura (item 1.3): o tema salvo (escuro, claro ou o do sistema) vai para o <html> antes de o
// app carregar, sem piscar. Fica fora do index.html porque a CSP do vercel.json (script-src 'self') bloqueia script
// inline. Script clássico e síncrono no <head>: sem ele (arquivo ausente ou bloqueado), o CRM abre no tema escuro do
// próprio <html>.
(() => {
  let theme = 'dark';
  try {
    const saved = localStorage.getItem('empreende-ia-theme');
    if (['dark', 'light', 'system'].includes(saved)) theme = saved;
  } catch {}
  const resolved =
    theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  const root = document.documentElement;
  root.dataset.eiaTheme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
  root.style.colorScheme = resolved;
})();
