-- Item 1.1 do roteiro: empresa única com entrada só por convite (decisão D6). Desenho: docs/arquitetura/1.1.md.
-- Enquanto a instância não tem empresa, o primeiro cadastro cria a empresa e fica com o papel de Dono; depois disso,
-- create_workspace recusa sempre, e uma conta nova só nasce para um e-mail com convite pendente e válido (gatilho em
-- auth.users). Convites passam a nascer só pela RPC create_invitation e só gestores os leem. A RLS por organização das
-- demais tabelas não muda: é a defesa em profundidade que o roteiro manda manter.
-- Nada é reescrito: funções, um CHECK mais amplo, grants, políticas e um gatilho. A instância com uma organização e
-- um dono continua igual, e os convites antigos válidos continuam aceitos (as comparações usam lower(trim(email))).

-- Provisionamento da empresa: o corpo antigo de create_workspace depois das guardas, sem a regra da empresa única.
-- SECURITY INVOKER e sem acesso pela API: só roda dentro de create_workspace (SECURITY DEFINER, dono postgres) ou pelo
-- dono do banco, como nos testes e no seed de demonstração (1.15).
create function private.provision_organization(p_user_id uuid,p_name text) returns uuid language plpgsql set search_path='' as $$
 declare v_name text:=trim(coalesce(p_name,'')); v_current uuid; v_org uuid; v_pipeline uuid;
 begin
 if length(v_name) not between 2 and 160 then raise exception 'Use um nome de empresa com 2 a 160 caracteres.'; end if;
 select org_id into v_current from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Perfil não encontrado.'; end if;
 if v_current is not null then raise exception 'Sua conta já pertence a uma organização.'; end if;
 insert into public.organizations(name) values(v_name) returning id into v_org;
 update public.profiles set org_id=v_org where id=p_user_id;
 insert into public.user_roles(user_id,org_id,role) values(p_user_id,v_org,'owner');
 insert into public.pipelines(org_id,name,is_default) values(v_org,'Comercial',true) returning id into v_pipeline;
 insert into public.pipeline_stages(org_id,pipeline_id,name,"order",win_probability) values
 (v_org,v_pipeline,'Novo contato',0,10),(v_org,v_pipeline,'Qualificação',1,25),(v_org,v_pipeline,'Proposta',2,60),(v_org,v_pipeline,'Negociação',3,80);
 insert into public.risk_rules(org_id,name,type,priority) values
 (v_org,'Atividades vencidas','overdue',1),(v_org,'Sem responsável','no_owner',2),(v_org,'Sem próxima ação','no_next_action',2),(v_org,'Oportunidades paradas','stale_deal',3);
 return v_org;
 end;
$$;

-- Primeiro dono (D6). A assinatura e a RPC pública não mudam. O e-mail confirmado evita que um endereço digitado
-- errado (ou de outra pessoa) vire dono; com a confirmação desligada no Auth, o próprio Supabase preenche
-- email_confirmed_at no cadastro. O lock consultivo vale até o commit e serializa dois primeiros cadastros
-- simultâneos: em READ COMMITTED, o exists seguinte roda com um snapshot novo e enxerga a empresa que o primeiro
-- pedido acabou de gravar. A chave hashtextextended('crm.instance.first_company',0) é fixa; outras rotinas que
-- precisarem da mesma exclusão usam a mesma chave.
create or replace function private.create_workspace(p_name text) returns uuid language plpgsql security definer set search_path='' as $$
 declare v_confirmed timestamptz;
 begin
 if auth.uid() is null then raise exception 'Entre na sua conta para continuar.'; end if;
 select email_confirmed_at into v_confirmed from auth.users where id=auth.uid();
 if v_confirmed is null then raise exception 'Confirme seu e-mail antes de criar a empresa.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('crm.instance.first_company',0));
 perform 1 from public.profiles where id=auth.uid() for update;
 if private.current_org() is not null then raise exception 'Sua conta já pertence a uma organização.'; end if;
 if exists(select 1 from public.organizations) then
  raise exception 'Este CRM já tem uma empresa. Para entrar, peça um convite a quem administra.';
 end if;
 return private.provision_organization(auth.uid(),p_name);
 end;
$$;

-- Tela de entrada: só se a instância já tem empresa. Nada além do booleano (nem nome, nem contagem, nem versão).
-- A pública é SECURITY INVOKER e chama a privada, como o resto da base; por isso anon passa a ter USAGE no schema
-- private. O test:db confere que instance_status é a única função de private que anon executa.
create function private.instance_status() returns table(has_organization boolean) language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organizations);
$$;
create function public.instance_status() returns table(has_organization boolean) language sql stable security invoker set search_path='' as $$
 select s.has_organization from private.instance_status() s;
