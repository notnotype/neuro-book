# t39 第三轮独立审查：F1/F2/F3 补修后的当前 revision

结论：**建议合并**。

F1（禁用/零尺寸 sash 的 Enter 走 Reka 旧路径）、F2（等值重渲染误取消手势）、F3（Enter 用例判别力）都已按最新源码与
聚焦用例核验闭合，独立探针在新 revision 上未再复现任何第二轮缺陷，也未发现补修引入的新阻断项。
浏览器级证据（真实监听顺序、`390×844`、四主题、零宽命中带）来自 t38 的 E2E 运行，按 Task 边界我未复跑；
全包 typecheck/build 与 `lab.css` 两次确定性构建仍待 Leader 统一门禁。下面是 4 条低风险观察与 1 条上游耦合提示，均不阻断。

## 所审版本

HEAD `70c7168d2913cb3bf69174e8e6721d548174c6e0`，全部为未提交的工作区改动。
下表 sha256 在审查开始（12:22）与结束（12:24）各取一次，**逐项一致**；作者最后一次写入是 12:17:19
（t38 `implementation.md`），即审查窗口内被审集没有变化。

| 文件 | sha256（前 20 位） |
|---|---|
| `packages/nb-ui/src/components/layout/Splitter.vue` | `41a174fb9cbf0bf1780d` |
| `packages/nb-ui/src/components/layout/splitter-gesture.ts` | `98f46663fad792ac3278` |
| `packages/nb-ui/src/components/layout/splitter.test.ts` | `b82db0e8028ef0738e7b` |
| `packages/nb-ui/src/components/layout/splitter-gesture.test.ts` | `c065adce0250e78e58fe` |
| `packages/nb-ui/src/components/layout/Splitter.md` | `89530740d8a4e3cfd009` |
| `packages/nb-ui/e2e/splitter.spec.ts` | `4c9c60a5a04d5d783c62` |
| `packages/nb-ui/playground/app/component-lab/fixtures/SplitterFixture.vue` | `8c90e215d0691be600ea` |
| `packages/nb-ui/playground/app/assets/css/lab.css` | `f7a8d874e83b96e9f6a5` |
| `packages/nb-ui/playground/app/component-lab/registry.ts` | `c2731673d4f6b604f8aa` |
| `packages/nb-ui/src/components/index.ts` | `baf6be1508d770359051` |
| `packages/nb-ui/playwright.config.ts` | `d581ae6bfbc6f97ed78f` |
| `packages/nb-ui/docs/ui-development-spec.md` | `bf651d2e034a9595f0e3` |

相对第二轮，`Splitter.vue`、`splitter.test.ts`、`Splitter.md`、`e2e/splitter.spec.ts`、`SplitterFixture.vue`、
`registry.ts` 变了；`splitter-gesture.ts` 与手势 helper 测试未变。

## 已执行命令与结果

全部用 worktree 绝对 cwd，未触碰 3001；不创建仓库 `.tmp`、不递归删除。

```bash
# 1. 聚焦用例（作者声称 32 条，实测一致）
bun run --cwd packages/nb-ui vitest run src/components/layout/splitter.test.ts src/components/layout/splitter-gesture.test.ts
# Test Files 2 passed (2) / Tests 32 passed (32) / 2.07s

# 2. 本轮探针（复制到 packages/nb-ui/src/components/layout/ 后运行，跑完 rm -f 删除）
bun run --cwd packages/nb-ui vitest run src/components/layout/probe-final-enter-eager.test.ts --disable-console-intercept
# Test Files 1 passed (1) / Tests 11 passed (11) / 1.88s；关键输出见下
```

探针存档 `evidences/probe-final-enter-eager.test.ts`（11 条，含 P1–P11）；被审目录内的副本已 `rm -f` 删除，
`git status -- packages/nb-ui/src/components/layout` 只剩 t37/t38 的既有条目。

