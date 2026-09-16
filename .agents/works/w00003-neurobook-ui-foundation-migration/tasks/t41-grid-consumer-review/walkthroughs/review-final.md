# t41 追加复核（第二轮）：两轴 grid 与真实消费者

**结论：`建议合并`（可以提交）。** 本 Task 指定的五项（t37 [leader-final-repair](../../t37-grid-geometry/walkthroughs/leader-final-repair.md) 1–5）与消费者接线两项在当前 hash 上闭合，未发现阻断项。
非阻断项 2 条（O1 合同/实现不一致，仅经公开 API 可达、当前产品路径未触发；O3 未写明的越界意图边界）；浏览器与 Product 层证据按 Task 排除项未做（O2）。
复核期间 `WorkbenchBranch.vue` 与消费者测试又各改过一次（收口 Branch 尺寸与补回归），两者都在**最终 hash** 上重新核过（§4.4、§5）。

只读被审源码；未改任何被审文件、未启动产品服务、未访问 3001、未提交、无仓库 `.tmp`、无递归删除。用户 dirty 的 `app/utils/workbench/descriptors{,.test}.ts` 全程未读未改。

## 1. 被审 revision（首尾 hash）

HEAD `7a5d04de` + 当前未提交 t37 改动。首读 12:50、末读 12:58，除下表标注的两项外首尾一致。

| 文件 | 首读 sha1 | 末读 sha1 | 说明 |
|---|---|---|---|
| `packages/nb-ui/src/components/layout/grid.ts` | `e6efd9b8` | `e6efd9b8` | 未变 |
| `packages/nb-ui/src/components/layout/grid-geometry.ts` | `3b77c506` | `3b77c506` | 未变 |
| `packages/nb-ui/src/components/layout/grid-types.ts` | `62a6d514` | `62a6d514` | 未变 |
| `packages/nb-ui/src/components/layout/grid-snapshot.ts` | `6a17e9bd` | `6a17e9bd` | 未变 |
| `packages/nb-ui/src/components/layout/grid.test.ts` | `659d0a88` | `659d0a88` | 未变 |
| `packages/neuro-book/app/utils/workbench/layout.ts` | `1ddf2029` | `1ddf2029` | 未变 |
| `packages/neuro-book/app/components/workbench/WorkbenchShell.vue` | `723d8287` | `723d8287` | 未变 |
| `packages/neuro-book/app/components/workbench/workbench-branch-layout.ts` | `1e59c4d5` | `1e59c4d5` | 未变 |
| `packages/neuro-book/app/components/workbench/WorkbenchBranch.vue` | `a2476a12` | `f2f64c9a` | **12:52:47 收口**（分支根改按 `layout.sizes[node.id]` 取 px），按最终 hash 复核 |
| `.../workbench/workbench-grid-consumers.test.ts` | — | `e3aa6f37` | **12:54:32 新增** `it.each` 分支容器回归，已读并随最终 hash 跑通 |
| `packages/neuro-book/app/components/workbench-spike/layout.ts` | `8d41c5f8` | `8d41c5f8` | 未变 |

结论对**上表末读 hash 集合**成立；此前 hash 上的结论不作数。

## 2. 真实命令与结果

| 命令（cwd） | 结果 |
|---|---|
| `bun run test src/components/layout/grid.test.ts`（`packages/nb-ui`） | exit 0，1 文件 **52 用例**通过 |
| `bun run test app/utils/workbench/layout.test.ts app/components/workbench/workbench-grid-consumers.test.ts app/components/workbench/workbench-branch-layout.test.ts app/components/workbench-spike/layout.test.ts`（`packages/neuro-book`） | 12:51 首跑 exit 0，4 文件 **33 用例**；12:57 最终 hash 上重跑 exit 0，含新增回归共 **38 用例**（另有我的 1 个 DOM 探针文件） |
| `bun run test app/utils/workbench/t41-final-probe.test.ts`（审查者独立探针，纯内存） | exit 0，**9 用例**；完整输出归档 `evidences/probe-final-output.txt` |
| `bun run test app/components/workbench/t41-branch-dom-probe.test.ts`（审查者 jsdom 探针） | exit 0，1 用例 |
| `bun <evidences/leader-grid-invariants.ts>`（worktree 根） | exit 0：10000 组可满足布局通过（两轴、sash 守恒、约束、顺序无关、意图不被 layout 改写） |
| `bun <evidences/leader-grid-gesture-invariants.ts>`（worktree 根） | exit 0：3000 组合法手势在两轴与受限兄弟下完整复现目标 |
| `bun <evidences/t41-out-of-range-intent.ts>`（worktree 根） | exit 0，输出见 §5 O3 |

