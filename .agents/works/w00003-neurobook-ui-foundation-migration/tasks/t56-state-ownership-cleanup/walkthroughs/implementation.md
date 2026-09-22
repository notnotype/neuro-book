# 切片 2.6/2.7 收尾实施记录：World Engine 内部尺寸归属 + 设置窗口尺寸归属 + 四处过时文档

Work：`.agents/works/w00003-neurobook-ui-foundation-migration`；Task：`tasks/t56-state-ownership-cleanup`。
工作区：`.worktree/w00003-neurobook-ui-foundation-migration`（分支 `refactor/w00003-nb-ui-adoption`）；命令 cwd 逐条标注。

## 一、交付物与范围

| 项 | 值 |
|---|---|
| 产品代码（新增，A/B 共用底座） | `shared/storage/workbench-world-engine.ts`（World Engine 尺寸定义）、`shared/storage/workbench-window-sizes.ts`（两个窗口尺寸定义）、`app/utils/workbench/legacy-record-migration.ts`（旧裸键一次性迁移原语 + 浏览器旧键访问器）、`app/utils/workbench/user-record-session.ts`（user/local 记录会话接线：上下文 → owner → 记录会话 → 迁移） |
| 产品代码（新增，A/B 会话） | `app/utils/workbench/world-engine-session.ts`（project/local 三个面板尺寸）、`app/utils/workbench/window-size-session.ts`（设置窗口 + 新建作品对话框） |
| 产品代码（修改，A） | `WorldEngineWorkbenchDialog.vue`（三处尺寸改建记录、新增 `surface` prop、提示条）、三个 `workbench-preview/*.vue`（`resizeDisabled` prop；拖拽结束才提交一次）、`app/pages/index.vue`（传 `:surface="workbenchLayoutSurface"`） |
| 产品代码（修改，B） | `NovelIdeSettingsDialog.vue`、`project-picker/components/ProjectCreateDialog.vue`（尺寸改建记录、删裸键读写、提示条、min 尺寸取共享常量） |
| 产品代码（修改，注册） | `server/storage/product-definitions.ts`（清单**一次**追加 3 条定义 + 头部 scope/locality 说明） |
| 产品代码（修改，抽取等价重构） | `app/utils/workbench/files-view-session.ts`（`-295/+?` 行：删自带迁移与浏览器旧键访问器，改用上面两个共用模块）、`files-view-session.test.ts`（旧键替身类型改引共用类型、两条解析断言换成 `value` 形状） |
| 文档（C） | `settings/sections/{providers,web,security,desktop}/*.md` 四处「旧面板/旧宿主继续负责…产品接线时再消费本视图」改为与实现一致；`ProviderSettingsView.types.ts` 同源过时注释；清单 §2.6/§2.7 状态与 `RolesSettingsView` 决策登记 |
| 聚焦测试（新增） | `app/utils/workbench/window-size-session.test.ts`（11 例）、`app/utils/workbench/world-engine-session.test.ts`（8 例） |
| 记录定义（落盘地址） | `workbench.layout`/`world-engine-sizes`（project/local、`single`、默认 320/420/292）；`workbench.layout`/`settings-dialog-size`（user/local、`single`、默认 1120×640）；`workbench.layout`/`create-project-dialog-size`（user/local、`single`、默认 580×360）。注册入口只有 `server/storage/product-definitions.ts` 一处 |
| 未改 / 不删 | `app/utils/workbench/descriptors{,.test}.ts`（用户 dirty，一字未动）；四个 World Engine legacy 组件（见 §三.4）；`shared/storage/workbench-{state,files,shell-layout}.ts`、`layout-session.ts`、`WorkbenchShell.vue`、`server/plugins/storage-definitions.ts` |
| 排除（未做） | World Engine 整页迁入 View Host、`agent/**`、`markdown-studio/**`、Plot、文件树（上一增量已交付）、Config authority（`/api/config/*`） |

