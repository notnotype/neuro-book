# Storage与grid核心收口验证

本轮按开发者最新要求完成核心，后续集成交接。服务/适配器既有提交链见Work README，新增Storage上下文为7a5d04de；本记录不晋升planned Spec，也不声明六切片全部完成。

## 可观察结果

- 工作台按user/Project管理访问生命周期，Project切换同步封锁旧引用，已接纳动作与迟到资源收口；一侧释放失败仍清理另一侧。插件内存选择只在当前Project代次共享，偏好样例保留未知字段。
- grid两轴意图与呈现分离，混合上下界与实际sash守恒；完整分支手势原子反解，失败不改树。对象ref使用稳定编码器；快照v2拒绝不兼容旧版，未知引用原件合成仍由后续宿主负责。
- Branch/Shell/Spike消费原语的实际尺寸、降级约束和sash；右侧栏提交不回弹，被动补偿不写成主动偏好，达到max后保留留白。
- Splitter提供开始/更新/结束/取消边界，鼠标与键盘每次只提交一次；禁用/零宽、等值重渲染、Enter与取消行为经真实Reka及浏览器验证。

## Leader独立验证

所有命令在本worktree对应包的绝对cwd运行。原始输出与截图位于系统Temp的neuro-book/acceptance/storage-core-final-20260916，不使用用户3001服务。

| 检查 | 结果 |
|---|---|
| 主应用Storage上下文+适配器聚焦 | 6文件94用例，exit0 |
| 主应用workbench/Spike/Storage聚焦 | 最终11文件142用例，exit0；含新增留白与类型修复后的全部相关用例 |
| 主应用 `bun run typecheck` | 探针归档后正式重跑exit0 |
| nb-ui `bun run test` | 18文件350用例，exit0 |
| nb-ui `bun run typecheck` | exit0；Vue ref方法守卫修复后正式重跑通过 |
| nb-ui Splitter最终聚焦 | 2文件32用例，exit0 |
| 两次 `bun run build:css` | 字节一致；SHA256 8C805962377DED5D0EC8AE35525398E049E9F777934D6F273CF0D89209E2CED9 |
| nb-ui `bun run test:e2e` | 最终48/48，exit0，独立端口3149，浏览器profile和输出在系统Temp；含桌面/390px及nbook/macos浅深色 |
| grid数值探针 | 10000确定性可满足布局+3000合法分支手势全部通过，代码和证据见t41 |

首次E2E为47/48，唯一差异是Lab画布修复后switch-field从右侧裁切变为正确收窄居中。Leader直接检查expected/actual/diff后更新一张基线，连续生成字节一致，SHA256 EE93AF0CF9A57BE50FA44E7152741C4D172665BD307E613C8228D293AFE02546。没有降低截图断言阈值。
主应用正式typecheck首轮只命中两组新增测试类型错误，修复后第二轮仅命中Reviewer临时探针；探针归档后的最终正式检查exit0。Storage测试的vi.fn改为明确Promise<never>拒绝委派，测试意图和产品代码未变。

## 审查与限制

- t42最终独立审查建议合并，另有9探针；t39最终独立审查建议合并，另有11探针。Leader的后续改动只补消费文档与Splitters ref类型守卫，并重跑受影响测试/正式typecheck。
- t41最终复核结论在该Task walkthroughs/review-final.md，数值探针及消费者证据固定到所审文件hash。
- t41最终建议合并，原五项和消费者留白均闭合。非阻断O1：公开API隐藏editor时模型保持侧栏偏好、原语却将空余量分给侧栏；当前主页仅切换titlebar/left/right，不触发此路径。后续扩展隐藏editor或复用该Shell API前修正并测试，不作为已支持产品行为宣传。旧单节点resize对越界意图归一的边界已补充grid API文档。
- 没有完整NeuroBook主页面、标题栏、插件grid持久化宿主或Windows整Project根替换的端到端证据。t43最小HTTP脚本仍是未提交稿，缺口见其leader-handoff-status.md。
- scripts:typecheck旧基线错误与Project Windows alias锁超时见交接；未修改无关文件来隐藏这些问题。
- 用户两个descriptors文件hash不变，未纳入提交。3001未访问、复用、重启或关闭，无真实用户数据或远端操作。

