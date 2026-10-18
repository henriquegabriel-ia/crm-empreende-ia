-- Item 1.11 do roteiro: acompanhamento da privacidade (achados 3 e 11 da revisão do item 1.10). Desenho:
-- docs/arquitetura/1.11.md, seções 4.2 e 13.
-- Aditiva: nenhuma tabela, coluna ou linha muda, nenhum gatilho dispara durante a migração e a auditoria não ganha
-- linhas. Duas funções mudam de definição (mesma assinatura, mesmos grants) e nasce uma função pura.

-- 1. O resumo da anonimização faz as mesmas varreduras da organização que a anonimização (contact_privacy_counts) e é
-- pré-requisito do botão: com o limite de 8 s de authenticated, ele cairia em 57014 antes da anonimização, que já tem
-- 60 s, e ela ficaria inalcançável pela tela. O ALTER mantém o corpo, os grants e o SECURITY INVOKER. O limite da
-- definição vale quando a RPC é chamada pela API (o PostgREST o aplica antes de chamar a função); numa chamada direta
-- por SQL, quem manda é o limite da sessão.
alter function public.contact_privacy_summary(uuid) set statement_timeout = '60s';

-- 2. Texto com os termos trocados que pode passar do limite do campo (CHECK de 500): corta antes do limite, tira um
-- "[anonimizado]" que ficaria pela metade no fim e marca o corte com "…". Até o limite, o texto volta como está.
create function private.fit_redacted_text(p_text text,p_limit integer) returns text language sql immutable set search_path='' as $$
 select case when p_text is null or length(p_text)<=p_limit then p_text
  else rtrim(regexp_replace(left(p_text,p_limit-1),
   '\[(a(n(o(n(i(m(i(z(a(d(o)?)?)?)?)?)?)?)?)?)?)?$',''))||'…' end;
$$;

