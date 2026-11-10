---
标签: []
---

# TaskTable

Work 页的 Task 表（t03 第三轮 Work 页；t15 阶段 4 第 2 批改成能就地展开）。每行一个 Task，列出状态、当前情况（README“当前状态”一节的第一行，按行内 Markdown 渲染，有产物时末尾写“· 产物 N”）、最近更新。状态旁是有才显示的小标记（t22，开发者定）：待答数（警示徽标）、“在动”（有会话租约，多个时带数）、“分支”（记录在分支上）、“未提交”；原来的产物、待答、记录、谁在动四列多数行是 0 或 master，手机上又整列藏掉，看不出哪个 Task 等着答。展开内容里的“谁在动”写“标题 + 短键”（t17），胶囊是去会话页的链接。行里的 Task 名是去 Task 页的真实链接（`<a href>`，地址由 `host/routes.ts` 拼），能在新标签页打开。

每行前面一个展开按钮（开发者 10-13：Work 页只能看到 Task 列表、不够高效）：展开后在这一行下面显示三栏，“当前状态”“下一步”（README 这两节，渲染后的 Markdown，用正文字号）、产物与文档类产物（带待答数）、证据、谁在动。产物、文档与证据链到 Task 页并打开速览面板（`?peek=`）。展开行的内容由页面取 Task 接口后算好交进来（`details`），零件不取数；同时最多展开几行、展开哪几行也由页面管（`expanded`，决定点 9：最多 3 行）。

## 布局

ARIA 表格角色（`table`、`row`、`columnheader`、`cell`）排的网格，不用 nb-ui 的 `Table`：它不做行展开（它的 `.md` 写明“由消费方组合”）。列宽：展开按钮 2rem、Task 列最宽（单行截断，悬停的 `title` 是全文）、当前情况两行截断，状态一列放状态与小标记、放不下折行；整张表最窄约 51rem（各列下限、列间距与内边距之和），再窄由外层横向滚动（外层带 `relative`）。手机（窄于 768px）上只留展开按钮、Task 与状态（带小标记，最宽 10rem、靠右）三列，当前情况与更新时间在展开里看，展开内容改成一栏，不横向滚动。展开的行底色加淡强调色，展开内容在下面一行、浅底、三栏。

## 数据

```ts
interface TaskTableProps {
    /** 这些 Task 所在的 Work（拼 Task 页地址）；必填 */
    workId: string;
    /** Work 里的 Task（`/api/work` 的 `tasks`）；必填 */
    tasks: TaskView[];
    /** 展开着的 Task id；必填 */
    expanded: readonly string[];
    /** 展开行的内容（`host/task-expand.ts` 的 TaskTableDetail），键是 Task id；还没取到时缺项（显示加载）；必填 */
    details: Readonly<Record<string, TaskTableDetail>>;
    /** “当前情况”的行内 HTML（`renderInlineMarkdown` 的结果），键是 Task id；没有当前情况的缺项；必填 */
    currentHtml: Readonly<Record<string, string>>;
    /** 会话标题（`/api/work` 的 `sessionTitles`，键是会话键）；必填，没有标题的会话缺项、只写短键 */
    sessionTitles: Readonly<Record<string, SessionTitle>>;
}
interface TaskTableEmits {
    /** 普通左键点了一个入口；参数是面板内的地址，由页面 `router.push`。中键与带修饰键的点击交给浏览器（新标签页） */
    (event: "navigate", href: string): void;
    /** 点了某一行的展开按钮 */
    (event: "toggle", taskId: string): void;
    /** 展开行读取失败后点了“重试” */
    (event: "retry", taskId: string): void;
}
```

没有插槽与 expose。没有字段的值显示“未标”。

## 无障碍

展开按钮带 `aria-expanded` 与 `aria-controls`（指向展开内容那一行），可读名固定是“t15 的详情”，展开与否只由 `aria-expanded` 表达（名字不随状态变，读出来不重复）。展开内容那一行只有一个格子，`aria-colspan` 横跨全部列。不写 `aria-rowcount`：所有行都在 DOM 里，读屏自己数得出。展开内容的三栏各有小标题。
