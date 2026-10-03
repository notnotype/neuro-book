# B1 变量表 v2 重写

## 本轮目标

- 将内置 8 套主题从旧 39 变量迁移到 v2.1 的 36 变量契约。
- 收编主题 label / appearance 到 `themeMeta`。
- 清理 B1 范围内旧变量消费点，保留 `--we-*` 别名层但改指向。
- 为 `theme-vars.css` 和 `themeTokens.sepia` 建立完整同步锁。

## 变更文件

- `app/utils/theme/theme-tokens.ts`
  - 新增 `ideThemeIds`、`ThemeAppearance`、`themeVarKeys`、`ThemeVarKey`、`themeMeta`。
  - `ThemeVars` 收紧为 36 个变量键的完整 `Record`。
  - 8 套预设写入 36 个变量字面值，保留原预设色值，新增 `bg-subtle`、`border-accent`、`shadow-color`、`selection-bg`。
- `app/styles/theme-vars.css`
  - 重写为 sepia 的 36 变量 fallback。
  - 新增 `.novel-ide-theme ::selection { background: var(--selection-bg); }`。
- `app/utils/theme/theme-tokens.test.ts`
  - 新增 36 变量契约锁。
  - 新增 fallback CSS 与 `themeTokens.sepia` 全量同步锁。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `--we-bg-muted` / `--we-bg-data` 指向 `--bg-subtle`。
  - `--we-bg-active` 指向 `--bg-hover`。
  - `--we-border-strong` 指向 `--border-strong`。
  - `--we-accent-border` 指向 `--border-accent`。
- `app/utils/world-engine-ide-entry.test.ts`
  - 同步 `--we-*` 桥断言。
- 其他消费点
  - `--border-color-hover` 改为 `--border-strong`。
  - `--agent-bg` 改为 `--chat-ai-bg`。
  - `--prompt-bg` / `--prompt-border` 改为 `--bg-panel` / `--border-color`。
  - editor canvas / preview 变量合并为 `--editor-bg`。
  - `--bg-active` 消费点改为 `--bg-hover`。
- `app/components/novel-ide/NovelIdeSettingsDialog.vue`
  - 主题下拉选项改为从 `themeMeta` 派生。

## 验证结果

- `bun run typecheck`
  - 未通过。
  - 失败点与 B1 主题改动无直接交集：
    - `server/agent/profiles/writer-profile-contract.test.ts(61,17)` 缺少 `customTopSystemPrompt`。
    - `server/low-code-form/index.ts(798,13)` `LowCodeJsonValue | undefined` 赋给 `LowCodeJsonValue`。
- `bun run test`
  - 未通过。
  - 全仓结果：17 个失败文件、42 个失败测试、3 个 unhandled errors。
  - 主要失败类型为服务端/agent/world-engine 超时、`workspace/.nbook/agents` rename EPERM、writer profile 缺字段、agent harness session ENOENT；与 B1 主题改动无直接交集。
- 主题相关窄验证：
  - `bunx vitest run app/utils/theme/theme-tokens.test.ts app/utils/world-engine-ide-entry.test.ts`
  - 通过：2 个测试文件、5 个测试。

## 与计划的出入

- B1 代码目标已完成。
- 全仓 typecheck / test 当前未全绿，原因落在 B1 范围外。未擅自修改这些无关服务端/agent 文件。
- `app/utils/theme/README.md` 仍包含旧变量说明，按 PLAN.md 留到 B5 全文重写。

## 下一步

- 进入 B2 前需要接受一个现实：全仓验证基线当前不是绿色。若继续推进，每批 walkthrough 会继续记录全仓命令失败与主题相关窄验证结果。
- B2 按计划清理 plot 区硬编码调色板类和 `dark:` 变体，分类色板定义文件不迁移。