-- 3. A anonimização, com o corpo de 20261013120000_contact_privacy.sql sem mudança, só com o corte dos três campos de
-- até 500 caracteres (o registro da base legal e o motivo do "Não contatar" de outros contatos e o motivo das empresas)
-- por fit_redacted_text, no lugar de left(…,500): perto do limite, o fim do texto sai marcado com "…", sem deixar um
-- "[anonimizad" quebrado à vista na ficha de outra pessoa. Mesma assinatura e mesmo SECURITY DEFINER: os grants ficam.
create or replace function private.anonymize_contact(p_contact_id uuid,p_version timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
 declare
  v_org uuid;
  v_contact public.contacts;
  v_deals uuid[];
  v_all text;
  v_strong text;
  v_scrubbed integer;
  v_deleted integer;
  v_deal_count integer;
  v_open_deals integer;
  v_payment_count integer;
  v_pending_payments integer;
  v_other integer:=0;
  v_n integer;
  v_summary jsonb;
 begin
 v_org:=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores anonimizam contatos.';
 end if;
 select * into v_contact from public.contacts c where c.id=p_contact_id and c.org_id=v_org;
 if not found then raise exception 'Este contato não está mais disponível. Atualize a página.'; end if;
 if v_contact.anonymized_at is not null then raise exception 'Este contato já foi anonimizado.'; end if;
 select coalesce(array_agg(d.id),'{}') into v_deals from public.deals d where d.org_id=v_org and d.contact_id=p_contact_id;
 perform 1 from public.deals d where d.org_id=v_org and d.contact_id=p_contact_id for no key update;
 perform 1 from public.activities a where a.org_id=v_org and (a.contact_id=p_contact_id or a.deal_id=any(v_deals)) for no key update;
 perform 1 from public.payments p where p.org_id=v_org and (p.contact_id=p_contact_id or p.deal_id=any(v_deals)) for no key update;
 select * into v_contact from public.contacts c where c.id=p_contact_id and c.org_id=v_org for update;
 if not found then raise exception 'Este contato não está mais disponível. Atualize a página.'; end if;
 if v_contact.anonymized_at is not null then raise exception 'Este contato já foi anonimizado.'; end if;
 if v_contact.updated_at is distinct from p_version then
  raise exception 'Este contato mudou desde o resumo. Confira o resumo atualizado e confirme de novo.';
 end if;
 -- Releitura com o contato travado.
 select coalesce(array_agg(d.id),'{}') into v_deals from public.deals d where d.org_id=v_org and d.contact_id=p_contact_id;
 select count(*) into v_open_deals from public.deals d where d.org_id=v_org and d.id=any(v_deals) and d.status='open';
 select count(*) into v_pending_payments from public.payments p
  where p.org_id=v_org and (p.contact_id=p_contact_id or p.deal_id=any(v_deals)) and p.status='pending';
 v_all:=private.contact_privacy_regex(v_contact.first_name,v_contact.last_name,v_contact.email,v_contact.phone,false);
 v_strong:=private.contact_privacy_regex(v_contact.first_name,v_contact.last_name,v_contact.email,v_contact.phone,true);
 -- A marca da anonimização em andamento, só nesta transação, até o fim do item 5. Os gatilhos de contacts a comparam
 -- com o id da linha, e só o UPDATE do item 5 grava o contato da pessoa.
 perform set_config('crm.anonymizing_contact',p_contact_id::text,true);
 -- 1. As ações pendentes com a pessoa saem (o registro de automação que as criou fica, sem o vínculo).
 delete from public.activities a where a.org_id=v_org and a.contact_id=p_contact_id and a.completed_at is null and a.type<>'note';
 get diagnostics v_deleted=row_count;
 -- 2. O que ficou com a pessoa perde o texto: o título pelo tipo, sem detalhes. Tipo, resultado, datas, responsável,
 -- oportunidade, empresa e o vínculo com o contato ficam.
 update public.activities a set title=case a.type when 'call' then 'Ligação' when 'whatsapp' then 'WhatsApp'
   when 'email' then 'E-mail' when 'meeting' then 'Reunião' when 'visit' then 'Visita' when 'note' then 'Nota'
   else 'Tarefa' end||' (contato anonimizado)',
  body=null
  where a.org_id=v_org and a.contact_id=p_contact_id;
 get diagnostics v_scrubbed=row_count;
 -- 3. Oportunidades e recebimentos da pessoa, e as atividades dessas oportunidades com outros contatos (ou sem
 -- contato): todos os termos; o vínculo com o contato sai, e as automações dessas oportunidades não falham por ele.
 update public.deals d set title=private.redact_personal_terms(d.title,v_all),
  lost_reason=private.redact_personal_terms(d.lost_reason,v_all),contact_id=null
  where d.org_id=v_org and d.id=any(v_deals);
 get diagnostics v_deal_count=row_count;
 update public.payments p set description=private.redact_personal_terms(p.description,v_all),
  contact_id=case when p.contact_id=p_contact_id then null else p.contact_id end
  where p.org_id=v_org and (p.contact_id=p_contact_id or p.deal_id=any(v_deals));
 get diagnostics v_payment_count=row_count;
 update public.activities a set title=private.redact_personal_terms(a.title,v_all),body=private.redact_personal_terms(a.body,v_all)
  where a.org_id=v_org and a.contact_id is distinct from p_contact_id and a.deal_id=any(v_deals)
   and (a.title ~* v_all or a.body ~* v_all);
 get diagnostics v_n=row_count;
 v_other:=v_other+v_n;
 -- 4. O resto da organização: só os termos fortes (nome completo, e-mail e telefone), porque o primeiro nome sozinho
 -- apagaria outras pessoas. Nos outros contatos, todos os campos de texto livre (observações, origem, cargo, registro
 -- da base legal e motivo do "Não contatar": "Indicação de Ana Souza", o consentimento dado pela mãe); nas empresas, só
 -- o motivo do "Não contatar" (nome e site são da pessoa jurídica). Os campos de até 500 caracteres ficam no limite, e
 -- a troca não falha num texto longo. Funis, modelos, automações e equipe não mudam.
 if v_strong is not null then
  update public.activities a set title=private.redact_personal_terms(a.title,v_strong),body=private.redact_personal_terms(a.body,v_strong)
   where a.org_id=v_org and a.contact_id is distinct from p_contact_id and (a.deal_id is null or not a.deal_id=any(v_deals))
    and (a.title ~* v_strong or a.body ~* v_strong);
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
  update public.deals d set title=private.redact_personal_terms(d.title,v_strong),
   lost_reason=private.redact_personal_terms(d.lost_reason,v_strong)
   where d.org_id=v_org and not d.id=any(v_deals) and (d.title ~* v_strong or d.lost_reason ~* v_strong);
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
  update public.payments p set description=private.redact_personal_terms(p.description,v_strong)
   where p.org_id=v_org and p.contact_id is distinct from p_contact_id and (p.deal_id is null or not p.deal_id=any(v_deals))
    and p.description ~* v_strong;
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
  update public.contacts c set notes=private.redact_personal_terms(c.notes,v_strong),
   source=private.redact_personal_terms(c.source,v_strong),job_title=private.redact_personal_terms(c.job_title,v_strong),
   legal_basis_note=private.fit_redacted_text(private.redact_personal_terms(c.legal_basis_note,v_strong),500),
   do_not_contact_reason=private.fit_redacted_text(private.redact_personal_terms(c.do_not_contact_reason,v_strong),500)
   where c.org_id=v_org and c.id<>p_contact_id
    and (c.notes ~* v_strong or c.source ~* v_strong or c.job_title ~* v_strong or c.legal_basis_note ~* v_strong
     or c.do_not_contact_reason ~* v_strong);
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
  update public.companies co set do_not_contact_reason=private.fit_redacted_text(private.redact_personal_terms(co.do_not_contact_reason,v_strong),500)
   where co.org_id=v_org and co.do_not_contact_reason ~* v_strong;
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
 end if;
 -- 5. O cadastro: "Contato anonimizado", sem dados pessoais, com "Não contatar" ligado e a data e o autor da
 -- anonimização. A base legal fica, sem o registro. O e-mail sai do índice único: a pessoa pode ser cadastrada de novo
 -- como um contato novo.
 update public.contacts c set first_name='Contato anonimizado',last_name=null,email=null,phone=null,job_title=null,notes=null,
  source=private.redact_personal_terms(c.source,v_all),company_id=null,do_not_contact=true,do_not_contact_reason=null,
  legal_basis_note=null,anonymized_at=now(),anonymized_by=auth.uid()
  where c.id=p_contact_id and c.org_id=v_org;
 perform set_config('crm.anonymizing_contact','',true);
 v_summary:=jsonb_build_object('activities_scrubbed',v_scrubbed,'activities_deleted',v_deleted,'deals',v_deal_count,
  'open_deals',v_open_deals,'payments',v_payment_count,'pending_payments',v_pending_payments,'other_records',v_other);
 insert into public.privacy_actions(org_id,contact_id,action,performed_by,summary)
  values(v_org,p_contact_id,'anonymize',auth.uid(),v_summary);
 return v_summary;
 end;
$$;

revoke execute on function private.fit_redacted_text(text,integer) from public,anon,authenticated,service_role;
