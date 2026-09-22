# t39 追加独立审查：Splitter 手势补修后的当前 revision

结论：**需要修复**。

首轮（[review.md](review.md)，D1–D6）的补修方向正确，D1–D6 中 5 条已闭合、1 条闭合但引入新的过宽触发；
本轮新发现 1 条实现缺陷（禁用/零尺寸 sash 仍走 Reka 内置 Enter 路径，改几何且不发 `layout`）、
1 条手势被宿主无关重渲染误取消、以及测试有效性与报告准确性问题。
窄屏与四主题的真实浏览器证据按 Task 边界仍归 t38，本报告只区分「已实测」「从源码推断」「未验证」。

## 所审版本

HEAD `70c7168d2913cb3bf69174e8e6721d548174c6e0`；下表 sha256 在审查开始与结束各取一次，**完全一致**，
即审查期间被审集没有变化。全部为未提交的工作区改动。

| 文件 | sha256（前 24 位） |
|---|---|
| `packages/nb-ui/src/components/layout/Splitter.vue` | `cd2e4fba90637b20c9249b35` |
| `packages/nb-ui/src/components/layout/splitter-gesture.ts`（新） | `98f46663fad792ac32781855` |
| `packages/nb-ui/src/components/layout/splitter.test.ts`（新） | `5120ee2835d7d2913f1242c9` |
| `packages/nb-ui/src/components/layout/splitter-gesture.test.ts`（新） | `c065adce0250e78e58fe8b9f` |
| `packages/nb-ui/src/components/layout/Splitter.md`（新） | `72cb3c4fecdda1f468b0fabe` |
| `packages/nb-ui/e2e/splitter.spec.ts`（新） | `64ebf90e6bdb0ec11c2880b6` |
| `packages/nb-ui/playground/app/component-lab/fixtures/SplitterFixture.vue` | `5701a223ca393935251f2136` |
| `packages/nb-ui/playground/app/assets/css/lab.css` | `f7a8d874e83b96e9f6a5001c` |
| `packages/nb-ui/src/components/index.ts` | `baf6be1508d77035905139b5` |
| `packages/nb-ui/playground/app/component-lab/registry.ts` | `8f043ce5bc4e59e656e90acf` |
| `packages/nb-ui/playwright.config.ts` | `d581ae6bfbc6f97ed78f152b` |
| `packages/nb-ui/docs/ui-development-spec.md` | `bf651d2e034a9595f0e3500a` |

被审文件 mtime：`Splitter.vue` 11:52:54、`splitter.test.ts` 11:54:37、`e2e/splitter.spec.ts` 11:57:39、
`lab.css` 11:53:16、t38 的 `implementation.md` 11:58:35。t38 仍在跑浏览器验收，未完成的证据见下。

## 已执行命令与结果

全部在 worktree 绝对 cwd 下执行，未触碰 3001。

```bash
# 1. 聚焦用例（当前产物）
bun run --cwd packages/nb-ui vitest run src/components/layout/splitter.test.ts src/components/layout/splitter-gesture.test.ts
# Test Files 2 passed (2) / Tests 30 passed (30) / 2.05s

# 2. 本轮探针（先复制到 packages/nb-ui/src/components/layout/ 再跑，跑完删除）
bun run --cwd packages/nb-ui vitest run src/components/layout/probe-eager-context-cancel.test.ts \
  src/components/layout/probe-disabled-enter.test.ts src/components/layout/probe-key-sequences.test.ts --disable-console-intercept
# Test Files 3 passed (3) / Tests 8 passed (8)；关键输出见各缺陷条目
bun run --cwd packages/nb-ui vitest run src/components/layout/probe-eager-context-cancel.test.ts --disable-console-intercept
# P1 inline-array cancel [{"source":"pointer","sash":"outline~editor","reason":"context-changed"}] end undefined
# P1b stable-array cancel undefined end [{"source":"pointer","sash":"outline~editor","active":["outline","editor"],"compensated":[],"sizes":[35,45,20]}]
bun run --cwd packages/nb-ui vitest run src/components/layout/probe-enter-noncancelable.test.ts --disable-console-intercept
# P9 layout +1 | end payload [0,80,20] | dom ["0.0","80.0","20.0"]
```

