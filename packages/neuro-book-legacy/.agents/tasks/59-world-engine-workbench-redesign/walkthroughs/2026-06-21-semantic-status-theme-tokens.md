# 2026-06-21 Semantic Status Theme Tokens

## Context

用户指出“主题系统只有一种颜色，有点单调”。澄清后确认这里指的是 IDE 主题系统本身：当前 token 主要依靠 `accent` 和背景层级，状态信息常在组件中直接写 `amber / rose / emerald / blue`，在 `sepia paper` 下尤其容易显得割裂。

本轮按用户计划先建立全局语义状态色，并优先接入真实 World Engine Workbench；`/world-engine.workbench-preview` 继续保留冷白技术工作台设计预览皮肤。

## Changes

- `app/utils/theme/theme-tokens.ts`
  - 所有 `IdeTheme` 增加 `info / success / warning / danger` 四组语义状态 token。
  - `sepia` 使用低饱和蓝灰、橄榄绿、暖琥珀和赭红，避免状态色在纸面主题中过亮。
- `app/styles/theme-vars.css`
  - SSR / fallback 默认值同步补齐 sepia 语义状态 token。
- `WorldEngineWorkbenchDialog.vue`
  - 新增 `world-engine-workbench-theme` 主题作用域，让 header 和 body 共用同一组 `--we-*` 局部变量。
  - `--we-warning* / --we-danger*` 改为从全局 `--status-*` 派生，并新增 `--we-info* / --we-success*`。
  - 顶部同步状态点、error / notice 条、Draft / 待接入主体系统提示改用 `--we-success / --we-warning / --we-danger`，减少硬编码状态色。
- 测试
  - 新增 `app/utils/theme/theme-tokens.test.ts`，覆盖所有主题的语义 token 完整性、`themeVarKeys` 应用 / 清理、fallback CSS 与 sepia 对齐。
  - 更新 `app/utils/world-engine-ide-entry.test.ts`，钉住真实 Workbench 从 `--status-*` 派生 `--we-*`，并防止关键状态条回退到硬编码 amber / rose / emerald。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/theme/theme-tokens.test.ts`：通过，2 个测试文件 6 个测试全部通过。
- `bun run typecheck`：通过。

## Notes

- 本轮没有迁移全站所有硬编码状态色，只建立全局 token 并先接入真实 World Engine Workbench。
- 本轮没有自动做浏览器视觉验收；后续建议人工检查 `sepia paper` 下真实 Workbench 的宽屏和较窄桌面视口。