## 二、命令与退出码（真实命令、cwd、结果）

| # | 命令（cwd） | 结果 |
|---|---|---|
| 1 | `bun run --cwd packages/neuro-book test app/utils/workbench/{files-view-session,window-size-session,world-engine-session,shell-layout,layout-session}.test.ts app/components/novel-ide/workspace/WorkspaceFilePanel.test.ts app/utils/world-engine-ide-entry.test.ts`（worktree 根） | **exit 0**，`Test Files 7 passed (7)`、`Tests 59 passed (59)` |
| 1b | 同上（最终一遍，落盘后复跑） | **exit 0**，7 files / 59 tests passed |
| 1c | `bun run typecheck`（**`packages/neuro-book`，Leader 在本窗口显式放行**：3001 已由 Main 停止、`.nuxt` 允许重建） | **exit 0**（完整输出见 `TYPECHECK_EXIT=0`；含全部 `.vue` SFC，这是本轮唯一的全包类型门禁） |
| 1d | 逐文件跑「读过本次改动文件」的全部测试：`novel-ide-settings-{current-project,responsive}.contract`、`server/config/settings-security-contract`、`novel-ide-profile.contract`、`agent-jobs-wiring`、`novel-writing-mode-entries`、`project-route-transition.contract`（7 files / 24 tests）；`server/storage/workbench-migration-e2e`（4）；`app/component-lab/fixtures/index`（4）；`app/utils/world-engine-workbench-preview`（8） | 全部 **exit 0**（24 + 4 + 4 + 8 = 40 例） |
| 2 | 同四条：`…/shell-layout.test.ts …/layout-session.test.ts …/WorkspaceFilePanel.test.ts …/world-engine-ide-entry.test.ts --reporter=verbose`（worktree 根，取逐文件用例数） | **exit 0**，`Test Files 4 passed (4)`、`Tests 27 passed (27)`；逐文件：`layout-session` 13、`shell-layout` 7、`WorkspaceFilePanel` 6、`world-engine-ide-entry` 1 |
| 3 | `bunx tsc --noEmit -p tsconfig.json`（`packages/neuro-book`，只读、不重建 `.nuxt`） | 见 §四.2；本次改/新增文件**零错误** |
| 4 | `bun run docs:check`（worktree 根，只读） | **exit 0**，`{"failures":[],"checkedFiles":5889}` |
| 5 | `git status --porcelain` / `git diff --stat`（worktree 根，每次落盘后） | 18 个已跟踪文件 modified + 8 个新文件；用户 dirty `descriptors{,.test}.ts` 未被触碰；**未 `git add`、未 commit、未 push** |

## 三、实现要点

### 3.1 A：World Engine 三处尺寸 → project/local 记录

1. **归属与定义**：`persistence.md:95` 把「主工作台左右侧栏尺寸、World Engine 内部尺寸」列为 project/local（`boundaries.md:121`）。新定义 `workbench.layout`/`world-engine-sizes`（`scope: "project"`、`locality: "local"`、`records: "single"`、`schemaVersion: 1`）与外壳 grid 快照 `workbench.layout`/`layout` 同 owner 但独立寻址，互不覆盖。三个字段**都可缺省**（缺失 = 该字段没有已确认值，不补默认值记录），与 `WorkbenchSurfaceSizes` 同一口径。
2. **默认值唯一来源**：组件里的 `defaultSidebarWidth/…Inspector/…MutationEditorHeight`（320/420/292）删除，搬到 `shared/storage/workbench-world-engine.ts` 的 `WORKBENCH_WORLD_ENGINE_DEFAULT_SIZES`，只用于"缺失记录时的显示回落"；组件与记录里不再各留一份数值。
3. **会话**（`world-engine-session.ts`）：Project 记录必须绑定服务端签发的精确 ready，因此工作面由新 prop `surface`（`index.vue` 传 `workbenchLayoutSurface`，与 `WorkbenchShell` 同一份事实）决定——只有 `kind === "project"` 才借 `projectOwner` 打开记录；其余工作面只回落默认值、不落盘、不借用 user 记录（`persistence.md:96`）。`commit()` 先等工作面接线与首读分类完成（首读门禁），因此拖动结束的提交不会因为"还在读"被丢掉。
4. **提交时机**：三个 `useResizablePanel` 去掉 `syncDuringResize` 与拖拽中的 `onResize` emit，只在 `onResizeEnd` emit 一次 → 宿主 `commit()` 一次（`persistence.md:104`「拖拽期间只更新本地意图与当前显示；主动调整结束后提交」）。读取就绪前手柄不可用（新增只读 prop `resizeDisabled`，来源 `panelSizes.loading`）。
5. **不静默**：记录不可读/未保存时，工作台顶部显示一行诊断（`data-testid="world-workbench-panel-sizes-notice"`）带「重试 / 放弃」。
6. **无裸键、无第二写路径**：`world-engine-ide-entry.test.ts:608` 的 `not.toContain("localStorage")` 仍通过；三处尺寸只有 `update*Width/Height` → `panelSizes.commit` 一条写路径。

