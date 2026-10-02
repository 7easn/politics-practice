/* Access is enforced by RPC on every content request; this UI carries no bank. */
(() => {
'use strict';
const el=id=>document.getElementById(id),api=window.PsychSync;
let mounted=false,started=false,loggedIn=false,currentUser=null,generation=0,noteRecords=[],urls=[];
const clear=()=>{generation++;noteRecords=[];urls.forEach(URL.revokeObjectURL);urls=[];el('privateNotes').replaceChildren();el('privateDocuments').replaceChildren();window.clearStudyContent?.();el('privateApp').hidden=true;el('ownerBar').hidden=true;el('notesPanel').hidden=true;el('loginPanel').hidden=false;el('ownerPassword').value='';};
async function enter(status){
 if(!status.authenticated){loggedIn=false;currentUser=null;clear();el('accessMessage').textContent=status.message;return}
 if(loggedIn&&currentUser===status.user_id)return;
 loggedIn=true;currentUser=status.user_id;const stamp=++generation;
 el('loginPanel').hidden=true;el('ownerBar').hidden=false;el('privateApp').hidden=false;
 if(!mounted){el('privateApp').innerHTML=window.STUDY_SHELL;mounted=true}
 if(!started){started=true;const script=document.createElement('script');script.src='learning/app.js';document.head.append(script)}
 else if(stamp===generation)await window.reloadPrivateStudy?.();
}
api.subscribe(s=>enter(s).catch(e=>{el('accessMessage').textContent=e.message}));
api.getStatus();
el('privateLogin').onsubmit=async event=>{event.preventDefault();const button=el('passwordLogin');button.disabled=true;const password=el('ownerPassword').value;el('ownerPassword').value='';try{await api.signInPassword(el('ownerEmail').value.trim(),password)}catch(e){el('accessMessage').textContent=e.message}finally{button.disabled=false}};
el('emailLogin').onclick=async()=>{try{await api.signIn(el('ownerEmail').value.trim())}catch(e){el('accessMessage').textContent=e.message}};
el('logoutOwner').onclick=()=>api.signOut();
el('openStudy').onclick=()=>{el('privateApp').hidden=false;el('notesPanel').hidden=true};
el('openNotes').onclick=()=>{el('privateApp').hidden=true;el('notesPanel').hidden=false};
el('uploadPrivate').onclick=async()=>{
 const button=el('uploadPrivate');button.disabled=true;
 try{const file=el('privateFile').files[0];if(!file||file.size>32*1024*1024)throw Error('请选择小于32 MB的私有 JSON 文件。');
 const key=el('privateKind').value,payload=JSON.parse(await file.text());
 if(key==='psychology'&&(!Array.isArray(payload.memoryQuestions)||!Array.isArray(payload.predictions)))throw Error('心理学文件格式不匹配。');
 if(key==='notes'&&!Array.isArray(payload.records))throw Error('笔记索引格式不匹配。');
 if(key==='documents'&&!Array.isArray(payload.documents))throw Error('Word 文件包格式不匹配。');
 const result=await api.setPrivateContent(key,payload);if(!result.saved)throw Error('服务端未确认导入。');
 el('uploadMessage').textContent='服务端已确认保存；请刷新页面读取。';el('privateFile').value='';
 }catch(e){el('uploadMessage').textContent=e.message}finally{button.disabled=false}
};
function showNotes(){
 const search=el('noteSearch').value.trim().toLowerCase();const filtered=noteRecords.filter(r=>JSON.stringify(r).toLowerCase().includes(search));el('privateNotes').replaceChildren();
 const count=document.createElement('p');count.textContent=`匹配 ${filtered.length} 条；每次展示前100条，请用文件名或段落ID缩小范围。`;el('privateNotes').append(count);
 for(const r of filtered.slice(0,100)){const article=document.createElement('article');article.className='card';const title=document.createElement('h2'),text=document.createElement('p');title.textContent=r.id+' · '+(r.document||r.source||r.file_name||r.file||'')+' · '+(r.locator||r.source_location||'');text.textContent=r.original_text||r.text||r.original||r.quote||'';article.append(title,text);el('privateNotes').append(article)}
}
el('noteSearch').oninput=showNotes;
document.addEventListener('click',event=>{const b=event.target.closest('[data-open-note]');if(!b)return;el('openNotes').click();el('noteSearch').value=b.dataset.openNote;el('loadNotes').click()});
el('loadNotes').onclick=async()=>{const stamp=generation;try{const doc=await api.getPrivateContent('notes');if(stamp!==generation||!loggedIn)return;noteRecords=doc.records||[];showNotes()}catch(e){el('privateNotes').textContent=e.message}};
el('loadDocuments').onclick=async()=>{const stamp=generation;try{const doc=await api.getPrivateContent('documents');if(stamp!==generation||!loggedIn)return;el('privateDocuments').replaceChildren();urls.forEach(URL.revokeObjectURL);urls=[];for(const d of doc.documents||[]){const bytes=Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));urls.push(url);const link=document.createElement('a');link.className='btn';link.href=url;link.download=d.file_name;link.textContent='下载 '+d.file_name;el('privateDocuments').append(link)}}catch(e){el('privateDocuments').textContent=e.message}};
setInterval(()=>{if(loggedIn)api.checkAccess()},60000);
window.addEventListener('focus',()=>{if(loggedIn)api.checkAccess()});
window.addEventListener('pagehide',()=>{urls.forEach(URL.revokeObjectURL)});
if('serviceWorker' in navigator)navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.filter(r=>r.scope.startsWith(new URL('./',location.href).href)).map(r=>r.unregister())));
if('caches' in window)caches.keys().then(keys=>Promise.all(keys.filter(k=>/^(politics-practice|psychology-study|psychology-learning)[-:]/.test(k)).map(k=>caches.delete(k))));
})();
