/* Access is enforced by RPC on every content request; this UI carries no bank. */
(() => {
'use strict';
const el=id=>document.getElementById(id),api=window.PsychSync;
const feedback=message=>{el('accessMessage').textContent=message;el('accessMessage').hidden=!message};
let mounted=false,started=false,loggedIn=false,currentUser=null,generation=0,noteRecords=[],urls=[];
const clear=()=>{generation++;noteRecords=[];urls.forEach(URL.revokeObjectURL);urls=[];el('privateNotes').replaceChildren();el('privateDocuments').replaceChildren();window.clearStudyContent?.();el('privateApp').hidden=true;el('accountMenu').open=false;el('ownerBar').hidden=true;el('notesPanel').hidden=true;el('managePanel').hidden=true;window.PrivateContentManager?.reset();el('loginPanel').hidden=false;el('ownerPassword').value='';};
async function enter(status){
 if(!status.authenticated){loggedIn=false;currentUser=null;clear();feedback(/错误|失败|拒绝|权限|允许名单|邮件|过期|网络|HTTP/.test(status.message||'')?status.message:'');return}
 if(loggedIn&&currentUser===status.user_id)return;
 loggedIn=true;currentUser=status.user_id;const stamp=++generation;
 el('loginPanel').hidden=true;el('ownerBar').hidden=false;el('privateApp').hidden=false;
 if(!mounted){el('privateApp').innerHTML=window.STUDY_SHELL;const shell=el('privateApp').querySelector('.shell');shell.append(el('managePanel'),el('notesPanel'));window.PrivateContentManager.initialize(api,()=>loggedIn);mounted=true}
 showPanel('study');
 if(!started){started=true;const script=document.createElement('script');script.src='learning/app.js';document.head.append(script)}
 else if(stamp===generation)await window.reloadPrivateStudy?.();
}
api.subscribe(s=>enter(s).catch(e=>{feedback(e.message)}));
api.getStatus();
el('privateLogin').onsubmit=async event=>{event.preventDefault();const button=el('passwordLogin');button.disabled=true;const password=el('ownerPassword').value;el('ownerPassword').value='';try{await api.signInPassword(el('ownerEmail').value.trim(),password)}catch(e){feedback(e.message)}finally{button.disabled=false}};
el('logoutOwner').onclick=()=>api.signOut();
function showPanel(panel){
 if(!loggedIn)return;el('privateApp').hidden=false;el('studyMain').hidden=panel!=='study';el('managePanel').hidden=panel!=='manage';el('notesPanel').hidden=panel!=='notes';
 document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===panel));
 if(panel!=='study')document.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));
}
window.showPrivatePanel=showPanel;
document.addEventListener('click',event=>{const panel=event.target.closest('[data-panel]');if(panel)showPanel(panel.dataset.panel);if(event.target.closest('[data-view]'))showPanel('study');});
el('accountBackup').onclick=()=>{showPanel('study');window.showStudyView?.('sync');el('accountMenu').open=false};
function showNotes(){
 const search=el('noteSearch').value.trim().toLowerCase();const filtered=noteRecords.filter(r=>JSON.stringify(r).toLowerCase().includes(search));el('privateNotes').replaceChildren();
 const count=document.createElement('p');count.textContent=`匹配 ${filtered.length} 条；每次展示前100条，请用文件名或段落ID缩小范围。`;el('privateNotes').append(count);
 for(const r of filtered.slice(0,100)){const article=document.createElement('article');article.className='card';const title=document.createElement('h2'),text=document.createElement('p');title.textContent=r.id+' · '+(r.document||r.source||r.file_name||r.file||'')+' · '+(r.locator||r.source_location||'');text.textContent=r.original_text||r.text||r.original||r.quote||'';article.append(title,text);el('privateNotes').append(article)}
}
el('noteSearch').oninput=showNotes;
document.addEventListener('click',event=>{const b=event.target.closest('[data-open-note]');if(!b)return;showPanel('notes');el('noteSearch').value=b.dataset.openNote;el('loadNotes').click()});
el('loadNotes').onclick=async()=>{const stamp=generation;try{const doc=await api.getPrivateContent('notes');if(stamp!==generation||!loggedIn)return;noteRecords=doc.records||[];showNotes()}catch(e){el('privateNotes').textContent=e.message}};
el('loadDocuments').onclick=async()=>{const stamp=generation;try{const doc=await api.getPrivateContent('documents');if(stamp!==generation||!loggedIn)return;el('privateDocuments').replaceChildren();urls.forEach(URL.revokeObjectURL);urls=[];for(const d of doc.documents||[]){const bytes=Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));urls.push(url);const link=document.createElement('a');link.className='btn';link.href=url;link.download=d.file_name;link.textContent='下载 '+d.file_name;el('privateDocuments').append(link)}}catch(e){el('privateDocuments').textContent=e.message}};
setInterval(()=>{if(loggedIn)api.checkAccess()},60000);
window.addEventListener('focus',()=>{if(loggedIn)api.checkAccess()});
window.addEventListener('pagehide',()=>{urls.forEach(URL.revokeObjectURL)});
if('serviceWorker' in navigator)navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.filter(r=>r.scope.startsWith(new URL('./',location.href).href)).map(r=>r.unregister())));
if('caches' in window)caches.keys().then(keys=>Promise.all(keys.filter(k=>/^(politics-practice|psychology-study|psychology-learning)[-:]/.test(k)).map(k=>caches.delete(k))));
})();
