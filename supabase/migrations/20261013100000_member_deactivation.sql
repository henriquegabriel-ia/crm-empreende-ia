-- Item 1.2 do roteiro: desativar membro e transferir a carteira (decisão D9). Desenho: docs/arquitetura/1.2.md.
-- A desativação é um estado do papel (user_roles.deactivated_at), e não a remoção do membro: o perfil continua na
-- organização, com as FKs compostas e o histórico. private.current_org() passa a exigir papel ativo, e toda a RLS e
-- todas as RPCs passam por ela: a conta desativada perde a leitura e a escrita na consulta seguinte, mesmo com o token
-- do Auth ainda válido por até 1 hora. Nada muda no schema auth (sem ban, sem apagar sessões; seção 8 do desenho).
-- deactivate_member desativa e, na mesma transação, passa as oportunidades em aberto e as atividades pendentes da
-- pessoa a um destinatário ativo que edita (e os contatos e as empresas, se quem desativa escolher), revoga os convites
-- pendentes que ela criou e registra a passagem em portfolio_transfers; cada registro alterado passa pela auditoria.
-- Um gatilho recusa trabalho novo atribuído a quem está desativado.
-- Aditiva e sem reescrever tabela: uma coluna anulável, uma tabela nova, funções novas e substituídas (as mesmas
-- assinaturas), duas políticas trocadas e quatro gatilhos. Membros ativos não mudam; perfis com organização e sem
-- papel (órfãos, só possíveis por SQL) viram membros desativados, e os convites pendentes de quem hoje não poderia
-- criá-los são excluídos (backfill no fim).

-- 1. Situação do papel: nulo = ativo; preenchido = desativado em. O papel fica guardado: é o sugerido na reativação.
-- Coluna anulável e sem padrão: as linhas existentes ficam ativas, sem reescrever a tabela.
alter table public.user_roles add column deactivated_at timestamptz;
-- Mesma regra das demais datas (20260906051341_immutable_metadata.sql): só valores finitos.
alter table public.user_roles add constraint user_roles_deactivated_at_finite check(isfinite(deactivated_at));

-- 2. Quem concede qual papel, num lugar só (o 2A.2 acrescenta manager aqui). O dono mexe em tudo; o administrador
-- não mexe em dono nem concede o papel de Dono. Usada por set_member_role, create_invitation, deactivate_member,
-- reactivate_member e pela limpeza de convites (com o papel do autor do convite em p_actor_role).
create function private.role_change_allowed(p_actor_role text,p_from_role text,p_to_role text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_actor_role='owner'
  or (p_actor_role='admin' and coalesce(p_from_role,'')<>'owner' and coalesce(p_to_role,'')<>'owner'),false);
$$;

-- 3. Organização da sessão só com papel ativo. Toda política usa (select private.current_org()), avaliada uma vez por
-- consulta: uma busca pela chave de profiles e outra pela restrição única (user_id, org_id) de user_roles. can_write,
-- can_manage e is_owner comparam org_id com esta função e ficam falsos para quem está desativado. accept_invitation e
-- provision_organization gravam o perfil e depois o papel, sem gatilho que leia current_org entre os dois comandos.
create or replace function private.current_org() returns uuid language sql stable security definer set search_path='' as $$
 select p.org_id
  from public.profiles p
  join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id and r.deactivated_at is null
 where p.id=(select auth.uid());
$$;

-- 4. Quem foi desativado lê o próprio papel (com a data, para a tela "Seu acesso foi encerrado") e o próprio perfil
-- (profile_read não muda), e não grava nada, nem o próprio perfil. A conta sem organização (null e null) e o membro
-- ativo continuam editando o próprio perfil.
drop policy roles_read on public.user_roles;
create policy roles_read on public.user_roles for select to authenticated using(org_id=(select private.current_org()) or user_id=(select auth.uid()));
drop policy profile_update on public.profiles;
create policy profile_update on public.profiles for update to authenticated
 using(id=(select auth.uid()) and org_id is not distinct from (select private.current_org()))
 with check(id=(select auth.uid()) and org_id is not distinct from (select private.current_org()));

