// Restore contract checks with the production parser and hydration function.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../learning/app.js'),'utf8');
const parser=source.slice(source.indexOf('function archiveHistoricalScores('),source.indexOf('function restore()'));
const hydration=source.slice(source.indexOf('function restoreAccountState('),source.indexOf('function applyRemote('));
const answer=(attempts=1,correct=false)=>({correct,firstCorrect:false,attempts,selected:[correct?0:1],time:'2026-10-03T00:00:00Z'});
const empty=()=>({version:2,answers:{},wrong:[],favorites:[],notes:{essay:{text:'keep draft',time:'local'}},legacyRecords:{old:{kept:true}},updatedAt:'local'});
function harness(initial,{readOnly=false,queueError=false}={}){
 const staged=[],messages=[],c={state:structuredClone(initial),syncStatus:{readOnly},array:x=>Array.isArray(x)?x:[],object:v=>v&&typeof v==='object'&&!Array.isArray(v),window:{PsychSync:{stageLocal:s=>{if(queueError)throw Error('synthetic quota');staged.push(structuredClone(s))}}},toast:t=>messages.push(t)};
 c.applyRemote=incoming=>{c.state=structuredClone(incoming)};vm.createContext(c);vm.runInContext(parser+'\n'+hydration,c);return{c,staged,messages,restore:(remote,before=initial)=>c.restoreAccountState(remote,structuredClone(before))};
}
const initial={...empty(),answers:{Q:answer()},wrong:['Q'],favorites:['Q']};
let h=harness(initial);h.restore(empty());assert.equal(h.c.state.answers.Q.attempts,1);assert.equal(h.c.state.answers.Q.firstCorrect,false);assert.deepEqual([...h.c.state.wrong],['Q']);assert.deepEqual([...h.c.state.favorites],['Q']);assert.equal(h.c.state.notes.essay.text,'keep draft');assert(h.c.state.legacyRecords.old.kept);assert.equal(h.staged.length,1);
// Existing newer cloud answers and explicit collection removals remain authoritative.
h=harness(initial);const newer={...empty(),answers:{Q:answer(4,true)}};h.restore(newer);assert.equal(h.c.state.answers.Q.attempts,4);assert.equal(h.c.state.answers.Q.correct,true);assert.deepEqual([...h.c.state.wrong],[]);assert.equal(h.staged.length,0);
// A user submits again or toggles collections while an older snapshot is in flight.
h=harness(initial);h.c.state.answers.Q=answer(2,true);h.c.state.favorites=[];h.c.state.wrong=[];h.restore({...empty(),answers:{Q:answer()},favorites:['Q'],wrong:['Q']});assert.equal(h.c.state.answers.Q.attempts,2);assert.deepEqual([...h.c.state.favorites],[]);assert.deepEqual([...h.c.state.wrong],[]);assert.equal(h.staged.length,1);
// Read-only tabs and failed queue writes must not erase durable submissions.
h=harness(initial,{readOnly:true});h.restore(empty());assert(h.c.state.answers.Q);assert.equal(h.staged.length,0);
h=harness(initial,{queueError:true});h.restore(empty());assert(h.c.state.answers.Q);assert.equal(h.messages.length,1);
console.log('PASS: account restore retains orphan submissions, late edits, drafts/history; newer cloud answers win; read-only and queue errors preserve local records.');
