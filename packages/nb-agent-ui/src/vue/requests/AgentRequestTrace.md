---
标签: [state:local, state:inject, env:timer, env:portal]
别名: ["模型请求", "请求查看器", "Request Trace", "Model requests"]
---

# AgentRequestTrace

模型请求查看器：查看 Agent 发出的每一次模型请求——发了什么、回来什么、用时与用量、为什么失败。上面一行常驻的筛选，左边按会话的轮分组的请求列表，右边选中那次请求的详情（概览与几页）。行为合同见 [`agent/request-trace`](../../../../../docs/specs/agent/request-trace.md) 的“查看器”。

它是受控视图：列表、详情、全文与原始请求体都由宿主给，筛选改了发 `update:query`，选中、翻页、取全文、复制、打开会话都经 `action` 交回，组件不取数、不写剪贴板。和别的列表不同的是，全文不随详情来：展开一行时组件发 `request.load-content`，宿主按内容哈希取回后经 `contents` 交来，所以几百条消息的请求打开也快。

## 布局

- 第一行：查找框（占满剩余宽度）、排序（时间、总时长、输入 token、费用）、“更多”（记录占用、记录设置、“清空这个会话的记录”（筛选了一个会话时才有）、清空全部记录；清空前弹确认框）。
- 筛选条：会话、用途、状态、模型、时间（最近一小时、今天、全部）五个条件，每个是一个下拉；选了的条件强调色底；有条件时后面一个“清除筛选”。放不下时换行。
- 下面两栏：列表最小 300px、最大 360px，详情占其余。宽度不到 760px（两栏最小宽度之和）时只显示一栏：选中一条进详情，详情顶上“请求列表”回到列表；宽回去时两栏都在，选中不变。
- 列表见 `AgentRequestList.md`，详情见 `AgentRequestDetail.md`。

## 数据

```ts
props: {
    rows: readonly RequestTraceRow[];        // 已加载的行，按列表的先后（新的在上）
    list: RequestTraceListState;             // {state: "loading" | "ready" | "error"; more: boolean}
    totals: RequestTraceTotals;              // 列表头的合计（筛选后）
    facets: RequestTraceFacets;              // 会话下拉的候选（带标题与条数）
    query: RequestTraceQuery;                // 受控的筛选与排序；按时间排时列表分组
    pending?: number;                        // 来了但没插进列表的新请求，缺省 0
    selected: string | null;                 // 受控的选中
    detail: RequestTraceDetailState;         // idle | loading | missing | error | ready
    contents: Readonly<Record<string, RequestTraceContentState>>;   // 按哈希取回的全文
    payload: RequestTracePayloadView;        // 选中那条的原始请求体：idle | loading | missing | error | ready
    compare?: RequestTraceCompareView;       // 比较页拿来比的那次（base）与它的详情；缺省还没定
    search?: string;                         // 受控的查找词；停顿 300 毫秒（组字结束后）发 update:search
    searchState?: RequestTraceSearchState;   // idle | searching | done | error，truncated 时列表头有“接着查”
    hits?: readonly RequestTraceHit[] | null;   // 选中那条全部的命中，查找条用
    usage?: {bytes: number; payloadBytes: number} | null;   // 记录目录的占用，“更多”菜单里写
    enabled: boolean;                        // 记录开着
    now: number;                             // 宿主给的当前时间
    locale?: AgentLocale;                    // 没有注入翻译端口时的语言，缺省 zh-CN
}
emits: {
    "update:query": [query: RequestTraceQuery];   // 改了筛选（不带游标，宿主从头取）
    "update:search": [search: string];             // 改了查找词（去掉首尾空白；空串是不查了）
    action: [action: RequestTraceAction];          // 见 request-trace.ts 的 RequestTraceAction
}
```

键：焦点在本页时 Ctrl/⌘+F 聚焦查找框，Alt+上下选新一次、旧一次，查找框里 Esc 清掉查找词；列表上上下键选上一条、下一条。

没有插槽、没有 expose；属性不透传（根是单个元素，`class`、`style` 落在根上）。

## 隐藏通道理由

- `env:portal`：清空前的确认框（nb-ui `AlertDialog`）与几个下拉菜单渲染到 `body`，目标不存在时由 nb-ui 就地渲染。
- `env:timer`：查找框停顿 300 毫秒才发 `update:search`（输入法组字时不发）。每发一次宿主就作废上一次查找、重扫一遍，按键就发会让服务端白扫；去抖放在组件里，宿主不必知道组字。卸载时清掉计时。

## 注意事项

- 宿主要给组件一块确定的高度（例如编辑区的整页）：列表与详情各自滚动，组件不撑开父容器。
- `selected` 被筛掉时详情照样显示，列表头写明它不在结果里；宿主不要因为筛选就清掉选中。
- 新一次、旧一次按 `rows` 里的先后算：选中的那条不在已加载的行里时两个按钮不可用。

## 不支持

`#N` 跳到第几次请求、查找条的回车、消息页“有命中”与按角色的筛选、比较页里变了的系统提示词与工具的逐行差异、窄时宽窄切换的迟滞与列表滚动位置的保留（Spec 输出 17、19 到 21 的一部分）。
