# 检查点 A 独立审查：grid 持久化宿主（t44）

- 状态：**审查完成（只读）**。未修改产品代码与任何测试，未提交、未 push、未联网、未访问/占用 `http://localhost:3001/`，未触碰用户 dirty 的 `descriptors{,.test}.ts`。
- 裁定：**需修复**。1 项 P2（结果分类收口：重放/核对路径在主动字段"没有落点"时误报 `saved` 并清除未确认意图）；另 1 项 P3、若干非阻断观察。修复面很小（`rereadAfterFailure` 一处分支），不涉及任何公共类型或签名变化。
- 与作者报告的关系：作者的 17 条用例与场景覆盖**经复跑核对属实**（exit 0 / 17 passed），但其中"未确认结果分类"的覆盖没有触及下述 P2 分支；本审查的结论均附独立探针，不复述作者结论。

---

## 0. 范围与方法

**被审对象（t44 新增，均在 HEAD `5fcdf8b8` 提交内新增）**

- `packages/neuro-book/app/utils/workbench/storage-grid-host.ts`（974 行）
- `packages/neuro-book/app/utils/workbench/storage-grid-host.test.ts`（891 行，17 用例）

**边界与依据（只读）**

- `app/utils/workbench/storage-context.ts`（t40 facade、句柄借用与失效）、`storage-plugin-sample.ts`
- `app/utils/storage/owner-handle.ts`（终止码集合、owner/scope 守卫、订阅通知）、`value-transport.ts`（`StorageAdapterError`）
- `shared/storage/{contract,definition,projection}.ts`
- nb-ui 原语：`grid.ts`（`restore` / `resizeBranch`）、`grid-snapshot.ts`（`parseSnapshot`）、`grid-types.ts`（`GridSnapshot`）
- `app/components/workbench/workbench-branch-layout.ts`（`workbenchBranchGesture` 百分比→px 唯一口径）

**规范**

- `docs/specs/storage/persistence.md`：114（冲突重读只重放本次主动字段；再次冲突保留当前显示与未保存意图、提供重试/放弃；**重新拖动是新的明确意图**）、115-117、130-131（I/O 失败不得视为缺失）、144（当前值与意图相同可视为目标已满足，**不据此伪造历史请求的成功回执**）
- `docs/specs/ui/nested-grid.md`：39、49、63、80（未知部分保留、不半更新）

**方法**

1. 通读实现与测试全文（含公开类型注释）。
2. 通读上列边界与规范相关段落，核对"是否第二套口径"。
3. 在 worktree 内 `packages/neuro-book` 绝对 cwd 复跑 t44 聚焦测试（未改测试）。
4. 另写 5 个对抗性探针（真实 owner adapter + 注入传输，脚本化读取/提交序列），落在本 Task 目录 `walkthroughs/probes/`，不触碰产品目录；探针用于复现或**排除**数据边界风险。

---

## 1. 命令与退出码（cwd 均为本 worktree 的 `packages/neuro-book` 绝对路径）

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `bun run test app/utils/workbench/storage-grid-host.test.ts` | **0** | `Test Files 1 passed (1)` / `Tests 17 passed (17)` / `Duration 5.46s`（前一次复跑 4.96s） |
| 2 | `bunx vitest run --config ../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t46-checkpoint-a-review/walkthroughs/probes/vitest.probe.config.ts` | **0** | `Test Files 5 passed (5)` / `Tests 10 passed (10)` / `Duration 9.60s` |

- 命令 1 与作者声称一致（17 条用例，exit 0）。作者报告中的 scoped `vue-tsc` **未复跑**：本任务不要求全包/类型门禁，且该结论只涉及与本 Task 无关的文件；留作 Leader 门禁（见"未验证项"）。
- 命令 2 的配置 `vitest.probe.config.ts` 是本审查新增的临时配置（root 指向 worktree 根，alias 与产品配置同口径），只为让探针可被收集；不改动产品 `vitest.config.ts`。

---

## 2. 所审文件 SHA256 与 git revision

- worktree：`C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.worktree/w00003-neurobook-ui-foundation-migration`
- 分支：`refactor/w00003-nb-ui-adoption`
- revision：`5fcdf8b89cd311ac0b87479e905dcec7682596c0`（`feat(storage): persist grid layouts with original-record composition`）；被审两个文件在该提交中**新增**（`git show --stat 5fcdf8b8` 显示 974/891 行新增）。审查期间工作树对被审文件无未提交改动。

| 文件 | SHA256 |
|---|---|
| `packages/neuro-book/app/utils/workbench/storage-grid-host.ts` | `426b0b245f7dc17d2a32b56d96d4f35787285b5989cbe26fcac657598a8c703a` |
| `packages/neuro-book/app/utils/workbench/storage-grid-host.test.ts` | `8fe927803710f0a35b58a3a8014ff60bdfe9c019012f7b4cdd298a6a3fe86b63` |
| `packages/neuro-book/app/utils/workbench/storage-context.ts` | `bea8a5e2fbc9bef123ae6a41754449a46d9ab835dfb4c643834f0dd1a55e7b8a` |
| `packages/neuro-book/app/utils/workbench/storage-plugin-sample.ts` | `de242a75a7e6f0159ab6f99d33df8db84db282294baedfd1a8cb848ac3947040` |
| `packages/neuro-book/app/utils/storage/owner-handle.ts` | `59899c6526084c2c69a4540453c0b40eaf1fe0a0519f453b8143dc1bedb09bae` |
| `packages/neuro-book/app/components/workbench/workbench-branch-layout.ts` | `337073aef09123cd4aadb2af257ec779e8fd9c2d8659e9465f2140bcd61203d9` |
| `packages/neuro-book/shared/storage/projection.ts` | `e4acc0df73789191b1781803ac2b16b4589086707f8e9b1665e039c5054171d4` |
| `packages/neuro-book/shared/storage/definition.ts` | `f361827684d7cfc694c010d285f537e521fc365f17ba0daef1cce960d282d7e3` |
| `packages/nb-ui/src/components/layout/grid.ts` | `88287014d00749141fd1b097988fe13892fd5c95ba05de75d98680215b9883de` |
| `packages/nb-ui/src/components/layout/grid-snapshot.ts` | `347ac992322a1468ced7dc035f7b468dc843139b0834be28428731aac9feab1b` |

