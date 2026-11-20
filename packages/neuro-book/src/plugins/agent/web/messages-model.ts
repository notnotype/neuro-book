/**
 * 消息视图的状态（docs/specs/agent/conversation.md 输出 1–3、53，docs/specs/bots/view.md）：联系人分段、选中项、标签、点联系人到聊天出现
 * 之间的那一段（没有模型、正在取主对话、取不到）与“看到”。不碰 DOM，组件（`MessagesHost.vue`）只把它画出来。
 */

import {computed, ref, shallowRef, watch} from "vue";
import type {ComputedRef, Ref, ShallowRef} from "vue";

import type {MessagesContactSection, MessagesRecentSession} from "@notnotype/nb-agent-ui";
import type {SessionOwner} from "@notnotype/nb-harness/kernel/contracts";

import type {SessionOwnerProvider} from "../shared/contracts";
import type {ActivityItem} from "../shared/remote";

/** 宿主里消息视图用到的那几样（`SessionHost` 的子集）。 */
export interface MessagesHostPart {
    readonly sessionId: Readonly<Ref<string | null>>;
    readonly shownSeq: Readonly<Ref<number>>;
    readonly owner: Readonly<Ref<SessionOwner | null | undefined>>;
    /** 每打开一次会话加一（`SessionHost.opened`）。 */
    readonly opened: Readonly<Ref<number>>;
    open(id: string): Promise<void>;
}

export interface MessagesModelOptions {
    readonly host: MessagesHostPart;
    readonly providers: () => readonly {readonly plugin: string; readonly provider: SessionOwnerProvider}[];
    readonly activity: () => readonly ActivityItem[];
    /** 有没有可用的模型：没有为 false，还没读到为 null。 */
    readonly hasModel: () => boolean | null;
    /** 根会话（按最近活动排、不受搜索与过滤影响）：头像列取前 5 个。 */
    readonly sessions: () => readonly {readonly id: string; readonly title: string; readonly icon?: string}[];
    /** 选会话（会话一页、头像列）。 */
    readonly selectSession: (id: string) => void;
    /** 文字：联系人读不到、未命名会话。 */
    readonly texts: {contactsFailed(code: string): string; untitled(): string};
}

export type PendingStep = "no-model" | "opening" | "failed";

export interface MessagesModel {
    readonly sections: ComputedRef<MessagesContactSection[]>;
    readonly selected: ComputedRef<{readonly kind: "contact"; readonly key: string} | {readonly kind: "session"; readonly id: string} | null>;
    readonly tab: Ref<"bot" | "sessions">;
    /** 点了联系人、聊天出现之前；聊天区显示着宿主的对话时为 null。 */
    readonly pending: ShallowRef<{readonly key: string; readonly name: string; readonly step: PendingStep; readonly code?: string} | null>;
    /** 没有打开会话、停在 bot 一页：不画会隐式新建的第一屏，写“选一个 bot”。 */
    readonly pickBot: ComputedRef<boolean>;
    readonly recentSessions: ComputedRef<MessagesRecentSession[]>;
    openContact(key: string): Promise<void>;
    openSession(id: string): void;
    /** 会话一页里选了会话或新建了：作废还在路上的联系人。 */
    sessionOpened(): void;
    retryContacts(plugin: string): void;
    /** 交“看到”：有归属的会话开着、`active`（视图可见且窗口有焦点）、没有盖层时，把已应用的 seq 交给它的归属插件。 */
    watchSeen(active: () => boolean): () => void;
}

const contactKey = (owner: {readonly plugin: string; readonly id: string}): string => `${owner.plugin}/${owner.id}`;

export function createMessagesModel(options: MessagesModelOptions): MessagesModel {
    const {host} = options;

    /** 在跑、等你处理按活动算，按会话树的根：主对话空闲、子代理在跑或在等，也算这个 bot 在跑或在等。 */
    const activityOf = (sessionId: string | null): "idle" | "running" | "waiting" => {
        if (sessionId === null) return "idle";
        const items = options.activity().filter((item) => item.root === sessionId);
        if (items.some((item) => item.state === "waiting")) return "waiting";
        return items.some((item) => item.state === "running") ? "running" : "idle";
    };

    const sections = computed((): MessagesContactSection[] => options.providers().map(({plugin, provider}) => {
        const state = provider.state.value;
        return {
            key: plugin,
            state: state.kind === "failed" ? {kind: "failed", message: options.texts.contactsFailed(state.code)} : state,
            contacts: provider.contacts.value.map((contact) => ({
                key: contactKey({plugin, id: contact.id}),
                name: contact.name,
                ...(contact.avatar === undefined ? {} : {avatar: contact.avatar}),
                unread: contact.unread,
                activity: activityOf(contact.sessionId),
                last: contact.last,
            })),
        };
    }));

    const pending = shallowRef<{readonly key: string; readonly name: string; readonly step: PendingStep; readonly code?: string} | null>(null);
    /** 每次点联系人或会话记一个号：点了别的之后，较早的 `open` 结果不再打开。 */
    let asking = 0;

    const contactOf = (key: string) => {
        for (const {plugin, provider} of options.providers()) {
            const contact = provider.contacts.value.find((candidate) => contactKey({plugin, id: candidate.id}) === key);
            if (contact !== undefined) return {plugin, provider, id: contact.id, name: contact.name, sessionId: contact.sessionId};
        }
        return null;
    };

    /** 作废还在路上的联系人、撤掉盖层：聊天区被别处换了（命令、新建、状态栏），或那个联系人的归属插件停了。 */
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
        if (pending.value !== null && contactOf(pending.value.key) === null) cancel();
    });

    async function openContact(key: string): Promise<void> {
        const found = contactOf(key);
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

    /** 标签只决定列表看哪一页；宿主打开的会话有没有归属定它（有归属切到 bot，否则会话）。 */
    const tab = ref<"bot" | "sessions">(host.owner.value ? "bot" : "sessions");
    watch(() => [host.sessionId.value, host.owner.value] as const, ([id, owner]) => {
        if (owner === undefined || id === null) return;
        tab.value = owner === null ? "sessions" : "bot";
    });

    const selected = computed(() => {
        if (pending.value !== null) return {kind: "contact" as const, key: pending.value.key};
        const owner = host.owner.value;
        if (owner) return {kind: "contact" as const, key: contactKey(owner)};
        const id = host.sessionId.value;
        return id === null ? null : {kind: "session" as const, id};
    });

    const pickBot = computed(() => pending.value === null && host.sessionId.value === null && tab.value === "bot");

    const recentSessions = computed((): MessagesRecentSession[] => options.sessions()
        .slice(0, 5)
        .map((item) => ({id: item.id, title: item.title || options.texts.untitled(), icon: item.icon ?? "i-lucide-bot"})));

    const sessionOpened = cancel;

    return {
        sections,
        selected,
        tab,
        pending,
        pickBot,
        recentSessions,
        openContact,
        openSession: (id) => {
            sessionOpened();
            options.selectSession(id);
        },
        sessionOpened,
        retryContacts: (plugin) => options.providers().find((entry) => entry.plugin === plugin)?.provider.reload(),
        watchSeen: (active) => watch(() => [host.owner.value, host.shownSeq.value, active(), pending.value] as const, ([owner, seq, isActive, waiting]) => {
            if (!owner || !isActive || waiting !== null || seq === 0) return;
            options.providers().find((entry) => entry.plugin === owner.plugin)?.provider.seen(owner.id, seq);
        }, {immediate: true}),
    };
}
