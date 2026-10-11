#!/usr/bin/env node
// Aplica a cadeia completa de migrações e roda as verificações de RLS num PostgreSQL 17 descartável.
// Funciona em Windows, macOS e Linux sem PostgreSQL instalado: o cluster temporário (porta livre em
// 127.0.0.1, diretório apagado ao final, inclusive em falha ou Ctrl+C) vem de `scripts/lib/embedded-db.mjs`.
// Nunca aponte estes arquivos para um banco remoto.
import path from 'node:path';
import { ROOT, SqlFileError, TEMP_PREFIXES, runWithEmbeddedDb } from './lib/embedded-db.mjs';

const TEST_FILE = 'supabase/tests/commercial-security.sql';

let passCount = 0;
let lastPass = null;
let countingChecks = false;

// Cada `PASS: ...` emitido por test_support.assert/denied conta como uma verificação aprovada.
function countPass(notice) {
  const message = notice.message ?? '';
  if (message.startsWith('PASS: ')) {
    passCount += 1;
    lastPass = message.slice('PASS: '.length);
    process.stdout.write(`  ${message}\n`);
  } else process.stdout.write(`  ${notice.severity ?? 'NOTICE'}: ${message}\n`);
}

await runWithEmbeddedDb({
  tempPrefix: TEMP_PREFIXES.testDb,
  applicationName: 'crm-test-db',
  async run(db) {
    await db.applySchema();
    console.log(`Executando ${TEST_FILE}`);
    countingChecks = true;
    await db.runInFreshSession(path.join(ROOT, TEST_FILE), { onNotice: countPass });
    countingChecks = false;
    if (passCount === 0) throw new SqlFileError('nenhuma verificação PASS foi emitida', TEST_FILE, 1, true);
  },
  sqlFailureDetails: () =>
    countingChecks
      ? [`  Verificações aprovadas antes da falha: ${passCount}${lastPass ? ` (última: ${lastPass})` : ''}`]
      : [],
  successMessage: () => `\n${passCount} verificações PostgreSQL passaram. Cluster temporário removido.`,
});