> 注：前 4 行是被审对象与其直接边界（验收对象）；后 5 行是复核用参照文件。所有值均由本次审查在同一 worktree 内 `sha256sum` 直接生成。

---

## 3. 逐条结论（Task README「必须回答的问题」1–7）

### Q1 公共类型与边界 —— **通过**（2 处非阻断观察）

**结论**：`defineGridLayoutState` / `createGridLayoutHost` / `composeGridLayoutRecord` 三个入口与 `GridLayoutHost` 的返回类型足以支撑主工作台直接复用：记录格式（`{version, root}` + 任意未知字段）、寻址（`resource`）、字段级意图（`GridLayoutField` = 节点 id + 轴 + 意图值，注释明确"不是呈现 px"）、诊断（`issues` + `blocked` + `GridLayoutCommitResult` 四态）齐备；`state.projection` 复用共享投影词汇，未造第二套状态口径。

**证据**：
- 依赖面（`storage-grid-host.ts:23-50`）：只依赖 `@notnotype/nb-ui/components`、`workbench-branch-layout`、`value-transport`、`storage-context`（type-only）、`shared/storage/*`。对 `storage-grid-host.ts` / `storage-context.ts` / `workbench-branch-layout.ts` 检索 `vue|pinia|node:fs` **零命中** → 无框架/文件系统依赖。
- 手势换算复用产品唯一 helper：`storage-grid-host.ts:822` 调用 `workbenchBranchGesture`（`workbench-branch-layout.ts:37-66`，`WorkbenchBranch` 消费的同一函数），未新增第二套百分比→px。
- 状态投影复用 `projectStorageState`（`shared/storage/projection.ts`），`applyRead` 首行即 `projection = projectStorageState(definition, snapshot)`（`storage-grid-host.ts:458`）。
- 记录格式放宽校验：`isGridLayoutRecord`（`:100-119`）只要求 `version` 为安全正整数、`root` 为非数组对象，未知字段与 v1/高版本放行，交由读取分类处理——与"旧客户端读到不支持格式时禁止覆盖"的合同一致。

**非阻断观察 1a**：`TERMINAL_STORAGE_CODES`（`:306-314`）自注释"与 `owner-handle.ts` 的 `TERMINAL_STORAGE_CODES` 同一集合"，但 `owner-handle.ts:36-42` 的同名集合只有 5 个码（无 `STORAGE_SCHEMA_MISMATCH`），宿主的集合有 6 个。行为上两者等价（`owner-handle.ts:465-466` 的 `isTerminalFailure = isAccessFailure || code === "STORAGE_SCHEMA_MISMATCH"`），因此这不是行为缺陷，而是"注释与集合不符 + 私有集合被复制"，存在后续漂移风险（owner-handle 新增终止码时宿主不会跟随）。
**非阻断观察 1b**：`isContextUnavailable`（`:966-975`）是 `storage-context.ts:readUnavailableFailure` 形状检查的第二份实现；`storage-context` 未导出该谓词。当前用于识别 facade 抛出的标记对象，属边界合同复制。

**探针**：不需要（静态可判）。命令 1、2 通过；`grep` 结果见上。

### Q2 身份与寻址 —— **通过**

**结论**：resource 满足共享 action 合同；`records: "single" | "identified"` 无歧义（构造期强校验）；同名叶/同 owner 多资源不会串记录；Project scope 由句柄来源与适配器双重保证，不存在从残留 projectRoot 或 user scope 兜底写入的路径。

**证据**：
- 构造期守卫（`:338-353`）：`handle.owner !== definition.owner` → `TypeError`；`identified` 缺 `resource` → `TypeError`；`single` 带 `resource` → `TypeError`；`resource` 非 `isSafeStorageIdentifier` → `TypeError`（与服务端同一预检，`shared/storage/definition.ts`）。**探针 D1 逐条复现**（`TypeError` 全部抛出，含 `schemaVersion` 不符时拒绝使用该定义）。
- 寻址由 `resource` 分区：`owner-handle.ts:424-426` 的 `recordKey = key + "\0" + (resource ?? "")`，两 resource 落不同记录键。作者用例「两个 resource 记录独立：同名叶不串记录」覆盖；本审查未反驳。
- scope 归属：宿主不自取句柄，句柄由工作台上下文给出；`owner-handle.ts:137-152` 在本地提前拒绝 `definition.scope !== session.scope`（`STORAGE_CONTEXT_INVALID`，属终止码）→ 即使用户把 user 句柄交给 project 定义，也不可能静默写进错误分区。Project 句柄只能来自 `WorkbenchProjectStorageContext.owner()`，而该 facade 在 `currentUnavailable()`（`storage-context.ts:206-210`：`!accepting` / `project !== mutable` / `!access.accepting`）时抛 `unavailable`，因此"只经有效 ready 取得句柄、不因残留 projectRoot 兜底"由上下文层保证，宿主侧以 `isContextUnavailable` → `invalidate` 收口。
- 同名叶跨网格：记录以 resource 隔离，presentation 隔离在各自 grid 实例；探针 D1 与作者用例一致。

**探针**：探针 D（守卫）；命令 2 中为 `lifecycle-and-guards.probe.test.ts` 的首个用例。

### Q3 生命周期 —— **通过**（1 项 P3）

