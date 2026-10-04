const assert=require('node:assert/strict'),T=require('../learning/subject-trend.js');
for(const subject of ['politics','english']){
 const bank={subject,version:'synthetic-v1',sources:[{id:'source',title:subject+' source',url:'javascript:alert(1)'}],trend:{findings:[{title:'No registered source',text:'UNSOURCED',source_refs:[{id:'missing'}]},{title:'Supplied finding',text:'<script>fictional</script>',source_refs:[{id:'source',locator:'Synthetic page 4'}]}],annual:[{year:2000,topics:['Synthetic topic'],notes:'Narrow fictional scope',source_refs:['source']}],limitations:['Limited']}};
 const html=T.render(bank,subject);assert(html.includes('Synthetic page 4'));assert(html.includes('2000'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('UNSOURCED'));assert(!html.includes('href="javascript:'));assert(T.render({...bank,trend:{}},subject).includes('尚未导入'));assert(T.render(bank,subject==='english'?'politics':'english').includes('尚未导入'));
 bank.trend.source_refs=['source'];delete bank.trend.findings[1].source_refs;assert(T.render(bank,subject).includes('Supplied finding'));
}
console.log('PASS: subject-bound sourced trends, honest empty state, source fallback, escaped text and safe links');
