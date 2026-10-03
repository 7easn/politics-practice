-- Private subject package candidate v1. Additive, no timeout/RLS relaxation.
-- Requires existing private-content-chunks.sql and study_is_allowed().
begin;
do $$ declare n text;o oid;begin
 if obj_description(to_regclass('public.study_content_uploads'),'pg_class') is distinct from 'private-study-chunks-v1' then raise exception 'Install owned chunk schema first';end if;
 foreach n in array array['study_subject_packages','study_subject_objects','study_subject_ids','study_subject_assets','study_subject_active'] loop
  o:=to_regclass('public.'||n);if o is not null and obj_description(o,'pg_class') is distinct from 'private-subject-packages-v1' then raise exception 'Unowned table %',n;end if;
 end loop;
 foreach n in array array['study_subject_baseline(uuid,text)','study_begin_subject_package(text,text)','study_put_subject_object(uuid,integer,text)','study_verify_subject_asset(uuid,text)','study_commit_subject_package(uuid)','study_get_subject_package(text)','study_get_subject_object(uuid,integer)'] loop
  o:=to_regprocedure('public.'||n);if o is not null and obj_description(o,'pg_proc') is distinct from 'private-subject-packages-v1' then raise exception 'Unowned function %',n;end if;
 end loop;
end $$;
create table if not exists public.study_subject_packages(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 subject text not null check(subject in ('psychology','politics','english')),sha256 text not null check(sha256~'^[0-9a-f]{64}$'),
 manifest_text text not null check(octet_length(manifest_text)<=131072),manifest jsonb not null,
 baseline text not null,object_count integer not null check(object_count between 1 and 2048),
 complete boolean not null default false,created_at timestamptz not null default now(),unique(user_id,subject,sha256,baseline)
);
create table if not exists public.study_subject_objects(
 package_id uuid not null references public.study_subject_packages(id) on delete cascade,object_index integer not null,
 descriptor jsonb not null,body bytea,received boolean not null default false,primary key(package_id,object_index)
);
create table if not exists public.study_subject_ids(
 package_id uuid not null references public.study_subject_packages(id) on delete cascade,
 namespace text not null,id text not null,object_index integer not null,primary key(package_id,namespace,id),
 foreign key(package_id,object_index) references public.study_subject_objects(package_id,object_index) on delete cascade
);
create table if not exists public.study_subject_assets(
 package_id uuid not null references public.study_subject_packages(id) on delete cascade,
 field text not null,file_name text not null,byte_count integer not null check(byte_count between 4 and 8388608),
 sha256 text not null check(sha256~'^[0-9a-f]{64}$'),verified boolean not null default false,
 primary key(package_id,field),unique(package_id,file_name)
);
create table if not exists public.study_subject_active(
 user_id uuid not null references auth.users(id) on delete cascade,subject text not null check(subject in ('psychology','politics','english')),
 package_id uuid not null references public.study_subject_packages(id),updated_at timestamptz not null default now(),primary key(user_id,subject)
);
comment on table public.study_subject_packages is 'private-subject-packages-v1';
comment on table public.study_subject_objects is 'private-subject-packages-v1';
comment on table public.study_subject_ids is 'private-subject-packages-v1';
comment on table public.study_subject_assets is 'private-subject-packages-v1';
comment on table public.study_subject_active is 'private-subject-packages-v1';
alter table public.study_subject_packages enable row level security;
alter table public.study_subject_objects enable row level security;
alter table public.study_subject_ids enable row level security;
alter table public.study_subject_assets enable row level security;
alter table public.study_subject_active enable row level security;
revoke all on public.study_subject_packages,public.study_subject_objects,public.study_subject_ids,public.study_subject_assets,public.study_subject_active from public,anon,authenticated;

-- Small identity-scoped baseline; never reads full content bodies.
create or replace function public.study_subject_baseline(p_uid uuid,p_subject text) returns text
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select 'package:'||p.sha256 from public.study_subject_active a join public.study_subject_packages p on p.id=a.package_id and p.user_id=a.user_id and p.complete where a.user_id=p_uid and a.subject=p_subject),
 'legacy:'||encode(sha256(convert_to((select coalesce(jsonb_agg(jsonb_build_array(k,coalesce(a.upload_id::text,'')) order by k),'[]'::jsonb)::text from unnest(case when p_subject='psychology' then array['psychology','notes','documents'] else array[p_subject] end) k left join public.study_content_active a on a.user_id=p_uid and a.document_key=k),'UTF8')),'hex'))
