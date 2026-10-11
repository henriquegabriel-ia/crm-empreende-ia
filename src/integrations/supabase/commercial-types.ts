// Nomes que o app usa para o banco comercial. O schema vem só de database.types.ts, gerado a partir das
// migrações por `npm run gen:types`; não repita colunas nem assinaturas de RPC aqui.
import type { Database } from '@/integrations/supabase/database.types';

export type { Json } from '@/integrations/supabase/database.types';

export type CommercialDatabase = Database;

export type CrmRow<T extends keyof CommercialDatabase['public']['Tables']> =
  CommercialDatabase['public']['Tables'][T]['Row'];
