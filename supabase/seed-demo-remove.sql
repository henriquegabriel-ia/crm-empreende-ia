-- Apaga os dados de demonstração do CRM (item 1.15 do roteiro; docs/arquitetura/1.15.md).
-- ARQUIVO GERADO por `npm run seed:demo` a partir de scripts/lib/demo-seed.mjs: não edite à mão.
--
-- O que apaga: só o que supabase/seed-demo.sql criou (reconhecido pelos identificadores fixos da demonstração) e o que
-- depende disso: as atividades e os recebimentos ligados a um contato, a uma empresa ou a uma oportunidade da
-- demonstração (inclusive os registrados em aula e as tarefas das automações) e os itens dessas oportunidades.
-- Contatos, empresas, oportunidades, itens do catálogo, automações e modelos criados por pessoas ficam.
--
-- Quando recusa (sem apagar nada): se um registro criado por uma pessoa aponta para a demonstração. São eles: um contato
-- ligado a uma empresa fictícia; uma oportunidade ligada a um contato, a uma empresa ou ao funil "Parcerias" da
-- demonstração; uma oportunidade que já passou por uma etapa do funil "Parcerias" (o histórico de etapas não muda, e
-- apagar o funil o quebraria); um item de oportunidade com um item do catálogo da demonstração; e uma automação com
-- filtro no funil "Parcerias" (apagar o funil a deixaria pausada e sem filtro). A mensagem diz quantos são e o que fazer
-- com cada um; depois de resolver esses registros, rode a remoção de novo.
--
-- O histórico de auditoria e o registro da anonimização de demonstração (em "Segurança", "Exportações e anonimizações")
-- ficam, como todo histórico.
--
-- Como rodar: no painel do Supabase, "SQL Editor", "New query", cole este arquivo inteiro e clique em "Run".
-- Nunca rode este arquivo pelo navegador, pelo app ou pela API.

