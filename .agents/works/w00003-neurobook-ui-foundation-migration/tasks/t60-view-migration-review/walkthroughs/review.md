# t60：视图迁移增量独立对抗复核（t55 / t56 / t57 / t59）

被审 revision：`c2152f83`（含 `aec1e0d8` t55、`4bf1562a` t56、`ef51c81b` t57、`6f9813c1` t59）。
复核者：`MigrationIncrementsReview`（只读）。工作位置：worktree `.worktree/w00003-neurobook-ui-foundation-migration`。
复核时点工作区 HEAD：`8934a085`（= `c2152f83` + 本 Task README 一个提交；`git status --porcelain` 只有用户 dirty 的
`app/utils/workbench/descriptors{,.test}.ts`，因此下列 SHA256 就是被审 revision 的字节）。
`docs:check`、`typecheck`、聚焦测试、Lab smoke 由 Leader 跑过（t55/t56/t57/t59 各自 walkthrough 有记录），
本记录只列**我自己跑过的命令与退出码**。

---

## 一、结论（先行）

**裁定：需修复（`overall_correctness = incorrect`），但不阻断本轮检查点合并。**

> **状态：§一~§七 是首轮复核（被审 `c2152f83`）；返工 R1–R3 已落盘，§八「追加复核（修复后）」是最终裁定：
> R1（F1）与 R2（F3）已闭合并经探针复验，R3 文档/口径 4+1 处已改对；新增一条 P3（F4：句柄不可用时
> `commit` 既不重连、又顶掉更准确的诊断）。下面 §一 的 F1 结论按 §八 更新，其余各问题结论仍然有效。**

- **唯一实质缺陷（P2）**：`files` 视图的**消费端**没有遵守「记录读取就绪前调整控件不可用」。
  文件树在记录还没读到分类时已经可交互，而界面此刻显示的是产品默认（空展开）；
  这时任何一次树手势都会把「默认 + 本次路径」当成整份意图提交，**覆盖掉记录里已确认的展开项**。
  机制用探针 01 确定性复现（下方原文），交回 **t55**（修复点：`WorkspaceFilePanel.vue`）。
- **Q1「回读一致后才删旧键」在四组对抗下成立**：回读抛错、删除失败、同一会话并发第二次迁移、
  两个会话同时迁移——旧键都保留或按规则删除，记录值从不被空值/半值覆盖，
  并发下只有 1 次落盘、没有假诊断（探针 02）。未发现删除门禁被绕过。
- **Q2 单写者成立**：三处记录各只有一条写路径，产品代码里只剩迁移原语一处 `localStorage`。
- **Q4 定义与注册成立**：owner/key/schema/limits/默认值/校验符合规范；注册只有
  `server/storage/product-definitions.ts` 一个入口，`globalThis` 槽保证幂等。
- **Q5 视图解析与缺省缝隙成立**：两个注入缝隙都不传时走的确实是「产品注册表 + 产品白名单」
  （探针 03 补上了此前**完全没有覆盖**的缺省路径；产品页面只传 3 个 props）。
- **Q6 断言强度**：6 个新测试文件绝大多数真能失败；被改写的 `world-engine-workbench-preview.test.ts`
  是「源码文本 pin 换源码文本 pin」——没有加严到运行时覆盖，也没有放宽到危险；但共享迁移原语
  有 5 个分支（含 `unavailable`、`deferred`、迁移未确认）与整个 `createBrowserLegacyValueStore`
  零测试（P3，交回 **t56**）。
- **Q3/Q7/Q8**：会话接线与抽取等价性成立；「四个 legacy 组件都不能删」只对 3 个成立；
  两份新文档有 4 处与实现直接冲突（均为文案级，非阻断：宿主文档 2 处 role/三类、面板文档 2 处可重试/条件漏写）。

---

## 二、探针（3 个文件 / 15 例，全绿）

跑法（cwd = worktree 根，只读、不起任何服务、不碰 3001）：

```
bunx vitest run --config .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t60-view-migration-review/walkthroughs/probes/vitest.probes.config.ts
```

| 探针 | 试图证伪的声明 | 结果 |
|---|---|---|
| `probe-01-first-read-intent`（4 例） | `user-record-session.ts`「首读门禁：用户的调整不因为"还在读"被丢掉」+ `persistence.md`「尺寸调整控件在读取就绪前不可用」 | **证伪成功**（缺陷 F1）：读取窗口内的意图会覆盖已确认记录 |
| `probe-02-migration-failure-and-concurrency`（5 例） | `legacy-record-migration.ts`「回读验证一致才删旧键」「任何一步失败都保留旧键」+ t56 自述的 7 类失败 | **证伪失败**（声明成立）：回读抛错/删除失败/双 retry/双会话四种攻击下旧键与记录都正确 |
| `probe-03-view-host-default-seam`（6 例） | t57「两处注入是测试缝隙，产品页面两个都不传，缺省行为不变」+ `WorkbenchViewHost.md:14`「三类都画出来」 | **部分证伪**：缺省路径成立且此前无覆盖；文档「三类都画出来」不成立于「有可见视图」时 |

探针只改 `walkthroughs/probes/`，不改产品代码与产品测试；`vitest.probes.config.ts` 复用产品包的
root/alias，只把 `include` 指向本目录（产品 vitest 配置的 include 只收 `packages/neuro-book/**`）。

### 探针 01 实测原文（F1 的证据）

```
[probe-01/files]    读取中显示 = []                             | 界面意图 = ["lorebook/"]        | 落盘记录 = {"paths":["lorebook/"]}
[probe-01/settings] 读取中显示 = {"width":1120,"height":640}      | 落盘记录 = {"width":1200,"height":640}
```

第一行：记录里已确认的是 `{"paths":["manuscript/","manuscript/vol-1"]}`，读取未完成时对外显示是产品默认 `[]`；
复刻 `WorkspaceFileTree.vue:98-104`（把整份 `props.expandedPaths` 加新路径后 emit）与
`WorkspaceFilePanel.vue:52-54`（setter 直接 `commit` 整份数组），提交后两条已确认展开项**消失**。

第三、四例是对照组：读取完成后再做同一个手势，结果是三条路径的并集（`{"paths":["manuscript/","manuscript/vol-1","lorebook/"]}`）——
差异只来自「读取窗口」，不是提交语义本身。

### 探针 02 实测原文（Q1 声明成立的证据）