-- 5. Passagens de carteira: uma linha por desativação (inclusive sem nada a passar) e por "Passar carteira", com o que
-- mudou de fato. audit_logs guarda os nomes dos campos alterados, e não os valores: sem esta tabela, "para quem foi a
-- carteira de Fulano, e quanto era?" não teria resposta. Append-only: só as RPCs inserem, e nenhum papel da API grava.
-- FKs compostas sem ON DELETE, como audit_logs: perfis com histórico não são excluídos (anonimização no 2B.8).
create table public.portfolio_transfers(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id),
 from_user_id uuid not null,
 to_user_id uuid,
 performed_by uuid,
 deactivation boolean not null,
 accounts_transferred boolean not null,
 deals integer not null default 0 check(deals>=0),
 activities integer not null default 0 check(activities>=0),
 contacts integer not null default 0 check(contacts>=0),
 companies integer not null default 0 check(companies>=0),
 invitations integer not null default 0 check(invitations>=0),
 created_at timestamptz not null default now(),
 constraint portfolio_transfers_created_at_finite check(isfinite(created_at)),
 constraint portfolio_transfers_other_recipient check(to_user_id is distinct from from_user_id),
 constraint portfolio_transfers_recipient_when_moved check(to_user_id is not null or deals+activities+contacts+companies=0),
 foreign key(from_user_id,org_id) references public.profiles(id,org_id),
 foreign key(to_user_id,org_id) references public.profiles(id,org_id),
 foreign key(performed_by,org_id) references public.profiles(id,org_id)
);
-- O Supabase hospedado concede tudo por privilégio padrão (simulado em supabase/tests/local-bootstrap.sql): tira tudo
-- e devolve só a leitura, para donos e administradores da organização.
revoke all on public.portfolio_transfers from public,anon,authenticated;
alter table public.portfolio_transfers enable row level security;
grant select on public.portfolio_transfers to authenticated;
create policy portfolio_transfers_manager_read on public.portfolio_transfers for select to authenticated using(org_id=(select private.current_org()) and (select private.can_manage()));
-- A Equipe lê a última passagem de cada pessoa; e a regra da base de indexar toda FK.
create index portfolio_transfers_org_time on public.portfolio_transfers(org_id,created_at desc);
create index portfolio_transfers_from_user_id_org_id_fkey_idx on public.portfolio_transfers(from_user_id,org_id);
create index portfolio_transfers_to_user_id_org_id_fkey_idx on public.portfolio_transfers(to_user_id,org_id);
create index portfolio_transfers_performed_by_org_id_fkey_idx on public.portfolio_transfers(performed_by,org_id);

-- 6. Nenhum trabalho novo vai para quem está desativado: oportunidade em aberto, atividade pendente (não concluída e
-- que não é nota), contato ou empresa criados, atribuídos ou reabertos com um responsável desativado (ou sem papel na
-- organização) são recusados. Editar outros campos de um registro que já estava com um desativado, e corrigir o
-- responsável de uma oportunidade encerrada ou de uma atividade concluída, continuam valendo. Uma automação que tentaria
-- criar tarefa para um desativado cai no bloco de exceção de run_deal_automations, que registra a falha.
-- A trava FOR KEY SHARE no papel conflita com o FOR UPDATE que deactivate_member toma na mesma linha: se a atribuição
-- chega antes, a desativação espera o commit dela e a leva na transferência; se chega depois, espera a desativação
-- terminar, relê a linha já desativada (READ COMMITTED) e é recusada. SECURITY DEFINER porque a trava exige UPDATE
-- na tabela, que authenticated não tem em user_roles.
create function private.refuse_inactive_assignee() returns trigger language plpgsql security definer set search_path='' as $$
 declare v_assignee uuid; v_new_work boolean; v_reopened boolean:=false; v_active boolean;
 begin
 if tg_table_name='deals' then
  v_assignee:=new.owner_id;
  v_new_work:=new.status='open' and (tg_op='INSERT' or new.owner_id is distinct from old.owner_id or old.status<>'open');
  v_reopened:=tg_op='UPDATE' and old.status<>'open' and new.owner_id is not distinct from old.owner_id;
 elsif tg_table_name='activities' then
  v_assignee:=new.user_id;
  v_new_work:=new.completed_at is null and new.type<>'note'
   and (tg_op='INSERT' or new.user_id is distinct from old.user_id or old.completed_at is not null or old.type='note');
  v_reopened:=tg_op='UPDATE' and old.completed_at is not null and new.user_id is not distinct from old.user_id;
 else
  v_assignee:=new.owner_id;
  v_new_work:=tg_op='INSERT' or new.owner_id is distinct from old.owner_id;
 end if;
 if v_assignee is null or not v_new_work then return new; end if;
 select r.deactivated_at is null into v_active from public.user_roles r
  where r.user_id=v_assignee and r.org_id=new.org_id
  for key share;
 if coalesce(v_active,false) then return new; end if;
 raise exception '%',case
  when tg_table_name='deals' and v_reopened then 'O responsável desta oportunidade foi desativado. Para reabri-la, troque antes o “Responsável” em “Editar”.'
  when tg_table_name='deals' then 'O responsável escolhido foi desativado e não recebe oportunidades em aberto. Escolha outra pessoa em “Responsável”.'
  when tg_table_name='activities' and v_reopened then 'O responsável desta atividade foi desativado. Para reabri-la, troque antes o “Responsável” ao editar a atividade.'
  else 'A pessoa escolhida como responsável foi desativada. Escolha outra pessoa em “Responsável”.'
 end;
 end;
