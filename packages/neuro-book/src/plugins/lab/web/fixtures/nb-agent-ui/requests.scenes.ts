/**
 * 模型请求查看器的 Lab 场景（docs/specs/agent/request-trace.md 的“查看器”）。时间按本地时区构造，截图不随机器的时区变。
 * 宽度不到 760px 时只显示一栏：拖窄画布看列表与详情来回切换。
 */
import type {RequestTraceDetail, RequestTraceRow} from "@notnotype/nb-agent-ui";
import type {AgentRequestTrace} from "@notnotype/nb-agent-ui/vue";
import type {LabFixtureDefinition} from "../define";

const at = (hour: number, minute: number, second = 0) => new Date(2026, 10, 15, hour, minute, second).getTime();
const now = at(10, 31, 20);

const usage = (input: number, cacheRead: number, output: number, cost: number | null) => ({input, output, cacheRead, cacheWrite: 0, cost});
const HARBOR = {session: "s-harbor", title: "第二章改稿：雾港码头"};
const LINZHAO = {session: "s-linzhao", title: "人物小传：林照"};
const turn2 = {id: "t-harbor-2", index: 2, input: "把雾港码头那段改紧一点，删掉重复的天气描写"};
const turn1 = {id: "t-harbor-1", index: 1, input: "检查林照在第一、三、五章里的年龄是否一致"};

const rows: RequestTraceRow[] = [
    {id: "r10", ...HARBOR, request: 10, purpose: "turn", model: "deepseek/deepseek-v4-flash", turn: turn2, startedAt: at(10, 31, 2), status: "running", toolsChanged: false, attempts: 1},
    {id: "r9", ...HARBOR, request: 9, purpose: "turn", model: "deepseek/deepseek-v4-flash", turn: turn2, startedAt: at(10, 30, 40), endedAt: at(10, 30, 52), firstContentAt: at(10, 30, 42), status: "ok", stopReason: "tool", usage: usage(1_280, 41_600, 312, 0.0031), http: 200, toolsChanged: false, attempts: 1},
    {id: "r8", ...LINZHAO, request: 4, purpose: "compaction", model: "deepseek/deepseek-v4-flash", startedAt: at(10, 29, 10), endedAt: at(10, 29, 31), status: "ok", stopReason: "stop", usage: usage(38_400, 0, 1_920, 0.0122), http: 200, toolsChanged: false, attempts: 1},
    {id: "r7", ...HARBOR, request: 8, purpose: "turn", model: "deepseek/deepseek-v4-flash", turn: turn1, startedAt: at(10, 26, 5), endedAt: at(10, 26, 11), status: "error", error: {kind: "rate_limit", status: 429}, http: 429, resend: 2, toolsChanged: false, attempts: 3},
    {id: "r6", ...HARBOR, request: 7, purpose: "approval", model: "deepseek/deepseek-v4-flash", turn: turn1, startedAt: at(10, 25, 40), endedAt: at(10, 25, 43), status: "ok", stopReason: "stop", usage: usage(2_100, 0, 40, 0.0004), http: 200, toolsChanged: true, attempts: 1},
    {id: "r5", ...HARBOR, request: 6, purpose: "turn", model: "deepseek/deepseek-v4-flash", turn: turn1, startedAt: at(10, 25, 2), endedAt: at(10, 25, 38), firstContentAt: at(10, 25, 5), status: "ok", stopReason: "tool", usage: usage(860, 39_900, 540, 0.0029), http: 200, toolsChanged: false, attempts: 1},
    {id: "r4", session: "session-title-1", title: HARBOR.title, background: {owner: HARBOR.session}, request: 1, purpose: "turn", model: "deepseek/deepseek-v4-flash", turn: {id: "bg", index: 1}, startedAt: at(10, 24, 50), endedAt: at(10, 24, 52), status: "ok", stopReason: "tool", usage: usage(640, 0, 28, 0.0002), http: 200, toolsChanged: false, attempts: 1},
];

