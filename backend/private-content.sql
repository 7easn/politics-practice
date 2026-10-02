-- Install after the existing study sync initializer, in the approved project.
-- Content stays in PostgreSQL, accessible only through owner-authenticated RPC.
begin;
do $$
declare n text; o oid;
begin
  if obj_description(to_regprocedure('public.study_is_allowed()'),'pg_proc') is distinct from 'psychology-study-sync-v1' then
    raise exception 'Install the reviewed study sync initializer first';
  end if;
  o:=to_regclass('public.study_private_content');
  if o is not null and obj_description(o,'pg_class') is distinct from 'private-study-content-v1' then
    raise exception 'Unowned existing study_private_content table';
  end if;
  foreach n in array array['study_get_private_content(text)','study_set_private_content(text,jsonb)'] loop
    o:=to_regprocedure('public.'||n);
    if o is not null and obj_description(o,'pg_proc') is distinct from 'private-study-content-v1' then
      raise exception 'Unowned existing function %',n;
    end if;
  end loop;
end; $$;
create table if not exists public.study_private_content (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_key text not null check(document_key in ('psychology','politics','english','notes','documents')),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(user_id,document_key)
);
comment on table public.study_private_content is 'private-study-content-v1';
alter table public.study_private_content enable row level security;
revoke all on public.study_private_content from public,anon,authenticated;
create or replace function public.study_get_private_content(p_key text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
  if uid is null or not public.study_is_allowed() then
    raise exception 'Study access denied' using errcode='42501';
  end if;
  select payload into result from public.study_private_content
    where user_id=uid and document_key=p_key;
  if not found then raise exception 'Private content not imported' using errcode='P0002'; end if;
  return result;
end; $$;
create or replace function public.study_set_private_content(p_key text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare uid uuid:=auth.uid(); saved timestamptz;
begin
  if uid is null or not public.study_is_allowed() then
    raise exception 'Study access denied' using errcode='42501';
  end if;
  if p_key not in ('psychology','politics','english','notes','documents')
    or p_payload is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>33554432 then
    raise exception 'Invalid private content document' using errcode='22023';
  end if;
  insert into public.study_private_content(user_id,document_key,payload)
    values(uid,p_key,p_payload)
    on conflict(user_id,document_key) do update set payload=excluded.payload,updated_at=now()
    returning updated_at into saved;
  return jsonb_build_object('saved',true,'document_key',p_key,'updated_at',saved);
end; $$;
comment on function public.study_get_private_content(text) is 'private-study-content-v1';
comment on function public.study_set_private_content(text,jsonb) is 'private-study-content-v1';
revoke all on function public.study_get_private_content(text),public.study_set_private_content(text,jsonb) from public,anon,authenticated;
grant execute on function public.study_get_private_content(text),public.study_set_private_content(text,jsonb) to authenticated;
commit;
