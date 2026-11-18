// @vitest-environment node
// Roteiro 3.4: o contrato da Fecha IA carregado no Node para o test:db (scripts/lib/fecha-ai-contract.mjs). O contrato
// em si é testado pelo `deno test` (supabase/functions/_shared/crm-contract_test.ts, o mesmo arquivo da Fecha IA); aqui,
// só que o carregamento sem Deno dá o mesmo resultado e usa a mesma versão do zod.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CRM_CONTRACT_FILE,
  functionsZodVersion,
  loadCrmContract,
  loadCrmContractFixtures,
  sharedModuleSource,
} from './fecha-ai-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('contrato da Fecha IA no Node (roteiro 3.4)', () => {
  it('usa no test:db o mesmo zod do import map das Edge Functions', () => {
    const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    expect(functionsZodVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.packages['node_modules/zod'].version).toBe(functionsZodVersion());
  });

  it('carrega o contrato e chega ao hash do vetor de conformidade, como o Deno e o PostgreSQL', async () => {
    const contract = await loadCrmContract();
    const { CRM_FIXTURE_CONTENT, CRM_FIXTURE_HASH, CRM_FIXTURE_KEY } = await loadCrmContractFixtures();
    const envelope = await contract.sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
    expect(envelope.payloadHash).toBe(CRM_FIXTURE_HASH);
    expect(envelope.idempotencyKey).toBe(CRM_FIXTURE_KEY);
    await expect(contract.parseCrmReviewEnvelope(envelope)).resolves.toEqual(envelope);
    await expect(contract.parseCrmReviewEnvelope({ ...envelope, payloadHash: 'b'.repeat(64) })).rejects.toThrow(
      'O hash da revisão não corresponde ao conteúdo.',
    );
    // O rótulo do contrato não aceita espaço externo, com o trim() do JavaScript (TAB, NBSP e U+FEFF também).
    const choice = {
      kind: 'contact',
      id: CRM_FIXTURE_CONTENT.target.contactId,
      organizationId: envelope.destinationOrganizationId,
    };
    expect(contract.CrmLookupChoiceSchema.safeParse({ ...choice, label: 'João' }).success).toBe(true);
    for (const label of ['\tJoão', 'João\u00a0', '\ufeffJoão', '', 'x'.repeat(401)])
      expect(contract.CrmLookupChoiceSchema.safeParse({ ...choice, label }).success, JSON.stringify(label)).toBe(false);
  });

  it('recusa um import de valor que não seja o zod', () => {
    expect(sharedModuleSource(CRM_CONTRACT_FILE)).toContain('node_modules/zod/');
    expect(() => sharedModuleSource('supabase/functions/_shared/fecha-receiver-http.ts')).toThrow(
      /importa npm:@supabase\/supabase-js@/,
    );
  });
});
