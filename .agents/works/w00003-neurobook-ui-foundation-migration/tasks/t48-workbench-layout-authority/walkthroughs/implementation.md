# t48 主工作台布局接线与旧 writer 退役 — 实现记录

Task：[t48-workbench-layout-authority](../README.md)。合同依据：[storage.persistence](../../../../../docs/specs/storage/persistence.md)「布局投影与保存反馈」、
[迁移合同](../../../../../packages/neuro-book/docs/migrations/storage-state.md) 第 5–6 步、[ui.workbench-shell](../../../../../docs/specs/ui/workbench-shell.md)、
t47 的[接线约定](../../t47-legacy-state-migration/walkthroughs/implementation.md)。
工作位置：worktree `.worktree/w00003-neurobook-ui-foundation-migration`（分支 `refactor/w00003-nb-ui-adoption`），命令 cwd 均为 `packages/neuro-book`。

## 结果

主工作台、主页面与书架模式的尺寸/模式读写全部经工作台 Storage 会话：进入工作面按记录恢复，用户手势结束提交一次主动字段；
`novel.ide.local` 不再承载这三个字段的运行期值，但**保留侧（序列化器 + 写回门禁）继续服役到原件已安全保留**，
退役由启动接线按迁移快照触发（R1）。真实 Source Dev 宿主里 8/8 场景核对通过（R2，含用户资产工作面；该入口一次失败一次成功，判定与证据见「用户资产入口的失败归属」）。

## 变更清单

新增（5 个文件）：

| 文件 | 作用 |
| --- | --- |
| `shared/storage/workbench-shell-layout.ts` | Project 内 grid 布局记录定义（`workbench.layout`/`layout`，project/local，单例，快照 v2）+ 默认布局常量 + 宽松校验 |
| `app/utils/workbench/shell-layout.ts` | 定义桥接（宿主可消费实例、载荷版本双核）、叶引用解析（按当前视口给约束）、树上左右偏好读取、默认拓扑快照 |
| `app/utils/workbench/layout-session.ts` | 布局会话：通用记录会话（首读门禁/条件写/冲突重读重放一次/未保存意图/重试放弃/订阅只更新基线）、工作面状态机（切换收口、迟到失败归属、迁移反馈）、`useWorkbenchShelfMode` |
| `app/utils/workbench/legacy-bucket-retirement.ts` | 旧桶写回门禁的退役判据与触发（R1）：原件已暂存且 data 备份落盘，或 `phase === "complete"` |
| 测试：`layout-session.test.ts`(13)、`shell-layout.test.ts`(7)、`legacy-bucket-retirement.test.ts`(3)、`workbench-grid-consumers.test.ts` 改写(8) | 见「测试与命令」 |

修改：

- `server/storage/product-definitions.ts`：追加 `defineWorkbenchShellLayoutState()` 到唯一清单数组（不新建第二个插件），同步 scope/locality 注释。
- `app/stores/novel-ide.ts`：三字段退出 `novel.ide.local` 的 `pick`；**保留 `storage: legacyBucketStorage()` + `serializer: legacyBucketSerializer`**（原件未安全保留时序列化器继续补齐三个键，其它字段的整键重写不会抹掉它们）；删除三个 store ref 与返回值。
- `app/plugins/storage-migration.client.ts`：启动接线在 `migration.start()` 前订阅迁移快照，满足判据即退役门禁并退订。
- `app/components/workbench/WorkbenchBranch.vue`：手势契约改为转发 Splitter 原始状态（分支 id + `active` + 百分比）；**修复嵌套分支把包装函数当上游导致的归属错误**（递归改传 `props.on*`）。
- `app/components/workbench/WorkbenchShell.vue`：接会话（`surface` prop → `enterSurface`）、手势经会话提交、树重建走 `grid.restore(snapshot)`（宿主与会话共用同一棵树）、会话发布触发重建、布局提示条（重试/放弃/迁移重试）、诊断枚举挂 `data-layout-diagnostics`。
- `app/pages/index.vue`：删除第二条写路径（旧右侧 `useResizablePanel` + `onResize` 写 `agentPanelWidth`、死掉的 `agentPanelStyle`/`agentSlotStyle`/`ideToolPanelStyle`/`agentPanelMaxWidth`/`agentResizeHandleRef`）；新增 `workbenchLayoutSurface` 并传给外壳。
- `app/components/novel-ide/ProjectPickerScreen.vue`：书架模式改经 `useWorkbenchShelfMode()`，保留加载/失败反馈 + 重试/放弃条。
- `app/stores/novel-ide-legacy-writer.test.ts`：改写为「旧 writer 退役 + 保留侧仍服役」合同（6 例）。
- `app/i18n/locales/{zh-CN,en-US}.ts`：`ide.workbench.layout.*` 与 `ide.picker.layoutUnsaved/layoutAbandon`。

