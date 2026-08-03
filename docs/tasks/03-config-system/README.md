# Config System

## User Request

- 统一 NeuroBook 的配置系统。
- 配置分为 Boot Config、Global Config、Project Config 和 Browser State。
- 前端每次获取配置都必须是最新的。
- 有些配置影响整个应用且属于启动期安全边界，例如 `auth.enabled`，必须放在 Boot Config。
- 有些配置修改后需要重启服务，应从可热更新配置中拆开。
- 有些配置需要像 VSCode 一样允许当前 Project Workspace 覆盖全局默认值。
- 设置页按照 Global 和当前 Project Workspace 组织，接近配置文件的真实边界。
- 术语必须规范，避免混用 Workspace Root、Project Workspace 和 user-assets。

## Summary

本轮已经把配置真值源从旧 `config.yaml` / workspace settings / settings API 拆成新的四层模型：

- Boot Config：根目录 `config.yaml`，只保留启动/部署期配置，第一版不进设置页。
- Global Config：`workspace/.nbook/config.json`，保存单用户全局运行配置。
- Project Config：`workspace/{project}/.nbook/config.json`，保存当前 Project Workspace 覆盖配置。
- Browser State：Pinia / `localStorage` / `sessionStorage`，只保存临时 UI 状态。

新正式入口为 `/api/config/*`。旧 `/api/settings/*`、`/api/workspace-settings` 和 `agent.tools.allow/deny` 设置入口已删除，不做 adapter。模型 Provider / API Key / Agent profile model 已迁入 Global Config；Agent invocation 开始前读取最新 effective config，并在单次 invocation 内固定当时快照。

旧配置迁移入口为 `bun run config:migrate`。脚本会读取旧根 `config.yaml`，把业务配置写入 `workspace/.nbook/config.json`，并把根 `config.yaml` 收窄为 Boot Config；迁移过程不会把 secret 打印到终端。

## Terms

稳定术语见 [Workspace Terms](../../../reference/workspace/TERMS.md)。本任务遵守以下规则：

- Workspace Root：应用运行数据根目录，默认 `workspace/`。
- Workspace Root `.nbook`：全局控制区，默认 `workspace/.nbook/`。
- Project Workspace：单本小说或具体项目目录，默认 `workspace/{project}/`。
- Project Workspace `.nbook`：项目级控制区，默认 `workspace/{project}/.nbook/`。
- user-assets：前端用于编辑 Workspace Root `.nbook` 的入口，不是独立配置 scope。
- Bundled Workspace Template：随项目发布的默认 workspace 模板与系统资源，位于 `assets/workspace/`。

## Implemented Model

### Boot Config

- 位置：根目录 `config.yaml`。
- 作用：启动/部署期配置。
- 当前示例只保留 `auth.enabled`、`server.host`、`server.port`、`database.kind`、`database.url`。
- `auth.enabled` 是 Boot Config 字段，修改后需要重启；缺省时开发环境关闭、生产环境开启。
- 设置页提供只读 Boot Config / 密码保护说明，不通过 API 编辑启动配置。
- 模型 Provider、API Key、Agent Profile 默认模型、UI/editor 偏好不再写入这里。
- 旧根 `config.yaml` 可通过 `bun run config:migrate` 收窄为只包含 `auth` / `server` / `database` 的 Boot Config。

### Global Config

- 位置：`workspace/.nbook/config.json`。
- 作用：单用户全局运行配置。
- 不存在时使用内置 defaults。
- GET snapshot 不自动创建文件；PUT 或部署初始化才创建。
- `bun run config:migrate` 会创建 `workspace/.nbook/config.json`。
- 保存内容包括：
    - `models.default`
    - `models.providers`
    - `agent.defaultProfileKey.novel`
    - `agent.defaultProfileKey.userAssets`
    - `agent.profileModelDefaults`
    - `agent.profiles`
    - `ui.theme`
    - `editor.markdown`
    - `editor.monaco`

### Project Config