```
P1 disabled + 可取消 Enter   sizes ["28.0","52.0","20.0"] -> ["28.0","52.0","20.0"] counts {"layout":1,"start":0,"update":0,"end":0,"cancel":0}
P2 disabled + 不可取消 Enter sizes ["28.0","52.0","20.0"] -> ["0.0","80.0","20.0"]  counts {"layout":1,...}            ← 旧路径仍在，只被 preventDefault 挡住
P3 零像素 sash + 可取消 Enter tabindex -1 sizes 不变 counts {"layout":1,...}
P4 Enter 折叠→恢复           collapse dom [0,80,20] = layout = end；expand 回 [28,52,20] counts {"start":2,"end":2,"cancel":0}
P5 非可折叠面板 Enter        sizes 不变 counts {"layout":1,"start":1,"cancel":1} cancel reason "no-change"
P6 Enter repeat + Arrow      counts {"start":1,"update":2,"end":1,"cancel":0} dom [18,62,20] = layout = end
P10 Arrow→Enter（未松开）    dom == layout 逐步一致；Enter 未触发折叠，counts 停在 {"start":1,"update":1,"end":1}
P11 第二条 sash Enter        dom [28,0,72]，end sash "editor~inspector"，DOM = 提交尺寸
P7 拖动中模板内联新数组重建   counts {"cancel":0,"end":1}（两次重渲染都不断手势）
P8 键盘手势等值重建 / 值变化  等值 cancel 0；值变化 cancel 1 reason "context-changed"
P9 拖动中 sashSizes 值变化    cancel 1 reason "context-changed"，end 0
```

上游事实按安装源码核对（`reka-ui/dist`）：组级 Enter 监听注册在 `useWindowSplitterPanelGroupBehavior` 的 `watchEffect` 里，
进入时先判 `event.defaultPrevented`；其 `Enter` 分支只 `setLayout(nextLayout)`（`SplitterGroup.js:230` 等 `setLayout` 路径）
不 `emits("layout")`，与第二轮结论一致。`collapsePanel`/`expandPanel`（`SplitterGroup.js:377,407`）都还带
`if (panelData.constraints.collapsible)` 守卫，且都会 `emits("layout")` 并更新 eager layout。

## 三条缺陷的核验

### F1 已闭合（`Splitter.vue:168-169`）

`if (event.key === "Enter") event.preventDefault();` 现在位于 `props.disabled || sashSizes.value[index] === 0` 守卫之前，
且位于 `activeSource === "keyboard"` 提前返回之前，因此**所有不由本组件执行的 Enter 都被截断**：

- P1/P3：禁用与零像素边界上，可取消 Enter 不再改几何、不发 `layout`、不发手势（第二轮 F1 的反例形态）。
- P2 给出判别力来源：同一条代码路径在**不可取消**事件下仍然折叠面板且 `layout` 增量为 0。
  真实浏览器 `keydown` 是可取消的，所以组件用例改用 `cancelable: true` 之后，这条断言真的挂在 `preventDefault` 上
  ——若把 `:169` 挪回守卫之后，P1 会变成 P2 的形态而失败。
- P4/P6/P11：走公开 `collapse`/`expand` 后，折叠/恢复都会发 `layout` 并同步 eager layout，
  DOM（`data-panel-size`）、`layout`、提交 `sizes` 三者一致，`gesture-start` 与 `end|cancel` 一一配对。

前提是「Vue 的 handle `@keydown` 先于 Reka 同元素监听器执行」。我核对的是注册时机：Vue 的 fallthrough invoker 在元素挂载时注册，
Reka 的组级监听要等组元素 ref 就绪后才在 `watchEffect` 里注册，happy-dom 的 P1 也复现了这个顺序；
真实浏览器侧的守门测试是 `e2e/splitter.spec.ts` 的 Enter/禁用/零宽三条用例（作者报告 14 passed，我未复跑）。

### F2 已闭合（`Splitter.vue:55,198`）

`panelConstraintsKey` 已从「每次求值返回新数组」的 getter 改成
`JSON.stringify(props.panels.map((panel) => [defaultSize, minSize, maxSize, collapsible, collapsedSize]))` 的值键，
与 `panelIdsKey`（`:54`）、`sashSizesKey`（`:75`）口径一致。

- P7 用比组件用例更贴近真实宿主的形态验证：宿主模板里每次渲染都新建 `panels` 数组字面量，拖动中强制两次重渲染，
  `gesture-cancel` 0 次、`gesture-end` 1 次，拖动没有被拆掉（第二轮 F2 的反例形态）。
- P8/P9 确认收紧没有过头：约束值真变化、`sashSizes` 值真变化仍以 `context-changed` 取消且不提交；
  组件用例「等值 panels/sashSizes 重建不中断手势，真实变化仍取消」与之一致。

### F3 已闭合