```
[probe-02/readback-throw]      旧键剩余 = "[\"manuscript/\",\"lorebook/\"]" | 落盘 = {"paths":["manuscript/","lorebook/"]} | 诊断 = {"diagnosis":"旧展开记录回读失败（回读失败（注入））：旧键保留","retryable":true}
[probe-02/remove-fail]         旧键剩余 = "[\"manuscript/\",\"lorebook/\"]" | 落盘 = {"paths":["manuscript/","lorebook/"]} | 诊断 = {"diagnosis":"旧展开记录删除失败，旧键仍留在浏览器存储里","retryable":true}
[probe-02/double-retry]        落盘次数 = 1 | 落盘 = {"paths":["manuscript/","lorebook/"]} | 旧键剩余 = null | 诊断 = null
[probe-02/two-sessions]        落盘次数 = 1 | 落盘 = {"paths":["manuscript/","lorebook/"]} | 两个旧键 = [null,null] | 诊断 = [null,null]
[probe-02/authoritative-record] 落盘次数 = 0 | 记录 = {"paths":["world-engine/"]} | 旧键剩余 = null
```

---

## 三、逐问题裁定

### Q1 迁移原语正确性（`legacy-record-migration.ts`）——**成立**（附一处理论边界，非阻断）

- **状态机穷尽且互斥**：`migrateLegacyRecord` 共 11 个出口，每个出口只 return 一个 `kind`
  （`settled` 4 处、`deferred` 1 处、`notice` 6 处），没有落空分支。
- **删除门禁**：`store.remove()` 只在四处被调用——旧键本来就不存在（absent）、`state.hasConfirmed`、
  `isEmpty(value)`（空旧值无信息）、以及**回读一致之后**。其余任何失败都在 `remove()` 之前返回，
  因此「回读失败也删键」不可能发生（探针 02 第 1 例：抛错后旧键仍在）。
- **失败分类与文案**：不可读 / 不可解析 / 记录不可写或损坏 / 迁移未确认 / 回读失败 / 回读不一致 / 删除失败
  七类都保留旧键；`retryable` 只对「不可解析」为 `false`（旧值不可迁移，重试无意义），
  其余为 `true`（含回读失败与删除失败），与 t56 自述一致。
- **并发**（README 点名）：同一会话连点两次「重试」、两个会话同时迁移同一条记录，攻击都失败——
  落盘各 1 次、旧键删除、记录值等于旧值、两侧 `notice` 均为 null（探针 02 第 3、4 例）。
  机制上：`migrateLegacy` 只从 `open()`（memo 化的 `opening`）与 `retry()` 进入，两次并发写入由
  `createLayoutRecordSession` 的 revision 条件写 + 冲突重读重放收敛。
- **与迁移合同的关系**：`packages/neuro-book/docs/migrations/storage-state.md` 第 3 步与验收要求
  「用户重置形成的删除标记不被旧值覆盖」「重置后不会重新导入旧值」。本原语用
  `state.hasConfirmed` 近似「记录缺失」，而 `shared/storage/projection.ts` 把 `missing` 与 `deleted`
  **合并**成同一个 `{status:"default"}`，原语因此无法区分二者——墓碑存在时会重新导入旧值。
  今天产品里没有任何调用方删除这三条记录（`handle.remove` 只有 `storage-context.ts:465` 转发、
  无产品消费者），所以**当前无影响**；列入非阻断观察（§六.1）。
- **旧键保留语义**：与「迁移失败保留源」一致；`hasConfirmed` 时只删旧键不写记录是**故意的**
  （探针 02 第 5 例钉住：落盘 0 次、记录不被覆盖），与模块头声明一致。

### Q2 单写者——**成立**

- `files` 展开项、两个窗口尺寸、World Engine 三处尺寸各有且仅有一条写路径：
  `WorkspaceFilePanel.vue:52-54` / `NovelIdeSettingsDialog.vue:493-499` / `ProjectCreateDialog.vue:34-40` /
  `WorldEngineWorkbenchDialog.vue:174-184`（每个面板一个 `commit`）。
- 全仓产品代码的 `localStorage` 只剩迁移原语一处（`legacy-record-migration.ts:42/56/57`）
  与两处无关模块（`AgentModeSessionSidebar.vue`、`plugins/i18n-locale.client.ts`）；
  `sessionStorage` 未涉及。命令见 §五.2。
- 组件内无旧键常量残留（`WORKSPACE_EXPANDED_PATHS_STORAGE_KEY`、
  `SETTINGS_WINDOW_SIZE_KEY`、`CREATE_PROJECT_WINDOW_SIZE_KEY`、`defaultSidebarWidth` 等全部删除）；
  `novel.ide.local` 的 `pick` 仍不含三个已迁字段（`stores/novel-ide.ts:1958-1962`，本增量未动）。
- World Engine：`sidebarCollapsed` 等折叠态仍是组件内存态（t56 §五 偏差 4 已自陈），
  不构成尺寸的第二写路径。

### Q3 会话接线（`user-record-session.ts`）——**接线成立，消费端有一处缺口（F1）**

- 首读门禁（不读到分类不接受提交、缺失不落默认）、跨工作面、释放/订阅、失败可见都对。
- **抽取等价性**：逐条比对了 `aec1e0d8`（自带迁移）与 `4bf1562a`（改用共用模块）的 11 个出口——
  absent / unavailable / 解析失败 / 记录不可写 / pending deferred / hasConfirmed / 空旧值 /
  迁移未确认 / 回读失败 / 回读不一致 / 删除失败，判定与文案模板一一对应；唯一形状变化是
  `parseLegacyExpandedPaths` 的 `{paths}` → `{value}`（类型强制「只有 diagnosis 为 null 才可信」）。
  旧实现在 absent 分支会 `publish()` 清旧诊断，新实现在迁移结束后统一 `publish()`，可观察结果相同。
- **缺口**：`loading` 与产品默认显示的关系被消费端忽略（F1）。

### Q4 记录定义——**成立**

- `shared/storage/workbench-files.ts` / `workbench-window-sizes.ts` / `workbench-world-engine.ts`
  的 owner/key/schemaVersion/`records:"single"`/`locality`/默认值/`validate` 与
  `persistence.md:95-98`、`boundaries.md:103/121` 一致；`limits` 全部走 `defineStorageState` 的默认补全，
  同一 `owner+scope+locality` 分区（`workbench.layout` user/local）内没有互相冲突的容量声明
  （定义构造在 `defineStorageState` 校验期内就会抛错，注册表本身也按分区校验）。