$$;
-- BEFORE, em ordem alfabética: depois de protect_record_metadata e record_activity_author, antes de touch_updated_at e
-- validate_deal_change; nenhum deles muda responsável, situação ou conclusão.
create trigger refuse_inactive_assignee before insert or update on public.deals for each row execute function private.refuse_inactive_assignee();
create trigger refuse_inactive_assignee before insert or update on public.activities for each row execute function private.refuse_inactive_assignee();
create trigger refuse_inactive_assignee before insert or update on public.contacts for each row execute function private.refuse_inactive_assignee();
create trigger refuse_inactive_assignee before insert or update on public.companies for each row execute function private.refuse_inactive_assignee();

-- 7. A carteira de uma pessoa, numa definição única (prévia, recusa sem destinatário, transferência e testes):
-- oportunidades em aberto, atividades pendentes (a mesma definição da fila de atenção), contatos e empresas (todas as
-- situações) e convites pendentes criados por ela. Recebimentos não têm responsável (seguem a oportunidade, o contato
-- ou a empresa), e automações não apontam para a pessoa além de created_by, que é histórico. Um responsável novo numa
-- tabela nova (2B.10) entra aqui, em move_member_portfolio e em refuse_inactive_assignee.
create function private.portfolio_counts(p_org uuid,p_user uuid) returns table(deals integer,activities integer,contacts integer,companies integer,invitations integer) language sql stable set search_path='' as $$
 select
  (select count(*)::integer from public.deals d where d.org_id=p_org and d.owner_id=p_user and d.status='open'),
  (select count(*)::integer from public.activities a where a.org_id=p_org and a.user_id=p_user and a.completed_at is null and a.type<>'note'),
  (select count(*)::integer from public.contacts c where c.org_id=p_org and c.owner_id=p_user),
  (select count(*)::integer from public.companies c where c.org_id=p_org and c.owner_id=p_user),
  (select count(*)::integer from public.invitations i where i.org_id=p_org and i.invited_by=p_user and i.accepted_at is null);
$$;

-- Destinatário informado: outra pessoa, ativa e com papel que edita. Somente leitura não concluiria as tarefas nem
-- moveria as oportunidades que recebe. A falta do destinatário é conferida em move_member_portfolio, com as contagens.
create function private.check_portfolio_recipient(p_org uuid,p_user uuid,p_recipient uuid) returns void language plpgsql stable set search_path='' as $$
 begin
 if p_recipient is null then return; end if;
 if p_recipient=p_user then raise exception 'Escolha outra pessoa para receber a carteira.'; end if;
 if not exists(select 1 from public.user_roles r where r.org_id=p_org and r.user_id=p_recipient and r.deactivated_at is null and r.role in ('owner','admin','member')) then
  raise exception 'Quem recebe a carteira precisa estar ativo na equipe e poder editar (dono, administrador ou colaborador).';
 end if;
 end;
$$;

-- Passagem da carteira, já dentro das travas de deactivate_member e transfer_portfolio. Sem destinatário e com algo a
-- passar, recusa com as contagens no texto e no detail (JSON), como delete_deal: a tela atualiza a confirmação. Os
-- UPDATEs passam pelos gatilhos de sempre: audit_record_change grava uma linha por registro, com o autor;
-- touch_updated_at renova a versão (o formulário aberto de um colega recebe o conflito do 0.8); record_deal_change e
-- run_deal_automations não disparam, porque etapa e situação não mudam; refuse_inactive_assignee confere o destinatário.
create function private.move_member_portfolio(p_org uuid,p_user uuid,p_recipient uuid,p_accounts boolean,p_deactivation boolean)
 returns table(deals integer,activities integer,contacts integer,companies integer,invitations integer) language plpgsql set search_path='' as $$
 #variable_conflict use_column
 declare v_counts record; v_name text; v_links text[];
  v_deals integer:=0; v_activities integer:=0; v_contacts integer:=0; v_companies integer:=0; v_invitations integer:=0;
 begin
 select * into v_counts from private.portfolio_counts(p_org,p_user);
 if p_recipient is null and (v_counts.deals+v_counts.activities>0 or (p_accounts and v_counts.contacts+v_counts.companies>0)) then
  select coalesce(nullif(trim(p.name),''),nullif(trim(p.email),''),'Esta pessoa') into v_name from public.profiles p where p.id=p_user;
  v_links=array_remove(array[
   case when v_counts.deals=1 then '1 oportunidade em aberto' when v_counts.deals>1 then v_counts.deals||' oportunidades em aberto' end,
   case when v_counts.activities=1 then '1 atividade pendente' when v_counts.activities>1 then v_counts.activities||' atividades pendentes' end,
   case when not p_accounts then null when v_counts.contacts=1 then '1 contato' when v_counts.contacts>1 then v_counts.contacts||' contatos' end,
   case when not p_accounts then null when v_counts.companies=1 then '1 empresa' when v_counts.companies>1 then v_counts.companies||' empresas' end
  ],null);
  raise exception '% tem %. Escolha quem recebe a carteira.',coalesce(v_name,'Esta pessoa'),
   case when cardinality(v_links)=1 then v_links[1]
    else array_to_string(v_links[1:cardinality(v_links)-1],', ')||' e '||v_links[cardinality(v_links)] end
   using detail=jsonb_build_object('deals',v_counts.deals,'activities',v_counts.activities,'contacts',v_counts.contacts,
    'companies',v_counts.companies,'invitations',v_counts.invitations)::text;
 end if;
 if p_recipient is not null then
  update public.deals d set owner_id=p_recipient where d.org_id=p_org and d.owner_id=p_user and d.status='open';
  get diagnostics v_deals=row_count;
  update public.activities a set user_id=p_recipient where a.org_id=p_org and a.user_id=p_user and a.completed_at is null and a.type<>'note';
  get diagnostics v_activities=row_count;
  if p_accounts then
   update public.contacts c set owner_id=p_recipient where c.org_id=p_org and c.owner_id=p_user;
   get diagnostics v_contacts=row_count;
   update public.companies c set owner_id=p_recipient where c.org_id=p_org and c.owner_id=p_user;
   get diagnostics v_companies=row_count;
  end if;
 end if;
 -- Convites pendentes (válidos ou expirados) seguem a autoridade de quem os criou; a auditoria registra a exclusão.
 delete from public.invitations i where i.org_id=p_org and i.invited_by=p_user and i.accepted_at is null;
 get diagnostics v_invitations=row_count;
 insert into public.portfolio_transfers(org_id,from_user_id,to_user_id,performed_by,deactivation,accounts_transferred,deals,activities,contacts,companies,invitations)
  values(p_org,p_user,case when v_deals+v_activities+v_contacts+v_companies>0 then p_recipient end,auth.uid(),p_deactivation,p_accounts,
   v_deals,v_activities,v_contacts,v_companies,v_invitations);
 return query select v_deals,v_activities,v_contacts,v_companies,v_invitations;
 end;