### 3.2 B：两个裸尺寸键 → user/local 记录

1. **归属与定义**：`persistence.md:97`「书架显示模式、普通设置窗口尺寸」= user/local，与书架模式同 owner `workbench.layout`，两个对话框各占一键（独立寻址）。
2. **迁移（一次性）**：`legacy-record-migration.ts` 实现「读旧键 → 记录缺失时条件初始化 → `handle.read` 回读与本次写入一致 → 删旧键」；记录已有值时**不覆盖**，只做一次性收尾。不可读、不可解析、记录不可写/损坏、迁移未确认、回读失败或不一致、删除失败七类都**保留旧键**并给出可重试/不可重试的诊断（与 `files` 展开项同一套语义与文案模板，`label` 区分记录）。
3. **显示与存储分离**：记录只存用户拖出来的整数像素；显示按最小尺寸夹紧（720×420 / 320×330，与旧 `MIN_*` 逐字段相同）；旧键里的超小尺寸在解析时就夹紧，保证"写入 → 回读"一致、旧键能真正删掉。
4. **组件**：两个对话框各自持有会话，`@update:width/height`（`DialogWindow` 只在指针抬起或键盘步进时 emit）→ `commit`；`localStorage` 读写函数与旧键常量全部删除，记录提示条同上（`data-testid="…-window-size-notice"`）。

### 3.3 `files-view-session.ts` 抽取的范围与等价性（Leader 点名）

- **抽取了什么**：① 旧键访问器（`browserLegacyStore` → `createBrowserLegacyValueStore(key)`，泛化到任意键）；② 迁移算法 `migrateLegacyStoreRecord → migrateLegacyRecord({session, handle, definition, store, label, parse, isEmpty, same})`（`deferred/settled/notice` 三态返回，诊断文案由 `label` 参数化）；③ user/local 记录会话接线（上下文、owner 借用、`createLayoutRecordSession`、`publish` 的 notice 优先级 pending > blocked > migration、`commit/retry/abandon/release`）= `useUserRecordSession`。
- **等价性**：`files-view-session.ts` 的对外 API 未变（`LEGACY_FILE_TREE_EXPANDED_PATHS_KEY`、`normalizeExpandedPaths`、`sameExpandedPathSet`、`parseLegacyExpandedPaths`、`useWorkbenchFileTreeExpandedPaths` 及其 consumer/notice/options 类型）；`expandedPaths` 从"publish 时写入的 ref"改为"对会话显示的 computed"，外部只见只读 ref。唯一**形状变化**是 `parseLegacyExpandedPaths` 的返回值由 `{paths, diagnosis}` 改为 `{value, diagnosis}`（`value` 在不可迁移时为 `null`，由类型强制"只有 diagnosis 为 null 才可信"），测试断言同步改了两条。
- **证据**：`files-view-session.test.ts` 13 例全绿（首读门禁、缺失不写默认值、旧键迁移、已有记录不被覆盖、空旧值收尾、不可解析保留旧键、回读不一致、记录损坏、冲突不静默、放弃、旧键名未改名）；`WorkspaceFilePanel.test.ts` 6 例全绿（挂载零浏览器存储读写、唯一写路径、诊断可见带重试/放弃）。