## 后续执行入口

用户要求的系统Temp HANDOFF.md引用本Work的storage-implementation-plan.md和storage-consumer-source-map.md。下一受限增量是插件grid宿主的原件合成、订阅/手势投影与冲突处理，然后按计划迁移旧键、接主页面/标题栏并盘点未迁视图。命令系统仍需另行讨论。

## 2026-09-16 延续轮（Leader 记录）

本节只记本轮的提交、命令与结果；上一节的核心证据不变。

| 增量 | 提交 | Leader 复跑与结果 |
|---|---|---|
| t43 Project Storage 浏览器/HTTP/磁盘验收第二稿 | `2cfc871d` | `node --import tsx scripts/smoke/storage-project-adapter.ts --browser-executable <chrome>`（cwd 为 worktree 内 `packages/neuro-book`）exit 0、`findings []`、`cleanup` 10/10 ok、隔离根为 `Temp/neuro-book/nb-t43/<hex>` 且运行后为空；`bunx tsc -p scripts/tsconfig.json` 仅剩既有 `product-agent-state-root-smoke.ts:318` 基线错误 |
| t44 grid 持久化宿主（原件合成/手势/订阅/CAS 收口） | `5fcdf8b8` + 修复 `1f1942c3` | 聚焦 17 → 20 用例（修复后）exit 0；`bun run --cwd packages/neuro-book typecheck` exit 0；检查点 A 审查见 t46（首轮裁定需修复，修复后追加复核） |
| t45 Lab 嵌套 grid fixture 与浏览器验收 | `0bcea164` | nb-ui `bun run test` 18 文件 350 用例 exit 0；`bun run typecheck` exit 0；`playwright test` 全量 **64 passed** exit 0（原 48 + 新增 16） |
| 文档与治理 | 本文件与 Work 状态 | `bun run docs:check` 5796 文件 `failures: []`；`bun run governance:check` `failures: []`、`warnings: []` |

视觉基线更新（t45）：新增 Lab 组件使导航计数 `49/49 → 50/50`、`布局` 分组 `3 → 4`，13 张基线图随之变化。
Leader 逐张核对 expected/actual/diff：红色像素仅落在上述计数区域（桌面 1440×800 的 diff 红像素 bbox 约 `(203,92)-(237,97)`；窄屏 390 落在计数 pill 与分组徽标），无组件渲染回归；
更新后连续两次 `--update-snapshots` 生成**字节一致**（两次 `sha256sum` 列表 `diff` 为空）。

本轮未验证（保持明写）：主页面接线、旧键迁移、标题栏、World Engine 整页；桌面桥接与多窗口。命令系统仍未讨论。

进程观察：worktree 内存在一个自 10:16 起运行的 `nuxt dev`（PID 14916/55568，监听 `[::1]:3001`），本轮未启动、未访问、未复用它，也未停止；所有验收使用独立端口与隔离根。

## 2026-09-16 切片 3 收口与切片 4 落地（Leader 记录）

检查点 A 关闭：t46 首轮裁定「需修复」（P2 重放无落点误报 `saved` 并清未确认意图、P3 release 后 open 仍读取、观察 1a），
已回 t44 修复（`1f1942c3`，聚焦 20 例）；追加复核逐项独立复现闭合、G1–G4 相邻路径全绿、探针 6 文件 14 例 exit 0，**建议合并**。

切片 4 两增量落地（均经 Leader 复跑与独立审查）：

| 增量 | 提交 | Leader 复跑与结果 |
|---|---|---|
| t47 迁移门禁与原件保护 | `8263726e` + 返工 `b5babea8` | 相关测试域 35 文件 344 用例 exit 0；`bun run typecheck` exit 0；t49 独立审查两轮（首轮 F1 分块损坏静默通过、F2 HMR 注册非幂等、三条 P3；返工后逐项独立复测闭合，**修复成立、建议合并**） |
| t48 主工作台接线与旧 writer 退役 | `8e9a803d` | 真实浏览器验收 8/8 场景（隔离根 `Temp/nb-t48-ece09483` + 端口 4371，记录文件逐项取证）；`bun run typecheck` exit 0 |

