-- LOCAL ONLY. Reuse synthetic fixture helpers, never run on hosted project.
\set ON_ERROR_STOP on
\ir test-subject-packages.sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ declare f jsonb;m jsonb;b jsonb;o jsonb;meta text;raw bytea:=decode('504b0304','hex');sha text;u uuid;v uuid;i integer;begin
 sha:=encode(sha256(raw),'hex');f:=pg_temp.package_fixture('english','asset-wrong-whole-sha');m:=f->'manifest';b:=f->'bodies';
 meta:=jsonb_build_array(jsonb_build_object('file_name','synthetic.docx','asset_field','word-0','bytes',4,'sha256',repeat('0',64)))::text;
 o:=m#>'{objects,8}';o:=jsonb_set(o,'{count}','1');o:=jsonb_set(o,'{bytes}',to_jsonb(octet_length(meta)));o:=jsonb_set(o,'{sha256}',to_jsonb(encode(sha256(convert_to(meta,'UTF8')),'hex')));m:=jsonb_set(m,'{objects,8}',o);b:=jsonb_set(b,'{8}',to_jsonb(encode(convert_to(meta,'UTF8'),'base64')));
 o:=jsonb_build_object('index',10,'path','objects/0010.bin','role','asset','component','documents','field','word-0','start',0,'count',4,'bytes',4,'sha256',sha);m:=jsonb_set(m,'{objects}',(m->'objects')||jsonb_build_array(o));b:=b||jsonb_build_array(encode(raw,'base64'));
 u:=(study_begin_subject_package(m::text,study_get_subject_package('english')->>'baseline')->>'package_id')::uuid;
 for i in 0..10 loop perform study_put_subject_object(u,i,b->>i);end loop;
 begin perform study_verify_subject_asset(u,'word-0');raise exception 'Wrong whole-file SHA accepted';exception when invalid_parameter_value then null;end;
 begin perform study_commit_subject_package(u);raise exception 'Unverified file activated';exception when invalid_parameter_value then null;end;
 if study_get_subject_package('english')->>'available'<>'false' then raise exception 'Bad original file visible';end if;
 -- Correct whole-file SHA; verification and final activation each idempotent.
 m:=jsonb_set(m,'{package_version}','"asset-correct-whole-sha"');meta:=replace(meta,repeat('0',64),sha);o:=m#>'{objects,8}';o:=jsonb_set(o,'{bytes}',to_jsonb(octet_length(meta)));o:=jsonb_set(o,'{sha256}',to_jsonb(encode(sha256(convert_to(meta,'UTF8')),'hex')));m:=jsonb_set(m,'{objects,8}',o);b:=jsonb_set(b,'{8}',to_jsonb(encode(convert_to(meta,'UTF8'),'base64')));
 v:=(study_begin_subject_package(m::text,study_get_subject_package('english')->>'baseline')->>'package_id')::uuid;for i in 0..10 loop perform study_put_subject_object(v,i,b->>i);end loop;
 begin perform study_commit_subject_package(v);raise exception 'File verification bypassed';exception when invalid_parameter_value then null;end;
 if study_verify_subject_asset(v,'word-0')->>'verified'<>'true' or study_verify_subject_asset(v,'word-0')->>'verified'<>'true' then raise exception 'Verification retry failed';end if;
 if study_commit_subject_package(v)->>'saved'<>'true' then raise exception 'Verified package not activated';end if;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
 begin perform study_verify_subject_asset(v,'word-0');raise exception 'Cross-owner file verification';exception when no_data_found then null;end;
end $$;
rollback;
select 'PASS: whole original-file SHA verified separately, invalid/unverified files refuse activation, verification retries and owner isolation';
