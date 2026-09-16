# 嵌套 grid 的 Lab 静态 fixture 与真实浏览器验收实现报告

状态：实现与真实浏览器验收完成，16 条 e2e 全部通过，类型检查 0 错误，待 Leader 统一复跑与独立复核（检查点 A）。
分支/工作区：`.worktree/w00003-neurobook-ui-foundation-migration`（`refactor/w00003-nb-ui-adoption`），未提交。

## 结果

为 Component Lab（`packages/nb-ui/playground/app/component-lab/`，路由 `/lab?component=nested-grid`）提供了静态确定性嵌套 grid fixture，并使用 Playwright 完成了包含四主题组合 × 桌面/390×844 窄屏矩阵的端到端浏览器验收。

逐条对应 Task [t45-nested-grid-lab-fixture](../README.md)「实现要求」：

1. **确定性 fixture**：
   - 默认布局、容器尺寸与初始记录完全静态固定：外层根分支 horizontal（左 240px，右 560px），右侧内层分支 vertical（上 270px，下 180px）。
   - 不依赖随机数、系统时间、网络或外部数据源，同一 scene 多次加载呈现完全可复述。
2. **两轴几何可观察**：
   - 顶部提供事实条显示两轴真实尺寸（`left` 宽、`right` 宽、外层 sash 像素、`top` 高、`bottom` 高、内层 sash 像素及容器总宽高）。
   - 数据属性可直接被测试和自动化巡检观测：`data-lab-size-left`、`data-lab-size-right`、`data-lab-size-top`、`data-lab-size-bottom`、`data-lab-sash-root`、`data-lab-sash-right`、`data-lab-total-width`、`data-lab-total-height`。
   - 外层主轴拖动时：左栏变宽、右分支变窄，两者之和守恒；内层纵轴高度完全不变（验证两轴正交几何独立性）。
   - 内层纵轴拖动时：上栏变高、下栏变矮，两者之和守恒；外层横轴列宽完全不变。
   - `issues` 降级诊断容器（`data-lab-issues-container`）：在可满足时报告 0 降级；开启「模拟过约束降级」控制后立即呈现原语计算的诊断列表，且尺寸被安全夹取，绝不出现负值或 `NaN`。
3. **手势边界可观察**：
   - 状态栏与事实属性通过 `data-lab-gesture` 展示手势边界：
     - `data-lab-gesture-state`：`none` | `start` | `update` | `commit` | `cancel`
     - `data-lab-commit-count`：累计提交次数
     - `data-lab-last-sash`：触发调整的分隔条身份（如 `left~right`、`top~bottom`）
     - `data-lab-last-active`：主动变动节点数组（如 `["left", "right"]`、`["top", "bottom"]`）
     - `data-lab-last-compensated`：被动补偿节点数组
     - `data-lab-gesture-payload`：完整 JSON 载荷
   - 鼠标拖动结束只提交一次；
   - 键盘按键连发（跨多次 `keydown` 直到 `keyup`）只作为单次手势提交一次；
   - `Escape` 取消手势产生 `gesture-cancel`，提交次数保持为 0，手势状态收口为 `cancel`；
   - 程序布局（点击「程序重排」按钮直接调用 `grid.layout()`）更新呈现尺寸，但产生 0 次手势提交。
4. **快照恢复场景**（全部在内存中完成，不写产品存储）：
   - `default`：正常两轴嵌套快照，恢复状态 `success`，issues 为 0。
   - `unknown-ref`：包含未知插件视图 `unknown-plugin-view`，调用 `grid.restore` 时 resolver 过滤该节点，恢复状态为 `dropped-unknown`；原始内存记录完整保留该节点；后续调整已知节点（如拖拽外层 sash）时通过 `syncRawRecordIntent` 仅更新已知节点的两轴意图，未识别节点不会在内存原件中被抹除。
   - `malformed`：包含重复节点身份 `id: "left"` 的畸形快照，`grid.restore` 整体拒绝（`ok: false`），恢复状态为 `rejected`，不半更新，不抛出未捕获异常。
   - `high-version`：包含 `version: 99` 的超前版本快照，`grid.restore` 整体拒绝，恢复状态为 `rejected`，保留原件并呈现安全默认布局。
5. **窄屏 390×844**：
   - 在 390×844 视口下结构与桌面保持一致，容器受父级约束自适应缩窄，横向无溢出（`document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0`）。
   - 在窄屏下 sash 依然可聚焦并通过键盘（`ArrowRight`）进行正常手势调整与提交。