### 3.4 C：文档与 legacy 决策

- 四处过时句改为与实现一致：providers（四个会话与 I/O 在宿主侧 `useProviderSettingsBinding`）、web（`webDraft` = `useSectionDraft` 承担快照读写与 `saveGlobal`；删掉「旧面板 `applySettings()`」括注）、security（宿主 `useAuthSessionState()` → `bootAuthEnabled` → prop）、desktop（宿主 `updateDesktopSettings` 调 `bridge.updateSettings`；「旧宿主用 `desktopAvailable` 判断」→「宿主用…」）。`NovelIdeSettingsPanel`/`NovelIdeWebSettingsPanel` 等旧面板在仓库里已不存在，文档不再引用。
- 清单 §2.6/§2.7：状态行、尺寸归属条、真实功能缺口、旧实现删除条件、结尾「旧实现待删除」表 6/7 行全部改为与本轮实现一致，并**登记 `RolesSettingsView` 决策**：保持不挂（后端角色契约尚不存在），等「角色面」切片接线；本 Task 不改宿主分发、不删 fixture 与视图。
- **4 个 legacy 组件未删（待办，原因逐件不同）**：全仓零引用已核对（除历史文档与 `world-engine-ide-entry.test.ts`）。其中**3 个**被契约测试仍读取并断言内容——`world-engine-ide-entry.test.ts:62-64` 读 `WorldEngine{SliceInspector,StateSummary,Timeline}.vue`、`:963-979` 断言其内容；删除它们会直接让该测试失败，故「契约测试许可」不成立。**第 4 个** `WorldEngineSubjectStateViewer.vue`（连同同目录 `…Row.vue`）只是两者互为引用，删它不会让任何测试失败，属另一处待清理项。待办已写进清单 §2.6：删除需连同该测试的相应断言一起改（删文件 + 把「禁回流」断言改成「文件不存在」），属 legacy 清理切片。

## 四、验证

### 4.1 聚焦测试（本次新增 19 例；回归 40 例）

| 文件 | 覆盖 |
|---|---|
| `window-size-session.test.ts`（11） | `parseLegacyWindowSize` 的四种不可迁移/夹紧解析；**首读门禁**（读取未分类前不落盘、读完后写一次，含记录路径 + 落盘 JSON）；**记录缺失不写默认值**；**旧键迁移（记录缺失）**：条件初始化一次 + 回读一致后删旧键；**旧键迁移（记录已存在）**：只删旧键、记录不被覆盖；旧尺寸低于最小尺寸 → 夹紧后写入且仍能收尾删键；旧键不可解析 → 不迁移不删除 + 诊断；**冲突不静默**（未确认意图 + 诊断 + 重试后写一次）；两个键互不串写（新建作品对话框不碰设置窗口记录）；旧键名未改名 |
| `world-engine-session.test.ts`（8） | 首读门禁（含记录路径 + 只写本次拖动字段的 JSON）；记录缺失不写默认值；已确认记录恢复（缺字段回落默认）；相邻面板不被覆盖（原件未知字段保留）；冲突不静默（重读后只重放本次主动字段 + 重试收口）；放弃回到已确认值；非 Project 工作面不恢复不落盘；切 Project 换记录（同一 ready 代次不重复进入） |
| 回归：`files-view-session` 13、`layout-session` 13、`shell-layout` 7、`WorkspaceFilePanel` 6、`world-engine-ide-entry` 1 | 抽取等价性（§3.3）、工作台记录既有语义、产品定义注册表（含新增 3 条定义后 `productStorageDefinitions()` 的交叉断言）、文件面板接线、World Engine 契约（含 `not.toContain("localStorage")` 与三个尺寸相关 UI 断言） |
| 回归（其它读过本次改动文件的测试）：`world-engine-workbench-preview` 8、`settings-*contract`/`profile.contract`/`agent-jobs-wiring`/`novel-writing-mode-entries`/`project-route-transition` 共 24、`workbench-migration-e2e` 4、`component-lab/fixtures` 4 | 三栏 UI 契约（含尺寸写路径唯一性与「拖拽不逐帧回写」）、设置窗口宿主契约、`pages/index.vue` 契约、产品定义注册表跨重载幂等 |