- 位置：`workspace/{project}/.nbook/config.json`。
- 作用：当前 Project Workspace 覆盖配置。
- user-assets 入口没有独立 Project Config；它直接编辑 Workspace Root `.nbook/config.json`。
- 只允许覆盖 registry 标记为 `global-workspace` 的字段。
- Project Config 会拒绝覆盖：
    - `models.providers`

### Browser State

纯前端临时状态，不进入配置系统。

- 位置：Pinia persist / `sessionStorage` / `localStorage`。
- 示例：打开的 tab、drawer 展开状态、last session id、未保存编辑 buffer。

## Registry

配置项由 `server/config/registry.ts` 声明。每个配置项包含：

- `scope`：`boot` / `global` / `global-workspace`
- `effect`：`hot` / `next-run` / `next-session` / `restart-required`
- `merge`：`replace` / `deep-merge`
- `secret`
- `description`

当前规则：

- object 默认 deep-merge。
- array / primitive 默认 replace。
- `models.providers` 是 global-only。
- `auth.enabled` 是 Boot Config、`restart-required`，不会进入 Global/Project Config 写入 API。
- `models.default`、`agent.defaultProfileKey`、`agent.profileModelDefaults`、`agent.profiles`、`editor.markdown`、`editor.monaco` 可被 Project Config 覆盖。
- `agent.tools.allow/deny` 已删除，工具权限继续由 profile/tool policy 控制。

## Secret Semantics

Provider API Key 使用结构化 secret 语义：

```ts
type SecretConfigValue = {
    configured: boolean;
    maskedValue: string | null;
    value?: string;
};
```

- GET / editor snapshot 返回 `configured` 与 `maskedValue`，不返回明文 `value`。
- PUT 时 `value` 缺失表示保留原值。
- PUT 时 `value: ""` 表示清空。
- PUT 时 `value` 为非空字符串表示覆盖。

## API

正式入口：

```http
GET /api/config/snapshot?workspaceKind=novel&novelId=...
GET /api/config/editor-snapshot?workspaceKind=novel&novelId=...
PUT /api/config/global
PUT /api/config/project
POST /api/config/models/provider-check
POST /api/config/models/provider-discover
POST /api/config/models/model-check
```

旧入口已删除：

- `/api/settings/models`
- `/api/settings/agent-profile-models`
- `/api/settings/agent-tools`
- `/api/workspace-settings`

保存配置后，后端直接返回最新 editor snapshot。前端不在本地猜合并结果。

## Runtime Resolution

Snapshot 是运行时使用的最新配置结果，不承担来源解释；只有设置页 editor snapshot 需要 raw global/project 文件内容。

Agent 读取规则：

- 创建 session / invocation 前读取最新 effective config。
- 创建 session 时会把当时解析出的具体模型写入 session `model_change`；Composer 不再展示“默认模型”选项，后续切换也绑定具体模型。session 的稳定选择身份是 `providerConfigId + model.id`，不是持久化 metadata 快照。
- Provider 可持久化禁用；禁用 Provider 在运行时、默认模型候选、Composer 可选模型和旧 session 模型有效性校验中都视为不存在，但保留 API Key 与模型列表，重新启用后恢复原模型启用状态。
- 每次新 invocation（包括手动 compaction）会按 session selection key 从当前 effective config 的完整 Provider Config 重新解析模型；同 key 的模型能力、compat、Provider Base URL 或 token limits 变化时追加新的 `model_change`，深比较无变化时不写冗余记录。runtime 不查询 Model Catalog 或模型发现接口。
- 单次 invocation 开始后固定当时 config snapshot 与解析后的 runtime binding；turn、tool loop、自动 compaction 和 sidecar 不受运行中配置修改影响。
- compaction、model command 和 report_result reminder 路径都使用 invocation 开始时的模型配置。
- 如果旧 session 绑定的模型 key 已从当前配置中删除或禁用，snapshot / live state 会显示当前有效默认模型；下一次 run 前会追加新的具体模型 `model_change` 修正 active path。没有可用默认模型时 snapshot / live state 显示未选择，不追加 `model: null`，重置默认或 run 时明确报配置错误。

