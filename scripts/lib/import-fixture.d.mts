/** Tipos de scripts/lib/import-fixture.mjs, para os testes em TypeScript (Vitest e Playwright). */

export declare const IMPORT_FIXTURE_FILE: string;
export declare const IMPORT_FIXTURE_ROWS: number;
export declare const IMPORT_FIXTURE_HEADERS: readonly string[];
export declare const IMPORT_FIXTURE_DEFAULT_SOURCE: string;
export declare const IMPORT_FIXTURE_CONSENT_NOTE: string;

export interface ImportFixtureContact {
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}
export declare const IMPORT_FIXTURE_EXISTING: readonly ImportFixtureContact[];

export interface ImportFixtureRow {
  /** Número da linha no Excel (o cabeçalho é a linha 1). */
  line: number;
  category: 'ready' | 'duplicate' | 'error';
  reason: string | null;
  cells: {
    name: string;
    email: string;
    phone: string;
    company: string;
    jobTitle: string;
    source: string;
    owner: string;
    status: string;
    notes: string;
    doNotContact: string;
    legal: string;
    note: string;
    birth: string;
    extra: string;
  };
}

export interface ImportFixtureExpected {
  rows: number;
  ready: number;
  duplicates: number;
  errors: number;
  duplicateReasons: Record<string, number>;
  errorReasons: Record<string, number>;
  newCompanies: number;
  linkedToExampleCompany: number;
  unrecognizedPhones: number;
  doNotContact: number;
  consents: number;
  legitimateInterest: number;
  contract: number;
  withoutSource: number;
  ownerColumn: { bruna: number; carla: number };
  distribution: { bruna: number; carla: number };
  errorLines: Record<string, number>;
  duplicateLines: number[];
}

export declare function buildContactImportFixture(): {
  bytes: Uint8Array;
  text: string;
  headers: readonly string[];
  rows: ImportFixtureRow[];
  existing: readonly ImportFixtureContact[];
  expected: ImportFixtureExpected;
};