**结论**：`release()` 先停接纳、再等在途；失效/换代后旧引用拒绝新写且不向失效句柄补写；工作台上下文释放与宿主释放责任划分清晰（宿主不持有 `release`，`WorkbenchStorageOwnerHandle = Omit<StorageOwnerHandle, "release">`），无双释放。

**证据**：
- `release()`（`:935-962`）：先 `phase = "released"; accepting = false; gesture = null; clearPending()`，再关闭自身订阅，然后 `await Promise.allSettled(在途)`；以 `releasePromise ??=` 幂等。**探针 D2**：二次 `release()` 不抛错；释放后 `gestureStart` / `gestureEnd` / `retry()` 全部拒绝，写次数 0，`pending` 为空。
- 失效后不补写：`invalidate`（`:541-552`）置 `phase="invalidated"`, `accepting=false`, `writable=false`, `credential=null` 并停订阅；作者用例「上下文失效后不向失效句柄补写」断言 `attempts` 为 0。本审查复核其判据链：facade 在上下文释放后抛 `storageContextUnavailable` → `classifyFailure` 判 `terminal`（`:508-515`）→ `invalidate` + `keepPending(..., autoReplayed=false)`，`pending.retryable` 由 `phase === "ready" && accepting && writable && credential !== null` 计算（`:426`）→ false。
- 在途排空：作者用例用闸门 Promise 断言 `release()` 未在提交收口前 resolve，且 `attempts` 仅 1 次；代码路径 `track()`（`:414-419`）把读写提交登记进 `inFlight`。

**P3 缺陷**：`release()` 之后再调用从未 `open()` 过的宿主，`open()` **仍会发起一次读取**（`open()` :773-778 → `runOpen` :686-690 在 `track(handle.read(...))` 之后才检查 `accepting`）。**探针 D3 复现**（读取计数 0 → +1）。影响面：只读、不建订阅、不写盘；若句柄已失效则走 `invalidate`（无写）。与"先停止接纳新提交"的口径不完全一致，属可修的小口子。

### Q4 原件合成（重要数据边界） —— **通过**

**结论**：未知顶层字段、节点级未知字段、未知引用叶（含位置与顺序）、未知嵌套分支子树在保存后逐项保留；**不存在任何用过滤后 `serialize()` 覆盖原件的路径**（全文件检索 `serialize(` 零命中）；`applied`/`skipped` 分类可解释，未变化字段既不算 applied 也不算 skipped（不是丢失）。

**证据**：
- 合成以读取时保留的原件为骨架：`composeGridLayoutRecord`（`:136-158`）`{...base, root}` 保留顶层未知字段；`composeNode`（`:160-188`）`{...node, size}` 保留节点级未知字段、只改 `fields` 命中的 `size[axis]`、`children.map` 保序；`byId` 只索引传入字段，未命中的节点原样递归。
- 保存底本只有两个来源：`baselineRecord`（读取保留的原件）与 `definition.defaultValue`（记录缺失/删除时的登记默认树，`:678`、`:904`）。**没有** `grid.serialize()` 参与保存。
- **探针 A（关键排除项）**：`originals-preservation.probe.test.ts`
  - A1 纯合成：基记录含顶层 `note`/`meta`、分支未知字段 `teamNote`、嵌套分支 `dock`（未知字段 `extra`）内含未知引用叶 `plugin`、已知叶未知字段 `flavor`；合成 `outline.width=360` + `console.height=520` 后逐项断言：`applied` 恰为两项、`skipped` 为空、顶层/节点级未知字段与 `dock.children` 顺序（`["console","plugin"]`）原样、`plugin` 尺寸未动、原件未被就地改写。
  - A2 真实保存路径：呈现树 `serialize()` **不含** `plugin` / `top-unknown` / `flavor`（证明呈现已被过滤），而写盘载荷 `JSON.stringify` 含 `plugin`、`flavor`、`branch-unknown`、`extra`，且 `dock` 子节点顺序与尺寸保留 → 直接排除"过滤后 serialize() 覆盖原件"。
  - A3 冲突重放：外来窗口的记录结构与本次基线不同（多出未知叶 `inbox` 与 `foreignMark`、`note` 不同），重放后写盘载荷**保留** `foreignMark`/`note`/`inbox` 与 `plugin`，且 `outline` 被写成 360 → 合成以**重读后的新基线**为底本，不覆盖外来未知部分。
- `skipped` 语义：`composeNode` 用 `placed`/`invalid` 两集合区分"无落点"与"值非法"（`:174-186`），`composeGridLayoutRecord` 末尾按 `invalid.has(field)` 归类 `invalid-value`，否则 `unknown-node`；`reportSkips`（`:575-583`）逐条进 `issues`，不静默丢弃。

**探针**：A1/A2/A3（3 条断言全部通过）。

### Q5 手势与外来确认 —— **通过**（1 项只能人为构造的乱序场景，见"未验证项"）

**结论**：一次手势只提交一次且只含主动字段（被动补偿不入盘）；订阅更新只刷新已确认基线，不重挂呈现、不打断手势；迟到/乱序快照不会污染**当前显示**；若能回退基线凭据，也在下一次条件提交时被 CAS 收口（不自愈的前提是记录根本没被写过——见 Q6 的 P2）。