**合计**：新增 19 例 + 回归 80 例 = 99 例、17 个测试文件，全部通过（另见 §4.4 的一处契约测试修订）。 |

### 4.2 类型检查（只读）

`bunx tsc --noEmit -p tsconfig.json`（cwd `packages/neuro-book`）：按本次改/新增文件过滤（`workbench/(window-size|world-engine|user-record-session|files-view-session|legacy-record-migration)`、`shared/storage/workbench-(window-sizes|world-engine)`、`product-definitions`、`NovelIdeSettingsDialog`、`ProjectCreateDialog`、`world-engine/*`、`pages/index.vue` 及两个新测试）**零错误**。过程中它抓出一处真错并已修：`user-record-session.ts` 用 `readonly(display)` 暴露泛型 `T` 时，`Readonly<Ref<T>>` 与 `DeepReadonly<T>` 不兼容（编译期失败），改为在消费边界收成只读引用并留注释。同一次运行的全部错误 88 条，逐文件计数全部落在本次未触碰的文件：`../nb-ui/src/components/index.ts` 62（`*.vue` 类型再导出，t55 报告已记为既有）、`app/components/workbench/workbench-grid-consumers.test.ts` 24（mount/VNode 类型）、`sections/frontend/FrontendSettingsView.types.ts` 1（同类 `*.vue` 类型再导出）、`LowCodeCheckboxField.test.ts` 1（TS2589）——与本次无关，未修。

### 4.4 被本次改动破坏的既有契约测试（已修）

`app/utils/world-engine-workbench-preview.test.ts` 用源码文本钉住三栏尺寸的**旧实现**，本轮改动让它失败（首次运行：`1 failed | 7 passed`）。按「测试不许钉实现细节、也不许把旧断言改成新文本」的口径，改法是把它钉的**旧行为**换成**新契约**：

| 位置 | 旧断言（已删） | 新断言 |
|---|---|---|
| dialog 三栏（14 行） | `defaultSidebarWidth`/`ref(defaultSidebarWidth)`/`@update:width="sidebarWidth = $event"` 等 | 尺寸来自 `useWorldEnginePanelSizes({surface: …})`；三个默认值常量**不再存在**（`not.toContain`）；每个面板一条写路径 `panelSizes.commit({…})`；模板仍绑 `:width/:height` |
| sidebar / inspector / editor（各 1 行） | `onResize: (…) => emit("update:…")`（拖拽中逐帧回写） | `not.toContain("onResize:")` + `not.toContain("syncDuringResize: true")` + 保留 `onResizeEnd` 提交断言（一次手势只提交一次） |

修订后 `world-engine-workbench-preview.test.ts` **8 passed**。这是本轮唯一改动的既有测试；`files-view-session.test.ts` 只改了替身类型引用与两条解析断言形状（§3.3）。

### 4.3 落盘与回读证据（来自聚焦测试，未起真实宿主）