- 注册入口唯一：`server/plugins/storage-definitions.ts` → `registerProductStorageDefinitions()` →
  `server/storage/product-definitions.ts`；`globalThis.__nbookProductStorageDefinitionsV1` 槽保证
  HMR/重复调用幂等（t49 的 F2 修复口径未破坏）。
- 三个新定义的默认值与旧实现逐字段相同（1120×640 / 580×360 / 320-420-292），最小尺寸
  （720×420 / 320×330）与旧 `MIN_*` 相同，且只用于显示夹紧、不进记录。

### Q5 视图解析（`product-catalog.ts` + `WorkbenchViewHost.vue`）——**成立**

- `when` 求值、懒实例化、未知 `factoryKey` 失败可见都在实现里成立；t55 的 `DescriptorResult`
  包装层缺陷（`evaluation.visible` 恒 `undefined`）已修，且生产求值路径由探针 03 真挂载验证。
- **注入缝隙缺省行为**（README 点名）：两个缝隙都不传时，宿主走 `productWorkbenchRegistry()`
  与 `resolveWorkbenchViewFactory`——探针 03 只替换叶组件、不传任何注入，渲染出 `nbook.files`
  与 `data-container-layout="fill"`；只传 `registry` 时未知键给出产品白名单原因
  「未登记的内置 factoryKey：nbook.view.ghost」；传了 `resolver` 时注入者胜出。
  产品页面 `app/pages/index.vue:2645-2649` 只传 `container` / `container-title` / `context`（已核对）。
  这一缺省路径此前**没有任何测试覆盖**（`WorkbenchViewHost.test.ts` 用 `vi.mock` 换掉了整个
  `view-factories` 并每个用例都传 `registry`），探针 03 补上；实现本身正确。

### Q6 断言强度——**大体成立，两处缺口（F3 + 一处表述）**

- 6 个新测试文件里 5 个（`files-view-session` / `window-size-session` / `world-engine-session` /
  `product-catalog` / `WorkbenchViewHost`）走真实会话/真实注册表/真实 DOM，断言落盘地址、落盘 JSON
  与 DOM，真能失败；`WorkspaceFilePanel.test.ts` 把会话整体 mock 掉（`:24-32`，`loading: ref(false)`），
  属接线测试——正是它把 F1 的窗口挡在视野外。
- **被改写的 `world-engine-workbench-preview.test.ts` 是加严还是放宽**：两者都是**源码文本 pin**
  （整文件 1 个 `it`，readFile + `toContain/not.toContain`）。改动把「旧实现的逐帧回写」pin 换成
  「不存在 `onResize:` / `syncDuringResize: true`」+ 保留 `onResizeEnd` 的提交断言：
  方向上**没有放宽**，但也没有变成运行时覆盖（拖拽→提交一次的链路仍无运行时测试）。
  `not.toContain(已删除的常量名)` 这类否定断言只对「原样回流」有效，属可接受的防回流手段。
- **等价类缺口（F3）**：两个会话测试的旧键替身只产 `absent`/`value` 且 `remove()` 恒 `true`
  （`files-view-session.test.ts:178-184`、`window-size-session.test.ts:171-177`），因此
  `legacy-record-migration.ts` 的 `unavailable`、`deferred`、迁移未确认（commit 失败）三个分支
  与整个 `createBrowserLegacyValueStore`（SSR/隐私模式路径）零测试。
  我自己的探针 02 已补上回读抛错、删除失败、双 retry、双会话四类；剩余三类仍需产品测试补。
- 其余弱断言（自比较 `toEqual(WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES)`、`toContain("world")` 一类）
  不构成回归风险，属非阻断。
- 附带更正：t55 自述「`WorkbenchViewHost.test.ts`（6）」实为 **5** 例（实测 `grep -c "    it("` = 5），
  总数 30 不受影响。

### Q7 旧实现与待办——**部分成立（3/4）**

- `index.vue` 的未用 import、占位块、裸键读写函数与 `watch(expandedPaths)` 确实不存在（Q2 命令）。
- **「四个 legacy 组件因契约测试断言而保留」只对 3 个成立**：`world-engine-ide-entry.test.ts:28-30/62-64/963-980`
  读并断言 `WorldEngineSliceInspector.vue`、`WorldEngineStateSummary.vue`、`WorldEngineTimeline.vue`；
  第 4 件 `WorldEngineSubjectStateViewer.vue`（连同其 `…Row.vue`）在全仓只被彼此引用
  （`grep -rn WorldEngineSubjectStateViewer app/` 只命中这两个文件本身；`.nuxt` 自动生成文件与一份历史计划除外），
  删它不会让任何测试失败。清单 §2.6 的待办因此偏保守（下一位清理者若照做会多改一处测试断言），但不构成行为缺陷。

### Q8 文档与实现一致性——**不成立处 4 条（均为文案级，非阻断）**

| 文档主张 | 实测 | 判定 |
|---|---|---|
| `WorkbenchViewHost.md:14`「宿主负责把这三类都画出来，不吞任何一类」 | `hidden` 只进空态文案，而空态仅在 `views.length === 0 && problems.length === 0` 时渲染；有可见视图时不可见视图的原因不进 DOM（探针 03 追加用例：文本 `工具files-leaf`，不含「需要先选中一个条目」） | **不成立**（实现行为合理，文档用词过头） |
| `WorkbenchViewHost.md:52`「提示与空态都用 `role="status"`」 | 提示行是 `role="status"`，空态 `<p class="workbench-view-host__empty">` **没有** `role` | **不成立**（可访问性文案） |
| `WorkspaceFilePanel.md:9`「记录没读到分类、提交未确认、不可写、旧键没迁完都变成一条**可重试的**诊断条」 | `user-record-session.ts` 的 `blocked` 分支固定 `retryable: false`（与 `layout-session.ts:679` 的壳层同一约定），面板对这类诊断不渲染「重试 / 放弃」按钮 | **不成立**（代码与壳层约定一致，文档的「都可重试」是宽泛表述） |
| `WorkspaceFilePanel.md:42`「文件转同名目录（内容 scope 下的可编辑文件）」 | 实现还要求 `!node.path.toLowerCase().endsWith("/index.md")`（`WorkspaceFilePanel.vue:587-589`） | **不成立**（少列一个条件） |
| t59 自述的两处收窄（重命名与递归确认失败是未捕获拒绝、树读取失败无专门文案） | 与实现一致（自陈属实） | 成立 |
| t57 fixture 只经两处缝隙改行为、产品页面不传注入 | fixture 同时注入 `registry` 与 `viewFactoryResolver`（`WorkbenchViewHostFixture.vue:144-148` 附近）；`index.vue:2645-2649` 两个都不传 | 成立 |
| Lab 可挂载性判定 | `app/component-lab/component-index.ts` 的 `deriveMountability` 按 frontmatter 标签推导（`io:`/`state:shared-write` 优先阻断），`WorkspaceFilePanel.md` 的标签组合推出「阻断」，`WorkbenchViewHost.md` 推出「可挂载」 | 成立（推导不是手工登记） |

