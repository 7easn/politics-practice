// Pure display compatibility: no content-bank, scoring-index or stored-record edits.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const code=fs.readFileSync(path.join(__dirname,'../learning/app.js'),'utf8');
const fn=code.slice(code.indexOf('function answerPointText('),code.indexOf('function prediction('));
const context={};vm.createContext(context);vm.runInContext(fn+';this.format=answerPointText;this.extra=answerPointExtra',context);
const point='这是较长的合成要点，只用于检验重复文本的显示兼容';
assert.equal(context.format(point+'：'+point+'（训练分值 2）'),point+'（训练分值 2）');
assert.equal(context.format(point+'： '+point+' （训练分值 2）'),point+'（训练分值 2）');
assert.equal(context.format({point,explanation:point,training_score:2}),point+'（训练分值 2）');
assert.equal(context.format({label:'评分点一',point,explanation:point,marks:2}),'评分点一：'+point+'（训练分值 2）');
assert.equal(context.format({point,explanation:'另有不同的具体说明',training_score:3}),point+'（训练分值 3）');
assert.equal(context.format({label:'评分点一',explanation:point,training_score:2}),'评分点一：'+point+'（训练分值 2）');assert.equal(context.format({label:'仅有标签'}),'仅有标签');assert.equal(context.extra({label:'评分点一',explanation:point}),'');assert.equal(context.extra({point,explanation:point}),'');assert.equal(context.extra({point,explanation:'另有不同的具体说明'}),'另有不同的具体说明');assert.equal(context.extra({point,explanation:point,incremental_explanation:'明确增量字段'}),'明确增量字段');assert.equal(context.format('概念：解释：补充'), '概念：解释：补充');assert.equal(context.format('A:A'),'A:A');
const five=Array.from({length:5},(_,i)=>context.format({point:point+i,explanation:point+i,training_score:2}));assert.equal(five.length,5);assert(five.every(p=>p.endsWith('（训练分值 2）')));assert.equal(new Set(five).size,5);
console.log('PASS: old repeated strings and equal object fields display once; distinct explanations, five independent points and training marks preserved.');

const probability=code.match(/^function forecastRange.*$/m)[0]+'\n'+code.match(/^function probabilityMatches.*$/m)[0];vm.runInContext(probability+';this.filter=probabilityMatches',context);const q=range=>({forecast:{knowledge_point_range:range}});assert(context.filter(q([20,40]),'0-30'));assert(context.filter(q([20,40]),'30-60'));assert(!context.filter(q([20,40]),'60-100'));assert(context.filter(q([30,30]),'0-30'));assert(context.filter(q([30,30]),'30-60'));assert(context.filter(q(null),'unmarked'));assert(!context.filter(q([20,40]),'unmarked'));assert(!context.filter(q([40,20]),'30-60'));assert(context.filter({},'all'));assert(!context.filter(q(['20','40']),'30-60'));console.log('PASS: probability filter uses existing ranges, inclusive overlap, unknown option and no invented estimates.');