- **证据形态**：两个新测试都走**真实记录会话**（`createWorkbenchLayoutSession` 之外的 `createLayoutRecordSession`、真实 `openStorageOwnerHandle`、真实读取分类与条件写），只把 HTTP 传输与身份换成内存替身——因此断言里的记录地址与 JSON 就是产品实现发出的地址与写入体。
- **记录路径与 JSON**：`project:<projectRoot>/workbench.layout/world-engine-sizes/` = `{"sidebarWidth":300}`（只写拖过的字段）；`workbench.layout/settings-dialog-size/` = `{"width":1000,"height":700}`（首读门禁用例）与 `{"width":980,"height":700}`（旧键迁移用例）；`workbench.layout/create-project-dialog-size/` = `{"width":640,"height":400}`。
- **回读验证**：迁移路径在删除旧键之前会用 `handle.read(definition)` 回读并比对（集合/逐字段），不一致则保留旧键并给可重试诊断；测试用「写入后立刻被另一写者改写」构造不一致，断言旧键保留。
- **磁盘落点 `[INFERENCE]`**：按上一增量（t55）在真实宿主观察到的布局，三条记录会落在 `<state root>/workspace/.nbook/storage/<身份>/<主体>/local/<客户端>/workbench.layout/records/{world-engine-sizes,settings-dialog-size,create-project-dialog-size}.json`（同一宿主的分区布局，未在本轮观察）。**未在本轮做真实宿主观察**：3001 属开发者（禁止启停），本 worktree 也不得另起 dev server（共享 `.nuxt`）；Task README 明确「A 与 B 的持久化行为可用聚焦测试 + 对 3001 的只读观察覆盖」。

## 五、未运行项与偏差（明确列出）

- **`bun run typecheck` 的条件**：Task 约束禁止它的唯一原因是「编辑会触发 Nitro 重建、可能带走正在使用的 3001」。Leader（Main）在本轮**先停止 3001** 并显式开放该窗口后，我才运行它 → **exit 0**（§六）。约束的理由消失后该检查才在范围内成立；未借此扩大任何其它动作（不起 dev server、不做浏览器验收、不动 3001）。
- **未运行**：全量 `bun run test`、Lab smoke（`smoke:component-lab`）、Product 门禁与构建、桌面宿主回归、真实浏览器验收（理由见 §4.3）。
- **服务端改动**：`server/storage/product-definitions.ts` 与其它改动**一次落盘**（3 条定义同批），落盘前已 `hub send` 报 Main；未启停/重启 3001，未起第二个 dev server。该文件用 `globalThis` 槽缓存定义清单，同一进程内清单变化需真正重启 Nitro（文件头既有说明）。
- **偏差 1（legacy 四件未删）**：见 §3.4，已在清单 §2.6 记待办。
- **偏差 2（Lab fixture 边界）**：`ProjectCreateDialog` 的 Lab 场景挂的是真身组件，改动后它会开一次 user Storage 上下文并读 `workbench.layout/create-project-dialog-size`（旧实现是读写裸 `localStorage`——同样不满足 `boundaries.md:106`「fixture 不读写产品 Storage」，只是介质不同）。本轮**未修**：要么给对话框加一个可注入的尺寸记录接缝，要么按 Lab 的标签机制给该组件补 `.md` 声明。两案都超出本 Task 范围（Lab 侧改动 / 新增组件文档），与偏差 1 一并记待办。
- **偏差 3（提示条文案）**：三处提示条用字面量「重试 / 放弃」+ Storage 层的中文诊断，未新增 i18n 键（`WorkspaceFilePanel` 用的是 `t(...)`）；诊断文案本身目前只有中文，等统一诊断本地化时一起收口。
- **偏差 4（对象记忆）**：World Engine 的选中 slice/subject、筛选、折叠仍是组件内存态，未并入 project/local（清单 §2.6 ⑥ 建议的第二项，不在本 Task 范围）。
- **偏差 5（清单行号）**：清单 §2.7 ① 引用的 `NovelIdeSettingsDialog.vue` 行号（如 `:927/952-956`）因本次改动下移若干行，未逐条重算（清单行号本就随实现漂移）；本次只改状态与结论性表述。
- **偏差 6（F4 的两条残余观察，复核者提出，本轮判断为「不收、只记录」）**：① 句柄不可用那条诊断现在 `retryable: true`，界面因此同时画「重试 / 放弃」，但 `abandon()` 在该状态空操作（无会话可弃、`publish()` 因 `session === null` 直接返回）——根因是面板用一个 `retryable` 标志同时决定两个按钮（三处提示条同形），要在该状态隐藏「放弃」得给通知加「可放弃」维度，属提示条契约改动，不在本轮；② 该状态下用户手势被丢弃时只有宿主不可达那条诊断，没有专门文案——重连后树按记录重画（用户能看到结果），且该意图基于默认显示、重放反而是缺陷（F1），故作罢。两条等统一诊断文案/提示条契约时一起收。
- **未提交**：未 `git add`（更未对目录 add）、未 commit、未 push；F4 修复的两个文件（`user-record-session.ts`、`files-view-session.test.ts`）由 Main 落 commit（复核者已按其 hash 归档）。