---

## 四、缺陷与建议（F1 需修；F2/F3 建议）

### F1（P2，交回 **t55**）文件面板在「记录首读未完成」窗口内提交会覆盖已确认展开项

- **触发**：Project 打开后文件树先渲染（面板不消费记录的 `loading`，`WorkspaceFilePanel.vue` 只用
  `expandedPaths/notice/commit/retry/abandon`），记录链（`POST /api/storage/user/context` → owner handle
  bind → read → subscribe）还没走完；此刻界面显示的是产品默认 `[]`。用户在树里展开/收起任一目录。
- **影响**：`WorkspaceFileTree.vue:98-104` 把**整份** `props.expandedPaths`（= 默认 `[]` + 本次路径）
  emit 给 `WorkspaceFilePanel.vue:52-54` 的 setter，setter 直接 `commit`；`commit` 会先 `await open()`
  （因此写入发生在读取之后、记录已确认），合成时以**已确认记录为底**、以**这份整份数组为意图**，
  于是记录里原有的展开项被静默丢弃（下次打开时那些目录不再展开，也没有任何诊断条）。
- **规范依据**：`docs/specs/storage/persistence.md`「布局投影与保存反馈」第 1 条
  「初次加载可以显示产品默认布局，**尺寸调整控件在读取就绪前不可用**」；同一增量里 World Engine
  已经这么做（`resizeDisabled = panelSizes.loading`），文件面板漏了同一层门禁。
- **最小复现**：
  ```
  bunx vitest run --config .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t60-view-migration-review/walkthroughs/probes/vitest.probes.config.ts -t "files 展开项"
  ```
  用例：「读取未完成时的树手势把已确认展开项覆盖成一个路径」——记录预置 `{"paths":["manuscript/","manuscript/vol-1"]}`，
  闸住首次读取，提交 `[...显示的 [], "lorebook/"]`，落盘结果为 `{"paths":["lorebook/"]}`。
- **可达性[INFERENCE]**：读取窗口的时长没测（本 Task 禁止起第二个 dev server、禁止动 3001）。
  结构上记录链至少 3 次串行请求，而文件树只有 1 次（`onMounted` 的 `loadWorkspaceTree`），
  两者同时发起 → 「树先可交互」是常态而非例外；因此**只要用户在树出现后的读取窗口内点一下目录**就会命中。
  概率不高（localhost 上可能只有几十毫秒），但后果是静默丢用户偏好，且随存储宿主变慢而放大。
- **修复建议**（任一，都是小改）：① setter 在 `expandedPathsRecord.loading` 为真时拒绝提交；
  ② 读取就绪前不渲染树，复用现有的加载占位（`t("ide.workspace.filePanel.loadingTree")`）。
  两案的语义都等于规范里的「控件在读取就绪前不可用」；作者既有的首读门禁用例（会话层）不受影响。

### F2（P3，交回 **t55**）同样的窗口在两个窗口尺寸对话框上存在，但**可达性为负**（仅记录，不必修）

`NovelIdeSettingsDialog.vue:489-499` 与 `ProjectCreateDialog.vue:30-40` 的 `commit({...显示的尺寸, width})`
与 F1 同构：读取未完成时的拖动会把「默认尺寸 + 拖量」写成整份记录（探针 01 第 2、4 例实测
`{"width":1200,"height":640}` 覆盖了已确认的 `{"width":1000,"height":700}`）。
但两个对话框都在页面/拾取器挂载时（`v-model`/`:is-open` 控制显隐、没有 `v-if`）就开了会话，
用户能拖拽时读取早已结束——**当前产品里到不了**。列入观察，不作为缺陷。

### F3（P3，交回 **t56**）共享迁移原语的三个分支与浏览器旧键访问器零测试

`legacy-record-migration.ts` 是此后所有视图迁移共用的原语，其价值主张是「失败一律保留旧键」。
两个会话测试的旧键替身（`files-view-session.test.ts:178-184`、`window-size-session.test.ts:171-177`）
只能产 `absent`/`value` 且 `remove()` 恒 `true`，于是 `unavailable`（隐私模式/被禁用）、
`deferred`（用户意图在飞）、迁移未确认（`commit` 失败）三条保留路径，以及
`createBrowserLegacyValueStore` 的 SSR/不可用分支，全部没有测试；
改坏它们不会有任何测试失败。我自己的探针 02 已覆盖回读抛错 / 删除失败 / 双 retry / 双会话，
这四类可以在产品测试里等价补上（用可控 `remove()` 与可控 `read()` 的替身即可）。

---

## 五、命令与退出码（本记录自己跑的）

| # | 命令（cwd） | 退出码 / 结果 |
|---|---|---|
| 1 | `git log --oneline -6`、`git rev-parse HEAD`、`git status --porcelain`（worktree 根） | `8934a085`；工作区只有用户 dirty 的 `descriptors{,.test}.ts` |
| 2 | `grep -rn "localStorage\.\(setItem\|removeItem\)\|localStorage\.getItem" app/ --include=*.ts --include=*.vue`（`packages/neuro-book`） | 产品代码只剩 `legacy-record-migration.ts` 与两处无关模块（Q2 证据） |
| 3 | `grep -rn "registerStorageStateDefinitions\|registerProductStorageDefinitions" server/ app/ shared/ --include=*.ts` | 唯一产品入口 `server/plugins/storage-definitions.ts` → `product-definitions.ts`（Q4 证据） |
| 4 | `sha256sum <17 个被审文件>`（`packages/neuro-book`） | 见 §五.1 表 |
| 5 | `bunx vitest run --config .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t60-view-migration-review/walkthroughs/probes/vitest.probes.config.ts`（worktree 根） | **exit 0**，`Test Files 3 passed (3)`、`Tests 15 passed (15)` |
| 6 | `grep -c "    it(" app/components/workbench/WorkbenchViewHost.test.ts` | `5`（t55 自述 6 例有误） |
| 7 | `grep -rn "WorldEngineSubjectStateViewer" app/ docs/` | 只有该组件与其 Row 互相引用（Q7 证据） |
| 8 | `grep -rn "ProjectCreateDialog" app/ --include=*.vue --include=*.ts` + `sed -n '205,225p' ProjectPickerView.vue` | 无 `v-if`，`is-open` 控制显隐 → F2 可达性为负 |

