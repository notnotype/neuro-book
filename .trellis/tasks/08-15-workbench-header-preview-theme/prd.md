# World Engine Workbench 顶栏拥挤优化 + Preview 主题跟随修复

## Goal

解决两处用户可感知的 UI 问题：(1) World Engine Workbench 弹窗 header 在常见窗口宽度下元素过多、文字按钮 + 状态 pill 互相挤压，观感拥挤；(2) 点击工作台「Preview」打开的独立预览页（以及同款 mock 调试页）不跟随 IDE 当前主题，始终显示默认 Sepia Paper 配色。

## Requirements

- R1 弹窗 header（`WorldEngineWorkbenchDialog.vue` 的 `#header` 槽）操作区改为图标 + tooltip：刷新、新建 Slice、编辑 Slice、删除 Slice、检查器、Preview 六个动作按钮去掉文字，改为 `h-8 w-8` 纯图标按钮，保留 `title`/`aria-label`；删除按钮保留 hover 危险色；各按钮原有响应式隐藏断点不变。
- R2 「草稿」按钮保留 `data-testid="world-workbench-draft-summary"`，改为图标 + 数量徽标 + `title=draftSummaryTitle`；「检查器」按钮保留 `data-testid="world-workbench-inspector-toggle"` 及 proposal/meta 计数徽标（紧凑内联）。
- R3 「已同步 / 同步中 / 需要处理」状态 pill 保持文字展示，不做图标化（它是状态不是按钮）。
- R4 `/world-engine.preview` 与 `/world-engine.workbench-preview` 两个页面跟随 IDE 当前主题：复用 `login.vue` 模式，`useNovelIdeStore()` + `storeToRefs` 取 `activeThemeId / customThemes / themeVarsSnapshot`，`useIdeTheme` 挂载到页面根 div（`ref="themeHostRef"` + `onMounted` 时 `mountThemeHost`）；mock 页根 div 保留 `world-engine-workbench-preview world-engine-workbench-theme` class。
- R5 不新增页面内主题切换器；不改 `app/styles/theme-vars.css` 的 `:root` 兜底值。
- R6 契约测试同步：`world-engine-ide-entry.test.ts` 与 `world-engine-workbench-preview.test.ts` 追加源码级断言，确认两个页面接入 `useIdeTheme` / `mountThemeHost` / `themeHostRef`。

## Acceptance Criteria

- [ ] 1440px 与 1280px 视口下弹窗 header 单行不挤压，操作区宽度较现状（约 579px）显著减小；图标按钮 tooltip 与 aria-label 可读。
- [ ] 状态 pill（已同步/同步中/需要处理）、草稿徽标、检查器计数徽标在图标化后仍正常显示；`world-workbench-draft-summary` / `world-workbench-inspector-toggle` testid 保留。
- [ ] 点 Preview 打开的新标签页背景/文字/accent 色与 IDE 当前主题一致（如 light 主题下 `--bg-main:#f6f8fa`）；mock 调试页同样跟随；切换 IDE 主题后重开 Preview 颜色跟随。
- [ ] `world-engine-ide-entry` 与 `world-engine-workbench-preview` 相关 vitest 用例通过（含新增断言），既有 token 断言不破坏。
- [ ] 不改动其他 `*.preview.vue` 页面、不加页面内主题切换器、不改 `:root` 兜底值。

## Out of Scope

- 其他独立 preview 页（plot-timeline.preview 等）的主题行为保持不变。
- mock 页 header 布局保持不变（仅修主题）。
- 弹窗 header 不做双行布局或折叠菜单。
