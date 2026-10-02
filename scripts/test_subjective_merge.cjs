'use strict';
const assert=require('node:assert/strict'),api=require('../learning/subjective-merge.js');
// Synthetic identities and questions only; no source documents or answer bank.
const base={version:'original',memoryQuestions:[{id:'MC',answer:[1],options:['A','B']}],predictions:[],sources:[{id:'old',title:'old'}],subjects:[{id:'one',title:'one'}],knowledgePoints:[{id:'keep'}],politics:{keep:'unchanged'},notes:{draft:'keep'},arbitrary:{nested:['keep']},contentRenderingContract:{keep:true}};
const t={format:'psychology-subjective-only-v1',sample_only:false,native_sha256:'a'.repeat(64),version:'test',predictions:Array.from({length:895},(_,i)=>({id:'S'+i,subject:'one',prompt:'synthetic',answer_points:['synthetic']})),sources:[{id:'subjective-v13:new',title:'new'}],subjects:[{id:'one',title:'new must not replace old'}],predictionCoverage:[],contentRenderingContract:{subjective:true}};
const out=api.merge(base,t,'b'.repeat(64),'c'.repeat(64));
for(const k of ['memoryQuestions','knowledgePoints','politics','notes','arbitrary','contentRenderingContract'])assert.deepEqual(out[k],base[k]);assert.deepEqual(out.subjects,base.subjects);assert.deepEqual(out.sources.slice(0,1),base.sources);assert.equal(out.predictions.length,895);assert.equal(base.predictions.length,0);
assert.throws(()=>api.merge({...base,memoryQuestions:[]},t,'b'.repeat(64),'c'.repeat(64)));
assert.throws(()=>api.merge(base,{...t,memoryQuestions:[]},'b'.repeat(64),'c'.repeat(64)));
assert.throws(()=>api.merge(base,{...t,sample_only:true},'b'.repeat(64),'c'.repeat(64)));
assert.throws(()=>api.merge(base,{...t,sources:[{id:'old'}]},'b'.repeat(64),'c'.repeat(64)));
assert.throws(()=>api.merge(base,{...t,predictions:[...t.predictions.slice(1),t.predictions[1]]},'b'.repeat(64),'c'.repeat(64)));
assert.throws(()=>api.merge(base,t,'','c'.repeat(64)));
assert.throws(()=>api.assertPreserved(base,{...out,arbitrary:{changed:true}}));
console.log('PASS: subjective-only preserves all immutable fields/registries and original object; missing baseline, mixed bank, sample, collision, duplicate ID, hash and tampering refused.');
