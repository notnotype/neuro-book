/**
 * 模型请求查看器的核心（docs/specs/agent/request-trace.md 的“查看器”）：记录的视图类型、列表的分组、新记录进不进当前筛选、
 * 数值的写法。纯函数，不碰远程。
 *
 * 记录由 nb-harness 的记录器产生（`kit/requests`），宿主经自己的远程层交来，并补上会话标题与后台标题会话的所属。本包不依赖
 * nb-harness，这里按结构声明同样的形状（同 `harness.ts` 的做法）；`request-trace.contract.test.ts` 用真实的记录器核对两边一致。
 */

/** `running` 是进行中；进程在进行中退出，下次启动时记为 `interrupted`。 */
export type RequestTraceStatus = "running" | "ok" | "error" | "aborted" | "interrupted";
export type RequestTracePurpose = "turn" | "approval" | "compaction" | "background";
/** 筛选用的状态：记录的状态，加上“重发过”与“成功但没读到缓存”。 */
export type RequestTraceStatusFilter = RequestTraceStatus | "resend" | "cache-miss";
export type RequestTraceSort = "time" | "duration" | "input" | "cost";

export interface RequestTraceUsage {
    /** 不含读到与写入缓存的那部分（OMP 的口径）；全部输入用 `promptTokens`。 */
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    /** 单价未知时为 null。 */
    readonly cost: number | null;
}

/** 查找的一处命中：在哪一页的第几条（从 0 起；回复是消息页最后一条），是那一条里的第几处（从 0 起）。 */
export interface RequestTraceHit {
    readonly page: "messages" | "system" | "tools" | "error";
    readonly item: number;
    readonly ordinal: number;
}

/** 列表上一条请求的命中（Spec 输出 17）：共几处、各页几处、第一处与它前后的字。 */
export interface RequestTraceMatch {
    readonly count: number;
    readonly pages: Readonly<Record<RequestTraceHit["page"], number>>;
    readonly first: RequestTraceHit & {readonly before: string; readonly text: string; readonly after: string};
}

/** 列表的一行。`title`、`background` 是宿主补的：会话标题，后台标题会话的所属（找不到时 `owner` 为 null）。 */
export interface RequestTraceRow {
    readonly id: string;
    readonly session: string;
    /** 会话里的请求序号（界面写 `#N`）。 */
    readonly request: number;
    readonly purpose: RequestTracePurpose;
    readonly model: string;
    readonly effort?: string;
    /** 轮外（手动压缩）没有；`input` 是开这一轮的用户的话的开头。 */
    readonly turn?: {readonly id: string; readonly index: number; readonly input?: string};
    readonly startedAt: number;
    readonly firstContentAt?: number;
    readonly endedAt?: number;
    readonly status: RequestTraceStatus;
    readonly stopReason?: string;
    readonly usage?: RequestTraceUsage;
    readonly answeredBy?: string;
    readonly error?: {readonly kind: string; readonly code?: string; readonly status?: number};
    /** 与前一次完全相同时，这是第几次发送（从 2 起）。 */
    readonly resend?: number;
    readonly toolsChanged: boolean;
    /** 最后一次 HTTP 尝试的状态。 */
    readonly http?: number;
    readonly attempts: number;
    readonly title?: string;
    readonly background?: {readonly owner: string | null};
    /** 查找时这一条的命中（查找交回的行才有）。 */
    readonly match?: RequestTraceMatch;
}

/** 一条消息的大纲；全文按 `hash` 另取。`missing`：内容文件读不出。 */
export interface RequestTraceMessage {
    readonly hash: string;
    readonly role: "user" | "assistant" | "tool";
    readonly preview: string;
    readonly tokens: number;
    readonly toolCalls?: readonly {readonly id: string; readonly tool: string; readonly args: Readonly<Record<string, unknown>>}[];
    readonly callId?: string;
    readonly isError?: boolean;
    readonly images: number;
    /** 压缩留下的摘要。 */
    readonly summary?: true;
    readonly missing?: true;
}

export interface RequestTraceBlock {
    readonly hash: string;
    readonly preview: string;
    readonly tokens: number;
    readonly missing?: true;
}

export interface RequestTraceTool {
    readonly hash: string;
    readonly id: string;
    readonly description: string;
    readonly missing?: true;
}

