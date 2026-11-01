/**
 * 设置页的数据模块（docs/specs/models/settings-pages.md）：两页共用一份，持有服务端的快照、检测结果与写入，组件只是它的
 * 消费者。所有读写都经远程合同 `nbook.models/settings`；这里不翻译文字，失败交回码与详情，由组件按当前语言写原因。
 *
 * 寿命：浏览器入口激活时建，入口停用时 `dispose`。第一次显示任一页时 `start()` 订阅快照，之后一直订阅到入口停用；检测结果
 * 随之保留（换页面、关开设置窗口都在，刷新页面才没有）。
 */

import {computed, reactive, shallowRef, toRaw} from "vue";
import type {Ref} from "vue";

import type {RemoteClient, RemoteResultFor, RemoteSubscription} from "@notnotype/nb-runtime/remote";

import type {CheckResult, ModelsSnapshot, modelsSettingsContract} from "../shared/contracts";

type Contract = typeof modelsSettingsContract;
export type ModelsRemote = RemoteClient<Contract>;
type Methods = Contract["methods"];

/** 写入或读取的失败：`code` 是远程合同的业务码或运行时码（`unavailable`、`unknown-outcome` 等），`detail` 原样。 */
export interface ModelsFailure {
    readonly code: string;
    readonly detail: unknown;
}

export type ModelsResult<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly failure: ModelsFailure};

/** 一个模型的检测状态；键是 `<服务商>/<模型>`。 */
export type CheckState =
    | {readonly status: "running"}
    | {readonly status: "done"; readonly result: CheckResult; readonly at: number};

export interface ModelsStore {
    /** 服务端的快照；第一次取到之前为 null。交出的是普通对象（不是只读代理），可以直接放进远程调用的载荷。 */
    readonly snapshot: Readonly<Ref<ModelsSnapshot | null>>;
    /** 远程合同可用；订阅失败、结束或数据模块释放后为假，两页据此只读（输出 17）。 */
    readonly available: Readonly<Ref<boolean>>;
    /** 模型的检测状态，键是 `<服务商>/<模型>`；服务商或模型从快照里消失时清掉。 */
    readonly checks: ReadonlyMap<string, CheckState>;
    /**
     * 按服务商记的“没检成”：远程调用本身失败（服务停了、服务商不在了、结果未知），不是模型的检测失败。这家下一次检测开始时清掉。
     */
    readonly checkErrors: ReadonlyMap<string, ModelsFailure>;
    /** 订阅快照；重复调用不重复订阅。 */
    start(): Promise<void>;
    call<Name extends keyof Methods>(name: Name, input: Parameters<ModelsRemote[Name]>[0], options?: {readonly signal?: AbortSignal}): Promise<ModelsResult<ResultValue<Name>>>;
    /** 检测一个模型；它正在检测（单独的或“检测全部”里的）时不重复发。 */
    check(provider: string, model: string): Promise<void>;
    /** 检测这家启用的模型；这家已有“检测全部”在跑时不重复发，正在单独检测的模型不重复检测。 */
    checkAll(provider: string): Promise<void>;
    /** 取消这家进行中的检测（给了模型只取消它的单独检测），检测状态回到开始之前。中止句柄在数据模块里，换页面回来照样能取消。 */
    cancel(provider: string, model?: string): void;
    dispose(): void;
}

type ResultValue<Name extends keyof Methods> = Extract<RemoteResultFor<Methods[Name]>, {readonly ok: true}>["value"];

export const checkKey = (provider: string, model: string): string => `${provider}/${model}`;

