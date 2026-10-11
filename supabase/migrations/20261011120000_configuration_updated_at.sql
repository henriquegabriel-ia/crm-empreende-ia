-- Item 0.8 do roteiro: concorrência entre colegas.
-- Funis, etapas e regras da fila de atenção passam a ter updated_at, mantido pelo mesmo gatilho
-- private.touch_updated_at das demais tabelas. Assim Configurações grava com a guarda de concorrência
-- (.eq('updated_at', versão lida)), como contatos, empresas, oportunidades, atividades e recebimentos: a gravação
-- feita sobre uma versão antiga não encontra a linha e a tela mostra o conflito, em vez de sobrescrever a do colega.
-- As linhas existentes recebem o now() da migração: o default é avaliado uma vez, sem reescrever a tabela e sem
-- disparar gatilhos (nem auditoria).
-- As três tabelas já estão em protect_record_metadata e em audit_record_change, e a auditoria ignora updated_at.
-- Os GRANTs de tabela inteira (select, insert, update e delete para authenticated) já incluem a coluna nova.
alter table public.pipelines add column updated_at timestamptz not null default now();
alter table public.pipeline_stages add column updated_at timestamptz not null default now();
alter table public.risk_rules add column updated_at timestamptz not null default now();

-- Mesma regra das demais datas (20260906051341_immutable_metadata.sql): só valores finitos.
alter table public.pipelines add constraint pipelines_updated_at_finite check(isfinite(updated_at));
alter table public.pipeline_stages add constraint pipeline_stages_updated_at_finite check(isfinite(updated_at));
alter table public.risk_rules add constraint risk_rules_updated_at_finite check(isfinite(updated_at));

-- Toda edição renova a versão, inclusive quando o cliente tenta gravar updated_at diretamente.
create trigger touch_updated_at before update on public.pipelines for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.pipeline_stages for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.risk_rules for each row execute function private.touch_updated_at();