do $remove$
declare
 v_org uuid;
 v_owner uuid;
 v_contacts uuid[]:=array['756541cd-4458-465b-b5de-47da7ba2d528','7bd2850e-2584-491f-9e7d-19c1c62fb753','6eb5e889-cf4b-4f52-85a8-b73248b74c92','437b0ec6-34d6-4865-bcaf-bf993f2f25bf','0c42ea4e-bec8-4ae8-900b-7416f7b10e7e','757b643f-89cb-4924-8756-a5127b23c349','bd5455dc-95e8-4d28-9e58-f73f9eff815f','599bc692-c82c-4c66-9f7e-826484653b47','5342dd18-935d-470a-80f9-3698bb264116','5d9f075b-9704-4d98-9c69-47bf68436775','f823ad77-fcf1-479b-b102-cc4a9cdbd574','0f3cd40b-7610-482c-8777-6a6ec94dc00d','8af1a4c8-5258-4830-9b31-0426c793c9e3','b9d21bef-96a8-40da-86b7-2a7488ef9f25','7d1e28ff-8e2b-49f4-951d-e05c9276a01c','d83eeb66-5c7d-4e1b-b321-8c504017f86a','e58e4c6d-956b-4f1e-9a0d-eb69c5bcbc46','1ba3d805-bd93-4183-add2-c551c23f2fb0','5012ae5e-e4dc-4cb2-96be-20b477b772ef','b82555a0-247e-421b-9169-b55a15a189f2','605174e1-3f83-4a06-9d1c-12330b13c7c3','85ad697a-06ab-4575-be92-adc6e6c347d0','b427834d-a09d-44e8-baf8-1589f409a895','1eb320b1-a79f-45c0-b0d9-2bfcac8cb204','4a123824-9b68-4844-9561-2693349f44e2','e7b60f58-bcf5-4af0-ac62-8ad9bc7a38c7','4c58f30c-dfb9-4588-8eba-9367b5d12eab','488d4a9f-aef3-4f06-b1d8-a0c4a82ef8f9','2ccea6dc-c5b8-4134-ba8e-6e1e23a33957','ced25445-204a-452c-9a3e-b378e3d47455','f40d9358-efe6-45de-882d-01d177542f84','c330b700-b73d-42e5-b6fa-d5383511a31b','8f253a01-1a54-4531-8501-c169ccbf1def','06125602-1c11-4d19-94a3-cea060168bf2','838d541f-5df1-4ea8-bbec-4b16aa53f927','bf3179b8-bd98-47ae-9826-6ebc1cc98f5b','bb2886c6-e86b-4316-8711-fd8d0ac9852d','786cbbaf-a0ce-480e-af60-673a90630049','3073bda5-a564-43d1-b652-e34012d53afb','6afce140-3799-495f-9020-7272782a94fc','eac5b1c9-9290-4791-b785-439d1f6fd340','6e326226-052a-4a7e-b687-bbd7e0eab758','f1086e9f-b230-43a5-8525-8901642a2085','721fa076-a6af-4b9f-b2c9-09be6cef8588','157966e1-0407-490d-a075-c1a3b76f4b0e','af8912b8-175e-4a3f-b987-58fc5ebb1b0a','f1fef135-91fa-4ca7-acc3-b42ccbf257d8','571b3e25-f6ab-4cdc-9a35-7c51bc5f3160','2aba3e10-3349-4b37-a5e2-5faf98b45fc5','0623b60d-71de-486f-bed5-e87839b536a9','49ee78ea-c4b3-4faa-89d5-e0e017e0a36f']::uuid[];
 v_companies uuid[]:=array['e14f0543-f3e5-404e-bea2-d905604d8207','e0b3c11a-7105-43a1-aeb0-9ee69860410c','87c2ffa1-4952-4513-b626-e9c30294446f','ecf61b2a-f3ef-4d6e-8e3b-7bfbbd3f360e','7a3d1a42-27f5-4e61-85e2-77297c12f4c3','84fcd972-0992-4b38-a6f9-3314ae779e75','747cc141-41bb-49ab-a414-dfde9a53274d','c909b7f3-92c8-4fd5-a103-c7de22cd0ca1','37f28669-b7ea-4f80-bf70-73d17b7a0476','40ae8d4f-276c-461e-9da3-000dbf4b6a76','19016cb4-1dc3-46a2-a9c3-32c758fe1533','7048915f-b32f-4407-8f93-772272dc1d0c','7bf04f4b-430e-47ab-94d1-ab235775d7a7','80a8a040-144f-4bb8-8c00-b322411643bb','8b9145e0-3af7-42d8-84ba-8e1a782cfb04','8e33b7cf-64ff-4006-8b18-9813b4c53853']::uuid[];
 v_deals uuid[]:=array['07662451-4b9a-4c10-b1dd-dcbfe0047f30','a71d1cb8-ea40-49bd-a7e3-fe0c589dde3a','f38a4a2e-c601-48d6-8b8e-262715244f1c','fc68fa6d-9e67-4087-9672-25db726884fd','56001edf-6d7c-4a0c-9912-fd598426a167','eb58b8bb-ee8b-4d29-9859-9bf1bdd010d2','ff58127d-821e-4c91-9f87-71a85a002c5d','9a0aa229-159d-4bfd-b06e-3ec841c9755b','9de5aec7-cd3e-4848-b74d-a8a871438325','9f628572-2bd5-4712-a71a-a0497f27353e','2234d3b9-074c-499c-b43d-07499a443331','ee1bda3d-8f88-4d66-8559-563c964dd7ff','6d189d05-7f0f-4f92-99ba-49aa01b21340','f1c0bdd7-edee-4735-91c0-393606163276','e9c13325-d567-4f34-9555-7a3b1a4bd393','cae9cd7b-7b3a-465d-895a-fb99be1bf6f7','ad106e7e-582d-4379-9a8b-03a1486eebea','838d21dc-d9bc-4e7f-8865-e2252a86061a','e0828859-932a-4d14-8da7-4fe287730d4a','e07234da-f320-4ed9-950f-6987d831e7c0','4875ad35-c35d-45bf-ac34-0d22620d4f82','838a0e12-89cc-4625-a513-acd314d553ac','2eb5994b-e387-4253-bbb0-8d1c8a235dcb','08dbe0f5-8175-42b3-b69d-894642d98aff','b64488b8-87aa-43a9-9e8d-ec30f237ad49','12c5df45-c99d-45bb-893c-12e4809c15db','39dc7bab-2a12-490a-a82b-fcb5f353f838','5d9c33e7-a54b-4b66-ae36-191a749cad94','38e32d4a-a2d1-4692-86e9-0261d41d63ad','af3f2d0a-5a01-431a-8512-d95ca53d994e','09304b27-e87d-4fb9-a44c-ee18f6a41674','5de1327f-328d-4a19-9a5c-c04d2d3498a1']::uuid[];
 v_activities uuid[]:=array['c0e1157e-eebb-42e2-a16d-0d655e4a1d70','24b16eeb-853c-4120-850a-e6aef11a708e','c27508ae-ea97-45f9-b69a-c21a6322b2fe','5c31ae04-b435-4e4f-8fc4-540430352ccb','1118622a-2302-4812-ad21-f0c2f1260d91','376f803c-b7a6-46c3-bdf8-a6be66aab512','58a7d16b-f508-4d79-88f0-816fd75e6fe6','bf2d0f8f-12f9-4030-bb3e-33ba90f88393','c812e3bd-c7df-4535-9466-e1f90f94ed39','427972f5-b17a-4492-929e-964bc6a6028d','ccc8c0ed-8219-4d5e-9b3c-df36f39382eb','1788b4a6-8cf4-45a4-ba83-69ae58e3f01b','1f0d7b92-530b-43f8-96a4-d4d6f29ae3f7','1e48c536-b327-48ea-9f10-e65d6567ed3d','448892da-1a4c-4c32-b9d7-4a85cacc6b73','2fa87528-b440-42ba-900a-6714b9970811','1a9e7c5b-c0e3-4b7f-bbfd-d89332866b13','c992c10b-9259-40da-93bc-e09429bf2022','ca571dec-3d48-4371-a8ca-04159c55540e','f3c223bf-b8c7-46e7-8b89-eff2880e8677','204903e1-555d-405a-b118-ff7e1386a7d6','807f2d03-f500-42f6-a5cd-87c39fa75d2e','d4bd8ada-880d-48e2-bd9a-bf6e4c4f08de','7b169201-7727-4a4e-8ef7-01a003ed2ec1','90a7cdee-c8f4-4668-87a1-4a5f926b21a1','1b5ab78c-7576-4cb0-b03a-955a3a497466','050d0353-003b-4b87-ae68-1dfe241c7f16','0230e1e6-c1cb-4290-8a03-4f71e51f0563','5b38a825-4309-453b-bec0-661894f7417c','dac08da4-c4ad-4886-bb31-0d8b341c5750','56ac5f16-c235-4299-b95a-00eec10bac3f','7a7c069a-1677-42ea-910c-7223033d5e89','6fcfa019-1c08-4a45-b8ea-642ccb738965','169fa947-b914-412d-9827-0ce3613df802','6d53a2c9-7682-48cc-9d88-d816a2fedb4f','883d5adb-7786-4e8f-9b01-bdd721efa8b1','d713fc49-aaee-4876-a4d1-5d27b7e07ba1','bb2501ba-7525-40b3-bef8-6474a182db08','e5e20994-f035-42c5-a489-6c52f13ac178','50f4f8d5-fc84-4c16-98c8-f7b3755d0a45','f1816fcb-788a-4852-b62b-a8769281b927','4af486eb-12ba-4732-9a96-4e966c2eac31','f8fa41e6-f68a-44a0-8569-b40896d3e80e','02b08fc7-51af-4d7d-b47b-3d0a97c0c45c','2eb5d539-f2ca-4056-be69-b210fd716e9a','bfa008d7-19d7-439d-845d-b05ae2aaa5fd','072c70fc-8e91-4ca5-a8bc-8e3563245c9c','07b03f70-46e5-4554-aec9-6b9fd0073f73','376bf747-b7f3-4034-a705-add9704a8c17','2b9f4f0d-8153-45f2-b1ad-3fe29a969781','9381ba4a-2275-483b-a12e-979e07f5798b','407720a3-3e6d-4764-bd8b-b9b2d70b0646','2769022b-984e-445d-a1d6-3362e4afd636','93086c5c-6b3b-423d-911d-ea04764f4783','1543b838-7207-4857-8b3f-30693f610fa0','8c3982c0-4488-4d8d-b3a3-24e3b895b432','5b0f0d5c-e3b2-4d35-88c1-d9ea9333c0b9','92a75064-e291-4ae7-95f8-8d829d750f9d','daac207b-c74f-4e59-8154-83d2619816f9','c2f3a219-5e46-40e1-9588-fb53d9088eb6','64bd3cc5-5447-47d6-8a8b-31e8eade668b','96b7c851-779b-4522-af4e-c8328872caa6','aa02cf82-8c82-401b-951d-060628af3e74','9cd35111-4d9c-4dae-9dc1-11f0a7ae7f5b','61d3f441-78bb-4e16-a239-ec4f008a8743','a70570ff-f54c-45fe-b2e9-b3466e7c9336','018b3cd2-5cca-443c-a5e7-54f5f79a5593','fed0489d-3b56-4a1f-bc52-2895ce2ad4fe','20e86175-c3aa-4489-86b7-253288657794','49c2b6a5-29af-4c11-bd22-e84c9f3448ba','314a86b9-2896-41de-803f-b51517b6db4c','c948f286-b0c3-44cf-bd1a-9afef19d6f80','666096da-2ebf-4081-b29c-cb174b7fd10f','84229168-d01d-4347-be3e-3f0d0cafee7f','9cf1c6b3-8817-4875-848a-95e35b348ac5','6bb3332f-d0e4-48bc-92e6-7ad2cf1e11b8','913eda71-74fd-416e-9064-33d9df670617','8e590eab-265a-4b17-98cd-758468055109','04c43edf-81e4-41b6-a336-f05d6f23eb9d','83569dc5-039d-405d-880d-41a73d4758a5','d045215b-d39f-4d44-8842-0e1f158b8ba3','2d588016-8af2-46bc-bc4f-51d0e82980fa','c7ff2bdc-03c4-445b-bc6d-9b573455fb51','5ef943e0-5656-4314-ba8b-ed18be2df777','2e98b09a-4053-4aa9-aadd-489e45a2c8d2','7016e163-24fb-4a73-b7ec-fe20cc4ff649','b23df774-0cec-4901-adf5-c959c44680fd','153afa29-eb8a-4c49-8ab0-9908f144aae5','5965ecf0-6026-4726-a436-8dafc34af48d','3111891f-5f9d-424f-8041-09925a737d01','2ab69e12-53f7-4f01-a589-c01f148caa91','d56e3e82-8b99-4241-a177-729450cfdced','67dc7088-ad68-418e-ade3-e5b1ee9b9fa7','6193c727-3f97-402a-82cb-457d65231adc','107aaf44-966c-4274-b5cb-e021ed621a84','21b7c81d-a66c-4934-a040-ea745910fba8','ba8898d5-010a-4d5d-8e17-d3f267e41593','ac6bdfd9-15d5-4f61-95d0-f249ec3c1c2e','4c424613-6370-45be-9615-9461035ea327','7823d72f-a5ed-4b1e-83b7-70245201186c','86bf666d-7109-4de9-a27e-c0320049c227','8cd94588-e819-4edf-916d-5b6641c87093','dafd8d2d-d86b-4ed1-9aac-1ca8de438cc8','4b44eb61-0d7f-42a0-942e-b89b063696f3','f1e0c647-e47b-4ba2-b9e8-886f651a3fb2','7733aeca-d206-4e17-bdf9-32f0e973d50d','54e7d3aa-4676-4170-adc0-c573ac3c4f01','47e0ec8f-ddf7-4742-9a60-63ad71564aca','83d48eb1-3c0d-487c-9098-68888c12c79c']::uuid[];
 v_payments uuid[]:=array['397d93cb-481f-411b-b157-edf48f23c868','f227f910-0641-40af-8e83-b82af81f388d','bd71a2e1-839a-45bb-9745-2a960202e959','31ddc56c-0ae6-4126-a8af-28fd55ce3bed','a585c14e-0c76-4e2d-82b4-d6c0e531900c','eda737dd-b151-4695-8dd7-33e069f2483c']::uuid[];
 v_products uuid[]:=array['3e441001-9025-4649-8918-247fe1148322','ae86cf68-7d10-46b0-b065-01d226b95dd6','4f8df8b5-f496-4659-b03b-c69c9336a70e','4f5b60d7-3aa9-459a-ac20-31296db6c5f9','8e66d480-d1e1-4f6d-93b7-c46c9eec56a1','ef7de367-2e3b-4644-8e25-02bf3943a13f']::uuid[];
 v_automations uuid[]:=array['d35d3448-6946-4a70-a113-99420703e67f','35652b43-1ab6-460e-8681-1f03c85f11f6','89635af6-440b-429d-b222-70e06e00149c','4b4f4603-fa21-4440-92c0-c7cc460e69ce']::uuid[];
 v_templates uuid[]:=array['32799f27-a8a8-41dd-9b80-e7b270a7299e','0d974b14-0348-459f-ba2a-e36624d9f184','05fad61e-e067-444a-8fcb-d09e85bf9ab9']::uuid[];
 v_pipeline uuid:='2f860930-4560-42c8-a2a0-cc109b7cd66e';
 v_blocking text;
 v_removed jsonb:='{}'::jsonb;
 v_n integer;