### 五.1 被审文件 SHA256（worktree 内 `packages/neuro-book/`）

```
f48b343e38717980c915aa52329cac7ca791cc7da17d4fa46e6d502fdb4bacaf  app/utils/workbench/legacy-record-migration.ts
3aced2f83031a5e5a3e19e89759e97d8cbe05b7760dd627a931facf322c180cc  app/utils/workbench/user-record-session.ts
f383ae7003549158a044330dfb1622e0eb4dc2cd960468ba7c917dadf755c92e  app/utils/workbench/files-view-session.ts
c3625e004249cd42501dc132bd1e73a8483c464880bc7a792af960c6dca6c6cb  app/utils/workbench/window-size-session.ts
31264cd38d8d54e653df6717521d055d04f3c1e2f8ac353002991bc24b852096  app/utils/workbench/world-engine-session.ts
1055e0a0c247d1bb8deced5a2d715dc028187c3114d768b5c125866cfc8da147  app/utils/workbench/product-catalog.ts
130d3785a76dd67ca0bc04ecfd5b118905f330d1aa340ef889de825fef988636  app/utils/workbench/view-factories.ts
8df30471f57a5f92289ab3cb8fefe30309c953f70e12198d627df123164fab52  app/components/workbench/WorkbenchViewHost.vue
b305aea3cd9cff7fc933dfa1b2cbb8ed17af959fc0c06e1639d4e1f4fa2153cd  app/components/novel-ide/workspace/WorkspaceFilePanel.vue
51fdf38a19567b54d7d444c37a6194f4c279bc0fe1137fe41787fe99e74689a3  shared/storage/workbench-files.ts
bf2db6e4cf0d41b5cad5694b9e73df5e21eb6cf29da471bd27803a34c820536a  shared/storage/workbench-window-sizes.ts
2f5d400f2574f6d16d033a58023d3062afc03d4d8879a08bf60d56edf93c0114  shared/storage/workbench-world-engine.ts
a01206a1e9cee4e1d9025e0d23ee0b3206b0871177e429bc598f4977fc2f56e9  server/storage/product-definitions.ts
02178019e7f9c77e47761de42947641702c758ef735571064f907a338e8e65a9  app/utils/world-engine-workbench-preview.test.ts
d762d26b96e46834fc998b82ab3e2717da7740ab711e52792060f5c2dd03446c  app/components/novel-ide/NovelIdeSettingsDialog.vue
bd1358e0473fb610043ae5771b764e9c9d2c3a3896516dad6b62d2ce99f551b8  app/components/novel-ide/project-picker/components/ProjectCreateDialog.vue
61e567a587d23bd2380fc0a53bcf6751ebc8cfb56e162e3bcb7cbf02c174c63b  app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue
```

---

## 六、非阻断观察

1. **墓碑语义**：`projection.ts` 把 `missing` 与 `deleted` 合并成 `status:"default"`，
   `migrateLegacyRecord` 只能用 `hasConfirmed` 近似「记录缺失」→ 将来若出现「重置」入口
   （删除这三条记录），下一次启动会**重新导入**旧键，违反 `storage-state.md` 第 3 步与验收项。
   今天没有产品调用方删除这些记录，故无影响；建议在引入任何 reset 之前给原语加一条
   「删除标记不迁移」的判据（需要在 `LayoutRecordState` 上区分 missing/deleted）。
2. **`blocked` 诊断取 `issues.at(-1)`**：`issues` 是 32 条滚动日志，订阅故障/保存失败都可能排在
   blocked 原因之后，面板横幅因此可能显示一条**不是**根因的诊断（`user-record-session.ts` 的
   `publish`）。属既有启发式（t55 抄自 `files-view-session.ts`），只影响文案准确性。
3. **诊断文案未 i18n**：两个对话框与 World Engine 的提示条是中文硬编码（t56 §五 偏差 3 已自陈），
   而 `WorkspaceFilePanel` 走 `t(...)`；不一致但非缺陷。
4. **`deps` 口径**：`SHELL_FILES_VIEW.canToggleVisibility/canMoveView = false`（t55 §五 偏差 3 自陈）
   与提案第一版范围（允许跨容器移动）之间的差距，属登记项。
5. **Lab fixture 与服务端清单的既有偏差**（t56 §五 偏差 1/2）与本次复核结论无关，未重复评估。

## 七、未验证项（明确列出）

1. **真实浏览器/DOM 行为**：本 Task 禁止启停 3001、禁止起第二个 dev server（共享 `.nuxt`），
   因此没有做浏览器验收；探针 03 用 jsdom 挂载覆盖了宿主 DOM 契约，但**没有**在真实界面上验证
   F1 的时序（读取窗口的实测时长）与 B2–B7 那类端到端现象。
2. **磁盘落点**：记录文件的实际路径沿用 t55 的浏览器观察结论，本轮未再观察。
3. **Lab smoke / 全量门禁 / typecheck**：由 Leader 跑过（t55/t56/t57/t59 记录 + 本 Task README），
   本轮只读复核未复跑（避免与兄弟 agent 的半成品改动互相阻塞）。
4. **`world-engine-session` 的工作面切换清理**：只读到 `storage-context.ts` 的
   `enterProject → queueProjectRelease(previous)` 会释放旧 Project 作用域，未逐行验证旧会话订阅的
   关闭时序（该路径在 `world-engine-session.test.ts` 有「切 Project 换记录」用例，但断言的是显示与
   落盘，不是订阅关闭）。
5. **`createBrowserLegacyValueStore` 的 SSR 分支**：只做代码阅读（`!import.meta.client` → 读作
   absent、删除恒 false），未在 SSR 环境实跑（F3 已把这条列为测试缺口）。

---

## 八、追加复核（修复后，`FilesViewMigration` 返工 R1–R3）

**裁定：R1（F1）、R2（F3）、R3（文档与 legacy 口径）全部闭合；新增一条 P3（F4）——F4 随后被返工二次修复，最终复核见 §九。**

被审状态：返工落在工作区（未提交），产品代码 diff 相对 `c2152f83`；本节 SHA256 为返工后的字节。

### R1（F1，P2）闭合

