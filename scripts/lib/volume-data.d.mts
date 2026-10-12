/** Tipos de scripts/lib/volume-data.mjs, para os testes em TypeScript (Vitest e Playwright). */

export declare const VOLUME_SEED: number;
export declare const VOLUME_NOW: string;
export declare const VOLUME_COUNTS: Readonly<{
  companies: number;
  contacts: number;
  deals: number;
  activities: number;
}>;

export interface VolumeRandom {
  next(): number;
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(list: readonly T[]): T;
  uuid(): string;
}
export declare function createRandom(seed?: number): VolumeRandom;

export interface VolumeCompany {
  id: string;
  org_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  revenue: number | null;
  website: string | null;
  linkedin_url: string | null;
  owner_id: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}
export interface VolumeContact {
  id: string;
  org_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  owner_id: string | null;
  status: string;
  job_title: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface VolumeDeal {
  id: string;
  org_id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value: number;
  currency: string;
  contact_id: string | null;
  company_id: string | null;
  owner_id: string | null;
  close_date: string | null;
  probability: number | null;
  status: 'open' | 'won' | 'lost';
  lost_reason: string | null;
  closed_at: string | null;
  stage_entered_at: string;
  created_at: string;
  updated_at: string;
}
export interface VolumeActivity {
  id: string;
  org_id: string;
  type: 'task' | 'call' | 'email' | 'meeting' | 'note';
  title: string;
  body: string | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  user_id: string | null;
  due_date: string | null;
  end_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}
export interface VolumeData {
  companies: VolumeCompany[];
  contacts: VolumeContact[];
  deals: VolumeDeal[];
  activities: VolumeActivity[];
}
export interface VolumeOptions {
  orgId: string;
  ownerIds: readonly string[];
  stages: readonly { id: string; pipeline_id: string }[];
  seed?: number;
  now?: string | Date;
  counts?: Partial<typeof VOLUME_COUNTS>;
}
export declare function generateVolumeData(options: VolumeOptions): VolumeData;
