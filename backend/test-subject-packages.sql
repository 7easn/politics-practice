-- LOCAL ONLY: synthetic users supplied by test.sql; never execute on a live project.
\set ON_ERROR_STOP on
create or replace function pg_temp.package_fixture(s text,v text,duplicate_question boolean default false) returns jsonb language plpgsql as $$
declare bodies text[]:=array['{"version":"'||v||'"}','[{"id":"Q-stable","prompt":"Synthetic choice","options":["a","b"],"answer":[0],"review_status":"needs-review"}]',
 '[{"id":"'||case when duplicate_question then 'Q-stable' else 'E-stable' end||'","prompt":"Synthetic essay","answer_points":["point"],"review_status":"needs-review"}]','[]','[]','{}','[{"id":"N-stable","text":"Synthetic original"}]','{}','[]','[]'];
 roles text[]:=array['root','array','array','array','array','root','array','root','array','array'];components text[]:=array['bank','bank','bank','bank','bank','notes','notes','documents','documents','bank'];fields text[]:=array['','memoryQuestions','predictions','sources','knowledgePoints','','records','','documents','subjects'];objects jsonb:='[]';encoded jsonb:='[]';i integer;b text;begin
 for i in 1..cardinality(bodies) loop b:=bodies[i];objects:=objects||jsonb_build_array(jsonb_build_object('index',i-1,'path','objects/'||lpad((i-1)::text,4,'0')||'.json','role',roles[i],'component',components[i],'field',fields[i],'start',0,'count',case when roles[i]='array' then jsonb_array_length(b::jsonb) else 0 end,'bytes',octet_length(b),'sha256',encode(sha256(convert_to(b,'UTF8')),'hex')));encoded:=encoded||jsonb_build_array(encode(convert_to(b,'UTF8'),'base64'));end loop;
 return jsonb_build_object('manifest',jsonb_build_object('format','private-subject-package','schema_version',1,'subject',s,'package_version',v,'file_complete',true,'semantic_review',jsonb_build_object('status','incomplete','scope','Synthetic fixture only','limitations',jsonb_build_array('No semantic review')),'objects',objects),'bodies',encoded);
end $$;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ declare f jsonb;r jsonb;u uuid;p uuid;e uuid;baseline text;i integer;n integer;before_events integer;begin
 -- Direct tables and internal identity helper remain unavailable.
 begin perform * from study_subject_packages;raise exception 'Direct table exposed';exception when insufficient_privilege then null;end;
 begin perform study_subject_baseline('10000000-0000-4000-8000-000000000002','psychology');raise exception 'Internal helper exposed';exception when insufficient_privilege then null;end;
 baseline:=study_get_subject_package('psychology')->>'baseline';f:=pg_temp.package_fixture('psychology','fixture-v1');
 r:=study_begin_subject_package((f->'manifest')::text,baseline);u:=(r->>'package_id')::uuid;
 begin perform study_commit_subject_package(u);raise exception 'Incomplete activated';exception when invalid_parameter_value then null;end;
 perform study_put_subject_object(u,0,f#>>'{bodies,0}');
 if study_begin_subject_package((f->'manifest')::text,baseline)->'received'<>'[0]'::jsonb then raise exception 'Resume receipts lost';end if;
 begin perform study_put_subject_object(u,0,encode(convert_to('{}','UTF8'),'base64'));raise exception 'Mutation accepted';exception when invalid_parameter_value then null;end;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
 begin perform study_put_subject_object(u,1,f#>>'{bodies,1}');raise exception 'Cross-user write';exception when no_data_found then null;end;
 begin perform study_get_subject_object(u,0);raise exception 'Cross-user read';exception when no_data_found then null;end;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
 for i in 1..9 loop perform study_put_subject_object(u,i,f->'bodies'->>i);end loop;
 if study_commit_subject_package(u)->>'saved'<>'true' then raise exception 'No activation';end if;
 if study_commit_subject_package(u)->>'already_active'<>'true' then raise exception 'Activation retry not idempotent';end if;
 if study_get_subject_object(u,1)->>'base64' is distinct from replace(f#>>'{bodies,1}',E'\n','') then raise exception 'Exact read failed';end if;
 if study_get_subject_package('psychology')->>'package_id'<>u::text then raise exception 'Wrong pointer';end if;
 -- Independent subject versions must not change psychology.
 f:=pg_temp.package_fixture('politics','fixture-politics');r:=study_begin_subject_package((f->'manifest')::text,study_get_subject_package('politics')->>'baseline');p:=(r->>'package_id')::uuid;
 for i in 0..9 loop perform study_put_subject_object(p,i,f->'bodies'->>i);end loop;perform study_commit_subject_package(p);
 if study_get_subject_package('psychology')->>'package_id'<>u::text then raise exception 'Cross-subject overwrite';end if;
 -- Duplicate question IDs across choice/essay objects roll back the rejected receipt.
 f:=pg_temp.package_fixture('english','fixture-duplicate',true);r:=study_begin_subject_package((f->'manifest')::text,study_get_subject_package('english')->>'baseline');e:=(r->>'package_id')::uuid;perform study_put_subject_object(e,1,f->'bodies'->>1);
 begin perform study_put_subject_object(e,2,f->'bodies'->>2);raise exception 'Cross-object duplicate accepted';exception when unique_violation then null;end;
 if study_get_subject_package('english')->>'available'<>'false' then raise exception 'Rejected package visible';end if;
 -- Same starting baseline: first complete contender wins, second cannot replace it.
 baseline:=study_get_subject_package('psychology')->>'baseline';f:=pg_temp.package_fixture('psychology','fixture-v2');r:=study_begin_subject_package((f->'manifest')::text,baseline);p:=(r->>'package_id')::uuid;for i in 0..9 loop perform study_put_subject_object(p,i,f->'bodies'->>i);end loop;
 f:=pg_temp.package_fixture('psychology','fixture-v3');r:=study_begin_subject_package((f->'manifest')::text,baseline);e:=(r->>'package_id')::uuid;for i in 0..9 loop perform study_put_subject_object(e,i,f->'bodies'->>i);end loop;
 perform study_commit_subject_package(p);begin perform study_commit_subject_package(e);raise exception 'Stale baseline activated';exception when serialization_failure then null;end;
 if study_get_subject_package('psychology')->>'package_id'<>p::text then raise exception 'Winner lost';end if;
 -- Immutable completed old versions remain readable; no record tables touched.
 perform study_put_subject_object(u,1,pg_temp.package_fixture('psychology','fixture-v1')#>>'{bodies,1}');perform study_get_subject_object(u,1);
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
 begin perform study_get_subject_package('psychology');raise exception 'Unlisted read';exception when insufficient_privilege then null;end;
end $$;
rollback;
set role anon;
do $$ begin begin perform study_get_subject_package('psychology');raise exception 'Anonymous access';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'PASS: bounded object receipts, resume/immutability, incomplete refusal, idempotent activation, independent subjects, duplicate ID rejection, stale baseline refusal, owner/allowlist/anonymous isolation';
