-- Item 1.9 do roteiro: canais nível 1 com registro (WhatsApp, e-mail e telefone). Desenho: docs/arquitetura/1.9.md.
-- O CRM abre o aplicativo da pessoa (wa.me, Gmail, Outlook web, mailto: e tel:) e nunca envia nada; o que aconteceu é
-- registrado como atividade, na mesma tabela de sempre, e por isso entra sozinho na linha do tempo 360, em "Concluídas
-- hoje" e na próxima ação. Esta migração acrescenta os tipos whatsapp e visit, o resultado da ligação concluída
-- (activities.outcome), a marca "Não contatar" em contatos e empresas, com a data, o autor e o motivo preenchidos pelo
-- banco, e a RPC complete_activity, que conclui uma atividade e cria a próxima ação na mesma transação.
-- Aditiva e sem reescrever tabela: um CHECK mais largo, uma coluna anulável em activities, quatro colunas em contacts e
-- em companies (a única com padrão tem padrão constante, sem reescrita no PostgreSQL 11+), dois gatilhos e uma RPC.
-- Nenhuma linha existente muda, nenhum gatilho dispara durante a migração e a auditoria não ganha linhas.

-- 1. Tipos de atividade: WhatsApp (ação com prazo, como e-mail) e visita (compromisso com início e término, como
-- reunião). O nome é o que o PostgreSQL deu ao CHECK da coluna em 20260906051319_commercial_foundation.sql. NOT VALID
-- seguido de VALIDATE separa a criação da conferência das linhas existentes, todas com os tipos antigos; dentro da
-- transação da migração, a trava do DROP vale até o fim, e a conferência de uma tabela de atividades de empresa pequena
-- ou média leva milissegundos.
alter table public.activities drop constraint activities_type_check;
alter table public.activities add constraint activities_type_check
 check(type in ('task','meeting','call','email','note','whatsapp','visit')) not valid;
alter table public.activities validate constraint activities_type_check;

-- 2. Resultado da ligação concluída: atendeu, não atendeu ou caixa postal. Valores em inglês no banco e rótulos em
-- pt-BR na tela (OUTCOME_LABELS), como status e type. Coluna anulável, sem padrão e sem índice: o resultado é lido no
-- snapshot, e o relatório de atividades (2A.1) decide o índice dele.
alter table public.activities add column outcome text;
alter table public.activities add constraint activities_outcome_valid
 check(outcome is null or (type='call' and completed_at is not null and outcome in ('answered','no_answer','voicemail')));

-- O resultado só existe na ligação concluída: reabrir a ligação, ou trocar o tipo em "Editar", limpa o resultado em
-- silêncio, no molde de validate_deal_change, que limpa lost_reason fora da perda. Assim o "Reabrir" de sempre (que
-- só manda completed_at nulo) continua funcionando sem conhecer o resultado; o CHECK recusa só o valor fora da lista
-- numa ligação concluída. BEFORE, em ordem alfabética: antes de protect_record_metadata, record_activity_author,
-- refuse_inactive_assignee e touch_updated_at, e nenhum deles lê outcome.
create function private.normalize_activity_outcome() returns trigger language plpgsql set search_path='' as $$
 begin
 if new.type<>'call' or new.completed_at is null then new.outcome=null; end if;
 return new;
 end;
$$;
create trigger normalize_activity_outcome before insert or update on public.activities
 for each row execute function private.normalize_activity_outcome();

-- 3. "Não contatar" em contatos e empresas: o estado atual do registro, lido em toda tela que mostra um canal. O
-- histórico de pedidos do titular (consent_events) é do 2B.8, e a base legal e a granularidade por canal, do 1.10; até
-- lá, a auditoria registra cada mudança destes campos com o autor. A data e o autor são preenchidos pelo gatilho
-- abaixo (o cliente não os forja), com a FK composta para o perfil da mesma organização, sem ON DELETE, como
-- portfolio_transfers. Sem índice em do_not_contact: as telas leem a marca pelo snapshot, e o filtro é do 2B.2; o
-- índice da FK segue a regra da base.
alter table public.contacts
 add column do_not_contact boolean not null default false,
 add column do_not_contact_at timestamptz,
 add column do_not_contact_by uuid,
 add column do_not_contact_reason text;
