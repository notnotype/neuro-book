/**
 * 网络页的数据模块（docs/specs/network/egress.md 的“网络页”）：现在的选路说明、“测试代理”的状态，以及模型服务的在线目录状态。
 * 选路与测试经 `nbook.network/settings`，目录经 `nbook.models/settings`（快照的 `catalog`、`refreshCatalog`）；这里不翻译文字，
 * 失败交回码，由页面按当前语言写原因。
 *
 * 寿命：浏览器入口激活时建，入口停用时 `dispose`（取消在途的测试、退订）。页面挂载时 `start()`，卸载时 `cancelTest()`：离开页面
 * 不留一个在后台跑的测试。
 *
 * 先后：说明与测试各带一个序号，旧的回来晚了不覆盖新的（改了代理方式后马上又改一次）。
 */

import {shallowRef} from "vue";
import type {Ref} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {CatalogState} from "@notnotype/nb-models/contract";

import type {modelsSettingsContract} from "nbook/plugins/models/shared/contracts";

import type {EgressSummaryView, EgressTestView, networkSettingsContract} from "../shared/contracts";

export type NetworkRemote = RemoteClient<typeof networkSettingsContract>;
export type CatalogRemote = RemoteClient<typeof modelsSettingsContract>;

/** 说明取不到的时限：读系统设置最多 2 秒，再留出往返。 */
export const DESCRIBE_TIMEOUT_MS = 5000;

export type SummaryState =
    | {readonly status: "loading"}
    | {readonly status: "ready"; readonly summary: EgressSummaryView}
    /** `code` 是远程调用的失败码（`unavailable`、`timeout` 等）。 */
    | {readonly status: "failed"; readonly code: string};

export type TestState =
    | {readonly status: "idle"}
    | {readonly status: "running"}
    | {readonly status: "done"; readonly result: EgressTestView}
    /** 没测成：远程调用本身失败（不是代理的失败）。 */
    | {readonly status: "error"; readonly code: string};

export type CatalogRefresh = {readonly ok: true} | {readonly ok: false; readonly code: string};

export interface NetworkStore {
    readonly summary: Readonly<Ref<SummaryState>>;
    readonly test: Readonly<Ref<TestState>>;
    /** 在线目录的状态；还没收到快照，或模型服务的合同不可用时为 null。 */
    readonly catalog: Readonly<Ref<CatalogState | null>>;
    /** 模型服务的合同可用（订阅建好了）。 */
    readonly catalogAvailable: Readonly<Ref<boolean>>;
    /** 订阅在线目录的状态并取一次说明；重复调用只订阅一次。 */
    start(): void;
    /** 重取选路说明（改了代理设置之后）。 */
    describe(): Promise<void>;
    runTest(): Promise<void>;
    cancelTest(): void;
    /** 清掉上一次测试的结果（代理设置变了，旧结果不再说明现在的路）；在跑的取消。 */
    resetTest(): void;
    refreshCatalog(): Promise<CatalogRefresh>;
    dispose(): void;
}

export function createNetworkStore(network: NetworkRemote, models: CatalogRemote): NetworkStore {
    const summary = shallowRef<SummaryState>({status: "loading"});
    const test = shallowRef<TestState>({status: "idle"});
    const catalog = shallowRef<CatalogState | null>(null);
    const catalogAvailable = shallowRef(false);
    let describing = 0;
    let testing = 0;
    let controller: AbortController | null = null;
    let subscribing: Promise<void> | null = null;
    let subscription: {release(): void} | null = null;
    let disposed = false;

    const describe = async (): Promise<void> => {
        const token = (describing += 1);
        const result = await network.describe({}, {signal: AbortSignal.timeout(DESCRIBE_TIMEOUT_MS)});
        if (disposed || token !== describing) return;
        summary.value = result.ok ? {status: "ready", summary: result.value} : {status: "failed", code: result.code};
    };

    const subscribe = (): Promise<void> => {
        subscribing ??= (async () => {
            let ended = false;
            const result = await models.events.changed.subscribe({}, (payload) => {
                if (!disposed) catalog.value = payload.catalog;
            }, {
                onEnd: () => {
                    ended = true;
                    catalogAvailable.value = false;
                    catalog.value = null;
                    // 下一次显示页面时重新订阅（服务端入口重启之后）。
                    subscribing = null;
                    subscription = null;
                },
            });
            if (!result.ok) {
                catalogAvailable.value = false;
                subscribing = null;
                return;
            }
            if (disposed || ended) {
                result.value.release();
                return;
            }
            subscription = result.value;
            catalogAvailable.value = true;
        })();
        return subscribing;
    };

    const cancelTest = (): void => {
        controller?.abort();
        controller = null;
        testing += 1;
        if (test.value.status === "running") test.value = {status: "idle"};
    };

    return {
        summary,
        test,
        catalog,
        catalogAvailable,
        start: () => {
            if (disposed) return;
            void subscribe();
            void describe();
        },
        describe,
        runTest: async () => {
            if (disposed || test.value.status === "running") return;
            const token = (testing += 1);
            const own = new AbortController();
            controller = own;
            test.value = {status: "running"};
            const result = await network.test({}, {signal: own.signal});
            if (disposed || token !== testing) return;
            controller = null;
            test.value = result.ok ? {status: "done", result: result.value} : {status: "error", code: result.code};
        },
        cancelTest,
        resetTest: () => {
            cancelTest();
            test.value = {status: "idle"};
        },
        refreshCatalog: async () => {
            const result = await models.refreshCatalog({});
            return result.ok ? {ok: true} : {ok: false, code: result.code};
        },
        dispose: () => {
            disposed = true;
            controller?.abort();
            subscription?.release();
            subscription = null;
        },
    };
}
