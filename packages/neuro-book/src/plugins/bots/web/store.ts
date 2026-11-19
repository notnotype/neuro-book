/**
 * bot 视图在窗口里的数据（docs/specs/bots/view.md）：bot 列表（先订阅 `botsChanged` 再取 `list`，`onResync` 重取）、模型服务有没有
 * 服务商（判“没有模型”），以及取主对话与记“看到”。入口启动时就开始，视图没打开时面板头的计数照样更新。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {modelsSettingsContract} from "nbook/plugins/models/shared/contracts";

import type {BotItem, botsContract} from "../shared/contracts";

export type EnsureResult = {readonly ok: true; readonly sessionId: string} | {readonly ok: false; readonly code: string};

/** bot 列表读到没有：订阅或 `list` 失败时是 `failed`，`reload` 重来。 */
export type ListState = {readonly kind: "loading"} | {readonly kind: "ready"} | {readonly kind: "failed"; readonly code: string};

export interface BotsStore {
    readonly items: ShallowRef<readonly BotItem[]>;
    readonly listState: ShallowRef<ListState>;
    /**
     * 一家服务商都没有：true；有、或者没装模型服务（对话里有它自己的提示）：false；模型服务在、还没读到：null。读不到（订阅或快照
     * 失败）按 false：不拦着用户，对话里的模型提示兜底。
     */
    readonly noModel: ShallowRef<boolean | null>;
    /** 重新订阅并读 bot 列表（列表读失败后的“重试”）。 */
    reload(): void;
    ensureMain(botId: string): Promise<EnsureResult>;
    /** 看到了 `through`（组件已经画出来的日志 seq）。 */
    markSeen(botId: string, through: number): void;
    openProviders(): void;
}

export interface BotsStoreOptions {
    readonly bots: RemoteClient<typeof botsContract>;
    /** 模型服务的设置合同；没装模型服务时为 null。 */
    readonly models: RemoteClient<typeof modelsSettingsContract> | null;
    readonly openProviders: () => void;
    readonly report: (code: string, message: string) => void;
    readonly signal: AbortSignal;
}

export function createBotsStore(options: BotsStoreOptions): BotsStore {
    const items = shallowRef<readonly BotItem[]>([]);
    const listState = shallowRef<ListState>({kind: "loading"});
    const noModel = shallowRef<boolean | null>(options.models === null ? false : null);

    /**
     * 看到：`shown` 记每个 bot 组件报来的最大 seq，`inflight` 记正在发的那个。发不发由当前的列表项决定：有未读、`shown` 超过已存的
     * `seenSeq` 才发；未读还没数完（`unread` 为 null，服务端在补数）不发，等列表项更新再判，否则服务端按补数前的 `latestSeq` 截短、
     * 这一次就白发了。每次列表项更新都重判一遍，所以发失败了、或发的时候列表还没跟上，下一次更新会补上，不靠下一条消息。
     */
    const shown = new Map<string, number>();
    const inflight = new Map<string, number>();
    const flushSeen = (botId: string): void => {
        const through = shown.get(botId);
        const item = items.value.find((candidate) => candidate.id === botId);
        if (through === undefined || item === undefined || item.unread === null || item.unread === 0 || through <= item.seenSeq) return;
        if ((inflight.get(botId) ?? 0) >= through) return;
        inflight.set(botId, through);
        void options.bots.markSeen({botId, through}).then((seen) => {
            inflight.delete(botId);
            if (!seen.ok) options.report("seen-failed", seen.code);
            // 发的时候又看到了更后面的：接着发。
            else if ((shown.get(botId) ?? 0) > through) flushSeen(botId);
        });
    };
    const setItems = (next: readonly BotItem[]): void => {
        items.value = next;
        for (const botId of shown.keys()) flushSeen(botId);
    };

    const refresh = async (): Promise<void> => {
        const listed = await options.bots.list({});
        if (listed.ok) {
            setItems(listed.value);
            listState.value = {kind: "ready"};
        } else {
            options.report("list-failed", listed.code);
            listState.value = {kind: "failed", code: listed.code};
        }
    };

    let release: (() => void) | null = null;
    const subscribe = async (): Promise<void> => {
        listState.value = {kind: "loading"};
        const subscribed = await options.bots.events.botsChanged.subscribe({}, (payload) => setItems(payload), {onResync: () => void refresh()});
        if (!subscribed.ok) {
            options.report("subscribe-failed", subscribed.code);
            listState.value = {kind: "failed", code: subscribed.code};
            return;
        }
        release = () => subscribed.value.release();
        await refresh();
    };
    options.signal.addEventListener("abort", () => release?.(), {once: true});
    void subscribe();

    if (options.models !== null) {
        const models = options.models;
        void (async () => {
            const subscribed = await models.events.changed.subscribe({}, (snapshot) => {
                noModel.value = snapshot.providers.length === 0;
            });
            if (!subscribed.ok) {
                options.report("models-unavailable", subscribed.code);
                noModel.value = false;
                return;
            }
            options.signal.addEventListener("abort", () => subscribed.value.release(), {once: true});
            const snapshot = await models.snapshot({});
            if (snapshot.ok) noModel.value = snapshot.value.providers.length === 0;
            else {
                options.report("models-unavailable", snapshot.code);
                noModel.value ??= false;
            }
        })();
    }

    return {
        items,
        listState,
        noModel,
        reload: () => {
            // 订阅还在（`list` 失败）只重读；订阅失败了就重新订阅。
            if (release !== null) {
                listState.value = {kind: "loading"};
                void refresh();
            } else void subscribe();
        },
        ensureMain: async (botId) => {
            const ensured = await options.bots.ensureMain({botId});
            return ensured.ok ? {ok: true, sessionId: ensured.value.sessionId} : {ok: false, code: ensured.code};
        },
        markSeen: (botId, through) => {
            // 同一个 seq 再报一次（窗口重新拿到焦点）也重判：上一次可能发失败了。
            shown.set(botId, Math.max(through, shown.get(botId) ?? 0));
            flushSeen(botId);
        },
        openProviders: options.openProviders,
    };
}