- **产品改动两处**：`WorkspaceFilePanel.vue` 新增 `expandedPathsLoading`，树所在的分支链首条改成
  `v-if="expandedPathsLoading || (loadingWorkspaceTree && workspaceTree.length === 0)"` →
  读取未就绪时渲染既有加载占位、**树根本不挂载**（没有手势可 emit）；
  `user-record-session.ts` 的 `commit` 去掉 `await open()` 排队重放，改成
  「`session === null || loading` → 写一条可见诊断（`不排队重放`）并返回」。
- **探针 01 重写后实测**（原文，见 §探针表）：
  `[probe-01/files-window] 提交被拒 | 落盘次数 = 0 | 显示 = [] | 诊断 = {"…没完成首次读取…","retryable":false}`；
  放开闸门后显示与记录都回到 `{"paths":["manuscript/","manuscript/vol-1"]}`；
  `[probe-01/settings-window] 提交被拒 | 落盘次数 = 0 | 记录 = {"width":1000,"height":700}`，
  就绪后同一手势落盘 `{"width":1200,"height":700}`（height 不再被默认值顶掉）。
  对照组（就绪后整份数组提交 → 并集）仍绿：差异只来自读取窗口。
- **作者的回归钉**（本轮新增/改写，逐条与探针同口径）：`files-view-session.test.ts`「首读门禁：读取未分类前
  拒绝提交且不落盘，读完后提交的是已确认值以上的并集」、`window-size-session.test.ts` 同名用例、
  `WorkspaceFilePanel.test.ts`「记录读取中就绪前不渲染树（调整控件不可用），就绪后按记录的展开项渲染」。
- **旁的同类窗口**：设置/新建作品对话框在读取窗口内的拖动现在同样只被拒绝、不落盘
  （两个对话框都在挂载时开会话，用户能拖拽时读取早已结束，属加固而非必需）。

### R2（F3，P3）闭合

- 新增 `app/utils/workbench/legacy-record-migration.test.ts`（**15 例**），逐条命中我列的等价类缺口：
  `旧键不可读（unavailable）`、`用户意图在飞（deferred）`、`迁移未确认（commit 失败，且不做回读）`、
  `回读抛错`、`回读不一致`、`记录已是权威时删除失败`、`空旧值`、`不可解析不给重试`，
  以及 `createBrowserLegacyValueStore` 的「没有可用存储（SSR）」「访问存储本身抛错」「删除没有生效」三例。
- 产品侧唯一改动是为该访问器加可注入的存储解析器（默认 `import.meta.client ? window.localStorage : null`）：
  默认路径语义与返工前一致（无存储 → 读作 absent、删除返回 false），且把 `window.localStorage` 的
  **属性访问**移进 try（隐私模式抛错现在归类为 `unavailable` 而不是冒泡），属改善。
  产品调用点只有 `files-view-session.ts:131` 与 `window-size-session.ts:133` 两处，都只传 key（已核对）；
  第二参只出现在新测试里。

### R3（P3）闭合

- 4 处文档不符逐条按实测改对：`WorkbenchViewHost.md:14`（三类「都画出来」→ 说明 hidden 只在没有可见视图时
  作为空态出现，有可见视图时不进 DOM）、`:52`（只有提示行是 `role="status"`，空态不带 live region）、
  `WorkspaceFilePanel.md:9`（提交未确认/旧键没迁完可重试；记录读不到分类不可重试，与壳层同一约定）、
  `:42`（「文件转同名目录」补上「且自身不是 `index.md`」）——四条都与我在 §三 Q8 的实测一致。
- legacy 口径按逐件原因改写：3 个由 `world-engine-ide-entry.test.ts:62-64/963-980` 读取并断言，
  第 4 个（`WorldEngineSubjectStateViewer.vue` 与同目录 `…Row.vue`）只被彼此引用。
  与我的 Q7 结论一致。

### F4（新，P3，交回 **t56**）句柄不可用时 `commit` 既不重连、也顶掉更准确的诊断——**已在 §九 复核为闭合**

- **触发**：首次打开时用户上下文不可用（`openUserContext` 返回 `backend-unreachable`/`identity-unrecoverable`，
  即 `open()` 的 `owned.status !== "ready"` 分支：`opening = null`、`loading = false`、`session` 仍是 null）。
- **行为**（探针 01「F4 探针」实测原文）：
  `原诊断 = "Storage 宿主暂不可达（cold start）" | 提交后诊断 = {"…没完成首次读取…","retryable":false} | 落盘次数 = 0`。
  三点后果：① `commit` 不再触发 `open()`，因此后端恢复后**用户的手势也不会重连**（返工前 `commit` 会
  `await open()` → `opening ??=` 重试并成功）；② `open()` 给出的准确诊断被门禁文案顶掉，
  用户读到的是"读取没完成"（不实）；③ 这条诊断是 `retryable: false`，界面因此不显示「重试」按钮
  （`WorkspaceFilePanel`/两个对话框都是 `v-if="notice.retryable"`），而**唯一**能恢复的 `retry()`
  正好只能从那个按钮到达——只剩刷新页面一条路。这与本模块自己写在失败分支上的注释
  「句柄不可用不是终局：保留重试入口（否则一次冷启动失败会让偏好永久不可读写）」相矛盾。
- **影响**：无数据损坏（记录未被触碰），但偏好写入在本会话内失效 + 诊断不实；刷新即可恢复。
- **最小修复**：把「会话还没建起来」与「读取还在进行」分开处理——`session === null` 时不要覆盖
  `open()` 留下的诊断（或把它并进文案），并让该分支重新触发一次 `open()`（或在诊断里给出
  `retryable: true` 让现有「重试」按钮可达）。`loading` 分支维持现状即可。
- **证据**：`walkthroughs/probes/probe-01-first-read-intent.probe.test.ts` 第 4 例；
  命令与退出码见下。

### 变更文件 SHA256（返工后）

