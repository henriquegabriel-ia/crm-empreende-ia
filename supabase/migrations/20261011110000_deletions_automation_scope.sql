-- Item 0.7 do roteiro: exclusões que falhavam por vínculo e automações básicas, numa única reescrita de
-- private.run_deal_automations.
-- automation_logs preserva o histórico: automation_id, deal_id e activity_id passam a ON DELETE SET NULL só na coluna
-- (forma com lista de colunas do PostgreSQL 15+, porque org_id é NOT NULL), com o nome da automação gravado em cada
-- execução (automation_name). error_detail guarda SQLSTATE e SQLERRM da falha e só administradores o leem, pela RPC
-- automation_log_errors; os demais papéis continuam lendo as outras colunas dos logs.
-- automations ganha funil e etapa opcionais para o gatilho 'deal_moved'. Se o funil ou a etapa do filtro forem
-- excluídos, o filtro some e a automação é pausada, em vez de passar a disparar em qualquer etapa.
-- delete_deal exclui uma oportunidade depois de confirmar os vínculos: desvincula atividades e recebimentos e mantém
-- os logs de automação. A guarda crm.bulk_move = 'on' fica reservada para movimentações em massa futuras e só pode
-- ser ligada na transação (set_config('crm.bulk_move','on',true) ou SET LOCAL, dentro da RPC): ligada na sessão, ela
-- ficaria na conexão compartilhada (PostgREST, pooler) e calaria as automações das requisições seguintes.

-- Logs de automação: snapshot do nome, detalhe técnico da falha e vínculos que não impedem exclusões.
alter table public.automation_logs add column automation_name text;
alter table public.automation_logs add column error_detail text;
update public.automation_logs l set automation_name=a.name from public.automations a where a.id=l.automation_id and a.org_id=l.org_id;
alter table public.automation_logs alter column automation_name set not null;
alter table public.automation_logs alter column automation_id drop not null;
alter table public.automation_logs alter column deal_id drop not null;
alter table public.automation_logs drop constraint automation_logs_automation_id_org_id_fkey;
alter table public.automation_logs add constraint automation_logs_automation_id_org_id_fkey foreign key(automation_id,org_id) references public.automations(id,org_id) on delete set null (automation_id);
alter table public.automation_logs drop constraint automation_logs_deal_id_org_id_fkey;
alter table public.automation_logs add constraint automation_logs_deal_id_org_id_fkey foreign key(deal_id,org_id) references public.deals(id,org_id) on delete set null (deal_id);
alter table public.automation_logs drop constraint automation_logs_activity_id_org_id_fkey;
alter table public.automation_logs add constraint automation_logs_activity_id_org_id_fkey foreign key(activity_id,org_id) references public.activities(id,org_id) on delete set null (activity_id);
-- Leitura por coluna: error_detail fica de fora do SELECT dos membros; administradores o leem pela RPC abaixo.
revoke select on public.automation_logs from authenticated;
grant select(id,org_id,automation_id,automation_name,deal_id,activity_id,status,error_message,created_at) on public.automation_logs to authenticated;

-- Filtro de funil e etapa no gatilho 'mudou de etapa'.
alter table public.automations add column pipeline_id uuid;
alter table public.automations add column stage_id uuid;
alter table public.automations add constraint automations_pipeline_id_org_id_fkey foreign key(pipeline_id,org_id) references public.pipelines(id,org_id) on delete set null (pipeline_id);
alter table public.automations add constraint automations_stage_id_pipeline_id_org_id_fkey foreign key(stage_id,pipeline_id,org_id) references public.pipeline_stages(id,pipeline_id,org_id) on delete set null (stage_id);
-- Sem o funil, a FK de três colunas não seria conferida (MATCH SIMPLE) e a etapa poderia ser de outro funil.
alter table public.automations add constraint automations_stage_needs_pipeline check(stage_id is null or pipeline_id is not null);
alter table public.automations add constraint automations_scope_only_deal_moved check(trigger_type='deal_moved' or (pipeline_id is null and stage_id is null));
create index automations_pipeline_id_org_id_fkey_idx on public.automations(pipeline_id,org_id);
create index automations_stage_id_pipeline_id_org_id_fkey_idx on public.automations(stage_id,pipeline_id,org_id);

-- Sem funil, sem etapa. Quando a exclusão do funil ou da etapa (ON DELETE SET NULL, dentro do gatilho da FK)
-- remove o filtro de uma automação ativa, ela é pausada para não passar a disparar em qualquer etapa.
-- Edições diretas (pg_trigger_depth() = 1) não pausam.
create function private.normalize_automation_scope() returns trigger language plpgsql set search_path='' as $$
 begin
 if tg_op='UPDATE' and new.pipeline_id is null and old.pipeline_id is not null then new.stage_id=null; end if;
 if tg_op='UPDATE' and pg_trigger_depth()>1 and new.is_active
  and ((old.pipeline_id is not null and new.pipeline_id is null) or (old.stage_id is not null and new.stage_id is null)) then
  new.is_active=false;
 end if;
 return new;
 end;
$$;
create trigger normalize_automation_scope before insert or update on public.automations for each row execute function private.normalize_automation_scope();
revoke execute on function private.normalize_automation_scope() from public,anon,authenticated;