探针存档在 `evidences/probe-eager-context-cancel.test.ts`、`evidences/probe-disabled-enter.test.ts`、
`evidences/probe-key-sequences.test.ts`、`evidences/probe-enter-noncancelable.test.ts`；
被审目录里的副本已删除，`git status -- packages/nb-ui/src/components/layout` 只剩 t37/t38 的既有条目。

## 首轮 D1–D6 复核

| 项 | 状态 | 依据 |
|---|---|---|
| D1 pointercancel 未复位上游 | 已闭合 | `Splitter.vue:117` `cancelPointerGesture` 补发 `MouseEvent("mouseup")`；Reka `registry.js` 的 `handlePointerUp` 会 `isPointerDown=false` 并重新挂 `mousedown`。探针 P1 之外，正式用例「pointercancel 同时复位上游拖动状态」断言取消后无按键移动不改布局、下一次拖动可用 |
| D2 约束变化并入提交 | 闭合但触发过宽 | `Splitter.vue:196` 约束 watcher 以 `context-changed` 取消，用例「手势中约束变化先取消」通过；但见 F2 |
| D3 指针手势吞掉键盘调整 | 已闭合 | `Splitter.vue:170` 键盘开始前先取消指针手势；`blur` 对键盘 `end()`、对指针 `cancel("blur")`；用例「窗口失焦取消指针手势，下一次键盘调整独立提交」 |
| D4 Enter 折叠不发 layout | 已闭合（主路径） | 改用 Panel 公开 `collapse`/`expand`，折叠会经 `emits("layout")` 发布；探针 P4（可取消事件）`layout +1`。禁用/零尺寸路径回归见 F1 |
| D5 DOM 全局身份 | 已闭合 | `useId()` 命名空间；用例「同页实例的 DOM id 与 aria-controls 唯一」 |
| D6 用例卫生 | 已闭合 | `afterEach` 全部 `unmount()`（`splitter.test.ts:103` 之后的 afterEach） |

门禁第 3 条（类型边界）**通过**：`Splitter.vue:76` 用 `Pick<InstanceType<typeof SplitterPanel>, "collapse" | "expand">`，
`reka-ui/dist/index4.d.ts` 的 `__VLS_export$74` 公开实例确实带 `collapse(): void` / `expand(): void`，
无 `as unknown as`、无私有状态改写。

## 缺陷

### F1（高）禁用或零像素 sash 仍走 Reka 组级 Enter 路径：改几何、不发 `layout`、不发手势

现象：`disabled` 的 Splitter（sash 仍 `tabindex="0"`，Tab 可达）与 `sashSizes[i] === 0` 的边界上按 `Enter`，
面板照常折叠，但 **`layout` 事件为 0、四个手势事件为 0**。

证据（`evidences/probe-disabled-enter.test.ts`，事件为可取消的真实形态）：

```
P2 disabled tabindex 0 data-disabled true
P2 sizes before ["28.0","52.0","20.0"] after ["0.0","80.0","20.0"]
P2 layout delta 0
P2 gesture start 0 update 0 end 0 cancel 0
P3 zero tabindex -1 data-disabled true
P3 sizes before ["28.0","52.0","20.0"] after ["0.0","80.0","20.0"]
P3 layout delta 0
```

根因：`Splitter.vue:166` 的守卫 `if (props.disabled || sashSizes.value[index] === 0 || !ADJUST_KEYS.has(event.key)) return;`
在 `Enter` 的 `preventDefault()`（`:168`）**之前**返回，于是本组件不拦截；
而 Reka 的组级 Enter 监听（`composables/useWindowSplitterPanelGroupBehavior.js`，挂在同一手柄元素上）只检查 `event.defaultPrevented`，
不看 `disabled`，其 `Enter` 分支只 `setLayout(nextLayout)`，**不 `emits("layout")`、也不更新 eager layout**——
正是首轮 D4 那条旧路径。`getPanelStyle` 读 `layout.value`，所以 DOM 几何变了、宿主拿到的 `layout` 不变。

影响：宿主（Workbench/后续 Storage）按 `layout`/`gesture-end` 记账，屏幕与账本静默脱节；
`Splitter.md:33`「`disabled` 时 sash 不接受指针与键盘调整，也不产生任何手势事件」与
[t38 README](../../t38-splitter-gestures/README.md)「三、程序 mount/layout…不能发用户提交」在字面上被违反。
`ui.nested-grid` 验收 4「主动提交次数和字段符合合同」也无法解释这条既非程序、又非手势的几何变化。

