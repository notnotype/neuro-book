---
schema: nbook.task/v2
taskId: t66-workbench-shell-views
---

# NeuroBook v2 外壳二：容器与视图

## 目标与范围

按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节的外壳二：视图注册表、落位与呈现模型、意图合成；ActivityBar 与 AuxiliaryBar、Panel 的 Switcher；隐式容器与标题回落（声明式容器、自建容器不在本 Task）；容器 empty、single、multiple 三种模式与单轴排列；容器与视图两个实例层；生命周期矩阵与三种失败；`nbook.view.move-view` 与“移动到”菜单。插件面向的视图合同（贡献点 `workbench.views`）按推荐提前到本 Task（待确认）。拖放属于外壳三。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 新建或修订）：[`workbench/views.md`](../../../../../docs/specs/workbench/views.md)（新建）、[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 前置

外壳一 [t65](../t65-workbench-shell-layout/README.md)。

## 当前状态

- 2026-10-08 计划起草，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 交三个 omp 审查；26 条意见按推荐并入计划（见计划“审查处理”），5 项记入[待确认清单](../../pending-confirmations.md)。下一步 S0。
- S0（Spec）：新建 `workbench/views.md`（声明与校验、注册表两种输入、交付状态、加载门禁、三种失败、`window.plugins`）；`ui/workbench-shell.md` 外壳二补输出 24–27（移动到、Panel 标题行唯一拥有者、起源声明消失的回落、`focusedPart`）与验收 26–31、记录字段与容量前提；`workbench/commands.md` 的 `move-view`（三项齐全或全省略、过期为已有失败码 `stale-target`）；`runtime/browser-host.md` 提一句宿主能力；设计稿追加决策记录。
- S1（纯模型）：`web/views/{placement,presentation,intents}.ts`、`shared/views.ts`，`views-customizations` 加三组可选字段。设计稿第 3 节典型情况表逐行成测试，16 例，9 处变异全被抓到（补了“只有 Sidebar 的 single 画容器标题行”一例）。
- S2（store）：`acceptViewCatalog`、`applyView`（按发起时的呈现合成补丁，冲突重放作用在最新值上）、`focusPart`；公开键 `focusedPart`。真实 Storage 4 例（刷新一致、两窗口不同视图都保留与同一视图后写胜出、未知项写回保留、超 64 KiB 保存失败与放弃），变异检查确认。
- S3（贡献点与命令）：`ViewRegistry`（声明目录 + 交付句柄，入口状态经新宿主能力 `window.plugins`，每次加载经句柄取实现、结果回来时核对句柄）、`web/host/window-plugins.ts`、`nbook.view.move-view`。真实内核 8 例（从未交付、受阻、激活失败与重试的新代次、停止、加载中停止被作废、拥有者停止），命令 5 例。途中发现单关 `context.scope`（入口工作作用域）会一直等借用它的资源，入口停止要关它的父（本代激活作用域），计划与测试插件同步。
- S4（零件）：`WorkbenchActivityBar`、`WorkbenchMoveViewMenu`、`WorkbenchViewSection` 与同名 `.md`、Lab 场景；标签带直接用 nb-ui `Tabs`，不另包组件。
- S5（容器与实例层）：`shell/teleport-memory.ts`（三层 Teleport 共用的滚动与焦点记忆，外壳一改用它）、`views/container-grid.ts`、`WorkbenchViewContainerHost`、`WorkbenchViewInstances`（容器层与视图层两层 Teleport、加载与代际）、`WorkbenchViewFrame`（交付状态、加载、两种失败与错误边界）、`WorkbenchToolPartHost`、PanelSurface 的导航槽、`WorkbenchShell` 接线；集成 Lab 场景挂在 `WorkbenchShellLayout` 的 `views`、`views-merged` 场景下。本机 Chrome 探针发现两处：nb-ui Dropdown 的级联子菜单在真实浏览器里点不进去（子菜单浮层被当作外部点击，先关掉整个菜单），“移动到”改为一层平铺、右侧注明 Part；Lab 场景的定制放在深响应式 ref 里时意图合成的 `structuredClone` 失败，改用 `shallowRef`。
- S6–S7（测试插件与 e2e）：e2e 构建加测试插件 `test.sample-views`（五个视图与停止入口的测试命令，开关用页面 `localStorage`），宿主测试入口支持只有浏览器入口的测试插件。`e2e/workbench-views.e2e.ts` 12 例（全链路、活动栏与拖到零恢复、移动到与刷新、命令面板两步、收起规则与横向竖条、容器网格手势与 Escape、实例保留、激活失败与重试、入口停止与刷新、加载失败与渲染出错、390 宽键盘路径、token 颜色），连跑三次稳定。e2e 暴露并修正两处：scroll 布局的滚动盒原在分节里，视图换容器时分节重建丢滚动位置，改由视图框持有；多层搬动交错时记录读到浏览器清掉的 0 覆盖了真实位置，记录不再用 0 覆盖、零尺寸元素（拖到零途中滚动锚定改写的位置）的滚动事件不记。记忆的 happy-dom 测试依赖布局尺寸，删去改由 e2e 覆盖。截图证据 `evidences/shots/`：Lab `views-merged` 场景 4 主题 × 2 配色 × 1440×900、390×844（16 张，溢出与页面问题为 0）。
