-- Conferência da instância do CRM (item 1.4). ARQUIVO GERADO por npm run manifest:build a partir de
-- supabase/base-manifest.json: não edite à mão. Base 20261019120000_default_privileges.sql.
--
-- O que é: uma consulta só de leitura, que não grava nada. Confere o mínimo de segurança de uma instância: as migrações
-- da base aplicadas em ordem, a RLS ligada e as políticas das tabelas da base, nenhuma tabela, view ou função própria
-- aberta para a API, os gatilhos (inclusive os do Auth), o privilégio TRIGGER em auth.mfa_amr_claims, os privilégios
-- padrão, as permissões da API, as funções que decidem o acesso, o índice dos lembretes, uma empresa só e um dono ativo.
-- APROVADA é o mínimo de segurança, não a comparação do banco inteiro (essa é o supabase/db-drift-check.sql).
--
-- Como usar: copie o arquivo inteiro, cole no editor SQL do painel do Supabase (SQL Editor, New query), com o papel
-- padrão (postgres), e clique em Run. Não precisa de senha nem de chave.
--
-- Como ler: a primeira linha é o veredito, APROVADA ou REPROVADA. Cada verificação ocupa uma linha, aprovado ou
-- reprovado, com o que foi visto e o que fazer. As linhas de informação nunca mudam o veredito.
--
-- A configuração do Auth (a confirmação de e-mail, o cadastro e os provedores) não fica no banco: confira-a com
-- npm run verify-instance. Para comparar o banco inteiro com a base, depois de cada atualização ou personalização, use
-- supabase/db-drift-check.sql. Guia completo: docs/IMPLANTACAO.md
with params as (
  select 'postgres'::name as migration_role
), expected_migrations(version, name) as (values
    ('20260906051319', 'commercial_foundation'),
    ('20260906051330', 'commercial_search'),
    ('20260906051332', 'relationship_metadata'),
    ('20260906051334', 'workspace_membership_audit'),
    ('20260906051336', 'contact_identity'),
    ('20260906051338', 'security_followup'),
    ('20260906051341', 'immutable_metadata'),
    ('20260906051832', 'configuration_policies_by_operation'),
    ('20261011100000', 'deal_closing_probability'),
    ('20261011110000', 'deletions_automation_scope'),
    ('20261011120000', 'configuration_updated_at'),
    ('20261012100000', 'single_company_admission'),
    ('20261012110000', 'admission_email_proof'),
    ('20261013100000', 'member_deactivation'),
    ('20261013110000', 'channel_interactions'),
    ('20261013120000', 'contact_privacy'),
    ('20261018100000', 'privacy_followup'),
    ('20261019100000', 'product_catalog'),
    ('20261019110000', 'update_protection'),
    ('20261019120000', 'default_privileges')
), expected_tables(object) as (values
    ('private.base_overwrite_consents'),
    ('private.email_proofs'),
    ('public.activities'),
    ('public.audit_logs'),
    ('public.automation_logs'),
    ('public.automations'),
    ('public.companies'),
    ('public.contacts'),
    ('public.deal_items'),
    ('public.deal_stage_history'),
    ('public.deals'),
    ('public.email_templates'),
    ('public.integration_configs'),
    ('public.invitations'),
    ('public.onboarding_progress'),
    ('public.organizations'),
    ('public.payments'),
    ('public.pipeline_stages'),
    ('public.pipelines'),
    ('public.portfolio_transfers'),
    ('public.privacy_actions'),
    ('public.products'),
    ('public.profiles'),
    ('public.risk_rules'),
    ('public.user_roles')
), expected_triggers(object, enabled) as (values
    ('auth.mfa_amr_claims.record_email_proof', 'O'),
    ('auth.users.discard_unproven_password', 'O'),
    ('auth.users.enforce_invite_only_signup', 'O'),
    ('auth.users.on_auth_user_created', 'O'),
    ('auth.users.refuse_email_change_without_org', 'O'),
    ('public.activities.audit_record_change', 'O'),
    ('public.activities.guard_anonymized_contact', 'O'),
    ('public.activities.normalize_activity_outcome', 'O'),
    ('public.activities.protect_record_metadata', 'O'),
    ('public.activities.record_activity_author', 'O'),
    ('public.activities.refuse_do_not_contact_action', 'O'),
    ('public.activities.refuse_inactive_assignee', 'O'),
    ('public.activities.touch_updated_at', 'O'),
    ('public.activities.zz_custom_after_save', 'O'),
    ('public.activities.zz_custom_validate', 'O'),
    ('public.automations.audit_record_change', 'O'),
    ('public.automations.normalize_automation_scope', 'O'),
    ('public.automations.protect_record_metadata', 'O'),
    ('public.automations.touch_updated_at', 'O'),
    ('public.companies.audit_record_change', 'O'),
    ('public.companies.protect_record_metadata', 'O'),
    ('public.companies.refuse_inactive_assignee', 'O'),
    ('public.companies.stamp_do_not_contact', 'O'),
    ('public.companies.touch_updated_at', 'O'),
    ('public.companies.zz_custom_after_save', 'O'),
    ('public.companies.zz_custom_validate', 'O'),
    ('public.contacts.audit_record_change', 'O'),
    ('public.contacts.protect_anonymized_contact', 'O'),
    ('public.contacts.protect_record_metadata', 'O'),
    ('public.contacts.refuse_inactive_assignee', 'O'),
    ('public.contacts.stamp_do_not_contact', 'O'),
    ('public.contacts.stamp_legal_basis', 'O'),
    ('public.contacts.touch_updated_at', 'O'),
    ('public.contacts.zz_custom_after_save', 'O'),
    ('public.contacts.zz_custom_validate', 'O'),
    ('public.deal_items.audit_record_change', 'O'),
    ('public.deal_items.protect_record_metadata', 'O'),
    ('public.deal_items.touch_updated_at', 'O'),
    ('public.deals.audit_record_change', 'O'),
    ('public.deals.guard_anonymized_contact', 'O'),
    ('public.deals.protect_deal_totals', 'O'),
    ('public.deals.protect_record_metadata', 'O'),
    ('public.deals.record_deal_change', 'O'),
    ('public.deals.refuse_inactive_assignee', 'O'),
    ('public.deals.run_deal_automations', 'O'),
    ('public.deals.touch_updated_at', 'O'),
    ('public.deals.validate_deal_change', 'O'),
    ('public.deals.zz_custom_after_save', 'O'),
    ('public.deals.zz_custom_validate', 'O'),
    ('public.email_templates.audit_record_change', 'O'),
    ('public.email_templates.protect_record_metadata', 'O'),
    ('public.email_templates.touch_updated_at', 'O'),
    ('public.integration_configs.audit_record_change', 'O'),
    ('public.integration_configs.protect_record_metadata', 'O'),
    ('public.invitations.audit_record_change', 'O'),
    ('public.invitations.protect_record_metadata', 'O'),
    ('public.onboarding_progress.protect_record_metadata', 'O'),
    ('public.onboarding_progress.touch_updated_at', 'O'),
    ('public.organizations.protect_record_metadata', 'O'),
    ('public.organizations.stamp_default_legal_basis', 'O'),
    ('public.payments.audit_record_change', 'O'),
    ('public.payments.guard_anonymized_contact', 'O'),
    ('public.payments.protect_record_metadata', 'O'),
    ('public.payments.touch_updated_at', 'O'),
    ('public.pipeline_stages.audit_record_change', 'O'),
    ('public.pipeline_stages.protect_record_metadata', 'O'),
    ('public.pipeline_stages.touch_updated_at', 'O'),
    ('public.pipelines.audit_record_change', 'O'),
    ('public.pipelines.protect_record_metadata', 'O'),
    ('public.pipelines.touch_updated_at', 'O'),
    ('public.products.audit_record_change', 'O'),
    ('public.products.protect_record_metadata', 'O'),
    ('public.products.touch_updated_at', 'O'),
    ('public.profiles.protect_record_metadata', 'O'),
    ('public.profiles.touch_updated_at', 'O'),
    ('public.risk_rules.audit_record_change', 'O'),
    ('public.risk_rules.protect_record_metadata', 'O'),
    ('public.risk_rules.touch_updated_at', 'O'),
    ('public.user_roles.audit_record_change', 'O'),
    ('public.user_roles.protect_record_metadata', 'O')
), expected_acl(kind, object, acl) as (values
    ('function', 'private.accept_invitation(uuid)', 'authenticated=X'),
    ('function', 'private.anonymize_contact(uuid,timestamp with time zone)', 'authenticated=X'),
    ('function', 'private.assert_base_definition(text,text,text[])', ''),
    ('function', 'private.audit_record_change()', ''),
    ('function', 'private.automation_log_errors(uuid)', 'authenticated=X'),
    ('function', 'private.base_acl(aclitem[])', ''),
    ('function', 'private.base_fingerprints()', ''),
    ('function', 'private.can_manage()', 'authenticated=X'),
    ('function', 'private.can_write()', 'authenticated=X'),
    ('function', 'private.check_portfolio_recipient(uuid,uuid,uuid)', ''),
    ('function', 'private.contact_privacy_counts(uuid,public.contacts)', ''),
    ('function', 'private.contact_privacy_regex(text,text,text,text,boolean)', ''),
    ('function', 'private.contact_privacy_summary(uuid)', 'authenticated=X'),
    ('function', 'private.create_invitation(text,text)', 'authenticated=X'),
    ('function', 'private.create_workspace(text)', 'authenticated=X'),
    ('function', 'private.current_org()', 'authenticated=X'),
    ('function', 'private.deactivate_member(uuid,boolean,uuid)', 'authenticated=X'),
    ('function', 'private.discard_unproven_password()', ''),
    ('function', 'private.email_proven()', ''),
    ('function', 'private.enforce_invite_only_signup()', ''),
    ('function', 'private.export_contact_data(uuid)', 'authenticated=X'),
    ('function', 'private.fit_redacted_text(text,integer)', ''),
    ('function', 'private.guard_anonymized_contact()', ''),
    ('function', 'private.handle_new_user()', ''),
    ('function', 'private.instance_status()', 'anon=X,authenticated=X'),
    ('function', 'private.is_owner()', 'authenticated=X'),
    ('function', 'private.member_portfolio(uuid)', 'authenticated=X'),
    ('function', 'private.move_member_portfolio(uuid,uuid,uuid,boolean,boolean)', ''),
    ('function', 'private.normalize_activity_outcome()', ''),
    ('function', 'private.normalize_automation_scope()', ''),
    ('function', 'private.portfolio_counts(uuid,uuid)', ''),
    ('function', 'private.privacy_phone_regex(text)', ''),
    ('function', 'private.privacy_term_regex(text)', ''),
    ('function', 'private.protect_anonymized_contact()', ''),
    ('function', 'private.protect_deal_totals()', ''),
    ('function', 'private.protect_record_metadata()', ''),
    ('function', 'private.provision_organization(uuid,text)', ''),
    ('function', 'private.reactivate_member(uuid,text)', 'authenticated=X'),
    ('function', 'private.record_activity_author()', ''),
    ('function', 'private.record_deal_change()', ''),
    ('function', 'private.record_email_proof()', ''),
    ('function', 'private.redact_personal_terms(text,text)', ''),
    ('function', 'private.refuse_do_not_contact_action()', ''),
    ('function', 'private.refuse_email_change_without_org()', ''),
    ('function', 'private.refuse_inactive_assignee()', ''),
    ('function', 'private.restore_owner(text,uuid)', ''),
    ('function', 'private.role_change_allowed(text,text,text)', ''),
    ('function', 'private.run_custom_after_save()', ''),
    ('function', 'private.run_custom_validation()', ''),
    ('function', 'private.run_deal_automations()', ''),
    ('function', 'private.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)', 'authenticated=X'),
    ('function', 'private.set_member_role(uuid,text)', 'authenticated=X'),
    ('function', 'private.signup_allowed(text)', ''),
    ('function', 'private.stamp_default_legal_basis()', ''),
    ('function', 'private.stamp_do_not_contact()', ''),
    ('function', 'private.stamp_legal_basis()', ''),
    ('function', 'private.touch_updated_at()', ''),
    ('function', 'private.transfer_portfolio(uuid,boolean,uuid)', 'authenticated=X'),
    ('function', 'private.validate_deal_change()', ''),
    ('function', 'public.accept_invitation(uuid)', 'authenticated=X'),
    ('function', 'public.anonymize_contact(uuid,timestamp with time zone)', 'authenticated=X'),
    ('function', 'public.automation_log_errors(uuid)', 'authenticated=X'),
    ('function', 'public.complete_activity(uuid,timestamp with time zone,text,text,jsonb)', 'authenticated=X'),
    ('function', 'public.contact_privacy_summary(uuid)', 'authenticated=X'),
    ('function', 'public.create_invitation(text,text)', 'authenticated=X'),
    ('function', 'public.create_workspace(text)', 'authenticated=X'),
    ('function', 'public.deactivate_member(uuid,boolean,uuid)', 'authenticated=X'),
    ('function', 'public.delete_deal(uuid,boolean)', 'authenticated=X'),
    ('function', 'public.export_contact_data(uuid)', 'authenticated=X'),
    ('function', 'public.instance_status()', 'anon=X,authenticated=X'),
    ('function', 'public.member_portfolio(uuid)', 'authenticated=X'),
    ('function', 'public.move_deal(uuid,uuid,text,text)', 'authenticated=X'),
    ('function', 'public.reactivate_member(uuid,text)', 'authenticated=X'),
    ('function', 'public.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)', 'authenticated=X'),
    ('function', 'public.search_crm(text,integer)', 'authenticated=X'),
    ('function', 'public.set_member_role(uuid,text)', 'authenticated=X'),
    ('function', 'public.transfer_portfolio(uuid,boolean,uuid)', 'authenticated=X'),
    ('function', 'private.custom_after_activity_saved(public.activities,public.activities)', ''),
    ('function', 'private.custom_after_company_saved(public.companies,public.companies)', ''),
    ('function', 'private.custom_after_contact_saved(public.contacts,public.contacts)', ''),
    ('function', 'private.custom_after_deal_saved(public.deals,public.deals)', ''),
    ('function', 'private.custom_validate_activity(public.activities,public.activities)', ''),
    ('function', 'private.custom_validate_company(public.companies,public.companies)', ''),
    ('function', 'private.custom_validate_contact(public.contacts,public.contacts)', ''),
    ('function', 'private.custom_validate_deal(public.deals,public.deals)', ''),
    ('schema', 'private', 'anon=U,authenticated=U'),
    ('schema', 'public', 'PUBLIC=U,anon=U,authenticated=U,service_role=U'),
    ('table', 'private.base_overwrite_consents', ''),
    ('table', 'private.email_proofs', ''),
    ('table', 'public.activities', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.audit_logs', 'authenticated=r,service_role=arwd'),
    ('table', 'public.automation_logs', 'service_role=arwd'),
    ('table', 'public.automations', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.companies', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.contacts', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.deal_items', 'authenticated=r,service_role=arwd'),
    ('table', 'public.deal_stage_history', 'authenticated=r,service_role=arwd'),
    ('table', 'public.deals', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.email_templates', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.integration_configs', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.invitations', 'authenticated=rd,service_role=arwd'),
    ('table', 'public.onboarding_progress', 'authenticated=arw,service_role=arwd'),
    ('table', 'public.organizations', 'authenticated=r,service_role=arwd'),
    ('table', 'public.payments', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.pipeline_stages', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.pipelines', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.portfolio_transfers', 'authenticated=r,service_role=arwd'),
    ('table', 'public.privacy_actions', 'authenticated=r,service_role=arwd'),
    ('table', 'public.products', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.profiles', 'authenticated=r,service_role=arwd'),
    ('table', 'public.risk_rules', 'authenticated=arwd,service_role=arwd'),
    ('table', 'public.user_roles', 'authenticated=r,service_role=arwd')
), expected_policies(object, parent, command, permissive, roles, body_hash) as (values
    ('public.activities.tenant_delete', 'public.activities', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.activities.tenant_insert', 'public.activities', 'insert', 'true', 'authenticated', '37a37aa6095a0f50'),
    ('public.activities.tenant_read', 'public.activities', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.activities.tenant_update', 'public.activities', 'update', 'true', 'authenticated', '7dc1a4e5a080ecfb'),
    ('public.audit_logs.audit_read', 'public.audit_logs', 'select', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.automation_logs.tenant_read', 'public.automation_logs', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.automations.tenant_delete', 'public.automations', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.automations.tenant_insert', 'public.automations', 'insert', 'true', 'authenticated', 'b5939b289dae80d9'),
    ('public.automations.tenant_read', 'public.automations', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.automations.tenant_update', 'public.automations', 'update', 'true', 'authenticated', '793a9f84f409d4ba'),
    ('public.companies.tenant_delete', 'public.companies', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.companies.tenant_insert', 'public.companies', 'insert', 'true', 'authenticated', '37a37aa6095a0f50'),
    ('public.companies.tenant_read', 'public.companies', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.companies.tenant_update', 'public.companies', 'update', 'true', 'authenticated', '7dc1a4e5a080ecfb'),
    ('public.contacts.tenant_delete', 'public.contacts', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.contacts.tenant_insert', 'public.contacts', 'insert', 'true', 'authenticated', '37a37aa6095a0f50'),
    ('public.contacts.tenant_read', 'public.contacts', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.contacts.tenant_update', 'public.contacts', 'update', 'true', 'authenticated', '7dc1a4e5a080ecfb'),
    ('public.deal_items.tenant_read', 'public.deal_items', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.deal_stage_history.tenant_read', 'public.deal_stage_history', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.deals.tenant_delete', 'public.deals', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.deals.tenant_insert', 'public.deals', 'insert', 'true', 'authenticated', '37a37aa6095a0f50'),
    ('public.deals.tenant_read', 'public.deals', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.deals.tenant_update', 'public.deals', 'update', 'true', 'authenticated', '7dc1a4e5a080ecfb'),
    ('public.email_templates.tenant_delete', 'public.email_templates', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.email_templates.tenant_insert', 'public.email_templates', 'insert', 'true', 'authenticated', '37a37aa6095a0f50'),
    ('public.email_templates.tenant_read', 'public.email_templates', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.email_templates.tenant_update', 'public.email_templates', 'update', 'true', 'authenticated', '7dc1a4e5a080ecfb'),
    ('public.integration_configs.tenant_delete', 'public.integration_configs', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.integration_configs.tenant_insert', 'public.integration_configs', 'insert', 'true', 'authenticated', 'b5939b289dae80d9'),
    ('public.integration_configs.tenant_read', 'public.integration_configs', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.integration_configs.tenant_update', 'public.integration_configs', 'update', 'true', 'authenticated', '793a9f84f409d4ba'),
    ('public.invitations.invitations_manager_delete', 'public.invitations', 'delete', 'true', 'authenticated', 'b3fb930f56eafb1d'),
    ('public.invitations.invitations_manager_read', 'public.invitations', 'select', 'true', 'authenticated', 'b3fb930f56eafb1d'),
    ('public.invitations.tenant_update', 'public.invitations', 'update', 'true', 'authenticated', '793a9f84f409d4ba'),
    ('public.onboarding_progress.own_progress', 'public.onboarding_progress', 'all', 'true', 'authenticated', '80961679027e5a65'),
    ('public.organizations.org_read', 'public.organizations', 'select', 'true', 'authenticated', 'e4cadd2a488d453f'),
    ('public.organizations.org_update', 'public.organizations', 'update', 'true', 'authenticated', 'e65917a72155a416'),
    ('public.payments.tenant_delete', 'public.payments', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.payments.tenant_insert', 'public.payments', 'insert', 'true', 'authenticated', '37a37aa6095a0f50'),
    ('public.payments.tenant_read', 'public.payments', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.payments.tenant_update', 'public.payments', 'update', 'true', 'authenticated', '7dc1a4e5a080ecfb'),
    ('public.pipeline_stages.tenant_delete', 'public.pipeline_stages', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.pipeline_stages.tenant_insert', 'public.pipeline_stages', 'insert', 'true', 'authenticated', 'b5939b289dae80d9'),
    ('public.pipeline_stages.tenant_read', 'public.pipeline_stages', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.pipeline_stages.tenant_update', 'public.pipeline_stages', 'update', 'true', 'authenticated', '793a9f84f409d4ba'),
    ('public.pipelines.tenant_delete', 'public.pipelines', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.pipelines.tenant_insert', 'public.pipelines', 'insert', 'true', 'authenticated', 'b5939b289dae80d9'),
    ('public.pipelines.tenant_read', 'public.pipelines', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.pipelines.tenant_update', 'public.pipelines', 'update', 'true', 'authenticated', '793a9f84f409d4ba'),
    ('public.portfolio_transfers.portfolio_transfers_manager_read', 'public.portfolio_transfers', 'select', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.privacy_actions.privacy_actions_manager_read', 'public.privacy_actions', 'select', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.products.tenant_delete', 'public.products', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.products.tenant_insert', 'public.products', 'insert', 'true', 'authenticated', 'b5939b289dae80d9'),
    ('public.products.tenant_read', 'public.products', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.products.tenant_update', 'public.products', 'update', 'true', 'authenticated', '793a9f84f409d4ba'),
    ('public.profiles.profile_read', 'public.profiles', 'select', 'true', 'authenticated', '9a9fa0307df1cc55'),
    ('public.profiles.profile_update', 'public.profiles', 'update', 'true', 'authenticated', 'c89c068f5a39097d'),
    ('public.risk_rules.tenant_delete', 'public.risk_rules', 'delete', 'true', 'authenticated', '124ff686c3204ea8'),
    ('public.risk_rules.tenant_insert', 'public.risk_rules', 'insert', 'true', 'authenticated', 'b5939b289dae80d9'),
    ('public.risk_rules.tenant_read', 'public.risk_rules', 'select', 'true', 'authenticated', 'a1b559764d5f5354'),
    ('public.risk_rules.tenant_update', 'public.risk_rules', 'update', 'true', 'authenticated', '793a9f84f409d4ba'),
    ('public.user_roles.roles_read', 'public.user_roles', 'select', 'true', 'authenticated', '9873a6628bff8527')
), expected_column_acl(object, acl) as (values
    ('public.automation_logs.activity_id', 'authenticated=r'),
    ('public.automation_logs.automation_id', 'authenticated=r'),
    ('public.automation_logs.automation_name', 'authenticated=r'),
    ('public.automation_logs.created_at', 'authenticated=r'),
    ('public.automation_logs.deal_id', 'authenticated=r'),
    ('public.automation_logs.error_message', 'authenticated=r'),
    ('public.automation_logs.id', 'authenticated=r'),
    ('public.automation_logs.org_id', 'authenticated=r'),
    ('public.automation_logs.status', 'authenticated=r'),
    ('public.organizations.default_legal_basis', 'authenticated=w'),
    ('public.organizations.domain', 'authenticated=w'),
    ('public.organizations.logo_url', 'authenticated=w'),
    ('public.organizations.name', 'authenticated=w'),
    ('public.profiles.avatar_url', 'authenticated=w'),
    ('public.profiles.name', 'authenticated=w'),
    ('public.profiles.onboarding_completed', 'authenticated=w'),
    ('public.profiles.onboarding_step', 'authenticated=w')
), expected_default_acl(object, acl) as (values
    ('postgres/*/functions', ''),
    ('postgres/*/sequences', ''),
    ('postgres/*/tables', ''),
    ('postgres/private/functions', ''),
    ('postgres/private/sequences', ''),
    ('postgres/private/tables', ''),
    ('postgres/public/functions', ''),
    ('postgres/public/sequences', ''),
    ('postgres/public/tables', '')
), critical_functions(object, body_hash, security, config) as (values
    ('private.current_org()', 'e33be87e0b9ca080', 'definer', 'search_path=""'),
    ('private.can_write()', '09b150d85e428619', 'definer', 'search_path=""'),
    ('private.can_manage()', 'd98213bc191ca38d', 'definer', 'search_path=""'),
    ('private.is_owner()', '52959f438b72528f', 'definer', 'search_path=""'),
    ('private.signup_allowed(text)', '0e2cb791e58f97f7', 'invoker', 'search_path=""'),
    ('private.enforce_invite_only_signup()', '5703211e06d49eda', 'definer', 'search_path=""'),
    ('private.provision_organization(uuid,text)', 'f9fcb73f423ff705', 'invoker', 'search_path=""'),
    ('private.discard_unproven_password()', '65ff91a71f65514f', 'definer', 'search_path=""'),
    ('private.record_email_proof()', 'b9a75dae581883dc', 'definer', 'search_path=""'),
    ('private.refuse_email_change_without_org()', '27d68c7d108c2c8b', 'definer', 'search_path=""'),
    ('private.email_proven()', '6f8a44ca0804c0cd', 'invoker', 'search_path=""'),
    ('private.instance_status()', '68ff2ec74020b739', 'definer', 'search_path=""'),
    ('private.refuse_inactive_assignee()', '85e19c698df13bf4', 'definer', 'search_path=""'),
    ('private.role_change_allowed(text,text,text)', '4300492401cd9c83', 'invoker', 'search_path=""'),
    ('private.set_member_role(uuid,text)', '8b50b526525e7361', 'definer', 'search_path=""'),
    ('private.handle_new_user()', '18d1f1d6606532f7', 'definer', 'search_path=""'),
    ('private.create_invitation(text,text)', 'dcbce185aa71c9d0', 'definer', 'search_path=""'),
    ('private.accept_invitation(uuid)', 'a7d1b9b4780c5dc7', 'definer', 'search_path=""'),
    ('private.create_workspace(text)', '51b66c8fc89a8636', 'definer', 'search_path=""')
), base_functions(object, security, config) as (values
    ('private.anonymize_contact(uuid,timestamp with time zone)', 'definer', 'search_path=""'),
    ('private.assert_base_definition(text,text,text[])', 'invoker', 'search_path=""'),
    ('private.audit_record_change()', 'definer', 'search_path=""'),
    ('private.automation_log_errors(uuid)', 'definer', 'search_path=""'),
    ('private.base_acl(aclitem[])', 'invoker', 'search_path=""'),
    ('private.base_fingerprints()', 'invoker', 'search_path=""'),
    ('private.check_portfolio_recipient(uuid,uuid,uuid)', 'invoker', 'search_path=""'),
    ('private.contact_privacy_counts(uuid,public.contacts)', 'invoker', 'search_path=""'),
    ('private.contact_privacy_regex(text,text,text,text,boolean)', 'invoker', 'search_path=""'),
    ('private.contact_privacy_summary(uuid)', 'definer', 'search_path=""'),
    ('private.deactivate_member(uuid,boolean,uuid)', 'definer', 'search_path=""'),
    ('private.export_contact_data(uuid)', 'definer', 'search_path=""'),
    ('private.fit_redacted_text(text,integer)', 'invoker', 'search_path=""'),
    ('private.guard_anonymized_contact()', 'definer', 'search_path=""'),
    ('private.member_portfolio(uuid)', 'definer', 'search_path=""'),
    ('private.move_member_portfolio(uuid,uuid,uuid,boolean,boolean)', 'invoker', 'search_path=""'),
    ('private.normalize_activity_outcome()', 'invoker', 'search_path=""'),
    ('private.normalize_automation_scope()', 'invoker', 'search_path=""'),
    ('private.portfolio_counts(uuid,uuid)', 'invoker', 'search_path=""'),
    ('private.privacy_phone_regex(text)', 'invoker', 'search_path=""'),
    ('private.privacy_term_regex(text)', 'invoker', 'search_path=""'),
    ('private.protect_anonymized_contact()', 'invoker', 'search_path=""'),
    ('private.protect_deal_totals()', 'invoker', 'search_path=""'),
    ('private.protect_record_metadata()', 'invoker', 'search_path=""'),
    ('private.reactivate_member(uuid,text)', 'definer', 'search_path=""'),
    ('private.record_activity_author()', 'invoker', 'search_path=""'),
    ('private.record_deal_change()', 'definer', 'search_path=""'),
    ('private.redact_personal_terms(text,text)', 'invoker', 'search_path=""'),
    ('private.refuse_do_not_contact_action()', 'definer', 'search_path=""'),
    ('private.restore_owner(text,uuid)', 'invoker', 'search_path=""'),
    ('private.run_custom_after_save()', 'definer', 'search_path=""'),
    ('private.run_custom_validation()', 'definer', 'search_path=""'),
    ('private.run_deal_automations()', 'definer', 'search_path=""'),
    ('private.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)', 'definer', 'search_path=""'),
    ('private.stamp_default_legal_basis()', 'invoker', 'search_path=""'),
    ('private.stamp_do_not_contact()', 'invoker', 'search_path=""'),
    ('private.stamp_legal_basis()', 'definer', 'search_path=""'),
    ('private.touch_updated_at()', 'invoker', 'search_path=""'),
    ('private.transfer_portfolio(uuid,boolean,uuid)', 'definer', 'search_path=""'),
    ('private.validate_deal_change()', 'invoker', 'search_path=""'),
    ('public.accept_invitation(uuid)', 'invoker', 'search_path=""'),
    ('public.anonymize_contact(uuid,timestamp with time zone)', 'invoker', 'search_path="", statement_timeout=60s'),
    ('public.automation_log_errors(uuid)', 'invoker', 'search_path=""'),
    ('public.complete_activity(uuid,timestamp with time zone,text,text,jsonb)', 'invoker', 'search_path=""'),
    ('public.contact_privacy_summary(uuid)', 'invoker', 'search_path="", statement_timeout=60s'),
    ('public.create_invitation(text,text)', 'invoker', 'search_path=""'),
    ('public.create_workspace(text)', 'invoker', 'search_path=""'),
    ('public.deactivate_member(uuid,boolean,uuid)', 'invoker', 'search_path="", statement_timeout=60s'),
    ('public.delete_deal(uuid,boolean)', 'invoker', 'search_path=""'),
    ('public.export_contact_data(uuid)', 'invoker', 'search_path=""'),
    ('public.instance_status()', 'invoker', 'search_path=""'),
    ('public.member_portfolio(uuid)', 'invoker', 'search_path=""'),
    ('public.move_deal(uuid,uuid,text,text)', 'invoker', 'search_path=""'),
    ('public.reactivate_member(uuid,text)', 'invoker', 'search_path=""'),
    ('public.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)', 'invoker', 'search_path=""'),
    ('public.search_crm(text,integer)', 'invoker', 'search_path=""'),
    ('public.set_member_role(uuid,text)', 'invoker', 'search_path=""'),
    ('public.transfer_portfolio(uuid,boolean,uuid)', 'invoker', 'search_path="", statement_timeout=60s')
), required_indexes(object) as (values
    ('public.activities.activities_owner_pending')
), history as (
  select pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null as present
), live_migrations as (
  select x.* from (select pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null as present) t
  cross join lateral xmltable('/table/row'
    passing case when t.present then pg_catalog.query_to_xml('select pg_catalog.to_jsonb(m)->>''version'' as version, pg_catalog.to_jsonb(m)->>''name'' as name from supabase_migrations.schema_migrations m', false, false, '') end
    columns version text path 'version', name text path 'name') x
), organizations as (
  select x.* from (select pg_catalog.to_regclass('public.organizations') is not null as present) t
  cross join lateral xmltable('/table/row'
    passing case when t.present then pg_catalog.query_to_xml('select o.id::text as id, o.name from public.organizations o', false, false, '') end
    columns id text path 'id', name text path 'name') x
), active_owners as (
  select x.* from (select pg_catalog.to_regclass('public.user_roles') is not null as present) t
  cross join lateral xmltable('/table/row'
    passing case when t.present then pg_catalog.query_to_xml('select r.org_id::text as org_id, coalesce(u.email::text, r.user_id::text) as email from public.user_roles r left join auth.users u on u.id = r.user_id where r.role = ''owner'' and pg_catalog.to_jsonb(r)->>''deactivated_at'' is null', false, false, '') end
    columns org_id text path 'org_id', email text path 'email') x
), demo_pipeline as (
  select x.* from (select pg_catalog.to_regclass('public.pipelines') is not null as present) t
  cross join lateral xmltable('/table/row'
    passing case when t.present then pg_catalog.query_to_xml('select p.id::text as id from public.pipelines p where p.id = ''2f860930-4560-42c8-a2a0-cc109b7cd66e''', false, false, '') end
    columns id text path 'id') x
), relations as (
  select c.oid, n.nspname::text as schema_name, n.nspname || '.' || c.relname as object, c.relkind, c.relrowsecurity,
    coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner)) as acl,
    coalesce((select o.option_value from pg_catalog.pg_options_to_table(c.reloptions) o
      where o.option_name = 'security_invoker'), 'false') as security_invoker
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm')
    and not exists (select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.objid = c.oid and d.deptype = 'e')
), functions as (
  -- A assinatura escrita como o manifesto (regprocedure com o search_path vazio), sem depender do search_path do editor.
  select p.oid, n.nspname::text as schema_name,
    pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(p.proname) || '(' || coalesce((
      select pg_catalog.string_agg(case when tn.nspname = 'pg_catalog' then pg_catalog.format_type(a.type_oid, null)
          else pg_catalog.quote_ident(tn.nspname) || '.' || pg_catalog.quote_ident(ty.typname) end, ',' order by a.ord)
      from pg_catalog.unnest(p.proargtypes::pg_catalog.oid[]) with ordinality as a(type_oid, ord)
      join pg_catalog.pg_type ty on ty.oid = a.type_oid
      join pg_catalog.pg_namespace tn on tn.oid = ty.typnamespace), '') || ')' as object,
    case when p.prosecdef then 'definer' else 'invoker' end as security,
    coalesce((select pg_catalog.string_agg(c, ', ' order by c collate "C") from pg_catalog.unnest(p.proconfig) c), '') as config,
    pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(
      coalesce(nullif(p.prosrc, ''), pg_catalog.pg_get_function_sqlbody(p.oid)), E'\r\n', E'\n'), 'UTF8')), 'hex'), 16) as body_hash,
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner)) as acl
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and not exists (select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and d.objid = p.oid and d.deptype = 'e')
), path_reset as (
  -- As expressões das políticas saem de pg_get_expr, que omite o schema do que está no search_path (no editor do painel,
  -- public). O search_path vazio, só nesta transação e sem gravar nada, deixa o texto igual ao de
  -- private.base_fingerprints(), que roda com search_path=''. A expressão lê done antes de pg_get_expr: a ordem é certa.
  select pg_catalog.set_config('search_path', '', true) as done
), live_policies as (
  select r.object as parent, r.object || '.' || p.polname as object,
    case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end as command,
    p.polpermissive::text as permissive,
    (select pg_catalog.string_agg(x.role, ',' order by x.role collate "C") from (
      select case when o = 0 then 'public' else (select rr.rolname::text from pg_catalog.pg_roles rr where rr.oid = o) end as role
      from pg_catalog.unnest(p.polroles) o) x) as roles,
    pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.replace(e.body, E'\r\n', E'\n'), 'UTF8')), 'hex'), 16) as body_hash
  from relations r
  join pg_catalog.pg_policy p on p.polrelid = r.oid
  cross join path_reset s
  cross join lateral (select case when s.done is not null then 'USING: ' || coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')
    || E'\nWITH CHECK: ' || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '') end as body) e
), live_column_acl as (
  select r.object as parent, r.object || '.' || a.attname as object, coalesce((select pg_catalog.string_agg(g.grantee || '=' || g.privileges, ',' order by g.grantee collate "C")
      from (select e.grantee, pg_catalog.string_agg(e.letter, '' order by pg_catalog.strpos('arwdDxtXUCTc', e.letter)) as privileges
        from (select distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as grantee,
            case a.privilege_type when 'SELECT' then 'r' when 'INSERT' then 'a' when 'UPDATE' then 'w' when 'DELETE' then 'd'
              when 'TRUNCATE' then 'D' when 'REFERENCES' then 'x' when 'TRIGGER' then 't' when 'EXECUTE' then 'X'
              when 'USAGE' then 'U' when 'CREATE' then 'C' when 'TEMPORARY' then 'T' when 'CONNECT' then 'c' end as letter
          from pg_catalog.aclexplode(case when pg_catalog.cardinality(a.attacl) > 0 then a.attacl end) a
          left join pg_catalog.pg_roles r on r.oid = a.grantee
          where (a.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role')) and a.privilege_type <> 'MAINTAIN') e
        group by e.grantee) g), '') as acl
  from relations r
  join pg_catalog.pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
), acl_objects as (
  select 'schema' as kind, n.nspname::text as object, coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner)) as acl
  from pg_catalog.pg_namespace n where n.nspname in ('public', 'private')
  union all
  select case when r.relkind in ('v', 'm') then 'view' else 'table' end, r.object, r.acl from relations r
  union all
  select 'function', f.object, f.acl from functions f
), live_acl as (
  select o.kind, o.object, coalesce((select pg_catalog.string_agg(g.grantee || '=' || g.privileges, ',' order by g.grantee collate "C")
      from (select e.grantee, pg_catalog.string_agg(e.letter, '' order by pg_catalog.strpos('arwdDxtXUCTc', e.letter)) as privileges
        from (select distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as grantee,
            case a.privilege_type when 'SELECT' then 'r' when 'INSERT' then 'a' when 'UPDATE' then 'w' when 'DELETE' then 'd'
              when 'TRUNCATE' then 'D' when 'REFERENCES' then 'x' when 'TRIGGER' then 't' when 'EXECUTE' then 'X'
              when 'USAGE' then 'U' when 'CREATE' then 'C' when 'TEMPORARY' then 'T' when 'CONNECT' then 'c' end as letter
          from pg_catalog.aclexplode(case when pg_catalog.cardinality(o.acl) > 0 then o.acl end) a
          left join pg_catalog.pg_roles r on r.oid = a.grantee
          where (a.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role')) and a.privilege_type <> 'MAINTAIN') e
        group by e.grantee) g), '') as acl
  from acl_objects o

), live_default_acl as (
  select 'postgres/' || g.schema_label || '/' || t.label as object,
    coalesce((select pg_catalog.string_agg(g.grantee || '=' || g.privileges, ',' order by g.grantee collate "C")
      from (select e.grantee, pg_catalog.string_agg(e.letter, '' order by pg_catalog.strpos('arwdDxtXUCTc', e.letter)) as privileges
        from (select distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as grantee,
            case a.privilege_type when 'SELECT' then 'r' when 'INSERT' then 'a' when 'UPDATE' then 'w' when 'DELETE' then 'd'
              when 'TRUNCATE' then 'D' when 'REFERENCES' then 'x' when 'TRIGGER' then 't' when 'EXECUTE' then 'X'
              when 'USAGE' then 'U' when 'CREATE' then 'C' when 'TEMPORARY' then 'T' when 'CONNECT' then 'c' end as letter
          from pg_catalog.aclexplode(case when pg_catalog.cardinality(coalesce(d.defaclacl, case when g.namespace = 0 then pg_catalog.acldefault(t.code, o.oid) end)) > 0 then coalesce(d.defaclacl, case when g.namespace = 0 then pg_catalog.acldefault(t.code, o.oid) end) end) a
          left join pg_catalog.pg_roles r on r.oid = a.grantee
          where (a.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role')) and a.privilege_type <> 'MAINTAIN') e
        group by e.grantee) g), '') as acl
  from pg_catalog.pg_roles o
  cross join (select 0::pg_catalog.oid as namespace, '*'::text as schema_label
    union all select n.oid, n.nspname::text from pg_catalog.pg_namespace n where n.nspname in ('public', 'private')) g
  cross join (values ('r'::"char", 'r'::"char", 'tables'::text), ('S', 's', 'sequences'), ('f', 'f', 'functions')) t(objtype, code, label)
  left join pg_catalog.pg_default_acl d on d.defaclrole = o.oid and d.defaclnamespace = g.namespace and d.defaclobjtype = t.objtype
  where o.rolname = 'postgres'
), live_triggers as (
  select n.nspname || '.' || c.relname || '.' || t.tgname as object, t.tgenabled::text as enabled
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
), applied as (
  select coalesce(max(e.version), '') as last_version
  from expected_migrations e where e.version in (select l.version from live_migrations l where l.version is not null)
), v1 as (
  select 1 as num, 'Migrações' as verificacao, array_remove(array[
      case when not h.present then 'As migrações não foram aplicadas pelo npx supabase@2.119.0 db push (etapa 4 do guia): este banco não tem o histórico supabase_migrations.schema_migrations. Num projeto novo, rode o db push. Se as migrações foram coladas no editor SQL, peça ajuda a quem mantém a base.' end,
      (select case when count(*) > 0 then 'A migração ' || min(e.version || '_' || e.name) || case when count(*) > 1 then ' (e mais ' || (count(*) - 1) || ')' else '' end
          || ' falta, mas outras posteriores foram aplicadas: o banco foi montado fora de ordem. Não continue e peça ajuda a quem mantém a base.' end
        from expected_migrations e, applied a
        where h.present and e.version < a.last_version and e.version not in (select l.version from live_migrations l where l.version is not null)),
      (select case when count(*) > 0 then case when count(*) = 1 then 'Falta 1 migração da base, ' else 'Faltam ' || count(*) || ' migrações da base, a partir de ' end
          || min(e.version || '_' || e.name) || ': rode npx supabase@2.119.0 db push (etapa 4 do guia).' end
        from expected_migrations e, applied a
        where h.present and e.version > a.last_version and e.version not in (select l.version from live_migrations l where l.version is not null)),
      (select 'A versão ' || pg_catalog.string_agg(e.version || ' está registrada como ' || l.name || ', e não como ' || e.name, ', a versão ' order by e.version)
          || '. O histórico não é o desta base: peça ajuda a quem mantém a base.'
        from expected_migrations e join live_migrations l on l.version = e.version
        -- O nome com a versão ou com o .sql (histórico gravado à mão a partir do nome do arquivo) vale como o mesmo.
        where l.name is not null and l.name not in (e.name, e.version || '_' || e.name, e.version || '_' || e.name || '.sql'))
    ], null) as problems,
    'As 20 migrações da base estão no histórico, em ordem.' as ok_detail
  from history h
), v2 as (
  select 2 as num, 'RLS' as verificacao, array_remove(array[
      (select 'Ausentes: ' || pg_catalog.array_to_string((array_agg(e.object order by e.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(e.object order by e.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(e.object order by e.object collate "C")) - 10) else '' end
          || '. Recrie cada uma pela migração que a criou, ou rode o supabase/db-drift-check.sql para ver o que mais falta.'
        from expected_tables e where not exists (select 1 from relations r where r.object = e.object)
        having count(*) > 0),
      (select 'RLS desligada em ' || pg_catalog.array_to_string((array_agg(r.object::text order by r.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(r.object::text order by r.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(r.object::text order by r.object collate "C")) - 10) else '' end
          || ': qualquer pessoa com a chave pública lê e grava essas tabelas pela API, com os dados de toda a instância. Ligue de novo com alter table <tabela> enable row level security.'
        from expected_tables e join relations r on r.object = e.object and not r.relrowsecurity
        having count(*) > 0)
    ], null) as problems,
    'As 25 tabelas da base existem e estão com a RLS ligada.' as ok_detail
), v3 as (
  select 3 as num, 'Objetos abertos para a API' as verificacao, array_remove(array[
      (select 'Tabelas sem RLS e com permissões para anon, authenticated ou PUBLIC: ' || pg_catalog.array_to_string((array_agg(a.object order by a.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(a.object order by a.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(a.object order by a.object collate "C")) - 10) else '' end
          || '. Qualquer pessoa com a chave pública lê ou grava essas tabelas pela API, sem login. Ligue a RLS (alter table <tabela> enable row level security) e crie as políticas por organização, ou revogue o acesso.'
        from relations r
        join live_acl a on a.kind = 'table' and a.object = r.object
        where r.schema_name = 'public' and r.relkind in ('r', 'p') and not r.relrowsecurity
          and a.acl ~ '(^|,)(PUBLIC|anon|authenticated)=[^,]*[arwd]'
        having count(*) > 0),
      (select 'Views sem security_invoker (ou materializadas) e com permissões para anon, authenticated ou PUBLIC: ' || pg_catalog.array_to_string((array_agg(a.object order by a.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(a.object order by a.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(a.object order by a.object collate "C")) - 10) else '' end
          || '. A view lê as tabelas com as permissões de quem a criou, sem a RLS de quem consulta, e entrega os dados de toda a instância pela API. Recrie-a com with (security_invoker = true), ou revogue o acesso.'
        from relations r
        join live_acl a on a.kind = 'view' and a.object = r.object
        where r.schema_name = 'public' and (r.relkind = 'm' or lower(btrim(r.security_invoker)) not in ('t', 'tr', 'tru', 'true', 'y', 'ye', 'yes', 'on', '1'))
          and a.acl ~ '(^|,)(PUBLIC|anon|authenticated)=[^,]*[arwd]'
          and not exists (select 1 from expected_acl e where e.kind = 'view' and e.object = r.object)
        having count(*) > 0),
      (select 'Funções SECURITY DEFINER fora da base, executáveis por anon, authenticated ou PUBLIC: ' || pg_catalog.array_to_string((array_agg(a.object order by a.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(a.object order by a.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(a.object order by a.object collate "C")) - 10) else '' end
          || '. Elas rodam com as permissões de quem as criou, sem a RLS: quem chama pela API lê ou grava o que a função alcançar. Torne-as security invoker, ou revogue o execute e chame a lógica a partir de uma função invoker que confere o papel.'
        from functions f
        join live_acl a on a.kind = 'function' and a.object = f.object
        where f.schema_name = 'public' and f.security = 'definer'
          and a.acl ~ '(^|,)(PUBLIC|anon|authenticated)=[^,]*X'
          and not exists (select 1 from expected_acl e where e.kind = 'function' and e.object = f.object)
        having count(*) > 0)
    ], null) as problems,
    'Nenhuma tabela de public sem RLS, view sem security_invoker ou função SECURITY DEFINER criada fora da base fica aberta para a API (as funções da base estão na verificação 9).' as ok_detail
), v4 as (
  select 4 as num, 'Gatilhos' as verificacao, array_remove(array[
      (select 'Ausentes: ' || pg_catalog.array_to_string((array_agg(e.object order by e.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(e.object order by e.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(e.object order by e.object collate "C")) - 10) else '' end
          || '. Recrie cada um pela migração que o criou. Num projeto novo, rode o db push.'
        from expected_triggers e where not exists (select 1 from live_triggers l where l.object = e.object)
        having count(*) > 0),
      (select 'Com estado diferente do da base (desligado): ' || pg_catalog.array_to_string((array_agg(e.object || ' (ligue com alter table ' || pg_catalog.regexp_replace(e.object, '\.[^.]*$', '') || ' enable trigger ' || pg_catalog.regexp_replace(e.object, '^.*\.', '') || ')' order by e.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(e.object || ' (ligue com alter table ' || pg_catalog.regexp_replace(e.object, '\.[^.]*$', '') || ' enable trigger ' || pg_catalog.regexp_replace(e.object, '^.*\.', '') || ')' order by e.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(e.object || ' (ligue com alter table ' || pg_catalog.regexp_replace(e.object, '\.[^.]*$', '') || ' enable trigger ' || pg_catalog.regexp_replace(e.object, '^.*\.', '') || ')' order by e.object collate "C")) - 10) else '' end || '. A regra que eles aplicam não está valendo.'
        from expected_triggers e join live_triggers l on l.object = e.object and l.enabled <> e.enabled
        having count(*) > 0)
    ], null) as problems,
    'Os 80 gatilhos da base existem e estão ligados, inclusive os do Auth.' as ok_detail
), v5 as (
  select 5 as num, 'Gatilhos do Auth sem coluna' as verificacao,
    case when count(*) > 0 then array['Gatilhos do CRM em tabelas do Auth que citam ou dependem de uma coluna: ' || pg_catalog.array_to_string((array_agg(n.nspname || '.' || c.relname || '.' || t.tgname order by t.tgname collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(n.nspname || '.' || c.relname || '.' || t.tgname order by t.tgname collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(n.nspname || '.' || c.relname || '.' || t.tgname order by t.tgname collate "C")) - 10) else '' end
      || '. Eles barram as migrações do Auth que mudam ou removem essa coluna (seção 16.9 do desenho do 1.1). Recrie-os sem UPDATE OF nem WHEN, com a condição dentro da função.'] else '{}' end as problems,
    'Nenhum gatilho do CRM nas tabelas do Auth cita ou depende de coluna.' as ok_detail
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
  where n.nspname = 'auth' and pn.nspname = 'private' and not t.tgisinternal
    and (t.tgqual is not null or pg_catalog.cardinality(t.tgattr::pg_catalog.int2[]) > 0
      or exists (select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_trigger'::pg_catalog.regclass and d.objid = t.oid
          and d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.refobjsubid <> 0))
), v6 as (
  select 6 as num, 'Privilégio TRIGGER no Auth' as verificacao,
    case when coalesce(pg_catalog.has_table_privilege(p.migration_role, pg_catalog.to_regclass('auth.mfa_amr_claims'), 'TRIGGER'), false)
      then '{}'::text[] else array['O papel ' || p.migration_role || ' não tem o privilégio TRIGGER em auth.mfa_amr_claims. Sem ele, o gatilho record_email_proof não pode existir, e a prova do e-mail não é gravada: a admissão continua fechada, mas quem volta com senha precisa de um link novo para aceitar o convite. Abra um chamado no suporte do Supabase pedindo o privilégio.'] end as problems,
    'O papel ' || p.migration_role || ' tem o privilégio TRIGGER em auth.mfa_amr_claims.' as ok_detail
  from params p
), v7 as (
  select 7 as num, 'Privilégios padrão' as verificacao,
    case when count(l.object) > 0 then array['Objetos novos criados por postgres nascem com permissões para a API: ' || pg_catalog.array_to_string((array_agg(l.object || ' (' || l.acl || ')' order by l.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(l.object || ' (' || l.acl || ')' order by l.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(l.object || ' (' || l.acl || ')' order by l.object collate "C")) - 10) else '' end
      || '. Uma tabela esquecida sem RLS ou uma função sem revoke ficaria aberta. Para fechar, rode no editor SQL alter default privileges for role postgres [in schema <schema>] revoke all on <tables, sequences ou functions> from public, anon, authenticated, service_role.'] else '{}' end as problems,
    'As nove linhas de privilégio padrão de postgres estão como na base, sem permissão para a API.' as ok_detail
  from expected_default_acl e
  left join live_default_acl l on l.object = e.object
  where l.acl is distinct from e.acl
), acl_differences as (
  select e.object, l.acl as live, e.acl as base
  from expected_acl e
  left join live_acl l on l.kind = e.kind and l.object = e.object
  where l.acl is distinct from e.acl
  union all
  -- As permissões por coluna das tabelas da base (grant select (coluna) ...), que valem mesmo sem a da tabela.
  select 'coluna ' || coalesce(e.object, l.object), coalesce(l.acl, ''), coalesce(e.acl, '')
  from expected_column_acl e
  full join (select c.object, c.acl from live_column_acl c
      where c.acl <> '' and exists (select 1 from expected_acl t where t.kind = 'table' and t.object = c.parent)) l
    on l.object = e.object
  where coalesce(l.acl, '') <> coalesce(e.acl, '')
), v8 as (
  select 8 as num, 'Permissões da API' as verificacao,
    case when count(*) > 0 then array['Permissões diferentes das da base: ' || pg_catalog.array_to_string((array_agg(d.object || case when d.live is null then ' está ausente' else ' tem ' || coalesce(nullif(d.live, ''), 'nada') end || ' e a base, ' || coalesce(nullif(d.base, ''), 'nada') order by d.object collate "C"))[1:10], '. ') || case when pg_catalog.cardinality(array_agg(d.object || case when d.live is null then ' está ausente' else ' tem ' || coalesce(nullif(d.live, ''), 'nada') end || ' e a base, ' || coalesce(nullif(d.base, ''), 'nada') order by d.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(d.object || case when d.live is null then ' está ausente' else ' tem ' || coalesce(nullif(d.live, ''), 'nada') end || ' e a base, ' || coalesce(nullif(d.base, ''), 'nada') order by d.object collate "C")) - 10) else '' end
      || '. Volte cada objeto às permissões da base com grant e revoke (o ausente, pela migração que o criou). Uma permissão a mais para anon ou authenticated abre dados ou funções pela API.'] else '{}' end as problems,
    'Os schemas, as tabelas, as colunas e as funções da base têm as permissões da base para anon, authenticated, PUBLIC e service_role.' as ok_detail
  from acl_differences d
), function_differences as (
  select c.object, case when f.object is null then 'ausente' else pg_catalog.concat_ws(', ', case when f.body_hash <> c.body_hash then 'corpo diferente' end, case when f.security <> c.security then 'security ' || f.security || ' em vez de ' || c.security end, case when f.config <> c.config then 'configuração ' || coalesce(nullif(f.config, ''), 'vazia') || ' em vez de ' || c.config end) end as problem
  from critical_functions c
  left join functions f on f.object = c.object
  where f.object is null or f.body_hash <> c.body_hash or f.security <> c.security or f.config <> c.config
  union all
  -- As outras funções da base: a ausente já reprova nas Permissões da API (V8), e aqui ficam o security e o search_path.
  select b.object, pg_catalog.concat_ws(', ', case when f.security <> b.security then 'security ' || f.security || ' em vez de ' || b.security end, case when f.config <> b.config then 'configuração ' || coalesce(nullif(f.config, ''), 'vazia') || ' em vez de ' || b.config end)
  from base_functions b
  join functions f on f.object = b.object
  where f.security <> b.security or f.config <> b.config
), v9 as (
  select 9 as num, 'Funções da base' as verificacao,
    case when count(*) > 0 then array['Diferentes das da base: ' || pg_catalog.array_to_string((array_agg(d.object || ': ' || d.problem order by d.object collate "C"))[1:10], '. ') || case when pg_catalog.cardinality(array_agg(d.object || ': ' || d.problem order by d.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(d.object || ': ' || d.problem order by d.object collate "C")) - 10) else '' end
      || '. A regra de segurança pode não estar valendo: uma função security definer roda sem a RLS de quem chama. Rode o supabase/db-drift-check.sql e volte cada uma à da base (alter function <função> security invoker, por exemplo), ou aplique as migrações que faltam.'] else '{}' end as problems,
    'As 19 funções que decidem o acesso e a admissão estão como na base, e as outras 58 funções da base têm o security e o search_path da base.' as ok_detail
  from function_differences d
), v10 as (
  select 10 as num, 'Índices de que telas dependem' as verificacao,
    case when count(*) > 0 then array['Ausente: ' || pg_catalog.array_to_string((array_agg(i.object order by i.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(i.object order by i.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(i.object order by i.object collate "C")) - 10) else '' end
      || '. Os lembretes do menu ficam lentos com volume. Recrie pela migração que o criou.'] else '{}' end as problems,
    'O índice activities_owner_pending, da leitura dos lembretes, existe.' as ok_detail
  from required_indexes i
  where not exists (select 1 from pg_catalog.pg_index x
    join pg_catalog.pg_class ic on ic.oid = x.indexrelid
    join pg_catalog.pg_class tc on tc.oid = x.indrelid
    join pg_catalog.pg_namespace n on n.oid = tc.relnamespace
    where n.nspname || '.' || tc.relname || '.' || ic.relname = i.object)
), v11 as (
  select 11 as num, 'Empresa única' as verificacao,
    case when count(*) > 1 then array['Há ' || count(*) || ' empresas neste CRM: ' || pg_catalog.array_to_string((array_agg(o.name order by o.name collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(o.name order by o.name collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(o.name order by o.name collate "C")) - 10) else '' end
      || '. Esta instância é de uma empresa só (decisão D6). Peça ajuda a quem mantém a base antes de continuar.'] else '{}' end as problems,
    case when count(*) = 0 then 'Nenhuma empresa ainda.' else 'Uma empresa só.' end as ok_detail
  from organizations o
), v12 as (
  select 12 as num, 'Dono ativo' as verificacao,
    case when count(*) > 0 then array['Sem nenhum dono ativo: ' || pg_catalog.array_to_string((array_agg(o.name order by o.name collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(o.name order by o.name collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(o.name order by o.name collate "C")) - 10) else '' end
      || '. Ninguém administra este CRM: siga Recuperar o acesso de dono (docs/RECUPERAR-ACESSO-DONO.md).'] else '{}' end as problems,
    case when (select count(*) from organizations) = 0 then 'Nenhuma empresa ainda: o primeiro cadastro cria o dono.' else 'A empresa tem pelo menos um dono ativo.' end as ok_detail
  from organizations o
  where not exists (select 1 from active_owners a where a.org_id = o.id)
), v13 as (
  select 13 as num, 'Conferência do drift disponível' as verificacao,
    case when pg_catalog.to_regprocedure('private.base_fingerprints()') is null then array['A função private.base_fingerprints() não existe: o supabase/db-drift-check.sql não roda neste banco. Aplique as migrações da base (npx supabase@2.119.0 db push).'] else '{}'::text[] end as problems,
    'A função private.base_fingerprints() existe: o supabase/db-drift-check.sql roda neste banco.' as ok_detail
), v14 as (
  select 14 as num, 'Políticas da base' as verificacao, array_remove(array[
      (select 'Ausentes: ' || pg_catalog.array_to_string((array_agg(e.object order by e.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(e.object order by e.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(e.object order by e.object collate "C")) - 10) else '' end
          || '. Sem a política, a tabela deixa de responder para quem devia, ou outra política mais aberta passa a valer sozinha. Recrie pela migração que a criou.'
        from expected_policies e where not exists (select 1 from live_policies l where l.object = e.object)
        having count(*) > 0),
      (select 'Diferentes das da base: ' || pg_catalog.array_to_string((array_agg(e.object || ': ' || pg_catalog.concat_ws(', ', case when l.body_hash <> e.body_hash then 'expressão (USING ou WITH CHECK) diferente' end, case when l.command <> e.command then 'comando ' || l.command || ' em vez de ' || e.command end, case when l.permissive <> e.permissive then case when l.permissive = 'true' then 'permissiva' else 'restritiva' end || ' em vez de ' || case when e.permissive = 'true' then 'permissiva' else 'restritiva' end end, case when l.roles is distinct from e.roles then 'papéis ' || coalesce(l.roles, 'nenhum') || ' em vez de ' || e.roles end) order by e.object collate "C"))[1:10], '. ') || case when pg_catalog.cardinality(array_agg(e.object || ': ' || pg_catalog.concat_ws(', ', case when l.body_hash <> e.body_hash then 'expressão (USING ou WITH CHECK) diferente' end, case when l.command <> e.command then 'comando ' || l.command || ' em vez de ' || e.command end, case when l.permissive <> e.permissive then case when l.permissive = 'true' then 'permissiva' else 'restritiva' end || ' em vez de ' || case when e.permissive = 'true' then 'permissiva' else 'restritiva' end end, case when l.roles is distinct from e.roles then 'papéis ' || coalesce(l.roles, 'nenhum') || ' em vez de ' || e.roles end) order by e.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(e.object || ': ' || pg_catalog.concat_ws(', ', case when l.body_hash <> e.body_hash then 'expressão (USING ou WITH CHECK) diferente' end, case when l.command <> e.command then 'comando ' || l.command || ' em vez de ' || e.command end, case when l.permissive <> e.permissive then case when l.permissive = 'true' then 'permissiva' else 'restritiva' end || ' em vez de ' || case when e.permissive = 'true' then 'permissiva' else 'restritiva' end end, case when l.roles is distinct from e.roles then 'papéis ' || coalesce(l.roles, 'nenhum') || ' em vez de ' || e.roles end) order by e.object collate "C")) - 10) else '' end || '. A regra de quem lê e grava cada linha pode não estar valendo. Volte cada uma à da base (o supabase/db-drift-check.sql mostra o detalhe).'
        from expected_policies e join live_policies l on l.object = e.object
        where l.body_hash <> e.body_hash or l.command <> e.command or l.permissive <> e.permissive or l.roles is distinct from e.roles
        having count(*) > 0),
      (select 'Políticas permissivas a mais em tabelas da base: ' || pg_catalog.array_to_string((array_agg(l.object order by l.object collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(l.object order by l.object collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(l.object order by l.object collate "C")) - 10) else '' end
          || '. Uma política permissiva soma acesso ao das políticas da base: com using (true), qualquer conta lê as linhas de todas. Remova-a, ou troque-a por uma restritiva (as restritivas só tiram acesso).'
        from live_policies l
        where l.permissive = 'true' and not exists (select 1 from expected_policies e where e.object = l.object)
          and exists (select 1 from expected_tables t where t.object = l.parent)
        having count(*) > 0)
    ], null) as problems,
    'As 63 políticas das tabelas da base estão como na base, sem política permissiva a mais.' as ok_detail
), checks as (
  select num, verificacao, pg_catalog.cardinality(problems) > 0 as failed,
    case when pg_catalog.cardinality(problems) > 0 then pg_catalog.array_to_string(problems, ' ') else ok_detail end as detalhe
  from (select * from v1 union all select * from v2 union all select * from v3 union all select * from v4
    union all select * from v5 union all select * from v6 union all select * from v7 union all select * from v8
    union all select * from v9 union all select * from v10 union all select * from v11 union all select * from v12
    union all select * from v13 union all select * from v14) v
), infos as (
  select 1 as num, 'Empresa' as verificacao,
    case count(*) when 0 then 'Nenhuma empresa ainda: faça o primeiro cadastro logo depois de publicar (etapa 11 do guia).'
      when 1 then 'Uma empresa: ' || min(o.name) || '.'
      else count(*) || ' empresas: ' || pg_catalog.array_to_string((array_agg(o.name order by o.name collate "C"))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(o.name order by o.name collate "C")) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(o.name order by o.name collate "C")) - 10) else '' end || '.' end as detalhe
  from organizations o
  union all
  select 2, 'Donos ativos',
    case when count(a.email) = 0 then 'Nenhum dono ativo.'
      else 'Donos ativos: ' || pg_catalog.array_to_string((array_agg(distinct a.email order by a.email))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(distinct a.email order by a.email)) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(distinct a.email order by a.email)) - 10) else '' end
        || '. Confira que é quem você esperava. Se não for, veja "Outra pessoa virou Dono" no guia de implantação.' end
  from active_owners a
  having (select count(*) from organizations) > 0
  union all
  select 3, 'Contas sem confirmação',
    case count(*) when 0 then 'Nenhuma conta sem confirmação de e-mail.'
      when 1 then '1 conta sem confirmação de e-mail.' else count(*) || ' contas sem confirmação de e-mail.' end
      || case when count(*) > 0 then ' É normal enquanto um convite não foi aceito. Para ver: select id, email, created_at from auth.users where email_confirmed_at is null' else '' end
  from auth.users u where u.email_confirmed_at is null
  union all
  select 4, 'Migrações próprias',
    'Migrações desta instância, fora da base: ' || pg_catalog.array_to_string((array_agg(l.version || coalesce('_' || l.name, '') order by l.version))[1:10], ', ') || case when pg_catalog.cardinality(array_agg(l.version || coalesce('_' || l.name, '') order by l.version)) > 10 then ' e mais ' || (pg_catalog.cardinality(array_agg(l.version || coalesce('_' || l.name, '') order by l.version)) - 10) else '' end
      || '. As de nome _custom_ são suas. As outras vieram de outra origem: mantenha os arquivos delas no repositório.'
  from live_migrations l
  where l.version is not null and l.version not in (select e.version from expected_migrations e)
  having count(*) > 0
  union all
  select 5, 'Dados de demonstração',
    'Esta instância tem os dados de demonstração. Nunca a use com dados reais sem rodar antes supabase/seed-demo-remove.sql.'
  from demo_pipeline
  having count(*) > 0
  union all
  select 6, 'Configuração do Auth',
    'A configuração do Auth não fica no banco: confira a confirmação de e-mail, o cadastro e os provedores com npm run verify-instance (etapa 10 do guia).'
  union all
  select 7, 'Conferência completa (drift)',
    'Para comparar o banco inteiro com a base, depois de cada atualização ou personalização, cole supabase/db-drift-check.sql no editor SQL (docs/PROTECAO-ATUALIZACAO.md, seção 5).'
), result as (
  select 0 as ordem, 0 as num,
    case when exists (select 1 from checks where failed) then 'REPROVADA' else 'APROVADA' end as resultado,
    'Veredito' as verificacao,
    case when exists (select 1 from checks where failed)
      then (select case count(*) when 1 then '1 verificação reprovada: ' else count(*) || ' verificações reprovadas: ' end
          || pg_catalog.string_agg(verificacao, ', ' order by num) || '. Corrija cada linha reprovado e rode esta conferência de novo.'
        from checks where failed)
      else '14 verificações aprovadas. Base 20261019120000_default_privileges.sql.' end as detalhe
  union all
  select case when failed then 1 else 2 end, num, case when failed then 'reprovado' else 'aprovado' end, verificacao, detalhe
  from checks
  union all
  select 3, num, 'informação', verificacao, detalhe from infos
)
select r.resultado, r.verificacao, r.detalhe
from result r
order by r.ordem, r.num;