export interface RequestTraceAttempt {
    readonly url: string;
    readonly startedAt: number;
    readonly endedAt: number;
    readonly status?: number;
    readonly error?: string;
    readonly requestHeaders?: Readonly<Record<string, string>>;
    readonly responseHeaders?: Readonly<Record<string, string>>;
}

/** 原始请求体：存着，或者没有的原因（设置关着、适配器拿不到、因总量上限删掉了）。 */
export type RequestTracePayloadState = {readonly state: "present"; readonly bytes: number} | {readonly state: "disabled" | "unavailable" | "pruned"};

export interface RequestTraceDetail extends RequestTraceRow {
    readonly hash: string;
    /** 同一会话同一用途的前一次与两次相同的消息前缀条数（消息页收起相同的前缀，比较页缺省和它比）。 */
    readonly previous?: {readonly id: string; readonly request: number; readonly sharedPrefix: number};
    readonly modifiedBy: readonly {readonly extension: string; readonly fields: readonly string[]}[];
    readonly params: Readonly<Record<string, unknown>>;
    readonly profile?: string;
    readonly system: readonly RequestTraceBlock[];
    /** 消息大纲的第一页；`messagesNext` 不为 null 时宿主接着取。 */
    readonly messages: readonly RequestTraceMessage[];
    readonly messagesNext: number | null;
    readonly tools: readonly RequestTraceTool[];
    readonly reply?: RequestTraceMessage;
    readonly errorMessage?: string;
    readonly attemptList: readonly RequestTraceAttempt[];
    readonly payload: RequestTracePayloadState;
}

/** 列表的筛选与排序（游标与页大小归宿主）。 */
export interface RequestTraceQuery {
    readonly sessions?: readonly string[];
    readonly purposes?: readonly RequestTracePurpose[];
    readonly statuses?: readonly RequestTraceStatusFilter[];
    readonly models?: readonly string[];
    /** 开始时间不早于它（毫秒）。 */
    readonly since?: number;
    readonly sort?: RequestTraceSort;
}

export interface RequestTraceTotals {
    readonly count: number;
    /** 全部输入 token（含缓存的部分）。 */
    readonly input: number;
    readonly cacheRead: number;
    /** 没有一条有价格时为 null。 */
    readonly cost: number | null;
}

export interface RequestTraceFacets {
    readonly sessions: readonly {readonly id: string; readonly count: number; readonly title?: string; readonly background?: true}[];
    readonly models: readonly {readonly id: string; readonly count: number}[];
}

/** 列表的加载状态；`more` 为真时滚到底接着取。 */
export interface RequestTraceListState {
    readonly state: "loading" | "ready" | "error";
    readonly more: boolean;
}

/** 选中那一条的详情：`missing` 是这次请求没有记录（`request-not-found`）。 */
export type RequestTraceDetailState = {readonly state: "idle" | "loading" | "missing" | "error"} | {readonly state: "ready"; readonly value: RequestTraceDetail};

/** 一段内容（按哈希取的全文，存下的 JSON 文本）。`missing` 是已经清掉了（`content-not-found`）。 */
export type RequestTraceContentState = {readonly state: "loading" | "missing" | "error"} | {readonly state: "ready"; readonly text: string};

/** 原始请求体：`idle` 是还没要过（打开那一页时组件发 `request.load-payload`）。 */
export type RequestTracePayloadView = {readonly state: "idle" | "loading" | "missing" | "error"} | {readonly state: "ready"; readonly text: string};

/** 查找的状态：`searching` 是正在扫；`truncated` 是扫满了上限还没扫完（可以接着查）。 */
export interface RequestTraceSearchState {
    readonly state: "idle" | "searching" | "done" | "error";
    readonly truncated: boolean;
}

/** 比较页的状态：拿来比的是哪一次（还没定时为 null）与它的详情；`candidates` 是同一会话里可以换着比的几次（新的在前）。 */
export interface RequestTraceCompareView {
    readonly base: string | null;
    readonly detail: RequestTraceDetailState;
}