## 3. 五项逐项结论

### 3.1 `shareAxis` 可满足分配溢出 —— 通过

- 12:30 的确定反例已修复：`a=60/0/50、b=30/80/1000、c=10/0/1000`，可用 100 → 实际 `[17.142857, 80, 2.857143]`，`root=100`，`issues=[]`（`EVIDENCE P1.leader-overflow`）。与最小合计 80 的可满足解一致，无溢出、无虚假降级。
- 4000 组固定种子随机可满足用例（2–5 叶、两轴、sash 0–4、含零权重）：全部在界内、总量精确等于可用空间、无诊断；与**独立参考解**（对 `sum(clamp(λ·w)) = available` 做 λ 二分）逐点一致（`referenceMismatch: 0`），兄弟顺序交换后每个 id 的分配相同（`orderMismatch: 0`）。
- 固定用例：横/纵轴 `[20,70,10]`（sash 3）、零权重纵轴 `[31.333×3]`（sash 5）均守恒。

### 3.2 一次手势原子结算与 active 落账 —— 通过

- `resizeBranch` 同容器精确复现：21 个手势里全部**被接受者呈现误差 0**（`left|editor` ±4/±37/±200、`editor|right` ±4/±37 全部 `diff: 0`）。首轮 F3 的 `editor~right` 现在正确落账。
- 被拒绝的都是**非法目标**：`activity|left`（活动栏 60/60 刚性，目标 ≠60）、越 max（`right` 目标 > 视口上限）、构造出的不守恒目标。拒绝理由原文分别为「手势目标超出当前约束」「手势目标不守恒」。
- Shell 只写 active 侧栏（`EVIDENCE P2.persistence`）：`left` 手势 → `{left:320, right:400}`；`right` 手势 → `{left:340, right:430}` 且呈现 `right=430` 精确；远端补偿（`active=["editor","right"]`、`left` 被动变化）→ `{left:340, right:450}`，被动左栏**没有**被当成偏好；空手势不动 store。
- 组件级：`workbench-grid-consumers.test.ts` 的「受限 viewport 的 editor/right 调整不回弹，也不改写未动左栏的偏好」与 `layout.test.ts` 的「完整手势包含远端补偿时，只保存 active 侧栏的偏好」在最终 hash 上通过。

### 3.3 原子入口的 px ↔ 意图 —— 通过

- 缩放容器（宽 1000，该视口下右栏上限 450）：基线 `{60,340,198,400}`，手势 `editor−30 / right+30` → 呈现**精确等于**目标 `{60,340,168,430}`；意图反解为 `[60,340,168,430]`。以当前呈现做新基线再拖一次（`left+25 / editor−25`）仍精确命中 `365 / 143`（闭环）。
- Shell 产品管线（手势 → `resizeShellBranch` → `recalcShellSizes` → `createShellGrid` → `layout`）：1280 与 1000 两个容器下右栏都保持 store 偏好（430）、左栏不动（340）、editor 精确；900 容器的目标因右栏目标 430 > 该容器上限 405 被拒（reka 会先夹到 405 再提交，属保护网而非阻断）。
- 守卫：no-op（target = baseline）返回 ok 且快照逐字节不变；过期基线、多/少 key、负值、不守恒、错误轴、错误分支、越 max 全部拒绝，且拒绝后快照与失败前完全一致（失败不改树）。
- `resize`（单节点入口）在**意图处于界内**时守恒且不越界：800 组随机用例 `worstNonConserving: 0`、`worstOutOfBounds: 0`。越界意图的边界行为见 §5 O3。

