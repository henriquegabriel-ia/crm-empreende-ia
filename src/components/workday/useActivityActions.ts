import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useOrg } from '@/hooks/useOrg';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { relationshipError } from '@/lib/contact-model';
import type { Activity } from '@/lib/activity-logic';
import { toast } from 'sonner';
export function useActivityActions() {
  const { orgId } = useOrg(); const { canWrite } = useCrmPermissions(); const cache = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  async function mutate(activity: Activity, remove = false) {
    if (!orgId || !canWrite || busy) return false; setBusy(activity.id); setError(null);
    try {
      const request = remove ? crmDb.from('activities').delete() : crmDb.from('activities').update({ completed_at: activity.completed_at ? null : new Date().toISOString() });
      const result = await request.eq('org_id', orgId).eq('id', activity.id).select('id').single(); if (result.error) throw result.error;
      await cache.invalidateQueries({ queryKey: ['crm'] }); toast.success(remove ? 'Atividade excluída' : activity.completed_at ? 'Atividade reaberta' : 'Atividade concluída'); return true;
    } catch (cause) { setError(relationshipError(cause)); return false; } finally { setBusy(null); }
  }
  return { busy, error, toggle: (activity: Activity) => mutate(activity), remove: (activity: Activity) => mutate(activity, true) };
}