begin
 if current_user in ('anon','authenticated','service_role') or coalesce(current_setting('request.jwt.claims',true),'')<>'' then
  raise exception 'A remoção da demonstração roda só no editor SQL do painel do Supabase. Nada foi apagado.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('crm.demo_seed',0));
 if (select count(*) from public.organizations)<>1 then
  raise exception 'Este CRM não tem exatamente uma empresa. Nada foi apagado.';
 end if;
 select o.id into v_org from public.organizations o;
 -- Qualquer registro com identificador fixo conta: a turma pode ter excluído pela tela só uma parte da demonstração.
 if not exists(select 1 from public.contacts where org_id=v_org and id=any(v_contacts))
  and not exists(select 1 from public.companies where org_id=v_org and id=any(v_companies))
  and not exists(select 1 from public.deals where org_id=v_org and id=any(v_deals))
  and not exists(select 1 from public.activities where org_id=v_org and id=any(v_activities))
  and not exists(select 1 from public.payments where org_id=v_org and id=any(v_payments))
  and not exists(select 1 from public.products where org_id=v_org and id=any(v_products))
  and not exists(select 1 from public.automations where org_id=v_org and id=any(v_automations))
  and not exists(select 1 from public.email_templates where org_id=v_org and id=any(v_templates))
  and not exists(select 1 from public.pipelines where org_id=v_org and id=v_pipeline) then
  raise exception 'Este CRM não tem dados de demonstração. Nada foi apagado.';
 end if;

 -- Registros criados por pessoas que apontam para a demonstração: recusa, sem apagar nada, com o que fazer em cada caso.
 select string_agg(format('%s %s',n,label),'; ') into v_blocking from (values
   ((select count(*) from public.contacts where org_id=v_org and id<>all(v_contacts) and company_id=any(v_companies)),
    'contato(s) ligado(s) a uma empresa da demonstração: tire a empresa do contato ou exclua o contato'),
   ((select count(*) from public.deals where org_id=v_org and id<>all(v_deals)
     and (contact_id=any(v_contacts) or company_id=any(v_companies) or pipeline_id=v_pipeline)),
    'oportunidade(s) ligada(s) a um contato, a uma empresa ou ao funil Parcerias da demonstração: troque o vínculo ou exclua a oportunidade'),
   -- O histórico de etapas aponta para as etapas sem ON DELETE e não pode ser alterado: apagar o funil falharia.
   ((select count(*) from public.deals d where d.org_id=v_org and d.id<>all(v_deals) and d.pipeline_id<>v_pipeline
     and exists(select 1 from public.deal_stage_history h join public.pipeline_stages s
      on s.org_id=h.org_id and s.id in (h.from_stage_id,h.to_stage_id)
      where h.org_id=v_org and h.deal_id=d.id and s.pipeline_id=v_pipeline)),
    'oportunidade(s) que já passaram pelo funil Parcerias da demonstração: o histórico de etapas não muda, então exclua a oportunidade ou mantenha a demonstração'),
   ((select count(*) from public.deal_items where org_id=v_org and deal_id<>all(v_deals) and product_id=any(v_products)),
    'item(ns) de oportunidade com um item do catálogo da demonstração: troque o item ou tire-o da oportunidade'),
   -- Apagar o funil tiraria o filtro dessas automações e as pausaria (ON DELETE SET NULL), sem aviso.
   ((select count(*) from public.automations a where a.org_id=v_org and a.id<>all(v_automations)
     and (a.pipeline_id=v_pipeline or a.stage_id in (select s.id from public.pipeline_stages s
      where s.org_id=v_org and s.pipeline_id=v_pipeline))),
    'automação(ões) com filtro no funil Parcerias da demonstração: troque o filtro ou exclua a automação')
  ) t(n,label) where n>0;
 if v_blocking is not null then
  raise exception 'Há registros criados por pessoas que apontam para a demonstração (%). Depois de resolver esses registros, rode a remoção de novo. Nada foi apagado.',v_blocking;
 end if;

 select r.user_id into v_owner from public.user_roles r join public.profiles p on p.id=r.user_id
  where r.org_id=v_org and r.deactivated_at is null and r.role='owner' order by p.created_at,r.user_id limit 1;
 if v_owner is not null then
  perform set_config('request.jwt.claims',json_build_object('sub',v_owner,'role','authenticated')::text,true);
 end if;

 delete from public.activities where org_id=v_org and (id=any(v_activities) or contact_id=any(v_contacts)
  or company_id=any(v_companies) or deal_id=any(v_deals));
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('atividades',v_n);
 delete from public.payments where org_id=v_org and (id=any(v_payments) or contact_id=any(v_contacts)
  or company_id=any(v_companies) or deal_id=any(v_deals));
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('recebimentos',v_n);
 delete from public.deals where org_id=v_org and id=any(v_deals);
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('oportunidades',v_n);
 delete from public.contacts where org_id=v_org and id=any(v_contacts);
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('contatos',v_n);
 delete from public.companies where org_id=v_org and id=any(v_companies);
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('empresas',v_n);
 delete from public.products where org_id=v_org and id=any(v_products);
 get diagnostics v_n=row_count; v_removed:=v_removed||jsonb_build_object('itens_do_catalogo',v_n);
 delete from public.automations where org_id=v_org and id=any(v_automations);
 delete from public.email_templates where org_id=v_org and id=any(v_templates);
 delete from public.pipelines where org_id=v_org and id=v_pipeline;
 perform set_config('request.jwt.claims','',true);
 raise notice 'Dados de demonstração apagados: %',v_removed;
end
$remove$;

select 'Dados de demonstração apagados' as resultado,
 (select count(*) from public.contacts) as contatos_restantes,
 (select count(*) from public.deals) as oportunidades_restantes;