## 六、门禁

| 命令（cwd） | 结果 |
|---|---|
| `bun run docs:check`（worktree 根） | **exit 0**，`{"failures":[],"checkedFiles":5889}` |
| `bunx tsc --noEmit -p tsconfig.json`（`packages/neuro-book`） | 本次改动文件零错误；全仓 88 条既有错误全在未触碰文件（§4.2） |
| `bun run typecheck`（`packages/neuro-book`，Leader 显式放行的窗口内） | **exit 0**——全包（含 `.vue`）类型门禁通过 |

## 七、返工（t60 复核裁定「需修复」，R2 / R3）

要求见 [`t60/walkthroughs/leader-rework-requirements.md`](../../t60-view-migration-review/walkthroughs/leader-rework-requirements.md)；复核 F3 / Q7 / Q8 见 [`review.md`](../../t60-view-migration-review/walkthroughs/review.md)。

### R2（P3）共享迁移原语的保留分支与浏览器旧键访问器补测

复核的等价类缺口：两个会话测试的旧键替身只能产 `absent` / `value` 且 `remove()` 恒 `true`，于是 `legacy-record-migration.ts` 的三条保留分支（`unavailable`、`deferred`、迁移未确认）与整个 `createBrowserLegacyValueStore` 零测试。

- **新增** `app/utils/workbench/legacy-record-migration.test.ts`（15 例，会话/句柄/旧键按原语真正用到的面收窄成替身，**不改产品语义**）：
  - 原语分支：absent（不碰存储）；`unavailable`（保留旧键、诊断可重试）；旧值不可解析（保留旧键、不给重试）；记录不可写（保留、可重试）；`deferred`（用户意图在飞 → 本轮不碰旧键）；记录已是权威（不写记录、只收尾；删除失败则保留）；空旧值（只收尾）；**迁移未确认**（`commit` 返回 `unsaved`/`rejected`：保留旧键、可重试、且**不做回读**）；回读抛错 / 回读不一致（保留、可重试）；回读一致（删除成功 → settled，删除失败 → notice）。
  - `createBrowserLegacyValueStore`：没有可用存储（SSR）读作 `absent`、删除返回 `false`；**访问存储本身抛错**（隐私模式 / 被策略禁用）读作 `unavailable`（带诊断）、删除失败；有存储时读到原值、删除后确认不存在；存储拒绝删除（`removeItem` 不生效）时 `remove()` 返回 `false`。
- **产品侧唯一改动（测试缝隙）**：`createBrowserLegacyValueStore(key, resolveStorage?)` 增加可注入的存储解析器（默认仍是 `import.meta.client ? window.localStorage : null`），并把「解析存储」也放进 try——vitest 里 `import.meta.client` 不为真，抛错那条路径此前**不可达**；现在它既可达也可测，`read`/`remove` 的语义与顺序未变。
- 会话层的接线另有 1 例落在 `files-view-session.test.ts`（「旧键不可读（隐私模式/被禁用）：不迁移不删除，诊断经会话显示出来」），覆盖 `notice` 的透传。

