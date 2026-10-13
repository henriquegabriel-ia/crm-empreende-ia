import { useQuery } from '@tanstack/react-query';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useOrg } from '@/hooks/useOrg';
import { allRows } from '@/components/pipeline/data';

/** Os modelos da organização, na ordem de "Modelos": a mesma leitura e a mesma chave da tela, que dividem o cache. */
export function loadMessageTemplates(orgId: string) {
  return allRows((from, to) =>
    crmDb.from('email_templates').select('*').eq('org_id', orgId).order('name').order('id').range(from, to),
  );
}

/** Modelos para os diálogos de mensagem (item 1.9), lidos só quando um diálogo abre. */
export function useMessageTemplates(enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ['crm', orgId, 'templates'],
    enabled: enabled && !!orgId,
    queryFn: () => loadMessageTemplates(orgId!),
  });
}

/** O nome da organização em "Configurações", para a variável {{organizacao}}. */
export function useOrganizationName(enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ['crm', orgId, 'organization-name'],
    enabled: enabled && !!orgId,
    queryFn: async () => {
      const { data, error } = await crmDb.from('organizations').select('name').eq('id', orgId!).maybeSingle();
      if (error) throw error;
      return data?.name ?? null;
    },
  });
}
