-- Reviewed deployment proposal. Run only in the user's approved project.
-- No password, API secret, or actual user UUID is included here.
begin;
-- Refuse to replace unrelated same-name objects, including in a partially used project.
do $$
declare name text; obj oid;
begin
  foreach name in array array['study_allowed_users','study_accounts','study_events'] loop
    obj:=to_regclass('public.'||name);
    if obj is not null and obj_description(obj,'pg_class') is distinct from 'psychology-study-sync-v1' then
      raise exception 'Unowned existing table public.%; inspect before installing',name;
    end if;
  end loop;
  foreach name in array array['study_is_allowed()','get_study_state()','submit_study_batch(bigint,jsonb)'] loop
    obj:=to_regprocedure('public.'||name);
    if obj is not null and obj_description(obj,'pg_proc') is distinct from 'psychology-study-sync-v1' then
      raise exception 'Unowned existing function public.%; inspect before installing',name;
    end if;
  end loop;
end; $$;
create table if not exists public.study_allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
revoke all on public.study_allowed_users from anon, authenticated;
alter table public.study_allowed_users enable row level security;

create or replace function public.study_is_allowed() returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select exists(select 1 from public.study_allowed_users where user_id = auth.uid()); $$;
revoke all on function public.study_is_allowed() from public;
grant execute on function public.study_is_allowed() to authenticated;

create table if not exists public.study_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check(revision >= 0),
  state jsonb not null default '{"answers":{},"wrong":[],"favorites":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.study_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  revision bigint not null,
  action text not null check(action in ('answer','import_answer','wrong','favorite')),
  target_id text not null check(length(target_id) between 1 and 150),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key(user_id,event_id)
);
alter table public.study_accounts enable row level security;
alter table public.study_events enable row level security;
drop policy if exists study_accounts_read on public.study_accounts;
create policy study_accounts_read on public.study_accounts for select to authenticated
using(user_id=auth.uid() and public.study_is_allowed());
drop policy if exists study_events_read on public.study_events;
create policy study_events_read on public.study_events for select to authenticated
using(user_id=auth.uid() and public.study_is_allowed());
revoke all on public.study_accounts,public.study_events from anon,authenticated;
grant select on public.study_accounts,public.study_events to authenticated;

create or replace function public.get_study_state() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null or not public.study_is_allowed() then
    raise exception 'Study access denied' using errcode='42501';
  end if;
  select jsonb_build_object('user_id',user_id,'revision',revision,'state',state) into result
    from public.study_accounts where user_id=uid;
  return coalesce(result,jsonb_build_object('user_id',uid,'revision',0,'state',
    '{"answers":{},"wrong":[],"favorites":[]}'::jsonb));
end; $$;

