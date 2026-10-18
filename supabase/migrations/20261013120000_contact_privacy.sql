-- Item 1.10 do roteiro: LGPD da empresa controladora. Desenho: docs/arquitetura/1.10.md.
-- A empresa que usa o CRM é a controladora. Esta migração dá a ela o mínimo para atender a LGPD com dados reais:
-- a base legal de cada contato, preenchida pelo banco (com o padrão da empresa quando ninguém escolhe outra), a recusa
-- de ações de contato agendadas para quem pediu "Não contatar", a exportação dos dados de um contato (pedido de acesso
-- do titular) e a anonimização (pedido de exclusão), as duas só por donos e administradores e registradas em
-- privacy_actions. audit_logs guarda só nomes de campos, sem valores, e fica como está (seção 4.7 do desenho).
-- Aditiva e sem reescrever tabela: três colunas em organizations e seis em contacts (as duas com padrão têm padrão
-- constante, sem reescrita no PostgreSQL 11+), uma tabela, funções e gatilhos novos e stamp_do_not_contact substituída
-- com a mesma assinatura. Nenhuma linha existente muda, nenhum gatilho dispara durante a migração e a auditoria não
-- ganha linhas: os contatos e a organização existentes ficam com a base "não informada", sem carimbo, até alguém
-- preencher.
-- Lição do 1.9 aplicada a todos os gatilhos novos: a chave service_role não tem USAGE em private, e um gatilho SECURITY
-- INVOKER que prepara uma expressão com private.* derruba toda gravação dela (42501). Os gatilhos que leem outra tabela
-- são SECURITY DEFINER (enxergam a linha também com a visibilidade por responsável do 2A.6); os demais não citam
-- private.*; e a marca da anonimização em andamento é lida com current_setting, do pg_catalog.

-- 1. Termos pessoais e a troca por "[anonimizado]". Funções puras, sem extensão (unaccent) e sem depender do locale: o
-- test:db roda com --locale=C, em que [[:alpha:]], lower() e a opção i só conhecem ASCII, e o Supabase com en_US.UTF-8.
-- Cada letra vira uma classe com as duas caixas e, nas vogais, no c e no n, os acentos do português; "João" casa com
-- "joao", "JOÃO" e "Joáo". O espaço vira \s+ (espaços variados), o dígito fica, o símbolo ASCII é escapado (pontos,
-- "@", parênteses, "+": nomes como "Ana (Tia)" viram literais) e o resto fica como está.
-- Texto decomposto (NFD, comum no que é colado de PDF, do macOS ou de integrações: o "a" seguido do til combinante)
-- casa com o termo composto (NFC) e vice-versa, sem normalize(), que exige o servidor em UTF8: as marcas combinantes do
-- termo (U+0300 a U+036F) saem, porque a classe da letra já aceita os acentos, e cada letra aceita as marcas que vierem
-- depois dela no texto.
create function private.privacy_term_regex(p_term text) returns text language plpgsql immutable set search_path='' as $$
 declare
  v_term text:=btrim(regexp_replace(coalesce(p_term,''),'\s+',' ','g'));
  v_marks constant text:='[\u0300-\u036f]*';
  v_char text;
  v_base text;
  v_result text:='';
 begin
 if v_term='' then return null; end if;
 foreach v_char in array regexp_split_to_array(v_term,'') loop
  v_base:=translate(v_char,
   'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñABCDEFGHIJKLMNOPQRSTUVWXYZ',
   'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuuccnnabcdefghijklmnopqrstuvwxyz');
  v_result:=v_result||case
   when v_base='a' then '[aáàâãäAÁÀÂÃÄ]'||v_marks
   when v_base='e' then '[eéèêëEÉÈÊË]'||v_marks
   when v_base='i' then '[iíìîïIÍÌÎÏ]'||v_marks
   when v_base='o' then '[oóòôõöOÓÒÔÕÖ]'||v_marks
   when v_base='u' then '[uúùûüUÚÙÛÜ]'||v_marks
   when v_base='c' then '[cçCÇ]'||v_marks
   when v_base='n' then '[nñNÑ]'||v_marks
   when ascii(v_base) between 97 and 122 then '['||v_base||translate(v_base,'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ')||']'||v_marks
   when ascii(v_char) between 768 and 879 then ''
   when ascii(v_char) between 48 and 57 then v_char
   when v_char=' ' then '\s+'
   when ascii(v_char) between 33 and 126 then '\'||v_char
   else v_char
  end;
 end loop;
 return v_result;
 end;
$$;

