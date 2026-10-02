-- PRIVATE CANDIDATE. Review and install only in the existing authorized project.
-- Additive CAS activation; full import preserved except stale completed replay is rejected.
begin;
do $$ begin
 if obj_description(to_regprocedure('public.study_set_private_content(text,jsonb)'),'pg_proc') is distinct from 'private-study-content-v1' then raise exception 'Install known private-content migration first'; end if;
 if obj_description(to_regprocedure('public.study_commit_content_upload(uuid)'),'pg_proc') is distinct from 'private-study-chunks-v1' then raise exception 'Install known chunks migration first'; end if;
 if to_regprocedure('public.study_commit_subjective_upload(uuid,text)') is not null and obj_description(to_regprocedure('public.study_commit_subjective_upload(uuid,text)'),'pg_proc') is distinct from 'private-study-subjective-cas-v1' then raise exception 'Unowned existing subjective RPC'; end if;
end $$;
create or replace function public.study_commit_subjective_upload(p_upload uuid,p_expected_sha256 text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid(); u public.study_content_uploads; a public.study_content_active; old_u public.study_content_uploads; total integer; bytes bigint; body text; old_body text; fresh jsonb; baseline jsonb; saved timestamptz; k text; allowed text[]:=array['predictions','predictionCoverage','subjectiveRenderingContract','subjectiveUpdate','version','content_package_version','sources','subjects']; begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501'; end if;
 if p_expected_sha256 is null or p_expected_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Baseline hash required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':psychology',0));
 -- Lock active row first: legacy full import also locks this row on UPDATE.
 select * into a from public.study_content_active where user_id=uid and document_key='psychology' for update;
 if not found then raise exception 'Existing baseline required; import a full bank first' using errcode='P0002'; end if;
 select * into old_u from public.study_content_uploads where id=a.upload_id and user_id=uid and complete;
 if not found then raise exception 'Baseline unavailable' using errcode='P0002'; end if;
 select * into u from public.study_content_uploads where id=p_upload and user_id=uid and document_key='psychology' for update;
 if not found then raise exception 'Upload unavailable' using errcode='P0002'; end if;
 -- Lost-response retry succeeds only if this exact version is still active.
 if u.complete and a.upload_id=u.id then return jsonb_build_object('saved',true,'document_key','psychology','sha256',u.sha256,'updated_at',a.updated_at,'already_active',true); end if;
 if old_u.sha256<>p_expected_sha256 then raise exception 'Baseline conflict; reload current bank' using errcode='40001'; end if;
 if u.complete then raise exception 'Completed version is no longer active; refuse reactivation' using errcode='40001'; end if;
 select count(*),sum(octet_length(content)),string_agg(content,'' order by chunk_index) into total,bytes,body from public.study_content_chunks where upload_id=u.id;
 if total<>u.chunk_count or bytes is distinct from u.byte_count::bigint or encode(sha256(convert_to(body,'UTF8')),'hex')<>u.sha256 then raise exception 'Incomplete upload or checksum mismatch' using errcode='22023'; end if;
 select string_agg(content,'' order by chunk_index) into old_body from public.study_content_chunks where upload_id=old_u.id;
 fresh:=body::jsonb;baseline:=old_body::jsonb;
 if jsonb_typeof(fresh) is distinct from 'object' or jsonb_typeof(baseline) is distinct from 'object' or jsonb_typeof(baseline->'memoryQuestions') is distinct from 'array' or jsonb_typeof(baseline->'predictions') is distinct from 'array' then raise exception 'Invalid baseline' using errcode='22023'; end if;
 if jsonb_array_length(baseline->'memoryQuestions')=0 then raise exception 'Empty baseline' using errcode='22023'; end if;
 if (fresh-allowed) is distinct from (baseline-allowed) then raise exception 'Immutable baseline fields changed' using errcode='22023'; end if;
 if fresh#>>'{subjectiveUpdate,format}' is distinct from 'psychology-subjective-only-v1' or fresh#>>'{subjectiveUpdate,baseline_sha256}' is distinct from p_expected_sha256 or jsonb_typeof(fresh->'predictions') is distinct from 'array' then raise exception 'Invalid subjective update' using errcode='22023'; end if;
 if jsonb_array_length(fresh->'predictions')<>895 then raise exception 'Expected 895 subjective questions' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(fresh->'predictions') q where jsonb_typeof(q)<>'object' or jsonb_typeof(q->'id') is distinct from 'string' or length(q->>'id')=0 or jsonb_typeof(q->'prompt') is distinct from 'string' or jsonb_typeof(q->'answer_points') is distinct from 'array') or (select count(distinct q->>'id') from jsonb_array_elements(fresh->'predictions') q)<>895 then raise exception 'Invalid subjective question shape' using errcode='22023'; end if;
 foreach k in array array['sources','subjects'] loop
  if jsonb_typeof(fresh->k) is distinct from 'array' or jsonb_typeof(baseline->k) is distinct from 'array' or jsonb_array_length(fresh->k)<jsonb_array_length(baseline->k) then raise exception 'Registry missing' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(baseline->k) with ordinality b(value,n) where b.value is distinct from (fresh->k)->(b.n::integer-1)) then raise exception 'Baseline registry changed' using errcode='22023'; end if;
  if k='sources' and exists(select 1 from jsonb_array_elements(fresh->k) with ordinality r(value,n) where n>jsonb_array_length(baseline->k) and (r.value->>'id') not like 'subjective-v13:%') then raise exception 'Subjective source namespace required' using errcode='22023'; end if;
 if (select count(*) from jsonb_array_elements(fresh->k))<>(select count(distinct s->>'id') from jsonb_array_elements(fresh->k) s) then raise exception 'Registry ID collision' using errcode='22023'; end if;
 end loop;
 update public.study_content_uploads set complete=true where id=u.id;
 update public.study_content_active set upload_id=u.id,updated_at=now() where user_id=uid and document_key='psychology' returning updated_at into saved;
 return jsonb_build_object('saved',true,'document_key','psychology','sha256',u.sha256,'updated_at',saved,'baseline_sha256',p_expected_sha256);
