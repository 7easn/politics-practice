// Local mocked transport; no real project, email, token, or account is accessed.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'../learning/sync.js'),'utf8');
const EMPTY=()=>({answers:{},wrong:[],favorites:[]});
function harness({loggedIn=true,locks=true,persistedStorage=null,serverState=null}={}){
  const url='https://fixture-project.supabase.co',storage=persistedStorage||new Map(),calls=[];
  const state=serverState||{revision:0,state:EMPTY(),ids:new Set(),offline:false,loseReply:false,hold:false,held:null};
  storage.set('psychology-sync-config-v1',JSON.stringify({url,publishableKey:'sb_publishable_fixture'}));
  if(loggedIn)storage.set('psychology-sync-session-v1:'+url,JSON.stringify({access_token:'local-test-placeholder',refresh_token:'local-test-placeholder',expires_at:Date.now()/1000+3600,user:{id:'fixture-user',email:'fixture@example.invalid'}}));
  const fetch=async(path,opts)=>{
    if(path.includes('?select=user_id&limit=0'))return {ok:false,status:401,json:async()=>({code:'42501'})};
    if(path.includes('/auth/v1/settings'))return {ok:true,status:200,json:async()=>({disable_signup:true})};
    const body=JSON.parse(opts.body);calls.push({path,body});
    if(state.offline)throw Error('fixture offline');
    if(path.includes('/otp'))return {ok:true,json:async()=>({})};
    if(path.includes('/logout'))return {ok:true,json:async()=>({})};
    if(path.includes('study_begin_content_upload'))return state.privateError?
      {ok:false,status:state.privateError.status,json:async()=>({code:state.privateError.code})}:
      {ok:true,status:200,json:async()=>({upload_id:'fixture-upload',received:[],complete:false})};
    if(path.includes('get_study_state'))return {ok:true,json:async()=>({user_id:'fixture-user',revision:state.revision,state:structuredClone(state.state)})};
    if(path.includes('submit_study_batch')){
      if(state.hold)await new Promise(r=>state.held=r);
      const accepted=body.operations.filter(op=>state.ids.has(op.id)).map(op=>op.id);
      const fresh=body.operations.filter(op=>!state.ids.has(op.id));
      if(fresh.length&&body.expected_revision!==state.revision)return {ok:true,json:async()=>({status:'conflict',revision:state.revision,state:structuredClone(state.state),accepted})};
      for(const op of fresh){
        state.ids.add(op.id);accepted.push(op.id);state.revision++;
        if(op.kind==='answer'||op.kind==='import_answer')state.state.answers[op.target]={...op.payload,attempts:op.kind==='import_answer'?op.payload.attempts:(state.state.answers[op.target]?.attempts||0)+1,time:'server-time'};
        else {const k=op.kind==='favorite'?'favorites':'wrong';state.state[k]=state.state[k].filter(id=>id!==op.target);if(op.payload.value)state.state[k].push(op.target)}
      }
      if(state.loseReply){state.loseReply=false;throw Error('fixture reply lost')}
      return {ok:true,json:async()=>({status:'ok',revision:state.revision,state:structuredClone(state.state),accepted})};
    }
    throw Error('unexpected fixture endpoint');
  };
  const window={},context={window,fetch,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    navigator:locks?{locks:{request:async(name,options,cb)=>typeof options==='function'?options():cb({name})}}:{},
    crypto:webcrypto,TextEncoder,Uint8Array,URL,AbortController,Date,JSON,Set,Map,Promise,Number,Error,
    btoa:s=>Buffer.from(s,'binary').toString('base64'),location:{href:'https://example.invalid/learning/',hash:''},history:{replaceState(){}}};
  vm.runInNewContext(source,context);return {api:window.PsychSync,state,storage,calls};
}
(async()=>{
  // Closing during the one-second debounce must retain operations and timestamps.
  let staged=harness();await staged.api.getStatus();
  const beforeClose={answers:{early:{correct:true,selected:[1],attempts:1,time:'client-time'}},wrong:[],favorites:['early']};
  staged.api.stageLocal(beforeClose);
  assert.equal(staged.calls.filter(c=>c.path.includes('submit_study_batch')).length,0);
  assert.equal((await staged.api.getStatus()).pending,2);
  staged=harness({persistedStorage:staged.storage,serverState:staged.state});
  await staged.api.getStatus();const recovered=await staged.api.getAccountState();
  assert.equal(recovered.answers.early.time,'client-time');
  const completed=await staged.api.sync(recovered);assert.equal(completed.answers.early.attempts,1);
  // A stale client timestamp after a concurrent reply must not add an attempt.
  await staged.api.sync({...completed,answers:{early:{...completed.answers.early,time:'older-client-time'}},favorites:[]});
  assert.equal(staged.state.state.answers.early.attempts,1);
  let t=harness();assert.equal((await t.api.getStatus()).authenticated,true);
  for(const failure of [{status:500,code:'57014'},{status:404,code:'PGRST202'},{status:413,code:undefined}]){
    t.state.privateError=failure;
    await assert.rejects(t.api.setPrivateContent('psychology',{}),error=>failure.code==='PGRST202'?error.message.includes('private-content-chunks.sql'):error.status===failure.status&&error.message.includes('HTTP '+failure.status)&&!error.message.includes('local-test-placeholder'));
  }
  t.state.privateError=null;
  await assert.rejects(t.api.configure({url:'http://bad.invalid',publishableKey:'service_role'}));
  let local={answers:{Q:{correct:true,selected:[1],attempts:1,time:'local-time'}},wrong:[],favorites:['Q'],notes:{secretDraft:'must remain local'}};
  t.state.offline=true;await assert.rejects(t.api.sync(local));
  assert.equal((await t.api.getStatus()).pending,2);
  assert(!JSON.stringify(t.calls).includes('must remain local'));
  t.state.offline=false;t.state.loseReply=true;await assert.rejects(t.api.sync(local));
  const retry=await t.api.sync(local);assert.equal(retry.answers.Q.attempts,1);assert.deepEqual([...retry.favorites],['Q']);
  assert.equal((await t.api.getStatus()).pending,0);
  // A second device changed the cloud: local removal requires an explicit choice.
  t.state.revision++;t.state.state.wrong=['remote'];
  local={...retry,wrong:[],favorites:[]};await assert.rejects(t.api.sync(local));
  assert.equal((await t.api.getStatus()).conflict,true);assert.deepEqual(t.state.state.favorites,['Q']);
  const resolved=await t.api.resolveConflict('local');assert.deepEqual([...resolved.favorites],[]);assert.deepEqual([...resolved.wrong],['remote']);
  t.state.revision++;t.state.state.favorites=['cloud'];
  await assert.rejects(t.api.sync({...resolved,favorites:['mine']}));
  const cloud=await t.api.resolveConflict('cloud');assert.deepEqual([...cloud.favorites],['cloud']);
  assert([...t.storage.keys()].some(k=>k.includes('discarded-backup')));
  // A reply from the previous session must not reauthenticate or apply on logout.
  t.state.hold=true;
  const flight=t.api.sync({...cloud,favorites:['cloud','late']});
  while(!t.state.held)await new Promise(r=>setTimeout(r,1));
  await t.api.signOut();t.state.held();await assert.rejects(flight);
  assert.equal((await t.api.getStatus()).authenticated,false);assert.equal(await t.api.getAccountState(),null);
  t=harness({locks:false});assert.equal((await t.api.getStatus()).readOnly,true);await assert.rejects(t.api.sync(local));
  t=harness({loggedIn:false});await t.api.signIn('fixture@example.invalid');
  const diagnostics=await t.api.selfCheck();assert(diagnostics.slice(0,4).every(x=>x.passed));
  assert.equal(diagnostics.at(-1).passed,false);assert(!JSON.stringify(diagnostics).includes('local-test-placeholder'));
  const otp=t.calls.find(x=>x.path.includes('/otp'));assert.equal(otp.body.create_user,false);assert.equal(otp.body.code_challenge_method,'s256');
  assert(otp.path.includes('redirect_to=')&&!('password' in otp.body));await assert.rejects(t.api.signIn('fixture@example.invalid'));
  console.log('PASS: mocked login/config, offline persistence, lost reply idempotency, two-device conflict choices, account isolation, read-only lock fallback, PKCE no-signup, local-only drafts');
})().catch(e=>{console.error(e);process.exitCode=1});
