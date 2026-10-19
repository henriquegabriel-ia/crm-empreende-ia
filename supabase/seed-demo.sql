-- Dados de demonstração do CRM (item 1.15 do roteiro; docs/arquitetura/1.15.md).
-- ARQUIVO GERADO por `npm run seed:demo` a partir de scripts/lib/demo-seed.mjs: não edite à mão.
--
-- Para que serve: encher um CRM vazio com dados fictícios (empresas, contatos, oportunidades com itens do catálogo,
-- atividades de WhatsApp, e-mail, ligação e visita, recebimentos, automações e modelos) para aulas e para o beta.
-- Nada é dado real: e-mails e sites em example.test e celulares "(DDD) 90000-NNNN", que não são de ninguém conhecido.
-- Mesmo assim, não envie mensagens a esses números pelo botão "WhatsApp".
--
-- Quando NÃO usar: num CRM com dados reais ou que vai receber dados reais misturados aos de demonstração. O seed
-- recusa e não grava nada se o CRM já tiver qualquer contato, empresa, oportunidade, atividade, recebimento, item do
-- catálogo, automação ou modelo.
--
-- Como rodar:
--   1. Publique o CRM e faça o primeiro cadastro: ele cria a empresa e o papel de Dono (o seed não cria contas).
--   2. Opcional: convide a equipe e espere os convites serem aceitos. Os dados se dividem entre as pessoas ativas
--      (Dono, administradores e colaboradores), em rodízio; com só o Dono, tudo fica com ele.
--   3. No painel do Supabase do projeto, abra "SQL Editor", "New query", cole este arquivo inteiro e clique em "Run".
--      Rode durante o dia: a atividade "do dia" vence até a meia-noite de Brasília.
--   4. O resultado é uma linha "Dados de demonstração criados" com as contagens. Atualize o CRM no navegador.
-- As datas são relativas ao momento da execução: contatos de ontem, oportunidades ganhas nos últimos meses, atividades
-- vencidas, de hoje e futuras.
--
-- Nunca rode este arquivo pelo navegador, pelo app ou pela API: ele usa funções internas do banco e só funciona no
-- editor SQL do painel (papel postgres).
--
-- Para apagar a demonstração depois: supabase/seed-demo-remove.sql, do mesmo jeito.

do $seed$
declare
 v_now timestamptz:=now();
 v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
 v_end_of_day timestamptz;
 v_due_today timestamptz;
 v_org uuid;
 v_owner uuid;
 v_members uuid[];
 v_pipeline uuid;
 v_stages uuid[];
 v_existing text;
