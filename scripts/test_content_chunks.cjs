// Synthetic default; optional local private JSON path is never committed.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto,createHash}=require('node:crypto');
const payload=process.env.PRIVATE_CONTENT_TEST_FILE?JSON.parse(fs.readFileSync(process.env.PRIVATE_CONTENT_TEST_FILE,'utf8')):{version:'fixture',memoryQuestions:[],predictions:[],text:'分批😀边界'.repeat(150000)};
const storage=new Map(),url='https://fixture-project.supabase.co',calls=[],uploads=new Map();let active=null,failOnce=true,tamper=false;
storage.set('psychology-sync-config-v1',JSON.stringify({url,publishableKey:'sb_publishable_fixture'}));
storage.set('psychology-sync-session-v1:'+url,JSON.stringify({access_token:'fixture-only',refresh_token:'fixture-only',expires_at:Date.now()/1000+3600,user:{id:'fixture-user'}}));
const reply=x=>({ok:true,status:200,json:async()=>structuredClone(x)});
const fetch=async(path,options)=>{const b=JSON.parse(options.body);calls.push({path,b});assert.equal(options.headers.Authorization,'Bearer fixture-only');
 if(path.endsWith('get_study_state'))return reply({user_id:'fixture-user',revision:0,state:{answers:{},wrong:[],favorites:[]}});
 if(path.endsWith('study_begin_content_upload')){let u=uploads.get(b.p_sha256);if(!u){u={id:b.p_sha256,key:b.p_key,hash:b.p_sha256,bytes:b.p_bytes,count:b.p_chunks,chunks:new Map(),complete:false};uploads.set(u.id,u)}return reply({upload_id:u.id,received:[...u.chunks.keys()],complete:u.complete})}
 if(path.endsWith('study_put_content_chunk')){const u=uploads.get(b.p_upload);assert(Buffer.byteLength(b.p_text)<=524288);u.chunks.set(b.p_index,b.p_text);if(failOnce&&b.p_index===2){failOnce=false;throw Error('lost reply')}return reply({received:true,chunk_index:b.p_index})}
 if(path.endsWith('study_commit_content_upload')){const u=uploads.get(b.p_upload),text=[...u.chunks.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]).join('');assert.equal(u.chunks.size,u.count);assert.equal(Buffer.byteLength(text),u.bytes);assert.equal(createHash('sha256').update(text).digest('hex'),u.hash);u.complete=true;active=u;return reply({saved:true,document_key:u.key,sha256:u.hash})}
 if(path.endsWith('study_get_content_manifest'))return reply({upload_id:active.id,sha256:active.hash,byte_count:active.bytes,chunk_count:active.count});
 if(path.endsWith('study_get_content_chunk'))return reply({chunk_index:b.p_index,content:uploads.get(b.p_upload).chunks.get(b.p_index)+(tamper?'x':'')});
 throw Error('unexpected endpoint');};
const window={},context={window,fetch,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},navigator:{locks:{request:async(n,o,cb)=>typeof o==='function'?o():cb({name:n})}},crypto:webcrypto,TextEncoder,Uint8Array,URL,AbortController,Date,JSON,Set,Map,Promise,Number,Error,location:{href:'https://example.invalid/',hash:''},history:{replaceState(){}}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../learning/sync.js'),'utf8'),context);
(async()=>{const api=window.PsychSync;assert.equal((await api.getStatus()).authenticated,true,JSON.stringify(await api.getStatus()));await assert.rejects(api.setPrivateContent('psychology',payload));assert.equal(active,null,'partial upload activated');const prior=calls.length,progress=[];
 await api.setPrivateContent('psychology',payload,p=>progress.push(p));assert(progress[0].received>=3);assert(!calls.slice(prior).some(c=>c.path.endsWith('study_put_content_chunk')&&c.b.p_index<3),'retry repeated acknowledged chunks');
 assert.deepEqual(JSON.parse(JSON.stringify(await api.getPrivateContent('psychology'))),payload);tamper=true;await assert.rejects(api.getPrivateContent('psychology'),/校验失败/);assert(![...storage.values()].join('').includes('分批😀'));
 assert(!calls.some(c=>c.path.includes('submit_study_batch')));console.log('PASS: resumable lost-reply import, bounded UTF8 chunks, atomic activation, checksum download, content not cached, records untouched; '+Buffer.byteLength(JSON.stringify(payload))+' bytes, '+active.count+' chunks');
})().catch(e=>{console.error(e);process.exitCode=1});
