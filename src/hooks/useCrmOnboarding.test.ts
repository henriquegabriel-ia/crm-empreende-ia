import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown; error: unknown } | Error>,
  calls: [] as { table: string; select: string; filters: [string, string][]; limited?: number; signal?: AbortSignal }[],
}));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: {
  from: (table: string) => {
    const call = { table, select: '', filters: [] as [string, string][], limited: undefined as number | undefined, signal: undefined as AbortSignal | undefined };
    fixture.calls.push(call);
    const chain = {
      select: (columns: string) => { call.select = columns; return chain; },
      eq: (column: string, value: string) => { call.filters.push([column, value]); return chain; },
      limit: (count: number) => { call.limited = count; return chain; },
      abortSignal: (signal: AbortSignal) => { call.signal = signal; return chain; },
      maybeSingle: () => chain,
      then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
        const result = fixture.results[table] ?? { data: [], error: null };
        return result instanceof Error ? Promise.reject(result).then(resolve, reject) : Promise.resolve(result).then(resolve, reject);
      },
    };
    return chain;
  },
} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, profile: null }) }));

import { fetchSetupEvidence } from './useCrmOnboarding';

beforeEach(() => { fixture.results = {}; fixture.calls = []; });

describe('configuration evidence queries', () => {
  it('only marks configuration complete from actual names and existing commercial records', async () => {
    for (const table of ['pipelines', 'pipeline_stages', 'contacts', 'deals', 'activities']) fixture.results[table] = { data: [{ id: 'record' }], error: null };
    fixture.results.organizations = { data: { name: 'Empreende IA' }, error: null };
    fixture.results.profiles = { data: { name: 'Pessoa' }, error: null };
    expect(await fetchSetupEvidence('org', 'user', new AbortController().signal)).toEqual({ identity: 'done', pipeline: 'done', contact: 'done', opportunity: 'done', activity: 'done' });
  });
  it('does not accept a pipeline without stages or an organization without a named profile', async () => {
    fixture.results.organizations = { data: { name: 'Empreende IA' }, error: null };
    fixture.results.profiles = { data: { name: '  ', onboarding_completed: true }, error: null };
    fixture.results.pipelines = { data: [{ id: 'pipeline' }], error: null };
    const result = await fetchSetupEvidence('org', 'user', new AbortController().signal);
    expect(result.identity).toBe('pending');
    expect(result.pipeline).toBe('pending');
  });
  it('keeps partial failures explicit and does not turn a failed query into empty or completed', async () => {
    fixture.results.contacts = { data: [{ id: 'contact' }], error: null };
    fixture.results.deals = { data: null, error: { message: 'permission denied' } };
    fixture.results.activities = new Error('Network error');
    const result = await fetchSetupEvidence('org', 'user', new AbortController().signal);
    expect(result.contact).toBe('done');
    expect(result.opportunity).toBe('error');
    expect(result.activity).toBe('error');
  });
  it('scopes every query, requests minimal fields, and never writes onboarding flags or records', async () => {
    const signal = new AbortController().signal;
    await fetchSetupEvidence('org-a', 'user-a', signal);
    expect(fixture.calls.map((call) => call.table)).toEqual(['organizations', 'profiles', 'pipelines', 'pipeline_stages', 'contacts', 'deals', 'activities']);
    for (const call of fixture.calls) {
      expect(call.filters).toContainEqual([call.table === 'organizations' ? 'id' : 'org_id', 'org-a']);
      expect(call.signal).toBe(signal);
      expect(['name', 'id']).toContain(call.select);
    }
    expect(fixture.calls.find((call) => call.table === 'profiles')?.filters).toContainEqual(['id', 'user-a']);
    expect(fixture.calls.filter((call) => call.select === 'id').every((call) => call.limited === 1)).toBe(true);
  });
});
