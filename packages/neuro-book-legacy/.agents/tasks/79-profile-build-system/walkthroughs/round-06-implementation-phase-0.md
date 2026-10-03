# Round 06 — Implementation Phase 0: 读路径硬切 + 前端状态

> 本轮开始按 `IMPLEMENTATION-GOAL.md` 落地。Phase 0 的边界是不改 `.compiled` 产物格式、不引入 Publisher/Registry，只先把 config 轻快照与 profile settings 重路径拆开，并让前端保留 profile 状态。

## 1. 目标映射

- `GET /api/config/editor-snapshot` 不再无条件读取 `profiles.snapshot()`，也不再返回 `agentProfileSettings` 大包。
- 新增 `/api/agent/profiles/settings` 作为唯一读取 lowcode settings form/value/inherited 的接口。
- 新增 `/api/agent/profiles/build-status`，先暴露静态 catalog 状态，Phase 2 Coordinator 接入后填充 running/queued。
- `NovelIdeAgentProfileModelSettingsPanel.vue` 保留 `loadStatus / issue / hasSettingsForm / sourcePath / buildState`，表单不可用时渲染状态块。
- `AgentChatSurface.vue` 的模型列表改用 `bootstrap()`，不再打完整 editor-snapshot。

## 2. 变更文件

- `shared/dto/config.dto.ts`
  - 移除 `ConfigEditorSnapshotDto.agentProfileSettings`。
  - 新增 `ConfigAgentProfileSettingsQueryDtoSchema`、`ConfigAgentProfileLoadStatusDtoSchema`、`ConfigAgentProfileBuildStateDtoSchema`、`ConfigAgentProfileBuildStatusDtoSchema`。
  - `ConfigAgentProfileSettingsDto.agentProfiles[]` 增加 `loadStatus / hasSettingsForm / issue / sourcePath / buildState`。
- `server/config/config-service.ts`
  - `readConfigEditorSnapshot()` 不再接触 `AgentProfileCatalog`。
  - 新增 `readConfigAgentProfileSettings()` 和 `readConfigAgentProfileBuildStatus()`。
  - 保存/重置 config 后只返回轻 editor snapshot；settings 由专用接口重新读取。
- `server/api/agent/profiles/settings.get.ts`
  - 新增 settings 专用 GET route。
- `server/api/agent/profiles/build-status.get.ts`
  - 新增 build status GET route。
- `server/config/query.ts`
  - editor snapshot query 硬切为 workspace query。
  - 新增 settings query 校验。
- `app/composables/useConfigApi.ts`
  - 移除 `includeAgentProfileSettings` query 构造。
  - 新增 `agentProfileSettings()` / `agentProfileBuildStatus()`。
- `app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue`
  - 加载时并行读取轻 editor snapshot + settings 专用快照。
  - 保存/重置后重取 settings。
  - lowcode 区域从 `v-if="profile.settings"` 改为状态驱动渲染。
  - 接入 build-status 轮询入口。
- `app/components/novel-ide/agent/AgentChatSurface.vue`
  - `loadSelectableModels()` 改用 `configApi.bootstrap()`。
- `app/i18n/locales/zh-CN.ts`、`app/i18n/locales/en-US.ts`
  - 新增 profile settings 状态块文案。
- `server/config/config-service.test.ts`、`server/config/query.test.ts`
  - 更新为新契约测试，并增加 editor-snapshot 不触发 catalog 的断言。
- `server/openapi/route-map.ts` 与生成的 route meta
  - config 相关 route 的 query/response meta 已刷新。

## 3. 验证结果

- `bunx vitest run server/config/query.test.ts server/config/config-service.test.ts`
  - 通过：2 files / 35 tests。
- `bun run typecheck`
  - 通过。
- 静态搜索：
  - `AgentChatSurface.vue` 已无 `configApi.editorSnapshot()`。
  - `server/config/config-service.ts` 中 `profiles.snapshot()` 只存在于 `readConfigAgentProfileSettings()` / `readConfigAgentProfileBuildStatus()` 专用路径。
  - `server/api/config/**` 与 `shared/dto/config.dto.ts` 已无 `agentProfileSettings` 响应字段。

## 4. 计划出入

- 已完成 Phase 0 的核心切分和前端状态显示。
- `/api/agent/profiles/build-status` 目前只能投影 catalog 静态状态；真实 `compiling/running/queued` 要等 Phase 2 的 `ProfileBuildCoordinator/ProfileBuildState` 接入。
- 本轮没有改 `.compiled` 格式，也没有消灭半提交窗口；这是 Phase 1 的验收门。
- 按原计划没有浏览器验证；需要时可再打开本地页面观察 settings 面板状态块和请求频率。

## 5. 测试备注

- 曾尝试 `bun test server/config/query.test.ts server/config/config-service.test.ts`，Bun 的匹配把 `.gitignore` 下的 `product/server/**` staging 拷贝也带入，导致旧 product 拷贝测试与源码测试并发抢 `workspace/.nbook/agents`，出现一次 `EPERM rename` 和旧契约断言失败。
- `product/` 已在 `.gitignore`，不是本轮源码真相源；最终使用 Vitest 精确路径验证通过。