-- Telefone gravado: cada número do campo vira um termo. O campo é cortado em sequências telefônicas (dígitos com
-- espaços, pontos, hífens e parênteses, começando por "+", "(" ou um dígito); o ramal ("ramal 12", "r. 12", "x12") e
-- qualquer outro texto ("/", "ou", ",") cortam a sequência. Dentro dela, dois números podem vir separados só por espaço,
-- por " - " ou por nada antes do parêntese ("(11) 3333-4444 - (11) 95555-0000", como a tela e a importação gravam o que
-- não reconhecem): a sequência vira grupos, cortados nos espaços e antes de cada "(" e "+" (que começam outro número),
-- e um grupo sem dígito (o " - ") separa dois números. Um número termina num grupo de 4 dígitos ou mais e junta os
-- grupos anteriores até 13 dígitos, sem engolir um grupo de 8 dígitos ou mais (que já é outro número). Assim,
-- "11 3333-4444 11 95555-0000" e "11955550000 1133334444" viram dois termos, "+55 11 9 9999 0000" um só, e o ramal
-- sem a palavra ("(11) 3333-4444 1234") não vira termo nem engole o número. Na dúvida, sobra um termo a mais (um trecho
-- de 8 dígitos que não é número, raro num texto), nunca um a menos. De cada número com 8 dígitos ou mais, os 8 últimos,
-- com um separador opcional ([ .-]) entre eles, precedidos, se houver, do 9 inicial do celular, do DDD com ou sem
-- parênteses e do código do país (+55 para um número brasileiro gravado sem ele). Casa com "+55 11 99999-0000",
-- "+5511999990000", "(11) 99999-0000", "11999990000", "99999-0000", "9999-0000" e "11 9 9999 0000". Sem nenhum número
-- de 8 dígitos ou mais, nulo.
create function private.privacy_phone_regex(p_phone text) returns text language plpgsql immutable set search_path='' as $$
 declare
  v_run text;
  v_groups text[];
  v_part text;
  v_total text;
  v_digits text;
  v_rest text;
  v_nine boolean;
  v_ddd text;
  v_country text;
  v_last text;
  v_number text;
  v_numbers text[]:='{}';
 begin
 for v_run in select m.run[1] from regexp_matches(coalesce(p_phone,''),'([+(]?[0-9][0-9 ().-]*)','g') m(run) loop
  v_groups:=regexp_split_to_array(btrim(regexp_replace(v_run,'([+(])',' \1','g')),'\s+');
  -- O número que termina no grupo j: o mais longo, juntando os grupos anteriores até 13 dígitos.
  for j in 1..cardinality(v_groups) loop
   continue when length(regexp_replace(v_groups[j],'[^0-9]','','g'))<4;
   v_total:='';
   v_digits:=null;
   for i in reverse j..1 loop
    v_part:=regexp_replace(v_groups[i],'[^0-9]','','g');
    exit when v_part='' or length(v_total)+length(v_part)>13 or (i<j and length(v_part)>=8);
    v_total:=v_part||v_total;
    if length(v_total)>=8 then v_digits:=v_total; end if;
   end loop;
   continue when v_digits is null;
   v_rest:=left(v_digits,length(v_digits)-8);
   v_nine:=false;
   v_ddd:=null;
   v_last:='';
   if length(v_rest)%2=1 and right(v_rest,1)='9' then
    v_nine:=true;
    v_rest:=left(v_rest,length(v_rest)-1);
   end if;
   if length(v_rest)>=2 then
    v_ddd:=right(v_rest,2);
    v_rest:=left(v_rest,length(v_rest)-2);
   end if;
   v_country:=coalesce(nullif(v_rest,''),case when v_ddd is not null then '55' end);
   for i in 1..8 loop
    v_last:=v_last||case when i>1 then '[ .-]?' else '' end||substr(v_digits,length(v_digits)-8+i,1);
   end loop;
   v_number:=coalesce('(?:\+?'||v_country||'[ .-]?)?','')||coalesce('(?:\(?'||v_ddd||'\)?[ .-]?)?','')
    ||case when v_nine then '(?:9[ .-]?)?' else '' end||v_last;
   if v_number<>all(v_numbers) then v_numbers:=v_numbers||v_number; end if;
  end loop;
 end loop;
 if cardinality(v_numbers)=0 then return null; end if;
 if cardinality(v_numbers)=1 then return v_numbers[1]; end if;
 return '(?:'||array_to_string(v_numbers,'|')||')';
 end;
$$;