**证据**：
- 一次提交：`gestureStart`（`:799-830`）仅捕获基线（分支直接子节点 + 当时 layout + 容器副本 + 树代数 `revision`），不写盘；`gestureEnd`（`:832-886`）先 `gesture = null`，校验分支/容器/代数/百分比后调 `resizeBranch`，再由 `active` 生成字段。作者用例断言 `saves(sent) === 1`、字段仅 `outline`；呈现 `editor` 结算为 540 而写盘仍为 660（被动补偿不入盘）。
- 订阅隔离：`onUpdate`（`:707-720`）→ `applyRead(snapshot, false)`；`publish=false` 分支（`:482-490`）只做 `probeRecord` 结构探针 + `acceptBaseline`，**不调用 `grid.restore`**，也不触碰 `gesture`/`pendingFields`。作者用例断言拖动中的宿主 `state.gesture === true`、呈现不变、凭据已刷新且可直接续写。
- **探针 C2**：用脚本化传输人为让"订阅初始快照"迟到且更旧（rev-1，呈现为 rev-2 的 300px）→ 断言呈现仍是 300（未重挂），`state.credential` 回退为 rev-1；随后一次手势提交以 rev-1 条件写 → 冲突 → 重读 → 只重放主动字段 `editor`，写盘保留 `outline 300`（外来/当前值）与 `console 300`。
- 手势基线失效防护：容器尺寸变化即取消手势（`:784-797` 推 `gesture` issue），`gestureEnd` 再校验容器与 `revision`（`:840-842`）。

### Q6 CAS 冲突与失败分类 —— **不成立**（1 项 P2）

**通过的部分**：
- 冲突重读只重放本次主动字段（`:628-664` + `submit`），作者用例「冲突后重读只重放本次主动字段」与**探针 A3** 均证实另一窗口的字段不丢。
- 二次冲突停止自动重试：`submit` 以 `autoReplay` 记账（`:589-620`），冲突重放时以 `false` 再提交一次，再冲突则 `keepPending(fields, diagnosis, true)` → `pending.autoReplayed === true`，不再自动重放；作者用例断言 `saves === 2`、`pending` 保留、显式 `retry()` 可再提交一次。
- `committed === null`（超时/断线）既不报已保存也不报未写入：`classifyFailure` 未知错误一律 `committed: null`（`:520`），走 `rereadAfterFailure(..., "reconcile")`；已落地 → `fields: []` 的 `saved`；未落地 → `unsaved` 且 `autoReplayed=true`，不自动重发。作者用例覆盖两种收口。
- `retry()` / `abandon()`：`retry()` 只在 `ready + accepting + writable + credential` 时可重试，`release/invalidated/blocked` 分别拒绝（`:886-898`）；`abandon()` 清除 pending 并从**已确认基线**重新发布、不动其它记录（`:899-912`；作者用例断言未发 `remove`、别家记录仍在）。与 Spec「重试/放弃入口」「放弃采用当前已确认值，不清空其他记录」（persistence.md:115-116）一致。
- 读取失败 ≠ 缺失：`runOpen` 的 catch 走 `block("unavailable")`（`:694-701`），不写默认值、不置 `writable`；`open()` 保留重试入口（`:773-780`，仅在 `phase === "ready" && (projection === null || subscription === null)` 时清空 promise）。作者用例覆盖。

**P2 缺陷（结论：不成立）**：重放/核对路径把"主动字段**没有落点**"当成"当前值已满足意图"，返回 `saved` 并清除未确认意图。

- 代码：`rereadAfterFailure`（`:652-657`）
  ```ts
  reportSkips(composed.skipped);
  if (composed.applied.length === 0) {
      // 已确认值已经满足主动意图：视为目标已达成，不伪造某次历史请求的回执（Spec「输出与可观察行为」）。
      clearPending();
      return {status: "saved", credential, fields: []};
  }
  ```
  `applied === 0` 有两种来源：① 值本来就相等（真"已满足"）；② 字段全部 `skipped`（记录里已无对应节点）。分支不区分二者。
- **探针 B（`replay-no-landing.probe.test.ts`）复现**：基线记录含 `outline`/`editor`；触发冲突后重读返回结构已变的记录（节点改名 `outline-v2`，`outline` 不存在）。观察结果：`outcome.status === "saved"`、`pending === null`、传输上只有 1 次失败提交（无写入）、`issues` 中另有 `save` 类"没有落点"诊断、`credential` 被换成重读到的 rev-2。即：本次主动意图（outline 360）既没落盘、又不在 pending、也无法再 retry/abandon，调用方却看到"已保存"。
- 规范依据：persistence.md:144「当前值与未确认意图相同可视为当前目标已满足，**不据此伪造某次历史请求的成功回执**」——本例"当前值与意图"并不相同（节点都不存在）；persistence.md:114「再次冲突或其它保存失败时**保留**当前显示和未保存意图…提供重试与放弃入口」。
- 同一根因的次生现象：初始 `commit` 路径（`:680-682`）把"全部没有落点"报成 `unchanged`，诊断文本"本次手势没有产生与原件不同的字段"在语义上也不准确（字段是没有落点，不是值相同）。影响较轻（未声称已保存），但与 P2 同源，建议一并按 `skipped` 区分。

**修复建议（最小改动，仅改分类，不动公共类型）**：
```ts
        if (composed.applied.length === 0) {
            if (composed.skipped.length > 0) {
                const unresolved = `${diagnosis}；重读后主动字段没有落点（记录里已无对应节点），未确认调整保留`;
                keepPending(fields, unresolved, true);
                return unsaved(unresolved, pendingList());
            }
            clearPending();
            return {status: "saved", credential, fields: []};
        }
```

**探针**：探针 B（复现）；命令 2 中 `replay-no-landing.probe.test.ts`。

### Q7 planning 一致性 —— **通过**（1 项有保留的观察）

**结论**：`legacy-value` / `unsupported-version` / `corrupt` / 结构非法一律**禁止普通保存并保留原件**，与 `projectStorageState` 投影口径一致（投影只管"当前该显示什么"，写入阻断由 `blocked` 单独表达）。

