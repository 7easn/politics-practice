// Fresh local browser + synthetic RPC data. No real account or credentials.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.STUDY_PREVIEW_URL||'http://127.0.0.1:8769',root=path.resolve(__dirname,'..');
const fixture={version:'fixture',build:'synthetic local test',subjects:[{id:'puxin',title:'测试科目'}],sources:[],knowledgePoints:[],predictions:[],corrections:[],predictionCoverage:[],trend:{findings:[],annual:[]},memoryQuestions:[{id:'fixture-Q',subject:'puxin',prompt:'本地测试题：选第二项',options:['测试A','测试B','测试C','测试D'],answer:[1],review_status:'verified',plain_explanation:'仅用于界面测试',option_explanations:['测试A解释','测试B解释','测试C解释','测试D解释'],variations:['测试变式1','测试变式2'],note_refs:[],source_ids:[]}]};
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.CHROME_BINARY?{executablePath:process.env.CHROME_BINARY}:{})});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),calls=[],errors=[];let allowed=true;
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin===new URL(base).origin)return route.continue();
  if(url.origin!=='https://fdpofmiuprjtvjbtnrku.supabase.co')return route.abort();
  calls.push({path:url.pathname,body:route.request().postDataJSON(),headers:route.request().headers()});
  let body={},status=200;
  if(url.pathname.includes('/auth/v1/token'))body={access_token:'fixture-not-a-real-token',refresh_token:'fixture-not-a-real-refresh',expires_in:3600,user:{id:'10000000-0000-4000-8000-000000000001',email:'fixture@example.invalid'}};
  else if(url.pathname.endsWith('get_study_state')){body=allowed?{user_id:'10000000-0000-4000-8000-000000000001',revision:0,state:{answers:{},wrong:[],favorites:[]}}:{code:'42501'};status=allowed?200:403;}
  else if(url.pathname.endsWith('study_get_private_content')){body=allowed?fixture:{code:'42501'};status=allowed?200:403;}
  else if(url.pathname.includes('/logout'))body={};
  else if(url.pathname.endsWith('submit_study_batch'))body={status:'ok',revision:1,state:{answers:{},wrong:[],favorites:[]},accepted:[]};
  else throw Error('Unexpected fixture request '+url.pathname);
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/');
 await page.waitForSelector('#privateLogin');assert.equal(await page.locator('#ownerBar').isVisible(),false);
 assert.equal(calls.filter(x=>x.path.endsWith('study_get_private_content')).length,0,'anonymous fetched content');
 await page.locator('#ownerEmail').fill('fixture@example.invalid');await page.locator('#ownerPassword').fill('fixture-password-not-a-credential');await page.locator('#passwordLogin').click();
 await page.waitForSelector('[data-view="memory"]');await page.locator('[data-view="memory"]').click();await page.waitForSelector('[data-choice]');
 await page.locator('[data-choice="fixture-Q"][data-index="1"]').click();await page.locator('[data-submit="fixture-Q"]').click();
 assert.equal(await page.locator('text=逐项解释').count(),1);
 const stored=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
 assert(!JSON.stringify(stored).includes('fixture-password-not-a-credential'));assert(!JSON.stringify(stored).includes('本地测试题'));
 assert(calls.filter(x=>x.path.endsWith('study_get_private_content')).every(x=>x.headers.authorization==='Bearer fixture-not-a-real-token'));
 const out=path.join(root,'private/browser-check');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'private-memory-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(out,'private-memory-mobile.png'),fullPage:true});
 await page.locator('#logoutOwner').click();await page.waitForSelector('#privateLogin');assert.equal(await page.locator('#privateApp').isVisible(),false);assert(!await page.locator('#privateApp').innerText().then(t=>t.includes('本地测试题')));
 allowed=false;await page.locator('#ownerPassword').fill('fixture-password-not-a-credential');await page.locator('#passwordLogin').click();await page.waitForFunction(()=>document.getElementById('accessMessage').textContent.includes('权限'));
 assert.equal(await page.locator('#ownerBar').isVisible(),false);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'private-result.json'),JSON.stringify({passed:true,live_auth:false,scope:'synthetic local RPC: anonymous no content request; allowed content fetch with bearer; rejected allowlist stays login; logout clears DOM; password/bank not persisted; mobile fits'},null,2));
 console.log('PASS: private shell browser boundary, allowed/rejected auth, token-bearing content RPC, logout clearing, password/bank not persisted, mobile layout. Synthetic accounts only.');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
