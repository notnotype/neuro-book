/**
 * 通用拦截链（docs/specs/harness/runtime.md 输出 20、21）：输入、模型、工具、压缩四条链共用。每条链只配三样：
 * 取哪个方法、失败了怎么办（`onFailure`）、怎样把一层交回的值归一（`normalize`）。
 *
 * 时序：一层的 `fn(input, next, ctx)` 开始时起计时；调用 `next` 后停表（里层的时间不算它的），`next` 完成后重新起表。
 * 超时或抛错时这一层算失败，之后它再调用 `next` 得到拒绝，所以按“跳过”策略重新进里层时，里层不会被它再跑一遍。
 * 一层抛的错如果就是里层抛上来的（例如写日志失败），原样往外抛，不当作这一层的失败。
 *
 * 链本身不和运行的中止赛跑：各层的 `ctx.signal` 挂在中止上，由调用方决定中止后还等不等（工具要等宽限期）。
 */

import type {EntryPoint} from "../api/index.js";
import type {Assembled} from "../extension/assemble.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";

export type ChainMethod = "input" | "model" | "tool" | "compaction";

export interface ChainFailure {
    readonly extension: string;
    readonly code: "threw" | "timeout" | "invalid-output";
    /** 出错时这一层有没有调用过 `next`。 */
    readonly phase: "before" | "after";
    readonly error?: unknown;
}

/** 失败之后：跳过这一层（之前出错把输入原样交给里层，之后出错用里层的输出），或直接给出结果。 */
export type FailurePolicy<O> = {readonly kind: "skip"} | {readonly kind: "result"; readonly value: O};

export interface ChainOptions<I, O> {
    readonly core: SessionCore;
    readonly method: ChainMethod;
    /** 按拦截序（外到里）、已排除失败的扩展与没写这个方法的。 */
    readonly layers: readonly Assembled[];
    readonly input: I;
    readonly timeoutMs: (item: Assembled) => number;
    /** 运行的中止（没有运行时给一个不会触发的信号）。 */
    readonly signal: AbortSignal;
    readonly ctxFor: (item: Assembled, invocation: string, signal: AbortSignal) => unknown;
    readonly terminal: (input: I) => Promise<O>;
    readonly onFailure: (item: Assembled, failure: ChainFailure) => FailurePolicy<O>;
    /** 一层交回的值归一成 `O`；交回的值不合形状时抛错（算这一层 `invalid-output`）。`inner` 是它最后一次 `next` 的结果。 */
    readonly normalize: (item: Assembled, returned: unknown, inner: {readonly value: O} | null, received: I) => O;
    /** 一层调用 `next` 时：它收到的与交给里层的（记修改用）。 */
    readonly onNext?: (item: Assembled, received: I, passed: I) => void;
}

export interface ChainOutcome<O> {
    readonly value: O;
    readonly failures: readonly ChainFailure[];
    /** 没有调用 `next` 就交回的那一层；一路调到最里层时为 null。 */
    readonly stoppedBy: string | null;
}

/** 一层失败之后又调用了 `next`。 */
export class LateNextError extends Error {
    constructor(readonly extension: string) {
        super(`${extension} called next after its interceptor had failed or timed out`);
        this.name = "LateNextError";
    }
}

export const interceptorOf = (item: Assembled, method: ChainMethod): ((...args: unknown[]) => unknown) | undefined =>
    (item.definition.intercept as Record<string, ((...args: unknown[]) => unknown) | undefined> | undefined)?.[method];

/** 这条链的各层：拦截序就是装配序；`mount` 失败过的扩展不参与。 */
export function chainLayers(core: SessionCore, method: ChainMethod): Assembled[] {
    return core.assembly.order.filter((item) => !core.inactive(item.definition.id) && typeof interceptorOf(item, method) === "function");
}

