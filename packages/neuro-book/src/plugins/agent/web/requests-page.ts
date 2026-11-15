/**
 * “模型请求”页的状态（docs/specs/agent/request-trace.md 的“查看器”与“时序与寿命”）：插件作用域里一份，页面挂载时借用、卸载时还。
 * 持有筛选、选中、已加载的列表、按哈希取回的全文与原始请求体，订阅 `nbook.agent/requests` 的 `changed`。
 *
 * 时序：先订阅、再取列表；丢掉序号不大于这一页 `seq` 的事件，同一条按最新的状态合并；重连（`onResync`）后重新取列表。
 * 列表、详情各有一个令牌：筛选或选中又变了，还没回来的旧响应作废，不会盖掉新的。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import {matchesQuery} from "@notnotype/nb-agent-ui";
import type {RequestTraceContentState, RequestTraceDetailState, RequestTraceFacets, RequestTraceListState, RequestTracePayloadView, RequestTraceQuery, RequestTraceTotals} from "@notnotype/nb-agent-ui";
import type {ActivationContext} from "@notnotype/nb-runtime/plugins";

import {agentRequestsContract} from "../shared/requests";
import type {RequestChangeView, RequestDetailView, RequestRowView} from "../shared/requests";

/** 浏览器入口取客户端的写法；类型从它推出（运行时的远程客户端类型没有单独导出）。 */
export const useRequests = (context: Pick<ActivationContext, "remote">) => context.remote.use(agentRequestsContract);
export type RequestsClient = ReturnType<typeof useRequests>;

type Result<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly code: string};

/** 按哈希留着的全文最多这么多段：一次请求的消息几百条，来回看几次请求就够用；满了丢最早的。 */
const CONTENT_CACHE = 300;
const PAGE_SIZE = 100;

const EMPTY_TOTALS: RequestTraceTotals = {count: 0, input: 0, cacheRead: 0, cost: null};

/** 查看器的筛选换成远程调用的输入（合同的数组是可变的类型）。 */
function listInput(query: RequestTraceQuery) {
    return {
        ...(query.sessions === undefined ? {} : {sessions: [...query.sessions]}),
        ...(query.purposes === undefined ? {} : {purposes: [...query.purposes]}),
        ...(query.statuses === undefined ? {} : {statuses: [...query.statuses]}),
        ...(query.models === undefined ? {} : {models: [...query.models]}),
        ...(query.since === undefined ? {} : {since: query.since}),
        ...(query.sort === undefined ? {} : {sort: query.sort}),
        limit: PAGE_SIZE,
    };
}

/** 分段读回一段全文；任一段失败就交回那一段的码。 */
async function readAll(read: (index: number) => Promise<Result<{readonly text: string; readonly last: boolean}>>): Promise<Result<string>> {
    let text = "";
    for (let index = 0; ; index += 1) {
        const chunk = await read(index);
        if (!chunk.ok) return chunk;
        text += chunk.value.text;
        if (chunk.value.last) return {ok: true, value: text};
    }
}

export class RequestsPage {
    readonly rows: ShallowRef<readonly RequestRowView[]> = shallowRef([]);
    readonly list: ShallowRef<RequestTraceListState> = shallowRef({state: "loading", more: false});
    readonly totals: ShallowRef<RequestTraceTotals> = shallowRef(EMPTY_TOTALS);
    readonly facets: ShallowRef<RequestTraceFacets> = shallowRef({sessions: [], models: []});
    readonly query: ShallowRef<RequestTraceQuery> = shallowRef({});
    /** 按别的排序时来了的新请求（不插进列表，点了刷新）。 */
    readonly pending: ShallowRef<number> = shallowRef(0);
    readonly selected: ShallowRef<string | null> = shallowRef(null);
    readonly detail: ShallowRef<RequestTraceDetailState> = shallowRef({state: "idle"});
    readonly contents: ShallowRef<Readonly<Record<string, RequestTraceContentState>>> = shallowRef({});
    readonly payload: ShallowRef<RequestTracePayloadView> = shallowRef({state: "idle"});

