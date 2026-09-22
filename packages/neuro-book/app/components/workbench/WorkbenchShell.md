---
标签: [io:read, io:mutate, state:shared-read]
别名: ["产品工作台外壳", "Workbench Shell"]
---

# WorkbenchShell

主应用工作台外壳的**产品接线**：把纯布局部件 `WorkbenchShellLayout` 接到工作台 Storage、通知与页面事实上。

它自己不做几何：测量、Grid 构建、渲染、gutter 与手势结算都在纯布局部件里（同目录，见其同名文档）。这一层只负责「哪些是保存的事实、哪些是呈现」——尺寸偏好来自工作台布局记录与面板尺寸记录，面板的位置/对齐/隐藏/收起来自 user 级定制记录，瞬时最大化只在页面内存。

## 为什么不能直接挂载

- 读写产品 Storage：`workbench.layout/layout`（左右宽度合成在叶字段上）、`workbench.layout/panel-size`（面板高度与宽度），用户资产工作面走同 owner 的 user/local 记录；布局会话有首读门禁、CAS 冲突重放、重试与放弃出口。
- 依赖页面事实：当前工作面、保存的 Panel 状态、瞬时最大化都由页面传入；外壳自己只发布「呈现事实」与「一次有效手势的补丁」。
- 因此 Lab 里挂的是**无业务骨架** `WorkbenchShellLayoutFixture`（真实 Grid、sash、面板操作与命令，只把内容换成空白演示 View），文档与场景见 Component Lab 的同名条目。

## 数据与 API

```ts
type Props = {
    /** 当前工作面（Project ready / 用户资产 / 未开项目）：记录归属由它决定。 */
    surface: WorkbenchLayoutSurface;
    /** 保存的 Panel 状态：position / alignment / hidden / collapsed。 */
    panel: WorkbenchPanelPreferences;
    /** 宿主内存里的瞬时最大化（不落盘）。 */
    maximized?: boolean;
};
type Emits = {
    /** 生效状态与输入不一致时回传（例如换位置后最大化被清除），宿主据此清自己的 ref。 */
    (event: "update:maximized", maximized: boolean): void;
};
type Expose = {
    /** 只接受 titlebar / activity / left / right；editor 与状态栏不可隐藏。 */
    setLeafVisible(id: string, visible: boolean): void;
    /** 当前隐藏的 Part（内存态，不保存）。 */
    hidden: Readonly<Ref<string[]>>;
    /** 最近一次呈现事实：mode、生效的 Panel 状态、诊断——命令可用性与状态栏读它。 */
    facts: Readonly<Ref<ShellLayoutFacts | null>>;
};
```

- **slots**：`titlebar` / `activity` / `left` / `editor` / `right` / `panel` / `statusbar`，与 Part 一一对应；`panel` 槽额外收到 `{ collapsed, effectivePanel, mode }`。槽内容是页面的业务组件，外壳不重命名插槽。
- **保存**：只有有效用户手势结束才提交一次 `{contextKey, patch}`（补丁只含真正变化的轴）；测量、恢复、短容器退化、换位置/对齐/隐藏/收起都不产生保存。
- **布局提示**：未确认保存的调整、被旧工作面挡住的切换、未完成的迁移在视口一角给出提示条与重试/放弃入口，文案走 i18n。
- **焦点**：隐藏活动面板把焦点交给状态栏的显示入口（`data-shell-focus-target="panel-toggle"`），最大化交给面板标题（`data-shell-focus-target="panel-title"`），两者都由页面在槽里提供；槽没提供时落在壳根上。

## 相关合同

- 几何、位置/对齐树形、手势结算与实例保留：同目录 `WorkbenchShellLayout.md` 与 `app/utils/workbench/layout.ts`。
- 拓扑与状态归属：[`docs/specs/ui/workbench-shell.md`](../../../../docs/specs/ui/workbench-shell.md)。
- Lab 的可操作骨架：Component Lab 的 `WorkbenchShellLayout` 条目（11 个场景，全部为内存状态）。