create or replace function public.submit_study_batch(expected_revision bigint, operations jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid(); rev bigint; snapshot jsonb; op jsonb;
  eid uuid; kind text; target text; payload jsonb; prior jsonb; item jsonb; accepted jsonb := '[]';
  choices jsonb; count_attempts integer;
begin
  if uid is null or not public.study_is_allowed() then
    raise exception 'Study access denied' using errcode='42501';
  end if;
  if expected_revision is null or expected_revision<0 or jsonb_typeof(operations) is distinct from 'array' or jsonb_array_length(operations)>200 then
    raise exception 'Invalid operation batch';
  end if;
  insert into public.study_accounts(user_id) values(uid) on conflict do nothing;
  select revision,state into rev,snapshot from public.study_accounts where user_id=uid for update;
  -- If a request was accepted but its response was lost, IDs still acknowledge it.
  for op in select value from jsonb_array_elements(operations) loop
    eid := (op->>'id')::uuid;
    if exists(select 1 from public.study_events where user_id=uid and event_id=eid) then
      if not exists(select 1 from public.study_events e where e.user_id=uid and e.event_id=eid
        and e.action=op->>'kind' and e.target_id=op->>'target' and e.payload=op->'payload') then
        raise exception 'Event identity reused with different content';
      end if;
      accepted := accepted || jsonb_build_array(eid);
    end if;
  end loop;
  if expected_revision <> rev and jsonb_array_length(accepted) < jsonb_array_length(operations) then
    return jsonb_build_object('status','conflict','revision',rev,'state',snapshot,'accepted',accepted);
  end if;
  for op in select value from jsonb_array_elements(operations) loop
    eid := (op->>'id')::uuid;
    if exists(select 1 from public.study_events where user_id=uid and event_id=eid) then continue; end if;
    kind:=op->>'kind'; target:=op->>'target'; payload:=op->'payload';
    if target is null or length(target) not between 1 and 150 or jsonb_typeof(payload) is distinct from 'object'
       or octet_length(payload::text)>4096 then
      raise exception 'Invalid operation';
    end if;
    if kind in ('answer','import_answer') then
      if jsonb_typeof(payload->'correct') is distinct from 'boolean' or jsonb_typeof(payload->'selected') is distinct from 'array'
         or jsonb_array_length(payload->'selected')>10 then raise exception 'Invalid answer'; end if;
      if exists(select 1 from jsonb_array_elements(payload->'selected') v
          where jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]+$' or (v::text)::int>20) then
        raise exception 'Invalid choice index';
      end if;
      prior:=snapshot->'answers'->target;
      count_attempts:=coalesce((prior->>'attempts')::integer,0);
      if kind='answer' then count_attempts:=count_attempts+1;
      else
        if coalesce(payload->>'attempts','') !~ '^[0-9]+$' then raise exception 'Invalid attempt count'; end if;
        if (payload->>'attempts')::integer<1 or (payload->>'attempts')::integer>100000 then raise exception 'Invalid attempt count'; end if;
        count_attempts:=greatest(count_attempts,(payload->>'attempts')::integer);
      end if;
      item:=jsonb_build_object('correct',payload->'correct','selected',payload->'selected',
        'attempts',count_attempts,'firstCorrect',coalesce(prior->'firstCorrect',payload->'correct'),
        'time',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
      snapshot:=jsonb_set(snapshot,array['answers',target],item,true);
    elsif kind in ('wrong','favorite') then
      if jsonb_typeof(payload->'value') is distinct from 'boolean' then raise exception 'Invalid set operation'; end if;
      choices:=coalesce(snapshot->case when kind='wrong' then 'wrong' else 'favorites' end,'[]'::jsonb);
      select coalesce(jsonb_agg(v),'[]'::jsonb) into choices from jsonb_array_elements(choices) v
        where v<>to_jsonb(target);
      if (payload->>'value')::boolean then choices:=choices||jsonb_build_array(target); end if;
      snapshot:=jsonb_set(snapshot,array[case when kind='wrong' then 'wrong' else 'favorites' end],choices,true);
    else raise exception 'Unsupported operation';
    end if;
    rev:=rev+1;
    insert into public.study_events(user_id,event_id,revision,action,target_id,payload)
      values(uid,eid,rev,kind,target,payload);
    accepted:=accepted||jsonb_build_array(eid);
  end loop;
  update public.study_accounts set revision=rev,state=snapshot,updated_at=now() where user_id=uid;
  return jsonb_build_object('status','ok','revision',rev,'state',snapshot,'accepted',accepted);
end; $$;
revoke all on function public.get_study_state() from public;
revoke all on function public.submit_study_batch(bigint,jsonb) from public;
grant execute on function public.get_study_state() to authenticated;
grant execute on function public.submit_study_batch(bigint,jsonb) to authenticated;
comment on table public.study_allowed_users is 'psychology-study-sync-v1';
comment on table public.study_accounts is 'psychology-study-sync-v1';
comment on table public.study_events is 'psychology-study-sync-v1';
comment on function public.study_is_allowed() is 'psychology-study-sync-v1';
comment on function public.get_study_state() is 'psychology-study-sync-v1';
comment on function public.submit_study_batch(bigint,jsonb) is 'psychology-study-sync-v1';
commit;

-- USER ACTION after reviewing and obtaining the actual Auth UUID:
-- insert into public.study_allowed_users(user_id) values ('ACTUAL-USER-UUID');
-- This comment is intentionally not executable. Do not substitute a guessed UUID.
