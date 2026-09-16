# 切片 6 实施记录：未迁视图迁移清单

Work：`.agents/works/w00003-neurobook-ui-foundation-migration`；Task：`tasks/t54-view-migration-inventory`。
工作区：`.worktree/w00003-neurobook-ui-foundation-migration`（分支 `refactor/w00003-nb-ui-adoption`）；命令 cwd 逐条标注。
交付物：[`../../view-migration-inventory.md`](../../view-migration-inventory.md)（Work 根）。

## 一、交付物与范围

| 项 | 值 |
|---|---|
| 清单文档 | `view-migration-inventory.md`（37.6 KB）：总表 9 项视图 + 基线 1 项 + 单列 2 项；每项 6 类证据；依赖图（mermaid + 硬/软依赖文字）；排序表（依赖/成熟度/功能价值/规模四维，逐项给理由）；旧实现删除条件汇总（公共门禁 + 逐项残留）；未覆盖对象与原因 |
| 本记录 | 命令、退出码、取证方式、未运行项 |
| 只读截图 | `probe-3001-shell.png`（3001 书架态外壳，本次取证） |
| 产品代码改动 | **无**（`git status` 仅用户既有 dirty：`app/utils/workbench/descriptors{,.test}.ts`） |

调查对象覆盖：文件树与工具面板、Markdown Studio、Agent 列表与 Chat Flow、World Engine、Plot、角色、设置、历史/时间线、相关弹窗；命令系统与桌面多窗口单列，未混入视图搬迁。

## 二、命令与退出码（真实命令、cwd、结果）

| # | 命令（cwd） | 结果 |
|---|---|---|
| 1 | `bun run docs:check`（worktree 根，写清单**前**基线） | **exit 0**，`{"failures":[],"checkedFiles":5866}` |
| 2 | `bun run docs:check`（worktree 根，写清单与记录**后**复跑） | **exit 0**，`{"failures":[],"checkedFiles":5868}`（+2 = 新增 `view-migration-inventory.md` 与 `walkthroughs/implementation.md`） |
| 2b | `bun run docs:check`（worktree 根，全部交付物落盘后的终跑，含截图与 Task README 状态更新） | **exit 0**，`{"failures":[],"checkedFiles":5869}` |
| 3 | `git -C <worktree> rev-parse --abbrev-ref HEAD` | exit 0，`refactor/w00003-nb-ui-adoption` |
| 4 | `git -C <worktree> log -1 --format="%H %h %ad %s" --date=short` | exit 0，`7348e7e7 docs(work): open the view migration inventory task`（登记为清单基线 revision） |
| 5 | `git -C <worktree> status --porcelain` | exit 0，仅 ` M app/utils/workbench/descriptors{,.test}.ts`（用户 dirty，未触碰） |
| 6 | `netstat -ano \| grep 3001` | 3001 `LISTENING`，PID 61560（仅确认服务在跑，未做任何启停） |
| 7 | `find`/`wc -l`/`grep -n`/`sed -n` 系列（worktree 内 `packages/neuro-book`、`docs`） | 全部 exit 0；用于行数、调用点、fixture、文档原文取证 |
| 8 | `read`（浏览器只读 DOM 探针）+ `probe-3001-shell.png` 截图 | 见 §三.4 |

未运行：任何测试套件、typecheck、Lab smoke、Product 门禁、构建；未 `git add`/commit/push；未启动 dev server；未重启/停止 3001。

## 三、取证方式（六类证据各自怎么来的）

1. **源码调用点**：`grep -n`/`sed -n` 直读主页面模板与外设文件（`app/pages/index.vue` 模板区 2543-2680 全览、`WorkbenchShell.vue`、`layout-session.ts` 头部、`workbench-chrome.ts` 菜单 IA、`stores/novel-ide.ts` 持久化段、各视图目录入口行）。「是否已接 Storage 会话」以**定义与落盘**两条线核对：定义见 `shared/storage/workbench-state.ts`、`shared/storage/workbench-shell-layout.ts`、`server/storage/product-definitions.ts`、`server/plugins/storage-definitions.ts`；落盘见 §三.4 的 3001 隔离根磁盘记录。
2. **同名文档成熟度**：`find app/components -name "*.md"` 得全量 39 篇（清单据此判定各目录 0 文档），再逐篇读关键句（含 4 篇「旧面板/旧宿主待接线」的过时表述与 `docs/testing/manual-eval/journeys/**`、`vitepress/locales/zh-Hans/**` 的用户文档口径）。
3. **Lab fixture**：`grep -n "component:" app/component-lab/fixtures/index.ts` 得 42 条登记（行号与场景 id 逐一登记），并对 36 个 `*Fixture.vue` 做 `grep -n "^import .* from"` 反查它们指向 Lab 零件还是产品组件（据此判定 `MarkdownView` 是 Lab 文档渲染器而非产品编辑器）。
4. **主页面入口 / 真实运行**：
   - 只读 DOM 探针（本次）：以托管 Chromium 打开 `http://localhost:3001/`（书架态，**未点击任何入口、未打开 Project**），读 `[data-leaf]` 计数与包围盒、`--workbench-titlebar-height`/`--workbench-activity-gutter` 计算值、activity 叶 10 个按钮的 `disabled`/`title`，随后 `browser.close` 释放标签；截图落 `probe-3001-shell.png`。
   - 磁盘只读：`find`+`head -c` 读 `%TEMP%/nb-3001-8KseHT/state/workspace/.nbook/storage/**`（`workbench.layout` 的 `surface-sizes~idle`/`~user-assets`/`shelf-mode` 记录、`workbench.migration` 完成标记）与项目侧 `xin-xiao-shuo/.nbook/`（确认 `storage/` 为空）。
   - 既有真机截图：`%TEMP%/nbook-t50-accept/shots/combo1-nbook-light-1440.png`（切片 5 在隔离宿主 3511 打开 Project 后的主页面），用于 Project 态左/中/右三叶占位的观察。
   - **未在 3001 上打开 Project**：那会向开发者正在使用的隔离根写入 presence 与迁移记录（该项目 `storage/` 当前为空，首次打开会触发迁移门禁与原件暂存），属不可回退的副作用，刻意不做。