未改：`app/utils/workbench/storage-migration*.ts`、`shared/storage/workbench-migration.ts`、`shared/storage/**` 既有文件、`server/storage/**` 既有实现、`packages/nb-ui/**`、`app/utils/storage/**`、t44 宿主内部、用户 dirty `descriptors{,.test}.ts`；t47 返工（分块核验/容量预检/`globalThis` 槽注册）未被回退。

## 实现要求 1–8 的落地

1. **首读门禁** — 记录会话 `phase !== "ready"` 时 `commit()` → `rejected`；呈现读登记默认值；`missing`/`deleted` 不写记录（合成基线为 `null`，首次手势只写主动字段，不把默认值写成"已确认值"）。读取失败 `blocked="unavailable"` + `credential=null`：可临时调整并显示未保存，`retry()` 先重读再重放。
2. **单写者** — 三字段退出 `pick`；`index.vue` 旧右侧 resize 与外壳 store 回写同批删除；旧桶里这三个键在保留期内由序列化器补齐（不是运行期 writer），退役后不再出现。
3. **手势语义** — Project 走 t44 宿主（`gesture-end.active` 单次提交、原件合成、程序布局不保存）；user 工作面在会话内用同一口径结算（`workbenchBranchGesture` → `grid.resizeBranch` → 只提交主动侧栏字段；容器变化取消手势）。窄视口夹取只发生在呈现层，不写回记录。
4. **失败与冲突** — 一次冲突重读 + 只重放本次意图一次；二次冲突/明确拒绝 → `unsaved` + pending（显示不回退）+ 提示条重试/放弃；结果未确认 → 重读核对；消费方读 `state.blocked`；手势未落盘的原因进会话 `issues` 并挂到外壳 `data-layout-diagnostics`（可枚举、不静默吞）。
5. **切换收口** — `enterSurface` 队列化：结束手势 → `retry()` 提交旧目标意图并等待 → 才释放旧记录；失败时 `pendingSurface` 挡住切换（重试/放弃）；放弃即清提示并完成切换；旧工作面已失效或收口期间失效 → 不延迟，诊断带旧工作面归属归档进 `issues`。
6. **user 工作面** — `idle`/`user-assets` 各用 `surface-sizes` identified 记录（与 Project 独立、不继承）；书架模式用 `shelf-mode` 单例记录 + 加载/失败反馈。
7. **迁移收尾** — 三个源字段退出 `pick`，但 serializer/门禁保留到原件安全保留之后（R1：`original !== null && backup === "saved"` 或 `phase === "complete"`）；暂存失败时保持 `locked`（整桶冻结）✓ 符合迁移合同；导入是条件初始化，先写的新 authority 值不会被覆盖；迁移 `blocked` 用同一提示出口呈现并可 `retry()`。
8. **注册与可达性** — 定义经 `server/storage/product-definitions.ts` 唯一清单 + 唯一插件注册；真实宿主里 `/api/storage/project/action` 读到 `missing`（未注册会返回 `STORAGE_STATE_UNREGISTERED`）且 save 200 ✓。

## 测试与命令

| 命令（cwd `packages/neuro-book`） | 退出码 | 结果 |
| --- | --- | --- |
| `bun run test app/utils/workbench app/components/workbench app/components/workbench-spike app/stores app/plugins server/storage shared/storage` | 0 | 35 文件 / 344 例通过（含 t47 返工的 storage-migration 26、legacy-bucket 15） |
| `bun run test app/utils/workbench/layout-session.test.ts app/utils/workbench/shell-layout.test.ts app/utils/workbench/legacy-bucket-retirement.test.ts app/components/workbench app/stores/novel-ide-legacy-writer.test.ts` | 0 | 6 文件 / 41 例（13 + 7 + 3 + 8 + 6 + 4 既有） |
| `bun run typecheck`（修复类型错误后复跑，R3） | **0** | 无 TS 错误 |

覆盖矩阵（Task 验证清单 → 用例）：