6. **主题与配色**：
   - 完全消费 nb-ui 主题角色变量（`var(--bg-main)`、`var(--bg-panel)`、`var(--bg-sidebar)`、`var(--divider)`、`var(--text-main)`、`var(--text-secondary)`、`var(--text-muted)`、`var(--accent-main)`、`var(--border-color)`、`var(--radius-control)`、`var(--radius-panel)` 等）。
   - 无任何硬编码十六进制颜色。
   - 四种主题/配色组合（`nbook/nbook-light`、`nbook/nbook-dark`、`macos/macos-light`、`macos/macos-dark`）下均通过自动化测试。
7. **无第二约定**：
   - 严格消费既有 `FixtureShell`、`registry.ts` 与 `LabStage.vue` 模式。

## 变更文件清单

1. `packages/nb-ui/playground/app/component-lab/registry.ts`：
   - 扩展 `LabComponentId` 联合类型新增 `"nested-grid"`；
   - 登记 `nested-grid` 组件定义：分类 `"layout"`、中文名 `"嵌套分栏 NestedGrid"`、场景清单（`default`、`unknown-ref`、`malformed`、`high-version`）、属性控制（`disabled`、`forceOverConstrained`、`zeroInnerSash`）、`targetSelector: "#nb-lab-target"`、可观察事件名单（`["layout", "gesture-start", "gesture-update", "gesture-end", "gesture-cancel", "restore"]`）。
2. `packages/nb-ui/playground/app/component-lab/LabStage.vue`：
   - 导入 `NestedGridFixture.vue` 并注册到 `fixtures["nested-grid"]` 映射中。
3. `packages/nb-ui/playground/app/component-lab/fixtures/NestedGridFixture.vue`（新增）：
   - 确定性嵌套 Grid 实验台部件，消费 `createGrid` 和 `Splitter` 公开 API。
   - 暴露结构契约属性 `[data-panel-leaf]`、`[data-branch]`、`[data-lab-gesture]`、`[data-lab-recovery]`、`[data-lab-issues-container]`。
4. `packages/nb-ui/e2e/nested-grid.spec.ts`（新增）：
   - 16 条真实浏览器端到端测试用例，覆盖手势守恒、两轴独立性、键盘连发、Escape、程序布局、3 种恢复场景、以及 4 主题 × 2 视口矩阵。

## 验证与实测数据

### 1. 端到端测试（Playwright）

- **命令**：`node ../../node_modules/@playwright/test/cli.js test e2e/nested-grid.spec.ts`（支持 `bunx playwright test e2e/nested-grid.spec.ts`）
- **CWD**：`C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.worktree/w00003-neurobook-ui-foundation-migration/packages/nb-ui`
- **环境变量**：`NB_UI_E2E_REUSE_SERVER=1`
- **退出码**：`0`
- **用例总数**：16 passed（0 failed, 0 skipped）
- **耗时**：29.3s

用例运行明细：
```
Running 16 tests using 1 worker

  ✓   1 [chromium] › e2e/nested-grid.spec.ts:57:1 › 外层拖动守恒与内层高不变 (7.3s)
  ✓   2 [chromium] › e2e/nested-grid.spec.ts:114:1 › 内层拖动不改外层宽 (1.1s)
  ✓   3 [chromium] › e2e/nested-grid.spec.ts:159:1 › 键盘连发单次提交 (1.1s)
  ✓   4 [chromium] › e2e/nested-grid.spec.ts:183:1 › Escape 零提交 (1.0s)
  ✓   5 [chromium] › e2e/nested-grid.spec.ts:209:1 › 程序布局零提交 (885ms)
  ✓   6 [chromium] › e2e/nested-grid.spec.ts:232:1 › 恢复场景：未知引用过滤但原件保留且调整后不丢 (905ms)
  ✓   7 [chromium] › e2e/nested-grid.spec.ts:263:1 › 恢复场景：畸形重复身份整体拒绝且无异常 (1.1s)
  ✓   8 [chromium] › e2e/nested-grid.spec.ts:277:1 › 恢复场景：高版本快照整体拒绝且保留原件 (1.1s)
  ✓   9 [chromium] › e2e/nested-grid.spec.ts:305:9 › 四主题组合 nbook/nbook-light 在 desktop 保持真实几何与键盘调整 (1.2s)
  ✓  10 [chromium] › e2e/nested-grid.spec.ts:305:9 › 四主题组合 nbook/nbook-light 在 390×844 保持真实几何与键盘调整 (1.1s)
  ✓  11 [chromium] › e2e/nested-grid.spec.ts:305:9 › 四主题组合 nbook/nbook-dark 在 desktop 保持真实几何与键盘调整 (1.1s)
  ✓  12 [chromium] › e2e/nested-grid.spec.ts:305:9 › 四主题组合 nbook/nbook-dark 在 390×844 保持真实几何与键盘调整 (1.2s)
  ✓  13 [chromium] › e2e/nested-grid.spec.ts:305:9 › 四主题组合 macos/macos-light 在 desktop 保持真实几何与键盘调整 (1.1s)
  ✓  14 [chromium] › e2e/nested-grid.spec.ts:305:9 › 四主题组合 macos/macos-light 在 390×844 保持真实几何与键盘调整 (1.2s)
  ✓  15 [chromium] › e2e/nested-grid.spec.ts:305:9 › 四主题组合 macos/macos-dark 在 desktop 保持真实几何与键盘调整 (1.2s)
  ✓  16 [chromium] › e2e/nested-grid.spec.ts:305:9 › 四主题组合 macos/macos-dark 在 390×844 保持真实几何与键盘调整 (1.1s)

  16 passed (29.3s)
```

