/* Supabase Auth PKCE + server-checked RLS/RPC. No admin key or password. */
(() => {
  'use strict';
  const CONFIG_KEY='psychology-sync-config-v1',SESSION_PREFIX='psychology-sync-session-v1:',BOX_PREFIX='psychology-sync-queue-v1:';
  const clone=x=>JSON.parse(JSON.stringify(x)),empty=()=>({answers:{},wrong:[],favorites:[]});
  const publicState=s=>({answers:s.answers||{},wrong:s.wrong||[],favorites:s.favorites||[]});
  const subscribers=new Set();
  let config=null,session=null,box=null,status={configured:false,authenticated:false,user_id:null,email:null,message:'尚未配置 · 仅本机保存'},ready=null;
  let activeSync=null,lastMail=0,epoch=0,controller=new AbortController(),releaseWriter=null;
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback}};
  const write=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
  const sessionKey=()=>SESSION_PREFIX+config.url;
  const boxKey=()=>BOX_PREFIX+config.url+':'+session.user.id;
  const publish=patch=>{status={...status,...patch};for(const cb of subscribers)cb({...status})};
  function validateConfig(c){
    if(!c||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(c.url)||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publishableKey))
      throw Error('仅接受官方 Supabase HTTPS 项目 URL 与已有 publishable key；不要填写 secret 或 service_role。');
    return {url:c.url.replace(/\/$/,''),publishableKey:c.publishableKey};
  }
  function normalize(s){return {access_token:s.access_token,refresh_token:s.refresh_token,
    expires_at:s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600),user:{id:s.user.id,email:s.user.email||''}}}
  async function request(path,body,authenticated=false,logoutSession=null){
    const requestEpoch=epoch;
    if(!config)throw Error('尚未配置同步项目。');
    if(authenticated&&!logoutSession)await ensureSession();
    const headers={'apikey':config.publishableKey,'Content-Type':'application/json'};
    if(authenticated)headers.Authorization='Bearer '+(logoutSession||session).access_token;
    let response,result,timedOut=false;const local=new AbortController(),globalSignal=controller.signal,abort=()=>local.abort();globalSignal.addEventListener('abort',abort,{once:true});if(globalSignal.aborted)local.abort();const timer=setTimeout(()=>{timedOut=true;local.abort()},30000);
    try{response=await fetch(config.url+path,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store',signal:local.signal});try{result=await response.json()}catch(error){if(local.signal.aborted)throw error;result={}}}
    catch{const error=Error(timedOut?'请求等待超过30秒，请重试；本机学习记录仍保留。':'网络不可用，本机未同步操作已保留。');error.code=timedOut?'REQUEST_TIMEOUT':'NETWORK_UNAVAILABLE';throw error}finally{clearTimeout(timer);globalSignal.removeEventListener('abort',abort)}
    if(requestEpoch!==epoch)throw Error('账户会话已切换，此回复不会应用到新账户。');
    if(!response.ok){
      if(result.code==='P0002'){const error=Error('本人私有内容尚未导入，请在左侧题库与资料管理中导入交付文件。');error.code='P0002';error.status=response.status;throw error;}
      if(response.status===429)throw Error('邮件或请求额度已达上限，请稍后重试；不会自动升级收费。');
      if([401,403].includes(response.status)||result.code==='42501'){if((authenticated||path.includes('grant_type=refresh_token'))&&!logoutSession)await dropSession('会话或允许名单已被服务端拒绝 · 私有内容已隐藏');const error=Error('会话或学习数据权限未通过服务端验证，请检查登录与允许名单。');error.status=response.status;error.code=String(result.code||'AUTH_REJECTED');throw error;}
      const code=String(result.code||result.error_code||'UNKNOWN').replace(/[^A-Za-z0-9_]/g,'').slice(0,32);
      const hints={PGRST202:'服务端未识别这个RPC签名或缓存尚未更新。',57014:'数据库请求超时。',54000:'数据库请求超过执行限制。',53200:'数据库内存不足。',42501:'服务端权限检查拒绝。'};
      const hint=response.status===413?'请求文件超过服务端大小限制。':hints[code]||'服务端拒绝此操作。';
      const error=Error(hint+' 诊断：HTTP '+response.status+' / '+code+'。请只提供这两个诊断值，不要发送密码或令牌。');
      error.status=response.status;error.code=code;throw error;
    }
    return result;
  }
  async function ensureSession(){
    if(!session?.refresh_token)throw Error('请先通过邮箱链接登录。');
    const refresh=async()=>{
      const latest=read(sessionKey(),session);if(latest?.user?.id!==session.user.id){const error=Error('本机账户会话已切换。');error.code='IDENTITY_MISMATCH';throw error}if(latest?.refresh_token)session=latest;
      if(session.expires_at>Date.now()/1000+90)return;
      const refreshUserId=session.user.id;
      const next=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});
      if(next.user?.id&&next.user.id!==refreshUserId){const error=Error('刷新回复的账户身份不匹配，原账户私有内容已隐藏。');error.code='IDENTITY_MISMATCH';await dropSession(error.message);throw error}
      if(!next.access_token||!next.user?.id)throw Error('登录会话已失效，请重新登录。');
      session=normalize(next);write(sessionKey(),session);
    };
    if(navigator.locks?.request)await navigator.locks.request('psychology-auth:'+config.url,refresh);
    else if(session.expires_at<=Date.now()/1000+90)throw Error('此浏览器不支持安全的多窗口会话刷新，请关闭其他学习窗口后重新登录。');
  }
  const persistBox=()=>write(boxKey(),box);
  async function readRemote(){
    const result=await request('/rest/v1/rpc/get_study_state',{},true);
    if(result.user_id!==session.user.id||!Number.isSafeInteger(result.revision)){const error=Error('服务端身份或状态校验失败。');error.code='IDENTITY_MISMATCH';throw error;}
    return result;
  }
  async function acquireWriter(){
    if(releaseWriter)return true;
    if(!navigator.locks?.request)return false;
    let decide;const decision=new Promise(resolve=>{decide=resolve});
    navigator.locks.request('psychology-study-writer:'+boxKey(),{ifAvailable:true},async lock=>{
      if(!lock){decide(false);return}
      const held=new Promise(resolve=>{releaseWriter=resolve});decide(true);await held;releaseWriter=null;
    }).catch(()=>decide(false));
    return decision;
  }
  async function activate(){
    const remote=await readRemote();
    const writable=await acquireWriter();
    box=read(boxKey(),null)||{revision:remote.revision,remote:remote.state,localSeen:remote.state,pending:[],conflict:null};
    if(!box.pending.length){box.revision=remote.revision;box.remote=remote.state;box.localSeen=remote.state;box.conflict=null}
    if(writable)persistBox();publish({authenticated:true,user_id:session.user.id,email:session.user.email,readOnly:!writable,
      message:!writable?'此浏览器已有学习窗口或不支持安全窗口锁 · 当前仅查看；请关闭其他窗口后重载':box.pending.length?'已登录 · 有离线操作待同步':'已登录 · 服务端用户隔离已验证',pending:box.pending.length});
  }
  function queue(kind,target,payload){box.pending.push({id:crypto.randomUUID(),kind,target,payload})}
  function capture(state){
    const next=publicState(state),previous=box.localSeen||empty();
    for(const [id,a] of Object.entries(next.answers)){
      if(!a||typeof a.correct!=='boolean'||!Number.isInteger(a.attempts)||a.attempts<1)continue;
      const old=previous.answers[id];
      // A server timestamp rebase is not another attempt. Count actual attempts
      // and answer changes, including when another local save raced a reply.
      if(old&&a.attempts<=old.attempts&&a.correct===old.correct&&JSON.stringify(a.selected||[])===JSON.stringify(old.selected||[]))continue;
      // Import an existing aggregate once. Normal newly submitted attempts use a single event.
      const kind=a.attempts===(old?.attempts||0)+1?'answer':'import_answer';
      queue(kind,id,{correct:a.correct,selected:a.selected||[],...(kind==='import_answer'?{attempts:a.attempts}:{})});
    }
    for(const [field,kind] of [['wrong','wrong'],['favorites','favorite']]){
      const before=new Set(previous[field]||[]),after=new Set(next[field]||[]);
      for(const id of after)if(!before.has(id))queue(kind,id,{value:true});
      for(const id of before)if(!after.has(id))queue(kind,id,{value:false});
    }
    box.localSeen=clone(next);persistBox();
  }
  function stageLocal(state){
    if(!status.authenticated||!box)throw Error('请先完成真实登录和服务端允许名单设置。');
    if(status.readOnly)throw Error('当前窗口仅查看，不能修改离线队列。');
    capture(state);
    publish({pending:box.pending.length,message:box.pending.length?'已保存至本机 · 待同步 '+box.pending.length+' 项':status.message});
  }
  function localProjection(remote,operations){
    const value=clone(remote);
    for(const op of operations){
      if(op.kind==='answer'||op.kind==='import_answer'){
        const old=value.answers[op.target],attempts=op.kind==='import_answer'?Math.max(old?.attempts||0,op.payload.attempts):(old?.attempts||0)+1;
        value.answers[op.target]={...op.payload,attempts,time:old?.time||'',firstCorrect:old?.firstCorrect??op.payload.correct};
      }else{const field=op.kind==='wrong'?'wrong':'favorites';value[field]=value[field].filter(id=>id!==op.target);if(op.payload.value)value[field].push(op.target)}
    }
    return value;
  }
  async function sync(state){
    await initialize();if(!status.authenticated||!box)throw Error('请先完成真实登录和服务端允许名单设置。');
    if(status.readOnly)throw Error('当前窗口仅查看，不能覆盖另一个窗口的离线队列。');
    stageLocal(state);
    if(activeSync)return activeSync;
    const syncEpoch=epoch;
    activeSync=(async()=>{
      if(box.conflict)throw Error('跨设备修改有冲突，离线操作仍保留。请先选择保留云端或将本机操作应用到最新云端。');
      if(!box.pending.length){const r=await readRemote();box.revision=r.revision;box.remote=r.state;box.localSeen=r.state;persistBox();publish({message:'已同步 · '+new Date().toLocaleTimeString(),pending:0});return r.state}
      while(box.pending.length){
        const batch=clone(box.pending.slice(0,200));
        const result=await request('/rest/v1/rpc/submit_study_batch',{expected_revision:box.revision,operations:batch},true);
        if(!Number.isSafeInteger(result.revision)||!result.state||!Array.isArray(result.accepted))throw Error('服务端同步响应不完整；队列仍保留。');
        const accepted=new Set(result.accepted);box.pending=box.pending.filter(op=>!accepted.has(op.id));
        box.revision=result.revision;box.remote=result.state;
        if(result.status==='conflict'){
          box.conflict={revision:result.revision,state:result.state};persistBox();publish({message:'检测到跨设备冲突 · 需要本人选择',conflict:true,pending:box.pending.length});
          throw Error('云端已有更新。没有覆盖它；本机未同步操作已保留。');
        }
        if(result.status!=='ok')throw Error('服务端未确认写入，队列仍保留。');
        persistBox();
      }
      box.localSeen=box.remote;persistBox();publish({message:'已同步 · '+new Date().toLocaleTimeString(),pending:0,conflict:false});return box.remote;
    })().catch(error=>{if(syncEpoch===epoch)publish({message:error.message,pending:box?.pending.length||0});throw error}).finally(()=>{if(syncEpoch===epoch)activeSync=null});
    return activeSync;
  }
  async function resolveConflict(choice){
    if(!box?.conflict)throw Error('当前没有待处理冲突。');
    if(choice==='cloud'){
      // Retain a local recovery copy; it is never uploaded as study content.
      write(boxKey()+':discarded-backup:'+Date.now(),{pending:box.pending,localSeen:box.localSeen});
      box.pending=[];box.localSeen=box.conflict.state;box.remote=box.conflict.state;box.conflict=null;persistBox();
      publish({conflict:false,pending:0,message:'已保留云端；原离线操作在本机恢复备份中。'});return box.remote;
    }
    if(choice!=='local')throw Error('请选择明确的冲突处理方式。');
    box.conflict=null;persistBox();publish({conflict:false,message:'将本人确认的本机操作应用到最新版本'});
    return sync(box.localSeen);
  }
  async function initialize(){
    if(ready)return ready;
    ready=(async()=>{
      try{config=validateConfig(window.PSYCH_SYNC_CONFIG||read(CONFIG_KEY,null))}catch{return}
      publish({configured:true,message:'项目已配置 · 未登录'});session=read(sessionKey(),null);
      const url=new URL(location.href),code=url.searchParams.get('code');
      if(code){
        const pkce=read(CONFIG_KEY+':pkce',null);url.searchParams.delete('code');history.replaceState(null,'',url.pathname+url.search+url.hash);
        if(!pkce||Date.now()-pkce.created>3600000)throw Error('此浏览器没有有效登录校验记录，请在同一浏览器重新请求登录链接。');
        const response=await request('/auth/v1/token?grant_type=pkce',{auth_code:code,code_verifier:pkce.verifier});
        localStorage.removeItem(CONFIG_KEY+':pkce');session=normalize(response);write(sessionKey(),session);
      }else if(/(?:access_token|refresh_token)=/.test(location.hash)){
        history.replaceState(null,'',url.pathname+url.search);publish({message:'邀请确认已返回；请从本浏览器主动请求登录链接。'});return;
      }
      if(session)await activate();
    })().catch(async error=>{if(error.code==='IDENTITY_MISMATCH')await dropSession(error.message);publish({authenticated:false,message:error.message});});return ready;
  }
  async function configure(c){
    const next=validateConfig(c);if(config&&next.url!==config.url&&status.authenticated)await signOut();
    config=next;write(CONFIG_KEY,next);ready=null;await initialize();
  }
  async function signIn(email){
    await initialize();if(!config)throw Error('先配置已获批准的项目。');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw Error('请输入本人学习账户邮箱。');
    if(Date.now()-lastMail<60000)throw Error('请稍后再请求；项目默认邮件额度可能仅为每小时2封。');
    const pendingLogin=read(CONFIG_KEY+':pkce',null);
    if(pendingLogin&&Date.now()-pendingLogin.created<3600000)throw Error('此浏览器已有尚未完成的登录请求，请先打开该邮件；不要重复发送覆盖校验记录。');
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    const encode=data=>btoa(String.fromCharCode(...data)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const verifier=encode(bytes),challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    write(CONFIG_KEY+':pkce',{verifier,created:Date.now()});lastMail=Date.now();
    const callback=new URL('./',location.href);callback.hash='';callback.search='';
    try{await request('/auth/v1/otp?redirect_to='+encodeURIComponent(callback.href),{email,create_user:false,code_challenge:challenge,code_challenge_method:'s256'})}
    catch(error){localStorage.removeItem(CONFIG_KEY+':pkce');throw error}
    publish({message:'登录邮件已请求；请在发起请求的同一浏览器打开官方链接。'});
  }
  async function signOut(){
    const previousSession=session;await dropSession();
    if(previousSession)try{await request('/auth/v1/logout?scope=local',{},true,previousSession)}catch{/* local content and token already cleared */}
  }
  async function signInPassword(email,password){
    await initialize();
    if(!config||!email||!password)throw Error('请输入本人账户邮箱与密码。');
    const response=await request('/auth/v1/token?grant_type=password',{email,password});
    password='';
    if(!response.access_token||!response.user?.id)throw Error('登录回复无效。');
    if(session&&session.user.id!==response.user.id)await signOut();
    session=normalize(response);write(sessionKey(),session);
    try{await activate()}catch(error){await signOut();throw error}
  }
  // Private IndexedDB only: no service worker, Cache API, bank localStorage, or tokens.
  const CACHE_SCHEMA=1,CACHE_PREFIX='psychology-private-content-v1:';
  const cacheOwner=()=>session?.user?.id&&config?JSON.stringify([config.url,session.user.id]):null;
  const cacheIdentity=(key,sha)=>JSON.stringify([key,sha]);
  function cacheDatabase(owner){return new Promise((resolve,reject)=>{
    if(!owner||!window.indexedDB){reject(Error('私有缓存不可用'));return}
    let done=false;const finish=(error,db)=>{if(done){db?.close();return}done=true;clearTimeout(timer);error?reject(error):resolve(db)};
    const timer=setTimeout(()=>finish(Error('私有缓存打开超时')),2500);
    let req;try{req=window.indexedDB.open(CACHE_PREFIX+owner,CACHE_SCHEMA)}catch(error){finish(error);return}
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('entries'))db.createObjectStore('entries',{keyPath:'id'});if(!db.objectStoreNames.contains('selected'))db.createObjectStore('selected',{keyPath:'key'})};
    req.onerror=()=>finish(req.error||Error('私有缓存打开失败'));req.onblocked=()=>finish(Error('私有缓存升级被其他窗口阻塞'));
    req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();finish(null,req.result)};
  })}
  async function cacheTransaction(owner,mode,operate,signal=controller.signal){
    const db=await cacheDatabase(owner);return new Promise((resolve,reject)=>{
      let tx,value,done=false;const close=error=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);db.close();error?reject(error):resolve(value)};
      const abort=()=>{try{tx?.abort()}catch{}close(Error('私有缓存操作已取消'))};
      const timer=setTimeout(()=>{try{tx?.abort()}catch{}close(Error('私有缓存操作超时'))},2500);
      if(signal?.aborted){abort();return}
      try{tx=db.transaction(['entries','selected'],mode);tx.oncomplete=()=>close();tx.onabort=()=>close(tx.error||Error('私有缓存事务未完成'));tx.onerror=()=>{};signal?.addEventListener('abort',abort,{once:true});operate(tx,x=>{value=x})}catch(error){try{tx?.abort()}catch{}close(error)}
    });
  }
  async function cacheGet(owner,key,manifest,preferLatest){return cacheTransaction(owner,'readonly',(tx,set)=>{
    const entries=tx.objectStore('entries');
    const get=sha=>{const req=entries.get(cacheIdentity(key,sha));req.onsuccess=()=>set(req.result||null)};
    if(preferLatest)get(manifest.sha256);else{const req=tx.objectStore('selected').get(key);req.onsuccess=()=>get(req.result?.sha256||manifest.sha256)}
  })}
  async function cacheForget(owner,key,sha){return cacheTransaction(owner,'readwrite',tx=>{
    tx.objectStore('entries').delete(cacheIdentity(key,sha));const selected=tx.objectStore('selected'),req=selected.get(key);req.onsuccess=()=>{if(req.result?.sha256===sha)selected.delete(key)}
  })}
  async function cachePut(owner,key,manifest,text,value,readEpoch){
    if(readEpoch!==epoch||owner!==cacheOwner())return false;
    const signal=controller.signal;
    return cacheTransaction(owner,'readwrite',(tx,set)=>{
      if(readEpoch!==epoch||owner!==cacheOwner()){tx.abort();return}
      tx.objectStore('entries').put({id:cacheIdentity(key,manifest.sha256),owner,key,sha256:manifest.sha256,version:typeof value.version==='string'?value.version:null,manifest:clone(manifest),text,verified_at:Date.now()});
      tx.objectStore('selected').put({key,sha256:manifest.sha256});set(true);
    },signal);
  }
  async function cachePurge(owner){
    if(!owner||!window.indexedDB)return true;
    // Abort old local transactions first. All connections are short lived, so
    // deleteDatabase also waits for another tab's active transaction to drain.
    return new Promise(resolve=>{let done=false;const finish=ok=>{if(!done){done=true;clearTimeout(timer);resolve(ok)}};const timer=setTimeout(()=>finish(false),2500);try{const req=window.indexedDB.deleteDatabase(CACHE_PREFIX+owner);req.onsuccess=()=>finish(true);req.onerror=()=>finish(false);req.onblocked=()=>{/* wait for versionchange/short-lived connections */}}catch{finish(false)}});
  }
  async function dropSession(message='已退出 · 离线记录按账户隔离保留在本机'){
    const owner=cacheOwner();epoch++;controller.abort();controller=new AbortController();activeSync=null;
    if(session&&config)localStorage.removeItem(sessionKey());if(releaseWriter)releaseWriter();
    session=null;box=null;publish({authenticated:false,readOnly:false,user_id:null,email:null,pending:0,conflict:false,accessWarning:null,message});
    const cleared=await cachePurge(owner);if(!cleared)publish({cacheCleanupWarning:'题库缓存清理未获浏览器确认，请关闭其他学习窗口后清除此站点的存储；学习记录未删除。'});
  }
  window.addEventListener?.('storage',event=>{
    if(config&&session&&event.key===sessionKey()){
      let next;try{next=event.newValue?JSON.parse(event.newValue):null}catch{next=null}
      if(!next||next.user?.id!==session.user.id)dropSession('另一窗口已退出或切换账户 · 本窗口私有内容已隐藏').catch(()=>{});
    }
  });

  const contentKeys=['psychology','politics','english','notes','documents'];
  const contentHash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  function contentChunks(text){
    const chunks=[];let start=0;
    while(start<text.length){let end=Math.min(start+100000,text.length);if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;chunks.push(text.slice(start,end));start=end;}
    return chunks;
  }
  function validateManifest(manifest,key){
    if(!manifest||!Number.isInteger(manifest.chunk_count)||manifest.chunk_count<1||manifest.chunk_count>512||!Number.isInteger(manifest.byte_count)||manifest.byte_count<2||manifest.byte_count>33554432||!/^[a-f0-9]{64}$/.test(manifest.sha256)||typeof manifest.upload_id!=='string'||(manifest.document_key&&manifest.document_key!==key))throw Error('服务端内容清单无效。');return manifest;
  }
  async function getPrivateContentManifest(key){await initialize();if(!status.authenticated)throw Error('请先登录并通过本人允许名单。');if(!contentKeys.includes(key))throw Error('不支持的内容类型。');return validateManifest(await request('/rest/v1/rpc/study_get_content_manifest',{p_key:key},true),key)}
  async function getPrivateContent(key,onProgress=()=>{},options={}){
    const readEpoch=epoch;
    await initialize();
    if(!status.authenticated)throw Error('请先登录并通过本人允许名单。');
    if(!contentKeys.includes(key))throw Error('不支持的内容类型。');
    const owner=cacheOwner(),validatePayload=options.validatePayload,cacheEnabled=typeof validatePayload==='function';
    const guard=()=>{if(readEpoch!==epoch||owner!==cacheOwner()||!status.authenticated)throw Error('账户会话已切换，此内容不会应用到新账户。')};
    // A valid token alone is insufficient: require the allowlist/identity RPC.
    try{await readRemote()}catch(error){if(error.code==='IDENTITY_MISMATCH')await dropSession('服务端账户身份不匹配 · 私有内容已隐藏');throw error}
    guard();
    const progress=value=>{if(readEpoch!==epoch)throw Error('账户会话已切换，此内容不会应用到新账户。');onProgress(value)};
    progress({phase:'manifest',received:0,total:0});
    let manifest;
    try{manifest=await request('/rest/v1/rpc/study_get_content_manifest',{p_key:key},true)}
    catch(error){if(['P0002','PGRST202'].includes(error.code)){progress({phase:'legacy',received:0,total:0});const value=await request('/rest/v1/rpc/study_get_private_content',{p_key:key},true);guard();if(cacheEnabled)await validatePayload(value);guard();progress({phase:'complete',received:1,total:1});return value}throw error}
    validateManifest(manifest,key);guard();
    if(cacheEnabled){
      let cached=null;
      try{cached=await cacheGet(owner,key,manifest,options.preferLatest===true);guard();if(cached){
        validateManifest(cached.manifest,key);
        if(cached.owner!==owner||cached.key!==key||cached.sha256!==cached.manifest.sha256||typeof cached.text!=='string'||new TextEncoder().encode(cached.text).byteLength!==cached.manifest.byte_count||await contentHash(cached.text)!==cached.sha256)throw Error('缓存校验失败');
        const value=JSON.parse(cached.text);if((typeof value.version==='string'?value.version:null)!==cached.version)throw Error('缓存版本不匹配');await validatePayload(value);guard();
        const updateAvailable=manifest.sha256!==cached.sha256;
        progress({phase:'cache',received:0,total:0,manifest:cached.manifest,availableManifest:manifest,cacheHit:true,updateAvailable});
        progress({phase:'complete',received:0,total:0,bytes:cached.manifest.byte_count,manifest:cached.manifest,availableManifest:manifest,cacheHit:true,updateAvailable});return value;
      }}catch(error){guard();if(cached)try{await cacheForget(owner,key,cached.sha256)}catch{/* optional cache failure falls back to verified download */}}
    }
    const chunks=new Array(manifest.chunk_count);let next=0,received=0,failure=null;
    progress({phase:'download',received,total:manifest.chunk_count,bytes:manifest.byte_count});
    async function worker(){while(!failure&&next<manifest.chunk_count){const i=next++;try{
      const part=await request('/rest/v1/rpc/study_get_content_chunk',{p_upload:manifest.upload_id,p_index:i},true);
      if(part.chunk_index!==i||typeof part.content!=='string')throw Error('服务端内容分片无效。');
      chunks[i]=part.content;received++;progress({phase:'download',received,total:manifest.chunk_count,bytes:manifest.byte_count});
    }catch(error){failure=failure||error}}}
    await Promise.all(Array.from({length:Math.min(4,manifest.chunk_count)},worker));if(failure)throw failure;
    progress({phase:'verify',received,total:manifest.chunk_count,bytes:manifest.byte_count});
    const text=chunks.join('');if(new TextEncoder().encode(text).byteLength!==manifest.byte_count||await contentHash(text)!==manifest.sha256)throw Error('服务端内容校验失败，请重新读取。');
    const value=JSON.parse(text);guard();if(cacheEnabled)await validatePayload(value);guard();
    let cacheStored=false;if(cacheEnabled)try{cacheStored=await cachePut(owner,key,manifest,text,value,readEpoch)}catch{/* quota/disabled storage never makes a verified download fail */}
    guard();progress({phase:'complete',received,total:manifest.chunk_count,bytes:manifest.byte_count,manifest,cacheHit:false,cacheStored});return value;
  }
  async function setPrivateContent(key,payload,onProgress=()=>{}){
    await initialize();
    if(!status.authenticated||status.readOnly)throw Error('请在本人已授权的主窗口导入内容。');
    if(!contentKeys.includes(key)||!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('不支持的内容类型。');
    const text=JSON.stringify(payload),bytes=new TextEncoder().encode(text).byteLength;
    if(bytes>33554432)throw Error('内容超过32 MB限制。');
    const chunks=contentChunks(text),hash=await contentHash(text);
    let upload;
    try{upload=await request('/rest/v1/rpc/study_begin_content_upload',{p_key:key,p_sha256:hash,p_bytes:bytes,p_chunks:chunks.length},true)}
    catch(error){if(error.code==='PGRST202')throw Error('分批导入补丁尚未安装，请先执行 private-content-chunks.sql；不要再次单次上传大文件。');throw error}
    const received=new Set(upload.received||[]);onProgress({received:received.size,total:chunks.length,phase:'upload'});
    if(!upload.complete){for(let i=0;i<chunks.length;i++){if(received.has(i))continue;
      const result=await request('/rest/v1/rpc/study_put_content_chunk',{p_upload:upload.upload_id,p_index:i,p_text:chunks[i]},true);
      if(result.received!==true||result.chunk_index!==i)throw Error('服务端未确认此分片。');received.add(i);onProgress({received:received.size,total:chunks.length,phase:'upload'});
    }}
    onProgress({received:chunks.length,total:chunks.length,phase:'commit'});
    const result=await request('/rest/v1/rpc/study_commit_content_upload',{p_upload:upload.upload_id},true);
    if(result.saved!==true||result.document_key!==key||result.sha256!==hash)throw Error('服务端未确认完整内容版本。');
    return result;
  }
  async function checkAccess(){
    await initialize();if(!status.authenticated)return false;
    try{await readRemote();publish({accessWarning:null});return true}catch(error){if([401,403].includes(error.status)||['42501','AUTH_REJECTED','IDENTITY_MISMATCH'].includes(error.code)){await signOut();return false}publish({accessWarning:'权限检查暂未完成：'+error.message+' 下次联网后重试；此状态不代表已验证。'});return false}
  }
  async function selfCheck(){
    await initialize();if(!config)throw Error('项目尚未配置。');
    const checks=[];
    for(const table of ['study_allowed_users','study_accounts','study_events']){
      const response=await fetch(config.url+'/rest/v1/'+table+'?select=user_id&limit=0',
        {headers:{apikey:config.publishableKey},signal:controller.signal});
      let body;try{body=await response.json()}catch{body={}}
      checks.push({check:'匿名访问 '+table,passed:[401,403].includes(response.status)&&body.code==='42501',
        detail:'HTTP '+response.status+' / '+(body.code||'无数据库错误码')});
    }
    const response=await fetch(config.url+'/auth/v1/settings',
      {headers:{apikey:config.publishableKey},signal:controller.signal});
    let settings;try{settings=await response.json()}catch{settings={}}
    checks.push({check:'公开注册已关闭',passed:response.ok&&settings.disable_signup===true,
      detail:response.ok?(settings.disable_signup?'已关闭':'仍开启；请在官方控制台关闭 Allow new users to sign up'):'设置接口未确认'});
    if(status.authenticated){
      try{const remote=await readRemote();checks.push({check:'本人账户服务端读取',passed:true,detail:'身份匹配；云端版本 '+remote.revision})}
      catch{checks.push({check:'本人账户服务端读取',passed:false,detail:'尚未通过；检查登录状态与本人允许名单'})}
    }else checks.push({check:'本人账户服务端读取',passed:false,detail:'请先由本人在此浏览器登录；本检查不发送邮件'});
    return checks;
  }
  window.PsychSync={configure,signIn,signInPassword,signOut,sync,stageLocal,resolveConflict,getPrivateContent,getPrivateContentManifest,setPrivateContent,checkAccess,
    selfCheck,
    async getStatus(){await initialize();return {...status}},
    async getAccountState(){await initialize();return box?clone(box.pending.length?box.localSeen:box.remote):null},
    subscribe(callback){subscribers.add(callback);callback({...status});return()=>subscribers.delete(callback)}};
})();