end $$;
comment on function public.study_commit_subjective_upload(uuid,text) is 'private-study-subjective-cas-v1';
revoke all on function public.study_commit_subjective_upload(uuid,text) from public,anon,authenticated;
grant execute on function public.study_commit_subjective_upload(uuid,text) to authenticated;
create or replace function public.study_commit_content_upload(p_upload uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid(); u public.study_content_uploads; total integer; bytes bigint; body text; saved timestamptz; active_id uuid; begin
 if uid is null or not public.study_is_allowed() then raise exception 'Study access denied' using errcode='42501'; end if;
 select * into u from public.study_content_uploads where id=p_upload and user_id=uid;
 if not found then raise exception 'Upload unavailable' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':'||u.document_key,0));
 select * into u from public.study_content_uploads where id=p_upload and user_id=uid for update;
 if not found then raise exception 'Upload unavailable' using errcode='P0002'; end if;
 select upload_id into active_id from public.study_content_active where user_id=uid and document_key=u.document_key for update;
 if u.complete then
  if active_id=u.id then return jsonb_build_object('saved',true,'document_key',u.document_key,'sha256',u.sha256,'already_active',true); end if;
  raise exception 'Completed version no longer active; refuse stale replay' using errcode='40001';
 end if;
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
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':'||p_key,0));
  insert into public.study_private_content(user_id,document_key,payload)
    values(uid,p_key,p_payload)
    on conflict(user_id,document_key) do update set payload=excluded.payload,updated_at=now()
    returning updated_at into saved;
  return jsonb_build_object('saved',true,'document_key',p_key,'updated_at',saved);
end; $$;

revoke all on function public.study_commit_content_upload(uuid), public.study_set_private_content(text,jsonb) from public,anon,authenticated;
grant execute on function public.study_commit_content_upload(uuid), public.study_set_private_content(text,jsonb) to authenticated;
-- All writer paths share the user/key advisory transaction lock. Legacy JSON storage does not replace an existing chunk-active version.
notify pgrst,'reload schema';
commit;
