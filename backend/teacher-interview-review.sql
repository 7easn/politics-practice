-- REVIEW ONLY: catalog-pinned narrow teacher-interview namespace extension.
-- Apply after actual catalog/diff review and publication approval. Changes one uploads
-- CHECK and one begin-upload function. No grants, setter/commit replacement or row writes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.study_content_uploads in access exclusive mode;
do $migration$
declare
 signature constant text:='public.study_begin_content_upload(text,text,integer,integer)';
 expected_acl constant jsonb:='[["postgres","authenticated","EXECUTE",false],["postgres","postgres","EXECUTE",false],["postgres","service_role","EXECUTE",false]]'::jsonb;
 old_keys constant text:=$old_keys$('psychology','politics','english','notes','documents')$old_keys$;
 new_keys constant text:=$new_keys$('psychology','politics','english','teacher-interview','notes','documents')$new_keys$;
 old_cleanup constant text:=$old_cleanup$ delete from public.study_content_uploads where user_id=uid and not complete and created_at<now()-interval '7 days';$old_cleanup$;
 new_cleanup constant text:=$new_cleanup$ if p_key <> 'teacher-interview' then
 delete from public.study_content_uploads where user_id=uid and not complete and created_at<now()-interval '7 days';
 end if;$new_cleanup$;
 item record; relation_oid oid; routine_oid oid; proc_row pg_catalog.pg_proc%rowtype;
 acl jsonb; original_definition text; patched_definition text; original_definition_md5 text;
 original_acl text; original_owner oid; original_config text[];
 constraint_oid oid; constraint_name constant text:='study_content_uploads_document_key_check';
 expression text; document_attnum smallint;