5. **状态归属判定**：逐条对照 `docs/specs/storage/persistence.md:94-101` 的归属表、`boundaries.md:103/121`、`ui/workbench-shell.md:83-95` 状态表、`workbench-view-host.md:179-196/210-217`，给出 scope/locality 并写明理由；找不到依据的一律不写结论（本清单未出现"无法判定"项）。
6. **并行只读取证**：5 个 `scout` 子代理按视图分组取证（文件树+角色 / Studio+历史 / Agent / World Engine+Plot / 设置+弹窗），全部只读、未写文件、未跑测试；本 Agent 对其关键结论做了复核（见 §四）。

## 四、复核与纠错（本次实际发生的）

| 复核项 | 结果 |
|---|---|
| `openFrontmatterProfile`（`index.vue:2159-2161`）、`openPlotWorkbench`（`index.vue:1881-1896`）无调用方 | 自测 `grep -rn` 仅命中定义处，成立 |
| `NovelIdeToolPanel`/`WorkspaceFilePanel`/`MarkdownStudioWorkbench`/`AgentChatSurface`/`AgentModeSessionSidebar`/`NovelPromptBar` import 未渲染 | 自测 `grep -n "<标签"` 全部零命中，成立 |
| 3001 activity 按钮禁用矩阵 | 自测 DOM：第 0/8/9 可用、第 1–7 禁用，与 `workbench-chrome.ts:63-85` 的 `projectDisabled`/`novelOnlyDisabled` 推导一致 |
| `AgentModeSessionSidebar` 置顶键行号 | 子代理给 `:47/74/91`，实测 key 计算 `:34`、读 `:74`、写 `:91` → 清单已改为实测值 |
| `docs/specs/ui/workbench-shell.md` 行号 | 子代理/初稿引用 `:143-147` 有误，实测删除条件在 `:118`、验收「现有入口全部可用」在 `:52`、搜索/命令在 `:63` → 已更正 |
| `vitepress/.../file-history.md`「还没做的部分」 | 初稿按子代理口述写「末段」，实测在 `:54-56` → 已更正 |
| 设置区段文档/fixture 计数 | 子代理自身出现「8/9」不一致；按实际枚举重算：**24/33 有同名 `.md`**、fixture 23 条（agent-profile 9 + 设置区段 11 + 模型对话框 3）→ 已更正 |
| Lab fixture 总量与书架条数 | 自测 `grep -c` = 42 条登记、书架 `Project*` 8 条，成立 |

## 五、未运行项（明确列出）

- 未启动任何 dev server（共享 `packages/neuro-book/.nuxt`，第二实例会摧毁 3001）。
- 未停止/重启 3001；未改动 3001 的隔离根数据（仅读）。
- 未在 3001 上打开 Project、未点击任何入口（避免 presence 与迁移写入）。
- 未运行 `bun run test`、`typecheck`、`smoke:component-lab`、`product:policy:check` 等（切片 6 只调查；由 Leader 统一门禁）。
- 未运行桌面宿主的 OS 级回归（本机无桌面 Envelope，环境不可达）。
- 未修改任何产品代码/测试；未提交、未 push。

## 六、证据资产

| 资产 | 路径 |
|---|---|
| 清单 | `.agents/works/w00003-neurobook-ui-foundation-migration/view-migration-inventory.md` |
| 本记录 | `.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t54-view-migration-inventory/walkthroughs/implementation.md` |
| 3001 只读截图 | `.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t54-view-migration-inventory/probe-3001-shell.png` |
| 既有真机截图（引用） | `%TEMP%/nbook-t50-accept/shots/combo1-nbook-light-1440.png` |
| 3001 隔离根（只读引用） | `%TEMP%/nb-3001-8KseHT/state/workspace/.nbook/storage/**` |