/** 查看器交回宿主的操作。查看器不取数、不写剪贴板，都经它们交给宿主。 */
export type RequestTraceAction =
    | {readonly type: "request.select"; readonly id: string}
    /** 列表滚到底，接着取下一页。 */
    | {readonly type: "request.more"}
    /** 重新取列表（出错后重试、点“有 N 条新请求”）。 */
    | {readonly type: "request.refresh"}
    /** 详情出错后重试。 */
    | {readonly type: "request.retry-detail"}
    | {readonly type: "request.load-content"; readonly hash: string}
    | {readonly type: "request.load-payload"; readonly id: string}
    /** 清空这个会话（筛选了一个会话时）或全部的记录；组件已经让用户确认过（Spec 输出 25）。 */
    | {readonly type: "request.clear"; readonly scope: "session" | "all"}
    /** 列表滚到了顶上或离开了顶上：宿主据此决定新请求插不插进列表（决定 14）。 */
    | {readonly type: "request.list-at-top"; readonly atTop: boolean}
    /** 查找没扫完（`truncated`），接着往后查。 */
    | {readonly type: "request.search-more"}
    /** 比较页要拿这一次来比（缺省是前一次；换了一次时也发）。 */
    | {readonly type: "request.compare-base"; readonly id: string}
    | {readonly type: "request.open-session"; readonly session: string}
    | {readonly type: "request.open-settings"}
    /** 复制这次请求（记录的 JSON）或它的原始请求体。 */
    | {readonly type: "request.copy"; readonly id: string; readonly what: "request" | "payload"};

/** 列表的一组：同一会话同一轮的相邻请求（Spec 输出 14）。 */
export interface RequestGroup {
    /** 组的身份：会话、轮与组里最新一条的 id，列表的 key 用它。 */
    readonly key: string;
    /** 组所属的会话：后台标题会话的请求归到它所属的会话；找不到所属的是标题会话自己。 */
    readonly session: string;
    readonly title?: string;
    /** 后台标题会话的请求（组头写“后台”）。 */
    readonly background: boolean;
    /** 后台与轮外的组为 null。 */
    readonly turn: {readonly id: string; readonly index: number; readonly input?: string} | null;
    /** 组里最早一条的开始时间。 */
    readonly startedAt: number;
    readonly rows: readonly RequestTraceRow[];
}

/** 一行属于哪个会话的组（后台标题会话的请求归到它所属的会话）。 */
export function groupSessionOf(row: RequestTraceRow): string {
    return row.background?.owner ?? row.session;
}

/**
 * 按列表的先后（新的在上）把相邻、同一会话同一轮的请求合成一组；不先按会话聚拢，几个会话同时在跑时组按时间交错。
 * 后台请求按会话合成“后台”组，轮外的请求单独成组。回退之后同一个序号的两轮 id 不同，各成一组。
 */
export function groupRequests(rows: readonly RequestTraceRow[]): RequestGroup[] {
    const groups: {key: string; session: string; title?: string; background: boolean; turn: RequestGroup["turn"]; startedAt: number; rows: RequestTraceRow[]; join: string}[] = [];
    for (const row of rows) {
        const session = groupSessionOf(row);
        const background = row.background !== undefined;
        const turn = background ? null : (row.turn ?? null);
        const join = `${session}\u0000${background ? "background" : (turn?.id ?? `outside:${row.id}`)}`;
        const last = groups.at(-1);
        if (last !== undefined && last.join === join) {
            last.rows.push(row);
            last.startedAt = Math.min(last.startedAt, row.startedAt);
            last.title ??= row.title;
            continue;
        }
        groups.push({key: `${join}\u0000${row.id}`, session, ...(row.title === undefined ? {} : {title: row.title}), background, turn, startedAt: row.startedAt, rows: [row], join});
    }
    return groups.map(({join: _join, ...group}) => group);
}

const chosen = <T>(values: readonly T[] | undefined): values is readonly T[] => values !== undefined && values.length > 0;

const STATUS_TESTS: Readonly<Record<RequestTraceStatusFilter, (row: RequestTraceRow) => boolean>> = {
    running: (row) => row.status === "running",
    ok: (row) => row.status === "ok",
    error: (row) => row.status === "error",
    aborted: (row) => row.status === "aborted",
    interrupted: (row) => row.status === "interrupted",
    resend: (row) => row.resend !== undefined,
    "cache-miss": (row) => row.status === "ok" && (row.usage?.cacheRead ?? 0) === 0,
};

/**
 * 一条新来的记录在不在当前筛选里（宿主据此决定插不插进已加载的列表，Spec 输出 15）。与服务端的筛选同一套规则：筛选一个
 * 会话时连它的后台请求一起。
 */
