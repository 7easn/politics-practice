/* Private subject ZIP container. Local inspection has no network side effects. */
(function(root){
'use strict';
const LIMIT=262144,MAX_TOTAL=134217728,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
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
function unzipStored(buffer){
 const bytes=new Uint8Array(buffer),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),entries=new Map();
 if(bytes.length>MAX_TOTAL+1048576||bytes.length<22)throw Error('ZIP大小无效。');
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===bytes.length){end=p;break}
 if(end<0||v.getUint16(end+4,true)!==0||v.getUint16(end+6,true)!==0||v.getUint16(end+8,true)!==v.getUint16(end+10,true))throw Error('不支持多卷或缺损ZIP。');
 const count=v.getUint16(end+10,true),centralBytes=v.getUint32(end+12,true);let pos=v.getUint32(end+16,true);if(count<2||count>2049||pos+centralBytes!==end)throw Error('ZIP清单无效。');
 let total=0;const ranges=[];
 for(let i=0;i<count;i++){
  if(pos+46>end||v.getUint32(pos,true)!==0x02014b50)throw Error('ZIP目录损坏。');
  const flags=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),crc=v.getUint32(pos+16,true),packed=v.getUint32(pos+20,true),size=v.getUint32(pos+24,true),nl=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true);
  if(pos+46+nl+extra+comment>end||flags&~2048||method!==0||packed!==size||size>LIMIT||v.getUint16(pos+34,true)!==0||offset+30>v.getUint32(end+16,true))throw Error('请选择规范未压缩完整包；不接受加密、ZIP64或压缩扩展。');
  const name=decoder.decode(bytes.subarray(pos+46,pos+46+nl));if(name!=='manifest.json'&&!/^objects\/\d{4}\.(json|bin)$/.test(name)||entries.has(name))throw Error('ZIP路径或重复条目无效。');
  if(v.getUint32(offset,true)!==0x04034b50||v.getUint16(offset+6,true)!==flags||v.getUint16(offset+8,true)!==method||v.getUint32(offset+14,true)!==crc||v.getUint32(offset+18,true)!==size||v.getUint32(offset+22,true)!==size)throw Error('ZIP文件头不一致。');
  const localName=v.getUint16(offset+26,true),localExtra=v.getUint16(offset+28,true),start=offset+30+localName+localExtra,finish=start+size;
  if(finish>v.getUint32(end+16,true)||decoder.decode(bytes.subarray(offset+30,offset+30+localName))!==name)throw Error('ZIP对象边界无效。');
  if(ranges.some(([a,b])=>offset<b&&finish>a))throw Error('ZIP条目重叠。');ranges.push([offset,finish]);
  const body=bytes.subarray(start,finish);if(crc32(body)!==crc)throw Error('ZIP对象校验失败。');total+=size;if(total>MAX_TOTAL)throw Error('ZIP总量超过限制。');entries.set(name,body);pos+=46+nl+extra+comment;
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
 const entries=unzipStored(buffer),manifestBytes=entries.get('manifest.json'),manifest=validateManifest(JSON.parse(decoder.decode(manifestBytes)));
 if(entries.size!==manifest.objects.length+1)throw Error('ZIP有未声明或缺失条目。');
 const parsed=new Map(),ids=new Set(),notes=new Set();
 for(const o of manifest.objects){const body=entries.get(o.path);if(!body||body.length!==o.bytes||await hash(body)!==o.sha256)throw Error('清单SHA或对象长度不符。');const value=parseObject(o,body);parsed.set(o.index,value);
  if(o.component==='bank'&&['memoryQuestions','predictions'].includes(o.field)||o.component==='notes'&&o.field==='records'){const seen=o.component==='bank'?ids:notes;for(const item of value){if(seen.has(item.id))throw Error('跨分片题号或笔记定位重复。');seen.add(item.id)}}
 }
 const pack={manifest,manifestText:decoder.decode(manifestBytes),manifestSHA:await hash(manifestBytes),entries,parsed};
 for(const name of ['bank','notes','documents'])await materialize(pack,name);
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
const api={validateManifest,parseObject,inspect,materialize,hash,LIMIT};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SubjectPackage=api;
})(typeof window==='undefined'?globalThis:window);
