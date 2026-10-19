// A versão visível (item 1.7b; docs/arquitetura/1.7b.md, seção 8): o build lê a versão do package.json, confere o
// Versionamento Semântico e a injeta em `__CRM_VERSION__` (rodapé da Ajuda, por src/lib/app-version.ts) e na meta
// `<meta name="crm-version">` do index.html, que o `npm run verify-instance` compara com o package.json local
// ("Versão publicada"). Separado do plugin da marca (brand.mjs): a versão identifica a base, não a empresa.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSemver } from './changelog.mjs';

export const VERSION_META_NAME = 'crm-version';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Versão do package.json fora do SemVer: o build para com a mensagem em pt-BR. */
export class AppVersionError extends Error {}

/** A versão de um package.json já lido, conferida: lança AppVersionError quando ela não segue o SemVer. */
export function readAppVersion(pkg) {
  const version = pkg?.version;
  if (typeof version !== 'string' || !parseSemver(version))
    throw new AppVersionError(
      `A versão do package.json (${version ?? 'ausente'}) não segue o Versionamento Semântico (por exemplo, 1.0.0-beta.1).`,
    );
  return version;
}

/** A versão do package.json de `root` (a raiz do repositório, por padrão), conferida. */
export function readPackageVersion(root = ROOT) {
  return readAppVersion(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')));
}

/**
 * A primeira meta `crm-version` de uma página, ou `null`: aceita aspas simples ou duplas e os atributos em qualquer
 * ordem (a leitura do verify-instance).
 */
export function versionFromHtml(html) {
  for (const [tag] of String(html ?? '').matchAll(/<meta\b[^>]*>/gi)) {
    const attribute = (name) =>
      tag
        .match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
        ?.slice(1)
        .find((v) => v !== undefined);
    if (attribute('name') === VERSION_META_NAME) return attribute('content') ?? '';
  }
  return null;
}

/**
 * Plugin `crm-version` do Vite (vite.config.ts): `define` com `__CRM_VERSION__` e a meta no `<head>` do index.html.
 * `version` entra só nos testes; no dev e no build, vem do package.json da raiz do projeto.
 */
export function versionPlugin({ version } = {}) {
  let current = version ?? null;
  return {
    name: 'crm-version',
    config(userConfig) {
      current ??= readPackageVersion(path.resolve(userConfig.root ?? process.cwd()));
      return { define: { __CRM_VERSION__: JSON.stringify(current) } };
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: VERSION_META_NAME, content: current }, injectTo: 'head' }];
    },
  };
}