const detail: RequestTraceDetail = {
    ...rows[5]!,
    hash: "3b313cb11376",
    previous: {id: "r-earlier", request: 5, sharedPrefix: 2},
    modifiedBy: [{extension: "nbook.agent.guards", fields: ["system"]}],
    params: {maxTokens: 8000},
    profile: "nbook.agent.main",
    system: [
        {hash: "sys-1", preview: "你是长篇写作助手，帮作者核对设定、改稿与整理资料。", tokens: 820},
        {hash: "sys-2", preview: "工作区：《雾港》，正文在 正文/ 下，设定在 设定/ 下。", tokens: 120},
    ],
    messages: [
        {hash: "m-1", role: "user", preview: "检查林照在第一、三、五章里的年龄是否一致", tokens: 24, images: 0},
        {hash: "m-2", role: "assistant", preview: "先读三章里提到林照的段落。", tokens: 96, toolCalls: [{id: "c-1", tool: "builtin.read", args: {path: "正文/第一章.md"}}, {id: "c-2", tool: "builtin.read", args: {path: "正文/第三章.md"}}], images: 0},
        {hash: "m-3", role: "tool", preview: "第一章 · 第 12 行：林照今年二十三岁，刚从师范学院毕业……", tokens: 18_400, callId: "c-1", images: 0},
        {hash: "m-4", role: "tool", preview: "第三章 · 第 40 行：二十五岁的林照站在码头上……", tokens: 21_300, callId: "c-2", images: 1},
    ],
    messagesNext: null,
    tools: [
        {hash: "tool-1", id: "builtin.read", description: "读取工作区里的文件。"},
        {hash: "tool-2", id: "builtin.edit", description: "按行修改工作区里的文件。"},
        {hash: "tool-3", id: "builtin.search", description: "在工作区里按文字查找。"},
    ],
    reply: {hash: "reply-1", role: "assistant", preview: "第一章写的是二十三岁（第 12 行），第三章第 40 行写成了二十五岁，第五章没有提到。要按二十三岁统一吗？", tokens: 540, images: 0},
    attemptList: [{url: "https://api.deepseek.com/chat/completions", startedAt: at(10, 25, 2), endedAt: at(10, 25, 4), status: 200, responseHeaders: {"content-type": "text/event-stream", "x-ratelimit-remaining-requests": "998", "set-cookie": "[REDACTED]"}}],
    payload: {state: "present", bytes: 39_100},
};

const contents = {
    "m-3": {state: "ready" as const, text: JSON.stringify({role: "tool", callId: "c-1", content: [{kind: "text", text: "第一章 · 第 12 行：林照今年二十三岁，刚从师范学院毕业，被分到雾港的小学教书。\n第一章 · 第 30 行：她把行李放在码头的长凳上。"}]})},
};

const base = {
    rows,
    list: {state: "ready" as const, more: false},
    totals: {count: rows.length, input: 197_400, cacheRead: 81_500, cost: 0.0188},
    facets: {sessions: [{id: HARBOR.session, count: 6, title: HARBOR.title}, {id: LINZHAO.session, count: 1, title: LINZHAO.title}], models: [{id: "deepseek/deepseek-v4-flash", count: 7}]},
    selected: "r5",
    detail: {state: "ready" as const, value: detail},
    contents,
    payload: {state: "idle" as const},
    enabled: true,
    now,
    locale: "zh-CN" as const,
};

// 失败的请求没有用量、停止原因、第一块内容与回复：从成功那条的详情上去掉，再盖上失败那一行。
const {usage: _usage, stopReason: _stopReason, firstContentAt: _firstContentAt, reply: _reply, ...detailBase} = detail;
const failedDetail: RequestTraceDetail = {
    ...detailBase,
    ...rows[3]!,
    hash: "8a1f0c2d9e44",
    errorMessage: "429 Too Many Requests: rate limit reached for requests",
    payload: {state: "pruned"},
    attemptList: [0, 1, 2].map((index) => ({url: "https://api.deepseek.com/chat/completions", startedAt: at(10, 26, 5 + index * 2), endedAt: at(10, 26, 6 + index * 2), status: 429, responseHeaders: {"retry-after": "2", "x-ratelimit-remaining-requests": "0"}})),
};

// 查找“林照”：两次请求有命中；选中的那次四条消息各一处，全文都取回了，查找条定位到第一处。
const searchRows: RequestTraceRow[] = [
    {...rows[2]!, match: {count: 6, pages: {messages: 6, system: 0, tools: 0, error: 0}, first: {page: "messages", item: 0, ordinal: 0, before: "人物小传：", text: "林照", after: "，二十三岁，师范学院毕业，在雾港教书"}}},
    {...rows[5]!, match: {count: 4, pages: {messages: 4, system: 0, tools: 0, error: 0}, first: {page: "messages", item: 0, ordinal: 0, before: "检查", text: "林照", after: "在第一、三、五章里的年龄是否一致"}}},
];
const searchContents = {
    ...contents,
    "m-1": {state: "ready" as const, text: JSON.stringify({role: "user", content: [{kind: "text", text: "检查林照在第一、三、五章里的年龄是否一致"}]})},
    "m-2": {state: "ready" as const, text: JSON.stringify({role: "assistant", content: [{kind: "text", text: "先读三章里提到林照的段落。"}], toolCalls: [{id: "c-1", tool: "builtin.read", args: {path: "正文/第一章.md"}}, {id: "c-2", tool: "builtin.read", args: {path: "正文/第三章.md"}}]})},
    "m-4": {state: "ready" as const, text: JSON.stringify({role: "tool", callId: "c-2", content: [{kind: "text", text: "第三章 · 第 40 行：二十五岁的林照站在码头上，望着雾里的灯。"}]})},
};
const searchHits = [0, 1, 2, 3].map((item) => ({page: "messages" as const, item, ordinal: 0}));

