# t39 独立审查：Splitter 手势公共接口

结论：**需要修复**。

审查对象是 HEAD `70c7168d` 之上的未提交改动（t38，工作区脏改）。代码主体已落盘并可复核；
t38 自己的浏览器验收仍在跑，但下面 4 条缺陷都在 happy-dom 里可复现，浏览器证据不会改变它们的成立与否。

## 所审版本

HEAD `70c7168d2913cb3bf69174e8e6721d548174c6e0`；下表 hash 在审查开始与结束各取一次，一致：

| 文件 | sha256（前 16 位） |
|---|---|
| `packages/nb-ui/src/components/layout/Splitter.vue` | `d8f38a40dff3d5b9` |
| `packages/nb-ui/src/components/layout/splitter-gesture.ts`（新） | `1544c1aaf03d170b` |
| `packages/nb-ui/src/components/layout/splitter.test.ts`（新） | `05c9280f943359de` |
| `packages/nb-ui/src/components/layout/splitter-gesture.test.ts`（新） | `0f00fe798df5706b` |
| `packages/nb-ui/src/components/layout/Splitter.md`（新） | `c00b26be7a7b69df` |
| `packages/nb-ui/e2e/splitter.spec.ts`（新） | `ecdc7ff5ae9c8c1c` |
| `packages/nb-ui/playground/app/component-lab/fixtures/SplitterFixture.vue` | `09b287f5827d2a77` |
| `packages/nb-ui/playwright.config.ts` | `d581ae6bfbc6f97e` |
| `packages/nb-ui/src/components/index.ts` | `baf6be1508d77035` |
| `packages/nb-ui/playground/app/component-lab/registry.ts` | `8f043ce5bc4e59e6` |
| `packages/nb-ui/docs/ui-development-spec.md` | `3391a18a0dc4ef96` |

审查期间被审查集发生一次变化：`packages/nb-ui/e2e/debug-t38.spec.ts`（12 秒 `waitForTimeout` + 截图 + console 的临时调试用例）
在我开始审查时存在，结束前已被 t38 删除。本报告不再把它记为缺陷，只记这条版本变化。

## 已执行命令与结果

```bash
bun run --cwd packages/nb-ui vitest run src/components/layout/splitter-gesture.test.ts src/components/layout/splitter.test.ts
# Test Files 2 passed (2) / Tests 23 passed (23) / 2.27s

bun run --cwd packages/nb-ui vitest run src/components/layout/splitter.test.ts -t "禁用时不产生手势事件也不改布局"
# 1 passed | 12 skipped —— 单独跑（上游状态干净）时该守卫确实成立

bun run --cwd packages/nb-ui vitest run <本 Task evidences/ 下 6 个探针> --disable-console-intercept
# Test Files 6 passed (6) / Tests 9 passed (9)
```

探针复现：把 `evidences/probe-*.test.ts` 复制到 `packages/nb-ui/src/components/layout/` 后按文件顶部注释的命令运行
（相对 import `./Splitter.vue` 只有在同目录才成立）；跑完请删掉，不要在被审目录里留下文件。

上游事实用安装源码核对，未采信实现报告：
`node_modules/reka-ui/dist/Splitter/SplitterResizeHandle.js`（`dragging` 只覆盖指针）、
`.../Splitter/SplitterGroup.js`、`.../composables/useWindowSplitterBehavior.js`
（**keydown 监听挂在手柄元素上**，与 Vue 的 `@keydown` 同元素；Vue 先注册，所以我们的 `begin()` 先于 Reka 的 resize 执行，
键盘第一次调整能被 baseline 捕获）、
`.../composables/useWindowSplitterPanelGroupBehavior.js`（`Enter` 分支只 `setLayout()`，不发 `layout`，也不更新 eager layout）、
`.../utils/registry.js`（模块级 `isPointerDown` / `intersectingHandles`；指针只走 mouse/touch，不认 pointer 事件）。

## 缺陷

### D1（高）`pointercancel` 只取消手势，没有解除上游仍在「拖动中」的指针状态

现象：取消之后**不按任何键**移动鼠标仍然会改变布局，且不产生任何手势事件。

证据（探针 J，`evidences/probe-pointercancel-arm.test.ts`）：

```
J after cancel           {"layouts":[[28,52,20],[29,51,20]], "start":1,"update":1,"cancel":1}
J after buttonless move  {"layouts":[[28,52,20],[29,51,20],[36,44,20]], "cancel":1}
J after mouseup          {"layouts":[...,[36,44,20]], "end":0, "cancel":1}
```

同一 realm 内新挂载的实例完全无法开始指针调整（探针 I）：基线用例 `start:1,update:1,end:1`，在 pointercancel 未收口之后
新挂载实例的同样拖动为 `start:0,update:0,end:0`，布局保持 `[28,52,20]`。

