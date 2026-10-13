-- Item 1.1 do roteiro, reforço de 12/10/2026: a conta só ganha papel depois de provar o e-mail. Desenho:
-- docs/arquitetura/1.1.md, seção 16. O portão de 20261012100000_single_company_admission.sql decide quem pode criar
-- a conta de um e-mail, mas não quem escolhe a senha dela: qualquer pessoa cria a conta de um e-mail com convite
-- pendente (e, na instância vazia, de qualquer e-mail) com a senha que quiser, e o Supabase Auth não troca essa senha
-- quando o dono do e-mail se cadastra depois. Daqui em diante, a confirmação descarta a senha anterior, a prova do
-- e-mail é gravada só quando a sessão aberta pelo link nasce na mesma transação da confirmação, e accept_invitation e
-- create_workspace exigem essa prova (ou uma sessão aberta por link). Uma conta sem organização também não troca de
-- e-mail: a prova é do endereço, e a troca levaria a conta (com a senha de quem a criou) para o e-mail de um convidado.
-- Nada é reescrito: uma tabela vazia, três gatilhos, quatro funções novas e três funções substituídas, com as mesmas
-- assinaturas (o tipo gerado não muda). Contas antigas já confirmadas ficam sem prova e entram pelo link para ganhar
-- papel; membros (contas com organização) não passam mais pela admissão.

-- Prova do e-mail: uma linha por conta que confirmou o e-mail pelo link depois deste reforço, com o e-mail confirmado.
-- A linha é da conta, que ainda não tem organização quando prova o e-mail (como profiles, que referencia auth.users do
-- mesmo jeito): por isso não tem org_id nem FK composta, e fica em private, fora do schema exposto, com RLS ligada, sem
-- política e sem privilégio para nenhum papel da API. Não é coluna de profiles (lido pela equipe, auditado e no tipo
-- gerado) nem de raw_app_meta_data (o Auth regrava o campo logo depois de confirmar, e a chave de administração o
-- edita). Guardar o e-mail faz a troca de e-mail invalidar a prova, uma defesa a mais além do gatilho que recusa a
-- troca na conta sem organização.
create table private.email_proofs(
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null,
 proven_at timestamptz not null default now()
);
alter table private.email_proofs enable row level security;
revoke all on private.email_proofs from public,anon,authenticated,service_role;

