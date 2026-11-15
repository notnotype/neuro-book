/**
 * 远程合同 `nbook.agent/requests` 的提供方（docs/specs/agent/request-trace.md）：把 nb-harness 的记录器交给查看器，补上会话标题与
 * 后台标题会话的所属。记录器本身（写入、折叠、清理）在 `@notnotype/nb-harness/kit/requests`，这里只做转换与分段。
 */

import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";

import type {SessionIndexEntry, StorageResult} from "@notnotype/nb-harness/kernel/contracts";
import {RequestTraceUnavailable} from "@notnotype/nb-harness/kit/requests";
import type {RequestChange, RequestRecorder, RequestRow} from "@notnotype/nb-harness/kit/requests";
import {isTitleSessionId, titleSessionId} from "@notnotype/nb-harness/kit/sessions";

import type {agentRequestsContract, RequestChangeView, RequestPageView, RequestRowView, RowContext, SessionFacet} from "../shared/requests";

import {chunkOf, pageOf} from "./frames";
import type {SessionTitles} from "./running-work";

type Methods = RemoteImplementation<typeof agentRequestsContract>["methods"];

/** 一条 `removed` 事件最多带这么多 id（一个 UUID 编码后约 40 字节，放得进一条消息还有余量）。 */
const REMOVED_PER_EVENT = 5000;
/** 分段读回时缓存最近读过的几段全文：一个大请求体分十几段读，不必每段都解压一次。 */
const TEXT_CACHE = 4;

/**
 * 后台标题会话属于哪个会话（Spec 输出 14）。标题会话的 id 由所属会话正向算出（`titleSessionId`），反过来算不出，所以对见过的每个
 * 会话正向算一次记下来：记录器里出现过的会话（打开时与之后每条新记录），标题会话第一次发请求之前，它所属的会话已经发过那一轮的请求。
 */
export class RequestOwners {
    readonly #owners = new Map<string, string>();
    readonly #seen = new Set<string>();

    note(session: string): void {
        if (this.#seen.has(session) || isTitleSessionId(session)) return;
        this.#seen.add(session);
        this.#owners.set(titleSessionId(session), session);
    }

    /** 不是标题会话时交回 undefined；是标题会话、找不到所属的会话时交回 null。 */
    ownerOf(session: string): string | null | undefined {
        if (!isTitleSessionId(session)) return undefined;
        return this.#owners.get(session) ?? null;
    }

    /** 筛选一个会话时连它的后台标题会话一起。 */
    expand(sessions: readonly string[]): string[] {
        return sessions.flatMap((session) => (isTitleSessionId(session) ? [session] : [session, titleSessionId(session)]));
    }
}

export interface RequestsRemoteOptions {
    readonly recorder: RequestRecorder;
    readonly owners: RequestOwners;
    readonly titles: Pick<SessionTitles, "of">;
    /** 只读一个会话的索引（详情里的 Profile）。 */
    readonly sessionEntry: (id: string) => Promise<StorageResult<SessionIndexEntry>>;
}

/** 小的最近使用缓存：按键记住最近几段全文。 */
class RecentTexts {
    readonly #items = new Map<string, string>();