```
f70d23d565be4998e3e3bbee5cc6288814db6300f186f6b41d0379d58cfe9148  app/utils/workbench/user-record-session.ts
ad86199f1b13a7aae6afcd93c62c17d84840e2ea645b1e2b8f218fa6c885263d  app/utils/workbench/legacy-record-migration.ts
4e5398e5bab424ac9d11f79bdb9c9c477583129d9e0dfc8a9c7bd618ad2c1a57  app/utils/workbench/legacy-record-migration.test.ts（新增）
245f5de1c3032f8cc195fcc67092834265040631dbedaa800f277d0e96cb7878  app/components/novel-ide/workspace/WorkspaceFilePanel.vue
9238a9f6fc3003fd9a435b3b454db518b2395a1df99875875d3ab012e4b34779  app/components/novel-ide/workspace/WorkspaceFilePanel.test.ts
100726229adf119c1f9f1b53855b42d3bc368eee83d6c87cc9a4f35eae749da3  app/utils/workbench/files-view-session.test.ts
29377dc4fb72fc700f32709828ab1dfcdc543a932911ec493c3941167fe92333  app/utils/workbench/window-size-session.test.ts
1d700f6be248bde8daf222d310883f1c92f3e9594b92e00b1c8e91a545c9aebf  app/components/workbench/WorkbenchViewHost.md
b6d8874531d2db56c9ace02586cc1b152b2c128b550643d24c0ec3b62f4abb16  app/components/novel-ide/workspace/WorkspaceFilePanel.md
# 未变（与 §五.1 相同，抽两件作核对点）
f383ae7003549158a044330dfb1622e0eb4dc2cd960468ba7c917dadf755c92e  app/utils/workbench/files-view-session.ts
8df30471f57a5f92289ab3cb8fefe30309c953f70e12198d627df123164fab52  app/components/workbench/WorkbenchViewHost.vue
```

### 追加复核的命令与退出码

| # | 命令（cwd = worktree 根） | 退出码 / 结果 |
|---|---|---|
| 1 | `bunx vitest run --config .agents/works/.../t60-view-migration-review/walkthroughs/probes/vitest.probes.config.ts` | **exit 0**，`Test Files 3 passed (3)`、`Tests 15 passed (15)`（探针 01 重写后含 4 例） |
| 2 | 同上 `-t "files 展开项"`（F1 最小复现） | **exit 0**，1 passed / 14 skipped |
| 3 | `git diff c2152f83 -- <被审文件>`（逐处读改动） | 见 §八 各条 |
| 4 | `grep -rn "createBrowserLegacyValueStore(" packages/neuro-book/app` | 产品调用点 2 处，都只传 key；第二参只在新测试 |
| 5 | `sha256sum <返工后文件>` | 见上表 |

### 未验证项（追加复核后仍未变）

- 真实浏览器与真实存储宿主：本轮复核仍未起 dev server、未动 3001（约束不变），F1 的窗口时长与
  F4 的现场表现都只有探针级证据（会话层 + jsdom 挂载）。
- `bun run typecheck` / 全量测试 / Lab smoke：由返工方与 Leader 跑（其 walkthrough §七 记录），本轮未复跑。

---

## 九、F4 二次复核与最终裁定（`a16d9edb` 之后的未提交修复）

**最终裁定：无需修复（`overall_correctness = correct`）。** F1、F3、F4 全部闭合；Q1/Q2/Q3/Q4/Q5 的既有结论在新 revision 上复验仍成立。

### 复核实况（务必先看这条）

- 返工 commit `a16d9edb`（`fix(workbench): gate the file tree on the first read`，Main 复核过）**不含** F4 的修复：
  我核对时 `packages/neuro-book/app/utils/workbench/user-record-session.ts` 仍处于 **modified**，
  即该文件的 F4 修复（以及 `files-view-session.test.ts` 新增的对应回归用例）**尚未提交**。
  本节结论对应的是**工作区**（hash 见下），不是 `a16d9edb` 的树；实现者提交后请以本文 hash 核对。
- 我复核的两个 hash（`sha256sum`）：

```
019347d059333d8711c92999b83fc08df33bb315d0c773b89152d091898d998d  app/utils/workbench/user-record-session.ts（F4 修复）
c3dd2e0fd2aea65bb84ddc25b11268bbc34830b5286d3648a21c0119af3d67ef  app/utils/workbench/files-view-session.test.ts（F4 回归用例）
```

### F4 闭合（实测原文）

修复内容与我给的最小修复一致：`session === null` 与 `loading` 分流——`loading` 期间仍旧拒绝并写门禁诊断；
`session === null`（句柄不可用）时**保留 `open()` 的准确诊断**、把它的 `retryable` 改为 `true`（「重试」按钮因此可达）、
并顺手 `void open()` 再连一次；本次基于默认显示的意图仍然**不写盘**（重放正是要挡的覆盖）。

探针 01「F4 复核」实测（原文）：

```
[probe-01/owner-down]      诊断 = {"diagnosis":"Storage 宿主暂不可达（cold start）","retryable":true} | 落盘次数 = 0 | 显示 = []
[probe-01/owner-recovered] 记录 = {"paths":["manuscript/","manuscript/vol-1","lorebook/"]}
```

三件事同时成立：① 准确诊断没被门禁文案顶掉且带可达的重试入口；② 后端仍不可达时的整份数组意图不落盘；
③ 后端恢复后同一手势顺带重连，记录随即读到（显示回到已确认的两条），再提交落盘为并集——**会话内即可恢复，不必刷新**。
实现者另在 `files-view-session.test.ts` 加了同口径回归用例
「句柄不可用：commit 不覆盖准确诊断、不落盘，并自己重试连接（后端恢复后同一手势落盘）」，与本探针互为双钉。

### 复验「未被破坏」的部分（在新 revision 上重跑）

| 声明 | 复核方式 | 结果 |
|---|---|---|
| Q1 迁移原语：回读失败/删除失败/双 retry/双会话都保留旧键、记录不被覆盖 | 探针 02（5 例） | 全绿（与首轮同口径，原语本身本轮未再改） |
| Q2 单写者：三处记录各一条写路径，产品代码只剩迁移原语一处 `localStorage` | `grep` 全仓（命令见下） | 成立；返工只加了渲染门禁与会话拒绝，没有新增写路径 |
| Q4 定义与注册：唯一入口 + 幂等 | `grep registerProductStorageDefinitions()` | 仍只有 `server/plugins/storage-definitions.ts:11` 一处调用 |
| Q5 视图解析与两处注入缝隙的缺省路径 | 探针 03（6 例） | 全绿；`WorkbenchViewHost.md` 修正后与实测一致 |
| 探针 01 的主结论（窗口内被拒 + 就绪后并集） | 探针 01（4 例） | 全绿 |

### 最终命令与退出码