**证据**：
- `applyRead`（`:457-505`）：`value` 先判载荷版本（`recordVersionProblem`，`:437-442`：v1 → `legacy-value`；非 2 → `unsupported-version`），`legacy-value`/`unsupported-version` 直接 `block`；`publish` 路径再整体 `restore`，`!result.ok` → `block("invalid-record")` 并回落产品默认布局（未半更新）；订阅路径用 `probeRecord`（`:445-449`，一次性网格取原语 `ok/reason`，不序列化、不重挂）。
- 包装层分类：`legacy-value` / `unsupported-version` / `corrupt` 分别 `block`，并保留原件（`baselineRecord = null`、`credential = null`、`writable = false`，`:541-552` 的 `block`）。作者用例（legacy/不支持/损坏/结构非法四态）断言 `writable === false`、`blocked` 分类、`credential === null`、呈现回落默认且 `saves === 0`、记录 revision 未变。
- 写入侧封堵：`commit`（`:667-682`）在 `!writable` 时只留本地意图并返回 `unsaved`（`pending.retryable === false`），`retry()` 在 `!writable` 时拒绝（`:893-895`）——不存在"普通保存覆盖原件"的入口。
- 有保留的观察：`value` 类型但**载荷**版本为 1（包装版本仍为 2）时，`projection.status === "confirmed"` 而 `blocked === "legacy-value"`，`writable === false`。这是显式设计（类型注释与 `block` 注释均写明"结构非法的当前值在投影里仍是 confirmed"、写入阻断单独记在 `blocked`），消费方必须读 `blocked` 而不是只看 `projection.status`。不算缺陷，但应写进切片 4 的接线约定。

---

## 4. 对抗性探针清单（≥3，含 1 条排除"未知部分丢失"）

目录：`tasks/t46-checkpoint-a-review/walkthroughs/probes/`（本审查新增的临时文件，保留在 Task 目录内；不留在产品目录）。

| 探针 | 文件 | 针对问题 | 结果 |
|---|---|---|---|
| A（关键，排除"未知部分丢失"） | `originals-preservation.probe.test.ts` | Q4 原件合成/未知部分/过滤后 serialize 覆盖 | **通过**：未知顶层/节点字段、未知嵌套分支、未知引用叶与顺序逐项保留；写盘载荷含被过滤掉的部分；冲突重放保留外来未知结构 |
| B | `replay-no-landing.probe.test.ts` | Q6 未确认结果分类 | **复现缺陷**：重放无落点 → `saved` + `pending` 清空 + 无写入 |
| C | `deleted-and-stale-baseline.probe.test.ts` | Q6/Q5 deleted 分类、迟到订阅快照 | **通过**：C1 deleted → 投影 `default`、不落盘、首存使用墓碑凭据；C2 迟到旧快照只回退基线不改呈现，下一次提交经 CAS 冲突自愈且保留外来字段 |
| D | `lifecycle-and-guards.probe.test.ts` | Q2/Q3 构造守卫、释放语义 | **通过 + 1 项观察**：D1 五种守卫全部抛 `TypeError`；D2 `release()` 幂等、释放后零写、手势/重试拒绝；D3（P3）未打开过的宿主 `release()` 后 `open()` 仍发起 1 次读取 |
| E | `second-gesture-vs-pending.probe.test.ts` | Q6 未确认意图 vs 后续手势 | **通过（行为与规范一致）**：unsaved 后再手势成功保存会取代先前未确认意图——与 persistence.md:114「重新拖动是新的明确意图」一致；但被取代的意图其**呈现值**仍留在本窗口（360）而记录为 240，且无任何诊断（见非阻断观察 6a） |

运行方式（cwd 为 `packages/neuro-book`）：
`bunx vitest run --config ../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t46-checkpoint-a-review/walkthroughs/probes/vitest.probe.config.ts` → exit 0 / 5 files / 10 tests。

探针夹具 `probe-harness.ts` 复用与产品测试同形的真实 link：`createWorkbenchStorageContext` + `openStorageOwnerHandle`（注入 `StorageValueTransport`），因此**句柄、owner 守卫、订阅通知、失效语义都是真实实现**，只有后端读写序列被脚本化。

---

## 5. 聚焦测试核对（17 用例）

作者声称的 17 条用例**逐条核对属实**，命令 1 复跑 exit 0 / 17 passed：

1. value 记录经原语一次发布（未知引用只过滤呈现、读取不写盘）
2. missing 记录保持产品默认布局、不落盘、首存用缺失凭据
3. legacy / 不支持版本 / 损坏 / 结构非法分别诊断、禁止普通保存
4. 原件合成保留未知字段与未知引用（纯函数）
5. 一次手势只提交一次、只写 active（程序布局/取消/no-op 不保存）
6. 订阅只更新已确认基线（不重挂呈现、不打断手势、凭据可续写）
7. 冲突后重读只重放本次主动字段（另一窗口字段不丢）
8. 二次冲突保留未确认意图并停自动重试，显式重试可再提交
9. 结果未确认时不谎报（已落地视为保存 / 未落地保留未确认意图）
10. 放弃未确认意图采用已确认值、不清其它记录
11. 读取失败不被当作缺失（保持默认、禁止保存、重开补齐订阅）
12. 订阅补齐基线但不重挂呈现，显式恢复才应用
13. 两个 resource 记录独立（同名叶不串记录）
14. 真实 adapter 往返（read → 手势保存 → 重开 → 原件合成 + 未知引用恢复）
15. 从未确认基线重新发布（未知引用回归可恢复；有未确认意图时拒绝）
16. release 先停止接纳再等在途提交收口
17. 上下文失效后不向失效句柄补写

**测试质量评述**：断言主体是可观察行为（写盘载荷、呈现宽度、`state` 分类、传输调用次数），未发现"只断言实现细节/字段拷贝/调用次数"的空洞用例；`saves(sent)` 与 `reads` 计数属边界可观察行为（"是否发生写入/读取"），可接受。缺口不在断言质量，而在**场景覆盖**（下节）。

---

## 6. 缺失用例清单

按重要性排序（前 2 条与本次缺陷直接相关）：

