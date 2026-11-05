/**
 * 世界服务的远程实现（docs/specs/canon/project.md 的方法表、事件、输出 10、18）：每个调用方一份，都转到项目实例里
 * 唯一的那份世界。
 *
 * - 写入结果里去掉内存里的世界，只留修订 id、版本与 id 对照；失败以业务失败码 `canon` 带回 nb-canon 的失败对象。
 * - 结果编码后超过预算回 `too-large`；列表类的方法先按调用方给的条数取一页，超过预算就把条数减半重取，单条都装不下才回
 *   `too-large`（输出 18 “单页不超过预算”）。
 * - 独占：这个调用方的门面释放（调用方实例失效）时结束它申请的独占；`lease` 订阅结束时也结束（输出 10 的租约订阅）。
 */

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

/**
 * `tokens` 是这个调用方申请到的令牌：门面释放时由入口逐个结束（调用方实例失效，输出 10）。只认自己申请的令牌，
 * 所以别的调用方拿不到的令牌订阅不了 `lease`。
 */
export function remoteWorld(host: WorldHost, tokens: Set<string>): Implementation {
    /** 等打开完成；打不开时把原因当失败。 */
    const withWorld = async <R>(run: (service: WorldService) => R | Promise<R>): Promise<R | Failure> => {
        const service = await host.ready();
        if ("code" in service) return fail({code: service.code});
        return run(service);
    };
    const read = <T>(value: T | "chapter-not-found" | "cursor-stale"): {readonly ok: true; readonly value: T} | Failure => (typeof value === "string" ? fail({code: value}) : within(value));

    return {
        methods: {
            status: () => withWorld((service) => ({ok: true as const, value: service.status()})),
            entry: (input) => withWorld((service) => {
                const view = service.entry(input.id, input.position, input.mode, input.withOrigins === true);
                return read(view);
            }),
            tree: (input) => withWorld((service) => paged(input.limit, (limit) => service.tree(input.parent, input.cursor, limit))),
            lookup: (input) => withWorld((service) => read(service.lookup(input.names, input.position))),
            changes: (input) => withWorld((service) => paged(input.limit, (limit) => service.changes(input.filter ?? {}, input.cursor, limit))),
            object: (input) => withWorld((service) => within(service.object(input.ref))),
            pending: (input) => withWorld((service) => read(service.pending(input.position))),
            decisions: (input) => withWorld((service) => paged(input.limit, (limit) => service.decisions(input.status, input.cursor, limit))),
            suggestions: (input) => withWorld((service) => paged(input.limit, (limit) => service.suggestions(input.status, input.cursor, limit))),
            revisions: (input) => withWorld((service) => paged(input.limit, (limit) => service.revisions(input.filter ?? {}, input.cursor, limit), 20)),
            render: (input) => withWorld((service) => read(service.render(input.entry, input.position, input.mode, input.audience))),
            preview: (input) => withWorld((service) => {
                const result = service.preview(input.request);
                return result.ok ? within({revision: result.revision, ids: result.ids}) : fail(result.failure as CanonFailure);
            }),
            outcome: (input) => withWorld((service) => {
                const result = service.outcome(input.requestId);
                return "code" in result ? fail(result) : {ok: true as const, value: result};
            }),
            publish: (input) => withWorld(async (service) => published(await service.publish(input.request, input.token))),
            editInPlace: ({token, ...edit}) => withWorld(async (service) => published(await service.editInPlace(edit, token))),
            recordDelta: ({token, ...delta}) => withWorld(async (service) => published(await service.recordDelta(delta, token))),
            writeBack: ({token, ...input}) => withWorld(async (service) => published(await service.writeBack(input, token))),
            revert: ({token, revision, withDependents, ...meta}) => withWorld(async (service) => published(await service.revert(revision, withDependents, meta, token))),
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
