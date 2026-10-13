import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Achado 8 da revisão do item 1.2 (corrigido no item 1.6): os filtros dizem "Todos os funis", "Todos os responsáveis" e
// "Todas as situações", com o artigo, em todas as telas. No molde do teste de "pipeline" minúsculo em deal-logic.test.ts.
const ROOT = path.resolve(__dirname, '../..');

function screens(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return screens(file);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [file] : [];
  });
}

describe('rótulo "todos" dos filtros', () => {
  const options = screens(path.join(ROOT, 'src')).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/<SelectItem value="all">([^<]+)<\/SelectItem>/g)].map((match) => ({
      file: path.relative(ROOT, file).split(path.sep).join('/'),
      label: match[1].trim(),
    })),
  );

  it('acha os filtros das telas', () => {
    expect(options.map(({ label }) => label)).toEqual(
      expect.arrayContaining(['Todos os funis', 'Todos os responsáveis', 'Todas as situações']),
    );
  });

  it('todo "Todos" ou "Todas" de um filtro leva o artigo', () => {
    const missing = options
      .filter(({ label }) => /^Tod[oa]s /.test(label) && !/^Todos os |^Todas as /.test(label))
      .map(({ file, label }) => `${file}: ${label}`);
    expect(missing).toEqual([]);
  });
});