模型选择优先级：

1. explicit session override
2. Project `agent.profiles.<key>.model.modelKey`
3. Global `agent.profiles.<key>.model.modelKey`
4. Project `agent.profileModelDefaults.modelKey`
5. Global `agent.profileModelDefaults.modelKey`
6. Project `models.default`
7. Global `models.default`

Agent Profile 模型参数的通用合并层级：

1. hardcoded defaults：`modelKey: null`、`temperature: null`、`topK: null`、`reasoningEffort: "off"`、`stream: true`
2. Global `agent.profileModelDefaults`
3. Project `agent.profileModelDefaults`
4. Global `agent.profiles.<key>.model`
5. Project `agent.profiles.<key>.model`

## Settings UI

设置页已切到配置中心视图，并固定显示当前编辑目标：

- Dialog 顶部可在 `Global Config`、`Project Config`、`Browser State` 间切换。
- `Global Config` 写入 Workspace Root `workspace/.nbook/config.json`。
- `Project Config` 可选择任意 Project Workspace，写入 `workspace/{project}/.nbook/config.json`，不会切换当前 IDE 打开的小说。
- `Browser State` 只包含本地 UI 状态与编辑器显示偏好，不写入 config 文件。
- `user-assets` 入口只允许编辑 Global Config 与 Browser State，不提供 Project Config 目标。

Global Config 面板：

- 模型 Provider、API Key、模型白名单和 Global 默认模型保存到 Global Config。
- Agent 默认 Profile 保存到 Global `agent.defaultProfileKey.novel` / `agent.defaultProfileKey.userAssets`。
- Agent Profile 共同默认模型参数保存到 Global `agent.profileModelDefaults`。
- 单个 Agent Profile 模型参数覆盖保存到 Global `agent.profiles`。
- Secret 字段显示已配置/未配置与脱敏值；不会把脱敏值当明文写回。

Project Config 面板：

- Project 默认模型保存到 Project `models.default`；选择“跟随 Global 默认模型”会清除覆盖值。
- Project 默认 Profile 保存到 Project `agent.defaultProfileKey`。
- Project Agent Profile 共同默认模型参数保存到 Project `agent.profileModelDefaults`。
- Project 单个 Agent Profile 模型参数覆盖保存到 Project `agent.profiles`；留空字段按运行时合并规则回落上层默认。
- Provider/API key、Provider 列表仍是 Global-only，不在 Project Config 中编辑。

模型健康检查、Provider 检查、模型发现入口已移动到 `/api/config/models/*`。旧 Agent 工具 allow/deny 设置分区已从设置 Dialog 删除。

后续设置页体验修复：

- 保存型配置面板的“保存设定”已提升到配置中心顶部配置目标栏右侧，滚动内容区时保持可见；Browser State 仍保持即时生效，不显示保存按钮。
- “保存设定”旁新增“恢复”按钮，dirty 草稿可重新读取已保存配置并放弃本地修改。
- 模型 Provider 配置 ID 编辑不再使用可编辑 ID 作为 Vue 节点 key，避免输入时右侧详情区重建闪烁。
- 保存模型配置后保留当前 Provider 选中状态和本地展开/草稿状态；切换配置分区、配置目标或关闭弹窗时，如果当前保存型面板有未保存修改，会先阻止并提示保存。
- 删除模型 Provider 的确认按钮会立即保存当前模型面板草稿；保存失败时不显示删除成功，草稿保持 dirty，可继续重试保存或点击恢复。
- 保存 Global / Project / Profile Home 配置后会 bump 前端 `configRevision`，Agent Composer 监听后重新拉取模型列表并刷新当前 session snapshot，避免模型设置变更后 Composer 仍显示旧模型列表。
- 模型 Provider 支持禁用；Provider 顶部不再显示独立“检查 Provider”入口，操作区已收紧为紧凑 toolbar；模型行操作按钮常驻显示，单模型检测结果临时显示在模型行内。“检测全部”按 Provider 维护批次锁，并发检测当前 Provider 下尚未检测中的启用模型，部分模型先完成时不会重复发起；前端取消会透传到后端 Pi stream，释放正在进行的模型请求。
- 模型健康检查 prompt 从固定问题列表随机抽取，不再发送简单 `Reply with ok.` 请求。

