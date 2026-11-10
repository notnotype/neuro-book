---
标签: []
---

# SessionList

会话页的左列表（t15 阶段 4 第 3 批重做；原来是 t03 第三轮会话页的会话列表）。行由页面用 `host/sessions-list.ts` 的 `sessionRows` 从 `/api/sessions` 算好再交进来，零件只画、只发意图。会话、租约与运行都是临时数据（组标题旁的“临时”徽标）。

## 布局

从上到下：

- 通知一行：铃铛、“通知 · N 条要处理”（有要处理的时用警示色），点了右栏显示通知（链接 `/live/sessions?view=notify`）；
- “Agent 会话 · N”：一行一个会话，状态点（等确认、工作中、完成、空闲、未知、不在 herdr 里、已结束各一种样子）、标题（截断，悬停看全文）、状态字；下一行是 Agent、pane 号、租约的 Task（虚线胶囊，过期的边框变灰、后面写“· 过期”，字色不变淡）、运行数，没有租约写“没有租约”。不在 herdr 里或已结束的会话灰着、不能打开；
- “其它窗格（只读）· N”：本仓库里没有 Agent 会话的 pane，虚线方点、标题（登记过的运行的命令，或“窗格”加 pane 号与目录名）、“只看”；界面上 pane 一律写“窗格”（t22）；
- 底部：无主的运行条数与“去‘在跑’看”，不在本仓库的会话（折叠，展开只列出，不能打开）。

能打开的行是真实链接 `/live/sessions?pane=<pane>`：普通左键点击发 `select`，带修饰键或中键交给浏览器（新标签页）。选中的行用强调色浅底，带 `aria-current="page"`。`compact` 时（窄的左栏）第二行只留 Agent 与 pane 号。

## 数据

```ts
interface SessionListProps {
    /** Agent 会话的行，已排好序；必填 */
    agents: SessionRow[];
    /** 其它 pane（只读）的行；必填 */
    panes: SessionRow[];
    /** 不在本仓库的会话；必填 */
    elsewhere: SessionRow[];
    /** 选中的：pane 号，或 "notify"；没选为 null；必填 */
    selected: string | null;
    /** 要处理的通知条数（与顶栏同一口径）；必填 */
    attention: number;
    /** 无主的运行条数；必填 */
    unownedRuns: number;
    /** 窄的左栏；可选，默认 false */
    compact?: boolean;
}
interface SessionListEmits {
    /** 点了一行会话或 pane */
    (event: "select", paneId: string): void;
    /** 点了通知一行 */
    (event: "notify"): void;
    /** 点了“去‘在跑’看” */
    (event: "navigate", href: string): void;
}
```

“不在本仓库的会话”展开与否是零件自己的状态，不记。没有插槽与 expose。
