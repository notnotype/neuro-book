---
schema: nbook.task/v2
taskId: t50-browser-titlebar
---

# 浏览器标题栏与真实主页面

**状态：已备合同，待实施。** [实施计划](../../storage-implementation-plan.md) 切片 5：解除主页面与 `DesktopTitleBar` 的 bridge 可见性限制，让无 bridge 的浏览器也显示**可用**标题栏，并以宿主能力映射生成菜单，而不是把桌面能力当默认。

依赖：切片 4（t48 `8e9a803d` 已把主工作台几何切到 Storage 会话）。入口取证见 [source map](../../storage-consumer-source-map.md) 的「生命周期与标题栏」与「完整 Source Dev 验收的启动前检查」；开始实现前按当时 diff 重读。

## 结果

主页面在**没有桌面 bridge** 的浏览器里显示可用标题栏：菜单项由真实宿主能力决定 enabled/visible，浏览器隐藏仅桌面可用的动作；
项目列表同时提供「本标签打开」与「新标签打开」；菜单不被祖先裁剪，键盘与焦点行为可用；标题栏高度与几何来自产品 TS 常量，不新增主题 token。

## 范围

- `app/pages/index.vue`：titlebar 的 `setLeafVisible` 绑定（`:267` 起的 watcher，当前按 bridge 显隐）、菜单动作注入与 `onMenuCommand` 路径（`:2435`）、项目打开路径（本标签/新标签）、`desktop-available` 传参（`:2558`）。
- `app/components/common/DesktopTitleBar.vue`：组件自身的 bridge 条件与菜单渲染（切片 5 必须一起改，不能只改页面）。
- 需要的共享类型/i18n（菜单文案、项目打开入口）与必要的 `app/utils/workbench/layout.ts` 几何常量复用。

## 排除

- 不建立命令 registry、不实现 Ctrl+P、不实现搜索入口（不得显示"已可搜索"的假状态）。
- 不做桌面多窗口、不改桌面 bridge 的窗口/系统能力语义；桌面只做回归。
- 不改 Storage 会话与迁移内部（`layout-session.ts`、`storage-migration*.ts`、`storage-grid-host.ts`）、不改 `server/storage/**` 与 `shared/storage/**` 既有实现、不改 nb-ui 组件内部（除非确认 portal 用法有缺口，需先报告）。
- 不把 `ui.workbench-shell` 或 `storage.persistence` 晋升 implemented；逐 capability 由检查点 B 判定。

## 实现要求

1. **可见性**：无 bridge 的主页面也显示标题栏（保留受控 Chrome 零件与宿主分工：应用动作注入宿主回调、桌面 bridge 保留窗口/系统能力）；有 bridge 时行为不得回退。
2. **能力映射**：菜单 enabled/visible 由宿主能力映射生成；未接入的演示占位**不算**可用能力。浏览器隐藏退出应用、窗口控制与桌面缩放；
   编辑动作按真实焦点/编辑器能力判断，不能把 studio undo 冒充所有输入框 undo。
3. **项目打开**：本标签打开沿用原有未保存领域内容守卫与 Storage 收口（不得用 Storage 释放替代领域守卫）；
   新标签打开生成标准 Project URL，用户点击时打开，当前标签与未保存内容不变，新标签独立执行 open/presence。
4. **菜单行为**：使用 nb-ui 现有 portal 能力消除祖先裁剪；处理 outside 点击、Escape、方向键、焦点归还与紧凑菜单。
   标题栏高度由 TS 产品几何常量提供 CSS 变量（含窄屏叶包装），不新增主题几何 token。
5. **几何一致**：标题栏高度与切片 4 的 shell 几何（`SHELL_TITLEBAR_HEIGHT` 等）保持同一来源；不得在两处各写一套数值。

## 验证与交付

- 聚焦单测/组件测试：菜单能力映射（浏览器 vs 桌面）、可见性绑定、项目打开两条路径的差异化行为、键盘/焦点。
- 真实浏览器验收（必做）：四主题组合 × 桌面与 390×844、长项目名、菜单不裁剪、键盘/焦点、Storage 失败仍可理解；
  使用系统 Temp 隔离 State/Cache 根与**独立空闲端口**（`NUXT_PORT` 与 `PORT` 都显式设置）。
  **注意：3001 是开发者正在查看的服务**（本会话在隔离根上启动并保持运行），验收不得占用、重启或停止它。
- 桌面回归：既有窗口与桥接不回归；**不声称**桌面多窗口已实现。
- 先写 `walkthroughs/implementation.md`；报告真实命令、cwd、退出码、隔离根与端口、用例数与未运行项。
- 最终回复具体结果，不返回空文本或句点。

## 检查点 B

主页面浏览器真实验收完成后交独立审查，再逐 capability 核对成熟度：Storage 或标题栏局部完成不能把整个 `ui.workbench-shell` 晋升 implemented，其余入口等价与迁移门禁仍需证据。