## Bundled Workspace Template

系统资源已收敛到：

```text
assets/
└── workspace/
    ├── .nbook/
    │   ├── agent/
    │   │   ├── profiles/
    │   │   └── skills/
    │   └── templates/
    │       ├── content-node-templates/
    │       └── novel-directory-templates/
    ├── global.config.example.json
    └── workspace.config.example.json
```

约定：

- `assets/workspace/.nbook` 是系统模板层。
- 运行时用户覆盖层是 `workspace/.nbook`。
- `assets/workspace/global.config.example.json` 对应 `workspace/.nbook/config.json`。
- `assets/workspace/workspace.config.example.json` 对应 `workspace/{project}/.nbook/config.json`。
- 示例文件不是运行时真值，不会被 resolver 当作自动覆盖层读取。

## Workspace Creation

- 部署脚本会创建 `workspace/`，并在首次部署时创建 `workspace/.nbook/config.json`。
- 应用启动时通过 server plugin 确保 Workspace Root `workspace/` 存在。
- 访问 user-assets 或同步系统 assets 时会确保 `workspace/.nbook/` 存在。
- GET snapshot 仍不自动创建配置文件；只有 PUT、部署初始化或 `bun run config:migrate` 会创建 `workspace/.nbook/config.json`。

## Decisions

- 不做多用户 User Config；单用户全局配置就是 Global Config。
- Boot Config 和可热更新业务配置拆开。
- Global Config 和 Project Config 都使用 JSON；Boot Config 继续使用 YAML。
- 第一版不实现动态 `workspace.root`；启动后只确保默认 Workspace Root `workspace/` 存在。
- GET snapshot 不自动创建配置文件。
- 写入接口使用 PUT，第一版不做 patch。
- 第一版不做写入原子锁、version conflict 或跨进程配置广播。
- 旧 settings API 立即删除，不做兼容 adapter。
- 运行时配置文件属于本机数据，继续由 `.gitignore` 忽略 `config.yaml`、`workspace/`、`.deploy/`。
- 示例文件保留在 `assets/workspace/*.example.json`，不忽略。

## Files Changed

- `shared/dto/config.dto.ts`
- `server/config/*`
- `server/api/config/*`
- `server/utils/app-config.ts`
- `server/utils/auth.ts`
- `server/agent/harness/model-resolver.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/session/*`
- `server/agent/http.ts`
- `server/agent/tools/builtin-tools.ts`
- `server/assets/asset-resolver.ts`
- `server/workspace-files/novel-workspace.ts`
- `server/workspace-files/content-node-templates.ts`
- `server/openapi/route-map.ts`
- `app/composables/useConfigApi.ts`
- `app/components/novel-ide/NovelIdeSettingsDialog.vue`
- `app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue`
- `app/components/novel-ide/settings/NovelIdeAgentProfileDefaultSettingsPanel.vue`
- `app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue`
- `app/components/novel-ide/NovelAgentDrawer.vue`
- `app/pages/index.vue`
- `app/pages/model-settings.preview.vue`
- `app/stores/novel-ide.ts`
- `assets/workspace/global.config.example.json`
- `assets/workspace/workspace.config.example.json`
- `config.example.yaml`
- `scripts/migrate-config-system.ts`
- `scripts/smoke-agent.ts`
- 当时的旧部署脚本（已删除）
- `scripts/check-profile.ts`
- `scripts/prepare-profile-types.ts`
- `server/plugins/workspace-root.ts`

删除旧入口与旧 DTO：

- `server/api/settings/*`
- `server/api/workspace-settings/*`
- `server/workspace-settings/*`
- `shared/dto/workspace-settings.dto.ts`
- `shared/dto/app-settings.dto.ts` 中的 Agent tool settings DTO

