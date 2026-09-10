---
schema: nbook.walkthrough/v1
taskId: t14-agent-profile-nav-lab-migration
sequence: 1
role: tasker
status: incomplete
createdAt: 2026-09-04T00:00:00Z
---

# t14 Agent Profile 导航 Lab-first 迁移

## 结论

本轮已完成 Agent Profile 设置子树整理、`AgentProfileNavList` 的 nb-ui replacement、固定 Component Lab fixture、聚焦行为测试和真实 Node + Chromium Lab smoke。开发者检查点 A/B 的人工观感结论尚未获得，因此本 Task 未闭合；不把“未反馈”记为通过。

当前 `.output` 的 Product Runtime Image manifest 为 3,298 个 payload 文件、137,325,651 bytes，`imageId` 为 `sha256:51fe977683f352b74e95a47f85827e52a46b6dce33885031a10dc9420189eaa9`，`sourceDigest` 为 `sha256:6f2beea6a2f0da4fdd99f7068f3ea9179dfb2da9beb0a422a30511a0f9c6c10b`，`createdAt` 为 `2026-09-04T11:00:23.269Z`。

两份正式 v5 Product evidence 仍引用旧的 `a9fe…` / `137693…` / `10:13` 批次；旧 evidence 仅作历史记录，未形成当前 Product gate 证据。当前 Product gate 必须保持 `incomplete`。

最终隔离实例曾尝试请求 `/lab`，但当前日志/evidence 未保留可审计的 `/lab` response 与 server-log 记录；实际可审计日志只记录 `/api/app/version` 返回 200 与受控 shutdown 返回 202。supervised probe 进程退出码为 0，但这不能补足 `/lab` 验证，因此不能沿用旧 evidence 的 `/lab=302`，也不能把当前 Product HTTP probe 写成完整通过。

主应用 Product-ready、主页接回、C 产品主题 clean cutover、t09 `LabShell.vue` 拆分和全局全量门禁不属于本 Task 的完成范围。

## 目标与范围

- 迁移 Profile 专属文件到 `app/components/novel-ide/settings/views/agent-profile/`，删除旧入口，不添加 alias、re-export 或兼容分支。
- 原地重写 `AgentProfileNavList.vue`，继续由父编排器拥有 Profile 数据和保存/编译状态。
- 通过 nb-ui `Badge`、`FormField`、`FormInput` 表达状态、搜索和导航语义。
- 添加同名文档、领域类型、五个确定性 fixture 场景、行为测试和真实 Lab smoke。
- 不修改 `docs/specs/theme/system.md`，不恢复主页、不迁移 C 产品主题，不拆分 `LabShell.vue`。

## 已完成实现

### 目录与调用方

以下 8 个 Profile 专属文件已迁移到 `packages/neuro-book/app/components/novel-ide/settings/views/agent-profile/`：

- `AgentProfileNavList.vue`
- `AgentProfileDefaultsPanel.vue`
- `AgentProfileDetailPanel.vue`
- `AgentProfileModelFields.vue`
- `ProfileRuntimeSettingsFields.vue`
- `agent-profile-draft.ts`
- `profile-runtime-settings.ts`
- `profile-runtime-settings.test.ts`

`NovelIdeAgentProfileModelSettingsPanel.vue` 保留在 `settings/` 作为父编排器；它的 `navItems`、受控 `activeNavKey`/`navSearch`/`defaultsDirty`、保存、编译和详情编排没有改变。父组件通过独立的 `AgentProfileNavList.types.ts` type-only import 使用领域类型。活动源码中的 Profile 入口均指向新目录或新目录内部相对路径；历史 `.agents` provenance 未改写。

目录迁移先单独提交：`b5da5000`（`refactor(neurobook): group agent profile settings`）。本轮 replacement、fixture、测试、smoke 和文档仍是该 revision 之后的未提交增量。

### Replacement 与行为合同

`AgentProfileNavList.vue` 继续使用受控 props：`items`、`activeKey`、`search`、`defaultsDirty`；继续发出 `update:activeKey` 与 `update:search`。搜索对 `name` 和 `profileKey` 做 trim 后的大小写不敏感 `includes`，事件 payload 保留原始字符串。默认入口不受搜索过滤影响，未知 key 不自动 emit。

