import {createProcessor} from '/tmp/mdx-probe/node_modules/@mdx-js/mdx/index.js';
const p = createProcessor();
const cases = {
  comment: '前文 {/* v=123 */} 后文',
  flowComment: '{/* exported-version: 42 */}\n\n正文',
  idDash: '{panel.任务[t-3].奖励}',
  idNum: '{panel.任务[3].奖励}',
  idUuid: '{panel.任务[0f3a].奖励}',
  otherEntry: '{星瑾.panel.魔力}',
  frontmatter: '---\nversion: 42\n---\n\n正文',
  refA: '见[设定][s]。',
  refAB: '见[设定][s]。\n\n[s]: https://example.com',
};
function walk(n, out, d=0){ out.push('  '.repeat(d)+n.type+(n.data&&n.data.estree? ' estree.body='+JSON.stringify(n.data.estree.body.map(b=>b.type+(b.expression? ':'+b.expression.type+(b.expression.computed!==undefined? ' computed='+b.expression.computed+' prop='+(b.expression.property&&b.expression.property.type):'' ):''))) + ' comments='+(n.data.estree.comments||[]).length:'') + (n.type==='text'?' '+JSON.stringify(n.value):'')); (n.children||[]).forEach(c=>walk(c,out,d+1)); }
for (const [k,src] of Object.entries(cases)) {
  try { const tree = p.parse(src); const t2 = await p.run(tree); const out=[]; walk(tree,out); console.log('== '+k+'\n'+out.join('\n')); }
  catch(e){ console.log('== '+k+' ERROR '+e.message.split('\n')[0]); }
}
