-- Item 0.6 do roteiro: data real de fechamento e probabilidade que acompanha a etapa (decisão D8).
-- closed_at: preenchida ao ganhar ou perder (now() quando não informada), editável enquanto a oportunidade
-- estiver ganha ou perdida, nunca anterior à criação nem posterior a now() + 1 dia, e anulada ao reabrir.
-- probability: NULL significa "herda a probabilidade da etapa atual"; ganho = 100, perda = 0, reabrir = NULL;
-- mover de etapa mantém o NULL (herda) ou o valor manual.
alter table public.deals add column closed_at timestamptz;
alter table public.deals add constraint deals_closed_at_finite check(isfinite(closed_at));

create or replace function private.validate_deal_change() returns trigger language plpgsql set search_path='' as $$
 begin
 if tg_op='INSERT' or old.stage_id is distinct from new.stage_id then new.stage_entered_at=now();
 else new.stage_entered_at=old.stage_entered_at; end if;
 if new.status<>'lost' then new.lost_reason=null; end if;
 if new.status='won' then new.probability=100;
 elsif new.status='lost' then new.probability=0;
 elsif tg_op='UPDATE' and old.status<>'open' then new.probability=null;
 end if;
 if new.status='open' then new.closed_at=null;
 elsif tg_op='INSERT' then new.closed_at=coalesce(new.closed_at,now());
 elsif old.status is distinct from new.status then
  new.closed_at=case when new.closed_at is distinct from old.closed_at then coalesce(new.closed_at,now()) else now() end;
 elsif new.closed_at is null then
  raise exception 'Informe a data de fechamento da oportunidade encerrada.';
 end if;
 if new.closed_at is not null and (tg_op='INSERT' or new.closed_at is distinct from old.closed_at) then
  if new.closed_at>now()+interval '1 day' then
   raise exception 'A data de fechamento não pode estar no futuro.';
  end if;
  if new.closed_at<new.created_at then
   raise exception 'A data de fechamento não pode ser anterior à criação da oportunidade.';
  end if;
 end if;
 return new;
 end;
$$;

-- Backfill sem passar pelos gatilhos: não muda updated_at (usado pela regra de oportunidades paradas),
-- não grava auditoria nem histórico e não dispara automações.
alter table public.deals disable trigger user;
-- Data exata: a última entrada na situação atual (ganha ou perdida), inclusive a criação já encerrada.
-- Movimentos de etapa depois do fechamento repetem a situação e não contam.
update public.deals d set closed_at=coalesce(
 (select max(h.created_at) from public.deal_stage_history h
  where h.deal_id=d.id and h.org_id=d.org_id and h.to_status=d.status and h.from_status is distinct from h.to_status),
 d.updated_at)
 where d.status in ('won','lost');
-- Abertas com a mesma probabilidade da etapa atual passam a herdar dela; valores diferentes ficam como manuais.
update public.deals d set probability=null
 from public.pipeline_stages s
 where s.id=d.stage_id and s.org_id=d.org_id and d.status='open' and d.probability=s.win_probability;
update public.deals set probability=100 where status='won' and probability is distinct from 100;
update public.deals set probability=0 where status='lost' and probability is distinct from 0;
alter table public.deals enable trigger user;

alter table public.deals add constraint deals_closed_at_status check((status='open')=(closed_at is null));
create index deals_org_status_closed on public.deals(org_id,status,closed_at);
