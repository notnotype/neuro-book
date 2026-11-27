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
    /**
     * 最近会话（conversation.md 输出 57 的“最近会话”：顶层、未归档、本作品范围，按最近活动；`createRecentSessions`），不受会话面板的搜索与过滤影响。
     * 视图段按高度从末尾截，这里最多交 `RECENT_LIMIT` 个。
     */
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
    /**
     * 最近会话什么时候重取（输出 57 的“最近会话”）：视图段画出来（`shown` 变真）、换了会话（新建、选中）、会话面板的列表变了（`listed`：
     * 面板里改名、归档与恢复之后它会重取）、窗口回到前台，以及画着时每 15 秒一次。交回停掉的函数。
     */
    watchRecent(watch: RecentWatch): () => void;
}

export interface RecentWatch {
    readonly shown: () => boolean;
    readonly focused: () => boolean;
    /** 会话面板那份列表：换了对象就说明它重取过。 */
    readonly listed: () => unknown;
    readonly refresh: () => void;
    /** 定时器；缺省 `setInterval`。 */
    readonly every?: (milliseconds: number, run: () => void) => () => void;
}

/** 视图段至多画这么多个最近会话（按高度再截）。 */
export const RECENT_LIMIT = 20;
/** 画着时隔多久重取一次：同会话面板（`SessionPanelHost.vue`）。 */
export const RECENT_POLL_MS = 15_000;

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
        .slice(0, RECENT_LIMIT)
        .map((item) => ({id: item.id, title: item.title || options.texts.untitled(), icon: item.icon ?? "i-lucide-bot"})));

    function watchRecent(recent: RecentWatch): () => void {
        const every = recent.every ?? ((milliseconds, run) => {
            const timer = setInterval(run, milliseconds);
            return () => clearInterval(timer);
        });
        let stopPolling: (() => void) | null = null;
        const stopShown = watch(recent.shown, (shown) => {
            stopPolling?.();
            stopPolling = null;
            if (!shown) return;
            recent.refresh();
            stopPolling = every(RECENT_POLL_MS, recent.refresh);
        }, {immediate: true});
        // 画着时才跟：没画出来时下一次画出来会重取。
        const stopChanges = watch([() => host.sessionId.value, recent.listed], () => {
            if (recent.shown()) recent.refresh();
        });
        const stopFocus = watch(recent.focused, (focused) => {
            if (focused && recent.shown()) recent.refresh();
        });
        return () => {
            stopShown();
            stopChanges();
            stopFocus();
            stopPolling?.();
            stopPolling = null;
        };
    }

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
        watchRecent,
    };
}
