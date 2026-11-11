---
标签: [state:inject]
别名: ["状态栏", "Status Bar"]
---

# WorkbenchStatusBar

工作台底部 22px 的状态栏（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳一输出 11）：左边是当前项目名或“未打开项目”，以及布局记录的问题（读不到时正在用默认布局；修改没保存上时给出原因与重试、放弃）；右边是贡献的条目、通知铃铛（[`workbench/notifications.md`](../../../../../../../docs/specs/workbench/notifications.md) 输出 17）与面板的显示与隐藏按钮。不显示假数据。文字经注入的翻译端口取。

## 布局

单行，高 22px，左组可收缩、内容过长时截断，右组固定贴右。`390×844` 下项目名先截断，问题提示与按钮保持可点。面取 `--shell-chrome-surface`（缺省 `--bg-panel`），顶部分隔线取 `--shell-chrome-line`（缺省 `--divider`），卡片外壳里两者透明（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 输出 38），文字取 `--text-secondary`。按钮几乎填满 22px 的条，焦点画成按钮里面的一圈内嵌焦点线（`focusRing="inset"`）。右组里铃铛与面板按钮之间 4px；铃铛是 12px 的图标，不变色，有没看过的通知时右上角一个 6px 的强调色点，点外圈 1.5px 的状态栏底色把它和铃铛分开。

## 数据

```ts
type StatusBarProblem = {
    /** 哪条记录，`retry`、`discard` 原样带回。 */
    record: string;
    /** unread：读不到或受保护，正在用默认布局；unsaved：有修改没保存上。 */
    kind: "unread" | "unsaved";
    /** 失败码，显示时换成可读的原因（不认识的码原样显示）。 */
    code: string;
};

type Props = {
    /** 当前项目的显示名；没有绑定项目为 null。 */
    project: string | null;
    /** 面板是否隐藏：决定右边按钮是“显示面板”还是“隐藏面板”。 */
    panelHidden: boolean;
    /** 面板按钮不可用（布局还没读完）；默认 false。 */
    panelToggleDisabled?: boolean;
    /** 布局记录的问题；默认无。有修改没保存上的优先显示。 */
    problems?: ReadonlyArray<StatusBarProblem>;
    /** 贡献的条目；默认无。 */
    items?: StripEntry[];
    /** 通知中心里没看过的条数；默认 0。大于 0 时铃铛带点，名称写“通知：N 条没看过”。 */
    unreadNotifications?: number;
};

type Emits = {
    /** 点了面板按钮；宿主按 `panelHidden` 执行显示或隐藏（显示面板同时清除收起）。 */
    (event: "toggle-panel"): void;
    (event: "retry", record: string): void;
    (event: "discard", record: string): void;
    /** 点了有命令的条目。 */
    (event: "run-item", itemId: string): void;
    /** 点了铃铛；宿主打开“通知”视图。 */
    (event: "open-notifications"): void;
};
```

- 面板按钮带 `data-shell-focus-target="panel-toggle"`：外壳隐藏面板时把焦点交给它。
- 问题提示带 `role="status"`，出现与变化时由读屏播报；整条状态栏不是 live region。
- 没有 slots、expose；attrs 落在根 `<footer>` 上。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，项目名占位、面板按钮、问题提示与重试、放弃等界面文字都在本插件的目录（命名空间 `nbook.workbench`，`../../locales/`）；语言随端口响应式切换，组件没有语言属性。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。

## 不支持

不提供条目贡献点（状态栏条目以后随插件贡献）；不执行命令、不读写状态。
