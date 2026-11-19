/**
 * 设置页“搜索与网页”的数据模块（docs/specs/web/settings-page.md）：持有密钥状态与检测状态，组件只是它的消费者。所有读写都经
 * 远程合同 `nbook.web-tools/settings`；这里不翻译文字，失败交回码与详情，由组件按当前语言写原因（同 `nbook.models`）。
 *
 * 寿命：浏览器入口激活时建，入口停用时 `dispose`。第一次显示页面时 `start()` 取一次状态；合同没有推送，之后的状态来自写入的
 * 返回值。检测结果放在这里，离开页面再回来还在（输出 8）。
 *
 * 先后（输出 8）：同一家的写入与检测排队，检测等这一家在途的写入结束再发。用户填完密钥直接点“检测”时，按下按钮先让输入框失焦、
 * 发出写入，紧接着的点击发检测；不排队的话检测读到的是写之前的文件，得 `no-key`。
 */

import {reactive, shallowRef} from "vue";
import type {Ref} from "vue";

import type {RemoteClient, RemoteResultFor} from "@notnotype/nb-runtime/remote";

import type {WebCheckResult, WebKeyStatus, WebProviderId, webSettingsContract} from "../shared/contracts";

type Contract = typeof webSettingsContract;
export type WebSettingsRemote = RemoteClient<Contract>;

/** 远程调用的失败：`code` 是合同的业务码或运行时码（`unavailable`、`unknown-outcome` 等），`detail` 原样。 */
export interface WebFailure {
    readonly code: string;
    readonly detail: unknown;
}

export type WebResult = {readonly ok: true} | {readonly ok: false; readonly failure: WebFailure};

export type CheckState =
    | {readonly status: "running"}
    | {readonly status: "done"; readonly result: WebCheckResult; readonly at: number}
    /** 没检成：远程调用本身失败或结果未知，不是密钥的检测失败。 */
    | {readonly status: "error"; readonly failure: WebFailure};

export interface SearchStore {
    /** 各家有没有密钥；第一次取到之前为 null（“读取中”）。 */
    readonly status: Readonly<Ref<WebKeyStatus | null>>;
    /** 取状态失败的原因（例如 `credentials-unavailable`）；没有为 null。 */
    readonly statusFailure: Readonly<Ref<WebFailure | null>>;
    /** 远程合同可用；某次调用得 `unavailable` 后为假，页面只读，下一次 `start` 重试。 */
    readonly available: Readonly<Ref<boolean>>;
    /** 各家的检测状态；没检过的不在里面。 */
    readonly checks: ReadonlyMap<WebProviderId, CheckState>;
    /** 取状态；已经取到且合同可用时不重复取。 */
    start(): Promise<void>;
    setKey(provider: WebProviderId, key: string): Promise<WebResult>;
    clearKey(provider: WebProviderId): Promise<WebResult>;
    /** 检测；这家正在检测时不重复发。 */
    check(provider: WebProviderId): Promise<void>;
    dispose(): void;
}

export function createSearchStore(remote: WebSettingsRemote, now: () => number = Date.now): SearchStore {
    const status = shallowRef<WebKeyStatus | null>(null);
    const statusFailure = shallowRef<WebFailure | null>(null);
    const available = shallowRef(true);
    const checks = reactive(new Map<WebProviderId, CheckState>());
    /** 每家在途的写入；检测先等它。 */
    const pendingWrites = new Map<WebProviderId, Promise<unknown>>();
    const controllers = new Set<AbortController>();
    let loaded = false;
    let disposed = false;

    const failed = (result: {readonly code: string; readonly detail?: unknown}): WebFailure => {
        if (result.code === "unavailable") available.value = false;
        return {code: result.code, detail: result.detail};
    };

    const refresh = async (): Promise<void> => {
        const result = await remote.status({});
        if (disposed) return;
        if (result.ok) {
            status.value = result.value;
            statusFailure.value = null;
            available.value = true;
            loaded = true;
            return;
        }
        statusFailure.value = failed(result);
    };

    const write = (provider: WebProviderId, send: () => Promise<RemoteResultFor<Contract["methods"]["setKey"]>>): Promise<WebResult> => {
        const run = (async (): Promise<WebResult> => {
            const result = await send();
            if (disposed) return result.ok ? {ok: true} : {ok: false, failure: {code: result.code, detail: result.detail}};
            if (result.ok) {
                status.value = result.value;
                statusFailure.value = null;
                // 只清掉旧的结果：排在这次写入后面的检测已经标成进行中，它结束时自己写结果。
                if (checks.get(provider)?.status !== "running") checks.delete(provider);
                return {ok: true};
            }
            // 写请求发出后结果未知：可能已经写了，重取状态，界面以服务端为准。
            if (result.code === "unknown-outcome") void refresh();
            return {ok: false, failure: failed(result)};
        })();
        pendingWrites.set(provider, run);
        void run.finally(() => {
            if (pendingWrites.get(provider) === run) pendingWrites.delete(provider);
        });
        return run;
    };

    return {
        status,
        statusFailure,
        available,
        checks,
        start: async () => {
            if (disposed || (loaded && available.value)) return;
            await refresh();
        },
        setKey: (provider, key) => write(provider, () => remote.setKey({provider, key})),
        clearKey: (provider) => write(provider, () => remote.clearKey({provider})),
        check: async (provider) => {
            if (checks.get(provider)?.status === "running") return;
            checks.set(provider, {status: "running"});
            await pendingWrites.get(provider);
            const controller = new AbortController();
            controllers.add(controller);
            const result = await remote.check({provider}, {signal: controller.signal});
            controllers.delete(controller);
            if (disposed || controller.signal.aborted) return;
            checks.set(provider, result.ok ? {status: "done", result: result.value, at: now()} : {status: "error", failure: failed(result)});
        },
        dispose: () => {
            disposed = true;
            available.value = false;
            for (const controller of controllers) controller.abort();
            controllers.clear();
        },
    };
}

/** 业务失败的详情多是 `{detail: string}`；拿不到时为空。 */
export function detailText(detail: unknown): string {
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail !== null && "detail" in detail && typeof (detail as {detail: unknown}).detail === "string") return (detail as {detail: string}).detail;
    return "";
}
