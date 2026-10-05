/* Synthetic metadata only; never contains private questions or source IDs. */
const assert=require('node:assert/strict'),C=require('../learning/politics-catalog.js');
const bank={sources:[{id:'question-book',file_name:'Synthetic 肖1000题.pdf'},{id:'theory-book',file_name:'Synthetic 腿姐参考理论.pdf'},{id:'real-book',file_name:'Synthetic 徐涛强化真题集.pdf'},{id:'base-book',file_name:'Synthetic 徐涛基础题篇.pdf'},{id:'high-book',file_name:'Synthetic 徐涛提高题篇.pdf'}],memoryQuestions:[],predictions:[]};
const q={id:'arbitrary-id-no-year-or-author',source_refs:[{id:'question-book',role:'question'},{id:'theory-book',role:'textbook_theory'}]};
assert.deepEqual(C.classification(q,bank),{source:'xiao',year:null});
assert.deepEqual(C.classification({...q,prediction:true,exam_year:2026},bank),{source:'prediction',year:null});
assert.deepEqual(C.classification({id:'looks-like-real-2027',source_refs:[{id:'real-book'}],book_year:2027,source_type:'real_exam_reprinted_in_textbook',exam_year:2023},bank),{source:'real',year:2023});
assert.deepEqual(C.classification({id:'POL-REAL-2026',source_refs:[]},bank),{source:'other',year:null});
assert.equal(C.classification({source_refs:[{source_id:'base-book'}]},bank).source,'foundation');
assert.equal(C.classification({source_refs:[{id:'high-book'}]},bank).source,'high');
assert.equal(C.classification({source_refs:[{id:'question-book'},{id:'theory-book'}]},bank).source,'mixed');
const notes={rawRecords:[{id:'unclassified-note',title:'Synthetic knowledge'}],records:[{id:'unclassified-note',text:'Full synthetic original\nPreserved range limit'},{id:'example',text:'Synthetic complete example fields',adapter_projection:{source_field:'notes.referenceExamples'}}],referenceExamples:[{id:'example',prompt:'Synthetic example',options:{A:'First',B:'Second'},original_reference_answer:'A',variants:[{prompt:'Synthetic variant'}],prediction:false}]};
const before=JSON.stringify({bank,notes});const rows=C.references(notes);assert.equal(rows.length,2);assert.equal(rows[0].module,'unclassified');assert.equal(rows[1].kind,'example');
const rendered=C.renderReferences(notes,bank,{kind:'example'});assert.equal(rendered.count,1);assert(rendered.html.includes('Second'));assert(rendered.html.includes('Synthetic variant'));assert(rendered.html.includes('非预测'));assert(!rendered.html.includes('data-pol-submit'));
assert(C.renderReferences(notes,bank,{kind:'knowledge'}).html.includes('Preserved range limit'));
assert.equal(C.renderReferences(notes,bank,{search:'absent'}).count,0);assert.equal(JSON.stringify({bank,notes}),before);
console.log('PASS source provenance, explicit exam year, prediction identity, ambiguity, reference deduplication, full readonly text and immutability');