来源说明：`collapsible` 与 `disabled` 在 HEAD 基线就已同时存在（`git show HEAD:...Splitter.vue`），
这条上游路径不是 t38 引入的，但 t38 在本轮把 Enter 纳入合同、并声称禁用不产生键盘调整，因此当前 revision 需按合同收口。

最小修复方向：把 `Enter` 的 `preventDefault`（即对上游 Enter 路径的截断）提到 `disabled`/`sashSizes === 0` 守卫之前，
只让「执行折叠」这一步受 `disabled` 约束；`sashSizes === 0` 同理应保持不可交互语义。
需要时把该组合补进组件用例（禁用/零 sash + Enter 断言 `layout` 计数与 `data-panel-size` 不变）。

### F2（中）宿主等值重渲染即取消进行中的手势，并连带拆掉 Reka 的拖动会话

现象：宿主在一次指针拖动中间重新渲染，只要 `panels` 数组是新身份（模板内联字面量、
或 `panels.value = buildPanels()` 这类重建），**即使每个字段的值完全相同**，本组件也判为 `context-changed` 取消手势。

证据（`evidences/probe-eager-context-cancel.test.ts`）：

```
P1  inline-array cancel [{"source":"pointer","sash":"outline~editor","reason":"context-changed"}] end undefined
P1b stable-array cancel undefined end [{"source":"pointer","sash":"outline~editor","active":["outline","editor"],"compensated":[],"sizes":[35,45,20]}]
```

根因：`Splitter.vue:55,196` 的 `panelConstraintsKey` 是一个每次求值都返回**新数组**的 getter，配 `{deep: true}` 监听；
Vue 在 getter 源 + `deep` 下只要依赖触发就无条件回调，而 `props.panels` 换身份就会触发。
对照 `panelIdsKey`（`:54`，字符串比较）只按值变化取消，两条路径的判定标准不一致。

影响：取消指针手势还会同步 `dispatchEvent(new MouseEvent("mouseup"))`（`Splitter.vue:117-121`）——
用户仍按着鼠标，拖动却已静默终止，屏幕几何停在半途；这是「宿主越无辜、后果越明显」的陷阱，
`Splitter.md:143` 承诺的触发条件是「宿主如果改了 `panels` 的身份或约束」，但按下述写法宿主什么也没改。
当前 `WorkbenchBranch.vue` 传的是 `ref`（身份稳定），只在 `resyncSplitter()` 时变化，所以尚未在产品里显形；
一旦宿主改成内联数组或在无关状态上重建该数组就会命中。

最小修复方向：像 `panelIdsKey` 一样把约束序列化成值键
（例如 `JSON.stringify(props.panels.map((panel) => [panel.defaultSize, panel.minSize, panel.maxSize, panel.collapsible, panel.collapsedSize]))`）
再比较，只有值真的变化才取消；现有「手势中约束变化先取消」用例可继续守住真变化路径。

### F3（中，测试有效性）Enter 拦截依赖 `preventDefault`，组件用例的事件形态让这条机制无法被检验

`splitter.test.ts` 的 `pressAdjustKey` 用 `new KeyboardEvent(type, {key, bubbles: true})`，**未设 `cancelable: true`**，
`preventDefault()` 因此是空操作，Reka 的组级 Enter 监听拿到 `defaultPrevented === false`，会继续执行自己的旧路径。
实测两种形态（同一条 `handle.collapse()` 拦截代码，只有事件可取消位不同）：

```
（组件用例的事件形态，不可取消，2 次 keydown + keyup）
P9 layout +1 | end payload [0,80,20] | dom ["0.0","80.0","20.0"]      ← 本用例的断言面恰好自洽

（不可取消，3 次 keydown + keyup）
P4 dom after kd1 ["0.0","80.0","20.0"] layout +1
P4 dom after kd2 ["18.0","62.0","20.0"] layout +1   ← Reka 旧路径确实执行了：DOM 变了但不发 layout
P4 dom after kd3 ["18.0","62.0","20.0"] layout +1
P4 enter-repeat | layout +1 | sizes ["18.0","62.0","20.0"] | … | end 1   ← 提交载荷与 DOM 不一致

（可取消，同序列）
P4 dom after kd1/kd2/kd3 ["0.0","80.0","20.0"] layout +1 → 一次折叠、一次提交
```

