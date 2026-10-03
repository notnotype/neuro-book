# Theme Token Adaptation

## User Request

- 用户指出这里说的是 UI 主题系统，不是 `simulation/subjects` 主体系统。
- 当前 Project 选择 `sepia paper` 主题后，主 IDE World Engine Workbench 仍显示浅白色技术工作台主题。

## Diagnosis

- `Dialog` 默认 teleport 到 `.novel-ide-theme`，但 `index.vue` 是在父页面 `onMounted` 里调用 `mountThemeHost()` 添加该 class；子 Dialog 也在 `onMounted` 后启用 Teleport，存在目标选择器先于主题宿主 class 解析的风险。真实 Workbench 是主 IDE 内的大型工作台，不需要脱离当前主题宿主。
- 另一个问题在 `WorldEngineWorkbenchDialog.vue` 根样式：
  - `.world-engine-workbench-dialog` 硬编码了 `--we-bg-canvas: #f6f8f7`、`--we-bg-panel: #ffffff`、`--we-accent: #078768` 等浅白绿色变量。
  - 同一作用域又把 `--bg-main / --bg-panel / --accent-main` 反向覆盖成 `--we-*`，导致子组件和公共控件都无法继承当前 Project 的 `sepia paper` token。
- 顶栏 Draft / Inspector warning 状态还有 `bg-amber-50`、`hover:bg-amber-100`、`bg-white` 这类固定浅色 Tailwind 类，草稿出现时会再次露出白底块。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 对当前 Workbench Dialog 设置 `:teleport-target="false"`，让 Dialog 固定渲染在 `index.vue` 的 `.novel-ide-theme` 宿主内，直接继承当前 Project 主题变量。
  - 保留 `--we-*` 作为 Workbench 内部语义变量。
  - 将 `--we-*` 改为从 IDE 当前主题 token 派生：
    - 背景、面板、hover、active、边框、文本、accent 均使用 `--bg-* / --text-* / --border-* / --accent-*`。
    - code 区域使用 `--source-bg / --source-text`。
    - warning / danger soft 背景改为基于当前 panel 的 `color-mix`，避免固定白底。
  - 删除对全局 `--bg-main / --bg-panel / --accent-main` 等 token 的反向覆盖。
  - 清理顶栏 Draft / Inspector warning 状态的固定浅色类，改为 `--we-warning-*` 与 `--we-bg-panel`。
- `app/utils/world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确保真实 Workbench 的 `--we-*` 来自全局主题 token。
  - 明确禁止浅白绿色硬编码、全局 token 反向覆盖、Draft 顶栏固定白底类回归。
  - 断言真实 Workbench Dialog 禁用 Teleport，避免脱离项目主题宿主。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，2 个文件，9 条测试。
- `bun run typecheck`：通过。
- 浏览器验证：
  - 打开 `http://localhost:3000/?project=workspace%2Fming-ding-zhi-shi-2`，点击 `WORLD`。
  - `.novel-ide-theme` computed token：`--bg-main #f4ecd8`、`--bg-panel #fdf6e3`、`--bg-sidebar #ebe0c8`、`--accent-main #d97743`。
  - `.world-engine-workbench-dialog` 位于 `.novel-ide-theme` 内，computed `background-color = rgb(244, 236, 216)`，`--we-bg-canvas = #f4ecd8`，`--we-bg-panel = #fdf6e3`，`--we-accent = #d97743`。
  - 左侧 Sidebar、主画布 Slice Card、右侧 Inspector 和 Dialog panel 均在 `.novel-ide-theme` 内，面板背景为 `rgb(253, 246, 227)`。
  - 1180 宽桌面视口下 `panelOverflowX = 0`，根背景仍为 `rgb(244, 236, 216)`。
  - 截图：`.agent/workspace/world-engine-theme-sepia-1600.png` 与 `.agent/workspace/world-engine-theme-sepia-1180.png`。

## Notes

- 本轮没有改 mock `/world-engine.workbench-preview` 的独立视觉方向；该页面仍可作为 UI 实验场保留技术工作台外观。
- 本轮浏览器验证覆盖真实主 IDE Workbench；mock preview route 的浅白技术台外观仍是刻意保留，不作为项目主题适配结果。