    readonly #remote: RequestsClient;
    readonly #report: (code: string, message: string) => void;
    #seq = 0;
    #next: string | undefined;
    #listToken = 0;
    #detailToken = 0;
    #borrowers = 0;
    #release: (() => void) | null = null;
    /** 下一次取完列表时要选中的（命令带的 `request`），或“选中最新的一条”（true）。 */
    #pick: string | true | null = true;

    constructor(remote: RequestsClient, report: (code: string, message: string) => void) {
        this.#remote = remote;
        this.#report = report;
    }

    /** 页面挂载时调；交回的函数在卸载时调。第一个借用者订阅并取列表，最后一个还回时只放掉订阅，状态留着。 */
    borrow(): () => void {
        this.#borrowers += 1;
        if (this.#borrowers === 1) void this.#start();
        let returned = false;
        return () => {
            if (returned) return;
            returned = true;
            this.#borrowers -= 1;
            if (this.#borrowers === 0) {
                this.#release?.();
                this.#release = null;
            }
        };
    }

    async #start(): Promise<void> {
        const subscribed = await this.#remote.events.changed.subscribe({}, (change) => this.#apply(change), {onResync: () => void this.refresh()});
        if (!subscribed.ok) {
            this.#report("requests-subscribe-failed", `could not subscribe to model request changes: ${subscribed.code}`);
            this.list.value = {state: "error", more: false};
            return;
        }
        // 订阅回来之前页面已经卸载了。
        if (this.#borrowers === 0) {
            subscribed.value.release();
            return;
        }
        this.#release = () => subscribed.value.release();
        await this.refresh();
    }

