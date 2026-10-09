---
标签: [state:local]
别名: ["资源管理器", "Explorer", "文件视图"]
---

# FilesExplorerView

资源管理器视图的界面（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md)）：顶部工具栏、偏好与根状态的提示、虚拟树、底部结果区。它是受控零件：数据全部经 props 进来，动作经事件交给宿主（`web/view-host.ts`），宿主再执行命令或调控制器；组件不知道命令 id，也不持有文件客户端。

## 布局

纵向三段网格：工具栏固定高度；提示条按内容高度；树 `minmax(0, 1fr)` 占满剩余高度并自己滚动；结果区限高。窄到 `390px` 时工具栏按钮不换行，树的标签先截断。

- 工具栏：刷新、全部收起、显示清单文件（切换按钮，`aria-pressed`）。
- 提示条：项目根没有绑定时显示“尚未打开项目”与“打开项目”；某个根停止同步时显示原因与“重新连接”；偏好记录读不到、损坏或没保存上时显示原因与相应按钮（重新读取或重试、放弃）。提示条都在树之外，可用 Tab 到达。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    rows: ReadonlyArray<Row>;
    selected: ReadonlyArray<string>;
    focus: string | null;
    showManifests: boolean;
    /** 控制器已建、偏好首读结束：工具栏可用。 */
    ready: boolean;
    notice: Notice | null;
    problem: PreferenceProblem | null;
    handleKey: (key: TreeKey, page: number) => boolean;
};

type ToolbarAction = "refresh" | "collapse-all" | "toggle-manifests";

type Emits = {
    (event: "toolbar", action: ToolbarAction): void;
    (event: "row-press", id: string, modifiers: Modifiers, part: "twisty" | "row"): void;
    (event: "row-activate", id: string): void;
    (event: "row-context", id: string, x: number, y: number): void;
    (event: "retry", address: string): void;
    (event: "reconnect", scheme: "project" | "user"): void;
    (event: "open-project"): void;
    (event: "dismiss-notice"): void;
    (event: "prefs-retry"): void;
    (event: "prefs-discard"): void;
    (event: "focus-change", focused: boolean): void;
};
```

- 没有 slots；expose `focusTree()`。attrs 落在根元素上。

## 状态

`ready` 为假时工具栏按钮禁用、树区域显示加载中；没有行时（不应出现，两个根总在）显示空。