组件使用原生 `<nav>`、可见 `h2` 和 `useId()` 生成的 `aria-labelledby`；行使用原生按钮和 `aria-current="page"`。不引入 listbox 方向键/Home/End 模型。七种 load status 均显示可读文案和显式 `aria-hidden="true"` 装饰图标；Badge tone 分布固定为 success 1、accent 1、warning 2、danger 3。默认、dirty 和覆盖计数也进入可读内容。搜索不启用 `FormInput.clearable`，清空由用户编辑 input 完成并保持焦点。长列表只在独立列表容器内滚动。

### 文档、类型与 fixture

新增并列同名文档 `AgentProfileNavList.md`，frontmatter 使用 `标签: [state:inject]`，如实说明唯一隐藏通道是 Nuxt i18n provider 提供的 `t`。文档记录 props/emits、无 slots/expose、attrs、状态、ARIA、键盘、窄屏布局、不支持项和失败边界。

新增 `AgentProfileNavList.types.ts`，从 `ConfigAgentProfileSettingsDto` 推导封闭 `ProfileLoadStatus`，并持有 `AgentProfileNavItem`。

新增 `AgentProfileNavListFixture.vue` 和 `fixtures/index.ts` 中的五个场景：

- `statuses` / 状态全集：七种状态，初始 `activeKey: "p2"`。
- `defaults` / 默认设置：`activeKey: ""`、`defaultsDirty: true`。
- `long-list` / 长列表与长文本：固定 30 项，包含长中英文名称、长 key 和多徽章行。
- `empty` / 空列表：空 Profile 列表，默认入口仍存在。
- `no-match` / 搜索无匹配：固定搜索词 `不存在的搜索词xyz`，清空后恢复两项。

fixture 只使用固定内存数据和 `useLabEventSink()`；不读取真实配置、store、API、Project、Session、Provider/Model、本机文件、时间或随机数。场景切换和数据还原重置受控状态。

### Smoke CLI 修复

独立 smoke 位于 `packages/neuro-book/scripts/smoke/agent-profile-nav.ts`，由 `component-lab.ts` 调用。它覆盖组件树定位、五场景、两套主题、七状态、ARIA、事件、搜索、默认/Profile 选择、dirty、数据还原、键盘、焦点、reduced-motion、长列表内部滚动、桌面和 `390 × 844` 溢出。

本轮发现并修复了两个 smoke 证据问题：

1. 重新选择已经激活的“状态全集”时，fixture 的场景单选可能不触发真正重置。`selectScene()` 现在先点击其它未选 radio，等待目标场景失活，再点击目标并等待目标场景与 fixture surface 同步；`checkStatusSet()` 随后等待当前 Profile 恢复到 `p2` 后再检查七种状态。
2. `component-lab.ts` 原先只有导出函数和 `parseOptions()`，末尾缺少 CLI 执行入口，直接运行命令会静默退出。现在通过 `pathToFileURL(resolve(process.argv[1])).href` 判断直接执行，`await runComponentLabSmoke(...)`，捕获错误打印 stack/message 并设置 `process.exitCode = 1`。无效参数和连接失败均已观察到非零退出。

另修正了窄屏长文本断言：断言可见的固定名称前缀，而不依赖可能被 CSS 截断后的完整文本内容。

## 开发者检查点

### 检查点 A：实现结论（未完成人工结论）

请求开发者在 Component Lab 检查：

- 名称、Profile key 与状态/默认/dirty/覆盖元数据的信息层级；
- 七种 load status 都有持续可见短文案，不只依赖颜色；
- `390 × 844` 继续使用固定搜索、默认入口和纵向列表，而不是横向条或抽屉。

当前记录：自动测试和 smoke 已证明这些元素存在、可操作且不溢出；人工观感结论未授权/未反馈，不能写成“通过”。

### 检查点 B：首版观感结论（未完成人工结论）

已提供真实 Lab 首版供人工观感判断。自动 smoke 不能替代开发者对桌面与手机画面的实际判断。当前没有开发者人工验收结果，因此 B 保持未完成。

## 验证记录

以下命令均在本 Task worktree 执行；实际构建路径不写入正式证据正文，临时根统一记为 `<system-temp>`。Product 结论只接受与当前 `.output` identity 相同、且由实际运行记录支持的证据。

### 已验证