$$;

-- 8. RPCs da Equipe, no padrão da base: a pública SECURITY INVOKER chama a privada SECURITY DEFINER. As travas de
-- equipe passam a FOR NO KEY UPDATE na linha da organização: continuam serializando convites, papéis, desativações e
-- reativações entre si e deixam de bloquear as verificações de FK (FOR KEY SHARE) dos INSERTs dos colegas enquanto
-- uma carteira grande é passada.

-- Prévia da carteira para o diálogo de desativação, contada como a transferência conta (SECURITY DEFINER: vale
-- também quando a visibilidade por responsável do 2A.6 chegar).
create function private.member_portfolio(p_user_id uuid) returns table(deals integer,activities integer,contacts integer,companies integer,invitations integer) language plpgsql stable security definer set search_path='' as $$
 declare v_org uuid;
 begin
 v_org:=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores veem a carteira de outra pessoa.';
 end if;
 if not exists(select 1 from public.profiles p where p.id=p_user_id and p.org_id=v_org) then
  raise exception 'Pessoa indisponível nesta organização.';
 end if;
 return query select c.deals,c.activities,c.contacts,c.companies,c.invitations from private.portfolio_counts(v_org,p_user_id) c;
 end;
$$;
create function public.member_portfolio(p_user_id uuid) returns table(deals integer,activities integer,contacts integer,companies integer,invitations integer) language sql stable security invoker set search_path='' as $$
 select c.deals,c.activities,c.contacts,c.companies,c.invitations from private.member_portfolio(p_user_id) c;
$$;