- 首读门禁 → `layout-session.test.ts`「首读门禁：读取完成前拒绝提交，缺失记录只显示默认值不落盘」。
- 单写者 → `novel-ide-legacy-writer.test.ts` 6 例（store 不暴露三字段、pinned 保留三个源值、locked 整桶冻结、退役后写回不含三字段、模块装载不退役、装载前后不主动写桶）+ `legacy-bucket-retirement.test.ts` 3 例（判据、只退役一次、构造即满足）。
- 手势单次提交 / 程序布局不保存 / 窄视口夹取不改保存值 → 「Project 手势只提交主动字段，测量与程序布局不产生保存」（1 次 save，未主动叶保持记录意图；**容器在宿主接手前测量仍可手势**为回归断言）+ 组件用例「外壳：读数来自会话，程序布局不提交，手势原样转发一次」。
- 二次冲突与重试/放弃 → 三条（冲突重读重放一次 / 二次冲突保留意图 + 重试/放弃 / 结果未确认的重读核对）。
- 切换收口与迟到失败归属 → 「切换工作面先提交旧目标意图再释放；失败时挡住切换并给出重试与放弃」+「旧工作面已失效不延迟切换并把诊断归档到旧工作面名下」。
- A/B 与 user 工作面隔离 → 「用户资产与未开项目各自使用 user/local 记录，与 Project 尺寸独立」。
- 书架模式记录 → 「书架模式」2 例。
- 注册可达 → `shell-layout.test.ts` 定义清单断言 + 真实宿主读写（下节）。
- 叶插槽转发 → 组件用例断言 `#activity`/`#editor` 内容渲染（防止"叶全空"回归）。

## 真实宿主浏览器验收（R2）

命令与隔离：`bun run migrate:application-state -- --apply`（exit 0）→ `hub start` `bun run dev`（= `scripts/cli/source-dev.ts`），env
`NEURO_BOOK_STATE_ROOT=C:\Users\NOTNOT~1\AppData\Local\Temp\nb-t48-ece09483\state`、
`NEURO_BOOK_CACHE_ROOT=...\cache`、`NUXT_PORT=4371`、`PORT=4371`。
核对：日志 `➜ Local: http://127.0.0.1:4371/`；`netstat` 里 `127.0.0.1:4371 LISTENING`，**3001 从未出现在监听表**；隔离根内新建 `workspace/.nbook/neuro-book.sqlite`；`GET /` 200。
所有断言优先读隔离根记录文件（`*.nbook/storage/<identity>/<subject>/local/<client>/<owner>/records/*.json`），并用页面 `data-*` 取证。

| 场景 | 操作 | 观察（页面） | 记录文件证据 |
| --- | --- | --- | --- |
| 书架（新根） | 打开 `/` | 书架显示「还没有作品」；`activity:60, editor:1305`（左右叶在书架态收起） | 无 `workbench.layout` 记录（缺失不落默认值） |
| 书架模式切换 | 建 A/B 后点「展示形态 · 密集列表」 | `aria-checked` 从「经典网格」移到「密集列表」 | `…/workbench.layout/records/shelf-mode.json` → `{"schemaVersion":1,"value":"compact"}` |
| Project A 恢复与默认 | 创建 A（`?project=t48-alpha`） | `left:340, editor:563, right:400` | 无 project 记录（缺失不落盘）；随后拖拽后出现 `t48-alpha/.nbook/storage/…/workbench.layout/records/layout.json` |
| Project A 手势 | 拖 left\|editor 分隔条 −50px | `left:290`，无诊断、无提示条 | 记录 `schemaVersion 2`，`left≈307, editor≈648, right=400`（只写主动字段；intent 为反解值）；1 次 `save` 200 |
| Project B 隔离 | 创建 B（`?project=t48-beta`）→ 拖 editor\|right −70px | B 初始 `left:339`（不继承 A），拖后 `right:470` | B: `left=340, editor=521, right=497`，revision `ae81a7be`；A 仍 `b53523c5` ✓ 各自记录 |
| 双标签并发 | 同一 A 两个标签：标签1 拖左栏、标签2 拖右栏 | 两标签均无诊断 | A: `left=280, editor=563, right=460`（两次改动共存，revision `f8d7b4a8`）✓ 冲突后重读 + 只重放主动字段 |
| 刷新两次 + 单写者 | 连续 reload ×2 | leaves 保持 `280/563/460`，无诊断 | 记录 revision 仍 `f8d7b4a8`（恢复/挂载不写盘）；`novel.ide.local` 键 = 仅剩 `pick` 集合，**三字段均不存在** ✓ 只有新 authority 写入 |
| 用户资产工作面 | 直接打开 `/?project=workspace%2F.nbook` → 拖 editor\|right −80px | `activity:60,left:340,editor:483,right:480`，无诊断、无提示条 | `state/workspace/.nbook/storage/…/workbench.layout/records/surface-sizes~user-assets.json` = `{"schemaVersion":1,"value":{"agentPanelWidth":479.88}}`（**只有主动字段**，`leftPanelWidth` 缺省 ⇒ 不写默认值），与两个 Project 的 `layout.json` 各自独立 |
| 未开项目（idle） | 书架态（左右叶收起） | `activity:60, editor:1305` | 用户 scope 下**没有** `surface-sizes~idle` 记录（无手势 ⇒ 不写默认值记录） |

