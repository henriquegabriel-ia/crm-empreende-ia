# CRM Empreende IA

Base do CRM da Empreende IA com React, TypeScript, Vite e o Design System Empreende.IA V2. A interface usa Manrope, identidade oficial, temas claro/escuro e materiais de vidro adaptados aos componentes existentes.

## Desenvolvimento

```bash
git clone https://github.com/henriquegabriel-ia/crm-empreende-ia.git
cd crm-empreende-ia
bun install --frozen-lockfile
cp .env.example .env
# Configure as variáveis para o ambiente de desenvolvimento.
bun run dev
```

Scripts: `bun run build`, `bunx tsc --noEmit -p tsconfig.app.json`, `bun run lint`.

## Configuração

O cliente usa `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_SUPABASE_PROJECT_ID`. O destino opcional de suporte usa `VITE_SUPPORT_EMAIL`; sem ele, a interface orienta procurar o administrador da equipe. Segredos de integrações são configurados no backend, nunca em variáveis públicas Vite.

A configuração de backend herdada ainda precisa ser separada para o novo produto antes de uso operacional. Este trabalho não cria outro banco nem migra dados.

## Estado do produto

A fundação visual foi adaptada ao DS. Os fluxos ativos ainda incluem pacientes, profissionais, consultas, prontuários e pagamentos, além de atividades, tarefas, configurações e integrações. A transformação em CRM comercial exige definir entidades e processos; não é feita apenas trocando os nomes das telas.

- [Contrato de design](DESIGN.md)
- [Plano de produto, UX e tours guiados](docs/PLANO-CRM.md)

Funcionalidades propostas e tours estão documentados para implementação posterior. O histórico do repositório começou em um commit independente; autores e commits da base anterior não pertencem à nova linha de desenvolvimento.

## Licença

Proprietário — todos os direitos reservados. A fonte Manrope mantém sua licença OFL em `public/fonts/Manrope-OFL.txt`.
