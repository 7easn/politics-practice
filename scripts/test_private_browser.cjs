// Fresh local browser + synthetic RPC data. No real account or credentials.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.STUDY_PREVIEW_URL||'http://127.0.0.1:8769',root=path.resolve(__dirname,'..');
const fixture={version:'fixture',build:'synthetic local test',subjects:[{id:'puxin',title:'测试科目'}],sources:[],knowledgePoints:[],predictions:[],corrections:[],predictionCoverage:[],trend:{findings:[],annual:[]},memoryQuestions:[{id:'fixture-Q',subject:'puxin',prompt:'本地测试题：选第二项',options:['测试A','测试B','测试C','测试D'],answer:[1],review_status:'verified',plain_explanation:'仅用于界面测试',option_explanations:['测试A解释','测试B解释','测试C解释','测试D解释'],variations:['测试变式1','测试变式2'],note_refs:[],source_ids:[]}]};
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.CHROME_BINARY?{executablePath:process.env.CHROME_BINARY}:{})});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),calls=[],errors=[];let allowed=true,failedOnce=false,conflictNext=false,failSyncNext=false,failInitialRead=true;const uploads=new Map();
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin===new URL(base).origin)return route.continue();
  if(url.origin!=='https://fdpofmiuprjtvjbtnrku.supabase.co')return route.abort();
  calls.push({path:url.pathname,body:route.request().postDataJSON(),headers:route.request().headers()});
  let body={},status=200;
  if(url.pathname.includes('/auth/v1/token'))body={access_token:'fixture-not-a-real-token',refresh_token:'fixture-not-a-real-refresh',expires_in:3600,user:{id:'10000000-0000-4000-8000-000000000001',email:'fixture@example.invalid'}};
  else if(url.pathname.endsWith('get_study_state')){body=allowed?{user_id:'10000000-0000-4000-8000-000000000001',revision:0,state:{answers:{},wrong:[],favorites:[]}}:{code:'42501'};status=allowed?200:403;}
  else if(url.pathname.endsWith('study_get_content_manifest')){body={code:'P0002'};status=404;}
  else if(url.pathname.endsWith('study_begin_content_upload')){const b=route.request().postDataJSON();const id=b.p_key+'-'+b.p_sha256;let upload=uploads.get(id);if(!upload){upload={key:b.p_key,hash:b.p_sha256,received:new Set()};uploads.set(id,upload)}body={upload_id:id,received:[...upload.received],complete:false};}
  else if(url.pathname.endsWith('study_put_content_chunk')){const b=route.request().postDataJSON(),u=uploads.get(b.p_upload);if(u.key==='psychology'&&b.p_index===1&&!failedOnce){failedOnce=true;status=500;body={code:'57014',message:'synthetic interrupted upload'};}else{u.received.add(b.p_index);body={received:true,chunk_index:b.p_index};await new Promise(r=>setTimeout(r,30));}}
  else if(url.pathname.endsWith('study_commit_content_upload')){const b=route.request().postDataJSON(),u=uploads.get(b.p_upload);body={saved:true,document_key:u.key,sha256:u.hash};}
  else if(url.pathname.endsWith('study_get_private_content')){await new Promise(r=>setTimeout(r,350));if(failInitialRead){failInitialRead=false;body={code:'57014'};status=500}else{body=allowed?fixture:{code:'42501'};status=allowed?200:403;}}
  else if(url.pathname.includes('/logout'))body={};
  else if(url.pathname.endsWith('submit_study_batch')){const b=route.request().postDataJSON();if(failSyncNext){body={message:'synthetic sync failed'};status=500;failSyncNext=false;}else{body={status:conflictNext?'conflict':'ok',revision:1,state:{answers:{},wrong:[],favorites:[]},accepted:conflictNext?[]:b.operations.map(o=>o.id)};conflictNext=false;}}
  else throw Error('Unexpected fixture request '+url.pathname);
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/');
 await page.waitForSelector('#privateLogin');assert.equal(await page.locator('#emailLogin,#loginPanel h1').count(),0);assert.equal(await page.locator('#accessMessage').isVisible(),false);assert.equal(await page.locator('#ownerBar').isVisible(),false);
 assert.equal(calls.filter(x=>x.path.endsWith('study_get_private_content')).length,0,'anonymous fetched content');
 await page.locator('#ownerEmail').fill('fixture@example.invalid');await page.locator('#ownerPassword').fill('fixture-password-not-a-credential');await page.locator('#passwordLogin').click();
 await page.waitForSelector('#privateReadStatus button');assert((await page.locator('#privateReadStatus').innerText()).includes('57014'));await page.locator('#privateReadStatus button').click();await page.waitForFunction(()=>document.getElementById('privateReadStatus').hidden);assert(calls.filter(c=>/study_get_(private_content|content_manifest)$/.test(c.path)).every(c=>c.body.p_key==='psychology'),'initial load fetched notes or Word');await page.locator('[data-view="memory"]').click();await page.waitForSelector('[data-choice]');
 await page.locator('[data-choice="fixture-Q"][data-index="1"]').click();await page.locator('[data-submit="fixture-Q"]').click();
 assert.equal(await page.locator('text=逐项解释').count(),1);
 const stored=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
 assert(!JSON.stringify(stored).includes('fixture-password-not-a-credential'));assert(!JSON.stringify(stored).includes('本地测试题'));
 assert(calls.filter(x=>x.path.endsWith('study_get_private_content')).every(x=>x.headers.authorization==='Bearer fixture-not-a-real-token'));
 const out=path.join(root,'private/browser-check');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'private-memory-desktop.png'),fullPage:true});
 assert.equal(await page.locator('nav [data-view="sync"],nav [data-view="progress"]').count(),0);
 await page.locator('#openManager').click();await page.waitForSelector('.import-card');assert.equal(await page.locator('.import-card').count(),3);assert.equal(await page.locator('#ownerBar,#privateApp').count(),2);
 assert.equal(await page.locator('#studyMain').isVisible(),false);assert.equal(await page.locator('aside').isVisible(),true);
 const importCalls=()=>calls.filter(x=>/study_(begin_content_upload|put_content_chunk|commit_content_upload)$/.test(x.path)).length;
 const before=importCalls();await page.locator('#contentFile-psychology').setInputFiles({name:'notes.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({records:[]}))});
 await page.waitForFunction(()=>document.getElementById('contentStatus-psychology').textContent.includes('笔记原文索引'));
 assert.equal(importCalls(),before);assert.equal(await page.locator('#uploadContent-psychology').isDisabled(),true);
 await page.locator('#contentFile-psychology').setInputFiles({name:'record.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'psychology-learning-record'}))});
 await page.waitForFunction(()=>document.getElementById('contentStatus-psychology').textContent.includes('我的账号'));
 const large={...fixture,test_padding:'本地分片测试'.repeat(35000)};
 await page.locator('#contentFile-psychology').setInputFiles({name:'psychology.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(large))});
 await page.waitForFunction(()=>document.getElementById('contentStatus-psychology').dataset.state==='ready');assert.equal(importCalls(),before,'file selection started an upload');
 assert.equal(await page.locator('input[type="file"]:visible').count(),0);
 await page.locator('#uploadContent-psychology').click();await page.waitForFunction(()=>/片/.test(document.getElementById('contentStatus-psychology').textContent));assert.equal(await page.locator('#chooseContent-psychology').isDisabled(),true);await page.waitForFunction(()=>document.getElementById('contentStatus-psychology').textContent.includes('导入失败'));
 assert.equal(await page.locator('#uploadContent-psychology').innerText(),'重试导入');assert.equal(await page.locator('#uploadContent-psychology').isDisabled(),false);
 await page.locator('#uploadContent-psychology').click();await page.waitForFunction(()=>document.getElementById('contentStatus-psychology').dataset.state==='success');
 assert.equal(calls.filter(x=>x.path.endsWith('study_put_content_chunk')&&x.body.p_index===0).length,1,'retry resent completed first chunk');
 for(const [key,payload] of [['notes',{records:[{id:'fixture-note',text:'本地合成原文'}]}],['documents',{documents:[{file_name:'fixture.docx',base64:'UEsDBA=='}]}]]){
  const count=importCalls();await page.locator('#contentFile-'+key).setInputFiles({name:key+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
  await page.waitForFunction(k=>document.getElementById('contentStatus-'+k).dataset.state==='ready',key);assert.equal(importCalls(),count);
  await page.locator('#uploadContent-'+key).click();await page.waitForFunction(k=>document.getElementById('contentStatus-'+k).dataset.state==='success',key);
 }
 assert.equal(await page.locator('#refreshPrivate').isDisabled(),false);const beforeRefresh=calls.filter(c=>c.path.endsWith('study_get_private_content')).length;const pageURL=page.url();await page.locator('#refreshPrivate').click();await page.waitForFunction(()=>document.getElementById('managePanel').hidden);assert.equal(new URL(page.url()).pathname,new URL(pageURL).pathname,'import reload navigated away from current page');assert.equal(calls.filter(c=>c.path.endsWith('study_get_private_content')).length,beforeRefresh+1);await page.locator('#openManager').click();assert.equal(await page.locator('.import-card').count(),3);assert.equal(await page.locator('#contentStatus-notes').getAttribute('data-state'),'success');
 await page.screenshot({path:path.join(out,'private-manager-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(out,'private-manager-mobile.png'),fullPage:false});
 await page.locator('[data-management-section="notes"]').click();assert.equal(await page.locator('#notesPanel').isVisible(),true);assert.equal(await page.locator('#managePanel').isVisible(),true);
 await page.locator('#accountMenu summary').click();await page.locator('#accountBackup').click();assert.equal(await page.locator('#studyMain').isVisible(),true);await page.waitForSelector('#export');
 const backup={format:'psychology-learning-record',version:2,answers:{'legacy-unmatched':{correct:true,attempts:1,selected:[0],time:'2026-10-02T00:00:00Z'}},wrong:['legacy-unmatched'],favorites:['legacy-unmatched'],notes:{'legacy-unmatched':{text:'本机旧草稿',time:'2026-10-02T00:00:00Z'}}};
 await page.locator('#importFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('已合并'));
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);const backupPath=path.join(out,'synthetic-record-export.json');await download.saveAs(backupPath);const exported=JSON.parse(fs.readFileSync(backupPath));assert(exported.answers['legacy-unmatched']);assert(exported.favorites.includes('legacy-unmatched'));assert.equal(exported.notes['legacy-unmatched'].text,'本机旧草稿');
 await page.locator('#saveStatus').click();await page.waitForSelector('#syncNow');failSyncNext=true;await page.locator('#syncNow').click();await page.waitForFunction(()=>document.getElementById('saveStatus').textContent==='同步失败');conflictNext=true;await page.locator('#syncNow').click();await page.waitForSelector('#keepCloud');assert.equal(await page.locator('#saveStatus').innerText(),'同步冲突');await page.locator('#keepCloud').click();await page.waitForFunction(()=>!document.getElementById('keepCloud'));assert.equal(await page.locator('#saveStatus').innerText(),'已同步');
 const legacyText=JSON.stringify({...backup,version:1,answers:{'old-bank-id':{correct:false,attempts:2,selected:[1],time:'2026-10-01T00:00:00Z'}},wrong:['old-bank-id']});await page.evaluate(text=>localStorage.setItem('psychology-combined-bank-v1',text),legacyText);await page.locator('#legacy').click();assert.equal(await page.evaluate(()=>localStorage.getItem('psychology-combined-bank-v1')),legacyText);const [legacyDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]);await legacyDownload.saveAs(path.join(out,'synthetic-legacy-export.json'));assert(JSON.parse(fs.readFileSync(path.join(out,'synthetic-legacy-export.json'))).answers['old-bank-id']);
 await page.locator('[data-view="memory"]').click();await page.screenshot({path:path.join(out,'private-memory-mobile.png'),fullPage:false});
 await page.locator('#openManager').click();assert.equal(await page.locator('#studyMain').isVisible(),false);await page.locator('#accountMenu summary').click();
 await page.locator('#logoutOwner').click();await page.waitForSelector('#privateLogin');assert.equal(await page.locator('#emailLogin,#loginPanel h1').count(),0);assert.equal(await page.locator('#accessMessage').isVisible(),false);assert.equal(await page.locator('#privateApp').isVisible(),false);assert.equal(await page.locator('#managePanel').isVisible(),false);assert.equal(await page.locator('#notesPanel').isVisible(),false);assert(!await page.locator('#privateApp').innerText().then(t=>t.includes('本地测试题')));
 await page.locator('#ownerPassword').fill('fixture-password-not-a-credential');await page.locator('#passwordLogin').click();await page.waitForSelector('#managePanel:not([hidden])');assert.equal(await page.locator('.import-card').count(),3);await page.locator('#accountMenu summary').click();await page.locator('#logoutOwner').click();await page.waitForSelector('#privateLogin');
 allowed=false;await page.locator('#ownerPassword').fill('fixture-password-not-a-credential');await page.locator('#passwordLogin').click();await page.waitForFunction(()=>document.getElementById('accessMessage').textContent.includes('权限'));
 assert.equal(await page.locator('#ownerBar').isVisible(),false);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'private-result.json'),JSON.stringify({passed:true,live_auth:false,scope:'synthetic local RPC: anonymous no content request; allowed content fetch with bearer; rejected allowlist stays login; logout clears DOM; relogin restores management route without duplicate manager; password/bank not persisted; mobile fits; three isolated import cards; no uploads on selection; mismatch guidance; chunk progress; sync failure and conflict actions; legacy read preserves old key; interrupted upload retry skips saved chunks; record backup retains unknown IDs'},null,2));
 console.log('PASS: private shell browser boundary, allowed/rejected auth, token-bearing content RPC, logout clearing, password/bank not persisted, mobile layout. Synthetic accounts only.');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