export function createModelsStore(remote: ModelsRemote, now: () => number = Date.now): ModelsStore {
    const snapshot = shallowRef<ModelsSnapshot | null>(null);
    const available = shallowRef(true);
    const checks = reactive(new Map<string, CheckState>());
    const checkErrors = reactive(new Map<string, ModelsFailure>());
    /** 进行中的检测：单独检测按 `<服务商>/<模型>`，“检测全部”按服务商 id。 */
    const controllers = new Map<string, AbortController>();
    let started: Promise<void> | null = null;
    let subscription: RemoteSubscription | null = null;
    let disposed = false;

    /** 换上新快照，清掉已经不在的服务商与模型的检测结果（同 id 重新加回来时不带出旧结果）。 */
    const apply = (next: ModelsSnapshot): void => {
        snapshot.value = next;
        const present = new Set(next.providers.flatMap((provider) => provider.models.map((model) => checkKey(provider.id, model.id))));
        for (const key of [...checks.keys()]) {
            if (present.has(key)) continue;
            controllers.get(key)?.abort();
            checks.delete(key);
        }
        for (const provider of [...checkErrors.keys()]) if (!next.providers.some((item) => item.id === provider)) checkErrors.delete(provider);
    };

    const refresh = async (): Promise<void> => {
        const result = await remote.snapshot({});
        if (result.ok && !disposed) apply(result.value);
    };

    const start = (): Promise<void> => {
        if (disposed) return Promise.resolve();
        started ??= (async () => {
            let ended = false;
            const result = await remote.events.changed.subscribe({}, (payload) => {
                if (!disposed) apply(payload);
            }, {
                // 重连后订阅已重建：重取一次，补上断开期间的变化。
                onResync: () => void refresh(),
                onEnd: () => {
                    ended = true;
                    available.value = false;
                    // 下一次显示页面时重新订阅（服务端入口重启之后）。
                    started = null;
                    subscription = null;
                },
            });
            if (!result.ok) {
                available.value = false;
                started = null;
                return;
            }
            // 迟到的订阅：释放之后才回来，或者回来之前已经结束了。
            if (disposed || ended) {
                result.value.release();
                return;
            }
            subscription = result.value;
            available.value = true;
        })();
        return started;
    };

    const call = async <Name extends keyof Methods>(name: Name, input: Parameters<ModelsRemote[Name]>[0], options: {readonly signal?: AbortSignal} = {}): Promise<ModelsResult<ResultValue<Name>>> => {
        const method = remote[name] as (input: unknown, options?: {readonly signal?: AbortSignal}) => Promise<RemoteResultFor<Methods[Name]>>;
        const result = await method(input, options.signal === undefined ? undefined : {signal: options.signal});
        if (result.ok) return {ok: true, value: result.value as ResultValue<Name>};
        // 写请求发出后结果未知：可能已经写了，重取快照，界面以服务端为准（输出 15）。
        if (result.code === "unknown-outcome") void refresh();
        return {ok: false, failure: {code: result.code, detail: result.detail}};
    };

    /**
     * 把一批模型标成进行中，交回收尾函数：`settle(key, state)` 只在这个键仍是自己标的那个 `running` 时才改（别的检测或快照清理
     * 已经改过就不动），`state` 为 undefined 时回到开始之前。
     */
    const begin = (keys: readonly string[]) => {
        const marks = new Map(keys.map((key) => [key, {previous: checks.get(key), mark: {status: "running"} as CheckState}]));
        for (const [key, {mark}] of marks) checks.set(key, mark);
        return (key: string, state: CheckState | undefined): void => {
            const entry = marks.get(key);
            // `checks` 是响应式的 Map，`get` 交回代理：比原对象。
            const currentState = checks.get(key);
            if (entry === undefined || currentState === undefined || toRaw(currentState) !== entry.mark) return;
            const next = state ?? entry.previous;
            if (next === undefined) checks.delete(key);
            else checks.set(key, next);
        };
    };

    const check = async (provider: string, model: string): Promise<void> => {
        const key = checkKey(provider, model);
        if (checks.get(key)?.status === "running") return;
        checkErrors.delete(provider);
        const settle = begin([key]);
        const controller = new AbortController();
        controllers.set(key, controller);
        const result = await call("check", {provider, model}, {signal: controller.signal});
        if (controllers.get(key) === controller) controllers.delete(key);
        if (controller.signal.aborted) return settle(key, undefined);
        if (!result.ok) {
            // 没检成（不是模型的检测失败）：回到原样，原因按服务商记。
            settle(key, undefined);
            checkErrors.set(provider, result.failure);
            return;
        }
        settle(key, {status: "done", at: now(), result: result.value});
    };

    const checkAll = async (provider: string): Promise<void> => {
        if (controllers.has(provider)) return;
        const keys = (snapshot.value?.providers.find((item) => item.id === provider)?.models ?? [])
            .filter((item) => item.enabled)
            .map((item) => checkKey(provider, item.id))
            .filter((key) => checks.get(key)?.status !== "running");
        if (keys.length === 0) return;
        checkErrors.delete(provider);
        const settle = begin(keys);
        const controller = new AbortController();
        controllers.set(provider, controller);
        const result = await call("checkAll", {provider}, {signal: controller.signal});
        if (controllers.get(provider) === controller) controllers.delete(provider);
        if (!controller.signal.aborted && result.ok) {
            const at = now();
            for (const {model, result: outcome} of result.value) settle(checkKey(provider, model), {status: "done", at, result: outcome});
        } else if (!controller.signal.aborted && !result.ok) {
            checkErrors.set(provider, result.failure);
        }
        // 中止、失败，或服务端没检的（这期间被停用了）：回到原样。
        for (const key of keys) settle(key, undefined);
    };

    const cancel = (provider: string, model?: string): void => {
        if (model !== undefined) {
            controllers.get(checkKey(provider, model))?.abort();
            return;
        }
        for (const [key, controller] of controllers) if (key === provider || key.startsWith(`${provider}/`)) controller.abort();
    };

    return {
        // 用 computed 交出原对象：`readonly()` 是深只读代理，放进载荷后 structuredClone 不了（Lab 的替身、进程内的传输）。
        snapshot: computed(() => snapshot.value),
        available: computed(() => available.value),
        checks,
        checkErrors,
        start,
        call,
        check,
        checkAll,
        cancel,
        dispose: () => {
            disposed = true;
            available.value = false;
            for (const controller of controllers.values()) controller.abort();
            subscription?.release();
            subscription = null;
        },
    };
}

/** 业务失败的详情多是 `{detail: string}`；拿不到时给码本身。 */
export function detailText(detail: unknown): string {
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail !== null && "detail" in detail && typeof (detail as {detail: unknown}).detail === "string") return (detail as {detail: string}).detail;
    return "";
}
