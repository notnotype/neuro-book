# B8 派生规则 + 取色器基建

## 目标

- 安装仅允许新增的 `colord` 与 `vue3-colorpicker`。
- 增加自定义主题核心色派生规则、主题 JSON 导入导出工具。
- 增加通用颜色字段组件，供 B9 主题编辑器复用。

## 变更文件

- `package.json`
- `bun.lock`
- `app/utils/browser-download.ts`
- `app/utils/theme/derive.ts`
- `app/utils/theme/derive.test.ts`
- `app/utils/theme/theme-io.ts`
- `app/utils/theme/theme-io.test.ts`
- `app/components/common/form/FormColorField.vue`
- `app/stores/novel-ide.ts`
- `CLAUDE.md`

## 实施记录

- 运行 `bun add colord vue3-colorpicker`：
  - `colord@2.9.3`
  - `vue3-colorpicker@2.3.0`
- 新增 `deriveDefaults(coreVars, appearance)`：
  - 明确 `CORE_VAR_KEYS` 13 个核心变量；
  - 派生其余 23 个变量；
  - 输出 DTO 变量名，不带 `--`；
  - 使用 `colord` + mix plugin 输出可直接写入 CSS 变量的颜色字符串。
- 新增 `theme-io.ts`：
  - `exportThemeJson()` 输出 `{schemaVersion: 1, name, appearance, vars}`；
  - `parseThemeJson()` 校验 schema version、appearance 与变量白名单；
  - `downloadThemeJson()` 复用浏览器下载工具。
- 将 store 内部 `triggerBrowserDownload` 抽到 `app/utils/browser-download.ts`，workspace 下载与主题 JSON 下载共用实现。
- 新增 `FormColorField.vue`：
  - 包装 `vue3-colorpicker` 的 `ColorPicker`；
  - 支持 swatch、文本输入、alpha；
  - 非法颜色仅显示局部错误，不向父组件 emit 无效值。
- `CLAUDE.md` 通用组件索引登记 `app/components/common/form/FormColorField.vue`。

## 验证

- `bunx vitest run app/utils/theme/derive.test.ts app/utils/theme/theme-io.test.ts app/utils/theme/resolve-theme.test.ts`：通过，3 files passed，6 tests passed。
- `bun run typecheck`：未通过。B8 相关过滤输出为空；失败仍集中在既有 Agent plan-mode 类型契约、profile DSL、writer profile、`server/low-code-form/index.ts(798,13)` 等基线。
- `bun run test`：未通过。结果为 148 files passed、22 failed、1 skipped；1218 tests passed、76 failed、87 skipped。新增 derive/theme-io 测试通过；失败仍集中在 Agent/profile/workspace/auth/web/plot/world-engine timeout 或 plan-mode 基线。本轮额外出现 `server/config/config-service.test.ts` 对 `workspace/.nbook/agents` 执行 rename 时 `EPERM`，属于测试环境文件占用/权限问题，非主题代码路径。
- `bun run generate:openapi`：通过，40 routes updated，0 failed。

## 与计划的出入

- 派生规则落为编辑器默认值，不触碰 8 套内置预设字面值，符合“预设视觉零漂移”约束。
- `downloadThemeJson()` 使用新抽出的 `browser-download` 工具，而不是继续引用 store 私有函数；这是为了让下载能力成为通用工具，避免 theme util 反向依赖 Pinia store。
- 未进行浏览器验证，遵守“浏览器验证先征求用户同意”的约束。

## 下一步

- B9：接入主题编辑器 Dialog，使用 `deriveDefaults`、`theme-io`、`FormColorField` 完成新建、编辑、复制、删除、导入、导出与实时预览。