### R3（P3）文档与口径修正

- 与本原语相关的口径修正：`tasks/t56.../walkthroughs/implementation.md` §3.4（4 个 legacy 组件**逐件**写明原因：3 个被契约测试读取并断言、第 4 个只与同目录 `…Row.vue` 互为引用）、`README.md` 收尾段、`storage-core-validation.md` 遗留待办、`view-migration-inventory.md` §2.6 旧实现删除条件。
- 另两份组件文档（`WorkbenchViewHost.md`、`WorkspaceFilePanel.md`）的 4 处不符由 t55 的记录一并记；其中与共享会话层直接相关的一处是 `WorkspaceFilePanel.md` 对「首读门禁」的描述——R1 修掉了 `useUserRecordSession.commit` 的「排队重放」语义（读取就绪前改为拒绝 + 可见诊断），该文档已同步。

### 返工后的门禁

| 命令（cwd） | 结果 |
|---|---|
| `bun run --cwd packages/neuro-book test app/utils/workbench app/components/workbench app/components/novel-ide/workspace`（worktree 根） | **exit 0**，`Test Files 21 passed (21)`、`Tests 227 passed (227)`（含新文件 15 例） |
| 更宽一圈（把所有会话消费端一起跑）：`bun run --cwd packages/neuro-book test app/components/novel-ide app/utils/workbench app/components/workbench`（worktree 根） | **exit 0**，`Test Files 71 passed (71)`、`Tests 622 passed (622)` |
| `bunx tsc --noEmit -p tsconfig.json`（`packages/neuro-book`，只读） | 本次改动文件零错误 |
| `bun run docs:check`（worktree 根） | **exit 0**，`{"failures":[],"checkedFiles":5907}` |
| 复核探针（`--config .agents/.../t60.../probes/vitest.probes.config.ts`） | **exit 0**，`Test Files 3 passed (3)`、`Tests 15 passed (15)`（含复核者重写后的 probe-01 与其中的 F4 例） |

### F4（P3，追加复核新发现，本次修掉）

复核在 R1 修复后指出：`open()` 的句柄不可用分支（`opening = null`、`loading = false`、`session` 仍为 null）下，`commit` 的 `current === null` 会把 `open()` 留下的**准确诊断**顶成「记录还没完成首次读取」（不实），且该文案 `retryable: false` 让界面不画「重试」按钮——而 `retry()` 是此刻唯一的恢复入口；同时 `commit` 不再触发 `open()`，后端恢复后用户手势也不会重连。

- **修法**（`user-record-session.ts` 两处小改）：
  1. 把 `session === null` 与 `loading` 拆成两个分支：**`loading` 为真**（首读还没分类）才写门禁诊断；**`loading` 为假且会话仍为 null**（已经失败过）时**保留**既有诊断，并 `void open()` 再试一次连接——手势因此把连接带回来，且**不重放**这次基于默认显示的意图（重放就是首读门禁要挡的覆盖）。
  2. 句柄不可用分支的诊断改成 `retryable: true`，让界面上的「重试」按钮可达（`retry()` 会重新 `open()`）。
- **回归钉**（`files-view-session.test.ts` 新增 1 例，「句柄不可用：commit 不覆盖准确诊断、不落盘，并自己重试连接」）：替身新增 `userContextFailure` 开关；断言 ① 诊断仍是 `Storage 宿主暂不可达（cold start）` 且 `retryable: true`；② 提交后 `saves` 为空且诊断**未被顶掉**；③ 恢复后提交触发重连（不重放）、会话就绪、同一手势落盘 `{"paths":["lorebook/"]}`。
- **复核探针**：probe-01 的 F4 例从「记录缺陷」翻成「要求保留准确诊断与可达重试」后，本次修复让它转绿——三个探针文件全绿（15/15）。
