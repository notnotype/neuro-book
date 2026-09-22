# 切片实施记录：`WorkbenchViewHost` 的 Lab 覆盖与契约文档

Work：`.agents/works/w00003-neurobook-ui-foundation-migration`；Task：`tasks/t57-view-host-lab-coverage`。
工作区：`.worktree/w00003-neurobook-ui-foundation-migration`（分支 `refactor/w00003-nb-ui-adoption`）；命令 cwd 逐条标注。**未提交、未 push**；未启停 3001、未起第二个 dev server。

## 一、交付物与范围

| 项 | 值 |
|---|---|
| 新增（文档） | `packages/neuro-book/app/components/workbench/WorkbenchViewHost.md`（frontmatter `标签: [state:local]`；正文含职责边界、分工、`when` 语义、数据/布局/交互/状态/不支持/注意事项） |
| 新增（fixture） | `packages/neuro-book/app/component-lab/fixtures/WorkbenchViewHostFixture.vue`（三个场景：`default` / `hidden` / `unknown-factory`） |
| 修改（登记） | `packages/neuro-book/app/component-lab/fixtures/index.ts:615-623`（沿用既有 `{component, scenes, load}` 形状） |
| 修改（注入缝隙，最小且文档化） | `packages/neuro-book/app/components/workbench/WorkbenchViewHost.vue`：新增可选 prop `viewFactoryResolver?: (factoryKey: string) => DescriptorResult<Component>`（:39），watch 里 `props.viewFactoryResolver ?? resolveWorkbenchViewFactory`（:65），文件头补一条缝隙说明（:10）。产品页面不传，默认行为不变 |
| 修改（工作台账） | 本 Task `README.md:9` 状态行 → `已实现并验证（2026-09-16）` + 交付物指向本记录 |
| 未改 | `app/utils/workbench/product-catalog.ts`、`view-factories.ts`、`containers.ts`、`descriptors.ts`、`files-view-session.ts`、`server/storage/product-definitions.ts`、`app/pages/index.vue`、`WorkbenchContainerSurface.vue`；用户 dirty `app/utils/workbench/descriptors{,.test}.ts` 一字未动；未做 Markdown Studio 与右叶 Agent 面 |

## 二、命令与退出码（真实命令、cwd、结果）

| # | 命令（cwd） | 结果 |
|---|---|---|
| 1 | `bunx vitest run app/components/workbench/WorkbenchViewHost.test.ts app/component-lab/fixtures/index.test.ts`（`packages/neuro-book`） | **exit 0**，`Test Files 2 passed (2)`、`Tests 9 passed (9)`（宿主既有 5 例 + fixture 登记既有 4 例，注入缝隙未改默认路径） |
| 2 | `node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:3001 --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe"`（`packages/neuro-book`，对运行中的 3001 只读跑，默认 all 套件；**跑过两次**：fixture 文案微调前、微调后各一次） | **exit 0 / exit 0**，两次末行都是 `Component Lab smoke passed: http://127.0.0.1:3001/`；输出含 `Agent Profile DialogWindow geometry`、`Settings view layout`、`Agent Profile container layout` 三段（core + agent-profile + settings + project-picker 全绿） |
| 3 | `bun run docs:check`（worktree 根） | **exit 0**，`{"failures":[],"checkedFiles":5893}` |
| 4 | `bunx vue-tsc --noEmit -p tsconfig.json`（`packages/neuro-book`，只读，不重建 `.nuxt`） | **exit 0，零诊断**。先确认它真的在查 SFC：临时在 fixture 里插入 `const __t57Probe: number = "probe";` → **exit 2**，唯一一行 `app/component-lab/fixtures/WorkbenchViewHostFixture.vue(34,7): error TS2322: Type 'string' is not assignable to type 'number'.`；探针随即撤回并复跑（即本行结果）。`--listFilesOnly` 确认三个新/改文件都在 program 里（`WorkbenchViewHost.vue`、`WorkbenchViewHostFixture.vue`、`fixtures/index.ts`） |
| 5 | `bunx tsc --noEmit -p tsconfig.json`（`packages/neuro-book`，纯 `tsc` 对照） | exit 2，88 行诊断**全部是既有问题**：`packages/nb-ui/src/components/index.ts`（`*.vue` 类型再导出，58 行）、`app/components/common/low-code-form/LowCodeCheckboxField.test.ts`、`app/components/novel-ide/settings/sections/frontend/FrontendSettingsView.types.ts`、`app/components/workbench/workbench-grid-consumers.test.ts`（本次未触碰）。我改/新增的四个文件零诊断 |
| 6 | 浏览器只读取证（omp 托管 Chromium → `http://127.0.0.1:3001/lab`） | 见 §四.2；未启停 3001、未起第二个 dev server |

