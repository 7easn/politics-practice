/* Render only supplied, source-located observations from the active subject bank. */
(function(root){
'use strict';
const list=v=>Array.isArray(v)?v:[],esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),text=v=>esc(typeof v==='object'?JSON.stringify(v):v);
function render(bank,subject){
 const name=subject==='politics'?'考研政治':'英语二',t=bank?.trend||{},sources=new Map(list(bank?.sources).map(s=>[s.id,s]));
 if(bank?.subject!==subject)return empty(name,subject);
 const refs=item=>list(item?.source_refs??t.source_refs).filter(r=>sources.has(typeof r==='string'?r:r?.id??r?.source_id));
 const provenance=item=>'<details class="details" open><summary>趋势出处（本科包）</summary>'+refs(item).map(r=>{const id=typeof r==='string'?r:r.id??r.source_id,s=sources.get(id),url=/^https?:\/\//.test(s.url||'')?s.url:'';return '<div class="reference">'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title||s.file_name||id)+'</a>':esc(s.title||s.file_name||id))+'<p class="fine">'+esc(id)+' · '+esc(typeof r==='string'?'定位未提供':r.locator||'定位未提供')+'</p></div>'}).join('')+'</details>';
 const findings=list(t.findings).filter(f=>f&&refs(f).length),annual=list(t.annual).filter(a=>a&&refs(a).length);
 if(!findings.length&&!annual.length)return empty(name,subject);
 return '<article class="card"><h2>'+esc(t.title||name+'趋势解读')+'</h2><p class="pre-line">'+text(t.scope||'研究范围未标注，请以各条出处和限制为准。')+'</p><p class="fine">趋势独审声明：'+text(t.review_status||bank.independent_review||'未声明')+'（出处关联不代表审校通过）；仅显示资料包提供的有源观察，不从题库题量推算考试频次。</p></article>'+findings.map(f=>'<article class="card" data-trend-finding="'+esc(f.id||'')+'"><h2>'+esc(f.title)+'</h2><p class="pre-line">'+text(f.text)+'</p><p class="fine">证据：'+text(f.evidence||'未提供补充说明')+'</p><p class="fine">不确定性：'+text(f.uncertainty||'未标注')+'</p>'+provenance(f)+'</article>').join('')+(annual.length?'<article class="card"><h2>逐年观察（仅包内范围）</h2>'+annual.map(a=>'<section class="annual"><b>'+esc(a.year)+'</b><div><p>'+text(Array.isArray(a.topics)?a.topics.join(' · '):a.topics)+'</p><p>'+text(a.notes)+'</p>'+provenance(a)+'</div></section>').join('')+'</article>':'')+'<article class="card"><h2>研究口径与限制</h2><p class="pre-line">'+text(t.methodology||'口径未提供')+'</p><ul>'+list(t.limitations).map(l=>'<li>'+text(l)+'</li>').join('')+'</ul></article>';
}
function empty(name,subject){return '<article class="card"><h2>'+name+'趋势资料尚未导入</h2><p>当前本科包没有带可解析出处的趋势解读；无资料不是错误。导入本科趋势资料后显示，不使用其他科目的研究。</p><button class="btn" data-room-manage="'+subject+'">导入本科资料</button></article>'}
const api={render};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SubjectTrend=api;
})(typeof window!=='undefined'?window:globalThis);