1. **重放/核对路径"无落点"（`skipped` 非空且 `applied` 为空）的结果分类**：应断言"不得报 saved、应保留 pending"。当前无用例，探针 B 证明实际报 `saved`。（P2 修复后应补此用例）
2. **未确认（unsaved）之后再次手势**：应断言取代语义（旧意图被明确取代、呈现与记录的最终一致性由哪条路径恢复）。当前无用例；探针 E 记录现状（规范允许取代，但无诊断、呈现与记录会暂时不一致）。
3. **订阅驱动的结构非法记录**（外部确认值 `invalid-record`）：应断言"停止普通保存且不重挂呈现、旧呈现保留"。当前只覆盖首读 `publish` 路径的结构非法。
4. **`deleted` 与 `missing` 的分类区分**：作者已自陈未单列（同一 accept 分支）。探针 C1 覆盖 deleted 行为（投影 default、零写、首存用墓碑凭据），建议固化为用例。
5. **迟到/乱序订阅快照**：应断言"当前显示不被旧快照污染"，并把"基线凭据可能回退"的行为钉住（探针 C2 用脚本化传输构造；真实适配器路径未观测到）。
6. **`release()` 后 `open()` 的行为**（P3）：应断言释放后不接受任何新动作（含读取）或显式记录为允许的只读动作。探针 D3。
7. **构造期守卫**（owner 不匹配 / `identified` 缺 resource / `single` 带 resource / 不安全 resource）：探针 D1 覆盖，测试缺失。
8. **Project scope 全路径**：现有用例全为 user scope；应补一条以 `projectOwner()` 取得句柄的宿主用例（并覆盖 scope 不匹配被本地拒绝）。
9. **结构编辑（增删/移动叶）**：本切片明确不做（`fields` 指到原件里不存在的节点 → `skipped(unknown-node)`）；结构持久化在后续切片。

---

## 7. 阻断项与非阻断清单

**阻断（建议在切片 4 接线前修复）**

- **P2-1 结果分类收口**：`rereadAfterFailure` 把"主动字段没有落点"当作"已满足"，返回 `saved` 并清除未确认意图（`:652-657`；探针 B 复现；规范 persistence.md:144/114）。修复见 Q6 的建议片段，并补缺失用例 1。

**非阻断（P3/观察，不阻断合入）**

- **P3-1** `release()` 之后从未打开过的宿主 `open()` 仍发起一次读取（`:686-690`、`:773-778`；探针 D3）。建议在 `open()` 前置 `if (!accepting) return Promise.resolve(stateSnapshot())`。
- **观察 1a** `TERMINAL_STORAGE_CODES` 注释声称与 owner-handle 同集合但实际多一项，且为复制；建议改为引用导出谓词或修正注释。
- **观察 1b** `isContextUnavailable` 是 `readUnavailableFailure` 的第二份形状检查。
- **观察 6a** unsaved 后再手势：被取代意图的呈现值留在窗口（360）而记录为 240，无诊断；重新挂载后自愈。规范允许（persistence.md:36 三者可暂时不同、:114 重新拖动=新意图），但建议至少累积一条诊断。
- **观察 7a** 载荷 v1（包装 v2）时 `projection.status === "confirmed"` 且 `blocked === "legacy-value"`；切片 4 的消费方必须读 `blocked`，不能只看投影状态。
- **观察 Q3-2** 宿主不自持句柄生命周期，若调用方忘记 `release()` 宿主自身订阅不会自动关闭（由工作台上下文释放句柄收口）；属既定责任划分，接线侧需遵守。

---

## 8. 未验证项（明写，不当作通过）

1. **全包 typecheck / 构建**：未运行（属 Leader 门禁；作者报告中的 scoped `vue-tsc` 未复跑）。
2. **nb-ui playwright e2e / playground**：按约束未运行，也不据此下结论（`packages/nb-ui/playground/**`、`e2e/**` 正由另一 Task 修改）。
3. **浏览器人工验收 / 产品宿主启动 / 390×844 与四主题**：未做（`ui.nested-grid` 仍为 planned；本切片无 UI）。
4. **真实后端（HTTP data 目录）上的 CAS 冲突与墓碑语义**：探针与用例都使用注入传输 + 真实 owner adapter；未对真实服务端做端到端验证（`deleted` 记录上的条件写、墓碑凭据语义属后端合同）。
5. **真实适配器路径下的"迟到/乱序订阅快照"**：未观测到（`owner-handle` 的订阅读取每次都是新鲜读取，且同一 entry 的读取按 `tail` 串行、按 `snapshotKey` 去重）；探针 C2 的乱序是脚本化传输人为构造，只能证明"回退后的后果由 CAS 收口"。
6. **消费侧（切片 4 主工作台）**：`GridLayoutCommitResult` 四态、`state.blocked`、`pending.retryable` 目前**没有产品消费者**，接线正确性（尤其"必须读 `blocked` 而非只看投影"）在本切片内无法验证。
7. **`storage-plugin-sample.ts` 是否应补 grid 接线样例**：作者按可选未做；不影响宿主正确性，未验证。

---

## 9. 裁定

**需修复**：公共边界（类型、寻址、生命周期、原件合成、手势/订阅隔离、planning 阻断）满足 [ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md) 与 [storage.persistence](../../../../../docs/specs/storage/persistence.md) 的消费要求，且原件合成这一最重要数据边界经对抗性探针 A **排除**了"未知部分丢失/被过滤序列化覆盖"的风险；唯一不成立项是失败恢复路径的结果分类（P2-1），修复面约 8 行且不改公共类型。修复 P2-1 并补缺失用例 1 后，检查点 A 可放行；P3 与各观察项可与切片 4 一并处理。

**证据索引**：命令见 §1；探针见 §4（文件保留在 `tasks/t46-checkpoint-a-review/walkthroughs/probes/`）；hash/revision 见 §2。

---

# 追加复核（修复后）