### 2. 真实几何与手势实测数据

- **外层主轴拖拽（+60px）**：
  - 拖动前：左栏宽 `179.1px`，右分支宽 `417.9px`，两栏宽度之和 `597.0px`；内层 top 高 `210.0px`，bottom 高 `140.0px`。
  - 拖动后：左栏宽 `238.8px`（增加），右分支宽 `358.2px`（减小），两栏宽度之和 `597.0px`（完全守恒，Δ < 0.1px）。
  - 内层高度：top 高 `210.0px`，bottom 高 `140.0px`（两轴完全独立，内层高度变动为 0）。
  - 手势可观察状态：`state="commit"`，`commit-count="1"`，`last-sash="left~right"`，`last-active=["left", "right"]`。
  - 事件日志实测：`gesture-start` 1 次，`gesture-end` 1 次，`gesture-cancel` 0 次。
- **内层纵轴拖拽（+40px）**：
  - 拖动前：top 高 `210.0px`，bottom 高 `140.0px`，总高度 `350.0px`；外层 left 宽 `179.1px`，right 宽 `417.9px`。
  - 拖动后：top 高 `249.9px`（增加），bottom 高 `100.1px`（减小），总高度 `350.0px`（完全守恒）；外层 left 宽 `179.1px`，right 宽 `417.9px`（列宽变动为 0）。
  - 手势可观察状态：`state="commit"`，`commit-count="1"`，`last-sash="top~bottom"`，`last-active=["top", "bottom"]`。
- **键盘连发**：
  - 聚焦外层 sash，连续 3 次 keydown `ArrowRight` 后 keyup：
  - 手势可观察状态：`state="commit"`，`commit-count="1"`，`gesture-source="keyboard"`。
  - 事件日志实测：`gesture-start` 1 次，`gesture-end` 1 次。
- **Escape 取消手势**：
  - 指针按下拖拽 40px 后按 `Escape`：
  - 手势可观察状态：`state="cancel"`，`commit-count="0"`。
  - 事件日志实测：`gesture-end` 0 次，`gesture-cancel` 1 次。
- **程序布局**：
  - 点击「程序重排」触发 `grid.layout()`：
  - 左栏宽度由 `179.1px` 重排为 `260.0px`。
  - 提交次数保持为 `0`，手势状态保持为 `none`。
- **未知引用恢复与原件保留**：
  - 初始加载未知引用快照（含 `unknown-plugin-view`）：呈现 3 片叶子（outline、editor、terminal），未解析引用被过滤，恢复记录状态为 `dropped-unknown`；
  - 拖拽调整外层 sash 提交后：原件记录（`rawRecordRef`）中的 `unknown-plugin-view` 依然完整存在，未被过滤树抹除。
- **畸形与高版本快照拒绝**：
  - 畸形重复 id `left`：`grid.restore` 返回 `ok: false`，状态显示 `rejected`，无未捕获异常。
  - 高版本 `version: 99`：`grid.restore` 返回 `ok: false`，状态显示 `rejected`，安全回退至默认两轴呈现。
- **390×844 窄屏测试**：
  - 容器宽度自适应缩窄至 `< 390px`；
  - `document.documentElement.scrollWidth - document.documentElement.clientWidth` 恒为 `0`（无横向滚动条溢出）；
  - 键盘操作在 390×844 下成功移动 sash 并提交。

### 3. 类型检查（Typecheck）

- **命令**：`bun run typecheck`
- **CWD**：`packages/nb-ui`
- **退出码**：`0`
- **输出**：`Types generated in playground/.nuxt. 0 errors`。

## 未运行项与说明

- 未改动 `packages/nb-ui/src/**`：严格遵守原语只读约束。
- 未改动 `packages/neuro-book` 主应用、服务端与 Storage 代码：本 Task 仅负责 Lab fixture 与浏览器验收。
- 未使用产品持久化：快照恢复全部在内存中演示，未访问 localStorage 或网络。
- 未修改任何既有视觉测试基线快照。
- 未提交、未 push、禁止 `git add -A`。