-- Desativação com a passagem obrigatória (D9). Tudo numa transação: qualquer recusa ou falha desfaz a desativação, a
-- transferência, a revogação dos convites e o registro. Ordem das travas (seção 6 do desenho): a organização, as linhas
-- da carteira e, por último, o papel da pessoa; assim a gravação de um colega que segura uma oportunidade e espera o
-- papel termina antes, e o que ela atribuiu entra na transferência. As linhas da carteira levam FOR NO KEY UPDATE, a
-- mesma trava que o UPDATE da passagem toma (responsável não é chave): esperam quem altera a linha, mas não bloqueiam a
-- verificação de FK (FOR KEY SHARE) de quem só aponta para ela, como uma ligação num contato da pessoa ou uma tarefa na
-- oportunidade dela. Com FOR UPDATE, essas gravações esperariam a passagem inteira, e a tarefa atribuída à pessoa na
-- oportunidade dela, com o papel já travado pelo gatilho, fecharia um impasse. O papel, sim, leva FOR UPDATE, que
-- conflita com o FOR KEY SHARE do gatilho de atribuição. A verificação do último dono é redundante com "ninguém
-- desativa o próprio acesso" e "só um dono desativa dono", mas fica como invariante explícita.
create function private.deactivate_member(p_user_id uuid,p_transfer_accounts boolean,p_recipient_id uuid default null)
 returns table(deals integer,activities integer,contacts integer,companies integer,invitations integer) language plpgsql security definer set search_path='' as $$
 declare v_org uuid; v_actor text; v_target text; v_since timestamptz;
 begin
 v_org:=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores podem desativar pessoas.';
 end if;
 perform 1 from public.organizations o where o.id=v_org for no key update;
 select r.role into v_actor from public.user_roles r where r.org_id=v_org and r.user_id=auth.uid() and r.deactivated_at is null;
 if v_actor is null or v_actor not in ('owner','admin') then raise exception 'Sua permissão foi alterada. Atualize a página.'; end if;
 if p_user_id=auth.uid() then
  raise exception 'Você não pode desativar o seu próprio acesso. Peça a outro dono ou administrador.';
 end if;
 select r.role,r.deactivated_at into v_target,v_since from public.user_roles r where r.org_id=v_org and r.user_id=p_user_id;
 if not found then raise exception 'Pessoa indisponível nesta organização.'; end if;
 if v_since is not null then raise exception 'Esta pessoa já está desativada.'; end if;
 if not private.role_change_allowed(v_actor,v_target,v_target) then raise exception 'Somente um dono pode desativar outro dono.'; end if;
 if v_target='owner' and (select count(*) from public.user_roles r where r.org_id=v_org and r.role='owner' and r.deactivated_at is null)<=1 then
  raise exception 'Mantenha pelo menos um dono ativo na organização.';
 end if;
 if p_transfer_accounts is null then raise exception 'Informe se os contatos e as empresas também passam.'; end if;
 perform private.check_portfolio_recipient(v_org,p_user_id,p_recipient_id);
 perform 1 from public.deals d where d.org_id=v_org and d.owner_id=p_user_id and d.status='open' for no key update;
 perform 1 from public.activities a where a.org_id=v_org and a.user_id=p_user_id and a.completed_at is null and a.type<>'note' for no key update;
 if p_transfer_accounts then
  perform 1 from public.contacts c where c.org_id=v_org and c.owner_id=p_user_id for no key update;
  perform 1 from public.companies c where c.org_id=v_org and c.owner_id=p_user_id for no key update;
 end if;
 perform 1 from public.user_roles r where r.org_id=v_org and r.user_id=p_user_id for update;
 update public.user_roles r set deactivated_at=now() where r.org_id=v_org and r.user_id=p_user_id;
 return query select m.deals,m.activities,m.contacts,m.companies,m.invitations
  from private.move_member_portfolio(v_org,p_user_id,p_recipient_id,p_transfer_accounts,true) m;
 end;
$$;
-- statement_timeout de 60 s só nas RPCs de transferência: o PostgREST aplica o tempo-limite declarado na função chamada,
-- e o padrão de authenticated é 8 s. Acima do limite, a RPC falha inteira, sem mudar nada.
create function public.deactivate_member(p_user_id uuid,p_transfer_accounts boolean,p_recipient_id uuid default null)
 returns table(deals integer,activities integer,contacts integer,companies integer,invitations integer) language sql security invoker set search_path='' set statement_timeout='60s' as $$
 select m.deals,m.activities,m.contacts,m.companies,m.invitations from private.deactivate_member(p_user_id,p_transfer_accounts,p_recipient_id) m;
$$;

-- "Passar carteira": o que ficou com uma pessoa já desativada (contatos e empresas mantidos na desativação, perfis
-- órfãos da migração). Qualquer gestor, inclusive na carteira de um dono desativado: é reatribuição de dados, que o
-- administrador já faz registro por registro. Passar a carteira de quem está ativo é das ações em massa (2A.8).
create function private.transfer_portfolio(p_user_id uuid,p_transfer_accounts boolean,p_recipient_id uuid)
 returns table(deals integer,activities integer,contacts integer,companies integer,invitations integer) language plpgsql security definer set search_path='' as $$
 declare v_org uuid; v_actor text; v_since timestamptz; v_has_role boolean; v_counts record;
 begin
 v_org:=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores podem passar a carteira de outra pessoa.';
 end if;
 perform 1 from public.organizations o where o.id=v_org for no key update;
 select r.role into v_actor from public.user_roles r where r.org_id=v_org and r.user_id=auth.uid() and r.deactivated_at is null;
 if v_actor is null or v_actor not in ('owner','admin') then raise exception 'Sua permissão foi alterada. Atualize a página.'; end if;
 -- Perfil da organização sem papel (gravado por SQL depois da migração) conta como desativado.
 select r.deactivated_at,r.user_id is not null into v_since,v_has_role from public.profiles p
  left join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id
  where p.id=p_user_id and p.org_id=v_org;
 if not found then raise exception 'Pessoa indisponível nesta organização.'; end if;
 if v_has_role and v_since is null then raise exception 'Esta pessoa está ativa. Para passar a carteira dela, use “Desativar”.'; end if;
 if p_transfer_accounts is null then raise exception 'Informe se os contatos e as empresas também passam.'; end if;
 select * into v_counts from private.portfolio_counts(v_org,p_user_id);
 if (v_counts.deals+v_counts.activities+(case when p_transfer_accounts then v_counts.contacts+v_counts.companies else 0 end))=0 then
  raise exception 'Esta pessoa não tem mais carteira para passar.';
 end if;
 perform private.check_portfolio_recipient(v_org,p_user_id,p_recipient_id);
 perform 1 from public.deals d where d.org_id=v_org and d.owner_id=p_user_id and d.status='open' for no key update;
 perform 1 from public.activities a where a.org_id=v_org and a.user_id=p_user_id and a.completed_at is null and a.type<>'note' for no key update;
 if p_transfer_accounts then
  perform 1 from public.contacts c where c.org_id=v_org and c.owner_id=p_user_id for no key update;
  perform 1 from public.companies c where c.org_id=v_org and c.owner_id=p_user_id for no key update;
 end if;
 perform 1 from public.user_roles r where r.org_id=v_org and r.user_id=p_user_id for update;
 return query select m.deals,m.activities,m.contacts,m.companies,m.invitations
  from private.move_member_portfolio(v_org,p_user_id,p_recipient_id,p_transfer_accounts,false) m;
 end;