$$;
create or replace function public.study_begin_subject_package(p_manifest text,p_expected_baseline text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid();m jsonb;o jsonb;part jsonb;u public.study_subject_packages;sha text;sub text;idx integer:=0;total bigint:=0;roots text[]:='{}';fields jsonb:='{}';key text;start_at integer;cnt integer;role text;component text;seen text[]:='{}';begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501';end if;
 if p_manifest is null or octet_length(p_manifest)>131072 then raise exception 'Manifest too large' using errcode='22023';end if;
 m:=p_manifest::jsonb;sub:=m->>'subject';
 if m->>'format' is distinct from 'private-subject-package' or m->>'schema_version' is distinct from '1' or sub is null or sub not in ('psychology','politics','english') or m->>'file_complete' is distinct from 'true' or coalesce(length(m->>'package_version'),0) not between 1 and 160 or jsonb_typeof(m->'objects') is distinct from 'array' or jsonb_typeof(m->'semantic_review') is distinct from 'object' then raise exception 'Invalid package manifest' using errcode='22023';end if;
 if coalesce(m#>>'{semantic_review,status}','') not in ('incomplete','reviewed-with-limitations','reviewed') or jsonb_typeof(m#>'{semantic_review,scope}') is distinct from 'string' or jsonb_typeof(m#>'{semantic_review,limitations}') is distinct from 'array' or jsonb_array_length(m->'objects') not between 1 and 2048 then raise exception 'Review scope required' using errcode='22023';end if;
 for o in select value from jsonb_array_elements(m->'objects') loop
  role:=o->>'role';component:=o->>'component';
  if jsonb_typeof(o) is distinct from 'object' or coalesce((o->>'index')::integer,-1)<>idx or coalesce(o->>'path','')!~'^objects/[0-9]{4}\.(json|bin)$' or o->>'path'=any(seen) or coalesce(role,'') not in ('root','array','asset') or coalesce(component,'') not in ('bank','notes','documents') or coalesce(o->>'sha256','')!~'^[0-9a-f]{64}$' or coalesce((o->>'bytes')::integer,0) not between 1 and 262144 or jsonb_typeof(o->'field') is distinct from 'string' or coalesce((o->>'start')::integer,-1)<0 or coalesce((o->>'count')::integer,-1)<0 then raise exception 'Invalid object descriptor' using errcode='22023';end if;
  seen:=array_append(seen,o->>'path');total:=total+(o->>'bytes')::integer;start_at:=(o->>'start')::integer;cnt:=(o->>'count')::integer;
  if role='root' then
   if component=any(roots) or o->>'field'<>'' or start_at<>0 or cnt<>0 then raise exception 'Invalid component root' using errcode='22023';end if;roots:=array_append(roots,component);
  else
   if o->>'field'!~'^[A-Za-z][A-Za-z0-9_-]{0,100}$' or role='asset' and (component<>'documents' or cnt<>(o->>'bytes')::integer) then raise exception 'Invalid field' using errcode='22023';end if;
   key:=component||':'||role||':'||(o->>'field');if start_at<>coalesce((fields->>key)::integer,0) or fields?key and start_at=0 then raise exception 'Noncontiguous objects' using errcode='22023';end if;fields:=jsonb_set(fields,array[key],to_jsonb(start_at+cnt));
  end if;idx:=idx+1;
 end loop;
 if total>134217728 or cardinality(roots)<>3 or not fields?'bank:array:subjects' or not fields?'bank:array:sources' or not fields?'bank:array:knowledgePoints' or not fields?'bank:array:memoryQuestions' or not fields?'bank:array:predictions' or not fields?'notes:array:records' or not fields?'documents:array:documents' then raise exception 'Incomplete component manifest' using errcode='22023';end if;
 sha:=encode(sha256(convert_to(p_manifest,'UTF8')),'hex');
 if p_expected_baseline is null or p_expected_baseline<>public.study_subject_baseline(uid,sub) then raise exception 'Subject baseline changed' using errcode='40001';end if;
 if not exists(select 1 from public.study_subject_packages where user_id=uid and subject=sub and sha256=sha and baseline=p_expected_baseline) and (select count(*) from public.study_subject_packages where user_id=uid and not complete)>=10 then raise exception 'Too many incomplete packages' using errcode='54000';end if;
 insert into public.study_subject_packages(user_id,subject,sha256,manifest_text,manifest,baseline,object_count) values(uid,sub,sha,p_manifest,m,p_expected_baseline,idx) on conflict(user_id,subject,sha256,baseline) do nothing;
 select * into u from public.study_subject_packages where user_id=uid and subject=sub and sha256=sha and baseline=p_expected_baseline;
 insert into public.study_subject_objects(package_id,object_index,descriptor) select u.id,(x->>'index')::integer,x from jsonb_array_elements(m->'objects') x on conflict do nothing;
 return jsonb_build_object('package_id',u.id,'sha256',sha,'complete',u.complete,'received',(select coalesce(jsonb_agg(object_index order by object_index),'[]'::jsonb) from public.study_subject_objects where package_id=u.id and received));
end $$;

create or replace function public.study_put_subject_object(p_package uuid,p_index integer,p_base64 text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid();u public.study_subject_packages;o public.study_subject_objects;b bytea;v jsonb;x jsonb;ns text;begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501';end if;
 select * into u from public.study_subject_packages where id=p_package and user_id=uid for share nowait;
 if not found then raise exception 'Package unavailable' using errcode='P0002';end if;
 select * into o from public.study_subject_objects where package_id=u.id and object_index=p_index for update nowait;
 if not found then raise exception 'Object unavailable' using errcode='P0002';end if;
 if p_base64 is null or octet_length(p_base64)>349528 then raise exception 'Object too large' using errcode='22023';end if;b:=decode(p_base64,'base64');
 if octet_length(b)<>(o.descriptor->>'bytes')::integer or encode(sha256(b),'hex')<>o.descriptor->>'sha256' then raise exception 'Object checksum mismatch' using errcode='22023';end if;
 if o.received then return jsonb_build_object('received',true,'index',p_index,'sha256',o.descriptor->>'sha256');end if;
 if u.complete then raise exception 'Completed package immutable' using errcode='22023';end if;
 if o.descriptor->>'role'<>'asset' then
  v:=convert_from(b,'UTF8')::jsonb;
  if o.descriptor->>'role'='root' then
   if jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_each(v) e where jsonb_typeof(e.value)='array' or e.key in ('__proto__','constructor','prototype')) then raise exception 'Invalid root' using errcode='22023';end if;
   if exists(select 1 from jsonb_object_keys(v) k join public.study_subject_objects a on a.package_id=u.id and a.descriptor->>'component'=o.descriptor->>'component' and a.descriptor->>'role'='array' and a.descriptor->>'field'=k) then raise exception 'Root/array field collision' using errcode='22023';end if;
  else
   if jsonb_typeof(v)<>'array' or jsonb_array_length(v)<>(o.descriptor->>'count')::integer then raise exception 'Invalid array' using errcode='22023';end if;
   if o.descriptor->>'component'='bank' and o.descriptor->>'field' in ('memoryQuestions','predictions') then ns:='question';
   elsif o.descriptor->>'component'='notes' and o.descriptor->>'field'='records' then ns:='note';end if;
   for x in select value from jsonb_array_elements(v) loop
    if ns is not null then
     if jsonb_typeof(x)<>'object' or jsonb_typeof(x->'id') is distinct from 'string' or coalesce(length(x->>'id'),0) not between 1 and 256 then raise exception 'Missing stable ID' using errcode='22023';end if;
     insert into public.study_subject_ids values(u.id,ns,x->>'id',p_index);
    end if;
    if o.descriptor->>'component'='documents' and o.descriptor->>'field'='documents' then
     if jsonb_typeof(x)<>'object' or coalesce(x->>'file_name','')!~'^[^/\\]+\.docx$' or coalesce(x->>'asset_field','')!~'^[A-Za-z][A-Za-z0-9_-]{0,100}$' or coalesce((x->>'bytes')::integer,0) not between 4 and 8388608 or coalesce(x->>'sha256','')!~'^[0-9a-f]{64}$' then raise exception 'Invalid Word metadata' using errcode='22023';end if;
     if (select sum((descriptor->>'bytes')::integer) from public.study_subject_objects where package_id=u.id and descriptor->>'role'='asset' and descriptor->>'field'=x->>'asset_field') is distinct from (x->>'bytes')::bigint then raise exception 'Word asset manifest mismatch' using errcode='22023';end if;
     insert into public.study_subject_assets(package_id,field,file_name,byte_count,sha256) values(u.id,x->>'asset_field',x->>'file_name',(x->>'bytes')::integer,x->>'sha256');
    end if;
    if ns='question' then
     if jsonb_typeof(x->'prompt') is distinct from 'string' then raise exception 'Question prompt missing' using errcode='22023';end if;
     if o.descriptor->>'field'='memoryQuestions' then
      if jsonb_typeof(x->'options') is distinct from 'array' or jsonb_typeof(x->'answer') is distinct from 'array' then raise exception 'Invalid memory question' using errcode='22023';end if;
      if exists(select 1 from jsonb_array_elements(x->'answer') a where jsonb_typeof(a)<>'number' or a::text!~'^[0-9]+$' or a::text::numeric>=jsonb_array_length(x->'options')) then raise exception 'Invalid answer index' using errcode='22023';end if;
     elsif jsonb_typeof(x->'answer_points') is distinct from 'array' then raise exception 'Answer points missing' using errcode='22023';end if;
    elsif ns='note' and jsonb_typeof(coalesce(x->'text',x->'original_text')) is distinct from 'string' then raise exception 'Note text missing' using errcode='22023';end if;
   end loop;
  end if;
 end if;
 update public.study_subject_objects set body=b,received=true where package_id=u.id and object_index=p_index;
 return jsonb_build_object('received',true,'index',p_index,'sha256',o.descriptor->>'sha256');
exception when lock_not_available then raise exception 'Package busy; retry same object' using errcode='40001';
end $$;

-- One original file per request, bounded to 8 MiB; never parses the bank.
create or replace function public.study_verify_subject_asset(p_package uuid,p_field text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid();u public.study_subject_packages;d public.study_subject_assets;b bytea;begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501';end if;
 select * into u from public.study_subject_packages where id=p_package and user_id=uid for share nowait;
 if not found then raise exception 'Package unavailable' using errcode='P0002';end if;
 select * into d from public.study_subject_assets where package_id=u.id and field=p_field for update nowait;
 if not found then raise exception 'Asset unavailable' using errcode='P0002';end if;
 if d.verified then return jsonb_build_object('verified',true,'field',p_field,'sha256',d.sha256);end if;
 if u.complete then raise exception 'Complete package immutable' using errcode='22023';end if;
 if exists(select 1 from public.study_subject_objects where package_id=u.id and descriptor->>'role'='asset' and descriptor->>'field'=d.field and not received) then raise exception 'Incomplete file receipts' using errcode='22023';end if;
 select string_agg(body,''::bytea order by (descriptor->>'start')::integer) into b from public.study_subject_objects where package_id=u.id and descriptor->>'role'='asset' and descriptor->>'field'=d.field and received;
 if b is null or octet_length(b)<>d.byte_count or encode(sha256(b),'hex')<>d.sha256 or substring(b from 1 for 4)<>decode('504b0304','hex') then raise exception 'Original Word checksum/signature mismatch' using errcode='22023';end if;
 update public.study_subject_assets set verified=true where package_id=u.id and field=d.field;
 return jsonb_build_object('verified',true,'field',d.field,'sha256',d.sha256);
exception when lock_not_available then raise exception 'File verification busy' using errcode='40001';end $$;

create or replace function public.study_commit_subject_package(p_package uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid();u public.study_subject_packages;saved timestamptz;begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501';end if;
 select * into u from public.study_subject_packages where id=p_package and user_id=uid;
 if not found then raise exception 'Package unavailable' using errcode='P0002';end if;
 -- Receipts only: no string_agg, bytea concatenation or whole-bank JSON parsing.
 if (select count(*) from public.study_subject_objects where package_id=u.id and received)<>u.object_count then raise exception 'Incomplete package receipts' using errcode='22023';end if;
 if exists(select 1 from public.study_subject_assets where package_id=u.id and not verified) or exists(select 1 from public.study_subject_objects o where o.package_id=u.id and o.descriptor->>'role'='asset' and not exists(select 1 from public.study_subject_assets d where d.package_id=u.id and d.field=o.descriptor->>'field')) then raise exception 'Unverified or unclaimed original file' using errcode='22023';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(uid::text||':'||u.subject,87421)) then raise exception 'Subject activation busy' using errcode='40001';end if;
 select * into u from public.study_subject_packages where id=p_package and user_id=uid for update nowait;
 perform 1 from public.study_subject_active where user_id=uid and subject=u.subject for update nowait;
 -- Lock existing legacy pointers through first activation; no legacy body reads.
 if u.baseline like 'legacy:%' then perform 1 from public.study_content_active where user_id=uid and document_key=any(case when u.subject='psychology' then array['psychology','notes','documents'] else array[u.subject] end) for update nowait;end if;
 if exists(select 1 from public.study_subject_active where user_id=uid and subject=u.subject and package_id=u.id) then
  return jsonb_build_object('saved',true,'subject',u.subject,'sha256',u.sha256,'already_active',true);
 end if;
 if public.study_subject_baseline(uid,u.subject)<>u.baseline then raise exception 'Subject baseline changed' using errcode='40001';end if;
 update public.study_subject_packages set complete=true where id=u.id;
 insert into public.study_subject_active(user_id,subject,package_id) values(uid,u.subject,u.id) on conflict(user_id,subject) do update set package_id=excluded.package_id,updated_at=now() returning updated_at into saved;
 return jsonb_build_object('saved',true,'subject',u.subject,'sha256',u.sha256,'updated_at',saved);
exception when lock_not_available then raise exception 'Subject activation busy' using errcode='40001';
end $$;

create or replace function public.study_get_subject_package(p_subject text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid();result jsonb;begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501';end if;
 if p_subject is null or p_subject not in ('psychology','politics','english') then raise exception 'Invalid subject' using errcode='22023';end if;
 select jsonb_build_object('package_id',p.id,'sha256',p.sha256,'manifest_text',p.manifest_text,'updated_at',a.updated_at,'baseline','package:'||p.sha256) into result from public.study_subject_active a join public.study_subject_packages p on p.id=a.package_id and p.user_id=a.user_id and p.complete where a.user_id=uid and a.subject=p_subject;
 if not found then return jsonb_build_object('available',false,'subject',p_subject,'baseline',public.study_subject_baseline(uid,p_subject));end if;return result;
end $$;
create or replace function public.study_get_subject_object(p_package uuid,p_index integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid();result jsonb;begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501';end if;
 select jsonb_build_object('index',o.object_index,'base64',replace(encode(o.body,'base64'),E'\n',''),'sha256',o.descriptor->>'sha256') into result from public.study_subject_objects o join public.study_subject_packages p on p.id=o.package_id where p.id=p_package and p.user_id=uid and p.complete and o.received and o.object_index=p_index;
 if not found then raise exception 'Object unavailable' using errcode='P0002';end if;return result;
end $$;

do $$ declare n text;begin
 foreach n in array array['study_subject_baseline(uuid,text)','study_begin_subject_package(text,text)','study_put_subject_object(uuid,integer,text)','study_verify_subject_asset(uuid,text)','study_commit_subject_package(uuid)','study_get_subject_package(text)','study_get_subject_object(uuid,integer)'] loop
  execute 'comment on function public.'||n||' is ''private-subject-packages-v1''';
  execute 'revoke all on function public.'||n||' from public,anon,authenticated';
  if n<>'study_subject_baseline(uuid,text)' then execute 'grant execute on function public.'||n||' to authenticated';end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
