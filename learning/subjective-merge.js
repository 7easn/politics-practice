/* Private technical candidate; never bundles a memory bank. */
(function(root){'use strict';
const copy=x=>JSON.parse(JSON.stringify(x)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const allowed=['predictions','predictionCoverage','subjectiveRenderingContract','subjectiveUpdate','version','content_package_version','sources','subjects'];
function validateTransport(t){
 if(!t||t.format!=='psychology-subjective-only-v1'||t.sample_only!==false||t.predictions?.length!==895||!Array.isArray(t.sources)||!Array.isArray(t.subjects)||!Array.isArray(t.predictionCoverage))throw Error('仅接受完整895题的主观更新文件；样本或混合库不能导入。');
 for(const k of ['memoryQuestions','politics','notes','documents','knowledgePoints'])if(k in t)throw Error('主观更新文件包含禁止的基线内容。');
 const ids=new Set();for(const q of t.predictions){if(!q||typeof q.id!=='string'||!q.id||ids.has(q.id)||typeof q.prompt!=='string'||!Array.isArray(q.answer_points)||!q.answer_points.length)throw Error('主观题结构或题号无效。');ids.add(q.id)}
 if(!/^[a-f0-9]{64}$/.test(t.native_sha256))throw Error('缺少原主观库哈希。');return t;
}
function merge(base,t,baselineSHA,transportSHA){
 validateTransport(t);if(!base||!Array.isArray(base.memoryQuestions)||!base.memoryQuestions.length||!Array.isArray(base.predictions)||!Array.isArray(base.sources)||!Array.isArray(base.subjects))throw Error('缺少本人已导入完整基线，不能更新或清空题库。');
 if(!/^[a-f0-9]{64}$/.test(baselineSHA)||!/^[a-f0-9]{64}$/.test(transportSHA))throw Error('缺少已核验基线/更新哈希。');
 const out=copy(base),sourceIds=new Set(base.sources.map(s=>s.id)),subjectIds=new Set(base.subjects.map(s=>s.id));
 for(const s of t.sources){if(sourceIds.has(s.id))throw Error('新增来源ID与基线冲突；拒绝覆盖。');sourceIds.add(s.id)}
 for(const q of t.predictions)if(!subjectIds.has(q.subject)&&!t.subjects.some(s=>s.id===q.subject))throw Error('主观学科缺失。');
 out.predictions=copy(t.predictions);out.predictionCoverage=copy(t.predictionCoverage);out.subjectiveRenderingContract=copy(t.contentRenderingContract);out.sources.push(...copy(t.sources));out.subjects.push(...copy(t.subjects.filter(s=>!subjectIds.has(s.id))));
 out.subjectiveUpdate={format:t.format,baseline_sha256:baselineSHA,transport_sha256:transportSHA,native_sha256:t.native_sha256,subjective_version:t.version,baseline_version:base.content_package_version||base.version||null};
 out.version=out.content_package_version='subjective-v13-'+baselineSHA.slice(0,12)+'-'+transportSHA.slice(0,12);
 assertPreserved(base,out);return out;
}
function assertPreserved(base,out){for(const k of new Set([...Object.keys(base),...Object.keys(out)]))if(!allowed.includes(k)&&!same(base[k],out[k]))throw Error('主观更新改变了基线字段：'+k);for(const k of ['sources','subjects'])if(!same(base[k],out[k].slice(0,base[k].length)))throw Error('基线来源或学科被覆盖。');return true}
const api={validateTransport,merge,assertPreserved,allowed};if(typeof module!=='undefined')module.exports=api;root.SubjectiveOnlyMerge=api;
})(typeof window==='undefined'?globalThis:window);