-- Única reescrita do item: guarda de movimentação em massa, filtro de funil e etapa, snapshot do nome e erro real.
create or replace function private.run_deal_automations() returns trigger language plpgsql security definer set search_path='' as $$
 declare rule public.automations; v_trigger text; v_activity uuid;
 begin
 -- Reservado para movimentações em massa: a transação que liga crm.bulk_move (só local, set_config(...,true) ou
 -- SET LOCAL) não dispara automações.
 if coalesce(current_setting('crm.bulk_move',true),'')='on' then return new; end if;
 if tg_op='INSERT' then v_trigger='deal_created';
 elsif old.status is distinct from new.status and new.status='won' then v_trigger='deal_won';
 elsif old.stage_id is distinct from new.stage_id then v_trigger='deal_moved'; else return new; end if;
 -- O filtro só existe em 'deal_moved' (CHECK automations_scope_only_deal_moved): dispara ao entrar na etapa e no funil configurados.
 for rule in select a.* from public.automations a
  where a.org_id=new.org_id and a.is_active and a.trigger_type=v_trigger
   and (a.pipeline_id is null or a.pipeline_id=new.pipeline_id)
   and (a.stage_id is null or a.stage_id=new.stage_id)
  order by a.created_at,a.id loop
  begin
   insert into public.activities(org_id,type,title,deal_id,contact_id,company_id,user_id,due_date)
    values(new.org_id,'task',rule.task_title,new.id,new.contact_id,new.company_id,new.owner_id,now()+make_interval(days=>rule.due_days)) returning id into v_activity;
   insert into public.automation_logs(org_id,automation_id,automation_name,deal_id,activity_id,status)
    values(new.org_id,rule.id,rule.name,new.id,v_activity,'success');
  exception when others then
   insert into public.automation_logs(org_id,automation_id,automation_name,deal_id,status,error_message,error_detail)
    values(new.org_id,rule.id,rule.name,new.id,'failed','Não foi possível criar a tarefa. Revise os vínculos e o responsável.',sqlstate||': '||sqlerrm);
  end;
 end loop;
 return new;
 end;
$$;

-- Detalhe técnico das falhas, só para dono e administradores da organização.
create function private.automation_log_errors(p_automation_id uuid) returns table(id uuid,error_detail text) language plpgsql stable security definer set search_path='' as $$
 begin
 if not private.can_manage() then
  raise exception 'Somente administradores veem o detalhe técnico das falhas.' using errcode='insufficient_privilege';
 end if;
 return query select l.id,l.error_detail from public.automation_logs l
  where l.org_id=private.current_org() and l.automation_id=p_automation_id and l.error_detail is not null
  order by l.created_at desc,l.id;
 end;
$$;
create function public.automation_log_errors(p_automation_id uuid) returns table(id uuid,error_detail text) language sql stable security invoker set search_path='' as $$
 select e.id,e.error_detail from private.automation_log_errors(p_automation_id) e;
$$;

-- Exclusão de oportunidade com vínculos: sem confirmação, recusa e informa as contagens; com confirmação,
-- desvincula atividades e recebimentos, mantém os logs de automação (deal_id nulo, com o nome) e exclui.
create function public.delete_deal(p_deal_id uuid,p_confirm boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare v_org uuid; v_activities integer; v_payments integer; v_logs integer; v_links text[]; v_text text;
 begin
 if not private.can_manage() then
  raise exception 'Somente administradores podem excluir oportunidades.' using errcode='insufficient_privilege';
 end if;
 v_org=private.current_org();
 perform 1 from public.deals where id=p_deal_id and org_id=v_org for update;
 if not found then raise exception 'Oportunidade indisponível ou sem acesso.'; end if;
 select count(*) into v_activities from public.activities where deal_id=p_deal_id and org_id=v_org;
 select count(*) into v_payments from public.payments where deal_id=p_deal_id and org_id=v_org;
 select count(*) into v_logs from public.automation_logs where deal_id=p_deal_id and org_id=v_org;
 if not coalesce(p_confirm,false) and v_activities+v_payments+v_logs>0 then
  v_links=array_remove(array[
   case when v_activities=1 then '1 atividade' when v_activities>1 then v_activities||' atividades' end,
   case when v_payments=1 then '1 recebimento' when v_payments>1 then v_payments||' recebimentos' end,
   case when v_logs=1 then '1 registro de automação' when v_logs>1 then v_logs||' registros de automação' end
  ],null);
  v_text=case when cardinality(v_links)=1 then v_links[1]
   else array_to_string(v_links[1:cardinality(v_links)-1],', ')||' e '||v_links[cardinality(v_links)] end;
  raise exception 'Esta oportunidade tem vínculos: %. Confirme a exclusão para manter esses registros sem o vínculo.',v_text
   using detail=jsonb_build_object('activities',v_activities,'payments',v_payments,'automation_logs',v_logs)::text;
 end if;
 update public.activities set deal_id=null where deal_id=p_deal_id and org_id=v_org;
 update public.payments set deal_id=null where deal_id=p_deal_id and org_id=v_org;
 delete from public.deals where id=p_deal_id and org_id=v_org;
 if not found then raise exception 'Oportunidade indisponível ou sem acesso.'; end if;
 return jsonb_build_object('activities',v_activities,'payments',v_payments,'automation_logs',v_logs);
 end;
$$;

revoke execute on function private.automation_log_errors(uuid) from public,anon,authenticated;
grant execute on function private.automation_log_errors(uuid) to authenticated;
revoke execute on function public.automation_log_errors(uuid),public.delete_deal(uuid,boolean) from public,anon;
grant execute on function public.automation_log_errors(uuid),public.delete_deal(uuid,boolean) to authenticated;
