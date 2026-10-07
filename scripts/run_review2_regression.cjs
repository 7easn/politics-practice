// Every browser suite uses synthetic RPC interception and a fresh Chrome profile.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),http=require('node:http');
const root=path.resolve(__dirname,'..'),out=path.join(root,'private/teacher-interview/audit/recovery-regression');
fs.mkdirSync(out,{recursive:true});
const tests=['test_sync.cjs','test_content_chunks.cjs','test_answer_display.cjs','test_source_display.cjs','test_private_browser.cjs','test_teacher_interview.cjs','test_teacher_interview_bundle.cjs','test_review2_browser.cjs'];
const requested=process.argv.slice(2),selected=requested.length?tests.filter(t=>requested.includes(t)):tests,reportName=requested.length?'report-selected.json':'report.json';
const reports=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),file=path.resolve(root,'.'+name+(name.endsWith('/')?'index.html':''));if(!file.startsWith(root+path.sep))throw Error('path');const body=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body)}catch{res.writeHead(404);res.end('Not found')}});
async function run(){
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18873,'127.0.0.1',resolve)});
 try{for(const test of selected){
 const started=new Date().toISOString(),r=await new Promise(resolve=>{const child=cp.spawn(process.execPath,[path.join(root,'scripts',test)],{cwd:root,env:process.env});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.once('error',error=>resolve({status:null,stdout,stderr,error}));child.once('close',status=>resolve({status,stdout,stderr}));});
 const text=(r.stdout||'')+(r.stderr||'')+(r.error?'\n'+r.error.message:'');
 fs.writeFileSync(path.join(out,test+'.txt'),text);
 reports.push({test,started_at:started,ended_at:new Date().toISOString(),exit_code:r.status,passed:r.status===0,output_file:test+'.txt'});
 fs.writeFileSync(path.join(out,reportName),JSON.stringify({passed:reports.every(x=>x.passed),scope:'local recovery only; browser RPCs intercepted; no real account, migration or release',tests:reports},null,2));
 console.log(test+': '+(r.status===0?'PASS':'FAIL')+' '+text.slice(-1200));
 if(r.status!==0)throw Error(test+' failed');
 }}finally{await new Promise(resolve=>server.close(resolve))}
}
run().catch(error=>{console.error(error.message);process.exitCode=1});
