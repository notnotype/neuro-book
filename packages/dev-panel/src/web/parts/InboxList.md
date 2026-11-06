---
标签: []
---

# InboxList

首页最上面的收件箱：只放要开发者动手的事——等开发者答的题（口径见 [文件格式](../../../docs/file-formats.md#状态现算)）与正在发生的撞号（Proposal 第三节：会话在等的事只认登记成提问的，不从终端推断）。

**提问按产物合并**（t15 阶段 4 第 1 批，开发者 10-13：一个产物出几道题时注意力被分散）：同一个产物的待答题合成一行，写产物标题（没有标题写产物 id）与“待答 N”，下面列前三道题的题目、其余写“等 N 道”，再写在哪个 Work、Task 里与提问的会话（`LeaseChip`，写“标题 + 短键”，t17；去重；提问者的租约已经失效时标出来：问的会话已经不在，答了要等别的会话来采纳）。答题在产物页，一行就是去那个产物页的入口。合并在 `host/inbox.ts` 的 `groupInbox`，顺序按服务端给的、取每个产物第一次出现的位置。

**撞号写明原因与去处**（t15 阶段 4 第 2 批，开发者 10-14：看不到原因）：只放正在发生的（至少两个名字不是旧副本，开发者 11-05：只在旧副本里的没什么可动手，不放）。一条一行，写哪几个名字用了同一个号、各在哪里（主工作区、哪个 worktree、哪个 ref 上已提交），只在改名或删除后留下的旧副本里的标出来；另给“正在发生”的徽标；最后是“怎么处理”，链到 `.agents/works/README.md` 的处理办法（文档页）。

## 数据

```ts
type InboxQuestion = {kind: "question"; workId: string; taskId: string; artifactId: string; artifactTitle: string | null; questionId: string; label: string; type: string; version: number; since: number; askedBy: string | null; askerActive: boolean | null};
type InboxConflict = {kind: "number_conflict"; label: string; live: boolean; ids: Array<{id: string; live: boolean; locations: ConflictLocation[]}>};
interface InboxListProps {
    /** 收件箱条目；必填，空数组时显示空态 */
    items: Array<InboxQuestion | InboxConflict>;
    /** 会话标题（`/api/overview` 的 `sessionTitles`，键是会话键）；必填，没有标题的提问者缺项、只写短键 */
    sessionTitles: Readonly<Record<string, SessionTitle>>;
}
interface InboxListEmits {
    /** 普通左键点了一个入口；参数是面板内的地址，由页面 `router.push`。中键与带修饰键的点击交给浏览器（新标签页） */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。每个产物一行，是去产物页的真实链接（`<a href>`），能在新标签页打开。撞号那一行本身不是链接，“怎么处理”是去文档页的真实链接（`ActionLink`）。