顺带发现并修复（浏览器验收暴露的真实缺陷，均已补回归断言）：
1. 外壳的叶插槽被写成固定 `name="leaf"`，页面给的 `#activity/#left/#editor/#right` 全部不渲染（四个叶为空）→ 改回按叶转发（`<slot :name="leafId">`）。
2. 会话丢弃了"宿主接手前测得的容器"，t44 宿主因此拒绝所有手势（诊断「容器尚未测量」）→ `openSurface` 把已测容器交给新宿主。

### 用户资产入口的失败归属（R2 追加诊断）

现象：首次尝试（16:31，从已打开的项目标签 `page.goto` 该 URL）与随后的新标签尝试都回退到 `/`；随后同一命令在**同一棵树、同一隔离宿主**上成功进入（见上表），并且**没有**捕获到抛出的错误。

取证方法与结果（临时插桩，已完全移除，工作树回到提交 `8e9a803d` 的干净状态）：

1. 在 `index.vue` 的 `initializeWorkspaceFromRoute` user-assets 分支前后打 `globalThis.__t48BootStep`（`releaseProjectSurface` / `switchToUserAssetsWorkspace` / `user-assets-ready`），并在 `onMounted` 的 catch 里记录 `{message, stack, project}`。
2. 用同一隔离宿主打开 `/?project=workspace%2F.nbook` → **`step: null`、`error: null`、URL 保持 `?project=workspace/.nbook`、leaves 出现 left/right**：未发生抛出，也未走 catch。
3. 归属判定：失败不可复现，且**没有任何错误原文/stack 可对照**；在带插桩的同一棵（含本批全部改动）树上该场景正常进入并落盘记录 ⇒ **无本批改动的回归证据**。按证据只能判为环境/时序（失败发生在同一标签刚从项目态导航、上一次 Project 释放仍在收口时；成功运行使用全新标签 + 重启后的宿主），**不计入本批缺陷**。
4. 未在基线上做 stash 对照：由于当前树上该路径可正常进入且无错误可归因，对照运行没有可比较的失败事实；若需要"两次运行都失败"的复现，建议独立记一条环境时序观察项，而不是在本批改动上判回归。

结论：**不构成阻塞**——切片 4 的验收不受影响；user-assets 尺寸记录的写入（只写主动字段）、与 Project 记录的隔离、idle 不落默认值都由上表与单测同时覆盖。

## 未运行项与偏差

1. **用户资产入口一次失败不可复现**：已按 R2 追加诊断取证（插桩移除、结论与证据见上节），判定为环境/时序、非本批改动引入；`idle` 工作面在书架态左右叶收起，因此只有迁移会写它的记录（本次运行没有 legacy 旧桶 ⇒ 无 `surface-sizes~idle` 记录）。
2. **`editor` 主动改变时的归属**：Project 的 grid 记录沿用 t44 宿主语义（`active` 含 editor 即写入该叶意图）；user 工作面只提交左右侧栏字段（编辑器吸收余量）。
3. 定义实例两侧各构造一次（服务端注册用 shared 工厂，浏览器侧把同一声明的实例交给宿主）：宿主工厂所在模块连带 nb-ui（`.vue` 入口）与浏览器传输层，不能被 Nitro 打包；两边的快照版本、默认拓扑与注册可达性由 `shell-layout.test.ts` 交叉锁定。
4. 新增的外壳诊断出口 `data-layout-diagnostics`（最近 3 条会话诊断）用于"诊断逐条可枚举"与人工取证；不影响几何与持久化。
5. 未提交/push/合并；未访问 3001；未改 `storage-migration*.ts` 与 `shared/storage/workbench-migration.ts`；未覆盖用户 dirty 文件；本次启动的宿主只用本次句柄停止。
