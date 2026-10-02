-- LOCAL ONLY: synthetic users from test.sql. Never run fixtures in a real project.
\set ON_ERROR_STOP on
\ir test.sql
\ir private-content.sql
\ir private-content-chunks.sql
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$ declare u uuid; r jsonb; h text:=encode(sha256(convert_to('{"new":true}','UTF8')),'hex'); begin
 perform study_set_private_content('psychology','{"old":true}');
 r:=study_begin_content_upload('psychology',h,12,2);u:=(r->>'upload_id')::uuid;
 perform study_put_content_chunk(u,0,'{"new":');
 if study_begin_content_upload('psychology',h,12,2)->'received'<>'[0]'::jsonb then raise exception 'Resume failed';end if;
 begin perform study_commit_content_upload(u);raise exception 'Incomplete activated';exception when invalid_parameter_value then null;end;
 if study_get_private_content('psychology')->>'old'<>'true' then raise exception 'Old content lost';end if;
 begin perform study_put_content_chunk(u,0,'changed');raise exception 'Mutated chunk';exception when invalid_parameter_value then null;end;
 begin perform study_put_content_chunk(u,2,'x');raise exception 'Out-of-range chunk';exception when invalid_parameter_value then null;end;
 perform study_put_content_chunk(u,1,'true}');
 if study_commit_content_upload(u)->>'saved'<>'true' then raise exception 'Commit failed';end if;
 if study_get_content_manifest('psychology')->>'sha256'<>h then raise exception 'Manifest mismatch';end if;
 perform study_put_content_chunk(u,1,'true}'); -- idempotent retry, completed rows immutable
 begin perform study_put_content_chunk(u,1,'bad');raise exception 'Changed completed';exception when invalid_parameter_value then null;end;
 r:=study_begin_content_upload('psychology',repeat('0',64),2,1);u:=(r->>'upload_id')::uuid;
 perform study_put_content_chunk(u,0,'{}');
 begin perform study_commit_content_upload(u);raise exception 'Bad hash accepted';exception when invalid_parameter_value then null;end;
 if study_get_content_manifest('psychology')->>'sha256'<>h then raise exception 'Bad upload replaced active';end if;
 begin perform * from study_content_chunks;raise exception 'Direct read granted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
 begin perform study_put_content_chunk(u,0,'{}');raise exception 'Cross-user write';exception when no_data_found then null;end;
 begin perform study_commit_content_upload(u);raise exception 'Cross-user activation';exception when no_data_found then null;end;
 begin perform study_get_content_manifest('psychology');raise exception 'Cross-user manifest';exception when no_data_found then null;end;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
 begin perform study_begin_content_upload('psychology',h,12,2);raise exception 'Unlisted upload';exception when insufficient_privilege then null;end;
end $$;
reset role;
set role anon;
do $$ begin
 begin perform study_get_content_manifest('psychology');raise exception 'Anonymous manifest';exception when insufficient_privilege then null;end;
 begin perform study_begin_content_upload('psychology',repeat('0',64),2,1);raise exception 'Anonymous upload';exception when insufficient_privilege then null;end;
end $$;
reset role;
\ir private-content-chunks.sql
select count(*)=4 as original_learning_events_preserved from study_events;
select 'PASS chunk bounds, retry, mutation rejection, hash and incomplete rejection, atomic activation, user isolation and direct-read denial';