### 3.4 渲染器消费几何、约束与实际 sash —— 通过（最终 hash）

- 分支根元素现在按 `layout.sizes[node.id]` 取 px（`flexShrink: 0`），不再 `h-full w-full`。我的独立 jsdom 探针（两叶 max100 / 容器 500，横纵两向、有/无 sash）读到：`branchStyle = {width: "200px", height: "300px", flexShrink: "0"}`，`panels = 50/50`，`issues` 含「未被任何子节点吸收」——留白真的保留，percent 面板不再被父容器拉满。
- `buildWorkbenchBranchPanels` 只读 `layout.sizes` / `layout.constraints`（有效约束，窄容器下经原语降级后为 50/50，reka 无法把降级尺寸夹回溢出）；`sashSizes` 直接传 `layout.sashSizes`（含被 CSS 隐藏的 0 值与压缩值）。
- sash 记账自洽：8 组隐藏叶组合下 `面板空间 + Σ实际sash == 分支呈现`、面板百分比合计恒为 100（`EVIDENCE P3b.hidden-matrix`）。模型与呈现逐项相等（默认、隐藏 activity/left/right/titlebar 等）。
- 说明：reka 的百分比是「剩余空间的权重」，因此按面板空间（不含 sash）归一与 reka 的像素语义一致；这一层我只做到「消费者传入值与原语呈现自洽」，reka 内部算法仍归 t39。

### 3.5 泛型 ref 的稳定编码 —— 通过

- `encodeRef` 就位：两个**不同对象** ref 往返后仍是原来的对象身份（`left-identity,right-identity`），快照里是稳定字符串。
- 缺 `encodeRef` 时 `serialize()` 显式抛 `TypeError: 节点 x 的 ref 不是稳定字符串；非字符串引用必须提供 encodeRef`，不再塌成 `[object Object]`；字符串 ref 不受影响。
- 快照键集仍只含结构/引用/尺寸（`minimumSize`/`maximumSize` 不出现在序列化里）。

## 4. 首轮问题的当前状态（不复述细节）

| 首轮项 | 状态 | 本轮依据 |
|---|---|---|
| F1 交叉轴 `0` 上限压死整树 | 已修复 | `createShellGrid` 叶/分支非管理轴改不限；`layout.test.ts`「非管理轴共享容器空间，不被零上限压成零」通过；我的 P1/P6 呈现与模型逐项相等 |
| F2 隐藏叶意图被抬回 min | 已修复 | 隐藏叶直接从树与 sash 中移除（`createShellGrid` + `sashSizes`）；`recalcShellSizes` 隐藏组合与呈现一致（P3b） |
| F3 `editor~right` 不落账/回弹 | 已修复 | `resizeBranch` 完整目标入口 + `state.active` 落账（§3.2） |
| F4 验证台测试不在门禁内 | 已修复 | `vitest.config.ts` include 已含 `app/components/workbench-spike/**`；本轮 4 文件 33→38 用例实跑通过 |
| F5 跨窗口写入打断本窗口手势 | 未验证（无 Storage 接线） | `WorkbenchShell` 的 `committedStore` 只挡「自己回写」；跨窗口路径本轮无证据 |

## 5. 观察（非阻断）

**O1｜合同/实现不一致：编辑器叶隐藏时模型、树、呈现三份分叉（中）**

`EVIDENCE P6.hidden-subset-mismatches`：32 个隐藏组合里 12 个（含 `editor` 且 `left` 或 `right` 可见的组合）模型与呈现不一致。以 `hidden=["editor"]` 为例：

```
模型   = {activity:60, left:340, right:400, editor:0}  issue: "编辑器叶不可见：剩余 479px 没有叶吸收"
呈现   = {activity:60, left:560, right:576}            分支呈现 1197 < 容器 1280（留白 83px）
差异   = left +220、right +176
```

