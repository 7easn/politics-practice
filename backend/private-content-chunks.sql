-- Additive fix for HTTP 500 / 57014: bounded requests and atomic activation.
-- Run once in the existing approved project. Does not change role timeouts or records.
begin;
do $$ declare n text; o oid; begin
 if obj_description(to_regclass('public.study_private_content'),'pg_class') is distinct from 'private-study-content-v1' then raise exception 'Install private-content.sql first'; end if;
 foreach n in array array['study_content_uploads','study_content_chunks','study_content_active'] loop
  o:=to_regclass('public.'||n);
  if o is not null and obj_description(o,'pg_class') is distinct from 'private-study-chunks-v1' then raise exception 'Unowned existing table %',n; end if;
 end loop;
 foreach n in array array['study_begin_content_upload(text,text,integer,integer)','study_put_content_chunk(uuid,integer,text)','study_commit_content_upload(uuid)','study_get_content_manifest(text)','study_get_content_chunk(uuid,integer)'] loop
  o:=to_regprocedure('public.'||n);
  if o is not null and obj_description(o,'pg_proc') is distinct from 'private-study-chunks-v1' then raise exception 'Unowned existing function %',n; end if;
 end loop;
end $$;
create table if not exists public.study_content_uploads (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 document_key text not null check(document_key in ('psychology','politics','english','notes','documents')),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),byte_count integer not null check(byte_count between 2 and 33554432),
 chunk_count integer not null check(chunk_count between 1 and 512),complete boolean not null default false,
 created_at timestamptz not null default now(),unique(user_id,document_key,sha256)
);
create table if not exists public.study_content_chunks (
 upload_id uuid not null references public.study_content_uploads(id) on delete cascade,
 chunk_index integer not null check(chunk_index between 0 and 511),content text not null check(octet_length(content) between 1 and 524288),primary key(upload_id,chunk_index)
);
create table if not exists public.study_content_active (
 user_id uuid not null references auth.users(id) on delete cascade,document_key text not null,
 upload_id uuid not null references public.study_content_uploads(id),updated_at timestamptz not null default now(),primary key(user_id,document_key)
);
comment on table public.study_content_uploads is 'private-study-chunks-v1';
comment on table public.study_content_chunks is 'private-study-chunks-v1';
comment on table public.study_content_active is 'private-study-chunks-v1';
alter table public.study_content_uploads enable row level security;
alter table public.study_content_chunks enable row level security;
alter table public.study_content_active enable row level security;
revoke all on public.study_content_uploads,public.study_content_chunks,public.study_content_active from public,anon,authenticated;
create or replace function public.study_begin_content_upload(p_key text,p_sha256 text,p_bytes integer,p_chunks integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid(); u public.study_content_uploads; received jsonb; begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501'; end if;
 if p_key is null or p_key not in ('psychology','politics','english','notes','documents') or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_bytes is null or p_bytes not between 2 and 33554432 or p_chunks is null or p_chunks not between 1 and 512 then raise exception 'Invalid upload manifest' using errcode='22023'; end if;
 -- Delete only stale incomplete drafts. Completed and active versions are retained.
 delete from public.study_content_uploads where user_id=uid and not complete and created_at<now()-interval '7 days';
 if not exists(select 1 from public.study_content_uploads where user_id=uid and document_key=p_key and sha256=p_sha256) and (select count(*) from public.study_content_uploads where user_id=uid and not complete)>=10 then raise exception 'Too many unfinished uploads' using errcode='54000'; end if;
 insert into public.study_content_uploads(user_id,document_key,sha256,byte_count,chunk_count) values(uid,p_key,p_sha256,p_bytes,p_chunks) on conflict(user_id,document_key,sha256) do nothing;
 select * into u from public.study_content_uploads where user_id=uid and document_key=p_key and sha256=p_sha256;
 if u.byte_count<>p_bytes or u.chunk_count<>p_chunks then raise exception 'Manifest mismatch' using errcode='22023'; end if;
 select coalesce(jsonb_agg(chunk_index order by chunk_index),'[]'::jsonb) into received from public.study_content_chunks where upload_id=u.id;
 return jsonb_build_object('upload_id',u.id,'received',received,'complete',u.complete);
end $$;
create or replace function public.study_put_content_chunk(p_upload uuid,p_index integer,p_text text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid(); u public.study_content_uploads; old_text text; begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501'; end if;
 select * into u from public.study_content_uploads where id=p_upload and user_id=uid for update;
 if not found then raise exception 'Upload unavailable' using errcode='P0002'; end if;
 if p_index is null or p_index<0 or p_index>=u.chunk_count or p_text is null or octet_length(p_text) not between 1 and 524288 then raise exception 'Invalid chunk' using errcode='22023'; end if;
 select content into old_text from public.study_content_chunks where upload_id=u.id and chunk_index=p_index;
 if found then
  if old_text<>p_text then raise exception 'Chunk mismatch' using errcode='22023'; end if;
 elsif u.complete then raise exception 'Completed upload is immutable' using errcode='22023';
 else insert into public.study_content_chunks values(u.id,p_index,p_text);
 end if;
 return jsonb_build_object('received',true,'chunk_index',p_index);
end $$;
create or replace function public.study_commit_content_upload(p_upload uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid(); u public.study_content_uploads; total integer; bytes bigint; body text; saved timestamptz; begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501'; end if;
 select * into u from public.study_content_uploads where id=p_upload and user_id=uid for update;
 if not found then raise exception 'Upload unavailable' using errcode='P0002'; end if;
 if not u.complete then
  select count(*),sum(octet_length(content)),string_agg(content,'' order by chunk_index) into total,bytes,body from public.study_content_chunks where upload_id=u.id;
  if total<>u.chunk_count or bytes is distinct from u.byte_count::bigint or encode(sha256(convert_to(body,'UTF8')),'hex') is distinct from u.sha256 then raise exception 'Incomplete upload or checksum mismatch' using errcode='22023'; end if;
  -- JSON was validated by the importer. Avoid expensive full-document JSONB parsing.
  update public.study_content_uploads set complete=true where id=u.id;
 end if;
 insert into public.study_content_active(user_id,document_key,upload_id) values(uid,u.document_key,u.id)
 on conflict(user_id,document_key) do update set upload_id=excluded.upload_id,updated_at=now() returning updated_at into saved;
 return jsonb_build_object('saved',true,'document_key',u.document_key,'updated_at',saved,'sha256',u.sha256);
end $$;
create or replace function public.study_get_content_manifest(p_key text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid(); result jsonb; begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501'; end if;
 select jsonb_build_object('upload_id',u.id,'sha256',u.sha256,'byte_count',u.byte_count,'chunk_count',u.chunk_count,'document_key',a.document_key,'updated_at',a.updated_at) into result
 from public.study_content_active a join public.study_content_uploads u on u.id=a.upload_id and u.user_id=a.user_id and u.complete
 where a.user_id=uid and a.document_key=p_key;
 if not found then raise exception 'No chunked version' using errcode='P0002'; end if;
 return result;
end $$;
create or replace function public.study_get_content_chunk(p_upload uuid,p_index integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid(); body text; begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501'; end if;
 select c.content into body from public.study_content_chunks c join public.study_content_uploads u on u.id=c.upload_id
 where u.id=p_upload and u.user_id=uid and u.complete and c.chunk_index=p_index;
 if not found then raise exception 'Content chunk unavailable' using errcode='P0002'; end if;
 return jsonb_build_object('chunk_index',p_index,'content',body);
end $$;
comment on function public.study_begin_content_upload(text,text,integer,integer) is 'private-study-chunks-v1';
comment on function public.study_put_content_chunk(uuid,integer,text) is 'private-study-chunks-v1';
comment on function public.study_commit_content_upload(uuid) is 'private-study-chunks-v1';
comment on function public.study_get_content_manifest(text) is 'private-study-chunks-v1';
comment on function public.study_get_content_chunk(uuid,integer) is 'private-study-chunks-v1';
revoke all on function public.study_begin_content_upload(text,text,integer,integer),public.study_put_content_chunk(uuid,integer,text),public.study_commit_content_upload(uuid),public.study_get_content_manifest(text),public.study_get_content_chunk(uuid,integer) from public,anon,authenticated;
grant execute on function public.study_begin_content_upload(text,text,integer,integer),public.study_put_content_chunk(uuid,integer,text),public.study_commit_content_upload(uuid),public.study_get_content_manifest(text),public.study_get_content_chunk(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