alter table public.contacts
 add constraint contacts_do_not_contact_at_finite check(isfinite(do_not_contact_at)),
 add constraint contacts_do_not_contact_reason_length check(do_not_contact_reason is null or length(do_not_contact_reason)<=500),
 add constraint contacts_do_not_contact_state check((do_not_contact and do_not_contact_at is not null)
  or (not do_not_contact and do_not_contact_at is null and do_not_contact_by is null and do_not_contact_reason is null)),
 add constraint contacts_do_not_contact_by_org_id_fkey foreign key(do_not_contact_by,org_id) references public.profiles(id,org_id);
create index contacts_do_not_contact_by_org_id_fkey_idx on public.contacts(do_not_contact_by,org_id);
alter table public.companies
 add column do_not_contact boolean not null default false,
 add column do_not_contact_at timestamptz,
 add column do_not_contact_by uuid,
 add column do_not_contact_reason text;
alter table public.companies
 add constraint companies_do_not_contact_at_finite check(isfinite(do_not_contact_at)),
 add constraint companies_do_not_contact_reason_length check(do_not_contact_reason is null or length(do_not_contact_reason)<=500),
 add constraint companies_do_not_contact_state check((do_not_contact and do_not_contact_at is not null)
  or (not do_not_contact and do_not_contact_at is null and do_not_contact_by is null and do_not_contact_reason is null)),
 add constraint companies_do_not_contact_by_org_id_fkey foreign key(do_not_contact_by,org_id) references public.profiles(id,org_id);
create index companies_do_not_contact_by_org_id_fkey_idx on public.companies(do_not_contact_by,org_id);

-- 4. A marca muda só por quem pode: quem edita marca (na criação ou na edição), e só donos e administradores tiram a
-- marca, porque a política de UPDATE não compara o valor antigo com o novo. Ao marcar, o banco grava a data, o autor
-- (auth.uid(); nulo pelo editor SQL ou pela chave service_role, que já ignoram a RLS) e o motivo aparado; ao tirar, os
-- três voltam a nulo. Com a marca inalterada, data, autor e motivo ficam como estavam: o motivo só muda marcando de
-- novo, e um cliente que mande motivo sem marca não grava nada. transfer_portfolio e move_member_portfolio (1.2) só
-- mudam owner_id, e a marca fica. BEFORE, em ordem alfabética: depois de protect_record_metadata e
-- refuse_inactive_assignee, antes de touch_updated_at.
-- O IF aninhado não é estilo: o PL/pgSQL prepara cada expressão na primeira vez que a executa, e preparar
-- private.can_manage() exige USAGE no schema private, que a service_role não tem. Numa expressão só (com AND), toda
-- inserção sem marca e toda retirada pela chave service_role (integrações, Edge Functions) cairia em 42501.
create function private.stamp_do_not_contact() returns trigger language plpgsql set search_path='' as $$
 begin
 if tg_op='INSERT' or new.do_not_contact is distinct from old.do_not_contact then
  if new.do_not_contact then
   new.do_not_contact_at=now();
   new.do_not_contact_by=(select auth.uid());
   new.do_not_contact_reason=nullif(btrim(new.do_not_contact_reason),'');
  else
   if tg_op='UPDATE' and (select auth.uid()) is not null then
    if not private.can_manage() then raise exception 'Só donos e administradores permitem o contato de novo.'; end if;
   end if;
   new.do_not_contact_at=null;
   new.do_not_contact_by=null;
   new.do_not_contact_reason=null;
  end if;
 else
  new.do_not_contact_at=old.do_not_contact_at;
  new.do_not_contact_by=old.do_not_contact_by;
  new.do_not_contact_reason=old.do_not_contact_reason;
 end if;
 return new;
 end;
$$;
create trigger stamp_do_not_contact before insert or update on public.contacts
 for each row execute function private.stamp_do_not_contact();
create trigger stamp_do_not_contact before insert or update on public.companies
 for each row execute function private.stamp_do_not_contact();

