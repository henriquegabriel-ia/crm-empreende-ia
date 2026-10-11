-- Dados no formato anterior à migração de mesmo nome, gravados pelo `npm run test:db` logo antes dela,
-- como numa instância já em uso: funis, etapas e regras da fila de atenção ainda sem updated_at.
-- configuration-concurrency.sql confere que essas linhas recebem a versão da migração.
-- Sem gatilhos (session_replication_role=replica), como nos arquivos dos itens 0.6 e 0.7, para não gerar auditoria
-- na organização legada, que deal-lifecycle.sql confere. O funil e as etapas legados vêm de
-- 20261011100000_deal_closing_probability.sql; aqui entra só uma regra.
set session_replication_role=replica;
insert into public.risk_rules(id,org_id,name,type,enabled,threshold_days,priority) values
 ('93000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Oportunidades paradas','stale_deal',true,10,3);