影响：用户可见的幽灵布局变化；此后第一次指针调整静默无效且没有提交，宿主保存的尺寸与屏幕几何脱节。
根因是 Reka 的模块级指针状态（`isPointerDown=true`、`intersectingHandles` 保留旧手柄、`body` 上的 `mousedown` 监听被摘掉），
而 t38 只让**自己**的手势收口（`Splitter.md` 承诺「取消不产生保存意图」成立），未让上游复位。
触屏会紧跟 `touchcancel` 自愈，鼠标/触控笔的 pointercancel 不会。

最小修复方向：`pointercancel` 取消手势的同时把缺失的 up 事件（`mouseup`/`touchend`/`touchcancel`）交给上游复位指针机；
或者在 `Splitter.md` 的「已知偏差」如实声明该限制并给正文回指——后者会把坑留给宿主，需要 Leader 决定。

### D2（中）手势期间发生约束变化时，程序布局被并入 `gesture-end`

证据（探针 D，`evidences/probe-constraint-mid-gesture.test.ts`）：

```
mousemove+20         {"layout":[30,50,20], "update":1}
setProps(maxSize=40) {"layout":[40,40,20], "update":3}   ← 程序收紧约束，outline 30→40 未经用户操作
mouseup              {"end":1}
end payload          {"source":"pointer","sash":"outline~editor","active":["outline","editor"],"compensated":[],"sizes":[40,40,20]}
```

用户实际只拖了 +2%，提交里是 +12%；两次程序驱动的重排还各自发了一次 `gesture-update`。
与 `Splitter.md` 正文直接冲突：「程序改动、约束变化和视口重算只发 `layout`，永远不冒充用户提交」。
`context-changed` 目前只覆盖「身份 / 方向 / 禁用」，约束不在内。

最小修复方向：把现有的 `panelIdsKey` 取消条件扩到约束键（`defaultSize`/`minSize`/`maxSize`/`collapsible`/`collapsedSize`），
以 `context-changed` 取消；或改文档为已知偏差。哪一种需要 Leader 决定——产品里 Storage 恢复/Workbench 分支重排会让这条变得常见。

### D3（中）未收口的指针手势会吞掉键盘调整，并把提交来源标错

证据（探针 C，`evidences/probe-lost-mouseup-keyboard.test.ts`）：

```
C1 drag+30            {"layout":[31,49,20],"start":1,"update":1}
C1 window blur        {"layout":[31,49,20],"start":1,"update":1}   ← 指针手势保持进行中（文档已声明）
C1 ArrowRight keydown {"layout":[38,42,20],"start":1,"update":2}   ← 更新挂到 pointer 手势上
C1 ArrowRight keyup   {"layout":[38,42,20],"start":1,"update":2,"end":0,"cancel":0}   ← keyup 没有收口
C1 late mouseup       {"layout":[38,42,20],"start":1,"update":2,"end":1}
```

最终提交 `{source:"pointer", sizes:[38,42,20]}`——尺寸来自键盘调整，且 Reka 是用**拖动起点**布局算出的（38 = 28+10，不是 31+10），
所以屏幕会出现一次回跳。原因在 `Splitter.vue` 的 `onHandleKeydown`：`if (tracker.activeSource !== null) return;` 把「键盘连发去重」
写成了「任何手势进行中都跳过」，与 `Splitter.md`「`keyup` 或手柄失焦结束键盘手势」「下一次手势开始会先取消上一段未收口的手势」不符。

最小修复方向：守卫只跳过 `activeSource === "keyboard"`（`begin()` 自己会先以 `context-changed` 收口上一段），
或在窗口失焦时对指针手势也 `end()`。两者对「真正拖动中按方向键」的取舍不同，需要 Tasker 判断后写清。

### D4（中）`Enter` 折叠是用户可见的几何变化，但 `layout` 与手势都不发

证据（探针 A/B，`evidences/probe-enter-collapse.test.ts`）：

```
A before            {"layout":[[28,52,20]], "flex":["28","52","20"]}
A after layouts     [[28,52,20]]              ← 没有新的 layout
A after flex        ["0","80","20"]           ← DOM 几何确实变了
A gesture           {"start":0,"end":0,"cancel":0}
B start             {"sizes":[28,52,20]}      ← 基线是折叠前的旧尺寸，屏幕上是 [0,80,20]
```

`collapsible` 是本组件公开 prop，Lab fixture 在 outline/inspector 上启用，用户按 `Enter` 就能触发。
与 `Splitter.md` 的 `layout` 承诺（「布局发生变化（挂载注册、用户调整、约束变化、视口重算都会触发）」）冲突；
上游 `useWindowSplitterPanelGroupBehavior` 的 `Enter` 分支只 `setLayout()` 不发 `layout`，也不更新 eager layout，
因此 baseline 在折叠后是错的（B 的提交把折叠悄悄抹掉）。
`ADJUST_KEYS` 不含 `Enter`，所以这一路径既不受手势合同覆盖、也没有在「不支持」里声明。

最小修复方向：要么把 `Enter`/折叠纳入合同（需要组件自己观测尺寸，成本较高），要么在 props 层不暴露 `collapsible`，
要么至少按组件规范写进「已知偏差」并在正文对应句加回指。需要 Tasker/Leader 选一条。

