-- Only for the disposable PostgreSQL test cluster; never a production migration.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,encrypted_password varchar(255),email_change varchar(255) default '');
-- The session and the method that opened it, with the columns of the hosted tables: the Auth writes both in the
-- transaction of the request that issues the session (tokens/service.go, IssueRefreshToken and AddClaimToSession).
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz default now(),updated_at timestamptz default now());
create table auth.mfa_amr_claims(id uuid not null default gen_random_uuid() constraint amr_id_pk primary key,session_id uuid not null references auth.sessions(id) on delete cascade,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),authentication_method text not null,
 constraint mfa_amr_claims_session_id_authentication_method_pkey unique(session_id,authentication_method));
-- The hosted definitions: PostgREST sends the token claims in request.jwt.claims; the tests may also switch accounts
-- by request.jwt.claim.sub alone, which wins when set.
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim',true),''),nullif(current_setting('request.jwt.claims',true),''))::jsonb
$$;
grant usage on schema auth,public to authenticated,anon,service_role;
grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;
-- As on hosted Supabase: whatever the database owner creates in public starts with every privilege for the API roles,
-- so each migration must revoke what it does not expose. Without this, a "revoke ... from public" that forgets anon
-- would pass here and leave the object open on the real project.
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
