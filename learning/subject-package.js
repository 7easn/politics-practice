/* Private subject ZIP container. Local inspection has no network side effects. */
(function(root){
'use strict';
const LIMIT=262144,MAX_TOTAL=134217728,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const REVIEW_CHECKS=['prompt','answer','explanation','scoring','variants','note_provenance','source_support','original_claim_limits'];
function reviewTree(v){
 if(v===null)return ['null'];if(typeof v==='boolean')return ['boolean',v];if(typeof v==='string')return ['string',v];
 if(typeof v==='number'){if(!Number.isFinite(v)||Number.isInteger(v)&&!Number.isSafeInteger(v))throw Error('审核绑定数字无效。');const b=new ArrayBuffer(8);new DataView(b).setFloat64(0,v,false);return ['number',Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('')]}
 if(Array.isArray(v))return ['array',v.map(reviewTree)];if(plain(v))return ['object',Object.keys(v).sort().map(k=>[k,reviewTree(v[k])])];throw Error('审核绑定包含非JSON字段。');
}
const reviewHash=v=>hash(encoder.encode(JSON.stringify(reviewTree(v))));
const practiceDisabled=q=>q.practice_enabled===false||q.safe_for_quiz===false;
async function auditQuestionReviews(bank,{notes,documents}={}){
 const accepted=new WeakSet(),failures=[],questions=[...(bank.memoryQuestions||[]),...(bank.predictions||[])],proofs=new Map(),sources=new Map();
 for(const s of bank.sources||[]) {if(sources.has(s.id))throw Error('来源ID重复，审核绑定无效。');sources.set(s.id,s)}
 for(const p of bank.questionReviews||[]){if(!plain(p)||proofs.has(p.id))throw Error('整题审核证据ID无效或重复。');proofs.set(p.id,p)}
 const sourceHashes=new Map(),noteRecords=new Map((notes?.records||[]).map(n=>[n.id,n])),documentHashes=new Map((documents?.documents||[]).map(d=>[d.file_name,d.sha256]));let active=0,passed=0;
 for(const q of questions){if(practiceDisabled(q))continue;active++;
  try{const p=proofs.get(q.id);if(!p||p.binding_algorithm!=='typed-tree-ieee754-v1'||p.scope!=='whole-question'||p.decision!=='passed'||typeof p.author!=='string'||!p.author.trim()||typeof p.reviewer!=='string'||!p.reviewer.trim()||p.author===p.reviewer||typeof p.completed_at!=='string'||!p.completed_at||!/^[a-f0-9]{64}$/.test(p.evidence_artifact_sha256)||!plain(p.checks)||REVIEW_CHECKS.some(k=>!plain(p.checks[k])||p.checks[k].status!=='passed'||typeof p.checks[k].evidence!=='string'||p.checks[k].evidence.trim().length<12))throw Error('缺少完整、独立的逐题审核证据。');
   const kind=(bank.memoryQuestions||[]).includes(q)?'memoryQuestions':'predictions';if(p.kind!==kind||await reviewHash(q)!==p.question_sha256)throw Error('当前题干、答案、解析或评分版本与审核不符。');
   const externalNotes=p.note_basis==='external-source-only'||kind==='predictions'&&['source_supplement','prediction_inference','past_exam_authoritative_source_extension'].includes(q.basis_type);
   const ids=[...new Set([...(q.source_ids||[]),...(q.source_refs||[]).map(r=>r.id).filter(id=>typeof id==='string')])].sort();if(!ids.length||!Array.isArray(q.note_refs)||!q.note_refs.length&&!externalNotes||!plain(p.source_sha256)||Object.keys(p.source_sha256).sort().join('\n')!==ids.join('\n'))throw Error('来源或笔记定位绑定不完整。');
   for(const id of ids){if(!sources.has(id))throw Error('当前来源不存在。');if(!sourceHashes.has(id))sourceHashes.set(id,await reviewHash(sources.get(id)));if(p.source_sha256[id]!==sourceHashes.get(id))throw Error('当前来源版本与审核不符。')}
   const noteIds=[...new Set(q.note_refs.map(r=>String(r.locator||'').replace(/^audit:/,'')))].sort(),fileNames=[...new Set(q.note_refs.map(r=>r.file_name))].sort();
   if(!plain(p.note_record_sha256)||!plain(p.document_sha256)||Object.keys(p.note_record_sha256).sort().join('\n')!==noteIds.join('\n')||Object.keys(p.document_sha256).sort().join('\n')!==fileNames.join('\n')||Object.values(p.note_record_sha256).concat(Object.values(p.document_sha256)).some(s=>typeof s!=='string'||!/^[a-f0-9]{64}$/.test(s)))throw Error('笔记原文与Word版本绑定不完整。');
   if(notes)for(const id of noteIds)if(!noteRecords.has(id)||await reviewHash(noteRecords.get(id))!==p.note_record_sha256[id])throw Error('当前笔记原文版本与审核不符。');
   if(documents)for(const name of fileNames)if(documentHashes.get(name)!==p.document_sha256[name])throw Error('当前原始Word版本与审核不符。');
   accepted.add(q);passed++;
  }catch(e){failures.push({id:q.id,reason:e.message})}
 }
 for(const id of proofs.keys())if(!questions.some(q=>q.id===id))throw Error('审核证据引用未知题号。');
 const release=bank.practiceRelease,complete=active>0&&passed===active&&plain(release)&&release.format==='question-release-gate-v1'&&release.passed===true&&release.active_questions===active&&release.current_bound_reviews===passed&&release.disabled_questions===questions.length-active&&/^[a-f0-9]{64}$/.test(release.review_index_sha256);
 return {accepted:complete?accepted:new WeakSet(),active,passed:complete?passed:0,current_version_bound_candidates:passed,disabled:questions.length-active,failures,complete};
}
function validateManifest(m){
 if(!plain(m)||m.format!=='private-subject-package'||m.schema_version!==1||!['psychology','politics','english'].includes(m.subject)||typeof m.package_version!=='string'||!m.package_version||m.package_version.length>160||m.file_complete!==true)throw Error('完整科目包格式或版本不正确。');
 const r=m.semantic_review;if(!plain(r)||!['incomplete','reviewed-with-limitations','reviewed'].includes(r.status)||typeof r.scope!=='string'||!Array.isArray(r.limitations))throw Error('缺少独立的审校范围和限制说明。');
 if(!Array.isArray(m.objects)||!m.objects.length||m.objects.length>2048)throw Error('科目包对象清单无效。');
 const roots=new Set(),groups=new Map(),paths=new Set();let total=0;
 for(let i=0;i<m.objects.length;i++){
  const o=m.objects[i];if(!plain(o)||o.index!==i||typeof o.path!=='string'||!/^objects\/\d{4}\.(json|bin)$/.test(o.path)||paths.has(o.path)||!['bank','notes','documents'].includes(o.component)||!['root','array','asset'].includes(o.role)||!Number.isInteger(o.bytes)||o.bytes<1||o.bytes>LIMIT||!/^[a-f0-9]{64}$/.test(o.sha256)||typeof o.field!=='string'||!Number.isInteger(o.start)||o.start<0||!Number.isInteger(o.count)||o.count<0)throw Error('科目包包含无效或重复对象。');
  paths.add(o.path);total+=o.bytes;
  if(o.role==='root'){if(roots.has(o.component)||o.field!==''||o.start!==0||o.count!==0)throw Error('组件根重复或无效。');roots.add(o.component)}
  else{if(!/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(o.field)||o.role==='asset'&&(o.component!=='documents'||o.count!==o.bytes))throw Error('组件字段或文件分片无效。');const key=o.component+':'+o.role+':'+o.field,expected=groups.get(key)||0;if(o.start!==expected||groups.has(key)&&o.start===0)throw Error('组件分片顺序不连续。');groups.set(key,expected+o.count)}
 }
 if(total>MAX_TOTAL||roots.size!==3||!['subjects','sources','knowledgePoints'].every(k=>groups.has('bank:array:'+k))||!groups.has('bank:array:memoryQuestions')||!groups.has('bank:array:predictions')||!groups.has('notes:array:records')||!groups.has('documents:array:documents'))throw Error('科目包缺少必需组件或超过资源限制。');
 return m;
}
function crc32(bytes){let crc=0xffffffff;for(const v of bytes){crc^=v;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
async function inflateBounded(packed,size){
 let inflater;try{inflater=new DecompressionStream('deflate-raw')}catch{throw Error('当前浏览器不支持压缩科目包，请更新浏览器后直接导入该ZIP。')}
 const reader=new Blob([packed]).stream().pipeThrough(inflater).getReader(),body=new Uint8Array(size);let length=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;if(length+value.length>size)throw Error('ZIP解压对象超过声明尺寸。');body.set(value,length);length+=value.length}if(length!==size)throw Error('ZIP解压对象长度不符。');return body}
 catch(e){await reader.cancel().catch(()=>{});throw Error('ZIP解压校验失败：'+e.message)}finally{reader.releaseLock()}
}
async function unzipBounded(buffer){
 const bytes=new Uint8Array(buffer),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),entries=new Map();
 if(bytes.length>MAX_TOTAL+1048576||bytes.length<22)throw Error('ZIP大小无效。');
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===bytes.length){end=p;break}
 if(end<0||v.getUint16(end+4,true)!==0||v.getUint16(end+6,true)!==0||v.getUint16(end+8,true)!==v.getUint16(end+10,true))throw Error('不支持多卷或缺损ZIP。');
 const count=v.getUint16(end+10,true),centralBytes=v.getUint32(end+12,true);let pos=v.getUint32(end+16,true);if(count<2||count>2049||pos+centralBytes!==end)throw Error('ZIP清单无效。');
 let total=0;const ranges=[];
 for(let i=0;i<count;i++){
  if(pos+46>end||v.getUint32(pos,true)!==0x02014b50)throw Error('ZIP目录损坏。');
  const flags=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),crc=v.getUint32(pos+16,true),packed=v.getUint32(pos+20,true),size=v.getUint32(pos+24,true),nl=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true);
  if(pos+46+nl+extra+comment>end||flags&~2048||![0,8].includes(method)||method===0&&packed!==size||packed>LIMIT+1024||size<1||size>LIMIT||v.getUint16(pos+34,true)!==0||offset+30>v.getUint32(end+16,true))throw Error('请选择规范完整包；仅接受普通或DEFLATE压缩ZIP，不接受加密、多卷和ZIP64。');
  const name=decoder.decode(bytes.subarray(pos+46,pos+46+nl));if(name!=='manifest.json'&&!/^objects\/\d{4}\.(json|bin)$/.test(name)||entries.has(name))throw Error('ZIP路径或重复条目无效。');
  if(v.getUint32(offset,true)!==0x04034b50||v.getUint16(offset+6,true)!==flags||v.getUint16(offset+8,true)!==method||v.getUint32(offset+14,true)!==crc||v.getUint32(offset+18,true)!==packed||v.getUint32(offset+22,true)!==size)throw Error('ZIP文件头不一致。');
  const localName=v.getUint16(offset+26,true),localExtra=v.getUint16(offset+28,true),start=offset+30+localName+localExtra,finish=start+packed;
  if(finish>v.getUint32(end+16,true)||decoder.decode(bytes.subarray(offset+30,offset+30+localName))!==name)throw Error('ZIP对象边界无效。');
  if(ranges.some(([a,b])=>offset<b&&finish>a))throw Error('ZIP条目重叠。');ranges.push([offset,finish]);
  total+=size;if(total>MAX_TOTAL)throw Error('ZIP解压总量超过限制。');const payload=bytes.subarray(start,finish),body=method===0?payload:await inflateBounded(payload,size);if(crc32(body)!==crc)throw Error('ZIP对象校验失败。');entries.set(name,body);pos+=46+nl+extra+comment;
 }
 if(pos!==end||!entries.has('manifest.json')||entries.get('manifest.json').length>131072)throw Error('ZIP缺少完整清单。');return entries;
}
function parseObject(o,body){
 if(o.role==='asset')return body;
 const value=JSON.parse(decoder.decode(body));if(o.role==='root'&&!plain(value)||o.role==='array'&&(!Array.isArray(value)||value.length!==o.count))throw Error('组件结构与清单不一致。');
 if(o.role==='root'&&(Object.values(value).some(Array.isArray)||Object.keys(value).some(k=>['__proto__','constructor','prototype'].includes(k))))throw Error('组件根不得隐藏未声明数组。');
 if(o.role==='array'&&['memoryQuestions','predictions','records'].includes(o.field))for(const item of value)if(!plain(item)||typeof item.id!=='string'||!item.id||item.id.length>256)throw Error('缺少稳定题号或笔记定位。');
 if(o.component==='bank'&&o.field==='memoryQuestions')for(const q of value)if(typeof q.prompt!=='string'||!Array.isArray(q.options)||!Array.isArray(q.answer)||q.answer.some(i=>!Number.isInteger(i)||i<0||i>=q.options.length))throw Error('选择题结构无效。');
 if(o.component==='bank'&&o.field==='predictions')for(const q of value)if(typeof q.prompt!=='string'||!Array.isArray(q.answer_points))throw Error('主观题结构无效。');
 if(o.component==='notes'&&o.field==='records')for(const r of value)if(typeof(r.text??r.original_text)!=='string')throw Error('笔记定位缺少原文。');
 return value;
}
async function inspect(buffer){
 const entries=await unzipBounded(buffer),manifestBytes=entries.get('manifest.json'),manifest=validateManifest(JSON.parse(decoder.decode(manifestBytes)));
 if(entries.size!==manifest.objects.length+1)throw Error('ZIP有未声明或缺失条目。');
 const parsed=new Map(),ids=new Set(),notes=new Set();
 for(const o of manifest.objects){const body=entries.get(o.path);if(!body||body.length!==o.bytes||await hash(body)!==o.sha256)throw Error('清单SHA或对象长度不符。');const value=parseObject(o,body);parsed.set(o.index,value);
  if(o.component==='bank'&&['memoryQuestions','predictions'].includes(o.field)||o.component==='notes'&&o.field==='records'){const seen=o.component==='bank'?ids:notes;for(const item of value){if(seen.has(item.id))throw Error('跨分片题号或笔记定位重复。');seen.add(item.id)}}
 }
 const pack={manifest,manifestText:decoder.decode(manifestBytes),manifestSHA:await hash(manifestBytes),entries,parsed};
 const components={};for(const name of ['bank','notes','documents'])components[name]=await materialize(pack,name);
 pack.questionReview=await auditQuestionReviews(components.bank,{notes:components.notes,documents:components.documents});
 if(pack.manifest.subject==='english'&&components.bank.groups!==undefined){if(!root.EnglishGroups)throw Error('英语整组校验组件尚未加载，未启用导入。');pack.groupReview=await root.EnglishGroups.audit(components.bank,pack.questionReview,api);if(manifest.semantic_review.status!=='incomplete'&&pack.groupReview.groups.some(g=>!g.legacy&&g.completeness_status==='complete'&&g.question_ids.some(id=>!practiceDisabled(pack.groupReview.byQuestion.get(id)))&&!pack.groupReview.accepted.has(g.id)))throw Error('正式英语包缺当前完整材料组独审，未启用导入。');}
 if(manifest.semantic_review.status!=='incomplete'&&!pack.questionReview.complete)throw Error('正式科目包整题审核门槛未通过；不能用审核状态标签替代当前版本证据。');
 return pack;
}
async function materialize(pack,component){
 const m=validateManifest(pack.manifest),result={};
 for(const o of m.objects.filter(o=>o.component===component&&o.role==='root'))Object.assign(result,pack.parsed.get(o.index));
 for(const o of m.objects.filter(o=>o.component===component&&o.role==='array')){
  if(o.start===0){if(Object.hasOwn(result,o.field))throw Error('根字段与数组声明冲突。');Object.defineProperty(result,o.field,{value:[],enumerable:true,writable:true,configurable:true})}
  result[o.field].push(...pack.parsed.get(o.index));
 }
 const assetFields=new Set(),fileNames=new Set();
 if(component==='documents')for(const d of result.documents){
  if(!plain(d)||typeof d.file_name!=='string'||!d.file_name.endsWith('.docx')||/[\\/]/.test(d.file_name)||typeof d.asset_field!=='string'||!Number.isInteger(d.bytes)||d.bytes<4||d.bytes>8388608||!/^[a-f0-9]{64}$/.test(d.sha256))throw Error('Word元数据无效。');
  if(assetFields.has(d.asset_field)||fileNames.has(d.file_name))throw Error('Word元数据重复。');assetFields.add(d.asset_field);fileNames.add(d.file_name);
  const parts=m.objects.filter(o=>o.role==='asset'&&o.field===d.asset_field),bytes=new Uint8Array(d.bytes);let n=0;for(const o of parts){const b=pack.parsed.get(o.index);bytes.set(b,n);n+=b.length}
  if(n!==d.bytes||await hash(bytes)!==d.sha256||bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4)throw Error('Word文件校验失败。');
  let base64='';for(let i=0;i<bytes.length;i+=24576)base64+=btoa(String.fromCharCode(...bytes.subarray(i,i+24576)));d.base64=base64;
 }
 if(component==='documents'&&m.objects.some(o=>o.role==='asset'&&!assetFields.has(o.field)))throw Error('包内含未声明的原始文件。');
 return result;
}
const api={validateManifest,parseObject,inspect,materialize,hash,reviewHash,auditQuestionReviews,practiceDisabled,LIMIT};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SubjectPackage=api;
})(typeof window==='undefined'?globalThis:window);