export function matchesQuery(row: RequestTraceRow, query: RequestTraceQuery): boolean {
    if (chosen(query.sessions) && !query.sessions.includes(row.session) && !query.sessions.includes(groupSessionOf(row))) return false;
    if (chosen(query.models) && !query.models.includes(row.model)) return false;
    if (chosen(query.purposes) && !query.purposes.includes(row.purpose)) return false;
    if (chosen(query.statuses) && !query.statuses.some((status) => STATUS_TESTS[status](row))) return false;
    return query.since === undefined || row.startedAt >= query.since;
}

/** token 数：千以下原样，千以上一位小数加 k，百万以上加 M。 */
export function formatTokens(value: number): string {
    if (value < 1000) return String(value);
    if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
    return `${(value / 1_000_000).toFixed(1)}M`;
}

/** 用时：一秒以下写毫秒，一分钟以下一位小数的秒，再长写分与秒。 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${String(Math.max(0, Math.round(ms)))}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60_000);
    return `${String(minutes)}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

/** 费用（美元）：价格未知时为 null。小于 1 美分的写四位小数，免得一列都是 0.00。 */
export function formatCost(cost: number | null | undefined): string | null {
    if (cost === null || cost === undefined) return null;
    return `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`;
}

/** 这次请求的全部输入 token：不含缓存的、读到缓存的与写入缓存的三部分相加。 */
export function promptTokens(usage: RequestTraceUsage): number {
    return usage.input + usage.cacheRead + usage.cacheWrite;
}

/** 缓存命中：读到的缓存占全部输入的比例（0 到 1）；没有输入时为 null。 */
export function cacheHitRate(usage: RequestTraceUsage | undefined): number | null {
    if (usage === undefined) return null;
    const prompt = promptTokens(usage);
    return prompt <= 0 ? null : usage.cacheRead / prompt;
}

/** 字节数：KB 与 MB 各一位小数。 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${String(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 两次请求的比较（Spec 输出 21）。`current` 是选中的那次，`base` 是拿来比的那次。 */
export interface RequestComparison {
    readonly system: {readonly same: boolean; readonly added: readonly RequestTraceBlock[]; readonly removed: readonly RequestTraceBlock[]};
    readonly tools: {readonly added: readonly string[]; readonly removed: readonly string[]; readonly changed: readonly string[]};
    /** 值变了的参数名。 */
    readonly params: readonly string[];
    readonly messages: {
        /** 从第一条起相同的条数、从最后一条往前相同的条数。 */
        readonly prefix: number;
        readonly suffix: number;
        /** 中间不同的一段：`base` 里的整体换成了 `current` 里的。 */
        readonly removed: readonly RequestTraceMessage[];
        readonly added: readonly RequestTraceMessage[];
        /** 前面的历史被压缩成摘要：被换掉的条数；不是压缩时为 null。 */
        readonly compacted: number | null;
    };
    /** 最早一处变化：缓存从这里断开（服务商按工具、系统提示词、消息的先后缓存前缀）；完全相同时为 null。 */
    readonly firstChange: {readonly kind: "tools" | "system" | "params"} | {readonly kind: "message"; readonly index: number} | null;
}

/**
 * 比较两次请求：系统提示词与工具按内容哈希比，参数按值比；消息先按首尾对齐，中间不同的一段整体当替换（不做逐条的最小编辑），
 * 换上来的那段里有压缩留下的摘要时判为“历史被压缩”。
 */