begin
 -- Freeze reviewed identities; retain both later production function changes.
 for item in select * from (values
  ('public.study_is_allowed()','a212c7396b8d9d055e641c794960ef42'),
  ('public.get_study_state()','406449ab105f4ccb69e670a6e9ffe3c1'),
  ('public.submit_study_batch(bigint,jsonb)','3d52e2016bc8f162b0ecc583bef436a6'),
  ('public.study_get_private_content(text)','881c2606fa3b31fd5fe32867d1ce7853'),
  ('public.study_set_private_content(text,jsonb)','9bfee77b92f9af32daee0c40162ecc03'),
  ('public.study_begin_content_upload(text,text,integer,integer)','d8b1fbfe7ddc3c113b8ab7171d5c5553'),
  ('public.study_put_content_chunk(uuid,integer,text)','1e463252b2db1eeac13699308b020577'),
  ('public.study_commit_content_upload(uuid)','73aa98d2d7f3b79b444b95df13944342'),
  ('public.study_get_content_manifest(text)','c38ffe12517649293847cc0fdb70c919'),
  ('public.study_get_content_chunk(uuid,integer)','8fe23a042ef77ec4b5afdbdbf0382b97')
 ) reviewed(signature,source_md5) loop
  routine_oid:=to_regprocedure(item.signature);
  if routine_oid is null or (select md5(prosrc) from pg_catalog.pg_proc where oid=routine_oid) is distinct from item.source_md5 then raise exception 'Reviewed body drift: %',item.signature; end if;
 end loop;
 if obj_description(to_regprocedure('public.study_is_allowed()'),'pg_proc') is distinct from 'psychology-study-sync-v1' then raise exception 'Allowlist ownership drift'; end if;
 -- Catalog checks only, including column grants otherwise missed by table ACL checks.
 for item in select * from (values
  ('study_private_content','private-study-content-v1'),
  ('study_content_uploads','private-study-chunks-v1'),
  ('study_content_chunks','private-study-chunks-v1'),
  ('study_content_active','private-study-chunks-v1')
 ) reviewed(relation,marker) loop
  relation_oid:=to_regclass('public.'||item.relation);
  if relation_oid is null or obj_description(relation_oid,'pg_class') is distinct from item.marker
   or not (select relrowsecurity from pg_catalog.pg_class where oid=relation_oid)
   or (select relforcerowsecurity from pg_catalog.pg_class where oid=relation_oid) then raise exception 'Relation/RLS drift: %',item.relation; end if;
  if exists(select 1 from (values ('anon'),('authenticated')) roles(role_name)
   where has_table_privilege(role_name,relation_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege(role_name,relation_oid,'SELECT,INSERT,UPDATE,REFERENCES')) then raise exception 'Ordinary-role direct access: %',item.relation; end if;
  if exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid and not tgisinternal)
   or exists(select 1 from pg_catalog.pg_policy where polrelid=relation_oid) then raise exception 'Review private policies/triggers: %',item.relation; end if;
 end loop;
 routine_oid:=to_regprocedure(signature);
 select * into proc_row from pg_catalog.pg_proc where oid=routine_oid;
 if obj_description(routine_oid,'pg_proc') is distinct from 'private-study-chunks-v1'
  or pg_get_userbyid(proc_row.proowner)<>'postgres' or proc_row.prorettype<>'jsonb'::regtype
  or not proc_row.prosecdef or proc_row.provolatile<>'v' or proc_row.proisstrict or proc_row.prokind<>'f'
  or (select lanname from pg_catalog.pg_language where oid=proc_row.prolang)<>'plpgsql'
  or proc_row.proargnames is distinct from array['p_key','p_sha256','p_bytes','p_chunks']::text[]
  or proc_row.proargmodes is not null or proc_row.pronargdefaults<>0
  or array_length(proc_row.proconfig,1) is distinct from 1
  or replace(proc_row.proconfig[1],' ','') is distinct from 'search_path=pg_catalog,public'
  or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='study_begin_content_upload')<>1
 then raise exception 'Begin-upload signature/security/configuration drift'; end if;
 select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable)
  order by pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable)
 into acl from aclexplode(coalesce(proc_row.proacl,acldefault('f',proc_row.proowner))) a;
 if acl is distinct from expected_acl or has_function_privilege('anon',routine_oid,'EXECUTE') or not has_function_privilege('authenticated',routine_oid,'EXECUTE') then raise exception 'Begin-upload ACL drift'; end if;
 original_acl:=proc_row.proacl::text; original_owner:=proc_row.proowner; original_config:=proc_row.proconfig;
 original_definition:=pg_get_functiondef(routine_oid); original_definition_md5:=md5(original_definition);
 relation_oid:=to_regclass('public.study_content_uploads');
 select attnum into document_attnum from pg_catalog.pg_attribute where attrelid=relation_oid and attname='document_key' and attnotnull and not attisdropped;
 select oid,pg_get_expr(conbin,conrelid,true) into constraint_oid,expression from pg_catalog.pg_constraint where conrelid=relation_oid and conname=constraint_name and contype='c' and convalidated;
 if document_attnum is null or constraint_oid is null
  or md5(expression) is distinct from 'd1fba81054033ed76873ce79cff42f75'
  or (select md5(pg_get_constraintdef(oid,true)) from pg_catalog.pg_constraint where oid=constraint_oid) is distinct from 'ebe0a28229fb747a86a850aeb1bcde15'
  or (select conkey from pg_catalog.pg_constraint where oid=constraint_oid) is distinct from array[document_attnum]::smallint[]
  or (select count(*) from pg_catalog.pg_constraint where conrelid=relation_oid and contype='c' and document_attnum=any(conkey))<>1
 then raise exception 'CHECK drift; never shrink or discard unknown rules'; end if;
 if (length(original_definition)-length(replace(original_definition,old_keys,'')))/length(old_keys)<>1
  or (length(original_definition)-length(replace(original_definition,old_cleanup,'')))/length(old_cleanup)<>1 then raise exception 'Narrow transform is ambiguous'; end if;
 patched_definition:=replace(replace(original_definition,old_keys,new_keys),old_cleanup,new_cleanup);
 -- Extend the actual expression; do not overwrite it with a fixed six-key enum.
 execute format('alter table public.study_content_uploads drop constraint %I',constraint_name);
 execute format('alter table public.study_content_uploads add constraint %I check ((%s) or document_key=%L)',constraint_name,expression,'teacher-interview');
 -- pg_get_functiondef retains every property; replacing an existing function retains ACL/owner.
 execute patched_definition;
 select * into proc_row from pg_catalog.pg_proc where oid=routine_oid;
 if md5(proc_row.prosrc) is distinct from '17290689c5385bf43e63de0926b0b1f4'
  or proc_row.proowner<>original_owner or proc_row.proacl::text is distinct from original_acl or proc_row.proconfig is distinct from original_config
  or md5(replace(replace(pg_get_functiondef(routine_oid),new_keys,old_keys),new_cleanup,old_cleanup)) is distinct from original_definition_md5
  or obj_description(routine_oid,'pg_proc') is distinct from 'private-study-chunks-v1' then raise exception 'Unexpected post-migration function/ACL drift'; end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
