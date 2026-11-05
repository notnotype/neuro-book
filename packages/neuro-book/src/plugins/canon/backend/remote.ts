/**
 * 世界服务的远程实现（docs/specs/canon/project.md 的方法表、事件、输出 10、18）：每个调用方一份，都转到项目实例里
 * 唯一的那份世界。
 *
 * - 写入结果里去掉内存里的世界，只留修订 id、版本与 id 对照；失败以业务失败码 `canon` 带回 nb-canon 的失败对象。
 * - 结果编码后超过预算回 `too-large`；列表类的方法先按调用方给的条数取一页，超过预算就把条数减半重取，单条都装不下才回
 *   `too-large`（输出 18 “单页不超过预算”）。
 * - 独占：这个调用方的门面释放（调用方实例失效）时结束它申请的独占；`lease` 订阅结束时也结束（输出 10 的租约订阅）。
 * - 视图（输出 24）：带令牌的读取按方法表转到 `service.viewed`，别的方法带令牌一律 `view-denied`。这个调用方打开的
 *   视图在门面释放时关掉；只能关自己打开的。
 */

import {defaultPosition} from "@notnotype/nb-canon";
import type {ReadPosition} from "@notnotype/nb-canon";
import type {WorldService} from "@notnotype/nb-canon/node";
import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";

import {CANON_BUDGET_BYTES, encodedBytes} from "../shared/contracts";
import type {canonWorldContract, CanonFailure, Published} from "../shared/contracts";
import type {WorldHost} from "./world-host";

type Implementation = RemoteImplementation<typeof canonWorldContract>;
type Failure = {readonly ok: false; readonly code: "canon"; readonly detail: CanonFailure};

const fail = (failure: CanonFailure): Failure => ({ok: false, code: "canon", detail: failure});

/** 写入结果去掉内存里的世界。 */
function published(result: {readonly ok: boolean; readonly failure?: unknown; readonly revision?: {readonly id: string; readonly version: number}; readonly ids?: Readonly<Record<string, string>>; readonly repeated?: boolean; readonly laterRecords?: readonly string[]}): {readonly ok: true; readonly value: Published} | Failure {
    if (!result.ok) return fail(result.failure as CanonFailure);
    return {ok: true, value: {revision: result.revision!.id, version: result.revision!.version, ids: result.ids ?? {}, repeated: result.repeated ?? false, ...(result.laterRecords === undefined ? {} : {laterRecords: result.laterRecords})}};
}

function within<T>(value: T): {readonly ok: true; readonly value: T} | Failure {
    return encodedBytes(value) > CANON_BUDGET_BYTES ? fail({code: "too-large"}) : {ok: true, value};
}

/**
 * 分页读取：超过预算就减半条数重取。`read` 返回 `cursor-stale` 等字符串时原样当失败。`fallback` 是调用方没给条数时的
 * 缺省，与世界服务同一方法的缺省一致。
 */
function paged<T>(limit: number | undefined, read: (limit: number) => T | string, fallback = 50): {readonly ok: true; readonly value: T} | Failure {
    let size = limit ?? fallback;
    for (;;) {
        const page = read(size);
        if (typeof page === "string") return fail({code: page});
        if (encodedBytes(page) <= CANON_BUDGET_BYTES) return {ok: true, value: page};
        if (size === 1) return fail({code: "too-large"});
        size = Math.max(1, Math.floor(size / 2));
    }
}

/** 一个调用方申请到的东西：门面释放时由入口逐个结束（调用方实例失效，输出 10、24）。 */
export interface CallerHoldings {
    /** 独占的令牌。只认自己申请的，所以别的调用方拿不到的令牌订阅不了 `lease`。 */
    readonly tokens: Set<string>;
    /** 打开的视图令牌。 */
    readonly views: Set<string>;
}

/** 不会发出去的令牌：内核查不到它，按失效的令牌拒绝。 */
const FOREIGN_VIEW = "";