-- Os termos de um contato, numa expressão só, com fronteira de palavra explícita: a fronteira lista as letras
-- acentuadas do Latin-1 (À-ÿ) e as marcas combinantes (U+0300 a U+036F), porque \m e \M dependem do locale. Uma
-- alternância só é uma passada só, e o texto já trocado nunca é procurado de novo; com |, o PostgreSQL fica com o
-- casamento mais longo em cada posição.
-- Fortes (p_strong_only): o nome completo, quando tem duas palavras ou mais, o e-mail e o telefone. Todos: os fortes,
-- o nome e o sobrenome inteiros e cada palavra do nome com 3 letras ou mais, fora as partículas (as de duas letras, como
-- "da" e "de", já ficam de fora pelo tamanho). Sem nenhum termo, nulo: "texto ~* null" é nulo, e nada é alterado.
-- Recebe os quatro campos, e não a linha de contacts, para os testes montarem os casos sem gravar contatos.
create function private.contact_privacy_regex(p_first_name text,p_last_name text,p_email text,p_phone text,p_strong_only boolean)
 returns text language plpgsql immutable set search_path='' as $$
 declare
  v_first text:=nullif(btrim(regexp_replace(coalesce(p_first_name,''),'\s+',' ','g')),'');
  v_last text:=nullif(btrim(regexp_replace(coalesce(p_last_name,''),'\s+',' ','g')),'');
  v_full text;
  v_email text:=nullif(btrim(coalesce(p_email,'')),'');
  v_phone text:=private.privacy_phone_regex(p_phone);
  v_terms text[]:='{}';
  v_word text;
  v_regex text;
 begin
 v_full:=nullif(concat_ws(' ',v_first,v_last),'');
 if strpos(coalesce(v_full,''),' ')>0 then v_terms:=v_terms||v_full; end if;
 if v_email is not null then v_terms:=v_terms||v_email; end if;
 if not coalesce(p_strong_only,false) then
  v_terms:=v_terms||v_first||v_last;
  foreach v_word in array string_to_array(coalesce(v_full,''),' ') loop
   if char_length(v_word)>=3 and translate(v_word,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
    not in ('das','dos','del','der','van','von') then
    v_terms:=v_terms||v_word;
   end if;
  end loop;
 end if;
 select string_agg(t.regex,'|' order by t.size desc,t.regex) into v_regex from (
  select r.regex,max(r.size) as size from (
   select private.privacy_term_regex(term) as regex,char_length(term) as size from unnest(v_terms) term
   union all select v_phone,char_length(v_phone) where v_phone is not null
  ) r where r.regex is not null group by r.regex
 ) t;
 if v_regex is null then return null; end if;
 return '(?<![[:alnum:]À-ÿ\u0300-\u036f])(?:'||v_regex||')(?![[:alnum:]À-ÿ\u0300-\u036f])';
 end;
$$;

-- A troca. O resultado nunca fica vazio onde havia texto, então os CHECK de título, de descrição e do motivo da perda
-- continuam valendo. Sem expressão (nenhum termo), o texto volta como está.
create function private.redact_personal_terms(p_text text,p_regex text) returns text language sql immutable set search_path='' as $$
 select case when p_text is null or p_regex is null then p_text else regexp_replace(p_text,p_regex,'[anonimizado]','gi') end;
$$;

-- 2. Base legal padrão da empresa: a que o banco aplica aos contatos novos quando ninguém escolhe outra (pela tela, pela
-- importação ou pelas integrações). Sem consentimento: consentimento é de cada pessoa e exige o registro de como ela
-- consentiu (art. 8º, § 2º); como padrão, todo contato importado pareceria consentido. Donos e administradores mudam o
-- padrão (a política org_update já exige can_manage), com a data e o autor carimbados pelo gatilho abaixo; o cliente
-- não os envia (fora do GRANT por coluna). FK composta (autor, organização) → perfis da mesma organização, sem ON
-- DELETE, como os demais autores.
alter table public.organizations
 add column default_legal_basis text not null default 'not_informed',
 add column default_legal_basis_at timestamptz,
 add column default_legal_basis_by uuid;
alter table public.organizations
 add constraint organizations_default_legal_basis_valid
  check(default_legal_basis in ('not_informed','contract','legitimate_interest','legal_obligation','exercise_of_rights')),
 add constraint organizations_default_legal_basis_at_finite check(isfinite(default_legal_basis_at)),
 add constraint organizations_default_legal_basis_by_id_fkey foreign key(default_legal_basis_by,id) references public.profiles(id,org_id);
create index organizations_default_legal_basis_by_id_fkey_idx on public.organizations(default_legal_basis_by,id);
grant update(default_legal_basis) on public.organizations to authenticated;

-- Carimbo do padrão: mudar o padrão grava a data e quem mudou; editar o nome mantém o carimbo. Na criação
-- (provision_organization), o padrão "não informada" nasce sem carimbo. BEFORE, em ordem alfabética: depois de
-- protect_record_metadata.
create function private.stamp_default_legal_basis() returns trigger language plpgsql set search_path='' as $$
 begin
 if tg_op='INSERT' then
  if new.default_legal_basis='not_informed' then
   new.default_legal_basis_at=null;
   new.default_legal_basis_by=null;
  else
   new.default_legal_basis_at=now();
   new.default_legal_basis_by=(select auth.uid());
  end if;
 elsif new.default_legal_basis is distinct from old.default_legal_basis then
  new.default_legal_basis_at=now();
  new.default_legal_basis_by=(select auth.uid());
 else
  new.default_legal_basis_at=old.default_legal_basis_at;
  new.default_legal_basis_by=old.default_legal_basis_by;
 end if;
 return new;
 end;
$$;
create trigger stamp_default_legal_basis before insert or update on public.organizations
 for each row execute function private.stamp_default_legal_basis();

-- 3. Contatos: a base legal (seis valores; "não informada" é o padrão da coluna e, na inserção, quer dizer "use o padrão
-- da empresa"), o registro dela (como e quando a pessoa consentiu, o contrato, o pedido de orçamento; até 500
-- caracteres, aparado pelo gatilho), a data e o autor carimbados pelo gatilho, e a anonimização (data e autor, só pela
-- RPC). O consentimento exige o registro; o contato anonimizado perde o registro e mantém a base. Sem índice em
-- legal_basis nem em anonymized_at: as telas leem pelo snapshot, e os filtros são do 2B.2; os índices das FKs seguem a
-- regra da base. Empresas não ganham base legal: a LGPD protege pessoas naturais.
alter table public.contacts
 add column legal_basis text not null default 'not_informed',
 add column legal_basis_note text,
 add column legal_basis_at timestamptz,
 add column legal_basis_by uuid,
 add column anonymized_at timestamptz,
 add column anonymized_by uuid;
alter table public.contacts
 add constraint contacts_legal_basis_valid
  check(legal_basis in ('not_informed','consent','contract','legitimate_interest','legal_obligation','exercise_of_rights')),
 add constraint contacts_legal_basis_note_length check(legal_basis_note is null or length(legal_basis_note)<=500),
 add constraint contacts_legal_basis_consent_note check(legal_basis<>'consent' or legal_basis_note is not null or anonymized_at is not null),
 add constraint contacts_legal_basis_at_finite check(isfinite(legal_basis_at)),
 add constraint contacts_anonymized_at_finite check(isfinite(anonymized_at)),
 add constraint contacts_anonymized_by_needs_at check(anonymized_by is null or anonymized_at is not null),
 add constraint contacts_legal_basis_by_org_id_fkey foreign key(legal_basis_by,org_id) references public.profiles(id,org_id),
 add constraint contacts_anonymized_by_org_id_fkey foreign key(anonymized_by,org_id) references public.profiles(id,org_id);
create index contacts_legal_basis_by_org_id_fkey_idx on public.contacts(legal_basis_by,org_id);
create index contacts_anonymized_by_org_id_fkey_idx on public.contacts(anonymized_by,org_id);

-- 4. Gatilhos de contacts. Marca da anonimização em andamento: private.anonymize_contact liga
-- set_config('crm.anonymizing_contact', <id do contato>, true) depois de conferir a versão e a desliga logo depois do
-- UPDATE final do contato. Os gatilhos de contacts comparam a marca com o id da linha: o contato da pessoa, no UPDATE
-- final, é tratado como anonimização; os demais contatos, com a marca ligada, só recebem a troca dos termos dela nos
-- campos de texto (a varredura do item 4 da anonimização), e os carimbos deles ficam como estavam. Vale só na
-- transação, como a guarda crm.bulk_move do 0.7, e o PostgREST não deixa um cliente gravar parâmetros da sessão. Ordem
-- dos BEFORE (alfabética): protect_anonymized_contact, protect_record_metadata, refuse_inactive_assignee,
-- stamp_do_not_contact, stamp_legal_basis, touch_updated_at.

-- Base legal carimbada pelo banco. Na inserção, "não informada" (ou nenhuma) recebe o padrão da empresa, lido na hora:
-- mudar o padrão não altera contatos já gravados. A data e o autor (auth.uid(); nulo pela chave service_role e pelo
-- editor SQL) vêm daqui, e os enviados pelo cliente são ignorados. Mudar a base ou o registro carimba de novo; editar
-- outro campo mantém o registro e o carimbo como estavam. Na anonimização, a base fica, o registro sai (no UPDATE da
-- RPC) e o carimbo não muda. Na varredura da anonimização de outra pessoa, o registro recebe a troca dos termos dela, e
-- o carimbo também não muda: ele é a prova de quando e por quem a base foi registrada. SECURITY DEFINER: lê o padrão da
-- organização sem depender da RLS.
create function private.stamp_legal_basis() returns trigger language plpgsql security definer set search_path='' as $$
 declare
  v_default text;
  v_anonymizing text:=coalesce(current_setting('crm.anonymizing_contact',true),'');
 begin
 if v_anonymizing=new.id::text then return new; end if;
 if v_anonymizing<>'' and tg_op='UPDATE' then
  new.legal_basis_at=old.legal_basis_at;
  new.legal_basis_by=old.legal_basis_by;
  return new;
 end if;
 if tg_op='INSERT' then
  if coalesce(new.legal_basis,'not_informed')='not_informed' then
   select o.default_legal_basis into v_default from public.organizations o where o.id=new.org_id;
   new.legal_basis=coalesce(v_default,'not_informed');
  end if;
  new.legal_basis_note=nullif(btrim(new.legal_basis_note),'');
  new.legal_basis_at=now();
  new.legal_basis_by=(select auth.uid());
 elsif new.legal_basis is distinct from old.legal_basis
  or nullif(btrim(new.legal_basis_note),'') is distinct from old.legal_basis_note then
  new.legal_basis_note=nullif(btrim(new.legal_basis_note),'');
  new.legal_basis_at=now();
  new.legal_basis_by=(select auth.uid());
 else
  new.legal_basis_note=old.legal_basis_note;
  new.legal_basis_at=old.legal_basis_at;
  new.legal_basis_by=old.legal_basis_by;
 end if;
 return new;
 end;
$$;
create trigger stamp_legal_basis before insert or update on public.contacts
 for each row execute function private.stamp_legal_basis();

-- O cadastro anonimizado fica, congelado: um gatilho recusa devolver dado pessoal a ele. Só a RPC anonimiza: valores de
-- anonymized_at e anonymized_by enviados pelo cliente são ignorados, como os demais carimbos. Responsável e situação
-- continuam mudando (a passagem de carteira do 1.2 e a situação comercial); do_not_contact_reason não entra na lista
-- porque stamp_do_not_contact já devolve o motivo antigo, nulo, quando a marca não muda. Durante a anonimização de
-- outra pessoa (a marca ligada com o id dela), a varredura pode trocar os termos dela nos campos de texto de um contato
-- já anonimizado (a origem dele pode citá-la); o resto continua congelado. SECURITY INVOKER e sem private.*: a chave
-- service_role grava contatos.
create function private.protect_anonymized_contact() returns trigger language plpgsql set search_path='' as $$
 declare v_anonymizing text:=coalesce(current_setting('crm.anonymizing_contact',true),'');
 begin
 if tg_op='INSERT' then
  new.anonymized_at=null;
  new.anonymized_by=null;
  return new;
 end if;
 if old.anonymized_at is null then
  if v_anonymizing<>new.id::text then
   new.anonymized_at=null;
   new.anonymized_by=null;
  end if;
  return new;
 end if;
 if row(new.first_name,new.last_name,new.email,new.phone,new.company_id,new.do_not_contact,new.legal_basis,
        new.anonymized_at,new.anonymized_by)
    is distinct from
    row(old.first_name,old.last_name,old.email,old.phone,old.company_id,old.do_not_contact,old.legal_basis,
        old.anonymized_at,old.anonymized_by)
  or (v_anonymizing='' and row(new.job_title,new.notes,new.source,new.legal_basis_note)
      is distinct from row(old.job_title,old.notes,old.source,old.legal_basis_note)) then
  raise exception 'Este contato foi anonimizado e não recebe mais dados pessoais. Para um novo relacionamento com a pessoa, cadastre um novo contato.';
 end if;
 return new;
 end;
$$;
create trigger protect_anonymized_contact before insert or update on public.contacts
 for each row execute function private.protect_anonymized_contact();

-- "Não contatar" (1.9) com um único ramo novo, para a anonimização em andamento: a data e o autor da marca ficam; no
-- contato da pessoa, o motivo sai, e nos demais contatos e empresas (a varredura do item 4) o motivo recebe a troca dos
-- termos dela. Com a marca desligada antes, a anonimização a liga pelo primeiro ramo, com a data e o autor de quem
-- anonimiza. O resto é igual a 20261013110000_channel_interactions.sql, inclusive o IF aninhado de can_manage
-- (preparar private.can_manage() exige USAGE em private, que a service_role não tem). create or replace mantém os
-- grants e os dois gatilhos.
create or replace function private.stamp_do_not_contact() returns trigger language plpgsql set search_path='' as $$
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
 elsif coalesce(current_setting('crm.anonymizing_contact',true),'')<>'' then
  new.do_not_contact_at=old.do_not_contact_at;
  new.do_not_contact_by=old.do_not_contact_by;
  if tg_table_name='contacts' and current_setting('crm.anonymizing_contact',true)=new.id::text then
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

-- 5. Atividades, oportunidades e recebimentos diante do contato anonimizado: nada novo se liga a ele (inserção ou troca
-- de contato), e as atividades que ficaram com ele não voltam a ter texto nem a ficar pendentes. Desvincular (contato
-- nulo), trocar a oportunidade (delete_deal faz isso), a empresa ou o responsável passam. A trava FOR KEY SHARE é a
-- mesma da FK: não espera quem só edita o contato (FOR NO KEY UPDATE), mas espera a anonimização, que trava o contato
-- com FOR UPDATE; depois do commit dela, a releitura (READ COMMITTED) vê o contato anonimizado e recusa. Durante uma
-- anonimização (a marca crm.anonymizing_contact ligada), a troca de termos alcança também uma atividade de outro contato
-- já anonimizado que cite a pessoa: a troca só põe "[anonimizado]" no lugar dos termos. SECURITY DEFINER: a trava de
-- linha exige o privilégio de UPDATE e a RLS de atualização, e o dono do banco tem os dois. BEFORE, em ordem
-- alfabética: o primeiro gatilho das três tabelas.
create function private.guard_anonymized_contact() returns trigger language plpgsql security definer set search_path='' as $$
 declare v_at timestamptz;
 begin
 if new.contact_id is not null and (tg_op='INSERT' or new.contact_id is distinct from old.contact_id) then
  select c.anonymized_at into v_at from public.contacts c where c.id=new.contact_id and c.org_id=new.org_id for key share;
  if v_at is not null then
   raise exception 'Este contato foi anonimizado e não recebe novos registros. Para um novo relacionamento com a pessoa, cadastre um novo contato.';
  end if;
 end if;
 -- O IF aninhado não é estilo: o PL/pgSQL prepara a expressão inteira, e new.body só existe em activities.
 if tg_table_name='activities' then
  if tg_op='UPDATE' and old.contact_id is not null and coalesce(current_setting('crm.anonymizing_contact',true),'')=''
   and new.contact_id is not distinct from old.contact_id
   and row(new.title,new.body,new.type,new.outcome,new.due_date,new.end_date,new.completed_at)
       is distinct from row(old.title,old.body,old.type,old.outcome,old.due_date,old.end_date,old.completed_at) then
   select c.anonymized_at into v_at from public.contacts c where c.id=old.contact_id and c.org_id=old.org_id;
   if v_at is not null then
    raise exception 'Esta atividade é de um contato anonimizado e não pode ser editada nem reaberta.';
   end if;
  end if;
 end if;
 return new;
 end;
$$;
create trigger guard_anonymized_contact before insert or update on public.activities
 for each row execute function private.guard_anonymized_contact();
create trigger guard_anonymized_contact before insert or update on public.deals
 for each row execute function private.guard_anonymized_contact();
create trigger guard_anonymized_contact before insert or update on public.payments
 for each row execute function private.guard_anonymized_contact();

-- Ação de contato planejada para quem pediu "Não contatar": criar ou reabrir uma atividade pendente de ligação,
-- WhatsApp, e-mail, reunião ou visita para um contato marcado é recusado; sem contato na atividade, para uma empresa
-- marcada, só ligação e WhatsApp, que usam o telefone dela (a marca da empresa não alcança os contatos, como no 1.9).
-- Passam as tarefas (trabalho interno, inclusive as das automações e do receptor da Fecha IA), as notas, o registro do
-- que já aconteceu (atividade concluída) e a edição de uma ação que já existia e continua a mesma ação, com o mesmo
-- alvo: reagendar, trocar o título, os detalhes ou o responsável (a passagem de carteira do 1.2 só troca user_id). A
-- marca não apaga nem trava o que já estava na agenda. Marcar "Não contatar" (FOR NO KEY UPDATE) não espera a trava
-- FOR KEY SHARE daqui. SECURITY DEFINER: lê a marca sem depender da RLS e vale também para a chave service_role.
-- BEFORE, em ordem alfabética: depois de record_activity_author e antes de refuse_inactive_assignee.
create function private.refuse_do_not_contact_action() returns trigger language plpgsql security definer set search_path='' as $$
 declare v_marked boolean;
 begin
 if new.completed_at is not null or new.type not in ('call','whatsapp','email','meeting','visit') then return new; end if;
 if tg_op='UPDATE' and old.completed_at is null and new.type is not distinct from old.type
  and new.contact_id is not distinct from old.contact_id and new.company_id is not distinct from old.company_id then
  return new;
 end if;
 if new.contact_id is not null then
  select c.do_not_contact into v_marked from public.contacts c where c.id=new.contact_id and c.org_id=new.org_id for key share;
  if coalesce(v_marked,false) then
   raise exception 'Este contato está marcado como “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. Registre como concluído o que já aconteceu, ou use uma tarefa para o trabalho interno.';
  end if;
 elsif new.company_id is not null and new.type in ('call','whatsapp') then
  select co.do_not_contact into v_marked from public.companies co where co.id=new.company_id and co.org_id=new.org_id for key share;
  if coalesce(v_marked,false) then
   raise exception 'Esta empresa está marcada como “Não contatar”: o CRM não agenda ligação nem WhatsApp para o telefone dela. Use o contato de uma pessoa liberada, ou uma tarefa.';
  end if;
 end if;
 return new;
 end;
$$;
create trigger refuse_do_not_contact_action before insert or update on public.activities
 for each row execute function private.refuse_do_not_contact_action();

-- 6. Registro das ações de privacidade: uma linha por exportação e por anonimização, com quem fez, quando, o id do
-- contato e as contagens, sem nome, e-mail nem texto do titular. audit_logs é escrita só pelo gatilho genérico, com o
-- CHECK de create/update/delete e os nomes de campos: a exportação é uma leitura e as contagens não cabem lá (o mesmo
-- motivo de portfolio_transfers no 1.2). Append-only: só as RPCs gravam, e nenhum papel da API grava, altera ou exclui.
-- Excluir um contato sem vínculos depois de exportá-lo mantém o registro, sem o vínculo (ON DELETE SET NULL só na
-- coluna, PostgreSQL 15+, como automation_logs desde o 0.7).
create table public.privacy_actions(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id),
 contact_id uuid,
 action text not null check(action in ('export','anonymize')),
 performed_by uuid,
 summary jsonb not null default '{}'::jsonb check(jsonb_typeof(summary)='object'),
 created_at timestamptz not null default now(),
 constraint privacy_actions_created_at_finite check(isfinite(created_at)),
 constraint privacy_actions_contact_id_org_id_fkey foreign key(contact_id,org_id)
  references public.contacts(id,org_id) on delete set null (contact_id),
 constraint privacy_actions_performed_by_org_id_fkey foreign key(performed_by,org_id) references public.profiles(id,org_id)
);
-- O Supabase hospedado concede tudo por privilégio padrão (simulado em supabase/tests/local-bootstrap.sql): tira tudo
-- e devolve só a leitura, para donos e administradores da organização.
revoke all on public.privacy_actions from public,anon,authenticated;
alter table public.privacy_actions enable row level security;
grant select on public.privacy_actions to authenticated;
create policy privacy_actions_manager_read on public.privacy_actions for select to authenticated
 using(org_id=(select private.current_org()) and (select private.can_manage()));