| # | 命令（cwd = worktree 根） | 退出码 / 结果 |
|---|---|---|
| 1 | `bunx vitest run --config .agents/works/.../t60-view-migration-review/walkthroughs/probes/vitest.probes.config.ts` | **exit 0**，`Test Files 3 passed (3)`、`Tests 15 passed (15)` |
| 2 | `git diff a16d9edb --stat` | 7 files（4 件我的探针/记录 + 用户 dirty 2 件 + `user-record-session.ts`）→ 说明 F4 修复未提交 |
| 3 | `sha256sum <23 个被审文件>`（`packages/neuro-book`） | 见下 |
| 4 | `grep -rn "localStorage\.\(setItem\|removeItem\|getItem\)" app/ --include=*.ts --include=*.vue` | 产品代码只剩迁移原语与两处无关模块 |
| 5 | `grep -rn "registerProductStorageDefinitions()" server/` | 唯一入口 |

### 最终 SHA256（工作区；标 ★ 者与 §八 表不同）

```
019347d059333d8711c92999b83fc08df33bb315d0c773b89152d091898d998d ★ app/utils/workbench/user-record-session.ts
ad86199f1b13a7aae6afcd93c62c17d84840e2ea645b1e2b8f218fa6c885263d   app/utils/workbench/legacy-record-migration.ts
4e5398e5bab424ac9d11f79bdb9c9c477583129d9e0dfc8a9c7bd618ad2c1a57   app/utils/workbench/legacy-record-migration.test.ts
245f5de1c3032f8cc195fcc67092834265040631dbedaa800f277d0e96cb7878   app/components/novel-ide/workspace/WorkspaceFilePanel.vue
9238a9f6fc3003fd9a435b3b454db518b2395a1df99875875d3ab012e4b34779   app/components/novel-ide/workspace/WorkspaceFilePanel.test.ts
c3dd2e0fd2aea65bb84ddc25b11268bbc34830b5286d3648a21c0119af3d67ef ★ app/utils/workbench/files-view-session.test.ts
29377dc4fb72fc700f32709828ab1dfcdc543a932911ec493c3941167fe92333   app/utils/workbench/window-size-session.test.ts
1d700f6be248bde8daf222d310883f1c92f3e9594b92e00b1c8e91a545c9aebf   app/components/workbench/WorkbenchViewHost.md
b6d8874531d2db56c9ace02586cc1b152b2c128b550643d24c0ec3b62f4abb16   app/components/novel-ide/workspace/WorkspaceFilePanel.md
f383ae7003549158a044330dfb1622e0eb4dc2cd960468ba7c917dadf755c92e   app/utils/workbench/files-view-session.ts
c3625e004249cd42501dc132bd1e73a8483c464880bc7a792af960c6dca6c6cb   app/utils/workbench/window-size-session.ts
31264cd38d8d54e653df6717521d055d04f3c1e2f8ac353002991bc24b852096   app/utils/workbench/world-engine-session.ts
1055e0a0c247d1bb8deced5a2d715dc028187c3114d768b5c125866cfc8da147   app/utils/workbench/product-catalog.ts
130d3785a76dd67ca0bc04ecfd5b118905f330d1aa340ef889de825fef988636   app/utils/workbench/view-factories.ts
8df30471f57a5f92289ab3cb8fefe30309c953f70e12198d627df123164fab52   app/components/workbench/WorkbenchViewHost.vue
51fdf38a19567b54d7d444c37a6194f4c279bc0fe1137fe41787fe99e74689a3   shared/storage/workbench-files.ts
bf2db6e4cf0d41b5cad5694b9e73df5e21eb6cf29da471bd27803a34c820536a   shared/storage/workbench-window-sizes.ts
2f5d400f2574f6d16d033a58023d3062afc03d4d8879a08bf60d56edf93c0114   shared/storage/workbench-world-engine.ts
a01206a1e9cee4e1d9025e0d23ee0b3206b0871177e429bc598f4977fc2f56e9   server/storage/product-definitions.ts
02178019e7f9c77e47761de42947641702c758ef735571064f907a338e8e65a9   app/utils/world-engine-workbench-preview.test.ts
d762d26b96e46834fc998b82ab3e2717da7740ab711e52792060f5c2dd03446c   app/components/novel-ide/NovelIdeSettingsDialog.vue
bd1358e0473fb610043ae5771b764e9c9d2c3a3896516dad6b62d2ce99f551b8   app/components/novel-ide/project-picker/components/ProjectCreateDialog.vue
61e567a587d23bd2380fc0a53bcf6751ebc8cfb56e162e3bcb7cbf02c174c63b   app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue
```

### 残余观察（均非阻断，留给实现者判断）

1. 句柄不可用那条诊断现在带「重试 / 放弃」两个按钮，但 `abandon()` 在该状态下是空操作
   （`session.value?.abandon()` 无会话可弃，`publish()` 又因 `session === null` 直接返回），
   即「放弃」不消除诊断。语义上没错（没有待弃意图），但按钮看着能用却什么都没发生。
2. 同一状态下用户的手势会被丢弃且**没有专门文案**：诊断条仍显示宿主不可达（准确），
   树不会展开（记录读不到、显示就是默认）。规范允许「读取失败后可选提供暂时调整」，故不判缺陷。
3. 首轮 §六 的 5 条非阻断观察仍然有效（墓碑语义、`issues.at(-1)` 诊断取法、提示条未 i18n、
   `canToggleVisibility/canMoveView=false` 与提案范围的差距、Lab fixture 边界）。

### 仍未验证项（最终）

- 真实浏览器与真实存储宿主：本轮复核全程只读、未起 dev server、未动 3001；F1/F4 的证据是
  会话层（真实记录会话 + 内存传输）与 jsdom 挂载级，不含真实界面时序。
- `bun run typecheck` / 全量测试 / Lab smoke：由返工方与 Main 跑（其 walkthrough §七 与 Main 的复核记录），本轮未复跑。
- 工作区仍在变动：若实现者在本文之后继续改动 `user-record-session.ts` 或探针之外的产品文件，
  请以新 hash 重新触发本 Task 的追加复核。

### 残余观察的归档结论（实现者回应后）

实现者按「不收，只记录」处理，理由我已复核，均成立：① 面板用**同一个** `retryable` 标志同时决定「重试 / 放弃」两个按钮（三处提示条同形，属既有约定），要在该状态隐藏「放弃」得给通知加一个「可放弃」维度，是提示条契约改动，留到统一诊断文案时一起收；② 手势被丢弃时保留宿主不可达那条诊断（重连后树按记录重画，用户能看到结果），而重放基于默认显示正是首读门禁要挡的覆盖，故不补专文。两条已记入 t56 的「未运行项与偏差」。因此两条都不构成本增量的缺陷，§九 的最终裁定不变（`correct`，无待修项）。提交动作不在实现者约束内（归 Main），待提交清单与 hash 已报 Main。