- `bun run --cwd packages/neuro-book test -- app/components/novel-ide/settings/agent-profile app/component-lab app/utils/novel-ide-settings-responsive.contract.test.ts`
  - 已记录 `6 files passed`、`25 tests passed`。
- `bun run --cwd packages/neuro-book test -- app/components/novel-ide/settings/views/agent-profile/AgentProfileNavList.test.ts`
  - 补齐七种状态文案逐项断言后，实际为 `1 file passed`、`8 tests passed`。
- `bun test scripts/build/product-runtime-bundle.test.ts -t "public 资源中的相对 pnpm module id"`
  - 实际为 `1 pass`，验证相对 `.pnpm` / `.bun` module id 收敛到 Product 内部路径。
- `node --check scripts/build/patch-nitro-runtime-deps.mjs` 与 `bun run --cwd packages/neuro-book scripts:typecheck`
  - 均实际通过；Product public 后处理包含已知文本扩展名白名单，非 UTF-8 资产不写回。
- `bun run --cwd packages/neuro-book nuxt:build:raw`
  - 当前源码 raw Developer Build State 构建实际完成；该结果不是 Product gate 的替代输入。当前未形成与本次 Product image 绑定的 raw 扫描摘要。
- `bun run --cwd packages/neuro-book nuxt:build`
  - 11:00 构建实际完成；当前 `.output` manifest 为 `3,298 files / 137,325,651 bytes`，`imageId=sha256:51fe977683f352b74e95a47f85827e52a46b6dce33885031a10dc9420189eaa9`，`sourceDigest=sha256:6f2beea6a2f0da4fdd99f7068f3ea9179dfb2da9beb0a422a30511a0f9c6c10b`，`createdAt=2026-09-04T11:00:23.269Z`。
- 当前最终隔离实例的 SQLite migration 与 Application State migration 均实际退出码 `0`；使用系统 Temp State Root，未触碰共享用户 State Root。
- 真实 Component Lab smoke 的既有结果保留：Source Dev 使用系统 Temp 隔离 State Root，Node + Chromium smoke 实际通过；开发者检查点 A/B 仍未人工验收。

### Product 未闭合

- 两份正式 v5 Product evidence 仍引用旧的 `a9fe…` / `137693…` / `10:13` 批次；旧 evidence 仅作历史记录，不作为当前 `51fe…` Product gate 证据。
- 当前最终隔离实例曾尝试请求 `/lab`，但日志/evidence 未保留可审计的 `/lab` response 与 server-log 记录；实际日志记录 `/api/app/version` `200`、受控 shutdown `202` 和 supervised 进程 exit code `0`。因此 `/lab` 未形成可审计验证，完整 Product HTTP probe 未完成。
- 当前 `51fe…` image 的完整静态 payload 扫描没有形成与该 image identity 绑定的正式 evidence；不得把旧 image 的 0 命中摘要移植到当前 image。
- `product:policy:check`、`docs:check`、`governance:check` 与 `git diff --check` 的既有结果保留为此前检查记录；本次 walkthrough/evidence 修改后的最终状态未重新运行这些命令。
- 两份 evidence 当前 read 到 shutdown 对象闭合行为为 `},`；本轮未重新执行 `JSON.parse`，不把它们写成已完成的当前证据。

## 允许红色 ledger

本轮未观察到新的允许红色。以下是既有或环境级事实，不作为 t14 通过证据：

| 项目 | 状态 | 归因与恢复条件 |
| --- | --- | --- |
| 默认用户 State Root 被其它 NeuroBook 实例持有 | 已避开，未改动共享数据 | 非 t14 代码失败；使用隔离 State Root 运行。不得删除 `runtime.lease.lock`；关闭占用实例后才可复用默认根。 |
| `nb-ui` 全量 E2E 历史 17 项失败 | 既有 advisory，未在本轮重跑 | 包含 `#nb-lab-target` 缺失和约 3%–6% 视觉快照漂移；修复 nb-ui Lab 合同/基线后恢复。不得更新快照掩盖问题。 |
| 主应用主页接入 / 产品主题 clean cutover | 本 Task 范围外 | 完成 C 产品主题与主页消费者接回后，在对应 Product-ready Task 重跑真实流程和全局门禁。 |
| t09 `LabShell.vue` 超过 800 行 | 已延期 | 恢复 t09 后拆分并运行其 own tests/smoke/docs/governance/diff gates。 |