## 2026-07-18 Model Config 硬切

- Provider Config 已删除 `defaultApi`、Discovery Adapter 和 endpoint path；Automatic Model Discovery 的 Adapter 选择不再属于 Global Config。
- 新增连接级必填 `modelApi`，用于选择 discovery 协议，以及手动添加和 Model Library 候选补全；Base URL、Secret 与模型目录不足以安全推断协议。每个已保存模型仍必须保存最终 `model.api`，runtime 不从 Provider 字段回退，同一 Provider 的模型允许分别使用不同接口。
- Global Config 写入合同现在校验所有模型，包括 disabled 模型；`enabled` 只影响 runnable 集合，不能再用禁用状态保存不完整模型。
- 设置页一键修复会删除无法补全的 disabled 坏模型，但不会自动删除 enabled 模型或能力完整的 disabled 模型。
- Model Library 与 Provider Template Library 只服务设置页创建/补全，不进入 Config runtime 解析。
- 核心实现阶段没有擅自修改真实 Workspace Root `.nbook/config.json`；数据清理只在后续获得用户明确授权后执行。
- 2026-07-18 用户授权后，正式 Config Service 写入 seam 已删除 5 条历史不完整 disabled 模型；默认模型和 Secret 保留语义未变，清理后模型 validation issue 为 0。
- 2026-07-19 交互验收纠正 Provider 连接身份：Provider ID、Base URL 与 proxy 继续不可隐式迁移；`modelApi` 只是可编辑的 discovery/候选补全偏好。已保存 Provider 可更新该字段并通过 `sourceIndex` 保留原 Secret，端点身份变化仍必须复制连接。
- 一键修复只在 Provider 的所有已保存模型都使用同一种受支持 `model.api` 时补全缺失 `modelApi`；空模型、混合 API、缺失或未知值继续要求用户选择，不从名称、URL 或 Secret 猜测。

## Verification

### 2026-07-14：Global Config 测试隔离事故修复

- 复现现象：真实`workspace/.nbook/config.json`从工作树消失，同时系统临时目录遗留`nbook-config-test-*/config.json`；7月11日与7月13日各存在一份未恢复备份，证明问题可重复发生。
- 根因：`config-service.test.ts`的`beforeEach`会把真实Global Config和Global Agent资源目录rename到临时目录，`afterEach`再移回。测试进程被中断、超时或强制退出时不会执行恢复，真实用户配置因此留在临时目录。
- 修复：Config Service测试改用现有`createIsolatedWorkspaceAssets({useAsCwd: true})`，Global Config、Global Agent资源和Project fixture全部位于独立临时State Root。删除真实目录备份、清空和恢复逻辑，测试不再接触用户数据。
- 数据恢复：按用户决策使用7月11日备份恢复真实Global Config；恢复后文件SHA256与备份完全一致，JSON解析通过，未输出任何secret。
- 验证：`bun test server/config/config-service.test.ts --path-ignore-patterns=product`通过39项测试；测试前后真实Global Config SHA256保持不变。另一次误包含`product/`源码副本的测试运行虽然出现重复模块`instanceof`失败，真实Global Config仍保持不变，证明失败路径也不会再搬移用户配置。
- 实际计划差异：仓库已有Workspace assets隔离基础设施，无需新增Config专用fixture。问题不是业务Config读写，而是测试绕开统一路径Context直接操作真实cwd。

### 2026-07-18：Model Config 硬切验证

- `bun run typecheck`：通过。
- `bunx vitest run` 聚焦 21 个文件：156 tests passed，覆盖 Config normalizer/service、Provider Config 合同、Model Library、Provider Template、Automatic Discovery、Candidate Completion、model settings、四个前端 session Module、模型检查 route 和 Agent harness fixture。
- `NovelIdeModelSettingsPanel.vue` 已从约 1980 行降至 695 行；Config 草稿、Provider Template、Automatic Discovery 和模型健康检查分别由独立 Module 持有。
- `bun run nuxt:build`：通过。
- `bun run nuxt:build`：通过，确认模型设置页拆分后的客户端与 Product Runtime bundle 可编译。
- `bun run generate:openapi`：42 个 route meta 更新成功；`server/api/config/**` 的 `defaultApi` / `discovery` 审计为零，相关 route 已包含 `modelApi`。