- 只读约束不变：未改产品代码与产品测试、未改 t44 目录、未提交/未 push/未联网、未访问 3001。本轮只更新本 Task 的探针与本文件。
- 结论先行：**P2 / P3 / 观察 1a 全部闭合**；修复未破坏相邻路径（G1–G4 全绿）；**最终裁定：建议合并**。残留均为非阻断观察与既有未验证项。

## 10.1 新 revision 与被审文件 SHA256

| 项 | 值 |
|---|---|
| 修复提交 | `1f1942c3afb44f8f7cf61f4af6ad55fc0b04b389`（`fix(storage): keep unresolved grid intents when replay has no landing`） |
| 当前 HEAD | `0bcea164`（`feat(nb-ui): add a nested grid fixture to the component lab`，t45 的 nb-ui 改动，与本审无关） |
| 分支 | `refactor/w00003-nb-ui-adoption` |
| `storage-grid-host.ts` | `cca4e6b99a409bd318941b5b8a4475702da5811cd7b1adcda9bd30d64352248e`（修复前 `426b0b24…c703a`） |
| `storage-grid-host.test.ts` | `75279bd0de53e0560d715ec901491a74b7eb1a58b29a8e0ac636e87d0effada5`（修复前 `8fe92780…86b63`） |

- 两个文件在 `1f1942c3` 提交后**工作树干净**（`git status --porcelain` 对二者无输出），即上面的 SHA256 就是该修复提交的内容；本审查自算哈希与 Leader 给的值一致。
- 修复提交规模：宿主 `+31 / -5`（36 行变更），测试 `+129`（新增 3 条用例，`it(` 计数 17 → 20）。

## 10.2 命令与退出码（cwd 均为本 worktree 的 `packages/neuro-book` 绝对路径）

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 3 | `bun run test app/utils/workbench/storage-grid-host.test.ts` | **0** | `Test Files 1 passed (1)` / `Tests 20 passed (20)` / `Duration 6.62s` |
| 4 | `bunx vitest run --config ../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t46-checkpoint-a-review/walkthroughs/probes/vitest.probe.config.ts` | **0** | `Test Files 6 passed (6)` / `Tests 14 passed (14)` / `Duration 9.35s` |

## 10.3 P2 / P3 / 观察 1a 是否闭合

### P2 —— **闭合**（独立复现，不只读作者报告）

- 修复代码（`storage-grid-host.ts:658-668`）：
  ```ts
  if (composed.applied.length === 0) {
      if (composed.skipped.length > 0) {
          // 主动字段在重读后的记录里没有落点：既没有落盘，也没有"当前值已满足意图"这回事。
          const unresolved = `${diagnosis}；重读后主动字段没有落点（记录里已没有对应节点），未确认调整保留`;
          keepPending(fields, unresolved, true);
          return unsaved(unresolved, pendingList());
      }
      // 每个字段都落点且值已相同：视为目标已达成，不伪造某次历史请求的回执（Spec「输出与可观察行为」）。
      clearPending();
      return {status: "saved", credential, fields: []};
  }
  ```
  同根因的次生现象也一并修掉：`commit`（`:691-699`）的 `unchanged` 诊断现在按 `skipped` 区分"主动字段没有落点"与"值相同"。
- **独立复现（同一场景、同一探针逐步演进）**：探针 B 用脚本化传输让"冲突后重读"返回结构已改写的记录（`outline` 改名 `outline-v2`）。
  - 修复前（revision `5fcdf8b8`）：探针 B 观察到 `status === "saved"`、`pending === null`、传输上仅 1 次被拒提交、`issues` 另记"没有落点" → 意图静默丢失且声称已保存。
  - 修复后（revision `1f1942c3`）：`status === "unsaved"`、`pending` 保留且 `{retryable: true, autoReplayed: true}`、`fields: [{id:"outline",axis:"width",value:270}]`、传输上仍只有那 1 次被拒提交（**零补写**）、`retry()` 仍无落点故仍 `unsaved` 并保留意图、`abandon()` 采用已确认结构（`["root","outline-v2","editor"]`）且无写入。
- 作者新增的回归用例（`it("重放后主动字段没有落点：不报已保存，保留未确认意图且重试/放弃可用")`）覆盖同一场景，独立复跑通过。

### P3 —— **闭合**

- 修复代码：`open()`（`:795-807`）先 `if (!accepting || phase === "released" || phase === "invalidated") return Promise.resolve(stateSnapshot());`；`runOpen`（`:703-…`）顶部同口径早退，且读取后的接纳检查改为 `if (!accepting)`（注释说明"读取期间可能已被释放或失效…不再建立订阅"）。
- **探针 D3 复现**：从未打开过的宿主 `release()` 后 `open()` —— 修复前读取计数 +1，修复后读取计数不变且 `phase === "released"`；已打开过的宿主同样只返回状态快照。作者新增用例（"release 后 open 不接受新动作：返回当前状态且不发起读取"）覆盖同一路径，复跑通过。

### 观察 1a —— **闭合（文档层面）**

- 注释已改写为准确表述：`TERMINAL_STORAGE_CODES` 的注释（`:306-311`，集合本体 `:312-320`）注明它是"`owner-handle.ts` 的终止码（该模块私有的 `TERMINAL_STORAGE_CODES`）再加 `STORAGE_SCHEMA_MISMATCH`"，并明确"适配器若新增终止码，宿主要同步跟随"。
- 仍为**集合复制**（未改为引用适配器导出谓词），因此漂移风险只是被显式声明而非消除；属可接受的非阻断残留（见 10.6）。

## 10.4 两个固化探针的更新前后断言差异（回归证据）

