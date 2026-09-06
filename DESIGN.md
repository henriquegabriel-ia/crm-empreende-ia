# CRM Saúde · Design System "base ativa — workbench"

Contrato visual do app (jul/2026), portado do canônico Lara. O objetivo: **nenhuma tela
pode lembrar template**. A paleta base ativa (cyan→azul→navy, light+dark) permanece; a
**estrutura** é workbench.

## Direção

Linguagem **workbench estruturado** (referências: Linear, Attio, Height): superfícies flat,
hairlines em vez de sombras, densidade maior, navegação por rail de ícones, título da página
no topbar (não como h2 gigante no corpo), CRUD em painéis laterais (não modal central).

## O que morreu (proibido reintroduzir)

1. **Glow blobs** (`blur-[140px]`, halos decorativos em cantos) — banidos do shell e telas.
2. **Sidebar de template** (shadcn sidebar `collapsible="icon"` + backdrop-blur-xl) — substituída pelo `AppRail`.
3. **Page header "h1 2xl/3xl bold + subtítulo muted + CTA à direita"** — substituído pelo `PageScaffold` (título no topbar h-14).
4. **Card glass** `bg-card/70 backdrop-blur shadow-*` — Card primitivo agora é flat; superfícies novas usam `Panel` (hairline, sem blur, sem shadow).
5. **Modal central pra CRUD** (`Dialog` pra criar/editar) — CRUD vai pra `SidePanel` (sheet à direita); modal central só pra confirmação (`ConfirmDialog`).
6. **Filter bar em card** — filtros vivem na linha `toolbar` do `PageScaffold`, flat, separada por hairline.
7. **Avatar circular com gradiente/cor ad-hoc** — usar `InitialsAvatar` (squircle `rounded-lg`, cor determinística da paleta azul, aceita `src` de foto).
8. **Badge translúcido com cores Tailwind cruas** (`bg-emerald-500/10 text-emerald-400`…) — usar `StatusChip` (tokens `--success/--warning/--destructive/--primary`).
9. **Botão primary gradiente/glow** — botões são **pill** (`rounded-full`), primary sólido `bg-primary`.
10. **Tabs pill "ilha com sombra"** — tabs são **underline** (borda inferior 2px primary).
11. **Ícone-em-caixa-gradiente** abrindo cada seção — usar `SectionLabel` (label pequena com ponto) ou `PanelHeader`.
12. **Empty/loading clonados** (Loader2 girando / ícone 48px opacity-50) — usar `EmptyState` (borda tracejada) e `LoadingState` (3 pontos pulsando).
13. **Emojis literais como ícones** (📋🎯💰🔴⚙️…) — sempre lucide-react. ⚠️ Em objetos-mapa (`TRIGGER_LABELS` etc.) trocar o valor `icon` por componente lucide sem quebrar o lookup por chave.
14. **Eyebrow uppercase tracking-wider** como abridor de seção — usar `SectionLabel` (sentence case + ponto).
15. **KPIs em grid de cards soltos** — usar `StatStrip` (um painel com divisórias verticais).

## Fundação (src/components/foundation + shell)

- `Panel`, `PanelHeader`, `PanelBody`, `SectionLabel` — superfície padrão. `Panel` = `rounded-xl border bg-card`; variante `inset` = `bg-muted/40`.
- `StatusChip` — `tone: success | warning | danger | info | neutral | brand`, com ponto; `rounded-md` (não pill).
- `InitialsAvatar` — squircle, iniciais ou foto (`src`), tamanhos `xs|sm|md|lg`.
- `EmptyState` — ícone em caixa `bg-primary/10`, container tracejado.
- `LoadingState` — três pontos pulsando + label.
- `ConfirmDialog` — substitui `AlertDialog`/`window.confirm()`; central, pequeno, tom danger.
- `StatStrip` — KPIs em UM painel com divisórias verticais (nunca 4 cards soltos).
- `SidePanel` — sheet à direita com header (kicker+título+X), corpo scrollável, footer sticky com ações à direita (nunca 50/50). Larguras `sm|md|lg`.
- `AppRail` (shell) — rail expansível: recolhido w-16 (ícones + tooltip) ou expandido w-60, persistido em localStorage (`fc-rail-expanded`); grupos com separador/label sentence case; ativo = squircle `bg-primary`; rodapé com Ajuda + ThemeToggle + avatar (popover com e-mail e sair). Desktop-only; mobile navega pelo `MobileBottomNav`.
- `PageScaffold` (shell) — `title` (15px semibold no topbar), `meta` (chip opcional), `actions` (CTAs da página), cluster global automático (busca ⌘K, quick-add, IA, notificações via `TopbarActions`), `toolbar` (linha de filtros), `children`. `flush` pra telas full-bleed (ex.: board do Pipeline). **Toda página autenticada usa PageScaffold.**
- `useShell()` (shell/ShellContext) — `openSearch()` abre a CommandPalette global.

## Tokens

`--success` / `--warning` (light e dark) em index.css; Tailwind `text-success`, `bg-warning/10`, etc.
`--radius: 0.75rem`. Hierarquia de raio: controles pill (`rounded-full`), inputs `rounded-lg`, painéis `rounded-xl`.

**Tema escuro = "grafite azulado"** (bg `217 26% 13%`, superfícies mais claras e pouco saturadas) com **primary AZUL** (`207 84% 62%`) — nunca voltar ao quase-preto navy com primary cyan, que é cara de template.

**GOTCHA do accent color:** o `ThemeContext` custom (não next-themes) sobrescreve `--primary`/`--ring`/`--sidebar-primary` via JS conforme o accent escolhido em Configurações (`fc-theme`/`fc-density`/`fc-accent` no localStorage). O accent `blue` DEVE ficar alinhado aos tokens base ativa do index.css (light `205 80% 47%`, dark `207 84% 62%`). Manter esse ThemeContext — não trocar por next-themes.

**`--accent` no claro é ESCURO** (teal AA p/ texto) — nunca usar `bg-accent` sólido como hover suave; hovers neutros usam `bg-secondary/60`.

## Tipografia

- Título de página: 15px semibold tracking-tight, dentro do topbar do `PageScaffold`.
- `font-display` (Comfortaa) reservada pra momentos de marca: wordmark, Auth, welcome do onboarding.
- Nada de `text-2xl/3xl font-bold` em corpo de tela.

## Regras de implementação (obrigatórias pra qualquer refactor)

1. **Nunca tocar em lógica**: handlers, estado, refs, useEffect, queries. Refatorar o markup AO REDOR da lógica. Pontos delicados deste repo: matching `label ↔ stage.name` no Pipeline; emojis dentro de objetos-mapa chaveados por `type` em Automations; matriz de permissões por `key` em Team; avanço de step por ref/índice no OnboardingModal; `hash.includes("type=recovery")` no ResetPassword.
2. Matching por string existente não pode quebrar — não renomear strings de entrada sem ajustar o matching.
3. Light E dark sempre — nunca cor absoluta sem par (`text-white` só sobre superfície sólida de marca).
4. Selects nativos podem permanecer nativos quando há update otimista por célula (Team), mas estilizados: `h-9 rounded-lg border border-input bg-background px-3 text-sm`.
5. Cores de STATUS funcionais multicor (ex.: colunas do Pipeline) viram tokens/`StatusChip` mantendo a distinção semântica — status semântico fica, cor de marca destoante morre.