即：真实浏览器里 `keydown` 可取消，`preventDefault` 能拦住上游（可取消形态实测正确）；
但组件用例用的不可取消事件让**拦截失效与拦截生效产生同样的 `layout` 计数与提交载荷**，用例无法判别，
而不可取消形态下实测确实能出现「DOM 与提交尺寸脱节」——正是门禁第 4 条要排除的现象。
`e2e/splitter.spec.ts` 里也没有任何 `Enter` 用例（4 条基础用例 + 4 条主题组合，键盘只有 `Tab` 与 `ArrowRight`），
所以「Vue 的手柄监听先于 Reka 同元素监听」这个只在真实浏览器里成立的前提，目前没有端到端证据。

最小修复方向：组件用例改用 `cancelable: true` 的键盘事件，并把断言落到 DOM 几何（`data-panel-size`）与 `layout` 计数一致上；
浏览器侧补一条 Enter 折叠用例（断言 `layout` 计数、`data-panel-size` 与提交载荷三者一致）。

### F4（中，报告准确性）t38 报告与工作区不一致

- `implementation.md` 写「CSS 未变化」，但 `lab.css` 已改（`min-width: 0`、`grid-template-columns: minmax(0, 1fr)`、
  `.lab-canvas`/`.lab-canvas-window` 的 `min-width: 0`），mtime 11:53:16 **早于**报告写入时间 11:58:35。
  [门禁](../t38-splitter-gestures/walkthroughs/leader-final-gates.md)明确要求 CSS 若变化必须如实报告，
  由 Leader 负责两次构建的确定性核对。
- 报告写「2 files passed，28 tests」，当前实际为 **30**；报告写浏览器「4 passed」，当前 `e2e/splitter.spec.ts` 是 **8** 条
  （4 条基础 + 4 条主题组合）。报告早于最后一次编辑，属过时而非伪造，但读者会据此低估覆盖面。

最小修复方向：t38 在最终报告里按当前产物更正用例数、CSS 变化与浏览器实跑范围。

### F5（低，文档）`Splitter.md:19` 的命中热区宽度写错

「命中热区通过伪元素向两侧各扩 10px」：实际是 `after:w-2.5`（10px 宽）以 `left-1/2 -translate-x-1/2` 居中，
即**每侧约 5px**；Reka 自身的细指针余量也是 5px（`SplitterResizeHandle` 的 `hitAreaMargins.fine = 5`）。
`ui-development-spec.md` 的「扩大命中热区（10px）」按总量表述是对的，组件文档按「各扩」表述偏差 2 倍。

### F6（低，文档）窗口失焦在「取消」一节的表述与实现不符

`Splitter.md:30` 把「窗口失焦」列为「结束手势且**不产生保存意图**」，但实现里失焦只对指针手势 `cancel("blur")`，
键盘手势走 `tracker.end()`（有变化即提交），这是 Spec「释放按键或失焦结束当前操作」的正确读法；
`Splitter.md:145` 与用例「窗口失焦取消指针手势，下一次键盘调整独立提交」也印证实现是对的。
现在同一份文档的「交互」第二节与「取消」一节给出相反预期，需要补「（键盘手势按正常结束收口）」之类的限定。

## 未验证项与风险

- **零像素 sash 仍保留 10px 透明命中带（未验证，需浏览器）**：手柄在 `sashSizes[i] === 0` 时仍渲染，
  伪元素 `after:w-2.5` 未被 `pointer-events: none` 关闭，class 列表里也没有 `pointer-events-none`；
  因此边界两侧约 5px 的命中会落在该手柄（而非下面的面板内容）上。
  机制来自源码与 class 列表，命中后果我无法在 happy-dom 中测量。
  最小核对方式：浏览器中对该边界 `document.elementFromPoint(boundaryX, y)`，确认返回的是面板内容而不是手柄；
  若确实被手柄吞掉，与文档「零值…不可交互」相矛盾。
- **视口重算不被当提交（从源码推断）**：Reka 只在 `hasPixelSizedPanel` 时因容器尺寸变化重算并发布 `layout`
  （`SplitterGroup.js` 的 `watch(groupSizeInPixels)`），本组件只暴露百分比面板，故窗口 resize 期间不产生新的 `layout`，
  也就不会并入提交。未在真实浏览器中跑「手势中缩放窗口」。
- **`sashSizes` 在手势中变化**：会改变真实像素几何但不改变百分比，`layout` 未必重发；本次未构造用例，
  也没有证据表明它会被当作用户提交。属未验证边界。