## 三、实现要点（与 Task README 的对应）

1. **文档（要求 1）** `WorkbenchViewHost.md` 的正文与实现逐条对齐（先读实现再写）：
   - 职责边界写成四步链：容器声明 → 视图解析（可见 / 失败 / 不可见三类都交回）→ 懒实例化（只有可见视图才解析，不可见没有实例）→ 失败可见（诊断而不是空白）。
   - `when` 语义单列一节：封闭枚举 `requires`、全部满足才可见、原因来自 `descriptors.ts` 的取值域、**可见性不是权限**、未登记取值与未登记容器是「失败」而不是「不可见」。
   - 分工写明三处：声明与求值在 `product-catalog.ts`（`resolveContainerViews` / `layoutContractOfViews`）、`factoryKey` → 组件只在 `view-factories.ts` 白名单、`requiredAuthority` / `stateScope` 不在本组件求值范围内。
   - 「不读持久化状态」写进不支持一节：不读 store / 不读 Storage（`localStorage` / `sessionStorage` / IndexedDB）/ 不发请求 / 不注册全局监听；展开项一类 memento 归视图自己的会话层。
   - 另记录可核对事实：`data-container*`（来自容器部件）、`data-view-host`、`data-view="<id>"` 锚点、两处注入是测试缝隙。
2. **fixture 三场景（要求 2）** `WorkbenchViewHostFixture.vue`：
   - 视图声明直接复用产品的 `SHELL_FILES_VIEW`（不复制 descriptor），另加一条合法但 `factoryKey: "lab.view.ghost"` 的 `lab.ghost`；注册表用既有 `createWorkbenchRegistry` 构造一次。
   - `default`：`context.project = true` → `nbook.files` 可见、经 stub 渲染（24 行内置数据），`lab.ghost` 不满足 `when` 故无锚点；内容区合同 `fill`。
   - `hidden`：`context.project = false` → 没有可见视图、没有实例，空态给出 `when` 原因（去重、`；` 连接），合同退回默认 `scroll`。
   - `unknown-factory`：`lab.ghost` 可见 → 解析失败在容器内可见（视图锚点保留 + `role="status"` 诊断），不空白。**诊断文字来自产品白名单**：fixture 的解析器只替 `nbook.view.files` 一个键，其余键回落到 `resolveWorkbenchViewFactory`，所以那条「未登记的内置 factoryKey：…」是产品原话（对照组：t55 在 `product-catalog.test.ts` 里修过的 `DescriptorResult` 包装层缺陷）。
   - 无网络、无持久化、不读 store：唯一的环境事实是场景里算出来的内存 `context`。
3. **可挂载性（要求 3）** 见 §四.1：标签推导 `mountable: true`，并在真实 Lab 页面被选中且挂载成功。
4. **不回归（要求 4）** Lab smoke 全量 exit 0（§二.2）、`docs:check` exit 0（§二.3）、vue-tsc 零诊断（§二.4）。

## 四、验证

### 4.1 可挂载性自查（标签 → 索引）

- 输入（frontmatter，`WorkbenchViewHost.md:1-3`）：`标签: [state:local]`。
- 规则（`app/component-lab/component-index.ts:88-108`）：含 `io:` 或 `state:shared-write` → 不可挂；含 `persist:` → 不可挂；否则 `mountable: true`（`state:shared-read` 才额外标 `needsSnapshot`）。`state:local` 只表示组件自持临时状态，不伸到组件之外。
- 推导输出：`mountable: true`、`blockedReason: ""`、`needsSnapshot: false`。
- 页面侧证据（浏览器实测，非只看推导）：Lab 左栏 `workbench` 分组下出现 `WorkbenchViewHost` 并可选中；选中后中栏挂载 fixture（**没有**出现「不能在 Lab 里验证」的锁态空态，`.lab-empty` 探测为 `null`）；右栏「文档」显示 `目录 workbench / 能力标签 state:local / 确定性验证 可以`——最后一项就是索引推导结果在 UI 上的呈现。

### 4.2 真实浏览器取证（omp 托管 Chromium，只读；`/lab`，1600×1000）

