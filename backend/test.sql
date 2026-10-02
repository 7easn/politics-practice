-- Local integration fixture only; never run this file in a real Supabase project.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
grant usage on schema public,auth to anon,authenticated;
\ir supabase.sql
insert into auth.users values
('10000000-0000-4000-8000-000000000001'),
('10000000-0000-4000-8000-000000000002'),
('10000000-0000-4000-8000-000000000003');
insert into public.study_allowed_users values
('10000000-0000-4000-8000-000000000001'),
('10000000-0000-4000-8000-000000000002');
do $$ begin
  if has_table_privilege('anon','public.study_accounts','SELECT') or
     has_table_privilege('authenticated','public.study_accounts','INSERT') or
     has_table_privilege('authenticated','public.study_events','UPDATE') then
    raise exception 'FAIL: excessive direct grants';
  end if;
end; $$;
set role anon;
do $$ declare denied boolean:=false; begin
  begin perform public.get_study_state(); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL: anonymous RPC allowed'; end if;
end; $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$ declare result jsonb; denied boolean:=false; begin
  result:=public.get_study_state();
  if result->>'revision'<>'0' then raise exception 'FAIL: initial revision'; end if;
  result:=public.submit_study_batch(0,'[{"id":"20000000-0000-4000-8000-000000000001","kind":"answer","target":"Q-test","payload":{"correct":true,"selected":[1]}}]');
  if result->>'status'<>'ok' or result->>'revision'<>'1' or result#>>'{state,answers,Q-test,attempts}'<>'1' then raise exception 'FAIL: first answer'; end if;
  result:=public.submit_study_batch(0,'[{"id":"20000000-0000-4000-8000-000000000001","kind":"answer","target":"Q-test","payload":{"correct":true,"selected":[1]}}]');
  if result->>'revision'<>'1' or result#>>'{state,answers,Q-test,attempts}'<>'1' then raise exception 'FAIL: replay not idempotent'; end if;
  begin
    perform public.submit_study_batch(1,'[{"id":"20000000-0000-4000-8000-000000000001","kind":"answer","target":"different","payload":{"correct":true,"selected":[1]}}]');
  exception when others then denied:=true; end;
  if not denied then raise exception 'FAIL: reused event accepted different content'; end if;
  result:=public.submit_study_batch(0,'[{"id":"20000000-0000-4000-8000-000000000002","kind":"favorite","target":"Q-test","payload":{"value":true}}]');
  if result->>'status'<>'conflict' or result->>'revision'<>'1' then raise exception 'FAIL: stale write did not conflict'; end if;
  result:=public.submit_study_batch(1,'[{"id":"20000000-0000-4000-8000-000000000002","kind":"favorite","target":"Q-test","payload":{"value":true}}]');
  if result#>>'{state,favorites,0}'<>'Q-test' then raise exception 'FAIL: favorite missing'; end if;
  result:=public.submit_study_batch(2,'[{"id":"20000000-0000-4000-8000-000000000003","kind":"favorite","target":"Q-test","payload":{"value":false}}]');
  if jsonb_array_length(result#>'{state,favorites}')<>0 then raise exception 'FAIL: deletion resurrected'; end if;
  denied:=false;
  begin perform public.submit_study_batch(null,'[]'); exception when others then denied:=true; end;
  if not denied then raise exception 'FAIL: null revision allowed'; end if;
  denied:=false;
  begin perform public.submit_study_batch(3,'[{"id":"20000000-0000-4000-8000-000000000004","kind":"answer","target":"Q-test","payload":{"selected":[0]}}]'); exception when others then denied:=true; end;
  if not denied then raise exception 'FAIL: malformed answer accepted'; end if;
  denied:=false;
  begin perform public.submit_study_batch(3,jsonb_build_array(jsonb_build_object(
    'id','20000000-0000-4000-8000-000000000005','kind','favorite','target','Q-test',
    'payload',jsonb_build_object('value',true,'oversize',repeat('x',5000)))));
  exception when others then denied:=true; end;
  if not denied then raise exception 'FAIL: oversized payload accepted'; end if;
end; $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$ declare result jsonb; begin
  if exists(select 1 from public.study_accounts) or exists(select 1 from public.study_events) then raise exception 'FAIL: cross-user SELECT'; end if;
  result:=public.get_study_state();
  if result#>'{state,answers}'<>'{}'::jsonb then raise exception 'FAIL: cross-user RPC'; end if;
  result:=public.submit_study_batch(0,'[{"id":"20000000-0000-4000-8000-000000000001","kind":"wrong","target":"Q-other","payload":{"value":true}}]');
  if result->>'status'<>'ok' then raise exception 'FAIL: event IDs must be scoped to user'; end if;
end; $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$ declare denied boolean:=false; begin
  begin perform public.get_study_state(); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL: unlisted user RPC'; end if;
  if exists(select 1 from public.study_accounts) then raise exception 'FAIL: unlisted user SELECT'; end if;
end; $$;
reset role;
-- Reinstalling owned schema must preserve both users' learning records.
\ir supabase.sql
do $$ begin
  if (select count(*) from public.study_accounts)<>2 or
     (select count(*) from public.study_events)<>4 then
    raise exception 'FAIL: reinstall changed learning data';
  end if;
end; $$;
select 'PASS: auth grants, RLS user isolation, allowed list, malformed input, idempotence, event identity, concurrent revision conflicts, deletion, user-scoped event IDs and reinstall preservation' as result;