本轮不能把上述条目改写为“预期失败”，也不能把它们改为 t14 引入的错误。

## 未验证项与交接

- 开发者检查点 A：未获得人工信息架构和窄屏取舍结论。
- 开发者检查点 B：未获得人工桌面/手机观感结论；自动 smoke 不替代人工验收。
- 当前 `.output` 与两份 v5 Product evidence identity 不一致：当前为 `51fe…` / `6f2bee…` / `11:00:23`，evidence 为旧 `a9fe…` / `137693…` / `10:13`；旧 evidence 仅作历史，未形成当前 Product gate 证据。
- 当前最终隔离实例曾尝试请求 `/lab`，但日志/evidence 没有可审计的 `/lab` response 与 server-log 记录；`/api/app/version=200`、shutdown `202` 与进程退出 `0` 已实际观察，但完整 `/lab` probe 未验证。
- 当前 `51fe…` image 的完整静态扫描结果未形成正式 evidence；不得沿用旧 image 的扫描摘要。
- 完整 NeuroBook 全量测试未运行；nb-ui 历史全量 E2E advisory 仍未解决。
- `product:measure` 早于当前最终 Builder 镜像执行，`dirty: true` 只能作为 Source identity；不能替代当前 imageId、全文扫描和 HTTP probe。
- Product 隔离副本和扫描临时根待后续收口清理；不删除共享 `runtime.lease.lock`。
- 主 checkout 误建的 evidence 目录尚未处置；需开发者明确授权后再删除或保留。
- 未执行 push、PR、合并、发布、部署、数据库迁移到真实用户数据或真实 Provider/Model 调用。

## 可复用步骤

- Product 排除必须扫描完整 Builder 产物；raw Nuxt output 只能作为 Developer Build State 记录，不能直接启动后宣告 Product 通过。
- 绝对路径扫描同时覆盖规范化仓库根、Worktree 后代、`file://` Windows URL、反斜杠和 package-manager metadata；同一 canonical needle 的 occurrence 单独计数，避免把多个 spelling 重复相加。
- Product Runtime Image 先走 `bun run --cwd packages/neuro-book nuxt:build`，再在系统 Temp 隔离根执行 migration、HTTP probe 与 token shutdown；不得写入用户 State Root。shutdown 必须使用受控 Bearer 请求，不能用 SIGINT 代替。
- route chunk 集合、正式 `/api/app/version` HTTP、`/lab` exclusion 分开记录；日志没有 `/lab` 时不得从旧 probe 拼接 `/lab=302`。
- 真实 Lab smoke 必须由 Node CLI 执行并传播错误退出码；场景重选需等待受控 fixture 还原。
- 行为测试锁定文本、事件 payload、ARIA、焦点和边界，不锁定完整 class 或偶然像素。
- `bun run docs:check`、`bun run governance:check`、`git diff --check` 必须在最终源码/证据状态下串行执行。
- 开发者检查点 A/B 未获得结果时保留未闭合状态，不得把自动 smoke 或 Product gate 代替人工观感。

### 真实失败与修复

- 旧 `component-lab.ts` 无 CLI 入口：直接运行曾无输出、退出 0，属于静默空跑。补入口后，无效参数和连接失败均已观察到非零退出。
- 3016 Product probe 是历史失败记录：曾因 shutdown 控制流程未完成而退出码为 `1`；不替代当前未完成的 probe，也不改变当前 evidence identity mismatch。
- 旧镜像曾发现 `public/_nuxt/b5WaFR6h.js` 中 45 次相对 `node_modules/.pnpm/` 命中；根因修复已进入 Builder public 资产阶段，但当前 `51fe…` image 的正式扫描 evidence 尚未形成，不能移植旧摘要。
- 当前最终隔离实例曾尝试请求 `/lab`，但未保留可审计的 `/lab` response 与 server-log 记录；实际记录两次 `/api/app/version` `200` 与两次受控 shutdown `202`，因此 Product gate 保持 `incomplete`。

## 交接结论

Agent Profile replacement、聚焦测试和真实 Component Lab smoke 有实际结果；当前 Product evidence identity 未同步，HTTP probe 缺少可审计的 `/lab`，开发者检查点 A/B 也未人工验收，因此保持 `status: incomplete`。不声明 t14 闭合，不 push、不建 PR、不合并、不发布、不部署，也不宣称整个 Work 或 Issue #191 完成。