begin
 -- 1. Só no editor SQL do painel (papel postgres), nunca por uma sessão da API.
 if current_user in ('anon','authenticated','service_role') or coalesce(current_setting('request.jwt.claims',true),'')<>'' then
  raise exception 'O seed de demonstração roda só no editor SQL do painel do Supabase. Nada foi gravado.';
 end if;
 -- Duas execuções ao mesmo tempo: a segunda espera a primeira e, depois, encontra os dados e recusa.
 perform pg_advisory_xact_lock(hashtextextended('crm.demo_seed',0));

 -- 2. A empresa e o Dono que já existem (admissão do item 1.1: o seed não cria contas).
 if not exists(select 1 from public.organizations) then
  raise exception 'Este CRM ainda não tem empresa. Primeiro publique o CRM e faça o primeiro cadastro, que cria a empresa e o papel de Dono; depois rode o seed de novo. Nada foi gravado.';
 end if;
 if (select count(*) from public.organizations)>1 then
  raise exception 'Este CRM tem mais de uma empresa. O seed de demonstração é para um CRM com uma empresa só. Nada foi gravado.';
 end if;
 select o.id into v_org from public.organizations o;
 select array_agg(r.user_id order by r.role<>'owner',r.role<>'admin',p.created_at,r.user_id) into v_members
  from public.user_roles r join public.profiles p on p.id=r.user_id
  where r.org_id=v_org and r.deactivated_at is null and r.role in ('owner','admin','member');
 select r.user_id into v_owner from public.user_roles r join public.profiles p on p.id=r.user_id
  where r.org_id=v_org and r.deactivated_at is null and r.role='owner' order by p.created_at,r.user_id limit 1;
 if v_owner is null then
  raise exception 'Este CRM não tem um Dono ativo. Recupere o acesso do Dono (docs/RECUPERAR-ACESSO-DONO.md) e rode o seed de novo. Nada foi gravado.';
 end if;

 -- 3. Só numa instância vazia: nenhum registro comercial.
 select string_agg(format('%s %s',n,label),', ') into v_existing from (values
   ((select count(*) from public.contacts where org_id=v_org),'contato(s)'),
   ((select count(*) from public.companies where org_id=v_org),'empresa(s)'),
   ((select count(*) from public.deals where org_id=v_org),'oportunidade(s)'),
   ((select count(*) from public.activities where org_id=v_org),'atividade(s)'),
   ((select count(*) from public.payments where org_id=v_org),'recebimento(s)'),
   ((select count(*) from public.products where org_id=v_org),'item(ns) do catálogo'),
   ((select count(*) from public.automations where org_id=v_org),'automação(ões)'),
   ((select count(*) from public.email_templates where org_id=v_org),'modelo(s)')
  ) t(n,label) where n>0;
 if v_existing is not null then
  raise exception 'Este CRM já tem dados (%). O seed de demonstração só roda num CRM vazio, para não misturar dados fictícios com dados reais. Nada foi gravado.',v_existing;
 end if;
 select p.id into v_pipeline from public.pipelines p where p.org_id=v_org order by p.is_default desc,p.created_at,p.id limit 1;
 select array_agg(s.id order by s."order",s.created_at,s.id) into v_stages from public.pipeline_stages s
  where s.org_id=v_org and s.pipeline_id=v_pipeline;
 if v_pipeline is null or coalesce(array_length(v_stages,1),0)<2 then
  raise exception 'O funil padrão precisa de pelo menos duas etapas. Confira em "Configurações", na aba "Funis", e rode o seed de novo. Nada foi gravado.';
 end if;
 v_end_of_day:=((v_today+1)::timestamp) at time zone 'America/Sao_Paulo';
 v_due_today:=v_now+(v_end_of_day-v_now)/2;

 -- 4. As gravações como o Dono: os gatilhos carimbam autor, base legal, "Não contatar" e auditoria com ele, e as
 -- funções privadas (save_deal, anonymize_contact, move_deal) conferem o papel dele.
 perform set_config('request.jwt.claims',json_build_object('sub',v_owner,'role','authenticated')::text,true);

 insert into public.pipelines(id,org_id,name,is_default) values('2f860930-4560-42c8-a2a0-cc109b7cd66e',v_org,'Parcerias',false);
 insert into public.pipeline_stages(id,org_id,pipeline_id,name,"order",win_probability)
  select v.id::uuid,v_org,'2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,v.name,v.ord,v.probability from (values
   ('3439edcb-2ec3-4f40-a078-cc412959cb02','Primeiro contato',0,20),
   ('7d9de047-8671-4dd5-918b-f9567003390c','Proposta enviada',1,50),
   ('39f05f4b-5159-41e6-b1c7-8bfb235cbe2d','Contrato',2,85)
  ) v(id,name,ord,probability);

 insert into public.products(id,org_id,name,code,kind,unit,price,billing)
  select v.id::uuid,v_org,v.name,v.code,v.kind,v.unit,v.price::numeric,v.billing from (values
   ('3e441001-9025-4649-8918-247fe1148322','Implantação do CRM','SRV-IMP','service','projeto','3500.00','one_time'),
   ('ae86cf68-7d10-46b0-b065-01d226b95dd6','Consultoria mensal','SRV-CON','service','mês','1200.00','monthly'),
   ('4f8df8b5-f496-4659-b03b-c69c9336a70e','Treinamento da equipe','SRV-TRE','service','hora','180.00','one_time'),
   ('4f5b60d7-3aa9-459a-ac20-31296db6c5f9','Licença por usuário','PRD-LIC','product','usuário','89.90','monthly'),
   ('8e66d480-d1e1-4f6d-93b7-c46c9eec56a1','Kit de boas-vindas','PRD-KIT','product','unidade','45.00','one_time'),
   ('ef7de367-2e3b-4644-8e25-02bf3943a13f','Suporte estendido (descontinuado)','SRV-SUP','service','mês','450.00','monthly')
  ) v(id,name,code,kind,unit,price,billing);

 insert into public.companies(id,org_id,name,domain,industry,size,revenue,website,owner_id,phone)
  select v.id::uuid,v_org,v.name,v.domain,v.industry,v.size,v.revenue::numeric,v.website,
   case when v.slot is null then null else v_members[1+(v.slot::integer%array_length(v_members,1))] end,v.phone from (values
   ('e14f0543-f3e5-404e-bea2-d905604d8207','Jatobá Logística EPP','jatoba-logistica-epp-0001.example.test','Tecnologia','201-500',null,'https://jatoba-logistica-epp-0001.example.test',0,'+5531900000001'),
   ('e0b3c11a-7105-43a1-aeb0-9ee69860410c','Cerrado Turismo EPP','cerrado-turismo-epp-0002.example.test','Construção','1-10',null,'https://cerrado-turismo-epp-0002.example.test',null,'+5547900000002'),
   ('87c2ffa1-4952-4513-b626-e9c30294446f','Vale Verde Odontologia S.A.','vale-verde-odontologia-s-a-0003.example.test','Agronegócio','1-10','22213000.00','https://vale-verde-odontologia-s-a-0003.example.test',null,'+5561900000003'),
   ('ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','Alfa Odontologia Comércio','alfa-odontologia-comercio-0004.example.test','Serviços','1-10','47126000.00','https://alfa-odontologia-comercio-0004.example.test',2,'+5585900000004'),
   ('7a3d1a42-27f5-4e61-85e2-77297c12f4c3','Pioneira Educação ME','pioneira-educacao-me-0005.example.test','Construção','1-10',null,'https://pioneira-educacao-me-0005.example.test',null,'+5581900000005'),
   ('84fcd972-0992-4b38-a6f9-3314ae779e75','Pampa Arquitetura EPP','pampa-arquitetura-epp-0006.example.test','Varejo','51-200','4823000.00','https://pampa-arquitetura-epp-0006.example.test',1,'+5551900000006'),
   ('747cc141-41bb-49ab-a414-dfde9a53274d','Tupã Engenharia Serviços','tupa-engenharia-servicos-0007.example.test','Saúde','201-500','46789000.00','https://tupa-engenharia-servicos-0007.example.test',null,'+5562900000007'),
   ('c909b7f3-92c8-4fd5-a103-c7de22cd0ca1','Serra Azul Marketing Serviços','serra-azul-marketing-servicos-0008.example.test','Construção','51-200','22011000.00','https://serra-azul-marketing-servicos-0008.example.test',null,'+5541900000008'),
   ('37f28669-b7ea-4f80-bf70-73d17b7a0476','Serra Azul Alimentos Serviços','serra-azul-alimentos-servicos-0009.example.test','Agronegócio','1-10','10850000.00','https://serra-azul-alimentos-servicos-0009.example.test',2,'+5531900000009'),
   ('40ae8d4f-276c-461e-9da3-000dbf4b6a76','Sol Nascente Marketing Ltda.','sol-nascente-marketing-ltda-0010.example.test','Educação','1-10',null,'https://sol-nascente-marketing-ltda-0010.example.test',null,'+5531900000010'),
   ('19016cb4-1dc3-46a2-a9c3-32c758fe1533','Pioneira Software Ltda.','pioneira-software-ltda-0011.example.test','Educação','1-10','20491000.00','https://pioneira-software-ltda-0011.example.test',2,'+5551900000011'),
   ('7048915f-b32f-4407-8f93-772272dc1d0c','Jatobá Educação ME','jatoba-educacao-me-0012.example.test','Saúde','11-50','9151000.00','https://jatoba-educacao-me-0012.example.test',1,'+5581900000012'),
   ('7bf04f4b-430e-47ab-94d1-ab235775d7a7','Vale Verde Alimentos Serviços','vale-verde-alimentos-servicos-0013.example.test','Tecnologia','201-500','17556000.00','https://vale-verde-alimentos-servicos-0013.example.test',1,'+5511900000013'),
   ('80a8a040-144f-4bb8-8c00-b322411643bb','Alfa Odontologia ME','alfa-odontologia-me-0014.example.test','Construção','11-50',null,'https://alfa-odontologia-me-0014.example.test',1,'+5551900000014'),
   ('8b9145e0-3af7-42d8-84ba-8e1a782cfb04','Vitória Engenharia Comércio','vitoria-engenharia-comercio-0015.example.test','Agronegócio','11-50','19067000.00','https://vitoria-engenharia-comercio-0015.example.test',0,'+5561900000015'),
   ('8e33b7cf-64ff-4006-8b18-9813b4c53853','Rio Claro Marketing ME','rio-claro-marketing-me-0016.example.test','Serviços','201-500','15206000.00','https://rio-claro-marketing-me-0016.example.test',1,'+5511900000016')
  ) v(id,name,domain,industry,size,revenue,website,slot,phone);

 insert into public.contacts(id,org_id,first_name,last_name,email,phone,company_id,owner_id,status,job_title,source,notes,
  legal_basis,legal_basis_note,do_not_contact,do_not_contact_reason)
  select v.id::uuid,v_org,v.first_name,v.last_name,v.email,v.phone,v.company_id::uuid,
   case when v.slot is null then null else v_members[1+(v.slot::integer%array_length(v_members,1))] end,v.status,v.job_title,v.source,
   v.notes,v.legal_basis,v.legal_basis_note,v.do_not_contact,v.do_not_contact_reason from (values
   ('756541cd-4458-465b-b5de-47da7ba2d528','Wagner','Zanetti','wagner.zanetti.1@example.test',null,'84fcd972-0992-4b38-a6f9-3314ae779e75',1,'churned','CEO','E-mail',null,'legitimate_interest',null,false,null),
   ('7bd2850e-2584-491f-9e7d-19c1c62fb753','João','Brandão','joao.brandao.2@example.test',null,'c909b7f3-92c8-4fd5-a103-c7de22cd0ca1',0,'customer','Sócio','Feira',null,'contract',null,false,null),
   ('6eb5e889-cf4b-4f52-85a8-b73248b74c92','Daniel','Esteves','daniel.esteves.3@example.test','+5585900000017',null,2,'lead','Diretor comercial',null,null,'not_informed',null,false,null),
   ('437b0ec6-34d6-4865-bcaf-bf993f2f25bf','Daniel','Zanetti','daniel.zanetti.4@example.test',null,'40ae8d4f-276c-461e-9da3-000dbf4b6a76',1,'lead','Sócio','Indicação',null,'legitimate_interest',null,false,null),
   ('0c42ea4e-bec8-4ae8-900b-7416f7b10e7e','Eduarda','Freitas','eduarda.freitas.5@example.test','+5521900000018',null,1,'prospect','Sócia','E-mail','Prefere contato pelo WhatsApp no fim da tarde.','contract',null,false,null),
   ('757b643f-89cb-4924-8756-a5127b23c349','Fernanda','Cardoso','fernanda.cardoso.6@example.test','+5541900000019','747cc141-41bb-49ab-a414-dfde9a53274d',0,'customer','Gerente de compras','Site',null,'consent','Marcou a caixa de consentimento no formulário do site para receber contato comercial.',false,null),
   ('bd5455dc-95e8-4d28-9e58-f73f9eff815f','Valéria','Araújo','valeria.araujo.7@example.test','+5585900000020','80a8a040-144f-4bb8-8c00-b322411643bb',0,'lead','Gerente de compras','WhatsApp',null,'contract',null,false,null),
   ('599bc692-c82c-4c66-9f7e-826484653b47','Álvaro','Ferreira','alvaro.ferreira.8@example.test','+5551900000021','87c2ffa1-4952-4513-b626-e9c30294446f',0,'prospect','Analista','Telefone',null,'not_informed',null,false,null),
   ('5342dd18-935d-470a-80f9-3698bb264116','Gabriela','Esteves','gabriela.esteves.9@example.test','+5511900000022','747cc141-41bb-49ab-a414-dfde9a53274d',2,'prospect','Coordenadora','WhatsApp',null,'legitimate_interest',null,false,null),
   ('5d9f075b-9704-4d98-9c69-47bf68436775','Guilherme','Moraes','guilherme.moraes.10@example.test',null,'e0b3c11a-7105-43a1-aeb0-9ee69860410c',2,'customer','Diretor comercial','Feira',null,'contract',null,false,null),
   ('f823ad77-fcf1-479b-b102-cc4a9cdbd574','Isabela','Conceição','isabela.conceicao.11@example.test','+5585900000023','7a3d1a42-27f5-4e61-85e2-77297c12f4c3',null,'lead','Gerente de compras','Telefone',null,'legitimate_interest',null,false,null),
   ('0f3cd40b-7610-482c-8777-6a6ec94dc00d','Patrícia','Oliveira','patricia.oliveira.12@example.test',null,'c909b7f3-92c8-4fd5-a103-c7de22cd0ca1',2,'prospect',null,'Telefone',null,'contract',null,false,null),
   ('8af1a4c8-5258-4830-9b31-0426c793c9e3','Igor','Nogueira','igor.nogueira.13@example.test','+5548900000024','7a3d1a42-27f5-4e61-85e2-77297c12f4c3',1,'prospect','CEO','Indicação',null,'not_informed',null,false,null),
   ('b9d21bef-96a8-40da-86b7-2a7488ef9f25','Fernanda','Amaral','fernanda.amaral.14@example.test','+5548900000025','84fcd972-0992-4b38-a6f9-3314ae779e75',2,'prospect','Diretora comercial','Feira','Prefere contato pelo WhatsApp no fim da tarde.','legitimate_interest',null,false,null),
   ('7d1e28ff-8e2b-49f4-951d-e05c9276a01c','Helena','Gomes','helena.gomes.15@example.test','+5585900000026','747cc141-41bb-49ab-a414-dfde9a53274d',0,'prospect','CEO','WhatsApp',null,'contract',null,false,null),
   ('d83eeb66-5c7d-4e1b-b321-8c504017f86a','Thiago','Leão','thiago.leao.16@example.test','+5551900000027','37f28669-b7ea-4f80-bf70-73d17b7a0476',0,'lead','Analista','Telefone',null,'legitimate_interest',null,false,null),
   ('e58e4c6d-956b-4f1e-9a0d-eb69c5bcbc46','Marcos','Gomes','marcos.gomes.17@example.test','+5531900000028','87c2ffa1-4952-4513-b626-e9c30294446f',0,'lead',null,'E-mail',null,'consent','Marcou a caixa de consentimento no formulário do site para receber contato comercial.',false,null),
   ('1ba3d805-bd93-4183-add2-c551c23f2fb0','Thiago','Conceição','thiago.conceicao.18@example.test','+5561900000029','40ae8d4f-276c-461e-9da3-000dbf4b6a76',0,'lead',null,'Indicação',null,'not_informed',null,false,null),
   ('5012ae5e-e4dc-4cb2-96be-20b477b772ef','João','Barbosa','joao.barbosa.19@example.test','+5521900000030','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,'lead','Analista','Indicação',null,'legitimate_interest',null,false,null),
   ('b82555a0-247e-421b-9169-b55a15a189f2','Marcos','Leão','marcos.leao.20@example.test','+5571900000031',null,null,'prospect','Sócio',null,null,'contract',null,false,null),
   ('605174e1-3f83-4a06-9d1c-12330b13c7c3','Larissa','Conceição','larissa.conceicao.21@example.test','+5531900000032','8b9145e0-3af7-42d8-84ba-8e1a782cfb04',1,'lead',null,'E-mail',null,'legitimate_interest',null,false,null),
   ('85ad697a-06ab-4575-be92-adc6e6c347d0','Henrique','Pereira','henrique.pereira.22@example.test','+5511900000033','87c2ffa1-4952-4513-b626-e9c30294446f',2,'prospect','Gerente de compras','E-mail',null,'contract',null,false,null),
   ('b427834d-a09d-44e8-baf8-1589f409a895','Álvaro','Ribeiro','alvaro.ribeiro.23@example.test',null,'84fcd972-0992-4b38-a6f9-3314ae779e75',2,'customer',null,'E-mail','Prefere contato pelo WhatsApp no fim da tarde.','not_informed',null,false,null),
   ('1eb320b1-a79f-45c0-b0d9-2bfcac8cb204','Felipe','Pereira','felipe.pereira.24@example.test','+5551900000034','c909b7f3-92c8-4fd5-a103-c7de22cd0ca1',2,'lead','Sócio','Telefone',null,'legitimate_interest',null,false,null),
   ('4a123824-9b68-4844-9561-2693349f44e2','Isabela','Amaral','isabela.amaral.25@example.test','+5531900000035','7048915f-b32f-4407-8f93-772272dc1d0c',1,'lead','Gerente de compras','Indicação',null,'contract',null,false,null),
   ('e7b60f58-bcf5-4af0-ac62-8ad9bc7a38c7','Sofia','Teixeira','sofia.teixeira.26@example.test',null,'8e33b7cf-64ff-4006-8b18-9813b4c53853',1,'lead','Gerente de compras','WhatsApp',null,'legitimate_interest',null,false,null),
   ('4c58f30c-dfb9-4588-8eba-9367b5d12eab','Marcos','Oliveira','marcos.oliveira.27@example.test','+5585900000036','87c2ffa1-4952-4513-b626-e9c30294446f',0,'lead','Gerente de compras',null,null,'contract',null,false,null),
   ('488d4a9f-aef3-4f06-b1d8-a0c4a82ef8f9','Henrique','Leão','henrique.leao.28@example.test','+5581900000037','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',2,'lead','Sócio','Feira',null,'consent','Marcou a caixa de consentimento no formulário do site para receber contato comercial.',false,null),
   ('2ccea6dc-c5b8-4134-ba8e-6e1e23a33957','Débora','Santos','debora.santos.29@example.test','+5562900000038','84fcd972-0992-4b38-a6f9-3314ae779e75',1,'customer','Diretora comercial',null,null,'legitimate_interest',null,false,null),
   ('ced25445-204a-452c-9a3e-b378e3d47455','Débora','Ribeiro','debora.ribeiro.30@example.test',null,'747cc141-41bb-49ab-a414-dfde9a53274d',1,'prospect','Coordenadora','Indicação',null,'contract',null,false,null),
   ('f40d9358-efe6-45de-882d-01d177542f84','Valéria','Gonçalves','valeria.goncalves.31@example.test','+5592900000039','37f28669-b7ea-4f80-bf70-73d17b7a0476',0,'prospect','Gerente de compras','WhatsApp',null,'legitimate_interest',null,false,null),
   ('c330b700-b73d-42e5-b6fa-d5383511a31b','Álvaro','Pereira','alvaro.pereira.32@example.test','+5585900000040','19016cb4-1dc3-46a2-a9c3-32c758fe1533',0,'lead','Sócio','Feira','Prefere contato pelo WhatsApp no fim da tarde.','contract',null,false,null),
   ('8f253a01-1a54-4531-8501-c169ccbf1def','César','Santos','cesar.santos.33@example.test','+5581900000041',null,null,'lead','CEO','WhatsApp',null,'not_informed',null,false,null),
   ('06125602-1c11-4d19-94a3-cea060168bf2','Eduarda','Damasceno','eduarda.damasceno.34@example.test',null,'87c2ffa1-4952-4513-b626-e9c30294446f',2,'lead','Coordenadora','Indicação',null,'legitimate_interest',null,false,null),
   ('838d541f-5df1-4ea8-bbec-4b16aa53f927','Beatriz','Santos','beatriz.santos.35@example.test','+5571900000042','7a3d1a42-27f5-4e61-85e2-77297c12f4c3',0,'lead','Gerente de compras','Telefone',null,'contract',null,false,null),
   ('bf3179b8-bd98-47ae-9826-6ebc1cc98f5b','Marcos','Santos','marcos.santos.36@example.test','+5547900000043',null,0,'customer','Coordenador','Indicação',null,'legitimate_interest',null,false,null),
   ('bb2886c6-e86b-4316-8711-fd8d0ac9852d','Isabela','Gomes','isabela.gomes.37@example.test','+5585900000044','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',1,'lead',null,'Site',null,'contract',null,false,null),
   ('786cbbaf-a0ce-480e-af60-673a90630049','Natália','Ferreira','natalia.ferreira.38@example.test','+5592900000045',null,1,'lead','Sócia',null,null,'not_informed',null,false,null),
   ('3073bda5-a564-43d1-b652-e34012d53afb','Yasmin','Barbosa','yasmin.barbosa.39@example.test','+5551900000046','e0b3c11a-7105-43a1-aeb0-9ee69860410c',0,'customer','Gerente de compras','Feira',null,'consent','Marcou a caixa de consentimento no formulário do site para receber contato comercial.',false,null),
   ('6afce140-3799-495f-9020-7272782a94fc','Daniel','Cardoso','daniel.cardoso.40@example.test',null,'7bf04f4b-430e-47ab-94d1-ab235775d7a7',1,'lead','Coordenador','WhatsApp',null,'contract',null,false,null),
   ('eac5b1c9-9290-4791-b785-439d1f6fd340','Patrícia','Ibrahim','patricia.ibrahim.41@example.test','+5585900000047','e14f0543-f3e5-404e-bea2-d905604d8207',2,'churned','Diretora comercial','Telefone','Prefere contato pelo WhatsApp no fim da tarde.','legitimate_interest',null,false,null),
   ('6e326226-052a-4a7e-b687-bbd7e0eab758','Gabriela','Moraes','gabriela.moraes.42@example.test','+5541900000048',null,0,'lead','Gerente de compras','Site',null,'contract',null,false,null),
   ('f1086e9f-b230-43a5-8525-8901642a2085','Ana','Uchôa','ana.uchoa.43@example.test','+5571900000049','7a3d1a42-27f5-4e61-85e2-77297c12f4c3',2,'lead','Analista','Telefone',null,'not_informed',null,false,null),
   ('721fa076-a6af-4b9f-b2c9-09be6cef8588','Beatriz','Almeida','beatriz.almeida.44@example.test',null,'8b9145e0-3af7-42d8-84ba-8e1a782cfb04',0,'lead',null,'Site',null,'legitimate_interest',null,false,null),
   ('157966e1-0407-490d-a075-c1a3b76f4b0e','Otávio','Ferreira','otavio.ferreira.45@example.test','+5548900000050','e14f0543-f3e5-404e-bea2-d905604d8207',null,'lead',null,'WhatsApp',null,'contract',null,false,null),
   ('af8912b8-175e-4a3f-b987-58fc5ebb1b0a','Débora','Dias','debora.dias.46@example.test','+5521900000051','37f28669-b7ea-4f80-bf70-73d17b7a0476',0,'lead','Coordenadora',null,null,'legitimate_interest',null,false,null),
   ('f1fef135-91fa-4ca7-acc3-b42ccbf257d8','Igor','Araújo','igor.araujo.47@example.test','+5585900000052','e0b3c11a-7105-43a1-aeb0-9ee69860410c',2,'lead','Gerente de compras','Indicação',null,'contract',null,false,null),
   ('571b3e25-f6ab-4cdc-9a35-7c51bc5f3160','Otávio','Uchôa','otavio.uchoa.48@example.test','+5531900000053',null,0,'lead','Analista','Feira',null,'not_informed',null,false,null),
   ('2aba3e10-3349-4b37-a5e2-5faf98b45fc5','Otávio','Queiroz','otavio.queiroz.demo@example.test','+5541900000054','e14f0543-f3e5-404e-bea2-d905604d8207',0,'churned','Gerente de compras','Telefone','Ex-cliente. Pediu para não receber mais ofertas.','legitimate_interest',null,true,'Pediu por telefone para não receber mais ofertas.'),
   ('0623b60d-71de-486f-bed5-e87839b536a9','Larissa','Freitas','larissa.freitas.demo@example.test','+5511900000055','e0b3c11a-7105-43a1-aeb0-9ee69860410c',1,'prospect','Coordenadora','Site',null,'consent','Pediu um orçamento pelo formulário do site e aceitou receber contato comercial.',false,null),
   ('49ee78ea-c4b3-4faa-89d5-e0e017e0a36f','Igor','Teixeira','igor.teixeira.demo@example.test','+5531900000056',null,0,'lead','Analista','Feira','Conheceu a empresa no estande da feira.','legitimate_interest',null,false,null)
  ) v(id,first_name,last_name,email,phone,company_id,slot,status,job_title,source,notes,legal_basis,legal_basis_note,
   do_not_contact,do_not_contact_reason);

 insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,contact_id,company_id,owner_id,close_date,probability,
  status,lost_reason)
  select v.id::uuid,v_org,v.pipeline_id,v.stage_id,v.title,v.value::numeric,v.contact_id::uuid,v.company_id::uuid,v.owner_id,
   v.close_date,v.probability::numeric,v.status,v.lost_reason from (values
   ('56001edf-6d7c-4a0c-9912-fd598426a167',v_pipeline,v_stages[1+(2%array_length(v_stages,1))],'Consultoria mensal · Débora Ribeiro','19868.86','ced25445-204a-452c-9a3e-b378e3d47455','747cc141-41bb-49ab-a414-dfde9a53274d',v_members[1+(2%array_length(v_members,1))],null::date,45,'open',null),
   ('eb58b8bb-ee8b-4d29-9859-9bf1bdd010d2',v_pipeline,v_stages[1+(2%array_length(v_stages,1))],'Expansão de licenças · Conta sem contato','37442.84',null,'40ae8d4f-276c-461e-9da3-000dbf4b6a76',v_members[1+(2%array_length(v_members,1))],null::date,null,'open',null),
   ('ff58127d-821e-4c91-9f87-71a85a002c5d','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'7d9de047-8671-4dd5-918b-f9567003390c'::uuid,'Treinamento da equipe · Igor Araújo','34847.83','f1fef135-91fa-4ca7-acc3-b42ccbf257d8','e0b3c11a-7105-43a1-aeb0-9ee69860410c',v_members[1+(1%array_length(v_members,1))],v_today+47,95,'open',null),
   ('9f628572-2bd5-4712-a71a-a0497f27353e','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'7d9de047-8671-4dd5-918b-f9567003390c'::uuid,'Projeto piloto · Álvaro Ferreira','19925.50','599bc692-c82c-4c66-9f7e-826484653b47','87c2ffa1-4952-4513-b626-e9c30294446f',v_members[1+(2%array_length(v_members,1))],v_today+47,25,'open',null),
   ('2234d3b9-074c-499c-b43d-07499a443331',v_pipeline,v_stages[1+(1%array_length(v_stages,1))],'Implantação · Beatriz Santos','7436.43','838d541f-5df1-4ea8-bbec-4b16aa53f927','7a3d1a42-27f5-4e61-85e2-77297c12f4c3',null::uuid,null::date,0,'lost','Projeto adiado'),
   ('ee1bda3d-8f88-4d66-8559-563c964dd7ff','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'7d9de047-8671-4dd5-918b-f9567003390c'::uuid,'Renovação anual · Thiago Conceição','10438.56','1ba3d805-bd93-4183-add2-c551c23f2fb0','40ae8d4f-276c-461e-9da3-000dbf4b6a76',v_members[1+(0%array_length(v_members,1))],v_today+71,null,'open',null),
   ('6d189d05-7f0f-4f92-99ba-49aa01b21340',v_pipeline,v_stages[1+(0%array_length(v_stages,1))],'Contrato de suporte · Thiago Leão','44128.25','d83eeb66-5c7d-4e1b-b321-8c504017f86a','37f28669-b7ea-4f80-bf70-73d17b7a0476',null::uuid,v_today+99,null,'open',null),
   ('f1c0bdd7-edee-4735-91c0-393606163276',v_pipeline,v_stages[1+(1%array_length(v_stages,1))],'Projeto piloto · Marcos Leão','765.34','b82555a0-247e-421b-9169-b55a15a189f2','e0b3c11a-7105-43a1-aeb0-9ee69860410c',v_members[1+(0%array_length(v_members,1))],null::date,90,'open',null),
   ('e9c13325-d567-4f34-9555-7a3b1a4bd393',v_pipeline,v_stages[1+(0%array_length(v_stages,1))],'Implantação · Beatriz Santos','20080.76','838d541f-5df1-4ea8-bbec-4b16aa53f927','7a3d1a42-27f5-4e61-85e2-77297c12f4c3',v_members[1+(2%array_length(v_members,1))],v_today+101,50,'open',null),
   ('cae9cd7b-7b3a-465d-895a-fb99be1bf6f7','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'39f05f4b-5159-41e6-b1c7-8bfb235cbe2d'::uuid,'Projeto piloto · Débora Ribeiro','45410.57','ced25445-204a-452c-9a3e-b378e3d47455','747cc141-41bb-49ab-a414-dfde9a53274d',null::uuid,null::date,null,'open',null),
   ('ad106e7e-582d-4379-9a8b-03a1486eebea','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'39f05f4b-5159-41e6-b1c7-8bfb235cbe2d'::uuid,'Implantação · Valéria Araújo','9046.18','bd5455dc-95e8-4d28-9e58-f73f9eff815f','80a8a040-144f-4bb8-8c00-b322411643bb',v_members[1+(1%array_length(v_members,1))],v_today+18,null,'open',null),
   ('838d21dc-d9bc-4e7f-8865-e2252a86061a','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'39f05f4b-5159-41e6-b1c7-8bfb235cbe2d'::uuid,'Treinamento da equipe · Débora Ribeiro','26044.01','ced25445-204a-452c-9a3e-b378e3d47455','747cc141-41bb-49ab-a414-dfde9a53274d',v_members[1+(2%array_length(v_members,1))],null::date,100,'won',null),
   ('e0828859-932a-4d14-8da7-4fe287730d4a',v_pipeline,v_stages[1+(1%array_length(v_stages,1))],'Contrato de suporte · Marcos Santos','5345.76','bf3179b8-bd98-47ae-9826-6ebc1cc98f5b','7048915f-b32f-4407-8f93-772272dc1d0c',v_members[1+(1%array_length(v_members,1))],null::date,100,'won',null),
   ('e07234da-f320-4ed9-950f-6987d831e7c0','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'39f05f4b-5159-41e6-b1c7-8bfb235cbe2d'::uuid,'Pacote de serviços · Helena Gomes','23646.48','7d1e28ff-8e2b-49f4-951d-e05c9276a01c','747cc141-41bb-49ab-a414-dfde9a53274d',v_members[1+(2%array_length(v_members,1))],null::date,90,'open',null),
   ('4875ad35-c35d-45bf-ac34-0d22620d4f82','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'3439edcb-2ec3-4f40-a078-cc412959cb02'::uuid,'Expansão de licenças · Marcos Gomes','14772.65','e58e4c6d-956b-4f1e-9a0d-eb69c5bcbc46','87c2ffa1-4952-4513-b626-e9c30294446f',v_members[1+(0%array_length(v_members,1))],null::date,100,'won',null),
   ('838a0e12-89cc-4625-a513-acd314d553ac',v_pipeline,v_stages[1+(1%array_length(v_stages,1))],'Implantação · Marcos Santos','48094.56','bf3179b8-bd98-47ae-9826-6ebc1cc98f5b','84fcd972-0992-4b38-a6f9-3314ae779e75',v_members[1+(1%array_length(v_members,1))],null::date,15,'open',null),
   ('2eb5994b-e387-4253-bbb0-8d1c8a235dcb',v_pipeline,v_stages[1+(0%array_length(v_stages,1))],'Pacote de serviços · Conta sem contato','44067.79',null,null,v_members[1+(0%array_length(v_members,1))],null::date,100,'won',null),
   ('08dbe0f5-8175-42b3-b69d-894642d98aff','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'39f05f4b-5159-41e6-b1c7-8bfb235cbe2d'::uuid,'Treinamento da equipe · Isabela Amaral','3358.20','4a123824-9b68-4844-9561-2693349f44e2','7048915f-b32f-4407-8f93-772272dc1d0c',v_members[1+(1%array_length(v_members,1))],null::date,null,'open',null),
   ('b64488b8-87aa-43a9-9e8d-ec30f237ad49',v_pipeline,v_stages[1+(1%array_length(v_stages,1))],'Expansão de licenças · Isabela Gomes','37887.64','bb2886c6-e86b-4316-8711-fd8d0ac9852d','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',v_members[1+(0%array_length(v_members,1))],v_today+120,95,'open',null),
   ('12c5df45-c99d-45bb-893c-12e4809c15db',v_pipeline,v_stages[1+(1%array_length(v_stages,1))],'Pacote de serviços · Conta sem contato','48086.25',null,'8e33b7cf-64ff-4006-8b18-9813b4c53853',v_members[1+(2%array_length(v_members,1))],null::date,100,'won',null),
   ('39dc7bab-2a12-490a-a82b-fcb5f353f838','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'3439edcb-2ec3-4f40-a078-cc412959cb02'::uuid,'Consultoria mensal · Sofia Teixeira','43206.85','e7b60f58-bcf5-4af0-ac62-8ad9bc7a38c7','8e33b7cf-64ff-4006-8b18-9813b4c53853',v_members[1+(2%array_length(v_members,1))],null::date,35,'open',null),
   ('5d9c33e7-a54b-4b66-ae36-191a749cad94',v_pipeline,v_stages[1+(3%array_length(v_stages,1))],'Treinamento da equipe · Thiago Leão','23213.18','d83eeb66-5c7d-4e1b-b321-8c504017f86a','37f28669-b7ea-4f80-bf70-73d17b7a0476',v_members[1+(0%array_length(v_members,1))],null::date,100,'won',null),
   ('38e32d4a-a2d1-4692-86e9-0261d41d63ad','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'3439edcb-2ec3-4f40-a078-cc412959cb02'::uuid,'Expansão de licenças · João Barbosa','44496.97','5012ae5e-e4dc-4cb2-96be-20b477b772ef','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',v_members[1+(0%array_length(v_members,1))],v_today+71,75,'open',null),
   ('09304b27-e87d-4fb9-a44c-ee18f6a41674',v_pipeline,v_stages[1+(2%array_length(v_stages,1))],'Consultoria mensal · Marcos Gomes','969.79','e58e4c6d-956b-4f1e-9a0d-eb69c5bcbc46','87c2ffa1-4952-4513-b626-e9c30294446f',v_members[1+(0%array_length(v_members,1))],v_today+10,null,'open',null),
   ('5de1327f-328d-4a19-9a5c-c04d2d3498a1',v_pipeline,v_stages[1+(2%array_length(v_stages,1))],'Contrato de suporte · João Barbosa','25440.01','5012ae5e-e4dc-4cb2-96be-20b477b772ef','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',v_members[1+(1%array_length(v_members,1))],null::date,0,'lost','Sem retorno do cliente')
  ) v(id,pipeline_id,stage_id,title,value,contact_id,company_id,owner_id,close_date,probability,status,lost_reason);

 -- Oportunidades com itens do catálogo: pela mesma função da tela, que calcula o valor do contrato.
 perform private.save_deal('07662451-4b9a-4c10-b1dd-dcbfe0047f30'::uuid,null,jsonb_build_object('title','Consultoria mensal · Gabriela Esteves','pipeline_id','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'stage_id','39f05f4b-5159-41e6-b1c7-8bfb235cbe2d'::uuid,'status','won','owner_id',v_members[1+(2%array_length(v_members,1))],'contact_id','5342dd18-935d-470a-80f9-3698bb264116','company_id','747cc141-41bb-49ab-a414-dfde9a53274d','close_date',null::date,'probability',100,'lost_reason',null),
  '[{"id":"85dde38e-00d7-4952-93e0-d4efcc08191d","product_id":"3e441001-9025-4649-8918-247fe1148322","name":"Implantação do CRM","quantity":"1.000","unit":"projeto","unit_price":"3500.00","billing":"one_time"},{"id":"aad1402e-e0bc-4057-b804-532bef9c654b","product_id":"ae86cf68-7d10-46b0-b065-01d226b95dd6","name":"Consultoria mensal","quantity":"1.000","unit":"mês","unit_price":"1200.00","billing":"monthly"}]'::jsonb,12);
 perform private.save_deal('a71d1cb8-ea40-49bd-a7e3-fe0c589dde3a'::uuid,null,jsonb_build_object('title','Expansão de licenças · Guilherme Moraes','pipeline_id','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'stage_id','39f05f4b-5159-41e6-b1c7-8bfb235cbe2d'::uuid,'status','open','owner_id',v_members[1+(0%array_length(v_members,1))],'contact_id','5d9f075b-9704-4d98-9c69-47bf68436775','company_id','e0b3c11a-7105-43a1-aeb0-9ee69860410c','close_date',null::date,'probability',10,'lost_reason',null),
  '[{"id":"bf8220e9-5fab-4edb-9f3d-a7106ceb7bde","product_id":"ae86cf68-7d10-46b0-b065-01d226b95dd6","name":"Consultoria mensal","quantity":"1.000","unit":"mês","unit_price":"1200.00","billing":"monthly"},{"id":"4c5cff04-bf6b-4002-b224-213437f5bb87","product_id":"4f8df8b5-f496-4659-b03b-c69c9336a70e","name":"Treinamento da equipe","quantity":"4.000","unit":"hora","unit_price":"180.00","billing":"one_time"}]'::jsonb,12);
 perform private.save_deal('f38a4a2e-c601-48d6-8b8e-262715244f1c'::uuid,null,jsonb_build_object('title','Contrato de suporte · Marcos Oliveira','pipeline_id','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'stage_id','39f05f4b-5159-41e6-b1c7-8bfb235cbe2d'::uuid,'status','open','owner_id',v_members[1+(1%array_length(v_members,1))],'contact_id','4c58f30c-dfb9-4588-8eba-9367b5d12eab','company_id','87c2ffa1-4952-4513-b626-e9c30294446f','close_date',null::date,'probability',null,'lost_reason',null),
  '[{"id":"a3739ce0-396d-4df3-8d36-3132204510fa","product_id":null,"name":"Integração com o site","quantity":"1.000","unit":"projeto","unit_price":"2400.00","billing":"one_time"},{"id":"9cb43a29-a87e-4bae-8568-ddf1e519911b","product_id":"8e66d480-d1e1-4f6d-93b7-c46c9eec56a1","name":"Kit de boas-vindas","quantity":"20.000","unit":"unidade","unit_price":"45.00","billing":"one_time"}]'::jsonb,null);
 perform private.save_deal('fc68fa6d-9e67-4087-9672-25db726884fd'::uuid,null,jsonb_build_object('title','Consultoria mensal · Marcos Oliveira','pipeline_id',v_pipeline,'stage_id',v_stages[1+(2%array_length(v_stages,1))],'status','open','owner_id',v_members[1+(0%array_length(v_members,1))],'contact_id','4c58f30c-dfb9-4588-8eba-9367b5d12eab','company_id','87c2ffa1-4952-4513-b626-e9c30294446f','close_date',v_today+83,'probability',null,'lost_reason',null),
  '[{"id":"3ef49eca-e677-447e-86fe-3da467434236","product_id":"4f5b60d7-3aa9-459a-ac20-31296db6c5f9","name":"Licença por usuário","quantity":"25.000","unit":"usuário","unit_price":"89.90","billing":"monthly"},{"id":"1a22246c-ef29-4bca-b918-4f3798fd1165","product_id":"3e441001-9025-4649-8918-247fe1148322","name":"Implantação do CRM","quantity":"1.000","unit":"projeto","unit_price":"3500.00","billing":"one_time"}]'::jsonb,24);
 perform private.save_deal('9a0aa229-159d-4bfd-b06e-3ec841c9755b'::uuid,null,jsonb_build_object('title','Implantação · Thiago Conceição','pipeline_id','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'stage_id','3439edcb-2ec3-4f40-a078-cc412959cb02'::uuid,'status','won','owner_id',v_members[1+(1%array_length(v_members,1))],'contact_id','1ba3d805-bd93-4183-add2-c551c23f2fb0','company_id','40ae8d4f-276c-461e-9da3-000dbf4b6a76','close_date',null::date,'probability',100,'lost_reason',null),
  '[{"id":"358159ac-ecf6-473d-b8b8-dd3c0755b2ca","product_id":"4f5b60d7-3aa9-459a-ac20-31296db6c5f9","name":"Licença por usuário","quantity":"10.000","unit":"usuário","unit_price":"89.90","billing":"monthly","discount_type":"percent","discount_value":"10.00"},{"id":"b23fe0ea-55de-4f2f-938f-0b6e7536465a","product_id":"4f8df8b5-f496-4659-b03b-c69c9336a70e","name":"Treinamento da equipe","quantity":"8.000","unit":"hora","unit_price":"180.00","billing":"one_time"}]'::jsonb,6);
 perform private.save_deal('9de5aec7-cd3e-4848-b74d-a8a871438325'::uuid,null,jsonb_build_object('title','Expansão de licenças · João Barbosa','pipeline_id',v_pipeline,'stage_id',v_stages[1+(0%array_length(v_stages,1))],'status','won','owner_id',v_members[1+(0%array_length(v_members,1))],'contact_id','5012ae5e-e4dc-4cb2-96be-20b477b772ef','company_id','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','close_date',null::date,'probability',100,'lost_reason',null),
  '[{"id":"e787d522-937d-4bdd-971c-2fe93f2c5648","product_id":"3e441001-9025-4649-8918-247fe1148322","name":"Implantação do CRM","quantity":"1.000","unit":"projeto","unit_price":"3500.00","billing":"one_time","discount_type":"amount","discount_value":"500.00"},{"id":"0a98f82c-a28e-411f-9e8d-015445d2b1b6","product_id":"ef7de367-2e3b-4644-8e25-02bf3943a13f","name":"Suporte estendido (descontinuado)","quantity":"1.000","unit":"mês","unit_price":"450.00","billing":"monthly"}]'::jsonb,12);
 perform private.save_deal('af3f2d0a-5a01-431a-8512-d95ca53d994e'::uuid,null,jsonb_build_object('title','Contrato de suporte · Débora Santos','pipeline_id','2f860930-4560-42c8-a2a0-cc109b7cd66e'::uuid,'stage_id','39f05f4b-5159-41e6-b1c7-8bfb235cbe2d'::uuid,'status','lost','owner_id',v_members[1+(2%array_length(v_members,1))],'contact_id','2ccea6dc-c5b8-4134-ba8e-6e1e23a33957','company_id','84fcd972-0992-4b38-a6f9-3314ae779e75','close_date',null::date,'probability',0,'lost_reason','Projeto adiado'),
  '[{"id":"08e193f8-d2f4-4618-8442-203563cc5b00","product_id":"3e441001-9025-4649-8918-247fe1148322","name":"Implantação do CRM","quantity":"1.000","unit":"projeto","unit_price":"3500.00","billing":"one_time"},{"id":"eba46985-f23f-498e-b1cd-5bf96c5de808","product_id":"4f8df8b5-f496-4659-b03b-c69c9336a70e","name":"Treinamento da equipe","quantity":"10.000","unit":"hora","unit_price":"180.00","billing":"one_time"}]'::jsonb,null);
 update public.products set archived_at=v_now+make_interval(secs=>v.archived) from (values
   ('ef7de367-2e3b-4644-8e25-02bf3943a13f',-1728000)
  ) v(id,archived) where products.id=v.id::uuid;

 insert into public.activities(id,org_id,type,title,body,contact_id,company_id,deal_id,user_id,due_date,end_date,completed_at,outcome)
  select v.id::uuid,v_org,v.type,v.title,v.body,v.contact_id::uuid,v.company_id::uuid,v.deal_id::uuid,
   case when v.slot is null then null else v_members[1+(v.slot::integer%array_length(v_members,1))] end,
   case when v.due_today then v_due_today when v.due is null then null else v_now+make_interval(secs=>v.due::integer) end,
   case when v.ends is null then null else v_now+make_interval(secs=>v.ends::integer) end,
   case when v.completed is null then null else v_now+make_interval(secs=>v.completed::integer) end,v.outcome from (values
   ('c0e1157e-eebb-42e2-a16d-0d655e4a1d70','email','Responder dúvidas por e-mail',null,'4c58f30c-dfb9-4588-8eba-9367b5d12eab','87c2ffa1-4952-4513-b626-e9c30294446f','fc68fa6d-9e67-4087-9672-25db726884fd',1,-22501757,false,null,-22459013,null),
   ('24b16eeb-853c-4120-850a-e6aef11a708e','meeting','Apresentação da solução','Pauta: necessidades, prazos e próximos passos.','7d1e28ff-8e2b-49f4-951d-e05c9276a01c','747cc141-41bb-49ab-a414-dfde9a53274d',null,1,-11908139,false,-11902739,-11875348,null),
   ('c27508ae-ea97-45f9-b69a-c21a6322b2fe','call','Retorno sobre a proposta',null,null,'40ae8d4f-276c-461e-9da3-000dbf4b6a76','eb58b8bb-ee8b-4d29-9859-9bf1bdd010d2',2,-10485135,false,null,-10386801,'voicemail'),
   ('5c31ae04-b435-4e4f-8fc4-540430352ccb','meeting','Apresentação da solução',null,'7d1e28ff-8e2b-49f4-951d-e05c9276a01c','747cc141-41bb-49ab-a414-dfde9a53274d',null,2,4752646,false,4756246,null,null),
   ('1118622a-2302-4812-ad21-f0c2f1260d91','task','Atualizar cadastro',null,'5012ae5e-e4dc-4cb2-96be-20b477b772ef','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,0,-14743372,false,null,-14576237,null),
   ('376f803c-b7a6-46c3-bdf8-a6be66aab512','task','Revisar contrato','Combinar o próximo passo com o cliente.','bd5455dc-95e8-4d28-9e58-f73f9eff815f','80a8a040-144f-4bb8-8c00-b322411643bb','ad106e7e-582d-4379-9a8b-03a1486eebea',null,-27925660,false,null,-27782882,null),
   ('58a7d16b-f508-4d79-88f0-816fd75e6fe6','task','Atualizar cadastro',null,'4a123824-9b68-4844-9561-2693349f44e2','7048915f-b32f-4407-8f93-772272dc1d0c','08dbe0f5-8175-42b3-b69d-894642d98aff',2,-2015704,false,null,null,null),
   ('bf2d0f8f-12f9-4030-bb3e-33ba90f88393','visit','Visita de apresentação','Visita ao escritório do cliente para conhecer a equipe.','b82555a0-247e-421b-9169-b55a15a189f2','e0b3c11a-7105-43a1-aeb0-9ee69860410c','f1c0bdd7-edee-4735-91c0-393606163276',0,null,false,null,null,null),
   ('c812e3bd-c7df-4535-9466-e1f90f94ed39','meeting','Apresentação da solução',null,'488d4a9f-aef3-4f06-b1d8-a0c4a82ef8f9','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,null,4114734,false,4116534,null,null),
   ('427972f5-b17a-4492-929e-964bc6a6028d','call','Ligar para retomar conversa','Conversa sobre prazos e orçamento.','e7b60f58-bcf5-4af0-ac62-8ad9bc7a38c7','8e33b7cf-64ff-4006-8b18-9813b4c53853','39dc7bab-2a12-490a-a82b-fcb5f353f838',1,2725667,false,null,null,null),
   ('ccc8c0ed-8219-4d5e-9b3c-df36f39382eb','task','Preparar apresentação',null,'5012ae5e-e4dc-4cb2-96be-20b477b772ef','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,0,-9243691,false,null,-9166366,null),
   ('1788b4a6-8cf4-45a4-ba83-69ae58e3f01b','meeting','Apresentação da solução',null,'b82555a0-247e-421b-9169-b55a15a189f2','e0b3c11a-7105-43a1-aeb0-9ee69860410c','f1c0bdd7-edee-4735-91c0-393606163276',2,-28821597,false,-28817997,-28722852,null),
   ('1f0d7b92-530b-43f8-96a4-d4d6f29ae3f7','task','Revisar contrato','Combinar o próximo passo com o cliente.','157966e1-0407-490d-a075-c1a3b76f4b0e','e14f0543-f3e5-404e-bea2-d905604d8207',null,1,-2070270,false,null,null,null),
   ('1e48c536-b327-48ea-9f10-e65d6567ed3d','whatsapp','Confirmar a reunião pelo WhatsApp','Mensagem com o link da proposta.','5012ae5e-e4dc-4cb2-96be-20b477b772ef','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','38e32d4a-a2d1-4692-86e9-0261d41d63ad',2,-18640675,false,null,-18637668,null),
   ('448892da-1a4c-4c32-b9d7-4a85cacc6b73','meeting','Reunião de diagnóstico','Pauta: necessidades, prazos e próximos passos.','e58e4c6d-956b-4f1e-9a0d-eb69c5bcbc46','87c2ffa1-4952-4513-b626-e9c30294446f','4875ad35-c35d-45bf-ac34-0d22620d4f82',1,-17486359,false,-17482759,-17374630,null),
   ('2fa87528-b440-42ba-900a-6714b9970811','task','Revisar contrato',null,'786cbbaf-a0ce-480e-af60-673a90630049','8e33b7cf-64ff-4006-8b18-9813b4c53853',null,2,-2230620,false,null,null,null),
   ('1a9e7c5b-c0e3-4b7f-bbfd-d89332866b13','task','Preparar apresentação','Combinar o próximo passo com o cliente.',null,'40ae8d4f-276c-461e-9da3-000dbf4b6a76',null,2,null,false,null,null,null),
   ('c992c10b-9259-40da-93bc-e09429bf2022','call','Ligação de qualificação','Conversa sobre prazos e orçamento.','7d1e28ff-8e2b-49f4-951d-e05c9276a01c','747cc141-41bb-49ab-a414-dfde9a53274d',null,1,-110818,false,null,null,null),
   ('ca571dec-3d48-4371-a8ca-04159c55540e','task','Revisar contrato',null,'838d541f-5df1-4ea8-bbec-4b16aa53f927','7a3d1a42-27f5-4e61-85e2-77297c12f4c3','e9c13325-d567-4f34-9555-7a3b1a4bd393',0,-7362574,false,null,-7318948,null),
   ('f3c223bf-b8c7-46e7-8b89-eff2880e8677','meeting','Apresentação da solução',null,'b82555a0-247e-421b-9169-b55a15a189f2','e0b3c11a-7105-43a1-aeb0-9ee69860410c','f1c0bdd7-edee-4735-91c0-393606163276',0,-5064399,false,-5062599,-5025654,null),
   ('204903e1-555d-405a-b118-ff7e1386a7d6','email','Enviar material por e-mail',null,'0c42ea4e-bec8-4ae8-900b-7416f7b10e7e','37f28669-b7ea-4f80-bf70-73d17b7a0476',null,2,-1396622,false,null,null,null),
   ('807f2d03-f500-42f6-a5cd-87c39fa75d2e','meeting','Apresentação da solução','Pauta: necessidades, prazos e próximos passos.','af8912b8-175e-4a3f-b987-58fc5ebb1b0a','37f28669-b7ea-4f80-bf70-73d17b7a0476',null,1,1492,false,6892,null,null),
   ('d4bd8ada-880d-48e2-bd9a-bf6e4c4f08de','meeting','Reunião de fechamento','Pauta: necessidades, prazos e próximos passos.','5012ae5e-e4dc-4cb2-96be-20b477b772ef','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','38e32d4a-a2d1-4692-86e9-0261d41d63ad',1,-18677230,false,-18673630,-18541792,null),
   ('7b169201-7727-4a4e-8ef7-01a003ed2ec1','call','Retorno sobre a proposta',null,'e7b60f58-bcf5-4af0-ac62-8ad9bc7a38c7','8e33b7cf-64ff-4006-8b18-9813b4c53853',null,2,-7485461,false,null,-7329486,'voicemail'),
   ('90a7cdee-c8f4-4668-87a1-4a5f926b21a1','task','Enviar proposta','Combinar o próximo passo com o cliente.','5342dd18-935d-470a-80f9-3698bb264116','747cc141-41bb-49ab-a414-dfde9a53274d','07662451-4b9a-4c10-b1dd-dcbfe0047f30',2,null,false,null,null,null),
   ('1b5ab78c-7576-4cb0-b03a-955a3a497466','task','Revisar contrato','Combinar o próximo passo com o cliente.','5d9f075b-9704-4d98-9c69-47bf68436775','e0b3c11a-7105-43a1-aeb0-9ee69860410c','a71d1cb8-ea40-49bd-a7e3-fe0c589dde3a',2,3514488,false,null,null,null),
   ('050d0353-003b-4b87-ae68-1dfe241c7f16','task','Atualizar cadastro',null,null,null,'2eb5994b-e387-4253-bbb0-8d1c8a235dcb',0,-1111755,false,null,null,null),
   ('0230e1e6-c1cb-4290-8a03-4f71e51f0563','email','Responder dúvidas por e-mail','Material enviado com o resumo da proposta.','1ba3d805-bd93-4183-add2-c551c23f2fb0','40ae8d4f-276c-461e-9da3-000dbf4b6a76',null,2,-36993,false,null,null,null),
   ('5b38a825-4309-453b-bec0-661894f7417c','call','Ligação de qualificação',null,'b82555a0-247e-421b-9169-b55a15a189f2','e0b3c11a-7105-43a1-aeb0-9ee69860410c','f1c0bdd7-edee-4735-91c0-393606163276',0,922658,false,null,null,null),
   ('dac08da4-c4ad-4886-bb31-0d8b341c5750','call','Ligar para retomar conversa',null,null,'40ae8d4f-276c-461e-9da3-000dbf4b6a76','eb58b8bb-ee8b-4d29-9859-9bf1bdd010d2',1,11803,false,null,null,null),
   ('56ac5f16-c235-4299-b95a-00eec10bac3f','task','Atualizar cadastro',null,'bd5455dc-95e8-4d28-9e58-f73f9eff815f','80a8a040-144f-4bb8-8c00-b322411643bb','ad106e7e-582d-4379-9a8b-03a1486eebea',1,1343454,false,null,null,null),
   ('7a7c069a-1677-42ea-910c-7223033d5e89','task','Revisar contrato',null,null,'87c2ffa1-4952-4513-b626-e9c30294446f',null,1,-2480995,false,null,null,null),
   ('6fcfa019-1c08-4a45-b8ea-642ccb738965','meeting','Reunião de fechamento',null,'157966e1-0407-490d-a075-c1a3b76f4b0e','e14f0543-f3e5-404e-bea2-d905604d8207',null,0,-12113773,false,-12110173,-12027209,null),
   ('169fa947-b914-412d-9827-0ce3613df802','whatsapp','Mandar a proposta pelo WhatsApp',null,'838d541f-5df1-4ea8-bbec-4b16aa53f927','7a3d1a42-27f5-4e61-85e2-77297c12f4c3','2234d3b9-074c-499c-b43d-07499a443331',0,2980575,false,null,null,null),
   ('6d53a2c9-7682-48cc-9d88-d816a2fedb4f','note','Cliente pediu desconto','Cliente pediu para retomar a conversa no mês que vem.','488d4a9f-aef3-4f06-b1d8-a0c4a82ef8f9','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,2,null,false,null,-16665970,null),
   ('883d5adb-7786-4e8f-9b01-bdd721efa8b1','call','Ligar para retomar conversa',null,'bf3179b8-bd98-47ae-9826-6ebc1cc98f5b','84fcd972-0992-4b38-a6f9-3314ae779e75','838a0e12-89cc-4625-a513-acd314d553ac',null,5079678,false,null,null,null),
   ('d713fc49-aaee-4876-a4d1-5d27b7e07ba1','task','Preparar apresentação',null,'d83eeb66-5c7d-4e1b-b321-8c504017f86a','37f28669-b7ea-4f80-bf70-73d17b7a0476',null,1,-7245106,false,null,-7238781,null),
   ('bb2501ba-7525-40b3-bef8-6474a182db08','note','Cliente pediu desconto',null,null,'8e33b7cf-64ff-4006-8b18-9813b4c53853','12c5df45-c99d-45bb-893c-12e4809c15db',1,null,false,null,-2004472,null),
   ('e5e20994-f035-42c5-a489-6c52f13ac178','task','Enviar proposta','Combinar o próximo passo com o cliente.','bb2886c6-e86b-4316-8711-fd8d0ac9852d','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,0,-13139093,false,null,-13138647,null),
   ('50f4f8d5-fc84-4c16-98c8-f7b3755d0a45','email','Mandar resumo da reunião',null,'757b643f-89cb-4924-8756-a5127b23c349','747cc141-41bb-49ab-a414-dfde9a53274d',null,0,-27909304,false,null,-27865848,null),
   ('f1816fcb-788a-4852-b62b-a8769281b927','meeting','Reunião de diagnóstico','Pauta: necessidades, prazos e próximos passos.','4c58f30c-dfb9-4588-8eba-9367b5d12eab','87c2ffa1-4952-4513-b626-e9c30294446f','fc68fa6d-9e67-4087-9672-25db726884fd',2,null,false,null,null,null),
   ('4af486eb-12ba-4732-9a96-4e966c2eac31','email','Enviar material por e-mail',null,'ced25445-204a-452c-9a3e-b378e3d47455','747cc141-41bb-49ab-a414-dfde9a53274d','838d21dc-d9bc-4e7f-8865-e2252a86061a',2,-1646087,false,null,null,null),
   ('f8fa41e6-f68a-44a0-8569-b40896d3e80e','call','Retorno sobre a proposta',null,'4a123824-9b68-4844-9561-2693349f44e2','7048915f-b32f-4407-8f93-772272dc1d0c',null,0,4717546,false,null,null,null),
   ('02b08fc7-51af-4d7d-b47b-3d0a97c0c45c','whatsapp','Confirmar a reunião pelo WhatsApp',null,'488d4a9f-aef3-4f06-b1d8-a0c4a82ef8f9','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,2,null,false,null,null,null),
   ('2eb5d539-f2ca-4056-be69-b210fd716e9a','note','Cliente pediu desconto',null,'488d4a9f-aef3-4f06-b1d8-a0c4a82ef8f9','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,null,null,false,null,-22005207,null),
   ('bfa008d7-19d7-439d-845d-b05ae2aaa5fd','task','Revisar contrato',null,'4c58f30c-dfb9-4588-8eba-9367b5d12eab','87c2ffa1-4952-4513-b626-e9c30294446f','fc68fa6d-9e67-4087-9672-25db726884fd',1,-17119878,false,null,-17083563,null),
   ('072c70fc-8e91-4ca5-a8bc-8e3563245c9c','task','Enviar proposta',null,'bf3179b8-bd98-47ae-9826-6ebc1cc98f5b','7bf04f4b-430e-47ab-94d1-ab235775d7a7',null,0,-23217696,false,null,-23187334,null),
   ('07b03f70-46e5-4554-aec9-6b9fd0073f73','call','Ligar para retomar conversa',null,'571b3e25-f6ab-4cdc-9a35-7c51bc5f3160','e0b3c11a-7105-43a1-aeb0-9ee69860410c',null,null,-10325159,false,null,-10217704,'voicemail'),
   ('376bf747-b7f3-4034-a705-add9704a8c17','task','Preparar apresentação',null,'f1fef135-91fa-4ca7-acc3-b42ccbf257d8','e0b3c11a-7105-43a1-aeb0-9ee69860410c','ff58127d-821e-4c91-9f87-71a85a002c5d',null,-13526834,false,null,-13401179,null),
   ('2b9f4f0d-8153-45f2-b1ad-3fe29a969781','call','Ligar para retomar conversa','Conversa sobre prazos e orçamento.','bb2886c6-e86b-4316-8711-fd8d0ac9852d','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','b64488b8-87aa-43a9-9e8d-ec30f237ad49',1,-2343948,false,null,null,null),
   ('9381ba4a-2275-483b-a12e-979e07f5798b','task','Atualizar cadastro',null,'bf3179b8-bd98-47ae-9826-6ebc1cc98f5b','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,0,-1465557,false,null,null,null),
   ('407720a3-3e6d-4764-bd8b-b9b2d70b0646','call','Retorno sobre a proposta',null,'ced25445-204a-452c-9a3e-b378e3d47455','747cc141-41bb-49ab-a414-dfde9a53274d','56001edf-6d7c-4a0c-9912-fd598426a167',0,-16877237,false,null,-16846874,'answered'),
   ('2769022b-984e-445d-a1d6-3362e4afd636','email','Mandar resumo da reunião',null,'4c58f30c-dfb9-4588-8eba-9367b5d12eab','87c2ffa1-4952-4513-b626-e9c30294446f','fc68fa6d-9e67-4087-9672-25db726884fd',2,-18074201,false,null,-17927140,null),
   ('93086c5c-6b3b-423d-911d-ea04764f4783','call','Retorno sobre a proposta',null,'599bc692-c82c-4c66-9f7e-826484653b47','87c2ffa1-4952-4513-b626-e9c30294446f','9f628572-2bd5-4712-a71a-a0497f27353e',2,-15536794,false,null,-15481381,'voicemail'),
   ('1543b838-7207-4857-8b3f-30693f610fa0','call','Retorno sobre a proposta','Conversa sobre prazos e orçamento.','5d9f075b-9704-4d98-9c69-47bf68436775','e0b3c11a-7105-43a1-aeb0-9ee69860410c','a71d1cb8-ea40-49bd-a7e3-fe0c589dde3a',2,-9001230,false,null,-8911924,'answered'),
   ('8c3982c0-4488-4d8d-b3a3-24e3b895b432','task','Revisar contrato',null,'b82555a0-247e-421b-9169-b55a15a189f2','e0b3c11a-7105-43a1-aeb0-9ee69860410c','f1c0bdd7-edee-4735-91c0-393606163276',1,12685,false,null,null,null),
   ('5b0f0d5c-e3b2-4d35-88c1-d9ea9333c0b9','task','Revisar contrato',null,'488d4a9f-aef3-4f06-b1d8-a0c4a82ef8f9','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,2,5181188,false,null,null,null),
   ('92a75064-e291-4ae7-95f8-8d829d750f9d','email','Enviar material por e-mail',null,'4c58f30c-dfb9-4588-8eba-9367b5d12eab','87c2ffa1-4952-4513-b626-e9c30294446f','f38a4a2e-c601-48d6-8b8e-262715244f1c',null,-7223260,false,null,-7053139,null),
   ('daac207b-c74f-4e59-8154-83d2619816f9','task','Revisar contrato',null,'838d541f-5df1-4ea8-bbec-4b16aa53f927','7a3d1a42-27f5-4e61-85e2-77297c12f4c3','2234d3b9-074c-499c-b43d-07499a443331',1,null,false,null,null,null),
   ('c2f3a219-5e46-40e1-9588-fb53d9088eb6','call','Ligação de qualificação',null,'b82555a0-247e-421b-9169-b55a15a189f2','e0b3c11a-7105-43a1-aeb0-9ee69860410c','f1c0bdd7-edee-4735-91c0-393606163276',2,3692973,false,null,null,null),
   ('64bd3cc5-5447-47d6-8a8b-31e8eade668b','email','Mandar resumo da reunião',null,'e7b60f58-bcf5-4af0-ac62-8ad9bc7a38c7','8e33b7cf-64ff-4006-8b18-9813b4c53853',null,2,8037,false,null,null,null),
   ('96b7c851-779b-4522-af4e-c8328872caa6','email','Mandar resumo da reunião',null,'5012ae5e-e4dc-4cb2-96be-20b477b772ef','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','5de1327f-328d-4a19-9a5c-c04d2d3498a1',1,-15984184,false,null,-15927198,null),
   ('aa02cf82-8c82-401b-951d-060628af3e74','meeting','Reunião de diagnóstico',null,'7d1e28ff-8e2b-49f4-951d-e05c9276a01c','747cc141-41bb-49ab-a414-dfde9a53274d','e07234da-f320-4ed9-950f-6987d831e7c0',0,3826896,false,3830496,null,null),
   ('9cd35111-4d9c-4dae-9dc1-11f0a7ae7f5b','whatsapp','Mandar a proposta pelo WhatsApp',null,null,'c909b7f3-92c8-4fd5-a103-c7de22cd0ca1',null,1,null,false,null,null,null),
   ('61d3f441-78bb-4e16-a239-ec4f008a8743','task','Revisar contrato','Combinar o próximo passo com o cliente.','4c58f30c-dfb9-4588-8eba-9367b5d12eab','87c2ffa1-4952-4513-b626-e9c30294446f','fc68fa6d-9e67-4087-9672-25db726884fd',0,-13772644,false,null,-13630083,null),
   ('a70570ff-f54c-45fe-b2e9-b3466e7c9336','task','Enviar proposta',null,'bb2886c6-e86b-4316-8711-fd8d0ac9852d','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,null,-18866442,false,null,-18774132,null),
   ('018b3cd2-5cca-443c-a5e7-54f5f79a5593','note','Decisão depende do sócio','Cliente pediu para retomar a conversa no mês que vem.','b82555a0-247e-421b-9169-b55a15a189f2','e0b3c11a-7105-43a1-aeb0-9ee69860410c','f1c0bdd7-edee-4735-91c0-393606163276',1,null,false,null,-5315284,null),
   ('fed0489d-3b56-4a1f-bc52-2895ce2ad4fe','task','Enviar proposta','Combinar o próximo passo com o cliente.','e58e4c6d-956b-4f1e-9a0d-eb69c5bcbc46','87c2ffa1-4952-4513-b626-e9c30294446f','4875ad35-c35d-45bf-ac34-0d22620d4f82',0,-4363003,false,null,-4204855,null),
   ('20e86175-c3aa-4489-86b7-253288657794','task','Preparar apresentação',null,'ced25445-204a-452c-9a3e-b378e3d47455','747cc141-41bb-49ab-a414-dfde9a53274d','56001edf-6d7c-4a0c-9912-fd598426a167',2,-3907033,false,null,-3867270,null),
   ('49c2b6a5-29af-4c11-bd22-e84c9f3448ba','meeting','Reunião de fechamento',null,'5d9f075b-9704-4d98-9c69-47bf68436775','e0b3c11a-7105-43a1-aeb0-9ee69860410c','a71d1cb8-ea40-49bd-a7e3-fe0c589dde3a',1,8658,false,12258,null,null),
   ('314a86b9-2896-41de-803f-b51517b6db4c','email','Responder dúvidas por e-mail','Material enviado com o resumo da proposta.','bd5455dc-95e8-4d28-9e58-f73f9eff815f','80a8a040-144f-4bb8-8c00-b322411643bb','ad106e7e-582d-4379-9a8b-03a1486eebea',2,null,false,null,null,null),
   ('c948f286-b0c3-44cf-bd1a-9afef19d6f80','note','Decisão depende do sócio',null,null,null,'2eb5994b-e387-4253-bbb0-8d1c8a235dcb',2,null,false,null,-8641626,null),
   ('666096da-2ebf-4081-b29c-cb174b7fd10f','note','Decisão depende do sócio','Cliente pediu para retomar a conversa no mês que vem.','5012ae5e-e4dc-4cb2-96be-20b477b772ef','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','9de5aec7-cd3e-4848-b74d-a8a871438325',0,null,false,null,-29151255,null),
   ('84229168-d01d-4347-be3e-3f0d0cafee7f','call','Retorno sobre a proposta',null,'4c58f30c-dfb9-4588-8eba-9367b5d12eab','87c2ffa1-4952-4513-b626-e9c30294446f','fc68fa6d-9e67-4087-9672-25db726884fd',1,4046804,false,null,null,null),
   ('9cf1c6b3-8817-4875-848a-95e35b348ac5','email','Enviar material por e-mail',null,'7d1e28ff-8e2b-49f4-951d-e05c9276a01c','747cc141-41bb-49ab-a414-dfde9a53274d',null,1,1072164,false,null,null,null),
   ('6bb3332f-d0e4-48bc-92e6-7ad2cf1e11b8','task','Preparar apresentação',null,'757b643f-89cb-4924-8756-a5127b23c349','747cc141-41bb-49ab-a414-dfde9a53274d',null,2,-2493911,false,null,null,null),
   ('913eda71-74fd-416e-9064-33d9df670617','email','Responder dúvidas por e-mail',null,'1ba3d805-bd93-4183-add2-c551c23f2fb0','40ae8d4f-276c-461e-9da3-000dbf4b6a76','ee1bda3d-8f88-4d66-8559-563c964dd7ff',0,-8991253,false,null,-8964671,null),
   ('8e590eab-265a-4b17-98cd-758468055109','task','Preparar apresentação',null,'ced25445-204a-452c-9a3e-b378e3d47455','747cc141-41bb-49ab-a414-dfde9a53274d','56001edf-6d7c-4a0c-9912-fd598426a167',1,-992138,false,null,-949681,null),
   ('04c43edf-81e4-41b6-a336-f05d6f23eb9d','email','Mandar resumo da reunião',null,null,'8b9145e0-3af7-42d8-84ba-8e1a782cfb04',null,0,-18037287,false,null,-17995832,null),
   ('83569dc5-039d-405d-880d-41a73d4758a5','call','Ligação de qualificação',null,'e7b60f58-bcf5-4af0-ac62-8ad9bc7a38c7','8e33b7cf-64ff-4006-8b18-9813b4c53853',null,0,-27041360,false,null,-26876714,'no_answer'),
   ('d045215b-d39f-4d44-8842-0e1f158b8ba3','call','Retorno sobre a proposta',null,'d83eeb66-5c7d-4e1b-b321-8c504017f86a','37f28669-b7ea-4f80-bf70-73d17b7a0476','5d9c33e7-a54b-4b66-ae36-191a749cad94',0,-15398918,false,null,-15310974,'voicemail'),
   ('2d588016-8af2-46bc-bc4f-51d0e82980fa','meeting','Reunião de fechamento','Pauta: necessidades, prazos e próximos passos.',null,'8e33b7cf-64ff-4006-8b18-9813b4c53853','12c5df45-c99d-45bb-893c-12e4809c15db',2,null,false,null,null,null),
   ('c7ff2bdc-03c4-445b-bc6d-9b573455fb51','meeting','Reunião de diagnóstico',null,null,'8b9145e0-3af7-42d8-84ba-8e1a782cfb04',null,0,-606934,false,-605134,null,null),
   ('5ef943e0-5656-4314-ba8b-ed18be2df777','whatsapp','Enviar o contrato',null,'ced25445-204a-452c-9a3e-b378e3d47455','747cc141-41bb-49ab-a414-dfde9a53274d','cae9cd7b-7b3a-465d-895a-fb99be1bf6f7',1,-21263923,false,null,-21214076,null),
   ('2e98b09a-4053-4aa9-aadd-489e45a2c8d2','meeting','Reunião de fechamento',null,null,'e0b3c11a-7105-43a1-aeb0-9ee69860410c',null,1,-28402631,false,-28400831,-28329135,null),
   ('7016e163-24fb-4a73-b7ec-fe20cc4ff649','email','Enviar material por e-mail',null,null,'747cc141-41bb-49ab-a414-dfde9a53274d',null,1,-20235854,false,null,-20087858,null),
   ('b23df774-0cec-4901-adf5-c959c44680fd','task','Atualizar cadastro',null,null,'87c2ffa1-4952-4513-b626-e9c30294446f',null,2,-7200429,false,null,-7031593,null),
   ('153afa29-eb8a-4c49-8ab0-9908f144aae5','task','Atualizar cadastro',null,'5d9f075b-9704-4d98-9c69-47bf68436775','e0b3c11a-7105-43a1-aeb0-9ee69860410c',null,2,-13449643,false,null,-13384366,null),
   ('5965ecf0-6026-4726-a436-8dafc34af48d','task','Revisar contrato',null,'d83eeb66-5c7d-4e1b-b321-8c504017f86a','37f28669-b7ea-4f80-bf70-73d17b7a0476','5d9c33e7-a54b-4b66-ae36-191a749cad94',null,-15389643,false,null,-15263565,null),
   ('3111891f-5f9d-424f-8041-09925a737d01','call','Ligar para retomar conversa','Conversa sobre prazos e orçamento.','f1fef135-91fa-4ca7-acc3-b42ccbf257d8','e0b3c11a-7105-43a1-aeb0-9ee69860410c','ff58127d-821e-4c91-9f87-71a85a002c5d',1,-20140883,false,null,-20108315,'voicemail'),
   ('2ab69e12-53f7-4f01-a589-c01f148caa91','task','Revisar contrato',null,'488d4a9f-aef3-4f06-b1d8-a0c4a82ef8f9','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',null,0,-9418944,false,null,-9258716,null),
   ('d56e3e82-8b99-4241-a177-729450cfdced','meeting','Apresentação da solução',null,'1ba3d805-bd93-4183-add2-c551c23f2fb0','40ae8d4f-276c-461e-9da3-000dbf4b6a76','9a0aa229-159d-4bfd-b06e-3ec841c9755b',0,4370,false,6170,null,null),
   ('67dc7088-ad68-418e-ade3-e5b1ee9b9fa7','email','Enviar material por e-mail',null,'5012ae5e-e4dc-4cb2-96be-20b477b772ef','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','38e32d4a-a2d1-4692-86e9-0261d41d63ad',1,-5408731,false,null,-5397686,null),
   ('6193c727-3f97-402a-82cb-457d65231adc','email','Enviar material por e-mail',null,null,'40ae8d4f-276c-461e-9da3-000dbf4b6a76','eb58b8bb-ee8b-4d29-9859-9bf1bdd010d2',0,-26507177,false,null,-26432594,null),
   ('107aaf44-966c-4274-b5cb-e021ed621a84','task','Preparar apresentação',null,'571b3e25-f6ab-4cdc-9a35-7c51bc5f3160','7a3d1a42-27f5-4e61-85e2-77297c12f4c3',null,1,-476756,false,null,null,null),
   ('21b7c81d-a66c-4934-a040-ea745910fba8','note','Cliente pediu desconto',null,null,'747cc141-41bb-49ab-a414-dfde9a53274d',null,0,null,false,null,-30013988,null),
   ('ba8898d5-010a-4d5d-8e17-d3f267e41593','meeting','Reunião de diagnóstico','Pauta: necessidades, prazos e próximos passos.','838d541f-5df1-4ea8-bbec-4b16aa53f927','7a3d1a42-27f5-4e61-85e2-77297c12f4c3','2234d3b9-074c-499c-b43d-07499a443331',2,3954099,false,3957699,null,null),
   ('ac6bdfd9-15d5-4f61-95d0-f249ec3c1c2e','task','Enviar proposta',null,'0c42ea4e-bec8-4ae8-900b-7416f7b10e7e','8b9145e0-3af7-42d8-84ba-8e1a782cfb04',null,2,-1944347,false,null,null,null),
   ('4c424613-6370-45be-9615-9461035ea327','task','Enviar proposta',null,'5342dd18-935d-470a-80f9-3698bb264116','747cc141-41bb-49ab-a414-dfde9a53274d','07662451-4b9a-4c10-b1dd-dcbfe0047f30',0,-6770740,false,null,-6715695,null),
   ('7823d72f-a5ed-4b1e-83b7-70245201186c','task','Preparar apresentação',null,'bb2886c6-e86b-4316-8711-fd8d0ac9852d','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','b64488b8-87aa-43a9-9e8d-ec30f237ad49',0,-26673671,false,null,-26592823,null),
   ('86bf666d-7109-4de9-a27e-c0320049c227','call','Retornar a ligação sobre a proposta','Ficou de responder até hoje de manhã.','0c42ea4e-bec8-4ae8-900b-7416f7b10e7e',null,null,0,-10800,false,null,null,null),
   ('8cd94588-e819-4edf-916d-5b6641c87093','whatsapp','Enviar a proposta pelo WhatsApp','Mensagem com o link da proposta.','0c42ea4e-bec8-4ae8-900b-7416f7b10e7e',null,null,0,null,true,null,null,null),
   ('dafd8d2d-d86b-4ed1-9aac-1ca8de438cc8','visit','Visita para apresentar a equipe de implantação',null,'757b643f-89cb-4924-8756-a5127b23c349','747cc141-41bb-49ab-a414-dfde9a53274d',null,0,439200,false,446400,null,null),
   ('4b44eb61-0d7f-42a0-942e-b89b063696f3','meeting','Reunião de alinhamento do contrato',null,'bd5455dc-95e8-4d28-9e58-f73f9eff815f','80a8a040-144f-4bb8-8c00-b322411643bb',null,1,90000,false,93600,null,null),
   ('f1e0c647-e47b-4ba2-b9e8-886f651a3fb2','call','Ligação de apresentação','Atendeu, mas disse que não tem interesse.','2aba3e10-3349-4b37-a5e2-5faf98b45fc5','e14f0543-f3e5-404e-bea2-d905604d8207',null,0,-1123200,false,null,-1123200,'answered'),
   ('7733aeca-d206-4e17-bdf9-32f0e973d50d','note','Pediu para não ser mais contatado',null,'2aba3e10-3349-4b37-a5e2-5faf98b45fc5','e14f0543-f3e5-404e-bea2-d905604d8207',null,0,null,false,null,-1036800,null),
   ('54e7d3aa-4676-4170-adc0-c573ac3c4f01','email','Enviar o orçamento pedido no site',null,'0623b60d-71de-486f-bed5-e87839b536a9','e0b3c11a-7105-43a1-aeb0-9ee69860410c',null,1,-259200,false,null,-259200,null),
   ('47e0ec8f-ddf7-4742-9a60-63ad71564aca','whatsapp','Conversa com Igor Teixeira sobre a feira','Igor pediu o catálogo.','49ee78ea-c4b3-4faa-89d5-e0e017e0a36f',null,null,0,-2678400,false,null,-2678400,null),
   ('83d48eb1-3c0d-487c-9098-68888c12c79c','call','Ligar para o Igor',null,'49ee78ea-c4b3-4faa-89d5-e0e017e0a36f',null,null,0,172800,false,null,null,null)
  ) v(id,type,title,body,contact_id,company_id,deal_id,slot,due,due_today,ends,completed,outcome);

 insert into public.payments(id,org_id,description,amount,status,contact_id,company_id,deal_id,due_date,paid_at)
  select v.id::uuid,v_org,v.description,v.amount::numeric,v.status,v.contact_id::uuid,v.company_id::uuid,v.deal_id::uuid,
   v_today+v.due::integer,case when v.paid is null then null else v_now+make_interval(secs=>v.paid::integer) end from (values
   ('397d93cb-481f-411b-b157-edf48f23c868','Entrada da implantação','3500.00','paid','5342dd18-935d-470a-80f9-3698bb264116','747cc141-41bb-49ab-a414-dfde9a53274d','07662451-4b9a-4c10-b1dd-dcbfe0047f30',-20,-1641600),
   ('f227f910-0641-40af-8e83-b82af81f388d','Mensalidade da consultoria','1200.00','pending','5342dd18-935d-470a-80f9-3698bb264116','747cc141-41bb-49ab-a414-dfde9a53274d','07662451-4b9a-4c10-b1dd-dcbfe0047f30',10,null),
   ('bd71a2e1-839a-45bb-9745-2a960202e959','Licenças do mês','809.10','pending','1ba3d805-bd93-4183-add2-c551c23f2fb0','40ae8d4f-276c-461e-9da3-000dbf4b6a76','9a0aa229-159d-4bfd-b06e-3ec841c9755b',-5,null),
   ('31ddc56c-0ae6-4126-a8af-28fd55ce3bed','Treinamento da equipe','1440.00','paid','1ba3d805-bd93-4183-add2-c551c23f2fb0','40ae8d4f-276c-461e-9da3-000dbf4b6a76','9a0aa229-159d-4bfd-b06e-3ec841c9755b',-30,-2419200),
   ('a585c14e-0c76-4e2d-82b4-d6c0e531900c','Parcela renegociada','1500.00','cancelled','5012ae5e-e4dc-4cb2-96be-20b477b772ef','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','9de5aec7-cd3e-4848-b74d-a8a871438325',-15,null),
   ('eda737dd-b151-4695-8dd7-33e069f2483c','Diagnóstico avulso','650.00','pending',null,'87c2ffa1-4952-4513-b626-e9c30294446f',null,25,null)
  ) v(id,description,amount,status,contact_id,company_id,deal_id,due,paid);

 insert into public.email_templates(id,org_id,name,subject,body)
  select v.id::uuid,v_org,v.name,v.subject,v.body from (values
   ('32799f27-a8a8-41dd-9b80-e7b270a7299e','Primeiro contato pelo WhatsApp','','Olá, {{primeiro_nome}}! Aqui é {{meu_nome}}, da {{organizacao}}. Podemos conversar sobre {{empresa}} esta semana?'),
   ('0d974b14-0348-459f-ba2a-e36624d9f184','Envio da proposta','Proposta para {{empresa}}','Olá, {{nome}}.

Segue a proposta de {{oportunidade}}, como combinamos. Fico à disposição para tirar dúvidas.

{{meu_nome}}
{{organizacao}}'),
   ('05fad61e-e067-444a-8fcb-d09e85bf9ab9','Retomar a conversa','Vamos retomar?','Oi, {{primeiro_nome}}! Passando para saber se faz sentido retomarmos a conversa sobre {{oportunidade}}.')
  ) v(id,name,subject,body);

 -- Anonimização de demonstração (item 1.10), pela função privada, como o Dono: exclui a ação pendente, limpa o texto
 -- do que ficou e grava o registro em "Segurança", "Exportações e anonimizações".
 perform private.anonymize_contact('49ee78ea-c4b3-4faa-89d5-e0e017e0a36f'::uuid,(select c.updated_at from public.contacts c where c.id='49ee78ea-c4b3-4faa-89d5-e0e017e0a36f'::uuid));

 insert into public.automations(id,org_id,name,trigger_type,pipeline_id,stage_id,is_active,task_title,due_days) values
   ('d35d3448-6946-4a70-a113-99420703e67f',v_org,'Primeira ligação do negócio novo','deal_created',null,null,true,'Fazer a primeira ligação',1),
   ('35652b43-1ab6-460e-8681-1f03c85f11f6',v_org,'Preparar a proposta','deal_moved',v_pipeline,v_stages[1+(2%array_length(v_stages,1))],true,'Enviar a proposta em até 2 dias',2),
   ('89635af6-440b-429d-b222-70e06e00149c',v_org,'Boas-vindas ao cliente','deal_won',null,null,true,'Agendar a reunião de implantação',3),
   ('4b4f4603-fa21-4440-92c0-c7cc460e69ce',v_org,'Lembrete da negociação (pausada)','deal_moved',v_pipeline,v_stages[1+(3%array_length(v_stages,1))],false,'Revisar as condições com o gestor',1);
 -- A movimentação que dispara "Preparar a proposta": a tarefa nasce e o registro aparece em "Automações".
 perform public.move_deal('f1c0bdd7-edee-4735-91c0-393606163276'::uuid,v_stages[1+(2%array_length(v_stages,1))]);

 -- 5. Datas relativas ao momento da execução. Os gatilhos gravaram agora em created_at, stage_entered_at e closed_at;
 -- com os gatilhos de usuário desligados só nesta etapa (FKs e CHECKs continuam valendo), cada linha recebe a sua data.
 alter table public.products disable trigger user;
 alter table public.companies disable trigger user;
 alter table public.contacts disable trigger user;
 alter table public.deals disable trigger user;
 alter table public.activities disable trigger user;
 alter table public.payments disable trigger user;
 update public.products p set created_at=v_now+make_interval(secs=>v.created),updated_at=v_now+make_interval(secs=>v.created)
  from (values
   ('3e441001-9025-4649-8918-247fe1148322',-17280000),
   ('ae86cf68-7d10-46b0-b065-01d226b95dd6',-17193600),
   ('4f8df8b5-f496-4659-b03b-c69c9336a70e',-17107200),
   ('4f5b60d7-3aa9-459a-ac20-31296db6c5f9',-17020800),
   ('8e66d480-d1e1-4f6d-93b7-c46c9eec56a1',-16934400),
   ('ef7de367-2e3b-4644-8e25-02bf3943a13f',-16848000)
  ) v(id,created) where p.id=v.id::uuid;
 update public.companies c set created_at=v_now+make_interval(secs=>v.created),updated_at=v_now+make_interval(secs=>v.updated)
  from (values
   ('e14f0543-f3e5-404e-bea2-d905604d8207',-31409510,-31315921),
   ('e0b3c11a-7105-43a1-aeb0-9ee69860410c',-35987796,-35426447),
   ('87c2ffa1-4952-4513-b626-e9c30294446f',-52326280,-52002223),
   ('ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e',-17024869,-15564557),
   ('7a3d1a42-27f5-4e61-85e2-77297c12f4c3',-12519846,-12184892),
   ('84fcd972-0992-4b38-a6f9-3314ae779e75',-7664796,-7600109),
   ('747cc141-41bb-49ab-a414-dfde9a53274d',-31363842,-30465834),
   ('c909b7f3-92c8-4fd5-a103-c7de22cd0ca1',-40076117,-39694945),
   ('37f28669-b7ea-4f80-bf70-73d17b7a0476',-15966886,-15266150),
   ('40ae8d4f-276c-461e-9da3-000dbf4b6a76',-62028131,-60522111),
   ('19016cb4-1dc3-46a2-a9c3-32c758fe1533',-46853978,-46242745),
   ('7048915f-b32f-4407-8f93-772272dc1d0c',-28763132,-27982973),
   ('7bf04f4b-430e-47ab-94d1-ab235775d7a7',-32961417,-32689956),
   ('80a8a040-144f-4bb8-8c00-b322411643bb',-5279722,-4427426),
   ('8b9145e0-3af7-42d8-84ba-8e1a782cfb04',-19664150,-19487160),
   ('8e33b7cf-64ff-4006-8b18-9813b4c53853',-51367953,-49922010)
  ) v(id,created,updated) where c.id=v.id::uuid;
 update public.contacts c set created_at=v_now+make_interval(secs=>v.created),legal_basis_at=v_now+make_interval(secs=>v.created),
  updated_at=case when c.anonymized_at is null then v_now+make_interval(secs=>v.updated) else c.updated_at end,
  do_not_contact_at=case when c.do_not_contact then v_now+make_interval(secs=>v.updated) end
  from (values
   ('756541cd-4458-465b-b5de-47da7ba2d528',-42776,0),
   ('7bd2850e-2584-491f-9e7d-19c1c62fb753',-174843,0),
   ('6eb5e889-cf4b-4f52-85a8-b73248b74c92',-213916,0),
   ('437b0ec6-34d6-4865-bcaf-bf993f2f25bf',-231351,0),
   ('0c42ea4e-bec8-4ae8-900b-7416f7b10e7e',-61839578,-61187327),
   ('757b643f-89cb-4924-8756-a5127b23c349',-26521739,-25850463),
   ('bd5455dc-95e8-4d28-9e58-f73f9eff815f',-40178512,-38652457),
   ('599bc692-c82c-4c66-9f7e-826484653b47',-50564804,-50272016),
   ('5342dd18-935d-470a-80f9-3698bb264116',-24014455,-23099889),
   ('5d9f075b-9704-4d98-9c69-47bf68436775',-18443699,-17496671),
   ('f823ad77-fcf1-479b-b102-cc4a9cdbd574',-42000,0),
   ('0f3cd40b-7610-482c-8777-6a6ec94dc00d',-242773,0),
   ('8af1a4c8-5258-4830-9b31-0426c793c9e3',-214823,0),
   ('b9d21bef-96a8-40da-86b7-2a7488ef9f25',-197955,0),
   ('7d1e28ff-8e2b-49f4-951d-e05c9276a01c',-14485843,-12954726),
   ('d83eeb66-5c7d-4e1b-b321-8c504017f86a',-54155423,-53192706),
   ('e58e4c6d-956b-4f1e-9a0d-eb69c5bcbc46',-56290226,-55573438),
   ('1ba3d805-bd93-4183-add2-c551c23f2fb0',-10798859,-9113747),
   ('5012ae5e-e4dc-4cb2-96be-20b477b772ef',-56208018,-55945655),
   ('b82555a0-247e-421b-9169-b55a15a189f2',-39582002,-37985607),
   ('605174e1-3f83-4a06-9d1c-12330b13c7c3',-34831,0),
   ('85ad697a-06ab-4575-be92-adc6e6c347d0',-224469,0),
   ('b427834d-a09d-44e8-baf8-1589f409a895',-206948,0),
   ('1eb320b1-a79f-45c0-b0d9-2bfcac8cb204',-245111,0),
   ('4a123824-9b68-4844-9561-2693349f44e2',-17584995,-16928983),
   ('e7b60f58-bcf5-4af0-ac62-8ad9bc7a38c7',-7277738,-6826013),
   ('4c58f30c-dfb9-4588-8eba-9367b5d12eab',-37421973,-36498821),
   ('488d4a9f-aef3-4f06-b1d8-a0c4a82ef8f9',-42438691,-41562753),
   ('2ccea6dc-c5b8-4134-ba8e-6e1e23a33957',-40572594,-40003849),
   ('ced25445-204a-452c-9a3e-b378e3d47455',-49767782,-48840812),
   ('f40d9358-efe6-45de-882d-01d177542f84',-55826,0),
   ('c330b700-b73d-42e5-b6fa-d5383511a31b',-242114,-100548),
   ('8f253a01-1a54-4531-8501-c169ccbf1def',-191691,0),
   ('06125602-1c11-4d19-94a3-cea060168bf2',-239809,0),
   ('838d541f-5df1-4ea8-bbec-4b16aa53f927',-28346651,-26981267),
   ('bf3179b8-bd98-47ae-9826-6ebc1cc98f5b',-29688058,-28699265),
   ('bb2886c6-e86b-4316-8711-fd8d0ac9852d',-55300392,-54929074),
   ('786cbbaf-a0ce-480e-af60-673a90630049',-24232928,-23875522),
   ('3073bda5-a564-43d1-b652-e34012d53afb',-21673508,-20093498),
   ('6afce140-3799-495f-9020-7272782a94fc',-61570578,-60794110),
   ('eac5b1c9-9290-4791-b785-439d1f6fd340',-6337,0),
   ('6e326226-052a-4a7e-b687-bbd7e0eab758',-247220,0),
   ('f1086e9f-b230-43a5-8525-8901642a2085',-178551,0),
   ('721fa076-a6af-4b9f-b2c9-09be6cef8588',-194175,0),
   ('157966e1-0407-490d-a075-c1a3b76f4b0e',-5513880,-4149383),
   ('af8912b8-175e-4a3f-b987-58fc5ebb1b0a',-15047910,-13633756),
   ('f1fef135-91fa-4ca7-acc3-b42ccbf257d8',-52454915,-51534516),
   ('571b3e25-f6ab-4cdc-9a35-7c51bc5f3160',-56074329,-55789154),
   ('2aba3e10-3349-4b37-a5e2-5faf98b45fc5',-25920000,-1036800),
   ('0623b60d-71de-486f-bed5-e87839b536a9',-3456000,-259200),
   ('49ee78ea-c4b3-4faa-89d5-e0e017e0a36f',-7776000,-2592000)
  ) v(id,created,updated) where c.id=v.id::uuid;
 update public.deals x set created_at=v_now+make_interval(secs=>v.created),updated_at=v_now+make_interval(secs=>v.updated),
  stage_entered_at=v_now+make_interval(secs=>v.entered),
  closed_at=case when x.status='open' then null else v_now+make_interval(secs=>v.closed::integer) end
  from (values
   ('07662451-4b9a-4c10-b1dd-dcbfe0047f30',-14168915,-8960668,-12821293,-8960668),
   ('a71d1cb8-ea40-49bd-a7e3-fe0c589dde3a',-8104822,-5145282,-5533363,null),
   ('f38a4a2e-c601-48d6-8b8e-262715244f1c',-17973975,-8412817,-16584099,null),
   ('fc68fa6d-9e67-4087-9672-25db726884fd',-23934653,-18088846,-21690319,null),
   ('56001edf-6d7c-4a0c-9912-fd598426a167',-12559495,-6144456,-11282493,null),
   ('eb58b8bb-ee8b-4d29-9859-9bf1bdd010d2',-26973621,-19342854,-26763027,null),
   ('ff58127d-821e-4c91-9f87-71a85a002c5d',-31117153,-23524936,-28959180,null),
   ('9a0aa229-159d-4bfd-b06e-3ec841c9755b',-20812387,-11625820,-20476308,-16999157),
   ('9de5aec7-cd3e-4848-b74d-a8a871438325',-5162785,0,-3336083,0),
   ('9f628572-2bd5-4712-a71a-a0497f27353e',-25764215,-17460139,-25746232,null),
   ('2234d3b9-074c-499c-b43d-07499a443331',-1858751,0,-1751061,0),
   ('ee1bda3d-8f88-4d66-8559-563c964dd7ff',-5747327,-4095383,-4095383,null),
   ('6d189d05-7f0f-4f92-99ba-49aa01b21340',-5003329,0,-4593142,null),
   ('e9c13325-d567-4f34-9555-7a3b1a4bd393',-15561976,-5821529,-13353802,null),
   ('cae9cd7b-7b3a-465d-895a-fb99be1bf6f7',-7224961,-4625047,-4823009,null),
   ('ad106e7e-582d-4379-9a8b-03a1486eebea',-17063723,-15352782,-15533267,null),
   ('838d21dc-d9bc-4e7f-8865-e2252a86061a',-16274268,-12066296,-14324372,-12066296),
   ('e0828859-932a-4d14-8da7-4fe287730d4a',-4927396,0,-3720172,-37240),
   ('e07234da-f320-4ed9-950f-6987d831e7c0',-23827152,-16555545,-21402926,null),
   ('4875ad35-c35d-45bf-ac34-0d22620d4f82',-23311125,-19657159,-22040584,-20961868),
   ('838a0e12-89cc-4625-a513-acd314d553ac',-244602,0,0,null),
   ('2eb5994b-e387-4253-bbb0-8d1c8a235dcb',-17180039,-10248397,-15456734,-13548467),
   ('08dbe0f5-8175-42b3-b69d-894642d98aff',-23725328,-14244778,-21188457,null),
   ('b64488b8-87aa-43a9-9e8d-ec30f237ad49',-17566599,-9187020,-15349146,null),
   ('12c5df45-c99d-45bb-893c-12e4809c15db',-16292969,-13550166,-15340925,-13550166),
   ('39dc7bab-2a12-490a-a82b-fcb5f353f838',-9422801,0,-7695980,null),
   ('5d9c33e7-a54b-4b66-ae36-191a749cad94',-12834133,-5624814,-12181538,-5940515),
   ('38e32d4a-a2d1-4692-86e9-0261d41d63ad',-17540249,-12919615,-15349868,null),
   ('af3f2d0a-5a01-431a-8512-d95ca53d994e',-19142411,-11810703,-17853034,-16828848),
   ('09304b27-e87d-4fb9-a44c-ee18f6a41674',-8448025,-1567272,-7351863,null),
   ('5de1327f-328d-4a19-9a5c-c04d2d3498a1',-2410340,0,-1630854,0)
  ) v(id,created,updated,entered,closed) where x.id=v.id::uuid;
 update public.deals x set created_at=v_now+make_interval(secs=>-20293134)
  where x.id='f1c0bdd7-edee-4735-91c0-393606163276'::uuid;
 update public.deal_stage_history h set created_at=x.created_at from public.deals x
  where h.deal_id=x.id and h.from_status is null and x.id=any(array['07662451-4b9a-4c10-b1dd-dcbfe0047f30','a71d1cb8-ea40-49bd-a7e3-fe0c589dde3a','f38a4a2e-c601-48d6-8b8e-262715244f1c','fc68fa6d-9e67-4087-9672-25db726884fd','56001edf-6d7c-4a0c-9912-fd598426a167','eb58b8bb-ee8b-4d29-9859-9bf1bdd010d2','ff58127d-821e-4c91-9f87-71a85a002c5d','9a0aa229-159d-4bfd-b06e-3ec841c9755b','9de5aec7-cd3e-4848-b74d-a8a871438325','9f628572-2bd5-4712-a71a-a0497f27353e','2234d3b9-074c-499c-b43d-07499a443331','ee1bda3d-8f88-4d66-8559-563c964dd7ff','6d189d05-7f0f-4f92-99ba-49aa01b21340','f1c0bdd7-edee-4735-91c0-393606163276','e9c13325-d567-4f34-9555-7a3b1a4bd393','cae9cd7b-7b3a-465d-895a-fb99be1bf6f7','ad106e7e-582d-4379-9a8b-03a1486eebea','838d21dc-d9bc-4e7f-8865-e2252a86061a','e0828859-932a-4d14-8da7-4fe287730d4a','e07234da-f320-4ed9-950f-6987d831e7c0','4875ad35-c35d-45bf-ac34-0d22620d4f82','838a0e12-89cc-4625-a513-acd314d553ac','2eb5994b-e387-4253-bbb0-8d1c8a235dcb','08dbe0f5-8175-42b3-b69d-894642d98aff','b64488b8-87aa-43a9-9e8d-ec30f237ad49','12c5df45-c99d-45bb-893c-12e4809c15db','39dc7bab-2a12-490a-a82b-fcb5f353f838','5d9c33e7-a54b-4b66-ae36-191a749cad94','38e32d4a-a2d1-4692-86e9-0261d41d63ad','af3f2d0a-5a01-431a-8512-d95ca53d994e','09304b27-e87d-4fb9-a44c-ee18f6a41674','5de1327f-328d-4a19-9a5c-c04d2d3498a1']::uuid[]);
 update public.activities a set created_at=v_now+make_interval(secs=>v.created),updated_at=v_now+make_interval(secs=>v.updated)
  from (values
   ('c0e1157e-eebb-42e2-a16d-0d655e4a1d70',-24252493,-22407613),
   ('24b16eeb-853c-4120-850a-e6aef11a708e',-13242047,-11807089),
   ('c27508ae-ea97-45f9-b69a-c21a6322b2fe',-12024201,-10375696),
   ('5c31ae04-b435-4e4f-8fc4-540430352ccb',-8734737,-8666474),
   ('1118622a-2302-4812-ad21-f0c2f1260d91',-14946966,-14556884),
   ('376f803c-b7a6-46c3-bdf8-a6be66aab512',-29367905,-27743186),
   ('58a7d16b-f508-4d79-88f0-816fd75e6fe6',-2221595,-2150001),
   ('bf2d0f8f-12f9-4030-bb3e-33ba90f88393',-22079750,-22028884),
   ('c812e3bd-c7df-4535-9466-e1f90f94ed39',-12080067,-12057837),
   ('427972f5-b17a-4492-929e-964bc6a6028d',-13813926,-13764982),
   ('ccc8c0ed-8219-4d5e-9b3c-df36f39382eb',-10058114,-9082947),
   ('1788b4a6-8cf4-45a4-ba83-69ae58e3f01b',-29004885,-28712202),
   ('1f0d7b92-530b-43f8-96a4-d4d6f29ae3f7',-29288564,-29236984),
   ('1e48c536-b327-48ea-9f10-e65d6567ed3d',-20397321,-18615249),
   ('448892da-1a4c-4c32-b9d7-4a85cacc6b73',-17608284,-17321181),
   ('2fa87528-b440-42ba-900a-6714b9970811',-16274710,-16221850),
   ('1a9e7c5b-c0e3-4b7f-bbfd-d89332866b13',-26492516,-26461929),
   ('c992c10b-9259-40da-93bc-e09429bf2022',-29223351,-29177004),
   ('ca571dec-3d48-4371-a8ca-04159c55540e',-9478992,-7263115),
   ('f3c223bf-b8c7-46e7-8b89-eff2880e8677',-5171502,-4972498),
   ('204903e1-555d-405a-b118-ff7e1386a7d6',-30231614,-30166114),
   ('807f2d03-f500-42f6-a5cd-87c39fa75d2e',-10240623,-10155947),
   ('d4bd8ada-880d-48e2-bd9a-bf6e4c4f08de',-19786454,-18522880),
   ('7b169201-7727-4a4e-8ef7-01a003ed2ec1',-8404526,-7292941),
   ('90a7cdee-c8f4-4668-87a1-4a5f926b21a1',-21024399,-20989400),
   ('1b5ab78c-7576-4cb0-b03a-955a3a497466',-15314650,-15238720),
   ('050d0353-003b-4b87-ae68-1dfe241c7f16',-11202962,-11131595),
   ('0230e1e6-c1cb-4290-8a03-4f71e51f0563',-28342238,-28301815),
   ('5b38a825-4309-453b-bec0-661894f7417c',-31441804,-31417516),
   ('dac08da4-c4ad-4886-bb31-0d8b341c5750',-1531928,-1451699),
   ('56ac5f16-c235-4299-b95a-00eec10bac3f',-14774314,-14698507),
   ('7a7c069a-1677-42ea-910c-7223033d5e89',-731244,-680290),
   ('6fcfa019-1c08-4a45-b8ea-642ccb738965',-13372453,-11960399),
   ('169fa947-b914-412d-9827-0ce3613df802',-13805549,-13772437),
   ('6d53a2c9-7682-48cc-9d88-d816a2fedb4f',-16665970,-16632760),
   ('883d5adb-7786-4e8f-9b01-bdd721efa8b1',-10222301,-10219340),
   ('d713fc49-aaee-4876-a4d1-5d27b7e07ba1',-9411462,-7183330),
   ('bb2501ba-7525-40b3-bef8-6474a182db08',-2004472,-1993964),
   ('e5e20994-f035-42c5-a489-6c52f13ac178',-14082874,-13071593),
   ('50f4f8d5-fc84-4c16-98c8-f7b3755d0a45',-29064023,-27823343),
   ('f1816fcb-788a-4852-b62b-a8769281b927',-18442621,-18359218),
   ('4af486eb-12ba-4732-9a96-4e966c2eac31',-27063257,-27027088),
   ('f8fa41e6-f68a-44a0-8569-b40896d3e80e',-323252,-307166),
   ('02b08fc7-51af-4d7d-b47b-3d0a97c0c45c',-30356328,-30317296),
   ('2eb5d539-f2ca-4056-be69-b210fd716e9a',-22005207,-21999809),
   ('bfa008d7-19d7-439d-845d-b05ae2aaa5fd',-17144946,-17047343),
   ('072c70fc-8e91-4ca5-a8bc-8e3563245c9c',-24066602,-23150524),
   ('07b03f70-46e5-4554-aec9-6b9fd0073f73',-12226156,-10155465),
   ('376bf747-b7f3-4034-a705-add9704a8c17',-15430523,-13352265),
   ('2b9f4f0d-8153-45f2-b1ad-3fe29a969781',-22905514,-22879893),
   ('9381ba4a-2275-483b-a12e-979e07f5798b',-24591890,-24567527),
   ('407720a3-3e6d-4764-bd8b-b9b2d70b0646',-17186120,-16766717),
   ('2769022b-984e-445d-a1d6-3362e4afd636',-18419193,-17874483),
   ('93086c5c-6b3b-423d-911d-ea04764f4783',-17975248,-15415973),
   ('1543b838-7207-4857-8b3f-30693f610fa0',-11466678,-8907886),
   ('8c3982c0-4488-4d8d-b3a3-24e3b895b432',-23593698,-23528674),
   ('5b0f0d5c-e3b2-4d35-88c1-d9ea9333c0b9',-16482088,-16403908),
   ('92a75064-e291-4ae7-95f8-8d829d750f9d',-7643409,-7029011),
   ('daac207b-c74f-4e59-8154-83d2619816f9',-9728590,-9712438),
   ('c2f3a219-5e46-40e1-9588-fb53d9088eb6',-20444033,-20437309),
   ('64bd3cc5-5447-47d6-8a8b-31e8eade668b',-16577272,-16518367),
   ('96b7c851-779b-4522-af4e-c8328872caa6',-18314369,-15870054),
   ('aa02cf82-8c82-401b-951d-060628af3e74',-28021349,-28012374),
   ('9cd35111-4d9c-4dae-9dc1-11f0a7ae7f5b',-20812416,-20788412),
   ('61d3f441-78bb-4e16-a239-ec4f008a8743',-15902095,-13552174),
   ('a70570ff-f54c-45fe-b2e9-b3466e7c9336',-19945699,-18760819),
   ('018b3cd2-5cca-443c-a5e7-54f5f79a5593',-5315284,-5296844),
   ('fed0489d-3b56-4a1f-bc52-2895ce2ad4fe',-5325630,-4120638),
   ('20e86175-c3aa-4489-86b7-253288657794',-4039323,-3854288),
   ('49c2b6a5-29af-4c11-bd22-e84c9f3448ba',-4291479,-4226940),
   ('314a86b9-2896-41de-803f-b51517b6db4c',-4616134,-4582010),
   ('c948f286-b0c3-44cf-bd1a-9afef19d6f80',-8641626,-8628755),
   ('666096da-2ebf-4081-b29c-cb174b7fd10f',-29151255,-29106175),
   ('84229168-d01d-4347-be3e-3f0d0cafee7f',-7624334,-7580076),
   ('9cf1c6b3-8817-4875-848a-95e35b348ac5',-8536787,-8502693),
   ('6bb3332f-d0e4-48bc-92e6-7ad2cf1e11b8',-24946396,-24895922),
   ('913eda71-74fd-416e-9064-33d9df670617',-10505001,-8916851),
   ('8e590eab-265a-4b17-98cd-758468055109',-2103108,-900779),
   ('04c43edf-81e4-41b6-a336-f05d6f23eb9d',-18302611,-17987227),
   ('83569dc5-039d-405d-880d-41a73d4758a5',-29061997,-26872003),
   ('d045215b-d39f-4d44-8842-0e1f158b8ba3',-15806084,-15238129),
   ('2d588016-8af2-46bc-bc4f-51d0e82980fa',-14773676,-14724646),
   ('c7ff2bdc-03c4-445b-bc6d-9b573455fb51',-25562907,-25533414),
   ('5ef943e0-5656-4314-ba8b-ed18be2df777',-21639832,-21194413),
   ('2e98b09a-4053-4aa9-aadd-489e45a2c8d2',-29326612,-28299604),
   ('7016e163-24fb-4a73-b7ec-fe20cc4ff649',-22293191,-20042519),
   ('b23df774-0cec-4901-adf5-c959c44680fd',-7825518,-6966695),
   ('153afa29-eb8a-4c49-8ab0-9908f144aae5',-15290628,-13309335),
   ('5965ecf0-6026-4726-a436-8dafc34af48d',-16602581,-15237132),
   ('3111891f-5f9d-424f-8041-09925a737d01',-20355312,-20036609),
   ('2ab69e12-53f7-4f01-a589-c01f148caa91',-12001603,-9217202),
   ('d56e3e82-8b99-4241-a177-729450cfdced',-839607,-821281),
   ('67dc7088-ad68-418e-ade3-e5b1ee9b9fa7',-5854982,-5340606),
   ('6193c727-3f97-402a-82cb-457d65231adc',-27265987,-26430918),
   ('107aaf44-966c-4274-b5cb-e021ed621a84',-12793158,-12789789),
   ('21b7c81d-a66c-4934-a040-ea745910fba8',-30013988,-29961819),
   ('ba8898d5-010a-4d5d-8e17-d3f267e41593',-9141082,-9063553),
   ('ac6bdfd9-15d5-4f61-95d0-f249ec3c1c2e',-29701659,-29645577),
   ('4c424613-6370-45be-9615-9461035ea327',-7321850,-6702376),
   ('7823d72f-a5ed-4b1e-83b7-70245201186c',-28751783,-26520413),
   ('86bf666d-7109-4de9-a27e-c0320049c227',-172800,-172800),
   ('8cd94588-e819-4edf-916d-5b6641c87093',-172800,-172800),
   ('dafd8d2d-d86b-4ed1-9aac-1ca8de438cc8',-172800,-172800),
   ('4b44eb61-0d7f-42a0-942e-b89b063696f3',-172800,-172800),
   ('f1e0c647-e47b-4ba2-b9e8-886f651a3fb2',-1209600,-1123200),
   ('7733aeca-d206-4e17-bdf9-32f0e973d50d',-1036800,-1036800),
   ('54e7d3aa-4676-4170-adc0-c573ac3c4f01',-345600,-259200),
   ('47e0ec8f-ddf7-4742-9a60-63ad71564aca',-2764800,-2678400),
   ('83d48eb1-3c0d-487c-9098-68888c12c79c',-172800,-172800)
  ) v(id,created,updated) where a.id=v.id::uuid;
 update public.payments p set created_at=v_now+make_interval(secs=>v.created),updated_at=v_now+make_interval(secs=>v.created)
  from (values
   ('397d93cb-481f-411b-b157-edf48f23c868',-2160000),
   ('f227f910-0641-40af-8e83-b82af81f388d',-2160000),
   ('bd71a2e1-839a-45bb-9745-2a960202e959',-3024000),
   ('31ddc56c-0ae6-4126-a8af-28fd55ce3bed',-3024000),
   ('a585c14e-0c76-4e2d-82b4-d6c0e531900c',-3888000),
   ('eda737dd-b151-4695-8dd7-33e069f2483c',-518400)
  ) v(id,created) where p.id=v.id::uuid;
 alter table public.products enable trigger user;
 alter table public.companies enable trigger user;
 alter table public.contacts enable trigger user;
 alter table public.deals enable trigger user;
 alter table public.activities enable trigger user;
 alter table public.payments enable trigger user;

 perform set_config('request.jwt.claims','',true);
 raise notice 'Dados de demonstração criados: % contatos, % empresas, % oportunidades e % atividades.',51,16,32,109;
end
$seed$;

-- Resumo, para o editor SQL mostrar o resultado.
select 'Dados de demonstração criados' as resultado,
 (select count(*) from public.contacts) as contatos,
 (select count(*) from public.companies) as empresas,
 (select count(*) from public.deals) as oportunidades,
 (select count(*) from public.activities) as atividades,
 (select count(*) from public.products) as itens_do_catalogo,
 (select count(*) from public.payments) as recebimentos;
