import {createProcessor} from '/tmp/mdx-probe/node_modules/@mdx-js/mdx/index.js';
const p = createProcessor();
for (const src of ['{panel.任务[t-3].奖励}','{panel.任务[3].奖励}','{panel.任务[t3].奖励}','{panel.任务["t3"].奖励}','{panel.魔力 == 3110 ? "a" : "b"}']) {
  const tree = p.parse(src); const e = tree.children[0].data.estree.body[0].expression;
  const inner = e.object && e.object.property ? e.object : e;
  console.log(src, '=>', e.type, inner.computed, inner.property && inner.property.type, inner.property && (inner.property.name ?? inner.property.value ?? inner.property.operator));
}
