/**
 * 消息视图的状态（docs/specs/agent/conversation.md 输出 1–3、53，docs/specs/bots/view.md）：联系人分段、选中项与标签。点联系人到聊天
 * 出现之间的那一段与“看到”在 `contact-opener.ts`。不碰 DOM，组件（`MessagesHost.vue`）只把它画出来。
 */

import {computed, ref, watch} from "vue";
import type {ComputedRef, Ref, ShallowRef} from "vue";

import type {MessagesContactSection, MessagesRecentSession} from "@notnotype/nb-agent-ui";

import {contactKey, createContactOpener} from "./contact-opener";
import type {ContactOpenerOptions, PendingContact} from "./contact-opener";

export interface MessagesModelOptions extends ContactOpenerOptions {
    /** 根会话（按最近活动排、不受搜索与过滤影响）：头像列取前 5 个。 */
    readonly sessions: () => readonly {readonly id: string; readonly title: string; readonly icon?: string}[];
    /** 选会话（会话一页、头像列）。 */
    readonly selectSession: (id: string) => void;
    /** 文字：联系人读不到、未命名会话。 */
    readonly texts: {contactsFailed(code: string): string; untitled(): string};
}

export interface MessagesModel {
    readonly sections: ComputedRef<MessagesContactSection[]>;
    readonly selected: ComputedRef<{readonly kind: "contact"; readonly key: string} | {readonly kind: "session"; readonly id: string} | null>;
    readonly tab: Ref<"bot" | "sessions">;
    /** 点了联系人、聊天出现之前；聊天区显示着宿主的对话时为 null。 */
    readonly pending: ShallowRef<PendingContact | null>;
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

export function createMessagesModel(options: MessagesModelOptions): MessagesModel {
    const {host} = options;
    const opener = createContactOpener(options);
    const {pending} = opener;

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
                activity: opener.activityOf(contact.sessionId),
                last: contact.last,
            })),
        };
    }));

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

    return {
        sections,
        selected,
        tab,
        pending,
        pickBot,
        recentSessions,
        openContact: opener.openContact,
        openSession: (id) => {
            opener.cancel();
            options.selectSession(id);
        },
        sessionOpened: opener.cancel,
        retryContacts: (plugin) => options.providers().find((entry) => entry.plugin === plugin)?.provider.reload(),
        watchSeen: opener.watchSeen,
    };
}