成因：模型的固定叶值只写进树的**意图**，而 `shareAxis` 会把未被吸收的余量按意图比例继续分给仍可增长的叶，左右栏的 max（560/576）允许它们吃满余量；`activity` 刚性所以不动。影响：显隐切换时侧栏宽度会跳到各自上限、与外壳自己上报的诊断文案矛盾、与 store 偏好（340/400）暂时不一致（重新显示编辑器即恢复）。
可达性：`setLeafVisible("editor", false)` 是 `WorkbenchShell` 公开 API，但当前 `index.vue` 只 toggle `titlebar` / `left` / `right`（picker 态），故**未进入当前产品路径**。
最小修复方向（t37 owner 文件内二选一）：① `createShellGrid` 在模型留下余量时把固定叶在该轴的上限一并写成模型值，让留白真的保留、诊断成立；② 改写 `distributeShellSizes` 与文案为「余量由固定叶吸收到各自上限」。不要改原语分配规则（那是 Spec 变更）。

**O2｜未验证：浏览器与 Product 层（按 Task 排除项）**
真实 reka 拖动、主页面像素、窄屏 390×844、Product build/typecheck、Chrome smoke 均未做。我的证据层次是：纯内存原语探针 + jsdom 组件挂载 + 代码逐行复演；「所有直接消费者可编译」只到 vitest transform + SFC 挂载通过，**类型层未验证**（`tsc`/`nuxt typecheck` 由 Leader 统一跑）。

**O3｜未写明边界：意图已越界时的 `resize`（低）**
`evidences/t41-out-of-range-intent.ts` 复现（意图 `[64,82,195,121]`、界 `[10-38,3-71,4-219,10-79]`、`resize("n0", -66)`）：`applied: -26`，意图归一到 `[38,71,219,79]`，**总意图 462 → 407**（不再守恒），但呈现前后逐项相等（`{[38,71,219,79]}`，root 407），没有可见回弹。
外壳路径不会出现该状态（`createShellGrid` 建树时按 current limits 夹取），但快照恢复允许携带越界意图（`grid.test.ts`「恢复以当前宿主约束为准：意图保留，呈现夹取」），因此这是原语的合法输入。建议在 `resize` 的文档里补一句「越界意图会被向界内归一，总量可能因此下调」，避免后来者把它当守恒缺陷。

**O4｜风格（低）**
`Grid.serialize()` 以 `TypeError` 抛编码失败，而 `resizeBranch` / `restore` 用 `Result` 返回失败：非对称已由 `GridRefEncoder` 边上的注释说明，暂不需改；只是调用方要记得 `serialize()` 可能抛。

## 6. 复现方式

- 独立探针：`evidences/final-probe.test.ts`（9 用例，纯内存）、`evidences/branch-container-probe.test.ts`（jsdom 分支容器）。跑之前复制回生产目录（原位置已清空）：
  - `cp evidences/final-probe.test.ts packages/neuro-book/app/utils/workbench/` → `bun run test app/utils/workbench/final-probe.test.ts`（cwd `packages/neuro-book`）
  - `cp evidences/branch-container-probe.test.ts packages/neuro-book/app/components/workbench/` → `bun run test app/components/workbench/branch-container-probe.test.ts`
  - 跑完把这两个文件移回 `evidences/`，生产目录不留 scratch（本轮已确认目录干净）。
- 越界意图探针与 Leader 的两个数值探针可从 worktree 根直接 `bun <evidences/...ts>`，只 import nb-ui 源文件。
- 完整探针输出：`evidences/probe-final-output.txt`（含 `EVIDENCE` 行；`P3.same-container`、`P3b.hidden-matrix`、`P6.hidden-subset-mismatches` 的长行需按 `,` 展开阅读）。

## 7. 未运行项与原因

- 全包 `typecheck` / Product build / E2E / Lab smoke / 浏览器验收：Task 明确排除（Leader 并行在跑，避免争用；不占用 3001）。
- 真实用户数据、产品服务、远端操作：未做（Task 排除）。
- `descriptors{,.test}.ts`：完全排除，未读未改。