- **`Splitter.md` 的 `minSize` 「缺省 0」**与 Reka 的 props 注释「defaults to 10」不一致；运行时路径
  （`calculateAriaValues`、`adjustLayoutByDelta`）取 `minSize ?? 0`，我按运行时为准，未做进一步验证。

## 通过项（已核对，不阻断）

- 真实 Reka + 真实 DOM 事件：`splitter.test.ts` 只桩 `getBoundingClientRect`，命中判定、delta、布局分配仍走 Reka。
- 一次指针操作一次提交、`gesture-start` 与 `end|cancel` 配对；空操作 `no-change`、浮点噪声不提交。
- 触界时远端兄弟进 `compensated`、未变化候选不冒充 `active`。
- `Escape` 取消后 Reka 继续派发的 move/mouseup 不能再提交（探针 P7：`end 0`，`cancel escape`，DOM 仍在变）。
- 零像素 sash 不破坏相邻边界解析：第二个 sash 仍提交 `editor~inspector`（探针 P8）。
- `Enter` repeat 在可取消事件下只折叠一次、只发一次 `layout`（探针 P4）；`Enter → Arrow` 的多键序列一次手势两次更新、一次提交（探针 P6）。
- 面板身份/方向/禁用变化、`panels` 置空、卸载均取消；全局监听按实例在结束/取消/卸载时解绑，有簿记用例。
- DOM id 与 `aria-controls` 跨实例唯一，手势仍用宿主语义 id；`sashSizes` 缺失项回退 1px、非法值诊断、
  尾项忽略、零值退出 Tab 顺序（`tabindex="-1"` + `data-disabled`）。
- `layout` 与 `gesture-*` 两层语义在文档、fixture、registry 事件清单与 barrel 类型导出之间一致；
  `ui.nested-grid` 仍为 `planned`，未被顺带晋升。
- 门禁第 3 条类型边界：无双重断言，用 Reka 公开实例类型窄化（见上）。

## 未运行项

- 浏览器验收（`e2e/splitter.spec.ts` 的 8 条、`390×844` 真实宽度、四主题组合、`playwright.config.ts` 宿主）：
  按 Task 边界交给正在跑的 t38，我未运行；因此 F1/F3 在真实浏览器里的可见程度只有推理与 happy-dom 证据，
  窄屏「被测 target 宽度受容器约束」这一门禁断言我只能核对断言写法（`targetBox.width <= canvasBox.width && < 390`，
  该写法确实能拦住 850px 回归），没有实跑。
- nb-ui 全包测试 / typecheck / build：按 Task 边界不跑（t37 并行改 `grid.ts`/`grid-geometry.ts`）。
- F1/F2 的最小修复方向只给了思路与证据，未在代码上验证可行性；F1 的修复会改动 `onHandleKeydown` 的守卫顺序，
  需按其现有用例重跑。

## 审查自身留下的痕迹

只写了本 Task 的 `walkthroughs/review-followup.md` 与 `evidences/probe-*.test.ts`（本轮新增 4 个探针，
每个探针顶部注释写明了复制/运行/删除步骤；首轮 6 个探针保持原样）。为运行探针曾在
`packages/nb-ui/src/components/layout/` 临时复制 4 个文件，已用 `rm -f` 删除，
`git status` 确认该目录除 t37/t38 的既有条目外无残留。
未编辑被审源码、Spec 或其它 Task，未提交、未联网、未占用/重启 3001，未创建仓库内临时目录。

## 给 Leader 的下一步

1. F1 需要一条实现裁定：把 Enter 的截断提到禁用/零尺寸守卫之前（我倾向这条，成本小且与文档一致），
   或在文档与 `ui-development-spec.md` 里如实声明「禁用/零尺寸 sash 的 Enter 仍会折叠面板且不发 `layout`」。
   后者会把「尺寸与 geometry 一致」的假设留给宿主，与 t40/Storage 记账方式直接冲突，不建议。
2. F2 建议与 F1 同批修（都在同一段 watch/守卫里），并把约束键改成值比较，避免宿主每次重渲染都踩到。
3. F3 与 F4 是证据问题：Enter 的真实浏览器用例（含 repeat 与多键序列）与报告更正应在 t38 收口时补齐，
   否则门禁第 4 条只有能自证的用例；F2 修复后建议在浏览器里补「拖动中宿主重渲染不断手势」的一条。
