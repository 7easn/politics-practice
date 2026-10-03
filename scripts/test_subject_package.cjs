const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
globalThis.crypto=require('node:crypto').webcrypto;
const api=require('../learning/subject-package.js');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'subject-package-fixture-'));try{
 const generate=`import sys,base64,hashlib,json\nsys.path.insert(0,sys.argv[1]);from build_subject_package import build\nraw=b'PK\\x03\\x04'+b'synthetic-Word-body'*20000\nbank={'version':'fixture-v1','subjects':[],'sources':[],'knowledgePoints':[],'memoryQuestions':[{'id':'fixture-Q'+str(i),'prompt':'Synthetic question '+str(i),'options':['a','b'],'answer':[0],'review_status':'needs-review','plain_explanation':'x'*10000} for i in range(90)],'predictions':[{'id':'fixture-E','prompt':'Synthetic essay','answer_points':['point'],'review_status':'needs-review'}],'trend':{'notice':'Incomplete synthetic fixture'}}\nnotes={'records':[{'id':'fixture-note','text':'synthetic original'}]}\ndocuments={'version':1,'documents':[{'file_name':'synthetic.docx','sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode()}]}\nreview={'status':'incomplete','scope':'Synthetic transport fixture only','limitations':['No reviewed content']}\nprint(json.dumps(build('psychology','fixture-v1',bank,notes,documents,review,sys.argv[2])))\n`;
 const zip=path.join(temp,'fixture.zip');const report=JSON.parse(cp.execFileSync('python3',['-c',generate,path.join(__dirname),zip],{encoding:'utf8'}));
 const raw=fs.readFileSync(zip),pack=await api.inspect(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));assert(pack.manifest.objects.length>10);assert.equal(pack.manifest.semantic_review.status,'incomplete');
 const bank=await api.materialize(pack,'bank'),notes=await api.materialize(pack,'notes'),docs=await api.materialize(pack,'documents');assert.equal(bank.memoryQuestions.length,90);assert.equal(bank.predictions[0].id,'fixture-E');assert.equal(notes.records[0].id,'fixture-note');assert.equal(Buffer.from(docs.documents[0].base64,'base64').length,380004);assert.equal(report.manifest_sha256,pack.manifestSHA);
 const broken=Buffer.from(raw);broken[80]^=1;await assert.rejects(()=>api.inspect(broken.buffer.slice(broken.byteOffset,broken.byteOffset+broken.byteLength)),/ZIP|校验/);
 const m=structuredClone(pack.manifest);m.objects[1].start++;assert.throws(()=>api.validateManifest(m),/分片|根/);
 const cross=structuredClone(pack.manifest);cross.subject='math';assert.throws(()=>api.validateManifest(cross),/格式/);
 const dup=structuredClone(pack.manifest);dup.objects[1].path=dup.objects[0].path;assert.throws(()=>api.validateManifest(dup),/重复/);
 const absent=structuredClone(pack.manifest);delete absent.semantic_review;assert.throws(()=>api.validateManifest(absent),/审校/);
 const unsafe={role:'root'};assert.throws(()=>api.parseObject(unsafe,new TextEncoder().encode('{"__proto__":{}}')),/组件根/);
 console.log('PASS: single stored ZIP, bounded JSON and raw Word objects, full local SHA/CRC checks, exact reconstruction, incomplete-review distinction, tamper/missing/duplicate/sequence/unsafe-root rejection.');
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
