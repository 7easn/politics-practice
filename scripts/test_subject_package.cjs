const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
globalThis.crypto=require('node:crypto').webcrypto;
const api=require('../learning/subject-package.js');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'subject-package-fixture-'));try{
 const generate=`import sys,base64,hashlib,json\nsys.path.insert(0,sys.argv[1]);from build_subject_package import build\nraw=b'PK\\x03\\x04'+b'synthetic-Word-body'*20000\nbank={'version':'fixture-v1','subjects':[],'sources':[],'knowledgePoints':[],'memoryQuestions':[{'id':'fixture-Q'+str(i),'prompt':'Synthetic question '+str(i),'options':['a','b'],'answer':[0],'review_status':'needs-review','plain_explanation':'x'*10000} for i in range(90)],'predictions':[{'id':'fixture-E','prompt':'Synthetic essay','answer_points':['point'],'review_status':'needs-review'}],'trend':{'notice':'Incomplete synthetic fixture'}}\nnotes={'records':[{'id':'fixture-note','text':'synthetic original'}]}\ndocuments={'version':1,'documents':[{'file_name':'synthetic.docx','sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode()}]}\nreview={'status':'incomplete','scope':'Synthetic transport fixture only','limitations':['No reviewed content']}\nprint(json.dumps(build('psychology','fixture-v1',bank,notes,documents,review,sys.argv[2],compression=sys.argv[3] if len(sys.argv)>3 else 'deflate')))\n`;
 const zip=path.join(temp,'fixture.zip');const report=JSON.parse(cp.execFileSync('python3',['-c',generate,path.join(__dirname),zip],{encoding:'utf8'}));
 const raw=fs.readFileSync(zip),pack=await api.inspect(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));assert(pack.manifest.objects.length>10);assert.equal(pack.manifest.semantic_review.status,'incomplete');
 const bank=await api.materialize(pack,'bank'),notes=await api.materialize(pack,'notes'),docs=await api.materialize(pack,'documents');assert.equal(bank.memoryQuestions.length,90);assert.equal(bank.predictions[0].id,'fixture-E');assert.equal(notes.records[0].id,'fixture-note');assert.equal(Buffer.from(docs.documents[0].base64,'base64').length,380004);assert.equal(report.manifest_sha256,pack.manifestSHA);
 const storedZip=path.join(temp,'stored.zip');cp.execFileSync('python3',['-c',generate,path.join(__dirname),storedZip,'stored']);const storedRaw=fs.readFileSync(storedZip),stored=await api.inspect(storedRaw.buffer.slice(storedRaw.byteOffset,storedRaw.byteOffset+storedRaw.byteLength));assert.equal(stored.manifestSHA,pack.manifestSHA);for(const [name,body] of pack.entries)assert.deepEqual(Buffer.from(body),Buffer.from(stored.entries.get(name)));assert(raw.length<storedRaw.length/4);
 const central=raw.readUInt32LE(raw.length-6),offset=raw.readUInt32LE(central+42);
 async function rejectHeader(change,pattern){const b=Buffer.from(raw);change(b);await assert.rejects(()=>api.inspect(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),pattern)}
 await rejectHeader(b=>{b.writeUInt32LE(1,central+24);b.writeUInt32LE(1,offset+22)},/解压/);
 await rejectHeader(b=>{b.writeUInt32LE(api.LIMIT+1,central+24);b.writeUInt32LE(api.LIMIT+1,offset+22)},/ZIP|完整包/);
 await rejectHeader(b=>{b.writeUInt16LE(1,central+8);b.writeUInt16LE(1,offset+6)},/完整包/);
 await rejectHeader(b=>{b.writeUInt16LE(99,central+10);b.writeUInt16LE(99,offset+8)},/完整包/);
 await rejectHeader(b=>{b.writeUInt32LE(0,central+16);b.writeUInt32LE(0,offset+14)},/校验/);
 const traversal=path.join(temp,'traversal.zip');cp.execFileSync('python3',['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED); old=zipfile.ZipFile(sys.argv[1]); [z.writestr('../escape.json' if i==0 else x.filename,old.read(x.filename)) for i,x in enumerate(old.infolist())]; z.close()",zip,traversal]);const badPath=fs.readFileSync(traversal);await assert.rejects(()=>api.inspect(badPath.buffer.slice(badPath.byteOffset,badPath.byteOffset+badPath.byteLength)),/路径/);
 const saved=globalThis.DecompressionStream;try{globalThis.DecompressionStream=undefined;await assert.rejects(()=>api.inspect(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),/浏览器/);await api.inspect(storedRaw.buffer.slice(storedRaw.byteOffset,storedRaw.byteOffset+storedRaw.byteLength))}finally{globalThis.DecompressionStream=saved}
 const broken=Buffer.from(raw);broken[80]^=1;await assert.rejects(()=>api.inspect(broken.buffer.slice(broken.byteOffset,broken.byteOffset+broken.byteLength)),/ZIP|校验/);
 const m=structuredClone(pack.manifest);m.objects[1].start++;assert.throws(()=>api.validateManifest(m),/分片|根/);
 const cross=structuredClone(pack.manifest);cross.subject='math';assert.throws(()=>api.validateManifest(cross),/格式/);
 const dup=structuredClone(pack.manifest);dup.objects[1].path=dup.objects[0].path;assert.throws(()=>api.validateManifest(dup),/重复/);
 const absent=structuredClone(pack.manifest);delete absent.semantic_review;assert.throws(()=>api.validateManifest(absent),/审校/);
 const unsafe={role:'root'};assert.throws(()=>api.parseObject(unsafe,new TextEncoder().encode('{"__proto__":{}}')),/组件根/);
 console.log('PASS: single compressed/stored ZIP equivalence, bounded inflation, overflow/encryption/method/CRC/path rejection and unsupported-browser behavior; bounded JSON and raw Word objects, full local SHA/CRC checks, exact reconstruction, incomplete-review distinction, tamper/missing/duplicate/sequence/unsafe-root rejection.');
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