要点证据：

- 迁移：原件在旧 writer 任何重写前固化（`enforce:"pre"` + 等暂存结算，真实 persist 运行时 5 例含负向对照）；data 原件按 8 MiB 上限分块存 `workbench.migration` 专用分区，
  续跑逐块回读核验（修后），显式 retry 才修复不一致副本；逐目标条件初始化（`value`/`legacy-value`→已存在、`deleted`→墓碑、高版本/损坏→受保护、`missing`→初始化），进度与完成标记独立于目标与墓碑。
- 接线：单写者成立——刷新两次后记录 revision 不变、`novel.ide.local` 仅剩 `pick` 集合且三字段不存在；Project A/B 各自记录（`b53523c5` / `ae81a7be`）互不继承，
  双标签同项目改动共存（`left=280, editor=563, right=460`）；user 工作面 `surface-sizes~user-assets` 只写主动字段且不落默认值；退役发生在原件安全保留之后。
- 端到端可达：`server/plugins/storage-definitions.ts`（唯一 Nitro 注册插件）注册 `server/storage/product-definitions.ts` 定义清单后，经真实 HTTP 的读写与完整迁移链路在隔离根落盘。

门禁：`bun run docs:check` 5842 文件 `failures: []`；`bun run governance:check` `failures: []`、`warnings: []`；nb-ui 全量 `playwright test` 64 passed（t45 已记）。

未验证（保持明写）：浏览器标题栏与桌面 bridge（切片 5）、未迁视图清单（切片 6）、World Engine/Agent Chat Flow 整页、命令系统；
另记一条环境时序观察——在旧 Project 释放仍收口时导航到 user-assets 路由曾回退到 `/`（同树新标签 + 重启宿主下不可复现，非本批引入），留待切片 5 路由接线时复核。

受保护文件 `app/utils/workbench/descriptors{,.test}.ts` 的 SHA256 全程未变；`http://localhost:3001/` 未访问、未占用、未复用、未重启、未停止。

## 2026-09-16 切片 5：浏览器标题栏与真实主页面（Leader 记录）

增量：t50 合同 `55acd747`、实现 `a74c7fb8`（返工含 6 处类型错误修复）。t51 检查点 B 独立审查已派发（结果见该 Task）。

| 检查 | 命令（cwd = worktree 内 `packages/neuro-book`，除注明外） | 结果 |
|---|---|---|
| 类型检查 | `bun run typecheck` | exit 0（返工前 6 处错误全在 t50 文件内，已修） |
| 聚焦测试 | `bun run --cwd packages/neuro-book test app/utils/workbench-chrome.test.ts app/components/common/DesktopTitleBarChrome.test.ts app/components/common/DesktopTitleBar.test.ts app/composables/useWorkbenchChrome.test.ts` | 4 文件 20 例 exit 0 |
| Lab smoke（core） | `node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:3521 --browser-executable <chrome> --suite core` | exit 0（含主页面 `/` 检查） |
| Lab smoke（agent-profile） | 同上 `--suite agent-profile` | exit 0 |
| Lab smoke（project-picker） | 同上（默认 all） | **exit 1（既有漂移）**，见红分支登记 |

t50 真机验收（隔离根 `Temp/nbook-t50-accept`、端口 3511、未碰 3001）：四主题 × 1440×900/390×844 逐组合读数（标题栏恒 `y=0`、高 36、`--workbench-titlebar-height=36px`，四组背景色与对比可读）；
能力映射（浏览器无退出应用/桌面缩放，未接入动作禁用并给原因）；编辑动作按真实焦点（文本框原生撤销实测 `新小长名字XYZ→新小长名字XY`）；
菜单 Teleport 到 body 且在 1440×900/390×844/390×500/390×360 均在视口内；键盘与焦点（ArrowDown 跳禁用项、ArrowRight 换组不掉焦点、Escape 全局可关并归还焦点）；
Project 两条打开路径（本标签只发意图、新标签 `target=_blank rel=noopener noreferrer` 且当前标签不变）；窄屏叶包装后标题栏叶高 36；Storage 失败腿（abort 全部 `/api/storage/**` 后重载，页面不崩、提示条带重试、恢复后拖拽提交成功）。