对**运行中的 3001**（hub `neurobook-3001`，cwd 即本 worktree 的 `packages/neuro-book`）逐场景点击后读取 DOM：

| 场景 | 观察（原文） |
|---|---|
| `可见视图（fill 内容区）` | 容器面：`data-container="nbook.tools"` / `data-container-location="sidebar-left"` / `data-container-part="left"` / `data-container-layout="fill"` / `aria-label="工具"` / `data-lab-subject` 在场；`[data-view-host]` 在场；视图锚点 = `["nbook.files"]`（`lab.ghost` 无锚点 = 无实例）；stub 叶渲染 24 行「示例条目 N」；无 `role="status"` 诊断；`console` 无 error/warning |
| `when 不可见（空态给原因）` | `data-container-layout="scroll"`（合同退回默认）；视图锚点 `[]`；stub 不在 DOM；空态原文 `需要打开 Project；只在用户资产工作区可见`；无诊断行；零 console 噪音 |
| `未知 factoryKey（失败可见）` | `data-container-layout="scroll"`；视图锚点 = `["lab.ghost"]`（锚点保留）；锚点内 `role="status"` 原文 `未登记的内置 factoryKey：lab.view.ghost`；无 stub；零 console 噪音 |

三张截图（default / hidden / unknown-factory）在会话中看过：容器卡片头部标题「工具」、stub 行列表、空态一行、失败诊断一行，均按预期落位；**截图未落盘**（沿用本 Work 其余切片的做法，证据为可复核的 DOM 探针原文）。取景页面也未留下任何写入（Lab 偏好只在该只读探测会话自身）。

fixture 的舞台说明（Lab 里那段 fixture 自己的话）也逐场景核对过，三个场景分别是「Project 开着：容器里只有 nbook.files 一个可见视图（lab.ghost 不满足 when，因此没有实例），内容区合同取它的 fill。」「两个视图都不满足 when：…内容区退回默认 scroll。」「lab.ghost 可见，但它的 factoryKey 不在白名单里：失败在容器内可见（视图锚点还在），不静默空白。」——Lab 是纯文本呈现，所以文案里不写 Markdown 反引号（与 `WorkbenchContainerSurfaceFixture` 一致）；文案微调后重跑了 §二.2 与本节探针，结果不变。

### 4.3 回归面

- 宿主既有聚焦测试 5 例 + fixture 登记测试 4 例：exit 0（§二.1）。
- Lab smoke 对 3001 全量：exit 0（§二.2）。
- 类型：vue-tsc exit 0（§二.4）。

## 五、未运行项与偏差（明确列出）

- **未运行**：`bun run typecheck`（`nuxt typecheck` 会重建 `.nuxt`，3001 在线期间禁止；改用 `bunx vue-tsc --noEmit` / `bunx tsc --noEmit` 只读替代）；全量 `bun run test`、Product 门禁与构建（属 Main 的统一门禁）；未启停 3001、未起第二个 dev server、未访问其它包。
- **缝隙的必要性（要求 3 的代价，已最小化）**：产品目录里唯一的叶 `nbook.view.files` → `WorkspaceFilePanel` 依赖 Pinia store、workspace API、对话框与 i18n，Lab 不给它搭台子。因此 fixture 注入两处（既有 `registry` prop + 新增 `viewFactoryResolver` prop）；stub **只**覆盖这一个 factoryKey，其余键仍走产品白名单。产品页面一个都不传（`app/pages/index.vue:2645-2648` 只传 container / container-title / context），默认行为未变。
- **偏差 1（场景 2 的文案是两条原因）**：`hidden` 场景里两个视图都不满足 `when`，空态按真实行为列出两条原因并去重连接（`需要打开 Project；只在用户资产工作区可见`）。这是宿主在画声明，不是 fixture 造的文案；舞台说明里写明了。
- **偏差 2（fixture 无数据旋钮）**：三个场景没有 `data`——它们的差别是宿主收到的环境事实（`context`），不是可调假数据。右栏「数据」tab 因此显示「没有可改数据」，与 `SurfaceTierDemo` 一类场景同档。
- **未提交**：未 `git add` 目录、未 commit、未 push；`git status --porcelain` 显示我的改动只有 2 改 + 2 新（+ 本次记录），用户 dirty 的 `descriptors{,.test}.ts` 未被我触碰。

## 六、文档门禁

| 命令（cwd） | 结果 |
|---|---|
| `bun run docs:check`（worktree 根，本记录落盘后） | **exit 0**，`{"failures":[],"checkedFiles":5893}` |
