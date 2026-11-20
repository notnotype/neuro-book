/**
 * 点联系人到聊天出现之间的那一段（docs/specs/agent/conversation.md 输出 53，docs/specs/bots/view.md 输出 3、4）：取主对话、
 * 等模型、取不到时的盖层，与“看到”。消息视图（`messages-model.ts`）与书房的看板娘（`DeskCompanion.vue`）各用一份，各配自己的宿主。
 */

import {shallowRef, watch} from "vue";
import type {Ref, ShallowRef} from "vue";

import type {SessionOwner} from "@notnotype/nb-harness/kernel/contracts";

import type {SessionOwnerProvider} from "../shared/contracts";
import type {ActivityItem} from "../shared/remote";

/** 宿主里用到的那几样（`SessionHost` 的子集）。 */
export interface ContactHostPart {
    readonly sessionId: Readonly<Ref<string | null>>;
    readonly shownSeq: Readonly<Ref<number>>;
    readonly owner: Readonly<Ref<SessionOwner | null | undefined>>;
    /** 每打开一次会话加一（`SessionHost.opened`）。 */
    readonly opened: Readonly<Ref<number>>;
    open(id: string): Promise<void>;
}

export interface ContactOpenerOptions {
    readonly host: ContactHostPart;
    readonly providers: () => readonly {readonly plugin: string; readonly provider: SessionOwnerProvider}[];
    readonly activity: () => readonly ActivityItem[];
    /** 有没有可用的模型：没有为 false，还没读到为 null。 */
    readonly hasModel: () => boolean | null;
}

export type PendingStep = "no-model" | "opening" | "failed";

export interface PendingContact {
    readonly key: string;
    readonly name: string;
    readonly step: PendingStep;
    readonly code?: string;
}

export interface FoundContact {
    readonly plugin: string;
    readonly provider: SessionOwnerProvider;
    readonly id: string;
    readonly name: string;
    readonly sessionId: string | null;
}

export interface ContactOpener {
    /** 点了联系人、聊天出现之前；聊天区显示着宿主的对话时为 null。 */
    readonly pending: ShallowRef<PendingContact | null>;
    /** 在跑、等你处理按活动算，按会话树的根：主对话空闲、子代理在跑或在等，也算这个联系人在跑或在等。 */
    activityOf(sessionId: string | null): "idle" | "running" | "waiting";
    find(key: string): FoundContact | null;
    openContact(key: string): Promise<void>;
    /** 作废还在路上的联系人、撤掉盖层。 */
    cancel(): void;
    /** 交“看到”：有归属的会话开着、`active`、没有盖层时，把已应用的 seq 交给它的归属插件。 */
    watchSeen(active: () => boolean): () => void;
}

/** 联系人的键：归属插件与它给的 id。 */
export const contactKey = (owner: {readonly plugin: string; readonly id: string}): string => `${owner.plugin}/${owner.id}`;

export function createContactOpener(options: ContactOpenerOptions): ContactOpener {
    const {host} = options;

    const activityOf = (sessionId: string | null): "idle" | "running" | "waiting" => {
        if (sessionId === null) return "idle";
        const items = options.activity().filter((item) => item.root === sessionId);
        if (items.some((item) => item.state === "waiting")) return "waiting";
        return items.some((item) => item.state === "running") ? "running" : "idle";
    };

    const find = (key: string): FoundContact | null => {
        for (const {plugin, provider} of options.providers()) {
            const contact = provider.contacts.value.find((candidate) => contactKey({plugin, id: candidate.id}) === key);
            if (contact !== undefined) return {plugin, provider, id: contact.id, name: contact.name, sessionId: contact.sessionId};
        }
        return null;
    };

    const pending = shallowRef<PendingContact | null>(null);
    /** 每次点联系人或别处换会话记一个号：点了别的之后，较早的 `open` 结果不再打开。 */
    let asking = 0;

    function cancel(): void {
        asking += 1;
        pending.value = null;
    }
    /** 自己正在 `host.open` 的那一次：它引起的打开不算“被别处换了”。 */
    let opening = false;
    // 同步回调：异步的话回调跑的时候 `opening` 已经复位，自己打开的那一次会被当成别处换的。
    watch(() => host.opened.value, () => {
        if (!opening && pending.value !== null) cancel();
    }, {flush: "sync"});
    watch(() => options.providers(), () => {
        if (pending.value !== null && find(pending.value.key) === null) cancel();
    });

    async function openContact(key: string): Promise<void> {
        const found = find(key);
        if (found === null) return;
        // 已经开着它的主对话：什么都不用做（再开一次会整段重载，滚动与“看到”都断一下）。
        if (pending.value === null && found.sessionId !== null && host.sessionId.value === found.sessionId) return;
        const asked = (asking += 1);
        // 没有模型不取主对话（bots/view.md）：建了也聊不了。还没读到时先等，读到再说（见下面的 watch）。
        const model = options.hasModel();
        if (model !== true) {
            pending.value = {key, name: found.name, step: model === false ? "no-model" : "opening"};
            return;
        }
        pending.value = {key, name: found.name, step: "opening"};
        const opened = await found.provider.open(found.id);
        if (asked !== asking) return;
        if (!opened.ok) {
            pending.value = {key, name: found.name, step: "failed", code: opened.code};
            return;
        }
        opening = true;
        try {
            await host.open(opened.sessionId);
        } finally {
            opening = false;
        }
        if (asked === asking) pending.value = null;
    }

    // 模型读到了、或配好了：停在等模型上的那个联系人接着打开。
    watch(() => options.hasModel(), (model) => {
        const waiting = pending.value;
        if (waiting === null || waiting.step === "failed") return;
        if (model === true) void openContact(waiting.key);
        else if (model === false && waiting.step === "opening") pending.value = {...waiting, step: "no-model"};
    });

    return {
        pending,
        activityOf,
        find,
        openContact,
        cancel,
        watchSeen: (active) => watch(() => [host.owner.value, host.shownSeq.value, active(), pending.value] as const, ([owner, seq, isActive, waiting]) => {
            if (!owner || !isActive || waiting !== null || seq === 0) return;
            options.providers().find((entry) => entry.plugin === owner.plugin)?.provider.seen(owner.id, seq);
        }, {immediate: true}),
    };
}
