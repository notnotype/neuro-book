// 2026-11-02：看小说里常见的写法在真 MDX 里会怎样，以及每个 {} 能不能拿到语法树（供白名单检查）。
// 用法：在仓库外的临时目录装 @mdx-js/mdx@3（例如 /tmp/mdx-probe），再
//   MDX_DIR=/tmp/mdx-probe/node_modules/@mdx-js/mdx bun scripts/mdx-probe.mjs
const {compile} = await import(`${process.env.MDX_DIR}/index.js`)

const samples = {
  '尖括号网址': '设定参考 <https://example.com/wiki> 。',
  'HTML 注释': '<!-- 作者备注：这段以后再改 -->\n\n星瑕推开门。',
  '项目方言的批注': '她抬头<comment body="节奏太快">看了他一眼</comment>。',
  '项目方言的文字颜色': '<span style="color: #ef4444">红字</span>',
  '网文系统提示': '<叮！获得神典石×50>',
  '比较': '魔力<50 时无法变身。',
  '作者的心里话': '星瑕笑了{这里要不要加一句吐槽？}。',
  '好感度写法': '好感度{+5}，现在是 60。',
  '作者用的花括号注记': '{TODO 第三章回收}',
}
console.log('一、编译结果')
for (const [name, src] of Object.entries(samples)) {
  try {
    const out = String(await compile(src))
    const body = out.slice(out.indexOf('function _createMdxContent'), out.indexOf('export default'))
    console.log(`== ${name}：编译通过\n${body.replace(/\s+/g, ' ').slice(0, 300)}\n`)
  } catch (e) {
    console.log(`== ${name}：报错\n${e.message}\n`)
  }
}

console.log('二、每个 {} 与 import 的语法树节点')
const seen = []
const collect = () => (tree) => {
  const walk = (n) => {
    if (n.type === 'mdxTextExpression' || n.type === 'mdxFlowExpression') {
      seen.push(`${n.value.trim()} -> ${n.data?.estree?.body?.[0]?.expression?.type}`)
    }
    if (n.type === 'mdxjsEsm') seen.push(`ESM：${n.value}`)
    n.children?.forEach(walk)
  }
  walk(tree)
}
await compile(`import fs from 'node:fs'\n\n魔力 {panel.魔力}/12000，{panel.魔力 > 100 ? '充足' : '不足'}，好感度{+5}，{fetch('http://x')}`, {remarkPlugins: [collect]})
console.log(seen.join('\n'))
