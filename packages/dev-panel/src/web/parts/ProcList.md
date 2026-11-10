---
标签: ["state:local"]
---

# ProcList

“在跑”页的第一块（t14）：经 `nbdev dev start` 起的服务。每行写状态（启动中、在跑、没人监管、已结束）、checkout（链到 checkout 页的那一行）、package、script、地址（http 与 https 才给链接，新标签页打开）、谁起的（会话写“标题 + 短键”，`SessionLabel`：标题可截断、截断时可聚焦看全文，短键次要色、不截断，t17）、起了多久、是哪个 Task 的、原因，日志路径只给一个“复制日志路径”（`TruncatedText` 的 `display`：点了复制全路径，悬停看全文；原来整条绝对路径摊开占两到五行）。还在的（启动中、在跑、没人监管）在前；已结束的收进“已结束 N 个”，点开才列出（`state:local`，t22，开发者定），一个在跑的也没有时写“现在没有在跑的”。已结束的靠“已结束”标记区分，不整行降透明度（降了之后文字对比度不到 3:1）。只读：停服务用命令行 `nbdev dev stop`，这里没有按钮。

## 数据

```ts
interface ProcListProps {
    /** `/api/runs` 的 `procs`；必填 */
    runs: ProcRunView[];
    /** 会话标题（`/api/runs` 的 `sessionTitles`，键是会话键）；必填，没有标题的属主缺项、只写短键 */
    sessionTitles: Readonly<Record<string, SessionTitle>>;
}
```

```ts
interface ProcListEmits {
    /** 点了 checkout 的 key（普通左键）：去 checkout 页并对准那一行，`/live/checkouts?focus=<key>`（t15 阶段 4 第 4 批）；带修饰键的点击交给浏览器 */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。空数组时写“没有经 nbdev 起的服务”。日志只显示路径，不提供下载。