3001：按开发者指示先停 → 实施验证 → 用**同一隔离根**（`Temp/nb-3001-8KseHT`，State/Cache 均在该根）重启，`persistent`；重启后实测 `GET /` 200 且主页面渲染出浏览器标题栏（File/Edit/View/Help）。开发者真实根 `%LOCALAPPDATA%/NeuroBook/{data,cache}` 未被写入（mtime 仍为 2026-08-19 / 2026-08-25）。

流程事故（已修复，如实登记）：一次 `git add packages/neuro-book/app` 把用户 dirty 的 `descriptors{,.test}.ts` 一并纳入提交；随即 `git reset --soft HEAD~1` + `git restore --staged` 两个文件后重新提交（`5591f8fa` → `a74c7fb8`），两文件回到未暂存且 SHA256 仍为 `11BDDDA8…`/`81D3CC73…`。后续只逐文件 `git add`，不再对目录做 add。

## 2026-09-16 检查点 B 与切片 5 收口（Leader 记录）

| 增量 | 提交 | 结果 |
|---|---|---|
| t51 检查点 B 首轮 | `3e3f42e3`（文档） | 裁定**需修复**：键盘打开 Edit 菜单六条动作整组禁用（P2）、浏览器通知条压 36px 标题栏（P2）、宿主 `openMenu` 面板无定位（P2）、`resolveTitleBarEditTarget` 零覆盖（P3） |
| t50 返工 R1–R4 | `9df461e1` | 焦点在标题栏/下拉层时沿用最近一次真实可编辑焦点（执行前把焦点还给记忆元素）、通知让位跟随标题栏存在事实、受控 `openMenu` 按菜单名回查触发按钮、分类器补真实用例；真机确认键盘路径六条可用且原生命令作用于输入框 |
| t50 两条 P3 收口 | `5e7ac703` | 记忆元素检查 `isConnected`、Project 组纳入同一锚点钩子 |
| t52 + t53 | `cbb8ef38` | picker smoke 对齐当前场景（含 compact/editorial）、5 条 400 归因夹具合成根非法（服务端正确拒绝）、缺 key 文案改用既有 key |
| 探针缓存误提交清理 | `8d20808d` | 审查探针目录下的 vite 缓存曾被 `git add <目录>` 带入提交，已从索引与工作树移除 |

Leader 独立复跑（worktree 内 `packages/neuro-book` 绝对 cwd）：`bun run typecheck` **exit 0**（收口后）；t50 聚焦 6 文件 **29 例** exit 0；`component-lab --suite all` 对运行中的 3001 **exit 0**（core / agent-profile / project-picker 三者皆绿，红项因此关闭）。t51 追加复核终审 **correct / 可合并**（探针 3 文件 10 例、产品 6 文件 29 例，主干未回归），未晋升任何 Spec 状态。

事故与恢复（如实登记）：3001 期间崩溃一次（exit 5）——原因是另一个 dev server 在同目录执行 `nuxt prepare/generate` 重建共享 `.nuxt`，摧毁了正在运行的实例。已按「停 → 验证 → 重启」的窗口流程恢复，并在代理侧广播约束（同目录不得并存两个 dev server；需要真实浏览器先报 Leader 协调窗口）。当前 3001 在隔离根 `Temp/nb-3001-8KseHT` 上运行（`persistent`），`/` 与 `/lab` 均 200；开发者真实根未写入。

## 2026-09-16 切片 6：未迁视图清单（Leader 记录）

增量：t54 只读调查，提交 `1bfc2268`。交付 `view-migration-inventory.md`（424 行）与 3001 书架态只读截图 `tasks/t54-view-migration-inventory/probe-3001-shell.png`。

