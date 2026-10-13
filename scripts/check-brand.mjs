#!/usr/bin/env node
// Confere a marca da instância (item 1.6; docs/MARCA.md) antes de publicar: public/brand/brand.json, as imagens citadas e
// as variáveis de ambiente da marca (do .env.local e do terminal, como no build). Mostra um resumo do que cada tela vai
// usar e avisa, sem reprovar, quando os e-mails do Auth gerados não acompanham a marca. Sai com 1 só quando há erro.
// Uso:
//   npm run brand:check
//   node scripts/check-brand.mjs --dir <pasta>   confere outra pasta com brand.json e as imagens (testes)
import path from 'node:path';
import { loadEnv } from 'vite';
import {
  BASE_CREDIT_TEXT,
  BRAND_DIR,
  BrandError,
  ROOT,
  brandEnvProblems,
  brandWarnings,
  displayPath,
  exportFileNameFor,
  readBrand,
  resolveCredit,
  resolveSupportEmail,
} from './lib/brand.mjs';
import { buildAuthEmails, compareWithDirectory, readBrand as readEmailBrand } from './lib/auth-emails.mjs';

const USAGE = 'Uso: node scripts/check-brand.mjs [--dir <pasta>]';
const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === '--dir'))) {
  console.error(USAGE);
  process.exit(2);
}
const dir = args.length ? path.resolve(args[1]) : BRAND_DIR;
const file = displayPath(path.join(dir, 'brand.json'));
const env = { ...loadEnv('production', ROOT, 'VITE_'), ...process.env };

const errors = [];
let brand = null;
try {
  brand = readBrand({ dir });
} catch (error) {
  if (!(error instanceof BrandError)) throw error;
  errors.push(error);
}
const envProblems = brandEnvProblems(env);
if (envProblems.length)
  errors.push(
    new BrandError(envProblems, {
      file: 'variáveis de ambiente',
      title: 'Variáveis de ambiente da marca inválidas (no .env.local ou no terminal):',
      hint: 'Corrija o valor ou apague a variável. Na hospedagem, confira também as variáveis do projeto.',
    }),
  );
if (errors.length) {
  console.error(BrandError.join(errors).message);
  process.exit(1);
}

const credit = resolveCredit(brand, env);
const support = resolveSupportEmail(brand, env);
const shown = (name, fallback) => name || fallback;
const icon = brand.favicon || brand.icon;
const creditLine = (() => {
  if (credit.source === 'programa') return 'não aparece (a marca é a do programa)';
  const emails = brand.showBaseCredit ? 'aparece' : 'não aparece';
  if (credit.source === 'VITE_SHOW_BASE_CREDIT')
    return `${credit.show ? 'aparece' : 'não aparece'} no app (VITE_SHOW_BASE_CREDIT=${credit.show}); nos e-mails, segue o brand.json (${emails})`;
  return brand.showBaseCredit
    ? 'aparece no app e nos e-mails ("showBaseCredit": true)'
    : 'não aparece ("showBaseCredit": false)';
})();
let emailsLine;
try {
  const files = buildAuthEmails(readEmailBrand({ dir }));
  emailsLine = compareWithDirectory(files).length
    ? 'desatualizados: rode npm run emails:build e aplique os modelos no painel (supabase/templates/README.md)'
    : 'em dia';
} catch (error) {
  if (!(error instanceof BrandError)) throw error;
  emailsLine = `não foi possível conferir:\n${error.message
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')}`;
}

const exportsOf = (name) => [
  exportFileNameFor(name, 'contatos', 'csv'),
  exportFileNameFor(name, 'agenda', 'ics'),
  exportFileNameFor(name, 'oportunidades', 'csv', 'AAAA-MM-DD'),
];
const [contacts, calendar, deals] = exportsOf(brand.exportName);
const lines = [
  `${file}: marca "${brand.productName}" válida.`,
  `  Aba do navegador: ${brand.productName} (${icon ? `ícone ${icon}` : 'sem ícone: o navegador mostra o ícone padrão'})`,
  `  Logos: ${shown(brand.logoOnLight, 'nome em texto')} (fundo claro) e ${shown(brand.logoOnDark, 'nome em texto')} (fundo escuro); ícone do menu: ${shown(brand.icon, 'primeira letra do nome')}; arte da entrada: ${shown(brand.authImage, 'nenhuma (painel escuro)')}`,
  `  Arquivos exportados: ${contacts}, ${calendar} e ${deals}`,
  `  E-mail de suporte: ${support.email ? `${support.email} (${support.source})` : 'nenhum ("Falar com suporte" não aparece)'}`,
  `  Crédito "${BASE_CREDIT_TEXT}": ${creditLine}`,
  `  E-mails do Auth (supabase/templates/): ${emailsLine}`,
];
const warnings = brandWarnings(brand, { dir, env });
if (warnings.length) lines.push('Avisos:', ...warnings.map((warning) => `  - ${warning}.`));
console.log(lines.join('\n'));
