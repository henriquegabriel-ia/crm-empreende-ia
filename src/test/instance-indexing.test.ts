import { readFileSync } from 'node:fs';
import path from 'node:path';

// Cada instância é o CRM privado de uma empresa: nenhuma página pode ser indexada por buscadores.
// Para reverter numa página pública, ver "Instância fora dos buscadores" no README.
const readRootFile = (relative: string) => readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');

const robotsRules = () =>
  readRootFile('public/robots.txt')
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':');
      return { field: line.slice(0, separator).trim().toLowerCase(), value: line.slice(separator + 1).trim() };
    });

describe('instance indexing', () => {
  it('marks every page as noindex and nofollow in index.html', () => {
    const document = new DOMParser().parseFromString(readRootFile('index.html'), 'text/html');
    const robots = document.querySelectorAll('meta[name="robots"]');

    expect(robots).toHaveLength(1);
    const directives = (robots[0].getAttribute('content') ?? '').split(',').map((value) => value.trim().toLowerCase());
    expect(directives).toEqual(expect.arrayContaining(['noindex', 'nofollow']));
  });

  // Item 1.6: o título, o og:title e o favicon vêm da marca da instância (plugin crm-brand, scripts/lib/brand.mjs).
  it('keeps the brand markers instead of the program name and favicon', () => {
    const html = readRootFile('index.html');
    expect(html).toContain('<title>%CRM_BRAND_NAME%</title>');
    expect(html).toContain('<meta property="og:title" content="%CRM_BRAND_NAME%" />');
    expect(html).toContain('<!-- %CRM_BRAND_ICON% -->');
    expect(html).not.toMatch(/Empreende|favicon\.svg|rel="icon"/);
  });

  it('closes the whole site to every crawler in robots.txt', () => {
    const rules = robotsRules();

    expect(rules).toEqual([
      { field: 'user-agent', value: '*' },
      { field: 'disallow', value: '/' },
    ]);
  });
});
