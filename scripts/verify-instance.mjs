#!/usr/bin/env node
// Conferência da instância publicada (item 1.4; docs/arquitetura/1.4.md, seção 7). Confere, de fora e só com a chave
// pública, a URL do CRM publicado e a configuração pública do Auth do projeto Supabase. As regras ficam em
// scripts/lib/verify-instance.mjs. Sem dependências além do Node 20 e sem nenhuma credencial privada: a chave secreta
// (sb_secret_…) e o JWT service_role são recusados antes de qualquer pedido.
// Uso:
//   npm run verify-instance -- <SUA_URL>                  a URL do CRM; a do Supabase e a chave pública vêm de
//                                                          VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY (ambiente,
//                                                          .env.local ou .env);
//   npm run verify-instance -- <SUA_URL> --supabase-url https://<ref>.supabase.co --key sb_publishable_…
//   npm run verify-instance -- http://localhost:4173 --local   ensaio contra o npm run preview (não vale pela instância).
// Saída: 0 aprovada, 1 reprovada, 2 entrada inválida.
import {
  VERIFY_USAGE,
  VerifyInputError,
  formatVerifyReport,
  instanceInputs,
  maskKey,
  verifyInstance,
} from './lib/verify-instance.mjs';

const inputs = instanceInputs(process.argv.slice(2));
if (inputs.help) {
  console.log(VERIFY_USAGE);
  process.exit(0);
}
if (inputs.problems.length) {
  console.error('A conferência não começou: nenhum pedido foi feito.');
  for (const problem of inputs.problems) console.error(`- ${problem}`);
  process.exit(2);
}
console.log(
  `Endereço do CRM: ${inputs.siteUrl} (${inputs.sources.siteUrl}). Supabase: ${inputs.supabaseUrl} (${inputs.sources.supabaseUrl}). Chave pública: ${maskKey(inputs.publishableKey)} (${inputs.sources.publishableKey}).`,
);
try {
  const result = await verifyInstance({
    siteUrl: inputs.siteUrl,
    supabaseUrl: inputs.supabaseUrl,
    publishableKey: inputs.publishableKey,
    allowLocal: inputs.local,
  });
  const report = formatVerifyReport(result, inputs);
  if (result.approved) console.log(report);
  else console.error(report);
  // exitCode, e não process.exit: no Windows, sair no meio do fechamento das conexões do fetch derruba o Node.
  process.exitCode = result.approved ? 0 : 1;
} catch (error) {
  if (error instanceof VerifyInputError) {
    console.error(error.problems.map((problem) => `- ${problem}`).join('\n'));
    process.exitCode = 2;
  } else throw error;
}
