// Real review.2 package; all non-loopback requests are blocked.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const root=path.resolve(__dirname,'..'),base=process.env.STUDY_PREVIEW_URL||'http://127.0.0.1:18873',folder=path.join(root,'private/teacher-interview');
const bytes=fs.readFileSync(path.join(folder,'bundle.json')),bundle=JSON.parse(bytes),out=path.join(folder,'browser-check');
const screenshots=[];
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_BINARY?{executablePath:process.env.CHROME_BINARY}:{})});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),external=[],errors=[];
  await ctx.route('**/*',r=>{if(new URL(r.request().url()).origin===new URL(base).origin)return r.continue();external.push(r.request().url());return r.abort()});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/private/teacher-interview/review-preview.html');
  await page.locator('#tiImportFile').setInputFiles({name:'bundle.json',mimeType:'application/json',buffer:bytes});
  await page.waitForFunction(()=>document.getElementById('tiImportStatus').textContent.includes('本机预览：'));
  const nav=name=>page.locator('[data-ti-view="'+name+'"]').first().click();
  const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
  const screenshot=async name=>{await page.screenshot({path:path.join(out,name)});screenshots.push(name)};
  await nav('tree');assert((await page.locator('#tiContent').innerText()).includes('教材知识叶条目 1344 个；目录外补充与教学拓展 19 个'));
  const updates=bundle.knowledgeTree.filter(n=>n.level==='knowledge'&&n.scope_type==='curriculum_2025');assert.equal(updates.length,18);
  for(const n of updates){await page.locator('#tiSearch').fill(n.id);const leaf=page.locator('.ti-tree-leaf').filter({has:page.locator('h3').filter({hasText:n.title})});assert.equal(await leaf.count(),1);const text=await leaf.innerText();assert(text.includes(n.description));assert(text.includes(n.version_boundary));assert(text.includes('课标页据'));}
  const n=updates.find(n=>n.id==='KU-B2-NQPF-CONCEPT');await page.locator('#tiSearch').fill(n.id);await noOverflow();await page.locator('.ti-tree-leaf').scrollIntoViewIfNeeded();await screenshot('review2-update-desktop.png');
  await page.locator('.ti-tree-leaf .ti-reference').click();assert.equal(await page.locator('.ti-source').count(),new Set(n.source_ids).size);
  assert((await page.locator('#tiContent').innerText()).includes('国家发展改革委'));
  await nav('sources');await page.locator('#tiSearch').fill('');await page.locator('#tiCurriculumAlignment>summary').click();
  assert.equal(await page.locator('.ti-curriculum-row').count(),65);
  const row=page.locator('[data-ti-requirement="B2:2.1"]');await row.locator('summary').click();
  assert((await row.innerText()).includes('新质生产力'));await row.scrollIntoViewIfNeeded();await noOverflow();await screenshot('review2-curriculum-desktop.png');
  await page.setViewportSize({width:360,height:800});await row.scrollIntoViewIfNeeded();await noOverflow();await screenshot('review2-curriculum-mobile.png');
  await nav('tree');await page.locator('#tiSearch').fill(n.id);await page.locator('.ti-tree-leaf').scrollIntoViewIfNeeded();await noOverflow();const readingWidth=await page.locator('.ti-tree-leaf .ti-prose').evaluate(el=>el.getBoundingClientRect().width);assert(readingWidth>=250,'nested mobile knowledge text is too narrow');await screenshot('review2-update-mobile.png');
  await nav('frequency');await page.locator('#tiSearch').fill(n.id);assert.equal(await page.locator('#tiContent>article').count(),1);let text=await page.locator('#tiContent').innerText();assert(text.includes('直接考查：0'));assert(text.includes('教学应用：0'));assert(text.includes('无可核考试年份'));await noOverflow();
  await nav('predictions');await page.locator('#tiSearch').fill('TI-D042');await page.locator('.ti-question summary').filter({hasText:'完整试讲逐字稿'}).click();text=await page.locator('.ti-question').innerText();assert(text.includes('蜡'));assert(text.includes('不可可靠估计'));await noOverflow();await page.locator('.ti-question').scrollIntoViewIfNeeded();await screenshot('review2-revised-question-mobile.png');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(out,'review2-browser-report.json'),JSON.stringify({passed:true,checked_at:new Date().toISOString(),version:bundle.version,bundle_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bundle_bytes:bytes.length,mobile_knowledge_reading_width:readingWidth,viewports:[{width:1440,height:1000},{width:360,height:800}],checks:['1344 textbook leaves and 19 separately counted supplements','all 18 update descriptions and version boundaries visible','exact source-card jump including added NQPF source','65 curriculum rows and B2 2.1 page anchors','mobile curriculum and new knowledge leaf wrapping','mobile knowledge text width at least 250px','new supplement frequency remains zero and years unknown','revised D042 uses wax material and no numerical probability','no page errors','no external or real account requests'],screenshots,external_requests:external.length,page_errors:errors},null,2));
  console.log('PASS: actual review.2 updates, curriculum panel, evidence jump, unknown-year/zero-frequency boundaries and desktop/mobile layout.');
  await ctx.close();
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