// 比较页拿来比的前一次：同样的系统提示词，少一个工具，消息只有前两条。
const {previous: _previous, ...detailOwn} = detail;
const earlierDetail: RequestTraceDetail = {
    ...detailOwn,
    id: "r-earlier",
    request: 5,
    hash: "c41d2a9b07e3",
    startedAt: at(10, 24, 30),
    endedAt: at(10, 24, 58),
    usage: usage(4_200, 35_100, 96, 0.0024),
    messages: detail.messages.slice(0, 2),
    tools: detail.tools.slice(0, 2),
    reply: detail.messages[1]!,
};

type Scene = LabFixtureDefinition<typeof AgentRequestTrace>["scenes"][number];

/** 筛选是 `query` 加 `update:query`：放在场景的 model 里，Lab 把改动写回。 */
const all = {query: {}};

export const agentRequestTraceScenes: Scene[] = [
    {id: "overview", label: "几个会话的请求交错，按轮分组；选中一次成功的对话请求", input: {props: base, model: all}},
    {id: "session", label: "只看一个会话：组头不写会话标题，后台标题会话的请求归在里面", input: {props: {...base, rows: rows.filter((row) => row.session === HARBOR.session || row.background?.owner === HARBOR.session)}, model: {query: {sessions: [HARBOR.session]}}}},
    {id: "failed", label: "选中一次限流失败、重发过的请求", input: {props: {...base, selected: "r7", detail: {state: "ready" as const, value: failedDetail}}, model: all}},
    {id: "sorted", label: "按费用排：不分组", input: {props: {...base, rows: [...rows].sort((a, b) => (b.usage?.cost ?? -1) - (a.usage?.cost ?? -1))}, model: {query: {sort: "cost" as const}}}},
    {id: "loading", label: "列表与详情都在加载", input: {props: {...base, rows: [], list: {state: "loading" as const, more: false}, selected: null, detail: {state: "idle" as const}}, model: all}},
    {id: "missing", label: "命令要的那次请求没有记录", input: {props: {...base, selected: null, detail: {state: "missing" as const}}, model: all}},
    {id: "empty", label: "还没有模型请求", input: {props: {...base, rows: [], totals: {count: 0, input: 0, cacheRead: 0, cost: null}, selected: null, detail: {state: "idle" as const}}, model: all}},
    {id: "disabled", label: "记录关着、没有记录", input: {props: {...base, rows: [], totals: {count: 0, input: 0, cacheRead: 0, cost: null}, selected: null, detail: {state: "idle" as const}, enabled: false}, model: all}},
    {id: "search", label: "查找“林照”：列表换成命中的请求与片段，没扫完带“接着查”；详情上是查找条，展开第一处", input: {props: {...base, rows: searchRows, contents: searchContents, searchState: {state: "done" as const, truncated: true}, hits: searchHits}, model: {...all, search: "林照"}}},
    {id: "searching", label: "正在查找，还一条没找到", input: {props: {...base, rows: [], list: {state: "loading" as const, more: false}, searchState: {state: "searching" as const, truncated: false}, hits: null}, model: {...all, search: "林照"}}},
    {id: "list-error", label: "列表读不出", input: {props: {...base, rows: [], list: {state: "error" as const, more: false}, selected: null, detail: {state: "idle" as const}}, model: all}},
    {id: "pending", label: "列表不在顶上时来了 3 条新请求", input: {props: {...base, pending: 3}, model: all}},
    {id: "compare", label: "和前一次比较（点“和上一次比较”页签）：多了一个工具、两条消息", input: {props: {...base, compare: {base: "r-earlier", detail: {state: "ready" as const, value: earlierDetail}}}, model: all}},
    {id: "english", label: "English", input: {props: {...base, locale: "en-US" as const}, model: all}},
];
