# 2026-07-06 · UI 审查与优化轮（用户反馈 5 点）

## 背景

B1–B10 由执行 agent 完成后，用户对照浏览器截图提出 5 点反馈，本轮做代码审查 + UI 优化。

## 审查结论（对 B1–B10 产出的评价）

- 整体质量良好：draft 状态机、失败回滚（`useThemeManager` 的 revision 竞态保护）、`resolveCssColorValue` 离屏解析 color-mix、派生规则实现都符合 PLAN 设计，主题聚焦测试可复现通过。
- **发现一个真 bug（用户反馈点 5 的根因）**：`vue3-colorpicker` 的 `ColorPicker` 组件 `inheritAttrs: false` 且根节点是 Fragment，`FormColorField` 传入的 `class="form-color-field__picker"` 被整体丢弃——scoped 的 22px 触发器尺寸样式从未生效（截图中失控的大色块）；弹层默认 teleport 到 `body`，脱离 `.novel-ide-theme` 主题宿主，层叠依赖 popper 定位，在 Dialog 内脆弱；该库也不提供吸管。
- 小问题：设置入口的主题平铺按钮只有文字无色彩预览（反馈点 2）；预览卡覆盖变量不全（约 25/36，反馈点 4）。

## 本轮变更

### 1. 新建 `app/components/common/DialogWindow.vue`（反馈点 3）

- **决策：新建组件而不是增强 Dialog**。理由：浮动窗口与模态对话框交互模型不同（无遮罩层 vs 遮罩+点击关闭、拖动定位 vs 居中、页面保持可交互 vs 阻断），Dialog 被全仓大量使用，往里塞 `variant` 分叉会翻倍 prop 面并有回归风险；两者只共享视觉语言（header/body/footer 槽位、主题变量）。
- 实现：无遮罩、`position: fixed` + `left/top` 定位（刻意不用 transform，避免破坏子级 fixed 定位）、标题栏拖动（VueUse `useDraggable`，clamp 保证窗口始终可抓回）、毛玻璃窗体（`color-mix(var(--bg-panel) 86%, transparent)` + backdrop-blur）、Esc/关闭按钮、busy 阻断关闭、首开停靠视口右上并记住拖动位置。
- 已登记 CLAUDE.md 与 AGENTS.md 通用组件索引。

### 2. `FormColorField.vue` 重写（反馈点 5）

- 弃用 vue3-colorpicker 的自带弹层，改用其 **`is-widget` 内嵌模式**装进自绘 popover：`fixed` 坐标按触发色块 `getBoundingClientRect` 计算、越界向上翻转、teleport 到 `closest('.novel-ide-theme')`（复用 `ReferencePlainTextEditor.vue` 既有模式）、`onClickOutside`/Esc（capture，不冒泡到宿主窗口）/滚动/resize 关闭。
- 左侧色块即触发按钮（带棋盘格透明底纹）；新增**吸管按钮**：原生 `EyeDropper` API，不支持的浏览器（非 Chromium）不渲染按钮，用户取消静默忽略。
- 新增 `pickerTheme` prop：弹层调色盘明暗跟随被编辑主题的 appearance。

### 3. `ThemeEditorDialog.vue` 迁到 DialogWindow（反馈点 3）

- 560px 单列布局 + 三个标签页：核心调色盘 / 全部变量 / 实时预览；名称、外观、按核心色重新生成收纳在顶部条。
- **打开编辑器时自动收起设置对话框，关闭后恢复**（`NovelIdeSettingsDialog` 内 watch `themeEditorOpen`）——否则浮动窗口后面是设置对话框的遮罩，看不到真实页面。
- 切标签页时清空残留非法标记（draft 只存合法颜色，字段重挂后旧标记必然过期；保存前仍有全量 colord 校验兜底）。

### 4. `ThemePreviewCard.vue` 场景化重写（反馈点 4）

- 四个场景覆盖全部 36 变量：工作台（toolbar-bg/侧栏选中态 border-accent+accent-bg+accent-text/悬停 bg-hover/面板+shadow-color 投影/bg-subtle 附注条/border-strong 输入框/text-inverse 主按钮/四组状态三件套）、编辑器（editor-bg + **selection-bg 选区高亮**）、源码（source-bg/text/muted + accent-text 关键字）、对话（chat-ai-bg AI 气泡 + accent 用户气泡）。
- 示例文案换成小说语境真实文本（i18n `settings.themePreview.*`，中英双语），比灰条更能检验文字层级对比度。

### 5. 设置入口主题卡片网格（反馈点 2）

- 平铺文字按钮 → 带迷你配色预览的卡片网格（`auto-fill minmax(150px,1fr)`）：预览区用**该主题自己的变量**画侧栏/面板/Aa 文字/accent+四状态色点，名称行用当前主题变量保证底盘一致；选中卡片 accent 描边 + 勾选标记。
- 操作去中心化：全局仅留「新建、导入」；内置卡片悬停出「复制、导出」，自定义卡片悬停出「编辑、复制、导出、删除」。相应把 `openThemeCopier/openThemeEditor/exportTheme/requestDeleteTheme` 参数化，删除了 `themeOptions` 下拉与 `activeCustomTheme` 依赖。

## 变更文件

- 新增：`app/components/common/DialogWindow.vue`
- 重写：`app/components/common/form/FormColorField.vue`、`app/components/novel-ide/settings/theme/ThemeEditorDialog.vue`、`ThemePreviewCard.vue`
- 调整：`ThemeCorePaletteSection.vue`、`ThemeAdvancedVarsSection.vue`（去外层卡片、透传 pickerTheme）、`NovelIdeSettingsDialog.vue`（卡片网格 + 参数化处理器 + 编辑时收起设置）
- i18n：`zh-CN.ts`/`en-US.ts`（common.colorField* ×3、themeEditor.tab*/floatHint ×4、themePreview.* ×18）
- 文档：CLAUDE.md、AGENTS.md 通用组件索引

## 验证

- `bunx vitest run app/utils/theme/*.test.ts`（derive/theme-io/resolve-theme/theme-editor/theme-tokens）：5 files / 13 tests 全过。
- `bun run typecheck`：失败仅剩既有 agent plan-mode / profile DSL / low-code-form 基线（与 B10 时记录一致），本轮触碰的 8 个文件 0 错误（按 `^app|^shared` 过滤复核）。
- 浏览器验证未执行（按任务约束需用户同意）；重点验证项：弹层调色盘在编辑器窗口内正常弹出、吸管取色、窗口拖动边界、设置↔编辑器收起恢复循环。

## 与计划的出入

- PLAN.md B9 原设计是模态 Dialog 双栏 + 常驻预览列；本轮按用户新需求改为浮动窗口 + 标签页，预览卡从"常驻右栏"变为第三个标签（整个 IDE 本身就是实时预览，预览卡降级为补充展示）。
- PLAN.md 假定 vue3-colorpicker 自带弹层可用；实际其 attrs 丢弃 + body teleport 两个特性使原集成不成立，改为 widget 内嵌模式。吸管是 PLAN 没有的新增需求（原生 EyeDropper，Chromium 专属）。