- 取证等级：`O1` 本次 3001 只读 DOM/几何、`O2` 切片 5 真机截图、`O3` 隔离根磁盘只读、`O4` 规格/提案原文；每行都指向 `文件:行` 或真实观察。
- Leader 抽查三条关键结论，均属实：`MarkdownStudioWorkbench` 在 `app/pages/index.vue:6` 仅死 import、`openPlotWorkbench`（`:1881`）无调用方、`NovelIdeToolPanel`（`:12`）仅 import 未渲染。
- 跨面事实：239 个 `app/components/**/*.vue` 中仅 39 个有同名 `.md`；markdown-studio / agent / workspace / plot / world-engine / history / jobs / profile / rag 等视图族**零文档、零 fixture**，按 `component-index.ts:62` 连 Lab 索引都进不去。
- 排序（依赖 → 成熟度 → 恢复价值）：1 文件树与工具面板 → 2 Markdown Studio → 3 角色 → 4 Plot → 5 Agent 列表与 Chat Flow（拆 5a/5b）→ 6 World Engine（先做尺寸归属小切片）→ 7 设置收尾 → 8 历史/时间线 → 9 相关弹窗；命令系统与桌面多窗口单列。
- 门禁：`bun run docs:check` **exit 0**（5869 文件，failures `[]`）；本 Task 未运行任何测试/typecheck/构建（只读调查，未启动 dev server，未启停 3001）。

未开始：视图迁移实现（每个视图独立立项，按开发者选择的优先级推进）。

## 2026-09-16 首个视图迁移：`files`（Leader 记录）

增量：t55（提交 `aec1e0d8`）。清单 §2.1 指定的左叶文件树接回 + 展开项并入 user/local 归属。

| 检查（cwd = worktree 内 `packages/neuro-book`，除注明外） | 结果 |
|---|---|
| `bun run typecheck`（趁窗口执行，避免与 3001 并存） | **exit 0** |
| 聚焦测试 4 文件（`files-view-session` / `product-catalog` / `WorkbenchViewHost` / `WorkspaceFilePanel`） | 4 文件 **30 例** exit 0 |
| `component-lab --suite all`（对运行中的 3001） | **exit 0**（core / agent-profile / project-picker） |
| `bun run docs:check` | exit 0，5879 文件，failures `[]` |

真机验收（隔离宿主，端口 4321，隔离根 `Temp/nb-t55-verify`，omp managed Chromium 1440×900）：Project 态左叶渲染真实文件树（行含 智能体上下文/世界书/手册/正文/参考资料/上传/世界引擎/AGENTS/project.yaml）；
展开「世界书」后磁盘出现 `workbench.files/records/expanded-paths.json={"paths":["lorebook/"]}`（user/local 分区，无第二写路径）；刷新后恢复；旧裸键两种情形（记录已存在→旧键删且记录未被覆盖；记录缺失→条件初始化并回读一致后删旧键）；
双击 `project.yaml` 给出可见提示（编辑器叶未迁入）；书架态左叶不渲染且 `files` 入口仍 disabled。

本地修正（登记）：`packages/neuro-book/.gitignore:20` 的裸 `workspace/` 规则会忽略 `app/components/novel-ide/workspace/` 下的**新文件**（已跟踪文件不受影响，故此前未被发现）；新增一行例外 `!app/components/novel-ide/workspace/`，随本增量提交。

事故：本 Task 期间 3001 崩溃一次（exit 5），原因为编辑 `server/storage/product-definitions.ts`（服务端模块）触发 Nitro 全量重建；已恢复并给 3001 增加 `restart: on-failure` 自动恢复策略。约束更新：服务端模块改动成批落盘、落盘前报 Leader。

## 2026-09-16 收尾切片：尺寸归属（Leader 记录）

增量：t56（提交 `4bf1562a`）。A World Engine 三处尺寸 → project/local 记录；B 设置/新建作品对话框两个裸键 → user/local 记录（与书架模式同 owner）；C 四处过时文档修订（`RolesSettingsView` 保持不挂，登记决策）。

| 检查（cwd = worktree 内 `packages/neuro-book`） | 结果 |
|---|---|
| `bun run typecheck`（Leader 在有序停机窗口内复跑） | **exit 0** |
| Leader 抽跑 7 文件（新会话 + files/layout/shell 回归 + 契约测试） | **66 例** exit 0 |
| 实现者全量：聚焦 + 回归 17 文件 | 99 例 exit 0（新增 19） |
| `bun run docs:check` | exit 0，5890 文件，failures `[]` |