export async function runChain<I, O>(options: ChainOptions<I, O>): Promise<ChainOutcome<O>> {
    const {core} = options;
    const failures: ChainFailure[] = [];
    /** 里层抛上来的错：外层原样再抛时认得出来。 */
    const innerErrors = new WeakSet<object>();
    let stoppedBy: string | null = null;

    const call = async (index: number, input: I): Promise<O> => {
        if (index === options.layers.length) return options.terminal(input);
        const item = options.layers[index]!;
        // 层列表在进链时取定；链走到这一层时它已被撤回（外层慢拦截挂起期间撤回），跳过它，原样交给里层。
        if (core.inactive(item.definition.id)) return call(index + 1, input);
        const fn = interceptorOf(item, options.method)!;
        const controller = new AbortController();
        const onAbort = () => controller.abort(options.signal.reason);
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else options.signal.addEventListener("abort", onAbort, {once: true});

        let settled = false;
        let first: Promise<O> | null = null;
        let inner: {value: O} | null = null;
        let inside = 0;
        let timer: AbortController | null = null;
        let fire: () => void = () => undefined;
        const timedOut = new Promise<{kind: "timeout"}>((resolve) => {
            fire = () => resolve({kind: "timeout"});
        });
        const arm = () => {
            timer?.abort();
            const own = new AbortController();
            timer = own;
            core.clock.wait(options.timeoutMs(item), own.signal).then(() => {
                if (!own.signal.aborted) fire();
            }, () => undefined);
        };
        const disarm = () => {
            timer?.abort();
            timer = null;
        };
        const next = (passed: I): Promise<O> => {
            if (settled) return Promise.reject(new LateNextError(item.definition.id));
            options.onNext?.(item, input, passed);
            inside += 1;
            disarm();
            const promise = call(index + 1, passed).then(
                (value) => {
                    inner = {value};
                    return value;
                },
                (error: unknown) => {
                    if (typeof error === "object" && error !== null) innerErrors.add(error);
                    throw error;
                },
            ).finally(() => {
                inside -= 1;
                if (inside === 0 && !settled) arm();
            });
            first ??= promise;
            return promise;
        };

        arm();
        const work = (async () => {
            try {
                return {kind: "done" as const, value: await fn(input, next, options.ctxFor(item, core.newId(), controller.signal))};
            } catch (error) {
                return {kind: "threw" as const, error};
            }
        })();
        const result = await Promise.race([work, timedOut]);
        settled = true;
        disarm();
        options.signal.removeEventListener("abort", onAbort);
        controller.abort(result.kind === "timeout" ? new Error(`interceptor of ${item.definition.id} timed out`) : undefined);

        let failure: ChainFailure | null = null;
        if (result.kind === "done") {
            try {
                const value = options.normalize(item, result.value, inner, input);
                if (first === null) stoppedBy ??= item.definition.id;
                return value;
            } catch (error) {
                failure = {extension: item.definition.id, code: "invalid-output", phase: first === null ? "before" : "after", error};
            }
        } else if (result.kind === "threw") {
            if (typeof result.error === "object" && result.error !== null && innerErrors.has(result.error)) throw result.error;
            failure = {extension: item.definition.id, code: "threw", phase: first === null ? "before" : "after", error: result.error};
        } else {
            failure = {extension: item.definition.id, code: "timeout", phase: first === null ? "before" : "after"};
        }
        failures.push(failure);
        const policy = options.onFailure(item, failure);
        if (policy.kind === "result") return policy.value;
        if (first === null) return call(index + 1, input);
        // 之后出错：用里层的输出（里层可能还没完成，例如这一层没等 `next` 就抛了）。
        return inner === null ? first : (inner as {value: O}).value;
    };

    const value = await call(0, options.input);
    return {value, failures, stoppedBy};
}

/** 链的失败变成 `extensionFailed`（与这次的结果同批写）并留诊断（runtime.md 输出 21）。 */
export function failureDrafts(core: SessionCore, entry: Extract<EntryPoint, `intercept.${string}`>, failures: readonly ChainFailure[]): EventDraft[] {
    return failures.map((failure) => {
        core.diagnostics.add({
            code: "intercept-threw",
            extension: failure.extension,
            entry,
            subject: failure.code,
            params: {code: failure.code, phase: failure.phase},
            message: `${entry} of ${failure.extension} ${failure.code === "timeout" ? "timed out" : failure.code === "invalid-output" ? "returned an invalid value" : "threw"} ${failure.phase === "before" ? "before" : "after"} calling next`,
            ...(failure.error === undefined ? {} : {cause: failure.error}),
            persisted: true,
        }, core.head);
        return {type: "extensionFailed", kind: "ctrl", scope: "path", data: {extension: failure.extension, entry, code: failure.code}};
    });
}
