-- Local integration fixture only; NEVER run in an actual Supabase project.
\set ON_ERROR_STOP on
\ir test.sql
\ir private-content.sql
set role anon;
do $$ begin
  begin perform public.study_get_private_content('psychology');raise exception 'FAIL anonymous read';exception when insufficient_privilege then null;end;
  begin perform public.study_set_private_content('psychology','{}');raise exception 'FAIL anonymous write';exception when insufficient_privilege then null;end;
end; $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.study_set_private_content('psychology','{"marker":"owner-one","memoryQuestions":[]}');
do $$ begin
 if public.study_get_private_content('psychology')->>'marker'<>'owner-one' then raise exception 'FAIL owner read';end if;
 begin perform * from public.study_private_content;raise exception 'FAIL direct select';exception when insufficient_privilege then null;end;
 begin perform public.study_set_private_content('unexpected','{}');raise exception 'FAIL invalid key';exception when invalid_parameter_value then null;end;
 begin perform public.study_set_private_content('psychology','[]');raise exception 'FAIL invalid body';exception when invalid_parameter_value then null;end;
end; $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$ begin
 begin perform public.study_get_private_content('psychology');raise exception 'FAIL cross-owner leak';exception when no_data_found then null;end;
end; $$;
select public.study_set_private_content('psychology','{"marker":"owner-two"}');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$ begin
 begin perform public.study_get_private_content('psychology');raise exception 'FAIL unlisted read';exception when insufficient_privilege then null;end;
 begin perform public.study_set_private_content('psychology','{}');raise exception 'FAIL unlisted write';exception when insufficient_privilege then null;end;
end; $$;
reset role;
\ir private-content.sql
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
set role authenticated;
do $$ begin
 if public.study_get_private_content('psychology')->>'marker'<>'owner-one' then raise exception 'FAIL reinstall lost data';end if;
end; $$;
reset role;
delete from public.study_allowed_users where user_id='10000000-0000-4000-8000-000000000001';
set role authenticated;
do $$ begin
 begin perform public.study_get_private_content('psychology');raise exception 'FAIL revoked read';exception when insufficient_privilege then null;end;
end; $$;
reset role;
select 'PASS: owner RPC only; anonymous/unlisted/cross-owner/direct read denied; revoke, payload validation and reinstall preservation';