export function compareRequests(current: RequestTraceDetail, base: RequestTraceDetail): RequestComparison {
    const systemHashes = new Set(base.system.map((block) => block.hash));
    const currentSystem = new Set(current.system.map((block) => block.hash));
    const systemAdded = current.system.filter((block) => !systemHashes.has(block.hash));
    const systemRemoved = base.system.filter((block) => !currentSystem.has(block.hash));
    const systemSame = systemAdded.length === 0 && systemRemoved.length === 0 && current.system.length === base.system.length;

    const baseTools = new Map(base.tools.map((tool) => [tool.id, tool.hash]));
    const currentTools = new Map(current.tools.map((tool) => [tool.id, tool.hash]));
    const tools = {
        added: current.tools.filter((tool) => !baseTools.has(tool.id)).map((tool) => tool.id),
        removed: base.tools.filter((tool) => !currentTools.has(tool.id)).map((tool) => tool.id),
        changed: current.tools.filter((tool) => baseTools.has(tool.id) && baseTools.get(tool.id) !== tool.hash).map((tool) => tool.id),
    };
    const toolsSame = tools.added.length + tools.removed.length + tools.changed.length === 0;

    const keys = new Set([...Object.keys(current.params), ...Object.keys(base.params)]);
    const params = [...keys].filter((key) => JSON.stringify(current.params[key]) !== JSON.stringify(base.params[key])).sort();

    const a = current.messages;
    const b = base.messages;
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix]!.hash === b[prefix]!.hash) prefix += 1;
    let suffix = 0;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix]!.hash === b[b.length - 1 - suffix]!.hash) suffix += 1;
    const added = a.slice(prefix, a.length - suffix);
    const removed = b.slice(prefix, b.length - suffix);
    const compacted = removed.length > 0 && added.some((message) => message.summary === true) ? removed.length : null;
    const messagesSame = added.length === 0 && removed.length === 0;

    const firstChange: RequestComparison["firstChange"] = !toolsSame ? {kind: "tools"}
        : !systemSame ? {kind: "system"}
        : !messagesSame ? {kind: "message", index: prefix + 1}
        : params.length > 0 ? {kind: "params"}
        : null;
    return {system: {same: systemSame, added: systemAdded, removed: systemRemoved}, tools, params, messages: {prefix, suffix, removed, added, compacted}, firstChange};
}

/** 展开一段内容时显示的一块。`image` 只有类型与大小，不进查找。 */
export interface ContentPiece {
    readonly kind: "text" | "thinking" | "image" | "call" | "json";
    readonly text: string;
}

/**
 * 记录器存下的一段内容（一条消息、一段系统提示词、一个工具声明、一份回复）换成显示的几块。除图片外的几块与 nb-harness 记录器
 * 查找用的文字（`searchablePieces`）逐字相同、先后相同：查找条的处数与高亮的位置都按它们数，`request-trace.contract.test.ts` 核对。
 */
export function contentPieces(text: string): ContentPiece[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return [{kind: "text", text}];
    }
    if (typeof parsed === "string") return [{kind: "text", text: parsed}];
    if (parsed === null || typeof parsed !== "object") return [];
    const object = parsed as {content?: unknown; toolCalls?: unknown; kind?: unknown; text?: unknown; description?: unknown; parameters?: unknown};
    const pieces: ContentPiece[] = [];
    const blocks = Array.isArray(object.content) ? object.content : typeof object.kind === "string" ? [object] : [];
    for (const block of blocks as {kind?: unknown; text?: unknown; mime?: unknown; bytes?: unknown; uri?: unknown}[]) {
        if ((block.kind === "text" || block.kind === "thinking") && typeof block.text === "string") pieces.push({kind: block.kind, text: block.text});
        else if (block.kind === "image") pieces.push({kind: "image", text: `${typeof block.mime === "string" ? block.mime : "image"} · ${formatBytes(typeof block.bytes === "number" ? block.bytes : 0)}`});
        else if (block.kind === "imageRef") pieces.push({kind: "image", text: typeof block.uri === "string" ? block.uri : ""});
    }
    if (Array.isArray(object.toolCalls)) for (const call of object.toolCalls as {tool?: unknown; args?: unknown}[]) pieces.push({kind: "call", text: `${typeof call.tool === "string" ? call.tool : ""} ${JSON.stringify(call.args ?? {}, null, 2)}`});
    if (typeof object.description === "string") pieces.push({kind: "text", text: object.description});
    if (object.parameters !== undefined) pieces.push({kind: "json", text: JSON.stringify(object.parameters, null, 2)});
    return pieces;
}

/** 一段文字按查找词切开（不分大小写）：命中的那几段带它在这一条里是第几处（从 `start` 起数）。 */
export function highlightSegments(text: string, needle: string, start = 0): {readonly text: string; readonly ordinal: number | null}[] {
    const target = needle.toLowerCase();
    if (target === "") return [{text, ordinal: null}];
    const lower = text.toLowerCase();
    const segments: {text: string; ordinal: number | null}[] = [];
    let from = 0;
    let ordinal = start;
    for (let at = lower.indexOf(target); at >= 0; at = lower.indexOf(target, at + target.length)) {
        if (at > from) segments.push({text: text.slice(from, at), ordinal: null});
        segments.push({text: text.slice(at, at + target.length), ordinal});
        ordinal += 1;
        from = at + target.length;
    }
    if (from < text.length || segments.length === 0) segments.push({text: text.slice(from), ordinal: null});
    return segments;
}
