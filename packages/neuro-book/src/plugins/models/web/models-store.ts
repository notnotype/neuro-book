/**
 * 设置页的数据模块（docs/specs/models/settings-pages.md）：两页共用一份，持有服务端的快照、检测结果与写入，组件只是它的
 * 消费者。所有读写都经远程合同 `nbook.models/settings`；这里不翻译文字，失败交回码与详情，由组件按当前语言写原因。
 *
 * 寿命：浏览器入口激活时建，入口停用时 `dispose`。第一次显示任一页时 `start()` 订阅快照，之后一直订阅到入口停用；检测结果
 * 随之保留（换页面、关开设置窗口都在，刷新页面才没有）。
 */

import {reactive, readonly, shallowRef} from "vue";
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
    /** 服务端的快照；第一次取到之前为 null。 */
    readonly snapshot: Readonly<Ref<ModelsSnapshot | null>>;
    /** 远程合同可用；订阅失败或结束时为假，两页据此只读（输出 17）。 */
    readonly available: Readonly<Ref<boolean>>;
    readonly checks: ReadonlyMap<string, CheckState>;
    /** 订阅快照；重复调用不重复订阅。 */
    start(): Promise<void>;
    call<Name extends keyof Methods>(name: Name, input: Parameters<ModelsRemote[Name]>[0], options?: {readonly signal?: AbortSignal}): Promise<ModelsResult<ResultValue<Name>>>;
    /** 检测一个模型；进行中再点不重复发。`signal` 中止时结果不记。 */
    check(provider: string, model: string, signal?: AbortSignal): Promise<void>;
    checkAll(provider: string, signal?: AbortSignal): Promise<ModelsResult<null>>;
    dispose(): void;
}

type ResultValue<Name extends keyof Methods> = Extract<RemoteResultFor<Methods[Name]>, {readonly ok: true}>["value"];

export const checkKey = (provider: string, model: string): string => `${provider}/${model}`;

export function createModelsStore(remote: ModelsRemote, now: () => number = Date.now): ModelsStore {
    const snapshot = shallowRef<ModelsSnapshot | null>(null);
    const available = shallowRef(true);
    const checks = reactive(new Map<string, CheckState>());
    let started: Promise<void> | null = null;
    let subscription: RemoteSubscription | null = null;
    let disposed = false;

    const refresh = async (): Promise<void> => {
        const result = await remote.snapshot({});
        if (result.ok) snapshot.value = result.value;
    };

    const start = (): Promise<void> => {
        started ??= (async () => {
            const result = await remote.events.changed.subscribe({}, (payload) => {
                snapshot.value = payload;
            }, {
                // 重连后订阅已重建：重取一次，补上断开期间的变化。
                onResync: () => void refresh(),
                onEnd: () => {
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
            if (disposed) {
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

    const check = async (provider: string, model: string, signal?: AbortSignal): Promise<void> => {
        const key = checkKey(provider, model);
        if (checks.get(key)?.status === "running") return;
        const previous = checks.get(key);
        checks.set(key, {status: "running"});
        const result = await call("check", {provider, model}, {signal});
        if (signal?.aborted === true) {
            if (previous === undefined) checks.delete(key);
            else checks.set(key, previous);
            return;
        }
        checks.set(key, {status: "done", at: now(), result: result.ok ? result.value : {ok: false, kind: result.failure.code, code: null, raw: detailText(result.failure.detail)}});
    };

    const checkAll = async (provider: string, signal?: AbortSignal): Promise<ModelsResult<null>> => {
        const models = snapshot.value?.providers.find((item) => item.id === provider)?.models.filter((item) => item.enabled) ?? [];
        const previous = new Map(models.map((item) => [checkKey(provider, item.id), checks.get(checkKey(provider, item.id))]));
        for (const key of previous.keys()) checks.set(key, {status: "running"});
        const result = await call("checkAll", {provider}, {signal});
        const restore = (): void => {
            for (const [key, state] of previous) {
                if (state === undefined) checks.delete(key);
                else checks.set(key, state);
            }
        };
        if (signal?.aborted === true || !result.ok) {
            restore();
            return result.ok ? {ok: true, value: null} : result;
        }
        const at = now();
        for (const {model, result: outcome} of result.value) checks.set(checkKey(provider, model), {status: "done", at, result: outcome});
        // 服务端没检的（这期间被停用了）回到原样。
        for (const [key, state] of previous) {
            if (checks.get(key)?.status !== "running") continue;
            if (state === undefined) checks.delete(key);
            else checks.set(key, state);
        }
        return {ok: true, value: null};
    };

    return {
        snapshot: readonly(snapshot) as Readonly<Ref<ModelsSnapshot | null>>,
        available: readonly(available),
        checks,
        start,
        call,
        check,
        checkAll,
        dispose: () => {
            disposed = true;
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