### D5（低）panel DOM id 与 `aria-controls` 是文档级全局身份

证据（探针 F，`evidences/probe-panel-dom-id.test.ts`）：两个实例都渲染 `id="outline"/"editor"/"inspector"`，
`document.querySelectorAll("#outline").length === 2`，两个 sash 的 `aria-controls` 都是 `["outline","editor"]`。
`docs/specs/ui/nested-grid.md` 的验收 3 明确存在「同名叶分别位于主 grid 与插件 grid」。
手势 payload 的 `sash`/`active` 只在实例内有意义这件事，文档也没有声明。
最小方向：派生 DOM id 加实例前缀（保留宿主语义 id 作为 gesture 身份），或在文档写明「面板 id 必须文档级唯一」。

### D6（低，测试有效性）`pointercancel` 之后的指针用例不再具备判别力

`splitter.test.ts` 的 `afterEach` 只移除容器、不 `unmount()`，指针用例「pointercancel」结束后上游状态是已武装的（见 D1）。
其后的「禁用时不产生手势事件也不改布局」用 `dragSash` 断言「没有手势事件」——在那个上游状态下这条断言恒真。
该守卫本身是对的：单独跑这条用例（`-t`，上游干净）同样通过。
最小方向：`afterEach` 里 `wrapper.unmount()`，或在「pointercancel」用例末尾补一次 `mouseup`，让每个用例从干净的上游状态起步。

### D7（提示，规范冲突，非 t38 阻断）

`docs/standards/code/components.md` 的档位 A「公共零件目录下耦合度大于 0」按字面覆盖 `env:global`（计入耦合度），
而 `Splitter.md` 的标签是 `[state:local, env:global]`；同一 Work 已合并的 `DialogWindow.md` 是同类先例。
档位 C 的要求（销毁/结束即解绑）已满足，且有监听簿记测试。这条更像规范与既有现实的分歧，不由 t38 单独修。

## 通过项（已核对，不阻断）

- 键盘第一次调整能被 baseline 捕获：Vue 的手柄 `@keydown` 先于 Reka 同元素监听器执行，单次 `ArrowRight` 端到端提交 `[38,42,20]`。
- `Escape` 取消后 Reka 继续派发的 move/mouseup 不能再提交（探针 H：`end:0`，布局仍变，符合「几何变化留在原语里」）。
- 空手势按 `no-change` 收口、触界时更远面板记为 `compensated`、`End`/`Home`/`Shift+方向键` 语义、`disabled` 守卫（单独跑通过）、
  卸载取消、嵌套/多实例不串手势、`gesture-start` 与 `gesture-end|cancel` 配对——单测 + 探针一致。
- 面板身份/方向/禁用变化以 `context-changed` 取消；`panels` 置空走同一条路径。
- 全局监听只在手势期间挂载，结束/取消/卸载即解绑，簿记测试覆盖。
- 文档小节顺序符合组件规范（布局/交互/数据/状态/不支持/上游边界/注意事项/隐藏通道理由），
  props/emits/slots/expose/attrs 扩展面都已声明，`env:global` 理由到位；除 D1–D4 外未发现文档与实现不符。
- `ui.nested-grid` 仍为 `planned`，未随本次实现被顺手提升，符合 Work 的推进顺序。

## 未运行项

- 浏览器验收（`packages/nb-ui/e2e/splitter.spec.ts`、Lab fixture 真实几何、`390×844`、主题与 `playwright.config.ts` 宿主）：
  按 Task 边界交给正在跑的 t38，我未运行，因此 D1–D4 在真实浏览器里的可见程度只有推理，没有实测。
- nb-ui 全包测试 / typecheck / build：按 Task 边界不跑（t37 并行改 `grid.ts`）。
- `vitest.config.ts` 统一临时根与 `playwright.config.ts` 宿主显式化是主 Agent 的机械接线，我只读了 diff，未验证其全量效果。
- D1/D3 的最小修复方向只给了思路，未在代码上验证可行性。

## 审查自身留下的痕迹

只写了本 Task 的 `walkthroughs/review.md` 与 `evidences/probe-*.test.ts`；探针在被审目录里是临时副本，
跑完即删，结束前 `git status` 确认被审目录无残留。未编辑被审源码、Spec 或其它 Task，未提交、未联网、未碰 3001 服务。

## 给 Leader 的下一步

1. D1 与 D4 都需要一条产品取舍：修实现还是记「已知偏差」并写正文回指。两者都会影响宿主（Workbench/Storage）对「尺寸与几何一致」的假设。
2. D2/D3 是同一类问题的两面（程序事件与用户意图混流），建议一起定，避免两次改动互相推翻。
3. D6 属于 t38 自己的用例卫生，可与修复同批处理；修完请在整文件顺序下重跑 `splitter.test.ts`，确认「禁用」用例仍靠守卫通过。