$$;
create function public.transfer_portfolio(p_user_id uuid,p_transfer_accounts boolean,p_recipient_id uuid)
 returns table(deals integer,activities integer,contacts integer,companies integer,invitations integer) language sql security invoker set search_path='' set statement_timeout='60s' as $$
 select m.deals,m.activities,m.contacts,m.companies,m.invitations from private.transfer_portfolio(p_user_id,p_transfer_accounts,p_recipient_id) m;
$$;

-- Reativação com o papel escolhido e as regras de set_member_role. A carteira passada não volta.
create function private.reactivate_member(p_user_id uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
 declare v_org uuid; v_actor text; v_previous text; v_since timestamptz; v_has_role boolean;
 begin
 v_org:=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores podem reativar pessoas.';
 end if;
 if p_role is null or p_role not in ('owner','admin','member','viewer') then raise exception 'Papel inválido.'; end if;
 perform 1 from public.organizations o where o.id=v_org for no key update;
 select r.role into v_actor from public.user_roles r where r.org_id=v_org and r.user_id=auth.uid() and r.deactivated_at is null;
 if v_actor is null or v_actor not in ('owner','admin') then raise exception 'Sua permissão foi alterada. Atualize a página.'; end if;
 select r.role,r.deactivated_at,r.user_id is not null into v_previous,v_since,v_has_role from public.profiles p
  left join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id
  where p.id=p_user_id and p.org_id=v_org
  for update of p;
 if not found then raise exception 'Pessoa indisponível nesta organização.'; end if;
 if v_has_role and v_since is null then raise exception 'Esta pessoa já está ativa.'; end if;
 if not private.role_change_allowed(v_actor,v_previous,p_role) then
  raise exception 'Somente um dono pode reativar um dono ou dar o papel de Dono.';
 end if;
 if v_has_role then
  update public.user_roles r set deactivated_at=null,role=p_role where r.org_id=v_org and r.user_id=p_user_id;
 else
  insert into public.user_roles(user_id,org_id,role) values(p_user_id,v_org,p_role);
 end if;
 end;
$$;
create function public.reactivate_member(p_user_id uuid,p_role text) returns void language sql security invoker set search_path='' as $$
 select private.reactivate_member(p_user_id,p_role);
$$;

-- 9. Funções substituídas, com as mesmas assinaturas (create or replace mantém os grants).

-- Papéis: só donos ativos contam para o último dono, a pessoa desativada é recusada (volta por "Reativar"), a regra de
-- papel vem de role_change_allowed e os convites pendentes que o novo papel não poderia criar são excluídos (de dono ou
-- administrador para colaborador ou somente leitura: todos; de dono para administrador: os de dono).
create or replace function private.set_member_role(p_user_id uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
 declare v_org uuid; v_current text; v_since timestamptz; v_actor text;
 begin
 v_org=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores podem alterar papéis.';
 end if;
 if p_role is null or p_role not in ('owner','admin','member','viewer') then raise exception 'Papel inválido.'; end if;
 perform 1 from public.organizations where id=v_org for no key update;
 select role into v_actor from public.user_roles where org_id=v_org and user_id=auth.uid() and deactivated_at is null;
 if v_actor is null or v_actor not in ('owner','admin') then raise exception 'Sua permissão foi alterada. Atualize a página.'; end if;
 select role,deactivated_at into v_current,v_since from public.user_roles where org_id=v_org and user_id=p_user_id for update;
 if not found then raise exception 'Pessoa indisponível nesta organização.'; end if;
 if v_since is not null then raise exception 'Esta pessoa está desativada. Use “Reativar” para devolver o acesso.'; end if;
 if not private.role_change_allowed(v_actor,v_current,p_role) then raise exception 'Somente um dono pode alterar este papel.'; end if;
 if v_current='owner' and p_role<>'owner'
  and (select count(*) from public.user_roles where org_id=v_org and role='owner' and deactivated_at is null)<=1 then
  raise exception 'Mantenha pelo menos um dono ativo na organização.';
 end if;
 update public.user_roles set role=p_role where org_id=v_org and user_id=p_user_id;
 delete from public.invitations i where i.org_id=v_org and i.invited_by=p_user_id and i.accepted_at is null
  and not private.role_change_allowed(p_role,null,i.role);
 end;
$$;

-- Convites: as mesmas recusas de 20261012100000_single_company_admission.sql, com três mudanças. A trava passa a FOR NO
-- KEY UPDATE e a regra de papel vem de role_change_allowed. Quem já é da equipe se divide entre ativo ("já faz parte")
-- e desativado (orientação para reativar). E o administrador que esbarra num convite válido de dono, que ele não vê
-- nem revoga (política invitations_manager_read), recebe a orientação de pedir a um dono.
create or replace function private.create_invitation(p_email text,p_role text) returns uuid language plpgsql security definer set search_path='' as $$
 declare v_org uuid; v_actor text; v_email text:=lower(trim(coalesce(p_email,''))); v_id uuid; v_active boolean;
 begin
 v_org=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores podem convidar pessoas.';
 end if;
 perform 1 from public.organizations where id=v_org for no key update;
 select role into v_actor from public.user_roles where org_id=v_org and user_id=auth.uid() and deactivated_at is null;
 if v_actor is null or v_actor not in ('owner','admin') then raise exception 'Somente donos e administradores podem convidar pessoas.'; end if;
 if p_role is null or p_role not in ('owner','admin','member','viewer') then raise exception 'Papel inválido.'; end if;
 if not private.role_change_allowed(v_actor,null,p_role) then raise exception 'Somente um dono pode convidar outro dono.'; end if;
 if length(v_email)>254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe um e-mail válido.'; end if;
 -- auth.users.email é sempre o atual; profiles.email é só a cópia do cadastro.
 select bool_or(r.deactivated_at is null) into v_active from public.user_roles r join auth.users u on u.id=r.user_id
  where r.org_id=v_org and lower(trim(u.email))=v_email;
 if v_active then raise exception 'Esta pessoa já faz parte da equipe.'; end if;
 if not v_active then raise exception 'Esta pessoa está desativada. Para devolver o acesso, use “Reativar” em “Equipe”.'; end if;
 if v_actor<>'owner' and exists(select 1 from public.invitations where org_id=v_org and lower(trim(email))=v_email and accepted_at is null and expires_at>now() and role='owner') then
  raise exception 'Já existe um convite de dono válido para este e-mail. Só um dono pode copiar o link ou revogar esse convite.';
 end if;
 if exists(select 1 from public.invitations where org_id=v_org and lower(trim(email))=v_email and accepted_at is null and expires_at>now()) then
  raise exception 'Já existe um convite válido para este e-mail. Copie o link na lista de convites ou revogue-o antes de criar outro.';
 end if;
 delete from public.invitations where org_id=v_org and lower(trim(email))=v_email and accepted_at is null and expires_at<=now();
 begin
  insert into public.invitations(org_id,email,role) values(v_org,v_email,p_role) returning id into v_id;
 exception when unique_violation then
  raise exception 'Já existe um convite válido para este e-mail. Copie o link na lista de convites ou revogue-o antes de criar outro.';
 end;
 return v_id;
 end;
$$;

-- Break-glass (docs/RECUPERAR-ACESSO-DONO.md): também reativa a conta desativada da empresa, com o papel de Dono, e
-- diz que reativou. A trava passa a FOR NO KEY UPDATE. O resto é igual a 20261012100000_single_company_admission.sql.
create or replace function private.restore_owner(p_email text,p_org_id uuid default null) returns text language plpgsql set search_path='' as $$
 declare v_email text:=lower(trim(coalesce(p_email,''))); v_user uuid; v_user_email text; v_confirmed timestamptz;
  v_accounts integer; v_profile_org uuid; v_org uuid:=p_org_id; v_count integer; v_invitation uuid; v_since timestamptz;
 begin
 if v_email='' then raise exception 'Informe o e-mail da conta que deve ficar com o papel de Dono.'; end if;
 if p_org_id is not null and not exists(select 1 from public.organizations where id=p_org_id) then
  raise exception 'A organização % não existe neste CRM.',p_org_id;
 end if;
 select count(*) into v_accounts from auth.users where lower(trim(email))=v_email;
 if v_accounts>1 then raise exception 'Há % contas com o e-mail %. Resolva a duplicidade em Authentication → Users.',v_accounts,v_email; end if;
 select id,email,email_confirmed_at into v_user,v_user_email,v_confirmed from auth.users where lower(trim(email))=v_email;
 -- Como no aceite e na criação da empresa, só conta com e-mail confirmado. Enquanto a instância não tem empresa,
 -- qualquer pessoa cria conta para qualquer e-mail, com a senha que quiser, e o Auth não troca essa senha num novo
 -- cadastro: promovida, a conta daria o acesso de Dono a essa senha assim que o dono real a confirmasse.
 if v_user is not null and v_confirmed is null then
  raise exception 'A conta % ainda não confirmou o e-mail, e o papel de Dono só vai para conta confirmada. Exclua-a em Authentication → Users e rode o comando de novo.',v_user_email;
 end if;
 if v_user is not null then
  select org_id into v_profile_org from public.profiles where id=v_user for update;
  if not found then raise exception 'A conta % não tem perfil no CRM.',v_user_email; end if;
  if v_profile_org is not null then
   if p_org_id is not null and p_org_id<>v_profile_org then
    raise exception 'A conta % pertence a outra organização deste CRM (%), e não a %.',v_user_email,v_profile_org,p_org_id;
   end if;
   perform 1 from public.organizations where id=v_profile_org for no key update;
   select deactivated_at into v_since from public.user_roles where user_id=v_user and org_id=v_profile_org for update;
   update public.user_roles set role='owner',deactivated_at=null where user_id=v_user and org_id=v_profile_org;
   if not found then insert into public.user_roles(user_id,org_id,role) values(v_user,v_profile_org,'owner'); end if;
   if v_since is not null then return format('A conta %s foi reativada com o papel de Dono.',v_user_email); end if;
   return format('A conta %s agora tem o papel de Dono.',v_user_email);
  end if;
 end if;
 -- Conta sem organização, ou sem conta: a empresa vem de p_org_id ou é a única da instância.
 if v_org is null then
  select count(*) into v_count from public.organizations;
  if v_count=0 and v_user is not null then
   raise exception 'Este CRM ainda não tem empresa. Entre com esta conta e use “Criar empresa”.';
  elsif v_count=0 then
   raise exception 'Este CRM ainda não tem empresa. Cadastre-se com este e-mail na tela de entrada e use “Criar empresa”.';
  elsif v_count>1 then
   raise exception 'Este CRM tem % organizações. Informe qual em p_org_id.',v_count;
  end if;
  select id into v_org from public.organizations;
 end if;
 perform 1 from public.organizations where id=v_org for no key update;
 if v_user is not null then
  update public.profiles set org_id=v_org where id=v_user;
  insert into public.user_roles(user_id,org_id,role) values(v_user,v_org,'owner');
  return format('A conta %s entrou na empresa com o papel de Dono.',v_user_email);
 end if;
 delete from public.invitations where org_id=v_org and lower(trim(email))=v_email and accepted_at is null;
 insert into public.invitations(org_id,email,role) values(v_org,v_email,'owner') returning id into v_invitation;
 return format('Não há conta com este e-mail. Convite de dono criado: abra <endereço do CRM>/?invite=%s, cadastre-se com este e-mail e confirme-o.',v_invitation);
 end;
$$;

-- 10. Backfill, com os gatilhos ligados: a auditoria registra as duas mudanças sem autor, o rastro de que vieram da
-- migração. Nenhuma oportunidade, atividade, contato ou empresa muda de responsável.
-- Perfis com organização e sem papel (só nascem por SQL) liam tudo pela current_org antiga, sem papel nenhum: viram
-- membros desativados, com Somente leitura sugerido na reativação. A carteira deles aparece na fila "Sem responsável"
-- e vai por "Passar carteira".
insert into public.user_roles(user_id,org_id,role,deactivated_at)
 select p.id,p.org_id,'viewer',now() from public.profiles p
 where p.org_id is not null and not exists(select 1 from public.user_roles r where r.user_id=p.id and r.org_id=p.org_id);
-- Convites pendentes de quem hoje não poderia criá-los (rebaixado antes do item, órfão, administrador com convite de
-- dono). Os do editor SQL (sem autor, como o de restore_owner) ficam.
delete from public.invitations i
 where i.accepted_at is null and i.invited_by is not null
  and not exists(select 1 from public.user_roles r where r.user_id=i.invited_by and r.org_id=i.org_id and r.deactivated_at is null
   and private.role_change_allowed(r.role,null,i.role));

-- 11. Execução: as RPCs para authenticated (nunca anon); as internas para nenhum papel da API, só para as funções
-- SECURITY DEFINER do dono do banco que as chamam.
revoke execute on function private.role_change_allowed(text,text,text),private.refuse_inactive_assignee(),private.portfolio_counts(uuid,uuid),
 private.check_portfolio_recipient(uuid,uuid,uuid),private.move_member_portfolio(uuid,uuid,uuid,boolean,boolean) from public,anon,authenticated,service_role;
revoke execute on function private.member_portfolio(uuid),private.deactivate_member(uuid,boolean,uuid),private.transfer_portfolio(uuid,boolean,uuid),
 private.reactivate_member(uuid,text),public.member_portfolio(uuid),public.deactivate_member(uuid,boolean,uuid),public.transfer_portfolio(uuid,boolean,uuid),
 public.reactivate_member(uuid,text) from public,anon;
grant execute on function private.member_portfolio(uuid),private.deactivate_member(uuid,boolean,uuid),private.transfer_portfolio(uuid,boolean,uuid),
 private.reactivate_member(uuid,text),public.member_portfolio(uuid),public.deactivate_member(uuid,boolean,uuid),public.transfer_portfolio(uuid,boolean,uuid),
 public.reactivate_member(uuid,text) to authenticated;
