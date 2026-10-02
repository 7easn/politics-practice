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
  async function request(path,body,authenticated=false){
    const requestEpoch=epoch;
    if(!config)throw Error('尚未配置同步项目。');
    if(authenticated)await ensureSession();
    const headers={'apikey':config.publishableKey,'Content-Type':'application/json'};
    if(authenticated)headers.Authorization='Bearer '+session.access_token;
    let response;
    try{response=await fetch(config.url+path,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store',signal:controller.signal})}
    catch{throw Error('网络不可用，本机未同步操作已保留。')}
    if(requestEpoch!==epoch)throw Error('账户会话已切换，此回复不会应用到新账户。');
    let result;try{result=await response.json()}catch{result={}}
    if(requestEpoch!==epoch)throw Error('账户会话已切换，此回复不会应用到新账户。');
    if(!response.ok){
      if(result.code==='P0002')throw Error('本人私有内容尚未导入，请在登录后的内容管理中导入交付文件。');
      if(response.status===429)throw Error('邮件或请求额度已达上限，请稍后重试；不会自动升级收费。');
      if([401,403].includes(response.status))throw Error('会话或学习数据权限未通过服务端验证，请检查登录与允许名单。');
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
      const latest=read(sessionKey(),session);if(latest?.refresh_token)session=latest;
      if(session.expires_at>Date.now()/1000+90)return;
      const next=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});
      if(!next.access_token||!next.user?.id)throw Error('登录会话已失效，请重新登录。');
      session=normalize(next);write(sessionKey(),session);
    };
    if(navigator.locks?.request)await navigator.locks.request('psychology-auth:'+config.url,refresh);
    else if(session.expires_at<=Date.now()/1000+90)throw Error('此浏览器不支持安全的多窗口会话刷新，请关闭其他学习窗口后重新登录。');
  }
  const persistBox=()=>write(boxKey(),box);
  async function readRemote(){
    const result=await request('/rest/v1/rpc/get_study_state',{},true);
    if(result.user_id!==session.user.id||!Number.isSafeInteger(result.revision))throw Error('服务端身份或状态校验失败。');
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
    })().catch(error=>{publish({authenticated:false,message:error.message});});return ready;
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
    epoch++;controller.abort();controller=new AbortController();activeSync=null;
    if(session){try{await request('/auth/v1/logout?scope=local',{},true)}catch{/* local token cleared even offline */}localStorage.removeItem(sessionKey())}
    if(releaseWriter)releaseWriter();
    session=null;box=null;publish({authenticated:false,readOnly:false,user_id:null,email:null,pending:0,conflict:false,message:'已退出 · 离线记录按账户隔离保留在本机'});
  }
  async function signInPassword(email,password){
    await initialize();
    if(!config||!email||!password)throw Error('请输入本人账户邮箱与密码。');
    const response=await request('/auth/v1/token?grant_type=password',{email,password});
    password='';
    if(!response.access_token||!response.user?.id)throw Error('登录回复无效。');
    session=normalize(response);write(sessionKey(),session);
    try{await activate()}catch(error){await signOut();throw error}
  }
  async function getPrivateContent(key){
    await initialize();
    if(!status.authenticated)throw Error('请先登录并通过本人允许名单。');
    return request('/rest/v1/rpc/study_get_private_content',{p_key:key},true);
  }
  async function setPrivateContent(key,payload){
    await initialize();
    if(!status.authenticated||status.readOnly)throw Error('请在本人已授权的主窗口导入内容。');
    if(!['psychology','politics','english','notes','documents'].includes(key))throw Error('不支持的内容类型。');
    return request('/rest/v1/rpc/study_set_private_content',{p_key:key,p_payload:payload},true);
  }
  async function checkAccess(){
    await initialize();if(!status.authenticated)return false;
    try{await readRemote();return true}catch{await signOut();return false}
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
  window.PsychSync={configure,signIn,signInPassword,signOut,sync,stageLocal,resolveConflict,getPrivateContent,setPrivateContent,checkAccess,
    selfCheck,
    async getStatus(){await initialize();return {...status}},
    async getAccountState(){await initialize();return box?clone(box.pending.length?box.localSeen:box.remote):null},
    subscribe(callback){subscribers.add(callback);callback({...status});return()=>subscribers.delete(callback)}};
})();
