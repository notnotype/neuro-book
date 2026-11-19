/**
 * bot 视图在窗口里的数据（docs/specs/bots/view.md）：bot 列表（先订阅 `botsChanged` 再取 `list`，`onResync` 重取）、模型服务有没有
 * 服务商（判“没有模型”），以及取主对话与记“看到”。入口启动时就开始，视图没打开时活动栏的计数照样更新。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {modelsSettingsContract} from "nbook/plugins/models/shared/contracts";

import type {BotItem, botsContract} from "../shared/contracts";

export type EnsureResult = {readonly ok: true; readonly sessionId: string} | {readonly ok: false; readonly code: string};

export interface BotsStore {
    readonly items: ShallowRef<readonly BotItem[]>;
    /** 一家服务商都没有：true；有：false；模型服务不在或还没读到：null。 */
    readonly noModel: ShallowRef<boolean | null>;
    ensureMain(botId: string): Promise<EnsureResult>;
    /** 看到了 `through`（组件已经画出来的日志 seq）；比已存的小、或没有未读时不发。 */
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
    const noModel = shallowRef<boolean | null>(null);
    /** 每个 bot 最近交过的 `through`：同一个值不重复发。 */
    const asked = new Map<string, number>();

    const refresh = async (): Promise<void> => {
        const listed = await options.bots.list({});
        if (listed.ok) items.value = listed.value;
        else options.report("list-failed", listed.code);
    };

    void (async () => {
        const subscribed = await options.bots.events.botsChanged.subscribe({}, (payload) => {
            items.value = payload;
        }, {onResync: () => void refresh()});
        if (!subscribed.ok) {
            options.report("subscribe-failed", subscribed.code);
            return;
        }
        options.signal.addEventListener("abort", () => subscribed.value.release(), {once: true});
        await refresh();
    })();

    if (options.models !== null) {
        const models = options.models;
        void (async () => {
            const subscribed = await models.events.changed.subscribe({}, (snapshot) => {
                noModel.value = snapshot.providers.length === 0;
            });
            if (!subscribed.ok) return;
            options.signal.addEventListener("abort", () => subscribed.value.release(), {once: true});
            const snapshot = await models.snapshot({});
            if (snapshot.ok) noModel.value = snapshot.value.providers.length === 0;
        })();
    }

    return {
        items,
        noModel,
        ensureMain: async (botId) => {
            const ensured = await options.bots.ensureMain({botId});
            return ensured.ok ? {ok: true, sessionId: ensured.value.sessionId} : {ok: false, code: ensured.code};
        },
        markSeen: (botId, through) => {
            const item = items.value.find((candidate) => candidate.id === botId);
            if (item === undefined || item.unread === 0 || through <= item.seenSeq || through <= (asked.get(botId) ?? 0)) return;
            asked.set(botId, through);
            void options.bots.markSeen({botId, through}).then((seen) => {
                if (!seen.ok) options.report("seen-failed", seen.code);
            });
        },
        openProviders: options.openProviders,
    };
}