-- "Segurança" pagina por data, a ficha lê o último registro do contato, e a regra da base de indexar toda FK.
create index privacy_actions_org_time on public.privacy_actions(org_id,created_at desc);
create index privacy_actions_contact_id_org_id_fkey_idx on public.privacy_actions(contact_id,org_id);
create index privacy_actions_performed_by_org_id_fkey_idx on public.privacy_actions(performed_by,org_id);

-- 7. RPCs, no padrão da base: a pública SECURITY INVOKER chama a privada SECURITY DEFINER, que confere o papel
-- (só donos e administradores: são atos da controladora em resposta a um pedido do titular) e a organização.

-- O que a anonimização fará, com os mesmos predicados dela: os registros da pessoa (as atividades com ela, as
-- oportunidades dela e os recebimentos dela e dessas oportunidades), as atividades dessas oportunidades com outros
-- contatos que citam a pessoa, e o resto da organização que cita o nome completo, o e-mail ou o telefone (inclusive a
-- origem, o cargo, o registro da base legal e o motivo do "Não contatar" de outros contatos, e o motivo das empresas).
create function private.contact_privacy_counts(p_org uuid,p_contact public.contacts) returns jsonb language plpgsql stable set search_path='' as $$
 declare
  v_deals uuid[];
  v_all text:=private.contact_privacy_regex(p_contact.first_name,p_contact.last_name,p_contact.email,p_contact.phone,false);
  v_strong text:=private.contact_privacy_regex(p_contact.first_name,p_contact.last_name,p_contact.email,p_contact.phone,true);
  v_other integer;
 begin
 select coalesce(array_agg(d.id),'{}') into v_deals from public.deals d where d.org_id=p_org and d.contact_id=p_contact.id;
 v_other:=(select count(*) from public.activities a where a.org_id=p_org and a.contact_id is distinct from p_contact.id
   and a.deal_id=any(v_deals) and (a.title ~* v_all or a.body ~* v_all));
 if v_strong is not null then
  v_other:=v_other
   +(select count(*) from public.activities a where a.org_id=p_org and a.contact_id is distinct from p_contact.id
     and (a.deal_id is null or not a.deal_id=any(v_deals)) and (a.title ~* v_strong or a.body ~* v_strong))
   +(select count(*) from public.deals d where d.org_id=p_org and not d.id=any(v_deals)
     and (d.title ~* v_strong or d.lost_reason ~* v_strong))
   +(select count(*) from public.payments p where p.org_id=p_org and p.contact_id is distinct from p_contact.id
     and (p.deal_id is null or not p.deal_id=any(v_deals)) and p.description ~* v_strong)
   +(select count(*) from public.contacts c where c.org_id=p_org and c.id<>p_contact.id
     and (c.notes ~* v_strong or c.source ~* v_strong or c.job_title ~* v_strong or c.legal_basis_note ~* v_strong
      or c.do_not_contact_reason ~* v_strong))
   +(select count(*) from public.companies co where co.org_id=p_org and co.do_not_contact_reason ~* v_strong);
 end if;
 return jsonb_build_object(
  'activities_scrubbed',(select count(*) from public.activities a where a.org_id=p_org and a.contact_id=p_contact.id
    and (a.completed_at is not null or a.type='note')),
  'activities_deleted',(select count(*) from public.activities a where a.org_id=p_org and a.contact_id=p_contact.id
    and a.completed_at is null and a.type<>'note'),
  'deals',cardinality(v_deals),
  'open_deals',(select count(*) from public.deals d where d.org_id=p_org and d.id=any(v_deals) and d.status='open'),
  'payments',(select count(*) from public.payments p where p.org_id=p_org and (p.contact_id=p_contact.id or p.deal_id=any(v_deals))),
  'pending_payments',(select count(*) from public.payments p where p.org_id=p_org
    and (p.contact_id=p_contact.id or p.deal_id=any(v_deals)) and p.status='pending'),
  'other_records',v_other);
 end;
