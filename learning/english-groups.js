/* English material groups. No source text or approvals are bundled here. */
(function(root){
'use strict';
const list=v=>Array.isArray(v)?v:[],plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),id=v=>typeof v==='string'&&v.length>0&&v.length<=240;
const kinds={reading:'reading-a',matching:'reading-b','reading-a':'reading-a','reading-b':'reading-b',cloze:'cloze',translation:'translation',writing:'writing'};
const CHECKS=['complete_material','question_order','options_answer_alignment','attachments','source_versions','original_claim_limits'];
const groupId=g=>g.id??g.group_id,questionGroup=q=>q.group_id??q.passage_id,kind=g=>kinds[g.type];
function optionEntries(q){if(Array.isArray(q.options))return q.options.map((text,i)=>[String.fromCharCode(65+i),text]);if(plain(q.options))return Object.entries(q.options);return []}
function answerIndexes(q){if(Array.isArray(q.answer))return q.answer;if(typeof q.answer==='string'){const labels=q.answer.split(/[\s,]+/).filter(Boolean),entries=optionEntries(q);return labels.map(label=>entries.findIndex(([key])=>key===label))}return []}
function validate(bank){
 if(!plain(bank)||!id(bank.version??bank.content_package_version??bank.subject_version)||!Array.isArray(bank.memoryQuestions)||!Array.isArray(bank.predictions)||!Array.isArray(bank.sources))throw Error('英语题库根结构或版本无效。');
 const questions=[...bank.memoryQuestions,...bank.predictions],byQuestion=new Map(),sources=new Map();
 for(const source of bank.sources){if(!plain(source)||!id(source.id)||sources.has(source.id))throw Error('英语来源ID无效或重复。');sources.set(source.id,source)}
 for(const q of questions){if(!plain(q)||!id(q.id)||byQuestion.has(q.id)||typeof q.prompt!=='string'||q.subject!=='english')throw Error('英语子题ID、科目或题干无效。');byQuestion.set(q.id,q)}
 if(bank.groups===undefined||Array.isArray(bank.groups)&&bank.groups.length===0){if(questions.some(q=>questionGroup(q)))throw Error('子题声明了组ID，但题库缺少groups，不能丢弃上下文。');return {legacy:true,byQuestion,sources,groups:questions.map((q,i)=>({id:'legacy:'+q.id,type:optionEntries(q).length?'legacy-choice':'legacy-task',original_text:'',question_ids:[q.id],source_refs:[],order:i,legacy:true,title:q.title||q.prompt}))}}
 if(!Array.isArray(bank.groups))throw Error('英语groups必须是数组。');
 const seen=new Set(),used=new Set(),orderKeys=new Set();
 const groups=bank.groups.map((g,index)=>{
  if(!plain(g)||!id(groupId(g))||seen.has(groupId(g))||g.id!==undefined&&g.group_id!==undefined&&g.id!==g.group_id||g.subject!=='english'||!['english-i','english-ii'].includes(g.paper_type)||!Number.isInteger(g.year)||g.year<0||!kind(g)||typeof g.original_text!=='string'||!Array.isArray(g.source_refs)||!Array.isArray(g.question_ids)||!g.question_ids.length||typeof g.completeness_status!=='string')throw Error('英语题组身份、材料或完整性字段无效。');
  seen.add(groupId(g));if(g.order!==undefined){const key=g.paper_type+'|'+g.year+'|'+g.order;if(!Number.isInteger(g.order)||g.order<0||orderKeys.has(key))throw Error('组序无效或重复。');orderKeys.add(key)}
  if(g.completeness_status==='complete'&&(!g.original_text.trim()||g.year===0))throw Error('完整组必须提供正文和实际年份。');
  const expected=kind(g)==='cloze'?20:['reading-a','reading-b'].includes(kind(g))?5:1;
  if(g.question_ids.length!==expected)throw Error('组子题数量不完整：'+groupId(g)+'，需要'+expected+'题；缺题应提供停用占位记录，不得缩成小组。');
  let previous=-Infinity;
  for(const qid of g.question_ids){const q=byQuestion.get(qid);if(!q||used.has(qid)||questionGroup(q)!==groupId(g)||q.group_id!==undefined&&q.passage_id!==undefined&&q.group_id!==q.passage_id)throw Error('悬空、重复或跨篇子题：'+qid);used.add(qid);if(!Number.isInteger(q.original_number)||q.original_number<=previous||q.paper_type!==undefined&&q.paper_type!==g.paper_type||q.year!==undefined&&q.year!==g.year)throw Error('子题顺序、年份或试卷类型不匹配：'+qid);previous=q.original_number;if(g.completeness_status!=='complete'&&q.practice_enabled!==false&&q.safe_for_quiz!==false)throw Error('不完整材料组须停用全部子题：'+qid);
   const entries=optionEntries(q);if(['cloze','reading-a','reading-b'].includes(kind(g))){if(g.completeness_status==='complete'&&(entries.length<2||kind(g)!=='reading-b'&&entries.length!==4))throw Error('完整客观组必须提供所有选项：'+qid);if(entries.some(([label,text])=>!id(label)||typeof text!=='string'||!text.trim()))throw Error('选项结构无效：'+qid);const answer=answerIndexes(q);if(g.completeness_status==='complete'&&(!answer.length||answer.some(i=>!Number.isInteger(i)||i<0||i>=entries.length)||new Set(answer).size!==answer.length))throw Error('完整子题答案索引无效：'+qid)}
   else if(optionEntries(q).length)throw Error('翻译/写作必须作为完整主观任务，不能混入选择题。');
  }
  if(g.shared_options!==undefined&&(!Array.isArray(g.shared_options)||g.shared_options.some(o=>!plain(o)||!id(o.label)||typeof o.text!=='string'||!o.text.trim())||new Set(g.shared_options.map(o=>o.label)).size!==g.shared_options.length))throw Error('共享选项无效或重复。');
  if(g.shared_options&&g.completeness_status==='complete')for(const qid of g.question_ids)if(JSON.stringify(optionEntries(byQuestion.get(qid)))!==JSON.stringify(g.shared_options.map(o=>[o.label,o.text])))throw Error('共享选项与子题选项不一致。');
  if(g.attachments!==undefined){if(!Array.isArray(g.attachments))throw Error('图表附件结构无效。');for(const a of g.attachments)if(!plain(a)||!id(a.id)||typeof a.alt!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(a.data_url||'')||a.data_url.length>12*1024*1024||!/^[a-f0-9]{64}$/.test(a.sha256||''))throw Error('图表附件须为有校验值的私有内嵌位图。');if(new Set(g.attachments.map(a=>a.id)).size!==g.attachments.length)throw Error('图表附件ID重复。')}
  const refs=g.source_refs.map(r=>typeof r==='string'?r:r?.id??r?.source_id);if(refs.some(sid=>!sources.has(sid))||new Set(refs).size!==refs.length||g.completeness_status==='complete'&&!refs.length)throw Error('组来源缺失或重复。');
  return {raw:g,id:groupId(g),type:kind(g),order:g.order??index,question_ids:g.question_ids,paper_type:g.paper_type,year:g.year,title:g.title||'',original_text:g.original_text,source_refs:g.source_refs,completeness_status:g.completeness_status,shared_options:g.shared_options,attachments:g.attachments,disabled_reason:g.disabled_reason,practice_enabled:g.practice_enabled};
 });
 if(used.size!==questions.length)throw Error('存在未归组子题，不能悄悄拆成单题页。');groups.sort((a,b)=>b.year-a.year||a.paper_type.localeCompare(b.paper_type)||a.order-b.order);return {legacy:false,byQuestion,sources,groups};
}
async function audit(bank,questionAudit,packageAPI){
 const schema=validate(bank),accepted=new Set(),failures=[],proofs=new Map();
 for(const p of list(bank.groupReviews)){if(!plain(p)||!id(p.group_id)||proofs.has(p.group_id))throw Error('组审核ID无效或重复。');proofs.set(p.group_id,p)}
 if([...proofs.keys()].some(gid=>!schema.groups.some(g=>g.id===gid)))throw Error('组审核引用未知组。');
 for(const g of schema.groups){try{
  if(g.legacy){if(questionAudit.accepted.has(schema.byQuestion.get(g.question_ids[0])))accepted.add(g.id);continue}
  if(g.completeness_status!=='complete'||g.practice_enabled===false)throw Error(g.disabled_reason||'组材料不完整或明确停用，整组不计练习。');
  const p=proofs.get(g.id);if(!p||p.binding_algorithm!=='typed-tree-ieee754-v1'||p.scope!=='whole-material-group'||p.decision!=='passed'||!id(p.author)||!id(p.reviewer)||p.author===p.reviewer||!id(p.completed_at)||!/^[a-f0-9]{64}$/.test(p.evidence_artifact_sha256||'')||CHECKS.some(k=>p.checks?.[k]?.status!=='passed'||typeof p.checks[k].evidence!=='string'||p.checks[k].evidence.trim().length<12))throw Error('当前整组独立审核凭据待补。');
  if(await packageAPI.reviewHash(g.raw)!==p.group_sha256)throw Error('正文、题序或附件版本与组审核不符。');
  if(!plain(p.question_sha256)||Object.keys(p.question_sha256).sort().join('\n')!==[...g.question_ids].sort().join('\n'))throw Error('组审核子题绑定不完整。');
  for(const qid of g.question_ids){const q=schema.byQuestion.get(qid);if(!questionAudit.accepted.has(q)||await packageAPI.reviewHash(q)!==p.question_sha256[qid])throw Error('子题独审未通过或与当前组不符：'+qid)}
  const refs=g.source_refs.map(r=>typeof r==='string'?r:r.id??r.source_id).sort();if(!plain(p.source_sha256)||Object.keys(p.source_sha256).sort().join('\n')!==refs.join('\n'))throw Error('组来源版本绑定不完整。');for(const sid of refs)if(await packageAPI.reviewHash(schema.sources.get(sid))!==p.source_sha256[sid])throw Error('组来源版本已变：'+sid);
  for(const a of list(g.attachments)){const b=Uint8Array.from(atob(a.data_url.split(',')[1]),c=>c.charCodeAt(0));const mime=a.data_url.slice(5,a.data_url.indexOf(';')),magic=mime==='image/png'?b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71:mime==='image/jpeg'?b[0]===255&&b[1]===216:String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';if(!magic||await packageAPI.hash(b)!==a.sha256)throw Error('图表附件校验失败。')}
  accepted.add(g.id);
 }catch(e){failures.push({group_id:g.id,reason:e.message})}}
 return {...schema,accepted,failures,complete_groups:accepted.size,total_groups:schema.groups.length};
}
const api={validate,audit,optionEntries,answerIndexes,CHECKS,groupId,questionGroup};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EnglishGroups=api;
})(typeof window!=='undefined'?window:globalThis);
