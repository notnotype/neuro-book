# B6 shared + 服务端配置管线

## 范围

- `shared/theme/theme-vars.ts`
- `shared/dto/config.dto.ts`
- `server/config/types.ts`
- `server/config/normalizer.ts`
- `server/config/registry.ts`
- `server/config/config-service.ts`
- `server/config/normalizer.test.ts`
- `server/config/config-service.test.ts`
- `server/api/config/bootstrap.get.ts`
- `server/openapi/route-map.ts`
- `scripts/deploy/config-render.mjs`
- `app/utils/theme/theme-tokens.ts`
- `app/components/novel-ide/settings/NovelIdeCostSettingsPanel.vue`

## 变更

- 新增 shared 主题契约：内置 8 主题 id、`ThemeAppearance`、36 个无 `--` 前缀变量名、`CustomThemeDto`。
- `theme-tokens.ts` 改为复用 shared 的内置主题 id、appearance 和变量名；8 套预设变量值未改。
- `UiConfigDtoSchema.theme` 放宽为 string，并新增 `ui.customThemes`，自定义主题 DTO 使用 `custom-[a-z0-9-]+` id、1-50 字名称、light/dark appearance、变量键白名单。
- 服务端 config 类型、normalizer、effective config 支持 `ui.customThemes`。
- `normalizeTheme` 放宽为「内置 8 id 或现存 custom theme id」，否则回退 `sepia`。
- `normalizeCustomThemes` 做 id 去重、非法主题过滤、非法变量键过滤，不补齐缺键。
- bootstrap 返回 `ui.theme`、`ui.customThemes`、`ui.costCurrency`。
- registry 新增 `ui.customThemes`，并更新 `ui.theme` 描述。
- deploy config render 透传旧配置中的 `customThemes` 和 `costCurrency`。
- 费用设置保存全局 UI 配置时保留 `customThemes`，避免只改币种时清空自定义主题。

## 验证

- `bun run generate:openapi` 通过：
  - 40 个 route meta 刷新，`config/bootstrap.get.ts` 已包含 `customThemes` schema。
- `bun run typecheck` 未通过，但 B6 相关类型错误已在第二次运行中清零；剩余失败为既有基线：
  - agent Plan Mode / Agent Mode 契约不一致：`planModeActive` 不存在、`"plan"` 不在 command kind union、`AGENT_PLAN_MODE_STATE_KEY` 缺失、`enterPlanMode/exitPlanMode` 工具缺失。
  - `server/agent/profiles/writer-profile-contract.test.ts` 仍缺 `customTopSystemPrompt`。
  - `server/low-code-form/index.ts(798,13)` 仍是 `LowCodeJsonValue | undefined` 赋给 `LowCodeJsonValue`。
- `bun run test` 未通过，失败不在 B6 主题配置范围：
  - 汇总：19 failed files，73 failed tests，2 unhandled errors。
  - 代表性失败：agent harness / profile compile / profile catalog / Plan Mode 相关用例、workspace-files hook timeout、sqlite-vec smoke、auth timeout、web_fetch timeout、plot API timeout、writer `customTopSystemPrompt.trim()`。
- 主题配置聚焦验证通过：
  - `bunx vitest run server/config/normalizer.test.ts server/config/config-service.test.ts -t "theme|Global UI"`
  - 2 个测试文件通过，3 个主题相关用例通过，33 个不相关用例跳过。

## 与计划出入

- `CustomThemeDto.id` 的 TypeScript 类型保持为 string，前缀约束交给 zod schema 与 normalizer；这样避免 DTO 推断值和模板字面量类型产生不必要的窄化冲突。
- 因 `bun run generate:openapi` 的脚本行为，多个 route meta 被刷新；B6 只依赖 config bootstrap/global 相关 schema，其他 route 为生成器同步产物。
- 未修复 agent/profile/low-code-form 既有失败，避免混入无关基线修复。

## 下一步

- 进入 B7：前端主题运行时开放化，新增主题解析入口、store/customThemes 状态、bootstrap 防 FOUC、主题切换保存到 global config。