记录定义（一次落盘于 `server/storage/product-definitions.ts`）：`workbench.layout/world-engine-sizes`（project/local，默认 320/420/292）、`workbench.layout/settings-dialog-size`（user/local，默认 1120×640）、`workbench.layout/create-project-dialog-size`（user/local，默认 580×360）。
旧键迁移只删记录缺失且回读一致后的旧键，七类失败均保留旧键并给可重试诊断（11 例覆盖）。契约测试 `world-engine-workbench-preview.test.ts` 由「钉住旧尺寸实现」改为「禁止旧路径 + 要求单次提交」。

遗留待办（保留不删，原因逐件不同）：4 个 World Engine legacy 组件全仓零引用——其中 3 个（`WorldEngine{SliceInspector,StateSummary,Timeline}.vue`）被 `world-engine-ide-entry.test.ts:62-64/963-980` 读取并断言其内容，删除需连同该断言一起改；第 4 个 `WorldEngineSubjectStateViewer.vue`（连同同目录 `…Row.vue`）只是两者互相引用，删它不会让任何测试失败——已记入清单 §2.6。

流程：本增量前 Leader 有序停止 3001（避免服务端定义落盘触发 Nitro 重建导致 exit 5），完成后按其完成信号恢复；3001 现带 `restart: on-failure`。

## 2026-09-16 视图宿主 Lab 覆盖（Leader 记录）

增量：t57（提交 `ef51c81b`）。为 t55 接入产品的 `WorkbenchViewHost.vue` 补契约文档与 Lab fixture（此前无 `.md` → 按 `component-index.ts:59-108` 的标签推导规则连索引都进不去）。

- 交付：`WorkbenchViewHost.md`（frontmatter `标签: [state:local]`）、`WorkbenchViewHostFixture.vue` 三场景（可见视图渲染 / `when` 不可见给原因 / 未知 `factoryKey` 失败可见）、`fixtures/index.ts` 登记；唯一产品改动是可选且文档化的 `viewFactoryResolver` 注入缝隙（页面不传，默认行为不变）。
- Leader 独立复跑：聚焦 2 文件 **9 例** exit 0；`component-lab --suite all` 对 3001 **exit 0**；`bun run typecheck` **exit 0**（在有序停机窗口内跑）。
- 实现者另有 `vue-tsc --noEmit` exit 0（并用临时探针证明该命令确实检查 SFC）与 `docs:check` exit 0（5894 文件）。
- 可挂载性证据：标签推导 `mountable: true`，且 Lab 页面 workbench 分组可见并可选中（右栏显示目录/标签/确定性验证）。

## 2026-09-16 文件树组件文档与 Lab 判定（Leader 记录）

增量：t59（提交 `6f9813c1`）。为 t55 迁入产品的 `WorkspaceFilePanel.vue` 补同名契约文档（此前 `novel-ide/workspace/**` 14 文件零 `.md`，按 `component-index.ts:59-108` 连 Lab 索引都进不去）。

- 判定：**不可挂载**（标签含 `state:shared-write`/`io:read`/`io:mutate`/`persist:local` → `mountable:false`）。实测证据：Lab 左栏 `novel-ide→workspace` 下已出现该组件（46 个组件，搜索 1/46），中栏原文给出阻断原因「会真的读写产品数据（state:shared-write、io:read、io:mutate），只能在正式界面验证」，console 零 error/warning。
- 不造替代 fixture：Lab 规范禁止为阻断条目造替代 fixture；数据在 Pinia store + 记录 + Storage 宿主客户端，确定性挂载等价于把读写上移到宿主（属真实迁移，超出本 Task）。
- 替代验证：`WorkspaceFilePanel.test.ts` 6 例 + t55 的隔离宿主真机验收（展开落记录、两种旧键迁移、打开提示条、书架态不渲染）+ 本 Task 对 3001 的 Lab smoke 全量 exit 0 ×2。
- 门禁：`bun run docs:check` exit 0（5898 文件，failures `[]`）；聚焦 2 文件 10 例 exit 0；无产品代码改动（仅 1 个 `.md` + 台账文件），故未跑 typecheck。
- 写文档时按实现收窄了两处口径（重命名/递归确认失败是**未捕获拒绝**、无通知；树读取失败无专门文案），已在文档「不支持/注意事项」写明。