$$;

-- Resumo para o diálogo de anonimização: a versão lida (updated_at, com os microssegundos, como a tela manda a versão
-- desde o 0.6) e as contagens. Para um contato já anonimizado, a data e contagens zeradas (a tela não oferece de novo).
create function private.contact_privacy_summary(p_contact_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare v_org uuid; v_contact public.contacts;
 begin
 v_org:=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores anonimizam contatos.';
 end if;
 select * into v_contact from public.contacts c where c.id=p_contact_id and c.org_id=v_org;
 if not found then raise exception 'Este contato não está mais disponível. Atualize a página.'; end if;
 if v_contact.anonymized_at is not null then
  return jsonb_build_object('version',v_contact.updated_at,'anonymized_at',v_contact.anonymized_at,
   'activities_scrubbed',0,'activities_deleted',0,'deals',0,'open_deals',0,'payments',0,'pending_payments',0,'other_records',0);
 end if;
 return jsonb_build_object('version',v_contact.updated_at,'anonymized_at',null)
  ||private.contact_privacy_counts(v_org,v_contact);
 end;
$$;
create function public.contact_privacy_summary(p_contact_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select private.contact_privacy_summary(p_contact_id);
$$;

-- Anonimização, irreversível, numa transação: qualquer falha desfaz tudo, e o contato continua como estava.
-- Travas (seção 6 do desenho): primeiro o que aponta para o contato, na ordem de delete_deal (oportunidades,
-- atividades, recebimentos), e por último o contato, com FOR UPDATE, que conflita com o FOR KEY SHARE dos gatilhos e das
-- FKs. Assim, quem segura uma atividade da pessoa e cria a próxima ação para ela (complete_activity) termina antes, e a
-- próxima ação é excluída aqui; com a ordem inversa, as duas se esperariam. Depois da trava do contato, as instruções
-- releem tudo (READ COMMITTED): entra o que foi ligado à pessoa enquanto as travas eram tomadas.
-- Os UPDATE e o DELETE passam pelos gatilhos de sempre: a auditoria grava uma linha por registro, com o autor;
-- touch_updated_at renova a versão; record_deal_change e run_deal_automations não disparam (etapa e situação não mudam);
-- validate_deal_change mantém closed_at e a probabilidade.
create function private.anonymize_contact(p_contact_id uuid,p_version timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
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
   legal_basis_note=left(private.redact_personal_terms(c.legal_basis_note,v_strong),500),
   do_not_contact_reason=left(private.redact_personal_terms(c.do_not_contact_reason,v_strong),500)
   where c.org_id=v_org and c.id<>p_contact_id
    and (c.notes ~* v_strong or c.source ~* v_strong or c.job_title ~* v_strong or c.legal_basis_note ~* v_strong
     or c.do_not_contact_reason ~* v_strong);
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
  update public.companies co set do_not_contact_reason=left(private.redact_personal_terms(co.do_not_contact_reason,v_strong),500)
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
-- statement_timeout de 60 s, como as RPCs de carteira do 1.2: a varredura do item 4 percorre a organização, e o padrão
-- de authenticated é 8 s. Acima do limite, a RPC falha inteira, sem mudar nada.
create function public.anonymize_contact(p_contact_id uuid,p_version timestamptz) returns jsonb language sql security invoker set search_path='' set statement_timeout='60s' as $$
 select private.anonymize_contact(p_contact_id,p_version);
$$;

-- Exportação para o pedido de acesso do titular: o contato (com a base legal, o registro, a marca e a anonimização), a
-- empresa vinculada (id e nome), as atividades com a pessoa e as das oportunidades dela (pela data do fato; relation diz
-- se a atividade é com a pessoa, com outro contato ou sem contato: são os mesmos registros que a anonimização trata
-- como dela), as oportunidades dela (com o funil e a etapa) e os recebimentos dela e das oportunidades dela. Nos
-- registros das oportunidades dela ligados a OUTRO contato, o título, os detalhes e a descrição passam pela troca dos
-- termos desse contato (o nome, o sobrenome, cada palavra do nome, o e-mail e o telefone, como na anonimização dele):
-- o registro de interação do 1.9 grava "Ligação para <nome>" e anotações com o telefone, e esses dados são do outro
-- contato, e não do titular. O resto do texto vai como está, e a tela pede a revisão antes do envio; um contato já
-- anonimizado não tem mais termos a trocar. O vínculo diz só "outro contato", sem o id nem o nome dele. Sem dados da
-- equipe (responsável, autor, quem marcou, quem registrou a base, quem anonimizou: são dados dos funcionários da
-- controladora) e sem a probabilidade, que é estratégia comercial. O registro em privacy_actions é gravado na mesma
-- transação da leitura, antes de o arquivo existir.
create function private.export_contact_data(p_contact_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
 declare
  v_org uuid;
  v_contact public.contacts;
  v_deals uuid[];
  v_activities jsonb;
  v_deal_rows jsonb;
  v_payments jsonb;
 begin
 v_org:=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores exportam os dados de um contato.';
 end if;
 select * into v_contact from public.contacts c where c.id=p_contact_id and c.org_id=v_org;
 if not found then raise exception 'Este contato não está mais disponível. Atualize a página.'; end if;
 select coalesce(array_agg(d.id),'{}') into v_deals from public.deals d where d.org_id=v_org and d.contact_id=p_contact_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'type',a.type,'title',private.redact_personal_terms(a.title,o.terms),
   'body',private.redact_personal_terms(a.body,o.terms),'due_date',a.due_date,
   'end_date',a.end_date,'completed_at',a.completed_at,'outcome',a.outcome,'created_at',a.created_at,'deal_id',a.deal_id,
   'relation',case when a.contact_id=p_contact_id then 'person' when a.contact_id is null then 'no_contact' else 'other_contact' end)
   order by coalesce(a.completed_at,a.due_date,a.created_at),a.id),'[]'::jsonb)
  into v_activities from public.activities a
  left join lateral (select private.contact_privacy_regex(oc.first_name,oc.last_name,oc.email,oc.phone,false) as terms
   from public.contacts oc where oc.id=a.contact_id and oc.org_id=a.org_id and oc.id<>p_contact_id and oc.anonymized_at is null) o on true
  where a.org_id=v_org and (a.contact_id=p_contact_id or a.deal_id=any(v_deals));
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'value',d.value,'currency',d.currency,'status',d.status,
   'pipeline',pl.name,'stage',st.name,'close_date',d.close_date,'closed_at',d.closed_at,'lost_reason',d.lost_reason,
   'created_at',d.created_at) order by d.created_at,d.id),'[]'::jsonb)
  into v_deal_rows from public.deals d
  left join public.pipelines pl on pl.id=d.pipeline_id and pl.org_id=d.org_id
  left join public.pipeline_stages st on st.id=d.stage_id and st.org_id=d.org_id
  where d.org_id=v_org and d.id=any(v_deals);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'description',private.redact_personal_terms(p.description,o.terms),
   'amount',p.amount,'currency',p.currency,
   'status',p.status,'due_date',p.due_date,'paid_at',p.paid_at,'deal_id',p.deal_id,'created_at',p.created_at)
   order by p.due_date,p.created_at,p.id),'[]'::jsonb)
  into v_payments from public.payments p
  left join lateral (select private.contact_privacy_regex(oc.first_name,oc.last_name,oc.email,oc.phone,false) as terms
   from public.contacts oc where oc.id=p.contact_id and oc.org_id=p.org_id and oc.id<>p_contact_id and oc.anonymized_at is null) o on true
  where p.org_id=v_org and (p.contact_id=p_contact_id or p.deal_id=any(v_deals));
 insert into public.privacy_actions(org_id,contact_id,action,performed_by,summary)
  values(v_org,p_contact_id,'export',auth.uid(),jsonb_build_object('activities',jsonb_array_length(v_activities),
   'deals',jsonb_array_length(v_deal_rows),'payments',jsonb_array_length(v_payments)));
 return jsonb_build_object(
  'format',1,
  'generated_at',now(),
  'organization',(select jsonb_build_object('name',o.name) from public.organizations o where o.id=v_org),
  'contact',jsonb_build_object('id',v_contact.id,'first_name',v_contact.first_name,'last_name',v_contact.last_name,
   'email',v_contact.email,'phone',v_contact.phone,'job_title',v_contact.job_title,'source',v_contact.source,
   'notes',v_contact.notes,'status',v_contact.status,'created_at',v_contact.created_at,'updated_at',v_contact.updated_at,
   'legal_basis',v_contact.legal_basis,'legal_basis_note',v_contact.legal_basis_note,'legal_basis_at',v_contact.legal_basis_at,
   'do_not_contact',v_contact.do_not_contact,'do_not_contact_at',v_contact.do_not_contact_at,
   'do_not_contact_reason',v_contact.do_not_contact_reason,'anonymized_at',v_contact.anonymized_at),
  'company',(select jsonb_build_object('id',co.id,'name',co.name) from public.companies co
   where co.id=v_contact.company_id and co.org_id=v_org),
  'activities',v_activities,
  'deals',v_deal_rows,
  'payments',v_payments);
 end;
