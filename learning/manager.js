/* Three explicit content imports. File selection never sends a network request. */
(() => {
'use strict';
const types=[{key:'psychology',label:'心理学题库',file:'psychology.json',description:'选择题、主观候选题、解析、来源及覆盖台账。'},
 {key:'notes',label:'笔记原文索引',file:'notes.json',description:'8876条原文与稳定段落定位。原笔记可能有错，须结合修正阅读。'},
 {key:'documents',label:'原始Word',file:'documents.json',description:'8份原始Word的私有文件包。不要在这里选择单个.docx。'}];
const entries=new Map();let api=null,authorized=()=>false,epoch=0,reading=false;
const el=id=>document.getElementById(id),nodes=key=>({file:el('contentFile-'+key),choose:el('chooseContent-'+key),upload:el('uploadContent-'+key),name:el('contentName-'+key),meta:el('contentMeta-'+key),status:el('contentStatus-'+key)});
function status(key,state,text){const n=nodes(key);n.status.dataset.state=state;n.status.textContent=text;}
function overview(){const uploading=[...entries.values()].some(x=>x.uploading),saved=types.filter(t=>entries.get(t.key)?.saved).length;el('refreshPrivate').disabled=uploading||reading||saved!==3;el('importOverview').textContent=uploading?'正在等待服务端确认，请保持页面打开。':reading?'正在加载已导入内容…':`本次已确认导入 ${saved}/3 类文件。`+(saved===3?' 点击“加载已导入内容”即可开始学习，无需整页刷新。':'');}
function detect(p){if(p?.format&&['psychology-learning-record','psychology-combined-study-record','puxin-study-record'].includes(p.format))return 'record';if(Array.isArray(p?.memoryQuestions)&&Array.isArray(p?.predictions))return 'psychology';if(Array.isArray(p?.records))return 'notes';if(Array.isArray(p?.documents))return 'documents';return 'unknown';}
function validate(key,p){
 const found=detect(p);if(found==='record')throw Error('这是学习记录备份，请到顶部“我的账号”→“备份与恢复”导入。');
 if(found!==key){const target=types.find(t=>t.key===found);throw Error(target?`文件类型不匹配：请在“${target.label}”卡片选择此文件。`:'文件格式无法识别。请解压导入包，选择卡片标注的 JSON 文件。');}
 if(key==='psychology'){
  if(!Array.isArray(p.sources)||!Array.isArray(p.knowledgePoints))throw Error('题库缺少来源或覆盖台账，请使用完整 psychology.json。');
  for(const name of ['memoryQuestions','predictions']){const ids=p[name].map(q=>q?.id);if(ids.some(x=>typeof x!=='string'||!x)||new Set(ids).size!==ids.length)throw Error('题库包含缺失或重复题号，请重新取得完整文件。');}
  return `${p.memoryQuestions.length}道选择题 · ${p.predictions.length}道主观候选题`;
 }
 if(key==='notes'){if(p.records.some(r=>!r||typeof r.id!=='string'||typeof(r.text??r.original_text)!=='string'))throw Error('笔记索引缺少稳定ID或原文，请使用 notes.json。');return `${p.records.length}条原文`;}
 if(p.documents.some(d=>!d||typeof d.file_name!=='string'||!d.file_name.endsWith('.docx')||typeof d.base64!=='string'||!d.base64.startsWith('UEsD')))throw Error('Word文件包缺少有效.docx数据，请使用 documents.json。');return `${p.documents.length}份Word`;
}
async function inspect(key){
 const n=nodes(key),file=n.file.files[0],stamp=epoch;
 if(!file)return;entries.delete(key);n.upload.disabled=true;n.name.textContent=file.name;n.meta.textContent='';status(key,'waiting','正在本机读取与校验，尚未上传…');overview();
 try{
  if(!authorized())throw Error('请先登录并通过本人允许名单。');
  if(!file.name.toLowerCase().endsWith('.json')||file.size>32*1024*1024)throw Error('请选择小于32 MB的 JSON。ZIP需先解压，Word请使用 documents.json。');
  let payload;try{payload=JSON.parse(await file.text())}catch{throw Error('文件不是有效JSON。请重新解压导入包，不要选择ZIP或单个Word。');}
  const summary=validate(key,payload),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
  if(stamp!==epoch||n.file.files[0]!==file||!authorized())return;
  const version=payload.content_package_version||payload.metadata?.version||payload.version||'文件未标注';
  entries.set(key,{payload,file,sha,summary,version,saved:false,uploading:false});n.meta.textContent=`版本：${version}\n${summary} · ${(file.size/1024/1024).toFixed(2)} MB\nSHA256：${sha}`;n.upload.disabled=false;n.upload.textContent='导入'+types.find(t=>t.key===key).label;status(key,'ready','格式校验通过，尚未上传。点击下方“导入”上传本人账户。');overview();
 }catch(e){if(stamp!==epoch)return;n.file.value='';status(key,'error',e.message);overview();}
}
async function upload(key){
 const entry=entries.get(key),n=nodes(key),stamp=epoch;if(!entry?.payload||entry.uploading||!authorized())return;
 entry.uploading=true;n.upload.disabled=true;n.upload.textContent='导入中…';n.choose.disabled=true;status(key,'waiting','正在上传，等待服务端确认…');overview();
 try{
  const result=await api.setPrivateContent(key,entry.payload,progress=>{
   if(stamp!==epoch||!authorized())return;
   const completed=Number(progress?.received??progress?.completed??progress?.completed_chunks??progress?.uploaded??0),total=Number(progress?.total??progress?.total_chunks??0);
   status(key,'waiting',(progress?.message||(progress?.phase==='commit'?'正在确认完整版本':'正在分片上传'))+(total?' · '+completed+'/'+total+' 片':'')+'；服务端尚未确认完成。');
  });
  if(stamp!==epoch||!authorized())return;
  if(result.saved!==true||result.document_key!==key)throw Error('服务端未确认保存，请保留文件并重试。');
  entry.saved=true;n.upload.textContent='已导入';entry.payload=null;entry.file=null;n.file.value='';status(key,'success','服务端已确认保存'+(result.updated_at?' · '+new Date(result.updated_at).toLocaleString():''));
 }catch(e){if(stamp===epoch){n.upload.textContent='重试导入';status(key,'error','导入失败：'+e.message+' 文件仍在本机；点击重试可继续，由服务端确认保存。不会覆盖学习记录。');}}
 finally{if(stamp===epoch){entry.uploading=false;n.choose.disabled=false;n.upload.disabled=entry.saved;overview();}}
}
function initialize(sync,check){api=sync;authorized=check;const host=el('contentImportCards');host.replaceChildren();
 for(const t of types){const card=document.createElement('article');card.className='card import-card';card.dataset.contentKind=t.key;
  const heading=document.createElement('h2');heading.textContent=t.label;const description=document.createElement('p');description.textContent=t.description;
  const name=document.createElement('p');name.id='contentName-'+t.key;name.className='import-file-name';name.textContent='尚未选择文件';
  const meta=document.createElement('p');meta.id='contentMeta-'+t.key;meta.className='import-meta';
  const picker=document.createElement('input');picker.type='file';picker.id='contentFile-'+t.key;picker.accept='.json,application/json';picker.hidden=true;picker.onchange=()=>inspect(t.key);
  const actions=document.createElement('div');actions.className='actions';const choose=document.createElement('button');choose.className='btn';choose.id='chooseContent-'+t.key;choose.textContent='选择 '+t.file;choose.onclick=()=>picker.click();
  const send=document.createElement('button');send.className='btn primary';send.id='uploadContent-'+t.key;send.textContent='导入'+t.label;send.disabled=true;send.onclick=()=>upload(t.key);actions.append(choose,send);
  const info=document.createElement('p');info.id='contentStatus-'+t.key;info.className='import-status';info.setAttribute('role','status');info.setAttribute('aria-live','polite');info.textContent='尚未选择文件。';
  card.append(heading,description,name,meta,picker,actions,info);host.append(card);
 }
 installSubjectiveAction(host);
 el('refreshPrivate').onclick=async()=>{if(reading||!authorized()||types.some(t=>!entries.get(t.key)?.saved)||[...entries.values()].some(x=>x.uploading))return;const stamp=epoch;reading=true;overview();try{if(!window.reloadPrivateStudy)throw Error('学习界面尚未准备好，请稍后重试。');const loaded=await window.reloadPrivateStudy();if(stamp!==epoch||!authorized())return;if(loaded===false)throw Error('题库读取未完成，请到学习页查看诊断并重试。');window.showPrivatePanel?.('study')}catch(error){if(stamp===epoch)el('importOverview').textContent=error.message}finally{if(stamp===epoch){reading=false;el('refreshPrivate').disabled=false}}};overview();
}

function installSubjectiveAction(host){
 const card=document.createElement('article');card.className='card import-card';const title=document.createElement('h2');title.textContent='仅更新主观题';const help=document.createElement('p');help.textContent='以本人当前云端完整题库为基线，保留全部选择题、学习记录与草稿。缺少分片基线、版本冲突或合并超过32 MB时拒绝更新。';const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';picker.hidden=true;picker.id='subjectiveUpdateFile';const choose=document.createElement('button');choose.className='btn';choose.textContent='选择 subjective-update.json';const send=document.createElement('button');send.className='btn primary';send.textContent='仅更新主观题';send.disabled=true;const info=document.createElement('p');info.id='subjectiveUpdateStatus';info.className='import-status';info.setAttribute('role','status');info.textContent='尚未选择文件；选择文件只在本机校验。';let payload=null,busy=false;
 choose.onclick=()=>picker.click();picker.onchange=async()=>{const stamp=epoch,file=picker.files[0];payload=null;send.disabled=true;if(!file)return;try{if(!authorized())throw Error('请先登录');if(file.size>33554432||!file.name.endsWith('.json'))throw Error('请选择32 MB以内的JSON');const p=JSON.parse(await file.text());window.SubjectiveOnlyMerge.validateTransport(p);if(stamp!==epoch||!authorized())return;payload=p;info.textContent='895题主观更新格式通过；尚未联网读取基线或上传。';send.disabled=false}catch(e){if(stamp===epoch)info.textContent=e.message}};
 send.onclick=async()=>{if(!payload||busy||!authorized())return;const stamp=epoch;busy=true;send.disabled=true;choose.disabled=true;try{if(typeof window.validatePrivateStudyPayload!=='function')throw Error('完整结构校验器未接入');const result=await api.updateSubjectiveContent(payload,p=>{if(stamp!==epoch)return;info.textContent=(p.phase==='baseline'?'正在核验本人当前云端基线':p.phase==='commit'?'正在原子确认基线版本':'正在上传新主观版本')+(p.total?' · '+p.received+'/'+p.total+'片':'')},{validatePayload:window.validatePrivateStudyPayload});if(stamp!==epoch||!authorized())return;info.textContent=result.already_active?'云端已是本次主观版本；当前学习界面保留。':result.cacheStored===false?'云端已确认更新；本机缓存激活失败。当前学习界面与草稿保留，请联网核对新版后手动切换。':'云端已确认更新；选择题与记录保留。请保存草稿后在学习页版本提示手动切换。';}catch(e){if(stamp===epoch)info.textContent=(e.commitUncertain?'提交结果未确认；':'更新失败；')+e.message+' 当前学习界面与草稿保留。'}finally{if(stamp===epoch){busy=false;send.disabled=!payload;choose.disabled=false}}};
 window.resetSubjectiveImport=()=>{payload=null;busy=false;picker.value='';send.disabled=true;choose.disabled=false;info.textContent='尚未选择文件；选择文件只在本机校验。'};card.append(title,help,picker,choose,send,info);host.append(card);
}

function reset(){epoch++;window.resetSubjectiveImport?.();reading=false;entries.clear();for(const t of types){const n=nodes(t.key);if(!n.file)continue;n.file.value='';n.upload.disabled=true;n.upload.textContent='导入'+t.label;n.choose.disabled=false;n.name.textContent='尚未选择文件';n.meta.textContent='';status(t.key,'','尚未选择文件。');}overview();}
window.PrivateContentManager={initialize,reset};
})();
