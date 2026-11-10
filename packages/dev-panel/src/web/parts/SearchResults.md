---
标签: ["state:local"]
---

# SearchResults

搜索结果：最上面是缓存里 Work、Task、产物标题与会话的匹配（服务端已按相关度排好），下面按 checkout 分组列文件名与内容的匹配（内容带行号与那一行），结果流式到达时逐条出现；某个 checkout 截断了（超过 200 条或 5 秒）时标出来。记录一行放不下时最多折成两行（手机上命中的字不再被截在省略号后面），标题开头重复的编号去掉（“w00032/t05 w00032 t05 …”只写一次，t22）。t15 阶段 4 第 5 批：搜索词在记录、文件名命中的路径与内容里高亮（`HighlightText`）；内容那一行只显示一行，命中靠后时从命中前 30 个字（窄于 768px 时 6 个字）开始、前面加省略号，按字素切；每组里 `.agents/tasks/` 下的命中（历史 Task 记录）收在组尾，默认折叠，点“展开历史 Task 记录”才列出。

## 数据

```ts
interface SearchResultsProps {
    /** 记录的匹配；必填 */
    records: SearchRecordMatch[];
    /** 文件的匹配；必填 */
    hits: SearchHit[];
    /** 做完了的 checkout；必填 */
    done: SearchCheckoutDone[];
    /** 整组搜索结束了；必填 */
    finished: boolean;
    /** 出这批结果的搜索词（高亮用；页面在开始搜时才换它，去抖期间旧结果不按新词高亮）；必填 */
    q: string;
}
interface SearchResultsEmits {
    /** 普通左键点了一个入口；参数是面板内的地址，由页面 `router.push`。中键与带修饰键的点击交给浏览器（新标签页） */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。历史记录展开与否是零件自己的状态（`state:local`），不记；页面按出结果的那个搜索词给零件加 key，换搜索词时重建、历史收起。记录的匹配与 Markdown 文件的匹配是真实链接（`<a href>`，去对应页与文档页），能在新标签页打开；其它文件面板不提供正文，只列出来。