$$;
create function public.export_contact_data(p_contact_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select private.export_contact_data(p_contact_id);
$$;

-- 8. Execução: as RPCs para authenticated (nunca anon; anon tem USAGE em private desde o 1.1, e instance_status continua
-- a única função de private que ele executa); as funções puras, de contagem e de gatilho para nenhum papel da API, só
-- para as funções SECURITY DEFINER do dono do banco que as chamam.
revoke execute on function private.privacy_term_regex(text),private.privacy_phone_regex(text),
 private.contact_privacy_regex(text,text,text,text,boolean),private.redact_personal_terms(text,text),
 private.contact_privacy_counts(uuid,public.contacts),private.stamp_default_legal_basis(),private.stamp_legal_basis(),
 private.protect_anonymized_contact(),private.guard_anonymized_contact(),private.refuse_do_not_contact_action()
 from public,anon,authenticated,service_role;
revoke execute on function private.contact_privacy_summary(uuid),private.anonymize_contact(uuid,timestamptz),private.export_contact_data(uuid),
 public.contact_privacy_summary(uuid),public.anonymize_contact(uuid,timestamptz),public.export_contact_data(uuid) from public,anon;
grant execute on function private.contact_privacy_summary(uuid),private.anonymize_contact(uuid,timestamptz),private.export_contact_data(uuid),
 public.contact_privacy_summary(uuid),public.anonymize_contact(uuid,timestamptz),public.export_contact_data(uuid) to authenticated;
