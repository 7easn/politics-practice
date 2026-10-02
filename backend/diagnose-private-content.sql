-- Read-only diagnostics. Run in the approved project's SQL Editor.
-- Output contains no passwords, tokens, private content, emails or user UUIDs.
select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef as security_definer,pg_get_userbyid(p.proowner) as function_owner,
 p.proconfig as function_settings,
 obj_description(p.oid,'pg_proc') as ownership_marker,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('study_is_allowed','get_study_state','study_get_private_content','study_set_private_content')
order by p.proname;
select c.relname,c.relrowsecurity as rls_enabled,
 has_table_privilege('anon',c.oid,'SELECT') as anon_select,
 has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_direct_select,
 has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_direct_insert
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='study_private_content';
select (select count(*) from public.study_allowed_users) as allowed_user_count,
 (select count(*) from public.study_allowed_users a join auth.users u on u.id=a.user_id) as valid_allowed_user_count;
select r.rolname,s.setconfig as role_runtime_settings
from pg_db_role_setting s join pg_roles r on r.oid=s.setrole
where r.rolname in ('anon','authenticated','authenticator');
-- SQL Editor auth.uid() is usually NULL; don't use it to judge the browser user's login.