已通过：

- `bun test server/config`
- `bun test server/utils/app-config.test.ts`
- `bun test server/agent`
- `bun test server/workspace-files`
- `bun scripts/prepare-profile-types.ts --all`
- `bunx tsc --noEmit --pretty false`
- 旧部署脚本语法检查（历史验证，入口已删除）
- `node --check scripts/deploy.mjs`

本轮设置页重构追加验证：

- `bunx tsc --noEmit --pretty false`

本轮设置页保存与闪烁修复追加验证：

- `bun run typecheck` 仍受既有无关 TypeScript 错误阻塞，错误集中在 Agent session tree、Profile template editor、agent compaction 和 silly-tavern-card CLI 测试，未指向本轮配置中心文件。

本轮模型设置删除保存与 Composer 同步追加验证：

- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts`：153 tests passed。
- `bun run typecheck` 仍受既有 Plot / Scene 类型错误阻塞，错误集中在 `chapterPath/chapterId`、`StoryScene`、`actId` 等类型收敛问题，未指向本轮模型设置或 Agent Composer 文件。

本轮 Provider 禁用与模型检测 UX 追加验证：

- `bunx vitest run server/utils/model-settings.test.ts server/config/config-service.test.ts server/agent/harness/model-resolver.test.ts`：57 tests passed。
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "创建 session 时绑定当前解析出的具体模型|model command 的 null|已删除的 session 模型|没有可用默认模型"`：5 tests passed，148 skipped。
- `bun run typecheck` 仍受既有 Plot / Scene 类型错误阻塞，当前输出集中在 `NovelPlotPanel.vue` 的 `chapterPath/chapterId` 类型收敛问题，未指向本轮 Provider 禁用或模型检测文件。

本轮模型检测取消、批量状态与 Provider 布局系统修复追加验证：

- `bunx vitest run server/api/config/models/model-check.post.test.ts server/api/config/models/provider-check.post.test.ts`：4 tests passed，覆盖 model-check route 的 H3-like event、AbortSignal 第三参、request aborted / response close 取消链路与监听器清理。
- `bunx vitest run server/utils/model-settings.test.ts`：15 tests passed，覆盖已取消 signal 不进入 Pi stream、active signal 传递给 Pi streamSimple。
- `bunx vitest run server/utils/model-settings.test.ts server/config/config-service.test.ts server/agent/harness/model-resolver.test.ts`：59 tests passed。
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "模型|model"`：23 tests passed，130 skipped。
- `bun run typecheck` 仍受既有 Plot / Scene 类型错误阻塞，当前输出集中在 `NovelPlotPanel.vue` 的 `chapterPath/chapterId` 类型收敛问题，未指向本轮模型设置、model-check API 或模型配置工具文件。

已知非本轮业务失败：

- `server/api/workspace-files/download.get.test.ts`
- `server/api/workspace-files/events.get.test.ts`
- `server/api/workspace-files/write.put.test.ts`

这些 API 测试当前失败原因是测试环境里的 `vi.resetModules` / `vi.doUnmock` API 不存在，属于测试工具兼容问题，不是 Config System 迁移失败。

## TODO / Follow-ups

- 设置页后续可继续增强 raw/effective 差异展示，目前已支持 Global / Project 目标切换、Project selector 和核心覆盖项清除。
- Boot Config schema 后续继续细化，并决定是否把 `server` / `database` 字段接入真正的启动期读取链路。
- 写入原子锁、version conflict、跨进程配置广播后续再做。
- 修复 workspace-files API tests 的 Vitest mock API 兼容问题。
- 后续部署文档如有新增部署模式，继续保持 Provider/API Key 在 `workspace/.nbook/config.json`，根 `config.yaml` 只做 Boot Config。