$$;
grant usage on schema private to anon;

-- Portão de cadastro. Sem empresa, qualquer cadastro passa (o primeiro cria a empresa); com empresa, só o e-mail com
-- convite pendente e não expirado, sem diferenciar maiúsculas nem espaços nas pontas. E-mail nulo (conta anônima ou
-- por telefone) é recusado. Um gatilho, e não o hook "Before User Created": vem na migração (sem passo manual no
-- painel), cobre também as contas criadas pelo painel e pela API de administração e é testado no test:db.
-- O Auth devolve ao cliente um erro genérico ("Database error saving new user"); a mensagem e a dica abaixo ficam
-- nos logs, e a tela traduz a recusa lendo instance_status.
create function private.signup_allowed(p_email text) returns boolean language sql stable set search_path='' as $$
 select not exists(select 1 from public.organizations)
  or (nullif(trim(p_email),'') is not null and exists(select 1 from public.invitations i
   where lower(trim(i.email))=lower(trim(p_email)) and i.accepted_at is null and i.expires_at>now()));
$$;
-- SECURITY DEFINER: o Auth insere como supabase_auth_admin, que não lê public (o mesmo motivo de handle_new_user).
create function private.enforce_invite_only_signup() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 if not private.signup_allowed(new.email) then
  raise exception 'Cadastro recusado: este CRM aceita novas contas só por convite.'
   using hint='Crie o convite em Equipe e peça para a pessoa se cadastrar pelo link do convite.';
 end if;
 return new;
 end;
$$;
-- BEFORE: a conta nem é gravada, e on_auth_user_created (AFTER, que cria o perfil) não roda.
create trigger enforce_invite_only_signup before insert on auth.users for each row execute function private.enforce_invite_only_signup();

-- Papel de dono na organização atual, no molde de can_manage, para as políticas de convites.
create function private.is_owner() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles where user_id=(select auth.uid()) and org_id=private.current_org() and role='owner');
$$;

-- Convites. O papel Dono passa a existir (só um dono o concede, em create_invitation). O índice invitations_pending
-- continua igual: um índice parcial não pode usar now(), então a RPC apaga o pendente expirado antes de criar o novo,
-- e o índice segue como barreira final contra corrida. Sem INSERT direto (o REVOKE de tabela também revoga o GRANT
-- por coluna de 20260906051341_immutable_metadata.sql) e leitura só para donos e administradores: os demais papéis
-- não precisam de nenhuma linha. O convite de dono, só um dono lê e revoga: com o e-mail dele, um administrador
-- poderia criar antes a conta do convidado, com uma senha própria, e entrar como dono depois do aceite (a tela de aceite
-- pede a senha da conta justamente por isso; esconder o convite tira do administrador o e-mail e o link).
alter table public.invitations drop constraint invitations_role_check;
alter table public.invitations add constraint invitations_role_check check(role in ('owner','admin','member','viewer'));
revoke insert on public.invitations from authenticated;
drop policy tenant_read on public.invitations;
drop policy tenant_insert on public.invitations;
drop policy tenant_delete on public.invitations;
create policy invitations_manager_read on public.invitations for select to authenticated using(org_id=(select private.current_org()) and (select private.can_manage()) and (role<>'owner' or (select private.is_owner())));
create policy invitations_manager_delete on public.invitations for delete to authenticated using(org_id=(select private.current_org()) and (select private.can_manage()) and (role<>'owner' or (select private.is_owner())));