    async get(key: string, load: () => Promise<string | null>): Promise<string | null> {
        const known = this.#items.get(key);
        if (known !== undefined) {
            this.#items.delete(key);
            this.#items.set(key, known);
            return known;
        }
        const text = await load();
        if (text === null) return null;
        this.#items.set(key, text);
        if (this.#items.size > TEXT_CACHE) this.#items.delete(this.#items.keys().next().value as string);
        return text;
    }
}

export function requestsRemote(options: RequestsRemoteOptions): RemoteImplementation<typeof agentRequestsContract> {
    const {recorder, owners, titles} = options;
    const contents = new RecentTexts();
    const payloads = new RecentTexts();

    const contextOf = (session: string): RowContext => {
        const owner = owners.ownerOf(session);
        const title = titles.of(owner ?? session);
        return {...(title === null ? {} : {title}), ...(owner === undefined ? {} : {background: {owner}})};
    };
    const view = (row: RequestRow): RequestRowView => ({...row, ...contextOf(row.session)});

    /** 后台标题会话的条数并进所属会话；找不到所属的留作单独一项。 */
    const mergeSessions = (facets: readonly {readonly id: string; readonly count: number}[]): SessionFacet[] => {
        const merged = new Map<string, {count: number; background: boolean}>();
        for (const {id, count} of facets) {
            const owner = owners.ownerOf(id);
            const key = owner ?? id;
            const item = merged.get(key) ?? {count: 0, background: owner === null};
            item.count += count;
            merged.set(key, item);
        }
        return [...merged].map(([id, {count, background}]) => {
            const title = titles.of(id);
            return {id, count, ...(title === null ? {} : {title}), ...(background ? {background: true as const} : {})};
        }).sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
    };

    /** 记录器整个读不了时它的读方法抛 `RequestTraceUnavailable`：转成合同的失败码，别的错照常抛给通道。 */
    const guarded = <R, U>(run: () => Promise<R>, unavailable: (error: RequestTraceUnavailable) => U): Promise<R | U> => run().catch((error: unknown) => {
        if (error instanceof RequestTraceUnavailable) return unavailable(error);
        throw error;
    });

    const methods: Methods = {
        list: (query, context) => guarded(async () => {
            let page;
            try {
                page = await recorder.list(query.sessions === undefined ? query : {...query, sessions: owners.expand(query.sessions)});
            } catch (error) {
                // 游标只来自上一页；记录器认不出时抛 TypeError。
                if (error instanceof TypeError) return context.fail("invalid-cursor");
                throw error;
            }
            const result: RequestPageView = {...page, rows: page.rows.map(view), facets: {sessions: mergeSessions(page.facets.sessions), models: page.facets.models}};
            return context.ok(result);
        }, (error) => context.fail("trace-unavailable", {reason: error.reason})),
        search: ({text, ...query}, context) => guarded(async () => {
            let page;
            try {
                page = await recorder.search(text, query.sessions === undefined ? query : {...query, sessions: owners.expand(query.sessions)}, {signal: context.signal});
            } catch (error) {
                if (error instanceof TypeError) return context.fail("invalid-cursor");
                throw error;
            }
            return context.ok({...page, rows: page.rows.map((row) => ({...row, ...contextOf(row.session)}))});
        }, (error) => context.fail("trace-unavailable", {reason: error.reason})),
        hits: ({id, text}, context) => guarded(async () => {
            const hits = await recorder.hits(id, text);
            return hits === null ? context.fail("request-not-found") : context.ok(hits);
        }, (error) => context.fail("trace-unavailable", {reason: error.reason})),
        find: ({session, request}, context) => guarded(async () => {
            const row = await recorder.find(session, request);
            return row === null ? context.fail("request-not-found") : context.ok(view(row));
        }, (error) => context.fail("trace-unavailable", {reason: error.reason})),
        read: ({id}, context) => guarded(async () => {
            const detail = await recorder.read(id);
            if (detail === null) return context.fail("request-not-found");
            const entry = await options.sessionEntry(detail.session);
            const {items, cut} = pageOf(detail.messages);
            return context.ok({...detail, ...contextOf(detail.session), ...(entry.ok ? {profile: entry.value.profile} : {}), messages: items, messagesNext: cut ? items.length : null});
        }, (error) => context.fail("trace-unavailable", {reason: error.reason})),
        messages: ({id, from}, context) => guarded(async () => {
            const detail = await recorder.read(id);
            if (detail === null) return context.fail("request-not-found");
            const {items, cut} = pageOf(detail.messages.slice(from));
            return context.ok({items, next: cut ? from + items.length : null});
        }, (error) => context.fail("trace-unavailable", {reason: error.reason})),
        content: ({hash, index}, context) => guarded(async () => {
            const text = await contents.get(hash, () => recorder.content(hash));
            if (text === null) return context.fail("content-not-found");
            const chunk = chunkOf(text, index);
            return chunk === null ? context.fail("out-of-range") : context.ok(chunk);
        }, (error) => context.fail("trace-unavailable", {reason: error.reason})),
        payload: ({id, index}, context) => guarded(async () => {
            const text = await payloads.get(id, () => recorder.payload(id));
            if (text === null) return context.fail("payload-not-found");
            const chunk = chunkOf(text, index);
            return chunk === null ? context.fail("out-of-range") : context.ok(chunk);
        }, (error) => context.fail("trace-unavailable", {reason: error.reason})),
        usage: (_input, context) => guarded(async () => context.ok(await recorder.usage()), (error) => context.fail("trace-unavailable", {reason: error.reason})),
        clear: ({session}, context) => guarded(async () => {
            if (session === undefined) return context.ok({removed: await recorder.clear()});
            let removed = 0;
            for (const target of owners.expand([session])) removed += await recorder.clear({session: target});
            return context.ok({removed});
        }, (error) => context.fail("trace-unavailable", {reason: error.reason})),
    };

    const viewsOf = (change: RequestChange): RequestChangeView[] => {
        if (change.kind !== "removed") return [{seq: change.seq, kind: change.kind, row: view(change.row)}];
        const parts: RequestChangeView[] = [];
        for (let from = 0; from < change.ids.length; from += REMOVED_PER_EVENT) parts.push({seq: change.seq, kind: "removed", ids: change.ids.slice(from, from + REMOVED_PER_EVENT)});
        return parts;
    };

    return {
        methods,
        events: {
            changed: {
                subscribe(_filter, sink, context) {
                    if (context.signal.aborted) return;
                    const stop = recorder.onChange((change) => {
                        for (const item of viewsOf(change)) sink.next(item);
                    });
                    context.signal.addEventListener("abort", stop, {once: true});
                },
            },
        },
    };
}
