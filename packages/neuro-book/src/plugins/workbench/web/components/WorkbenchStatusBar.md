---
标签: []
别名: ["状态栏", "Status Bar"]
---

# WorkbenchStatusBar

工作台底部 22px 的状态栏（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳一输出 11）：左边是当前项目名或“未打开项目”，以及布局记录的问题（读不到时正在用默认布局；修改没保存上时给出原因与重试、放弃）；右边是面板的显示与隐藏按钮。不显示假数据（Git、行列号、通知计数）。文字按 `locale` 取中英两份中的一份。

## 布局

单行，高 22px，左组可收缩、内容过长时截断，右组固定贴右。`390×844` 下项目名先截断，问题提示与按钮保持可点。面取 `--bg-panel`，顶部分隔线取 `--divider`，文字取 `--text-secondary`。

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
    locale: DisplayLocale;
    /** 当前项目的显示名；没有绑定项目为 null。 */
    project: string | null;
    /** 面板是否隐藏：决定右边按钮是“显示面板”还是“隐藏面板”。 */
    panelHidden: boolean;
    /** 面板按钮不可用（布局还没读完）；默认 false。 */
    panelToggleDisabled?: boolean;
    /** 布局记录的问题；默认无。有修改没保存上的优先显示。 */
    problems?: ReadonlyArray<StatusBarProblem>;
};

type Emits = {
    /** 点了面板按钮；宿主按 `panelHidden` 执行显示或隐藏（显示面板同时清除收起）。 */
    (event: "toggle-panel"): void;
    (event: "retry", record: string): void;
    (event: "discard", record: string): void;
};
```

- 面板按钮带 `data-shell-focus-target="panel-toggle"`：外壳隐藏面板时把焦点交给它。
- 问题提示带 `role="status"`，出现与变化时由读屏播报；整条状态栏不是 live region。
- 没有 slots、expose；attrs 落在根 `<footer>` 上。

## 不支持

不提供条目贡献点（状态栏条目以后随插件贡献）；不执行命令、不读写状态。
