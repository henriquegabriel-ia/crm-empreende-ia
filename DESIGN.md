# Empreende.IA CRM — Design System V2

A direção visual é **Vidro em movimento**, conforme o DS local `Empreende IA - DS/empreende-ia-ds-v2`. A marca oficial, Manrope e os materiais foram incorporados ao CRM mantendo React 18, Vite, Tailwind 3 e as primitivas Radix existentes.

## Fonte e adaptação

- `src/styles/eia-tokens.css`: tokens oficiais escuros e claros, sem a ponte de Tailwind 4 do catálogo.
- `src/index.css`: aliases HSL equivalentes para os utilitários de opacidade já usados no CRM. Não atribuir cores completas como `#080a09` a variáveis consumidas por `hsl(var(--background))`.
- `src/styles/eia-components.css`: materiais e composição visual. É importado em `main.tsx` **depois** de `index.css`, para ter precedência sobre os utilitários das primitivas.
- `src/components/ds`: camadas de composição sobre as primitivas de `components/ui`. Preservam props, refs, portais, teclado e contratos dos controles.
- `public/brand`: a marca da instância (item 1.6): `brand.json` e as imagens que ele cita, lidos no build ([Trocar a marca do CRM](docs/MARCA.md)). Na base, as assinaturas oficiais do programa, com o nome pelo fundo a que se destinam: `eia-logo-on-light.svg` (tinta escura, para superfície clara) e `eia-logo-on-dark.svg` (tinta clara, para superfície escura), `eia-icon.svg` (o ícone do app e o favicon) e `eia-auth-art.jpg` (a arte em vidro da entrada). Preservar proporções e não recriar o logo do programa em texto. `eia-email.png` (960 × 208, exibido a 185 px) é o `eia-email-2x.png` do kit do DS composto sobre o fundo `#f4f7f5` do e-mail, opaco para não sumir quando um cliente escurece o fundo. É o logo dos modelos do Auth em `supabase/templates/` com a marca do programa (`"emailLogo": "eia-email.png"`).
- `public/fonts`: Manrope variável e sua licença OFL.

## Identidade

Canvas escuro `#080a09`, claro `#f4f7f5`; cinzas com matiz verde e esmeralda `#0fa968` pontual. Manrope em toda a interface. Controles de 36/44/52 px; raios de 13 px em controles, 23 px em painéis e 30 px nas grandes superfícies.

Materiais por função: `hero` para arte e destaque; `panel` para contexto e agrupamentos; `dense` para tabelas, listas extensas e overlays de operação. Vidro precisa de variação real atrás dele. Tabelas e leituras longas não recebem blur. Manter distinção semântica de sucesso, alerta e erro.

## Tema e acessibilidade

O padrão é escuro. A preferência usa `empreende-ia-theme`, aceita dark/light/system e aplica `data-eia-theme` e a classe `.dark` no HTML. O script no `index.html` resolve o tema antes da pintura. `ThemeContext` acompanha o sistema quando solicitado e preserva a escolha na sessão se o storage estiver indisponível.

Os tokens são definidos no HTML com `.eia-theme`, chegando também aos portais anexados ao body. A cor de identidade é fixa; aparência continua oferecendo tema e densidade. Preferências de densidade e menu usam namespace próprio do CRM.

Preservar foco visível, nomes acessíveis de botões, contraste e redução de movimento. Textos menores que 12 px não devem ser introduzidos. Campos e ações mantêm rótulos claros; estados vazios, loading e erro são distintos.

## Composição do produto

Shell com navegação lateral expansível, superfície principal delimitada e cabeçalho por `PageScaffold`. O menu móvel oferece os mesmos destinos, com ajuda acessível. Na Central de ajuda, o nome de um botão, aba ou tela citado numa resposta fica entre aspas curvas e em destaque (`font-medium text-foreground` sobre o texto `muted-foreground` da resposta), para a pessoa reconhecer o controle na tela; as regras de escrita estão em [src/components/help/README.md](src/components/help/README.md). `Panel` é a superfície compartilhada; `StatStrip` mantém métricas consistentes. A autenticação usa a arte da marca (`authImage`; sem ela, o painel fica escuro e sem imagem) e o formulário mantém os handlers existentes.

Marca da instância (item 1.6): nenhum componente escreve o nome, o slogan ou o caminho de uma imagem da marca; tudo vem de `BRAND` (`src/lib/brand.ts`, ver [src/components/brand](src/components/brand/README.md)). O logo fica numa caixa de largura fixa, 176 px (`w-44`) na entrada, na 404 e nas telas de uma coluna e 128 px (`w-32`) no menu expandido, com altura máxima de 48 px (`max-h-12`) e 36 px (`max-h-9`) e `object-contain` alinhado à esquerda: um logo quadrado ou alto fica contido. Sem o logo de um tema, o nome aparece em texto nesse tema, em `font-semibold tracking-tight`, em até duas linhas (`line-clamp-2`) e com `title`; é a exceção à regra de não recriar o logo em texto, que vale para a marca do programa, e o rótulo "CRM" abaixo do logo só aparece quando há imagem, com `aria-hidden` (o texto alternativo do logo já é o nome inteiro). Sem ícone, o menu recolhido e o cabeçalho do celular mostram o monograma: a primeira letra do nome, em `font-semibold` sobre `bg-primary`, no mesmo quadrado arredondado do ícone. O crédito "Feito com Empreende.IA" (só com outra marca) é uma linha `text-xs text-muted-foreground`, sem link e sem ícone, no rodapé das telas de entrada (`BrandFooter`, abaixo do nome) e no rodapé da "Ajuda do CRM".

Pessoa desativada (item 1.2): o nome continua onde ela aparece no histórico, seguido de "(desativado)" no mesmo texto, sem cor de alerta nem ícone (`memberLabel`, em `src/lib/team-members.ts`), e sai dos seletores de responsável; o valor atual desativado aparece marcado, por último. Na Equipe, os cartões de "Pessoas desativadas" usam a borda tracejada, para separar das ativas sem tom de erro. Confirmações que movem registros entre pessoas (desativar e "Passar carteira") seguem o molde da exclusão com vínculos (`DealDeleteDialog`): as contagens chegam antes (`role="status"` enquanto carregam), a confirmação fica desabilitada até elas e até a escolha obrigatória, uma recusa por mudança atualiza as contagens no próprio diálogo, e o erro fica num `role="alert"` ligado ao botão por `aria-describedby`. No celular, o diálogo tem a largura da tela menos a margem, rolagem interna e o botão de confirmar alcançável. "Seu acesso foi encerrado" usa a coluna das telas de entrada (`eia-auth`), como "Falta o convite da sua equipe".

O Design System não altera os modelos de dados. Não renomear entidades ou alterar etapas por texto sem revisar seus vínculos. O plano original de produto, UX e tours, de 06/09/2026, está nos registros do dono, em [docs/dono/PLANO-CRM.md](docs/dono/PLANO-CRM.md).

## Verificação

Executar `npm run typecheck`, `npm run lint:ci` e `npm run build`. Linha de base atual do lint: 0 erros e 9 avisos, todos de Fast Refresh (`react-refresh/only-export-components`) em componentes compartilhados. `npm run lint:ci` aplica a catraca: falha com qualquer erro ou com mais de 9 avisos. Não aumentar o limite nem ocultar avisos preexistentes; ao corrigir um aviso, reduzir o limite. Compilação não comprova validação visual nem integração operacional. Não enviar mensagens ou criar registros de produção para verificar uma alteração visual.