- `splitter.test.ts` 的 `pressAdjustKey` 改成 `{key, bubbles: true, cancelable: true}`（`:117`）。
- 新增/改写的断言落到 DOM 几何与提交载荷的一致性：「按边界应用 sash 像素，零值边界退出交互…」用 `panelSizes`，
  「禁用时方向键与 Enter 均不产生事件或改变布局」用 `panelSizes` + `layout` 计数，
  「Enter repeat…DOM、layout 与提交一致」断言 `panelSizes == lastLayout == 提交 sizes`；`afterEach` 已 `unmount()`。
- `e2e/splitter.spec.ts` 新增两条：Enter repeat + Arrow 多键序列（断言 `data-panel-size` 与提交载荷逐项相等、`layout` 增长）、
  禁用与零宽 sash（含 `elementFromPoint` 不再命中零宽手柄），补上了「只在真实浏览器成立」的监听顺序前提。

## 补修引入的新交互（本轮新核，未发现阻断）

- Enter 折叠/恢复现在由本组件驱动：折叠一次、恢复一次、两次各提交一次，恢复回到折叠前尺寸（P4）。
- Enter repeat 只折叠一次；Enter 与 Arrow 混序都只有一次提交，DOM 与提交载荷始终一致，未回到 Reka 不发 `layout` 的旧路径（P6、P10）。
- 折叠目标与边界映射正确：第二条 sash 折叠其左侧面板并提交 `editor~inspector`（P11）。
- 零像素 sash 仍不参与指针命中（`pointer-events-none after:pointer-events-none`，`:256`），Enter 也在同一处理里被截断（P3）。

## 低风险观察（不阻断）

1. **死代码**：`Splitter.vue:181` 的 `void nextTick()` 没有任何可观察效果（`nextTick()` 无回调时只返回已经排队的 flush promise）。
   Enter 的同步性已由 P4/P6/P11 证明，建议直接删掉这一行。
2. **非可折叠面板的空手势对**：`onHandleKeydown` 在校验 `collapsible` 之前就 `tracker.begin`，所以对非可折叠面板按 Enter 会产出
   `gesture-start` + `no-change` 取消（P5，几何与 `layout` 都没变，不违反 Spec 验收 4）。`Splitter.md` 只写「可折叠面板用 `Enter` 折叠或恢复」，
   没有声明这种空手势；要么在 `begin` 前加 `panel.collapsible` 守卫，要么在文档注明。属取舍，不影响正确性。
3. **Arrow 手势未结束时按 Enter 被静默吞掉**（P10）：`preventDefault` + `activeSource === "keyboard"` 守卫让 Enter 无反应。
   这是刻意的旧路径截断，也不会产生 DOM/`layout` 脱节；建议在文档「交互」小节补一句「调整进行中不重复触发折叠」。
4. **禁用时 sash 仍可聚焦**：`:tabindex="sashSizes[index] === 0 ? -1 : 0"` 不考虑 `disabled`，禁用把手仍在 Tab 顺序内、
   聚焦后完全不响应。属既有行为（第二轮未列为缺陷），记录给 Leader 判断是否要一并退出 Tab 顺序或补 `aria-disabled` 说明。

## 未验证项

- **真实浏览器**（`e2e/splitter.spec.ts` 14 条：真实 sash 尺寸、Enter/禁用/零宽、`390×844`、nbook/macos 四主题 × 桌面/窄屏）：
  按 Task 边界留给 t38/Leader 统一运行，我未复跑；F1 的真实监听顺序前提最终靠它。
- **nb-ui 全包 test / typecheck / build** 与 `lab.css` 两次确定性构建：Leader 统一门禁（t37 并行改 `grid.ts`）。
- **零像素 sash 的命中带**：我只核到 class 与伪元素关闭 `pointer-events`，浏览器 `elementFromPoint` 结论采信 t38 报告。
- **Reka 版本耦合**：安装版 2.10 的组级 keydown 是 `addEventListener` 注册、晚于 Vue 的 fallthrough invoker；
  若上游改成挂载前或同帧先注册，F1 的截断会静默失效。`e2e/splitter.spec.ts` 的 Enter 用例是这条的唯一守门测试，需保留。
- **`Splitter.md` 的 `minSize`「缺省 0」**与 Reka props 注释「defaults to 10」不一致（第二轮遗留）：运行时路径取 `minSize ?? 0`，我按运行时为准，未再深挖。

## 审查自身留下的痕迹

只写了本 Task 的 `walkthroughs/review-final.md` 与 `evidences/probe-final-enter-eager.test.ts`；
运行探针用的临时副本已删除，被审目录 `git status` 无残留。未编辑被审源码、Spec 或其它 Task，未提交、未联网、未占用/重启 3001。