    /** 命令“查看模型请求”（输出 26）：带会话时只看它，带请求序号时选中那一次；什么都不带时沿用现有的筛选。 */
    async open(target: {readonly sessionId?: string; readonly request?: number}): Promise<void> {
        if (target.sessionId === undefined) return;
        this.query.value = {...(this.query.value.sort === undefined ? {} : {sort: this.query.value.sort}), sessions: [target.sessionId]};
        if (target.request === undefined) {
            this.#pick = true;
        } else {
            const found = await this.#remote.find({session: target.sessionId, request: target.request});
            if (found.ok) this.#pick = found.value.id;
            else {
                this.#pick = null;
                this.selected.value = null;
                this.detail.value = {state: found.code === "request-not-found" ? "missing" : "error"};
            }
        }
        if (this.#release !== null) await this.refresh();
    }

    setQuery(query: RequestTraceQuery): void {
        this.query.value = query;
        void this.refresh();
    }

    /** 从头取列表（筛选变了、点了“有 N 条新请求”、重连之后）。 */
    async refresh(): Promise<void> {
        const token = ++this.#listToken;
        this.list.value = {state: "loading", more: false};
        this.pending.value = 0;
        const page = await this.#remote.list(listInput(this.query.value));
        if (token !== this.#listToken) return;
        if (!page.ok) {
            this.#report("requests-list-failed", `could not list model requests: ${page.code}`);
            this.list.value = {state: "error", more: false};
            return;
        }
        this.#seq = page.value.seq;
        this.#next = page.value.next;
        this.rows.value = page.value.rows;
        this.totals.value = page.value.totals;
        this.facets.value = page.value.facets;
        this.list.value = {state: "ready", more: page.value.next !== undefined};
        const pick = this.#pick;
        this.#pick = null;
        if (pick === true && this.selected.value === null && page.value.rows[0] !== undefined) this.select(page.value.rows[0].id);
        else if (typeof pick === "string") this.select(pick);
    }

    async more(): Promise<void> {
        const cursor = this.#next;
        if (cursor === undefined || this.list.value.state !== "ready") return;
        const token = this.#listToken;
        this.list.value = {state: "loading", more: true};
        const page = await this.#remote.list({...listInput(this.query.value), cursor});
        if (token !== this.#listToken) return;
        if (!page.ok) {
            this.#report("requests-list-failed", `could not list more model requests: ${page.code}`);
            this.list.value = {state: "ready", more: true};
            return;
        }
        const known = new Set(this.rows.value.map((row) => row.id));
        this.rows.value = [...this.rows.value, ...page.value.rows.filter((row) => !known.has(row.id))];
        this.#next = page.value.next;
        this.list.value = {state: "ready", more: page.value.next !== undefined};
    }

    select(id: string): void {
        if (this.selected.value !== id) this.payload.value = {state: "idle"};
        this.selected.value = id;
        void this.#read(id);
    }

    /** 详情出错后重试，或这条结算了要换成最新的。 */
    reload(): void {
        if (this.selected.value !== null) void this.#read(this.selected.value);
    }

    async #read(id: string): Promise<void> {
        const token = ++this.#detailToken;
        // 同一条重读（结算之后）时不闪加载态。
        const current = this.detail.value;
        if (current.state !== "ready" || current.value.id !== id) this.detail.value = {state: "loading"};
        const read = await this.#remote.read({id});
        if (token !== this.#detailToken) return;
        if (!read.ok) {
            this.detail.value = {state: read.code === "request-not-found" ? "missing" : "error"};
            return;
        }
        // 消息大纲分页交来：接着取到最后一页再显示，详情里的序号与收起的前缀要看全部消息。
        let value: RequestDetailView = read.value;
        let from = value.messagesNext;
        while (from !== null) {
            const page = await this.#remote.messages({id, from});
            if (token !== this.#detailToken) return;
            if (!page.ok) {
                this.detail.value = {state: page.code === "request-not-found" ? "missing" : "error"};
                return;
            }
            value = {...value, messages: [...value.messages, ...page.value.items], messagesNext: page.value.next};
            from = page.value.next;
        }
        this.detail.value = {state: "ready", value};
    }

    async loadContent(hash: string): Promise<void> {
        const known = this.contents.value[hash]?.state;
        if (known === "ready" || known === "loading") return;
        this.#setContent(hash, {state: "loading"});
        const read = await readAll((index) => this.#remote.content({hash, index}));
        this.#setContent(hash, read.ok ? {state: "ready", text: read.value} : {state: read.code === "content-not-found" ? "missing" : "error"});
    }

    /** 新放进来的排在最后（对象的字符串键按加入的先后排）；满了丢最早的。 */
    #setContent(hash: string, state: RequestTraceContentState): void {
        const entries = Object.entries(this.contents.value).filter(([key]) => key !== hash);
        entries.push([hash, state]);
        this.contents.value = Object.fromEntries(entries.slice(Math.max(0, entries.length - CONTENT_CACHE)));
    }

    async loadPayload(id: string): Promise<void> {
        this.payload.value = {state: "loading"};
        const read = await readAll((index) => this.#remote.payload({id, index}));
        if (this.selected.value !== id) return;
        this.payload.value = read.ok ? {state: "ready", text: read.value} : {state: read.code === "payload-not-found" ? "missing" : "error"};
    }

    /**
     * 合并一条变更（Spec 输出 15）。按时间排时，新来的、在当前筛选里的插到顶上；按别的排序时不插，记进 `pending`。
     * 结算的原地换内容、不换位置；选中的那条结算了，详情重读。
     */
    #apply(change: RequestChangeView): void {
        if (change.seq <= this.#seq) return;
        this.#seq = change.seq;
        if (change.kind === "removed") {
            const gone = new Set(change.ids);
            this.rows.value = this.rows.value.filter((row) => !gone.has(row.id));
            if (this.selected.value !== null && gone.has(this.selected.value)) {
                this.selected.value = null;
                this.detail.value = {state: "idle"};
            }
            return;
        }
        const index = this.rows.value.findIndex((row) => row.id === change.row.id);
        if (index >= 0) {
            const next = [...this.rows.value];
            next[index] = change.row;
            this.rows.value = next;
            if (change.kind === "settled" && change.row.id === this.selected.value) this.reload();
            return;
        }
        if (change.kind !== "added" || this.list.value.state === "error" || !matchesQuery(change.row, this.query.value)) return;
        if ((this.query.value.sort ?? "time") === "time") this.rows.value = [change.row, ...this.rows.value];
        else this.pending.value += 1;
    }

    /** 清空一个会话（连同它的后台请求）或全部的记录；进行中的不清（输出 25）。 */
    async clear(session?: string): Promise<boolean> {
        const cleared = await this.#remote.clear(session === undefined ? {} : {session});
        if (!cleared.ok) this.#report("requests-clear-failed", `could not clear model request records: ${cleared.code}`);
        await this.refresh();
        return cleared.ok;
    }
}