-- Criação de convite, com mensagens em pt-BR que a Equipe mostra. Trava a organização, como set_member_role:
-- serializa convites e mudanças de papel. O convite expirado é apagado e recriado com ID novo (a auditoria registra
-- a exclusão), e não renovado no lugar: renovar reativaria um link antigo que pode ter circulado. invited_by vem de
-- protect_record_metadata e a validade padrão é de 7 dias.
create function private.create_invitation(p_email text,p_role text) returns uuid language plpgsql security definer set search_path='' as $$
 declare v_org uuid; v_actor text; v_email text:=lower(trim(coalesce(p_email,''))); v_id uuid;
 begin
 v_org=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores podem convidar pessoas.';
 end if;
 perform 1 from public.organizations where id=v_org for update;
 select role into v_actor from public.user_roles where org_id=v_org and user_id=auth.uid();
 if v_actor is null or v_actor not in ('owner','admin') then raise exception 'Somente donos e administradores podem convidar pessoas.'; end if;
 if p_role is null or p_role not in ('owner','admin','member','viewer') then raise exception 'Papel inválido.'; end if;
 if p_role='owner' and v_actor<>'owner' then raise exception 'Somente um dono pode convidar outro dono.'; end if;
 if length(v_email)>254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe um e-mail válido.'; end if;
 -- auth.users.email é sempre o atual; profiles.email é só a cópia do cadastro.
 if exists(select 1 from public.user_roles r join auth.users u on u.id=r.user_id where r.org_id=v_org and lower(trim(u.email))=v_email) then
  raise exception 'Esta pessoa já faz parte da equipe.';
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
create function public.create_invitation(p_email text,p_role text) returns uuid language sql security invoker set search_path='' as $$ select private.create_invitation(p_email,p_role); $$;

-- Aceite: as mesmas travas, agora com o motivo de cada recusa, e o convite de dono. A ordem faz quem usa outra conta
-- só descobrir que o convite não é dela, sem saber se ele já foi usado ou expirou.
create or replace function private.accept_invitation(p_invitation_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare invitation public.invitations; v_email text; v_confirmed timestamptz; v_org uuid;
 begin
 if auth.uid() is null then raise exception 'Entre na sua conta para aceitar.'; end if;
 select email,email_confirmed_at into v_email,v_confirmed from auth.users where id=auth.uid();
 if v_confirmed is null then raise exception 'Confirme seu e-mail antes de aceitar o convite.'; end if;
 select org_id into v_org from public.profiles where id=auth.uid() for update;
 if v_org is not null then raise exception 'Sua conta já pertence a uma organização.'; end if;
 select * into invitation from public.invitations where id=p_invitation_id for update;
 if not found then
  raise exception 'Convite não encontrado. Ele pode ter sido revogado ou trocado por um novo; peça o link atualizado a quem administra.';
 end if;
 if lower(trim(invitation.email)) is distinct from lower(trim(v_email)) then
  raise exception 'Este convite é para outro e-mail. Entre com a conta do e-mail convidado.';
 end if;
 if invitation.accepted_at is not null then raise exception 'Este convite já foi usado.'; end if;
 if invitation.expires_at<=now() then raise exception 'Este convite expirou. Peça um novo a quem administra.'; end if;
 update public.profiles set org_id=invitation.org_id where id=auth.uid();
 insert into public.user_roles(user_id,org_id,role) values(auth.uid(),invitation.org_id,invitation.role);
 update public.invitations set accepted_at=now() where id=invitation.id;
 return invitation.org_id;
 end;
$$;

-- Break-glass (docs/RECUPERAR-ACESSO-DONO.md): devolve o papel de Dono pelo editor SQL do painel, onde o papel é
-- postgres (dono das tabelas, sem RLS). Nenhum papel da API a executa. A auditoria registra a alteração sem autor
-- (auth.uid() é nulo no editor), o rastro de que veio do painel. Ser uma função, e não um bloco SQL colado do guia,
-- faz o procedimento ser testado no test:db e acompanhar o schema.
create function private.restore_owner(p_email text,p_org_id uuid default null) returns text language plpgsql set search_path='' as $$
 declare v_email text:=lower(trim(coalesce(p_email,''))); v_user uuid; v_user_email text; v_confirmed timestamptz;
  v_accounts integer; v_profile_org uuid; v_org uuid:=p_org_id; v_count integer; v_invitation uuid;
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
   perform 1 from public.organizations where id=v_profile_org for update;
   update public.user_roles set role='owner' where user_id=v_user and org_id=v_profile_org;
   if not found then insert into public.user_roles(user_id,org_id,role) values(v_user,v_profile_org,'owner'); end if;
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
 perform 1 from public.organizations where id=v_org for update;
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

revoke execute on function private.provision_organization(uuid,text),private.signup_allowed(text),private.enforce_invite_only_signup(),private.restore_owner(text,uuid) from public,anon,authenticated,service_role;
revoke execute on function private.instance_status(),public.instance_status() from public;
grant execute on function private.instance_status(),public.instance_status() to anon,authenticated;
revoke execute on function private.create_invitation(text,text),public.create_invitation(text,text),private.is_owner() from public,anon;
grant execute on function private.create_invitation(text,text),public.create_invitation(text,text),private.is_owner() to authenticated;
