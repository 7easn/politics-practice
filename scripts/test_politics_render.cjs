/* Synthetic rendering cases only. Contains no private questions or source files. */
const assert=require('node:assert/strict'),R=require('../learning/politics-render.js');
assert.deepEqual(R.paragraphs('材料一\n人形机\n器人参与工作。\n\n材料二\n“长中文引语，\n保留语义。”\n摘自某书\n（1）说明理由。\n（2）比较条件。'),['材料一','人形机器人参与工作。','材料二','“长中文引语，保留语义。”','摘自某书','（1）说明理由。','（2）比较条件。']);
assert.deepEqual(R.paragraphs('一、概念\n定义\n延续内容\n二、条件\n条件内容'),['一、概念定义延续内容','二、条件条件内容']);
assert.deepEqual(R.paragraphs('第一自然段。\n第二自然段。\n\n• 要点一\n• 要点二'),['第一自然段。','第二自然段。','• 要点一','• 要点二']);
assert(R.value({reference_answer:['第一段。','第二段。'],learning_coverage_points:[{point:'完整要点',explanation:'完整解析'}],official_marks:null,file_sha256:'a'.repeat(64)}).includes('完整解析'));
assert(!/official_marks|file_sha256|null/.test(R.value({official_marks:null,file_sha256:'a'.repeat(64)})));
assert.equal(R.value('<script>bad</script>'),'<p>&lt;script&gt;bad&lt;/script&gt;</p>');
assert(R.value('{"reference_answer":"结构化旧字符串答案"}').includes('结构化旧字符串答案'));
assert(!R.value('{"reference_answer":"结构化旧字符串答案"}').includes('"reference_answer"'));
const raw={id:'synthetic-manual',material_ocr_text:'材料一\n长材\n料。\n\n材料二\n独立段落。',prompt_subquestions:['第一问。','第二问。'],subanswers:[{subquestion:1,prompt:'第一问。',reference_answer:'第一问完整答案。',learning_coverage_points:['点一','点二'],official_marks:null,explanation_plain:'解析一。',variant:{prompt:'变式题。',answer_and_explanation:'合并完整答法。',answer:'变式答案。',explanation:'变式解析。'},source_reference_answer_refs:[{file_name:'合成答案.pdf',pdf_page:12,printed_page:8,library_file_id:'libfile_synthetic'}]},{subquestion:2,prompt:'第二问。',reference_answer:'第二问完整答案。'}],source_refs:[{source_id:'synthetic-source',pdf_pages:[2,3],locator:'材料出处'}]};
const q={...raw,adapter_projection:{manual:true,raw_registry:'rawOriginalQuestions'},practice_enabled:true},bank={rawOriginalQuestions:[raw],sources:[{id:'synthetic-source',file_name:'合成题目.pdf'}]};
const h=R.question(q,bank)+R.answer(q,bank);for(const t of ['材料一','长材料。','材料二','独立段落。','第一问完整答案。','第二问完整答案。','点一','点二','合并完整答法。','变式答案。','变式解析。','合成答案.pdf','PDF 12 页','印刷 8 页','合成题目.pdf','PDF 2、3 页','材料出处'])assert(h.includes(t),t);
assert(!/JSON.stringify|libfile_|official_marks|"subquestion":/.test(h));assert.equal((h.match(/data-subquestion=/g)||[]).length,2);
assert(h.includes('class="politics-material prompt"'));assert(!R.question(q,bank).includes('<h2 tabindex="-1">材料'));
const stem={...q,stem:'材料1第一段。摘自原书材料2第二段。（1）第一问。（2）第二问。',material_ocr_text:undefined,prompt_subquestions:undefined};const stemBank={rawOriginalQuestions:[stem],sources:[]};const s=R.question(stem,stemBank);assert(s.includes('aria-label="分问题目"'));assert(s.includes('（2）第二问。'));assert(s.indexOf('材料1')<s.indexOf('材料2'));
const legacy={id:'synthetic-legacy-manual',prompt:'旧结构主观题',reference_answer:'旧结构完整参考答案',answer_points:['旧结构完整要点']};assert(R.answer(legacy,{}).includes('旧结构完整参考答案'));assert(R.answer(legacy,{}).includes('旧结构完整要点'));assert(R.question(legacy,{}).includes('politics-question-title'));
console.log('PASS: synthetic typed answers, every subquestion, complete variant branches, safe Chinese sources, material paragraphs and question typography.');
