import type { CommercialDatabase, CrmRow } from '@/integrations/supabase/commercial-types';
import type { Database, Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/database.types';
import type { AUTOMATION_LOG_COLUMNS } from '@/lib/operation-logic';

// Verificações de tipo do contrato da base: valem no `npm run typecheck`, que também compila este arquivo com
// `strictNullChecks` (tsconfig.typetests.json), para `null` e `undefined` não se confundirem. O Vitest só
// executa os blocos. RPCs, tabelas e FKs novas não exigem mudança aqui (exceção: coluna nova em automation_logs,
// que entra em AUTOMATION_LOG_COLUMNS e no GRANT por coluna); se uma migração mudar de propósito
// uma das RPCs, FKs ou colunas obrigatórias conferidas abaixo, rode `npm run gen:types` e ajuste este arquivo.
type PublicSchema = Database['public'];
type Functions = PublicSchema['Functions'];
type TableName = keyof PublicSchema['Tables'];
type RelationshipTo<T extends TableName, Target extends string> = Extract<
  PublicSchema['Tables'][T]['Relationships'][number],
  { referencedRelation: Target }
>;
type RequiredKeys<T> = { [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K }[keyof T];
type BaseRpc = 'accept_invitation' | 'create_workspace' | 'move_deal' | 'search_crm' | 'set_member_role';
type ColumnList<S extends string> = S extends `${infer Head},${infer Tail}` ? Head | ColumnList<Tail> : S;

describe('database.types.ts gerado por npm run gen:types', () => {
  it('keeps CommercialDatabase and CrmRow as re-exports of the generated Database', () => {
    expectTypeOf<CommercialDatabase>().toEqualTypeOf<Database>();
    expectTypeOf<CrmRow<'deals'>>().toEqualTypeOf<Tables<'deals'>>();
    expectTypeOf<CrmRow<'profiles'>>().toEqualTypeOf<PublicSchema['Tables']['profiles']['Row']>();
  });

  it('describes the five base RPCs with the arguments and results declared in the migrations', () => {
    // Só as RPCs da base: uma RPC nova (da F1, do PR da Fecha IA ou do aluno) não quebra este teste.
    expectTypeOf<BaseRpc>().toExtend<keyof Functions>();

    expectTypeOf<Functions['create_workspace']['Args']>().toEqualTypeOf<{ p_name: string }>();
    expectTypeOf<Functions['create_workspace']['Returns']>().toEqualTypeOf<string>();

    expectTypeOf<Functions['accept_invitation']['Args']>().toEqualTypeOf<{ p_invitation_id: string }>();
    expectTypeOf<Functions['accept_invitation']['Returns']>().toEqualTypeOf<string>();

    expectTypeOf<Functions['set_member_role']['Args']>().toEqualTypeOf<{ p_user_id: string; p_role: string }>();
    expectTypeOf<Functions['set_member_role']['Returns']>().toEqualTypeOf<undefined>();

    expectTypeOf<Functions['move_deal']['Args']>().toEqualTypeOf<{
      p_deal_id: string;
      p_stage_id: string;
      p_status?: string;
      p_lost_reason?: string;
    }>();
    expectTypeOf<Functions['move_deal']['Returns']>().toEqualTypeOf<Json>();

    expectTypeOf<Functions['search_crm']['Args']>().toEqualTypeOf<{ p_query: string; p_limit?: number }>();
    expectTypeOf<Functions['search_crm']['Returns']>().toEqualTypeOf<
      { entity: string; id: string; title: string; subtitle: string; path: string }[]
    >();
  });

  it('describes the deletion and automation RPCs of item 0.7', () => {
    expectTypeOf<'delete_deal' | 'automation_log_errors'>().toExtend<keyof Functions>();
    expectTypeOf<Functions['delete_deal']['Args']>().toEqualTypeOf<{ p_deal_id: string; p_confirm?: boolean }>();
    expectTypeOf<Functions['delete_deal']['Returns']>().toEqualTypeOf<Json>();
    expectTypeOf<Functions['automation_log_errors']['Args']>().toEqualTypeOf<{ p_automation_id: string }>();
    expectTypeOf<Functions['automation_log_errors']['Returns']>().toEqualTypeOf<
      { id: string; error_detail: string }[]
    >();
    // Logs preservados: os vínculos ficam opcionais (ON DELETE SET NULL) e o nome da automação é obrigatório.
    expectTypeOf<Tables<'automation_logs'>['automation_id']>().toEqualTypeOf<string | null>();
    expectTypeOf<Tables<'automation_logs'>['deal_id']>().toEqualTypeOf<string | null>();
    expectTypeOf<Tables<'automation_logs'>['automation_name']>().toEqualTypeOf<string>();
    expectTypeOf<RelationshipTo<'automations', 'pipeline_stages'>['columns']>().toEqualTypeOf<
      ['stage_id', 'pipeline_id', 'org_id']
    >();
    // automation_logs tem SELECT por coluna (sem error_detail): os tipos mostram error_detail, mas select('*') e a
    // leitura dessa coluna são recusados (42501). AUTOMATION_LOG_COLUMNS lista todas as demais; uma coluna nova na
    // tabela entra no GRANT de uma migração nova e nessa lista.
    expectTypeOf<ColumnList<typeof AUTOMATION_LOG_COLUMNS>>().toEqualTypeOf<
      Exclude<keyof Tables<'automation_logs'>, 'error_detail'>
    >();
  });

  it('lists foreign keys, including composite ones, in Relationships', () => {
    expectTypeOf<RelationshipTo<'deals', 'pipeline_stages'>>().toEqualTypeOf<{
      foreignKeyName: 'deals_stage_id_pipeline_id_org_id_fkey';
      columns: ['stage_id', 'pipeline_id', 'org_id'];
      isOneToOne: false;
      referencedRelation: 'pipeline_stages';
      referencedColumns: ['id', 'pipeline_id', 'org_id'];
    }>();
    expectTypeOf<RelationshipTo<'activities', 'deals'>['columns']>().toEqualTypeOf<['deal_id', 'org_id']>();
    expectTypeOf<RelationshipTo<'contacts', 'companies'>['referencedColumns']>().toEqualTypeOf<['id', 'org_id']>();
    expectTypeOf<RelationshipTo<'user_roles', 'profiles'>['isOneToOne']>().toEqualTypeOf<true>();
    // FKs para fora do schema public (profiles.id → auth.users) ficam de fora, como no gerador oficial:
    // profiles só tem a FK para organizations.
    expectTypeOf<RelationshipTo<'profiles', 'users'>>().toEqualTypeOf<never>();
    expectTypeOf<
      PublicSchema['Tables']['profiles']['Relationships'][number]['foreignKeyName']
    >().toEqualTypeOf<'profiles_org_id_fkey'>();
    // Tabela sem FK nenhuma: Relationships vazia.
    expectTypeOf<PublicSchema['Tables']['organizations']['Relationships']>().toEqualTypeOf<[]>();
  });

  it('requires only columns without default on insert and nothing on update', () => {
    expectTypeOf<RequiredKeys<TablesInsert<'contacts'>>>().toEqualTypeOf<'org_id' | 'first_name'>();
    expectTypeOf<RequiredKeys<TablesInsert<'deals'>>>().toEqualTypeOf<
      'org_id' | 'pipeline_id' | 'stage_id' | 'title'
    >();
    expectTypeOf<RequiredKeys<TablesInsert<'profiles'>>>().toEqualTypeOf<'id'>();
    expectTypeOf<RequiredKeys<TablesUpdate<'deals'>>>().toEqualTypeOf<never>();
  });
});
