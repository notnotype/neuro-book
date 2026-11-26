/**
 * 设置页“搜索与网页”的数据模块（docs/specs/web/settings-page.md）：持有密钥状态与检测状态，组件只是它的消费者。所有读写都经
 * 远程合同 `nbook.web/settings`；这里不翻译文字，失败交回码与详情，由组件按当前语言写原因（同 `nbook.models`）。
 *
 * 寿命：浏览器入口激活时建，入口停用时 `dispose`。第一次显示页面时 `start()` 取一次状态；合同没有推送，之后的状态来自写入的
 * 返回值。检测结果放在这里，离开页面再回来还在（输出 8）。
 *
 * 先后（输出 8）：同一家的写入与检测排队，检测等这一家在途的写入结束再发。用户填完密钥直接点“检测”时，按下按钮先让输入框失焦、
 * 发出写入，紧接着的点击发检测；不排队的话检测读到的是写之前的文件，得 `no-key`。反过来，检测已经发出、之后又有写入成功，
 * 那次检测用的是旧密钥：写入成功时取消它、清掉状态，不让旧密钥的结果显示在新密钥下面。
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
    /** 远程合同可用；某次调用得 `unavailable`，或取状态因密钥文件以外的原因失败后为假，页面只读，下一次 `start` 重试。 */
    readonly available: Readonly<Ref<boolean>>;
    /** 各家的检测状态；没检过的不在里面。 */
    readonly checks: ReadonlyMap<WebProviderId, CheckState>;
    /** 有写入在途的各家。页面在这时也让“检测”可点：按下按钮让框失焦交出密钥、框随即清空，紧接着的点击要落在可点的按钮上。 */
    readonly writing: ReadonlySet<WebProviderId>;
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
    const writing = reactive(new Set<WebProviderId>());
    /** 每家在途的写入；检测先等它。 */
    const pendingWrites = new Map<WebProviderId, Promise<unknown>>();
    /** 每家已经发出、还没回来的检测；同一家同时只有一个（进行中不重复发）。 */
    const sentChecks = new Map<WebProviderId, AbortController>();
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
        // 密钥文件读不了时页面照常可写（写入会覆盖它）；其余失败（入口在请求途中停了得 target-gone、超时等）都说明这次没连上
        // 服务端，按只读画并写原因，下一次 start 重试，不停在没有文字的“读取中”。
        if (result.code !== "credentials-unavailable") available.value = false;
    };

    const write = (provider: WebProviderId, send: () => Promise<RemoteResultFor<Contract["methods"]["setKey"]>>): Promise<WebResult> => {
        const run = (async (): Promise<WebResult> => {
            const result = await send();
            if (disposed) return result.ok ? {ok: true} : {ok: false, failure: {code: result.code, detail: result.detail}};
            if (result.ok) {
                status.value = result.value;
                statusFailure.value = null;
                const sent = sentChecks.get(provider);
                if (sent !== undefined) {
                    // 已经发出的检测用的是旧密钥：取消，回到空闲。
                    sentChecks.delete(provider);
                    sent.abort();
                    checks.delete(provider);
                } else if (checks.get(provider)?.status !== "running") {
                    // 进行中而还没发出的，是排在这次写入后面的检测，发出时读到的就是新密钥，留着。
                    checks.delete(provider);
                }
                return {ok: true};
            }
            // 写请求发出后结果未知：可能已经写了，重取状态，界面以服务端为准。
            if (result.code === "unknown-outcome") void refresh();
            return {ok: false, failure: failed(result)};
        })();
        pendingWrites.set(provider, run);
        writing.add(provider);
        void run.finally(() => {
            if (pendingWrites.get(provider) !== run) return;
            pendingWrites.delete(provider);
            writing.delete(provider);
        });
        return run;
    };

    return {
        status,
        statusFailure,
        available,
        checks,
        writing,
        start: async () => {
            if (disposed || (loaded && available.value)) return;
            await refresh();
        },
        setKey: (provider, key) => write(provider, () => remote.setKey({provider, key})),
        clearKey: (provider) => write(provider, () => remote.clearKey({provider})),
        check: async (provider) => {
            if (disposed || checks.get(provider)?.status === "running") return;
            checks.set(provider, {status: "running"});
            await pendingWrites.get(provider);
            // 等写入的时候入口停用了：不再发（检测按次计费，停用之后没人能取消它）。
            if (disposed) return;
            const controller = new AbortController();
            sentChecks.set(provider, controller);
            const result = await remote.check({provider}, {signal: controller.signal});
            // 被取消的（入口停用、密钥改了）不写结果；取消它的一方已经从表里拿掉它，表里可能已是下一次检测。
            if (controller.signal.aborted || disposed) return;
            sentChecks.delete(provider);
            checks.set(provider, result.ok ? {status: "done", result: result.value, at: now()} : {status: "error", failure: failed(result)});
        },
        dispose: () => {
            disposed = true;
            available.value = false;
            for (const controller of sentChecks.values()) controller.abort();
            sentChecks.clear();
        },
    };
}

/** 业务失败的详情多是 `{detail: string}`；拿不到时为空。 */
export function detailText(detail: unknown): string {
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail !== null && "detail" in detail && typeof (detail as {detail: unknown}).detail === "string") return (detail as {detail: string}).detail;
    return "";
}