export function remoteWorld(host: WorldHost, holdings: CallerHoldings): Implementation {
    const {tokens, views} = holdings;
    /** 等打开完成；打不开时把原因当失败。 */
    const withWorld = async <R>(run: (service: WorldService) => R | Promise<R>): Promise<R | Failure> => {
        const service = await host.ready();
        if ("code" in service) return fail({code: service.code});
        return run(service);
    };
    const read = <T>(value: T | "chapter-not-found" | "cursor-stale" | "view-denied"): {readonly ok: true; readonly value: T} | Failure => (typeof value === "string" ? fail({code: value}) : within(value));
    /**
     * 只认这个调用方自己打开的视图令牌：别人的令牌（例如剧情插件在项目里为看的人开的）按不存在处理，拒绝并记审计、不借用那张
     * 视图的看的人。否则拿到或猜到别人的令牌，就能绕过建在视图之上的过滤（剧情插件的按视角读取）。
     */
    const own = (view: string) => (views.has(view) ? view : FOREIGN_VIEW);
    /** 不许带视图令牌的方法带了令牌：记审计并拒（输出 24）。 */
    const denied = (service: WorldService, view: string | undefined, method: string): Failure | null => (view === undefined ? null : fail({code: service.viewed(own(view)).deny(method)}));
    const position = (service: WorldService, given: ReadPosition | undefined): ReadPosition => given ?? defaultPosition(service.world.options.order);

    return {
        methods: {
            status: () => withWorld((service) => ({ok: true as const, value: service.status()})),
            entry: (input) => withWorld((service) => {
                if (input.view !== undefined) return read(service.viewed(own(input.view)).entry(input.id, input.position, input.mode));
                return read(service.entry(input.id, position(service, input.position), input.mode, input.withOrigins === true));
            }),
            tree: (input) => withWorld((service) => denied(service, input.view, "tree") ?? paged(input.limit, (limit) => service.tree(input.parent, input.cursor, limit))),
            lookup: (input) => withWorld((service) => read(input.view === undefined ? service.lookup(input.names, position(service, input.position)) : service.viewed(own(input.view)).lookup(input.names, input.position))),
            changes: (input) => withWorld((service) => paged(input.limit, (limit) => (input.view === undefined ? service.changes(input.filter ?? {}, input.cursor, limit) : service.viewed(own(input.view)).changes(input.filter ?? {}, input.cursor, limit)))),
            time: (input) => withWorld((service) => {
                if (input.view !== undefined) {
                    const viewed = service.viewed(own(input.view));
                    return paged(input.limit, (limit) => viewed.time(input.query, input.mode, input.cursor, limit));
                }
                return paged(input.limit, (limit) => service.time(input.query, input.mode, input.cursor, limit));
            }),
            tellings: (input) => withWorld((service) => paged(input.limit, (limit) => (input.view === undefined ? service.tellings(input.filter ?? {}, input.cursor, limit) : service.viewed(own(input.view)).tellings(input.filter ?? {}, input.cursor, limit)))),
            presence: (input) => withWorld((service) => paged(input.limit, (limit) => (input.view === undefined ? service.presence(input.person, input.filter ?? {}, input.cursor, limit) : service.viewed(own(input.view)).presence(input.person, input.filter ?? {}, input.cursor, limit)))),
            object: (input) => withWorld((service) => denied(service, input.view, "object") ?? within(service.object(input.ref))),
            pending: (input) => withWorld((service) => denied(service, input.view, "pending") ?? paged(input.limit, (limit) => service.pending({...(input.position === undefined ? {} : {position: input.position}), ...(input.mode === undefined ? {} : {mode: input.mode}), ...(input.group === undefined ? {} : {group: input.group})}, input.cursor, limit))),
            decisions: (input) => withWorld((service) => denied(service, input.view, "decisions") ?? paged(input.limit, (limit) => service.decisions({...(input.status === undefined ? {} : {status: input.status}), ...(input.about === undefined ? {} : {about: input.about})}, input.cursor, limit))),
            suggestions: (input) => withWorld((service) => denied(service, input.view, "suggestions") ?? paged(input.limit, (limit) => service.suggestions(input.status, input.cursor, limit))),
            revisions: (input) => withWorld((service) => denied(service, input.view, "revisions") ?? paged(input.limit, (limit) => service.revisions(input.filter ?? {}, input.cursor, limit), 20)),
            render: (input) => withWorld((service) => read(input.view === undefined ? service.render(input.entry, position(service, input.position), input.mode, input.audience) : service.viewed(own(input.view)).render(input.entry, input.position, input.mode, input.audience))),
            preview: (input) => withWorld((service) => {
                const refused = denied(service, input.view, "preview");
                if (refused !== null) return refused;
                if ("puts" in input.request) {
                    const result = service.preview(input.request);
                    return result.ok ? within({revision: result.revision, ids: result.ids}) : fail(result.failure as CanonFailure);
                }
                const planned = service.preview(input.request);
                if ("ok" in planned) return fail(planned.failure as CanonFailure);
                return planned.result.ok ? within({revision: planned.result.revision, ids: planned.result.ids, needed: planned.needed}) : fail({...(planned.result.failure as CanonFailure), needed: planned.needed});
            }),
            outcome: (input) => withWorld((service) => {
                const result = service.outcome(input.requestId);
                return "code" in result ? fail(result) : {ok: true as const, value: result};
            }),
            publish: (input) => withWorld(async (service) => denied(service, input.view, "publish") ?? published(await service.publish(input.request, input.token))),
            editInPlace: ({token, view, ...edit}) => withWorld(async (service) => denied(service, view, "editInPlace") ?? published(await service.editInPlace(edit, token))),
            recordDelta: ({token, view, ...delta}) => withWorld(async (service) => denied(service, view, "recordDelta") ?? published(await service.recordDelta(delta, token))),
            writeBack: ({token, view, ...input}) => withWorld(async (service) => denied(service, view, "writeBack") ?? published(await service.writeBack(input, token))),
            revert: ({token, view, revision, withDependents, ...meta}) => withWorld(async (service) => denied(service, view, "revert") ?? published(await service.revert(revision, withDependents, meta, token))),
            openView: (input) => withWorld((service) => {
                const opened = service.openView(input);
                if (typeof opened === "string") return fail({code: opened});
                if (!("token" in opened)) return fail(opened);
                views.add(opened.token);
                return {ok: true as const, value: opened};
            }),
            closeView: (input) => withWorld((service) => {
                if (views.delete(input.token)) service.closeView(input.token);
                return {ok: true as const, value: null};
            }),
            viewAudit: (input) => withWorld((service) => paged(input.limit, (limit) => service.viewAudit(input.viewer === undefined ? {} : {viewer: input.viewer}, input.cursor, limit))),
            acquireExclusive: (input) => withWorld((service) => {
                const lease = service.acquireExclusive(input.label);
                if ("code" in lease) return fail(lease);
                tokens.add(lease.token);
                return {ok: true as const, value: lease};
            }),
            renewExclusive: (input) => withWorld((service) => {
                const renewed = service.renewExclusive(input.token);
                return "code" in renewed ? fail(renewed) : {ok: true as const, value: renewed};
            }),
            releaseExclusive: (input) => withWorld((service) => {
                service.releaseExclusive(input.token);
                tokens.delete(input.token);
                return {ok: true as const, value: null};
            }),
            breakExclusive: () => withWorld((service) => {
                service.breakExclusive();
                return {ok: true as const, value: null};
            }),
        },
        events: {
            changed: {subscribe: (_filter, sink, {signal}) => void forward(host, signal, (service) => service.subscribe((event) => event.kind === "changed" && sink.next(event)))},
            exclusive: {subscribe: (_filter, sink, {signal}) => void forward(host, signal, (service) => service.subscribe((event) => event.kind === "exclusive" && sink.next({holder: event.holder})))},
            reduced: {subscribe: (_filter, sink, {signal}) => void forward(host, signal, (service) => service.subscribe((event) => event.kind === "reduced" && sink.next({})))},
            textChanged: {subscribe: (_filter, sink, {signal}) => void forward(host, signal, (service) => service.subscribe((event) => event.kind === "textChanged" && sink.next(event.chapter === null || event.chapter === undefined ? {} : {chapter: event.chapter})))},
            lease: {
                subscribe: (filter, sink, {signal}) => void forward(host, signal, (service) => {
                    // 订阅开始算一次续期；令牌已经不是当前的独占（过期、被解除）时推 ended，之后不会再有推送。
                    if (!tokens.has(filter.token) || "code" in service.renewExclusive(filter.token)) {
                        sink.next({state: "ended"});
                        return () => undefined;
                    }
                    sink.next({state: "held"});
                    // 只推一次 ended：之后别的独占开始、结束都与这张令牌无关。
                    let stop: (() => unknown) | null = service.subscribe((event) => {
                        if (event.kind !== "exclusive" || event.holder !== null || stop === null) return;
                        stop();
                        stop = null;
                        tokens.delete(filter.token);
                        sink.next({state: "ended"});
                    });
                    return () => {
                        stop?.();
                        stop = null;
                        // 订阅结束（退订、连接断开、调用方实例失效）就结束这张令牌的独占。
                        if (tokens.delete(filter.token)) service.releaseExclusive(filter.token);
                    };
                }),
            },
        },
    };
}

/** 世界打开后接上服务的事件，订阅结束时解开；打开失败或已停止时什么也不推。 */
async function forward(host: WorldHost, signal: AbortSignal, attach: (service: WorldService) => () => unknown): Promise<void> {
    const service = await host.ready();
    if ("code" in service || signal.aborted) return;
    const detach = attach(service);
    signal.addEventListener("abort", () => void detach(), {once: true});
}
