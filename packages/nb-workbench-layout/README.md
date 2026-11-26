# @notnotype/nb-workbench-layout

工作台的布局层，建在 [`@notnotype/nb-layout`](../nb-layout/README.md) 的公开入口上；不发布。决策见 [ADR 0054](../../docs/adr/0054-nb-layout-general-library.md)，行为合同见 [`docs/specs/ui/workbench-layout.md`](../../docs/specs/ui/workbench-layout.md)。

```ts
import {projectLayoutDoc, resolveLayoutDrop} from "@notnotype/nb-workbench-layout";   // 纯 TS：布局文档、投影、落点规则
import {TabStrip} from "@notnotype/nb-workbench-layout/vue";                          // 标签条，依赖 nb-ui
```

## 布局文档

工作台的一棵树在 `src/layout-doc.ts`：文档树（用户的布局）、领域操作与校验；`src/layout-project.ts` 由文档算交给 nb-layout `createGrid` 的呈现树；`src/layout-drop.ts` 是落点规则。行为见 [ui/workbench-layout](../../docs/specs/ui/workbench-layout.md)。文档的尺寸意图都是 CSS px，只从呈现尺寸写回，不读 `serialize()`（那里的 `weight` 是反解的比例）。写回有两个时机，各一个入口（`src/intent-writeback.ts`）：手势落账后用 `applyGestureCommit(doc, projection, {before, after, collapsed})`，`before` 是手势开始时呈现的尺寸（nb-layout `useGridHost` 的 `onApplied` 第二个参数的 `sizes`）；结构操作之前用 `rebaseForOperation(doc, projection, presented)`。两者都替你挑出不该写的保留像素节点；底下的 `rebaseIntents` 不导出。

操作都是纯函数：失败返回 `{ok: false, code, message}`（和 nb-layout 同一个形状，`message` 是英文、只给日志看）、文档不变，结果和现状一样时返回原对象。输入可以放在 Vue 的 `ref`、`reactive` 里：操作按 JSON 形状整份复制文档，结果是新的普通对象；只改一处的几个操作（改尺寸意图、改分支比例这类）沿用输入里没改的子对象，传进来的面板记录也原样放进结果，输入是响应式代理时这几处仍是代理，要深拷贝结果用 JSON 拷贝，不要对它 `structuredClone`。新建面板与分支要的 id 由 `LayoutPolicy.newId` 给，库写入前再核对没被用过，用过了就拒绝这次操作（`rejected`）。读回来的文档经 `validateLayoutDoc`：条的叶 id 要等于条名，节点、面板、浮动窗的 id 不能是条名，也不能撞上呈现里生成的 id（`strip:` 开头、`:sections` 结尾）。