-- 5. "Concluir e agendar a próxima": conclui só a versão lida (updated_at) de uma atividade pendente que não é nota,
-- grava o resultado (só ligação) e acrescenta a anotação ao fim dos detalhes (um item na linha do tempo, com o plano e
-- o que aconteceu) e, com p_next, cria a próxima ação na mesma transação, com o id gerado no navegador e, quando não
-- informados, o contato, a empresa, a oportunidade e o responsável da atividade concluída. Qualquer recusa desfaz tudo:
-- a conclusão não acontece sem a próxima ação, e a próxima ação não nasce sobre uma conclusão recusada.
-- SECURITY INVOKER, como move_deal e delete_deal: a RLS de activities vale dentro dela, e a atividade de outra
-- organização não aparece, caindo na mesma mensagem de "mudou ou não está mais disponível". FOR UPDATE serializa duas
-- conclusões da mesma atividade: a segunda espera, relê a linha já concluída (READ COMMITTED) e é recusada. A próxima
-- ação passa pelos gatilhos de uma inserção direta (refuse_inactive_assignee, record_activity_author e as FKs
-- compostas). O pedido repetido depois de uma resposta perdida acha a próxima ação pelo id e devolve o par já gravado,
-- sem mudar nada; sem p_next, a repetição cai em "mudou", e a tela mostra a atividade concluída.
create function public.complete_activity(p_activity_id uuid,p_version timestamptz,p_outcome text default null,
 p_note text default null,p_next jsonb default null) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare
  v_done public.activities;
  v_next public.activities;
  v_next_id uuid:=nullif(p_next->>'id','')::uuid;
  v_note text:=nullif(btrim(p_note),'');
 begin
 if not private.can_write() then raise exception 'Você não tem permissão para alterar atividades.'; end if;
 -- Pedido repetido (a resposta do primeiro se perdeu): a próxima ação já existe com o id gerado no navegador.
 if v_next_id is not null then
  select * into v_next from public.activities where id=v_next_id;
  if found then
   select * into v_done from public.activities where id=p_activity_id;
   if found and v_done.completed_at is not null then
    return jsonb_build_object('completed',to_jsonb(v_done),'next',to_jsonb(v_next),'replayed',true);
   end if;
   raise exception 'Esta próxima ação já existe. Atualize a página.';
  end if;
 end if;
 select * into v_done from public.activities where id=p_activity_id for update;
 if not found or v_done.updated_at is distinct from p_version or v_done.completed_at is not null or v_done.type='note' then
  raise exception 'Esta atividade mudou ou não está mais disponível. Revise os dados atuais antes de tentar novamente.';
 end if;
 if p_outcome is not null and (v_done.type<>'call' or p_outcome not in ('answered','no_answer','voicemail')) then
  raise exception 'O resultado só vale para ligações: atendeu, não atendeu ou caixa postal.';
 end if;
 update public.activities set completed_at=now(),outcome=p_outcome,
  body=case when v_note is null then body else concat_ws(E'\n\n',nullif(btrim(body),''),v_note) end
  where id=v_done.id returning * into v_done;
 if p_next is null then
  return jsonb_build_object('completed',to_jsonb(v_done),'next',null);
 end if;
 if coalesce(nullif(p_next->>'type',''),'task')='note' then raise exception 'A próxima ação não pode ser uma nota.'; end if;
 if nullif(btrim(p_next->>'title'),'') is null then raise exception 'Informe o que precisa acontecer na próxima ação.'; end if;
 if nullif(p_next->>'due_date','') is null then raise exception 'Informe o prazo da próxima ação.'; end if;
 insert into public.activities(id,org_id,type,title,body,due_date,end_date,user_id,contact_id,company_id,deal_id)
  values(coalesce(v_next_id,gen_random_uuid()),v_done.org_id,coalesce(nullif(p_next->>'type',''),'task'),
   btrim(p_next->>'title'),nullif(btrim(p_next->>'body'),''),(p_next->>'due_date')::timestamptz,
   nullif(p_next->>'end_date','')::timestamptz,
   case when p_next ? 'user_id' then nullif(p_next->>'user_id','')::uuid else v_done.user_id end,
   case when p_next ? 'contact_id' then nullif(p_next->>'contact_id','')::uuid else v_done.contact_id end,
   case when p_next ? 'company_id' then nullif(p_next->>'company_id','')::uuid else v_done.company_id end,
   case when p_next ? 'deal_id' then nullif(p_next->>'deal_id','')::uuid else v_done.deal_id end)
  returning * into v_next;
 return jsonb_build_object('completed',to_jsonb(v_done),'next',to_jsonb(v_next));
 end;
$$;

-- 6. Execução: a RPC para authenticated (nunca anon); as funções de gatilho para nenhum papel da API.
revoke execute on function private.normalize_activity_outcome(),private.stamp_do_not_contact()
 from public,anon,authenticated,service_role;
revoke execute on function public.complete_activity(uuid,timestamptz,text,text,jsonb) from public,anon;
grant execute on function public.complete_activity(uuid,timestamptz,text,text,jsonb) to authenticated;
