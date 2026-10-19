#!/usr/bin/env node
// Configuração do Supabase Auth da instância (item 1.3; docs/arquitetura/1.3.md, seções 4.3 e 5): confere
// supabase/config.toml e as variáveis de supabase/.env e, no push, chama o Supabase CLI fixado só depois da conferência.
// As regras ficam em scripts/lib/supabase-config.mjs. Sem dependências além do Node (o CLI vem pelo npx, só no push).
// Uso:
//   npm run config:check               confere tudo, sem enviar nada; sai com 1 se houver problema;
//   npm run config:check -- --local    o mesmo para o Supabase local (aceita http://localhost; não serve ao push);
//   npm run config:push                a conferência e, só sem problemas, npx supabase@<versão> config push, que mostra a
//                                      diferença e pergunta antes de gravar cada serviço.
import { BrandError, readBrand } from './lib/brand.mjs';
import { buildAuthEmails, configTemplateRegion, readBrand as readEmailBrand } from './lib/auth-emails.mjs';
import { checkInstanceConfig, formatReport, runConfigPush } from './lib/supabase-config.mjs';

const USAGE = 'Uso: node scripts/supabase-config.mjs check [--local] | push';
const [command, ...rest] = process.argv.slice(2);
const local = rest.length === 1 && rest[0] === '--local';
if (!['check', 'push'].includes(command) || (rest.length && !(command === 'check' && local))) {
  console.error(USAGE);
  process.exit(2);
}

// A região dos modelos que o gerador escreveria agora e o nome da marca (para o aviso do remetente). Uma marca
// inválida não impede a conferência do Auth: o brand:check e o build já a recusam com a lista de problemas.
function generated() {
  let expectedRegion;
  let brandName;
  try {
    expectedRegion = configTemplateRegion(buildAuthEmails(readEmailBrand()));
  } catch (error) {
    if (!(error instanceof BrandError)) throw error;
  }
  try {
    brandName = readBrand().productName;
  } catch (error) {
    if (!(error instanceof BrandError)) throw error;
  }
  return { expectedRegion, brandName };
}

const check = () => checkInstanceConfig({ local, requireLink: command === 'push', ...generated() });

if (command === 'check') {
  const result = check();
  if (result.problems.length) {
    console.error(formatReport(result, { failed: true }));
    process.exit(1);
  }
  console.log(formatReport(result, { failed: false }));
  if (local) console.log('Modo --local: serve ao Supabase local (npx supabase start), nunca ao push.');
  else console.log('Para aplicar no projeto ligado: npm run config:push.');
} else {
  process.exit(await runConfigPush({ check }));
}