| 探针 | 更新前断言（钉住修复前行为） | 更新后断言（钉住修复后行为） |
|---|---|---|
| `replay-no-landing.probe.test.ts` | `expect(outcome.status).toBe("saved")`；`expect(host.state.pending).toBeNull()`；`expect(probe.attempts).toHaveLength(1)`；`expect(host.state.credential).toEqual(credential("rev-2"))` | `expect(outcome.status).toBe("unsaved")`；`expect(host.state.pending?.fields).toEqual([{id:"outline",axis:"width",value:270}])`；`toMatchObject({retryable:true, autoReplayed:true})`；`attempts` 仍为 1（零补写）；新增 `retry()` 仍 `unsaved` 且意图保留、`abandon()` 后 `pending === null` 且呈现回到已确认结构 |
| `lifecycle-and-guards.probe.test.ts`（D3） | `expect(probe.readCount()).toBe(readsBefore + 1); // 观察：release 后 open() 仍发起了一次读取` | `expect(probe.readCount()).toBe(readsBefore); // 修后：release 后 open() 不再发起读取`；用例标题改为"…不接受新动作且不发起读取（修后期望）" |

- 说明：探针 B 的期望值取自 `twoLeafRecord()` 的真实几何（outline 240 + editor 660 = 900 panelSpace，30% → 270），不是照抄三条叶夹具的 360。
- 除上述断言外，探针内容与夹具未变；`probe-harness.ts` 仅新增可选 `resolveRef` 选项（供探针 B 解析改写后的 `outline-v2`）。

## 10.5 G1–G4：修复相邻路径复核（新增探针 `post-fix-adjacency.probe.test.ts`）

| 检查 | 断言要点 | 结果 |
|---|---|---|
| G1 真"值已相同"仍 `saved` | 核对读取返回"已包含本次意图（outline 360）"的记录 → `status === "saved"`、`fields: []`、`credential === rev-9`、`pending === null`、`attempts === 1`（不重复提交）、**无**"没有落点"诊断 | **通过**（未被改判为 unsaved） |
| G2 `mode === "reconcile"` 未落地 | 核对读取仍是旧值 → `status === "unsaved"`、诊断含"未确认"、`pending.autoReplayed === true`、`attempts === 1`（不自动重发）、呈现保留 360 | **通过** |
| G3 `missing` 首开 | `projection === "default"`、`writable === true`、`blocked === null`、`credential === {revision: null}`、呈现为产品默认四节点、读完零写；随后手势 `saved` 且 `expected.revision === null`、载荷含三叶 | **通过** |
| G4 `open()` 守卫与正常重开/订阅 | 首读与订阅初始读均失败 → `projection === null`、`blocked === "unavailable"`、呈现保持默认；再次 `open()` → 一次发布（`confirmed`、rev-1、呈现 320）且建立订阅；第三次 `open()` 不产生新读取 | **通过** |

## 10.6 残留非阻断项（不阻断合并）

- 观察 1b：`isContextUnavailable`（`:994-1003`）仍是 `storage-context.ts:readUnavailableFailure` 的第二份形状检查（该谓词未导出）。
- 观察 6a：unsaved 之后再手势会取代先前未确认意图（persistence.md:114「重新拖动是新的明确意图」），但被取代意图的呈现值与已确认记录会暂时不一致且无诊断（重新挂载自愈）。
- 观察 7a：载荷 v1（包装版本仍 2）时 `projection.status === "confirmed"` 而 `blocked === "legacy-value"`；切片 4 的消费方必须读 `blocked`，不能只看投影状态。
- 观察 Q3-2：宿主不自持句柄生命周期，调用方若不 `release()` 宿主，其订阅不会自行关闭（由工作台上下文释放句柄收口）。
- 集合复制：`TERMINAL_STORAGE_CODES` 仍是复制而非引用适配器导出（漂移风险已由注释显式声明）。
- 第 8 节的未验证项仍然成立：全包 typecheck、nb-ui e2e/playground、浏览器人工验收、真实后端 CAS/墓碑端到端、真实适配器下的乱序订阅快照、切片 4 消费侧接线、`storage-plugin-sample.ts` 是否补样例。

### 行号勘误（§3 的引用针对修复前 revision `5fcdf8b8`）

§3 写下的少数行号有偏差；下表给出正确值（左：§3 所写；右：修复前 `5fcdf8b8` 实际行号）。修复后 `1f1942c3` 因新增行整体后移，本补充节引用的均为修复后行号。

| §3 所写 | 实际（`5fcdf8b8`） |
|---|---|
| `recordVersionProblem` `:437-442` | `:424-429` |
| `probeRecord` `:445-449` | `:437-440` |
| `retryable` 计算 `:426` | `:393` |
| `track` `:414-419` | `:383-387` |
| `applyRead` 订阅分支 `:482-490` | `:483-489` |
| `classifyFailure` 未知错误 `:520` | `:526` |
| `workbenchBranchGesture` `:822` | `gestureStart` `:813`、`gestureEnd` `:843` |
| `gestureEnd` `:832-886` | `:827-877` |
| `onUpdate` `:707-720` | `:708-725` |
| `runOpen` catch `:694-701` | `:693-701` |
| `release()` `:935-962` | `:935-963` |
| `isContextUnavailable` `:966-975` | `:968-975` |
| 构造期守卫 `:338-353` | `:339-351` |

## 10.7 最终裁定

**建议合并。** P2（重放无落点误报 saved + 清除未确认意图）、P3（release 后 open 仍发起读取）、观察 1a（终止码注释不实）均已闭合，且修复未破坏相邻路径（G1–G4 全绿）；聚焦测试 20/20（exit 0）与探针 14/14（exit 0）在本轮独立复跑通过。残留项均为非阻断观察与第 8 节列明的未验证项，可在切片 4 接线时一并处理。

**证据索引**：命令与退出码见 §10.2；探针文件见 `tasks/t46-checkpoint-a-review/walkthroughs/probes/`（6 个 `*.probe.test.ts` + `probe-harness.ts` + `vitest.probe.config.ts`）；revision 与 SHA256 见 §10.1。
