---
标签: []
---

# LeaseChip

一份租约（某个会话在动某个 Task）的虚线胶囊。租约是临时数据，所以按 t03 第三轮的画法用信息色虚线：超过 2 小时没有 Task 相关操作的后面写“· 过期”，已失效的划掉并写“· 已失效”（t22 起不再靠变淡：变淡之后文字对比度不够，状态也只有看得见颜色的人知道）。给了 `href` 时胶囊是链接，点了去会话页的这个会话（t22，开发者定）；放在别的链接里面（收件箱的一行）时不给 `href`。

会话写“标题 + 短键”（t17，`SessionLabel`）：有标题时标题在前、超过约 16rem 截断，短键在后、次要色小字、不截断，两个同名会话靠短键区分；没有标题时只写短键。`compact` 时只写短键（Work 页 Task 表的“谁在动”一列只有约 7rem，放标题只剩一两个字；同一页上方“现在谁在动”写着标题），标题只在提示里。提示（nb-ui `Tooltip`）是调用方的 `hint` 加上完整标题与它从哪里读的（`TITLE_SOURCE`：Claude Code 的 `/rename`、会话名或自动标题，Codex 的 `thread_name`，omp 的会话标题），两段用分号隔开。只有是链接时才进 Tab 顺序（聚焦时也出提示）；不是链接时提示只在悬停时出现，要紧的状态已经写在胶囊上（t22：原来有提示就能聚焦，首页卡片区一半的 Tab 停靠点是这些什么也做不了的胶囊）。胶囊里的标题不另带提示（`SessionLabel` 的 `fullText` 为假），提示不套提示。

## 数据

```ts
/** host/format.ts；`source` 的取值是 host/types.ts 里 SessionTitle 的 source */
type SessionName = {title: string | null; short: string; source: SessionTitle["source"] | null};
interface LeaseChipProps {
    /** 会话的显示名（`host/format.ts` 的 `sessionName`）：标题（可为 null）、短键（标签或 Agent 加会话 id 的前几位）、标题从哪里读的；必填 */
    session: SessionName;
    /** 在动的 Task（编号）；可选，不给时只显示会话 */
    task?: string | null;
    /** 超过 2 小时没有 Task 相关操作；可选，默认 false */
    stale?: boolean;
    /** 已失效（会话已退出、提问者已不在）；可选，默认 false */
    ended?: boolean;
    /** 悬停说明（例如最近一次操作的时刻）；可选 */
    hint?: string;
    /** 只写短键、标题只进提示（窄的表格列）；可选，默认 false */
    compact?: boolean;
    /** 会话页上这个会话的地址（`host/routes.ts` 的 `sessionHref`）；给了就是链接；可选，默认 null */
    href?: string | null;
}
interface LeaseChipEmits {
    /** 普通左键点了链接（中键与带修饰键的点击交给浏览器）；由宿主 `router.push` */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose；attrs 不生效（根是 nb-ui `Tooltip`，它不转发 attrs），要改宽度就在外面包一层。
