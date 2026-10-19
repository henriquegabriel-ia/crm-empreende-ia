// @vitest-environment node
// Item 1.7b (docs/arquitetura/1.7b.md, seção 8.1): o plugin crm-version injeta a versão do package.json em
// __CRM_VERSION__ e na meta crm-version do index.html, e uma versão fora do SemVer reprova o build com a mensagem em
// pt-BR. A leitura da meta é a mesma do verify-instance.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AppVersionError,
  VERSION_META_NAME,
  readAppVersion,
  readPackageVersion,
  versionFromHtml,
  versionPlugin,
} from './app-version.mjs';
import { isSemver } from './changelog.mjs';

describe('a versão visível (item 1.7b)', () => {
  it('o package.json do repositório tem uma versão SemVer', () => {
    expect(isSemver(readPackageVersion())).toBe(true);
  });

  it('o plugin injeta __CRM_VERSION__ e a meta crm-version no head', () => {
    const plugin = versionPlugin({ version: '1.0.0-beta.1' });
    expect(plugin.name).toBe('crm-version');
    expect(plugin.config({})).toEqual({ define: { __CRM_VERSION__: '"1.0.0-beta.1"' } });
    expect(plugin.transformIndexHtml('<html></html>')).toEqual([
      { tag: 'meta', attrs: { name: VERSION_META_NAME, content: '1.0.0-beta.1' }, injectTo: 'head' },
    ]);
  });

  it('sem versão informada, o plugin lê o package.json da raiz do projeto do Vite', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'crm-version-'));
    try {
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.3.4-rc.5' }));
      expect(versionPlugin().config({ root: dir })).toEqual({ define: { __CRM_VERSION__: '"2.3.4-rc.5"' } });
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0' }));
      expect(() => versionPlugin().config({ root: dir })).toThrow(AppVersionError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(['1.0', '01.0.0', '1.0.0-', 'v1.0.0', undefined, 1])(
    'a versão %s reprova o build com a mensagem em pt-BR',
    (version) => {
      expect(() => readAppVersion({ version })).toThrow(
        /^A versão do package\.json \(.*\) não segue o Versionamento Semântico \(por exemplo, 1\.0\.0-beta\.1\)\.$/,
      );
    },
  );

  it('a leitura da meta aceita aspas simples ou duplas, os atributos em qualquer ordem, e só a primeira conta', () => {
    expect(versionFromHtml('<head><meta name="crm-version" content="1.0.0"></head>')).toBe('1.0.0');
    expect(versionFromHtml("<meta content='1.0.0-rc.1' name='crm-version' />")).toBe('1.0.0-rc.1');
    expect(versionFromHtml('<META NAME="crm-version" CONTENT="1.2.3">')).toBe('1.2.3');
    expect(
      versionFromHtml(
        '<meta name="robots" content="noindex"><meta name="crm-version" content="1.0.0"><meta name="crm-version" content="9.9.9">',
      ),
    ).toBe('1.0.0');
    expect(versionFromHtml('<meta name="robots" content="noindex, nofollow">')).toBeNull();
    expect(versionFromHtml('')).toBeNull();
  });
});