-- Portão de cadastro: a mesma regra, e a conta aceita fica marcada numa configuração local da transação, que o Auth não
-- recebe de fora e que acaba no commit. Com ela, a confirmação na mesma transação da criação (painel com "Auto Confirm
-- User", confirmação desligada no Auth) guarda a senha de quem criou a conta: não há senha alheia a descartar.
create or replace function private.enforce_invite_only_signup() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 if not private.signup_allowed(new.email) then
  raise exception 'Cadastro recusado: este CRM aceita novas contas só por convite.'
   using hint='Crie o convite em Equipe e peça para a pessoa se cadastrar pelo link do convite.';
 end if;
 perform set_config('crm.auth_user_created',new.id::text,true);
 return new;
 end;
$$;

-- Confirmação do e-mail: toda confirmação termina num UPDATE de email_confirmed_at de nulo para preenchido. A senha
-- anterior, escolhida por quem criou a conta, é descartada nesse mesmo UPDATE: antes do commit, o login vê a conta não
-- confirmada; depois, sem senha. Vazio, e não nulo, é o que o Auth grava numa conta sem senha. A confirmação na mesma
-- transação da criação guarda a senha (decisão R2). O UPDATE não grava a prova: a confirmação também acontece sem link
-- (/signup e /otp com a confirmação desligada no Auth numa conta que já existe sem confirmação, a API de
-- administração), e /signup entrega então uma sessão por senha a quem fez o pedido, sem conferir senha nenhuma. A conta
-- confirmada fica marcada numa configuração local da transação, que record_email_proof lê.
-- SECURITY DEFINER, como os demais gatilhos deste reforço: roda como o dono do banco, e não como supabase_auth_admin,
-- o papel com que o Auth atualiza a conta.
create function private.discard_unproven_password() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 if current_setting('crm.auth_user_created',true) is not distinct from new.id::text then return new; end if;
 new.encrypted_password:='';
 perform set_config('crm.auth_user_confirmed',new.id::text,true);
 return new;
 end;
$$;
-- Só na transição de não confirmada para confirmada, e não nos demais UPDATEs do Auth (último acesso, metadados, senha).
create trigger discard_unproven_password before update of email_confirmed_at on auth.users for each row
 when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
 execute function private.discard_unproven_password();

-- Prova do e-mail: a sessão aberta pelo link nasce na transação que confirma a conta. verifyGet (no fluxo implícito, o
-- do CRM) e verifyPost do Auth confirmam a conta e, no mesmo pedido e na mesma transação, emitem a sessão do link
-- (IssueRefreshToken grava auth.sessions e, por AddClaimToSession, o método otp em auth.mfa_amr_claims), depois do
-- UPDATE que confirma. Sem essa sessão não há prova: na confirmação sem link de /signup, a sessão por senha vem noutra
-- transação; a API de administração não abre sessão; no fluxo PKCE, a sessão nasce noutro pedido, na troca do código (e
-- o amr dela vale como prova enquanto ela durar). Uma sessão de link aberta num pedido posterior à confirmação também
-- não grava a prova: a conta pode já ter a sessão por senha de outra pessoa, que passaria a valer.
-- SECURITY DEFINER: o Auth grava como supabase_auth_admin, que não grava em private.
create function private.record_email_proof() returns trigger language plpgsql security definer set search_path='' as $$
 declare v_user uuid;
 begin
 select user_id into v_user from auth.sessions where id=new.session_id;
 if v_user is null or current_setting('crm.auth_user_confirmed',true) is distinct from v_user::text then return null; end if;
 insert into private.email_proofs(user_id,email,proven_at)
  select u.id,lower(trim(u.email)),now() from auth.users u where u.id=v_user and nullif(trim(u.email),'') is not null
 on conflict(user_id) do update set email=excluded.email,proven_at=excluded.proven_at;
 return null;
 end;
$$;
-- Só os métodos de uma sessão aberta por link enviado ao e-mail, os mesmos de email_proven (na confirmação, o Auth
-- grava otp; os demais são os do PKCE). O ON CONFLICT do Auth numa sessão que já tinha o método não insere.
create trigger record_email_proof after insert on auth.mfa_amr_claims for each row
 when (new.authentication_method in ('otp','magiclink','email/signup','invite','recovery'))
 execute function private.record_email_proof();

-- Troca de e-mail só para quem já está numa empresa. A prova é do endereço: uma conta sem organização que passasse a
-- usar o e-mail de um convidado (PUT /auth/v1/user com email, pela API, ou o painel) ficaria com a senha de quem a
-- criou e, com a troca segura do Auth, com a sessão de quem abre o último dos dois links, que traz amr otp no fluxo
-- implícito, o mesmo do link de acesso. O CRM não tem tela de troca de e-mail, e a conta sem organização não precisa
-- dela: quem digitou o e-mail errado pede um convite para o certo. Recusa o pedido (o Auth grava email_change depois
-- de enviar os e-mails, cujo link então não funciona) e a conclusão (email); o UPDATE que regrava o mesmo valor, ou que
-- limpa email_change, passa. Membros (conta com organização) não ganham nada com a troca: a admissão recusa quem já
-- pertence a uma organização.
-- SECURITY DEFINER: o Auth atualiza como supabase_auth_admin, que não lê public.profiles.
create function private.refuse_email_change_without_org() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 if not exists(select 1 from public.profiles where id=new.id and org_id is not null) then
  raise exception 'Troca de e-mail recusada: a conta ainda não entrou numa empresa deste CRM.'
   using hint='Para usar outro e-mail, peça um convite para o novo endereço.';
 end if;
 return new;
 end;
$$;
create trigger refuse_email_change_without_org before update of email,email_change on auth.users for each row
 when (new.email is distinct from old.email or (new.email_change is distinct from old.email_change and coalesce(new.email_change,'')<>''))
 execute function private.refuse_email_change_without_org();

-- A conta da sessão provou o e-mail atual: pela prova gravada na confirmação por link ou por uma sessão aberta por um
-- link enviado ao e-mail (amr do token: otp no fluxo implícito, o do CRM; os demais no PKCE). password, totp,
-- token_refresh, anonymous, oauth e sso/saml não valem, nem um amr ausente ou malformado (um método novo do Auth fica
-- de fora até alguém o acrescentar). email_change também não: na troca segura, a sessão vai para quem abre o último dos
-- dois links, que pode ser o do endereço antigo. O sub do token precisa ser a própria conta. otp também é o login por
-- SMS: com o telefone ligado, uma conta com e-mail e telefone provaria o telefone (o 1.3 o mantém desligado).
-- SECURITY INVOKER e sem execução por papel da API: só roda dentro das RPCs SECURITY DEFINER.
create function private.email_proven() returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.email_proofs p join auth.users u on u.id=p.user_id
   where p.user_id=(select auth.uid()) and p.email=lower(trim(u.email)))
  or ((select auth.jwt())->>'sub' is not distinct from (select auth.uid())::text
   and exists(select 1 from jsonb_array_elements(case when jsonb_typeof((select auth.jwt())->'amr')='array' then (select auth.jwt())->'amr' else '[]'::jsonb end) m
    where m->>'method' in ('otp','magiclink','email/signup','invite','recovery')));
$$;

-- Primeiro dono (D6), agora com a prova do e-mail, que vem por último: a prova é da conta, e a pessoa não pede um link
-- para descobrir em seguida que a empresa já existe. O resto é igual a 20261012100000_single_company_admission.sql.
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
 if not private.email_proven() then
  raise exception 'Para criar a empresa, confirme que o e-mail é seu: entre pelo link enviado a ele.';
 end if;
 return private.provision_organization(auth.uid(),p_name);
 end;
$$;

-- Aceite, agora com a prova do e-mail como oitava recusa: quem usa outra conta continua sabendo só que o convite não é
-- dela, e o convidado não pede um link para descobrir em seguida que o convite expirou. O resto é igual a
-- 20261012100000_single_company_admission.sql.
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
 if not private.email_proven() then
  raise exception 'Para aceitar o convite, confirme que o e-mail é seu: entre pelo link enviado a ele.';
 end if;
 update public.profiles set org_id=invitation.org_id where id=auth.uid();
 insert into public.user_roles(user_id,org_id,role) values(auth.uid(),invitation.org_id,invitation.role);
 update public.invitations set accepted_at=now() where id=invitation.id;
 return invitation.org_id;
 end;
$$;

-- create or replace mantém os grants das três funções substituídas.
revoke execute on function private.discard_unproven_password(),private.record_email_proof(),private.refuse_email_change_without_org(),private.email_proven() from public,anon,authenticated,service_role;
