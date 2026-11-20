<script setup lang="ts">
/**
 * “消息”视图的外框（同名 .md）：列表、头像列、聊天区各一份 DOM，按 `layout` 只改位置与显隐，聊天区在宽窄之间不重挂。
 * 抽屉是视图里自己画的一块（非模态），不用 nb-ui 的 `Drawer`：那个传送到页面、整页模态，会盖住整个工作台。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";

import type {AgentLocale, MessagesContactSection, MessagesRecentSession} from "../../types";
import {provideAgentText} from "../text";
import AgentMessagesList from "./AgentMessagesList.vue";

const props = withDefaults(defineProps<{
    layout: "wide" | "narrow";
    listCollapsed: boolean;
    drawerOpen: boolean;
    tab: "bot" | "sessions";
    sections: readonly MessagesContactSection[];
    selected: {readonly kind: "contact"; readonly key: string} | {readonly kind: "session"; readonly id: string} | null;
    recentSessions: readonly MessagesRecentSession[];
    drawerAnchor?: HTMLElement | null;
    now: number;
    locale?: AgentLocale;
}>(), {drawerAnchor: null, locale: undefined});

const emit = defineEmits<{
    "update:listCollapsed": [collapsed: boolean];
    "update:drawerOpen": [open: boolean];
    "update:tab": [tab: "bot" | "sessions"];
    "open-contact": [key: string];
    "retry-contacts": [sectionKey: string];
    "open-session": [id: string];
}>();

defineSlots<{default(): unknown; sessions(): unknown}>();

const {t} = provideAgentText(() => props.locale);

const rootRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
/** 头像列顶上的按钮。`IconButton` 外面包着悬停提示，组件实例的根不一定是按钮，按标记在外框里找。 */
const toggleEl = (): HTMLElement | null => rootRef.value?.querySelector<HTMLElement>("[data-messages-toggle]") ?? null;

const wide = computed(() => props.layout === "wide");
/** 头像列：窄版，或宽版收起了列表栏。 */
const showStrip = computed(() => !wide.value || props.listCollapsed);
/** 列表显示着：宽版是列表栏，窄版是抽屉。 */
const listShown = computed(() => (wide.value ? !props.listCollapsed : props.drawerOpen));
const contacts = computed(() => props.sections.flatMap((section) => section.contacts));
const selectedContact = computed(() => (props.selected?.kind === "contact" ? props.selected.key : null));

/** 开抽屉的那个按钮：头像列的按钮，或宿主那边的（面板头的标题）。关抽屉后焦点回它。 */
let opener: HTMLElement | null = null;

function toggleFromStrip(): void {
    if (wide.value) {
        emit("update:listCollapsed", false);
        // 展开后头像列收起，按钮跟着不见：焦点放到列表栏的收起按钮上。
        void nextTick(() => rootRef.value?.querySelector<HTMLElement>("[data-messages-collapse]")?.focus());
        return;
    }
    opener = toggleEl();
    emit("update:drawerOpen", !props.drawerOpen);
}

function closeDrawer(restoreFocus: boolean): void {
    if (!props.drawerOpen) return;
    emit("update:drawerOpen", false);
    if (restoreFocus) (opener ?? props.drawerAnchor ?? toggleEl())?.focus();
}

function openContact(key: string): void {
    emit("open-contact", key);
    // 选了一项：抽屉收起，被选的行跟着不见，焦点回到开它的按钮（同 Esc）。
    if (!wide.value) closeDrawer(true);
}

function collapseList(): void {
    emit("update:listCollapsed", true);
    // 列表栏收起，收起按钮跟着不见：焦点放到头像列顶上的展开按钮。
    void nextTick(() => toggleEl()?.focus());
}

/** 宿主选了会话之后关抽屉（会话一页在插槽里，选中由宿主处理）：焦点回到开它的按钮。 */
defineExpose({closeDrawer: () => closeDrawer(true)});

// 抽屉打开时焦点进去（列表里第一个输入框），记下是谁开的：不是头像列的按钮就是宿主那边的；关上时忘掉。
watch(() => props.drawerOpen, (open) => {
    if (!open) {
        opener = null;
        return;
    }
    if (wide.value) return;
    if (opener === null) opener = props.drawerAnchor;
    void nextTick(() => {
        // 当前页里的第一个输入框（bot 页的搜索、会话面板的搜索）；没有就是第一个按钮。
        const page = [...(listRef.value?.querySelectorAll<HTMLElement>("[role='tabpanel']") ?? [])].find((element) => element.style.display !== "none");
        (page?.querySelector<HTMLElement>("input") ?? listRef.value?.querySelector<HTMLElement>("button") ?? null)?.focus();
    });
});

// 换版式：窄变宽时开着的抽屉收起，列表留在原处变成列表栏，焦点不动；宽变窄时列表收起，焦点原来在列表里的放到头像列的按钮上。
watch(() => props.layout, (layout) => {
    if (layout === "wide") {
        if (props.drawerOpen) emit("update:drawerOpen", false);
        return;
    }
    if (listRef.value?.contains(document.activeElement) === true) void nextTick(() => toggleEl()?.focus());
});

/** 视图里点抽屉外（头像列、聊天区）关抽屉；视图之外的点击不管（面板头的标题由宿主切换，传送出去的浮层不算抽屉外）。 */
function onPointerDown(event: PointerEvent): void {
    if (wide.value || !props.drawerOpen) return;
    const target = event.target;
    if (!(target instanceof Node) || listRef.value?.contains(target) === true || toggleEl()?.contains(target) === true) return;
    closeDrawer(false);
}

/** `Esc`：焦点在抽屉里或开它的按钮上时关；里面的控件处理过的不管。 */
function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented || wide.value || !props.drawerOpen) return;
    const active = document.activeElement;
    const inside = active !== null && (listRef.value?.contains(active) === true || active === toggleEl() || active === props.drawerAnchor);
    if (!inside) return;
    event.preventDefault();
    closeDrawer(true);
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));

const contactLabel = (name: string, unread: number | null): string => (unread !== null && unread > 0 ? t("messages.contactUnread", {name, count: unread}) : name);
</script>

<template>
    <div ref="rootRef" class="acv-messages" :class="`acv-messages--${props.layout}`" :data-messages-layout="props.layout" @pointerdown.capture="onPointerDown">
        <nav v-show="showStrip" class="acv-messages__strip" :aria-label="t('messages.strip')" data-messages-strip>
            <IconButton
                :icon-class="wide ? 'i-lucide-panel-left-open' : 'i-lucide-menu'"
                size="sm"
                :title="wide ? t('messages.expandList') : t('messages.openList')"
                :aria-label="wide ? t('messages.expandList') : t('messages.openList')"
                :aria-expanded="wide ? undefined : props.drawerOpen"
                data-messages-toggle
                @click="toggleFromStrip"
            />
            <button
                v-for="contact in contacts"
                :key="contact.key"
                type="button"
                class="acv-messages__strip-item"
                :class="{'is-current': contact.key === selectedContact}"
                :title="contact.name"
                :aria-label="contactLabel(contact.name, contact.unread)"
                :aria-current="contact.key === selectedContact ? 'true' : undefined"
                :data-strip-contact="contact.key"
                @click="openContact(contact.key)"
            >
                <img v-if="contact.avatar !== undefined" :src="contact.avatar" alt="" class="acv-messages__strip-avatar">
                <span v-else class="acv-messages__strip-avatar acv-messages__strip-avatar--initial" aria-hidden="true">{{ Array.from(contact.name.trim())[0] ?? "?" }}</span>
                <span v-if="contact.activity === 'waiting' || (contact.unread ?? 0) > 0" class="acv-messages__strip-dot" :data-strip-waiting="contact.activity === 'waiting' ? '' : undefined" aria-hidden="true" />
            </button>
            <span v-if="contacts.length > 0 && props.recentSessions.length > 0" class="acv-messages__strip-divider" aria-hidden="true" />
            <button
                v-for="session in props.recentSessions"
                :key="session.id"
                type="button"
                class="acv-messages__strip-item"
                :class="{'is-current': props.selected?.kind === 'session' && props.selected.id === session.id}"
                :title="session.title"
                :aria-label="session.title"
                :data-strip-session="session.id"
                @click="emit('open-session', session.id)"
            >
                <span :class="[session.icon, 'acv-messages__strip-icon']" aria-hidden="true" />
            </button>
        </nav>
        <section
            v-show="listShown"
            ref="listRef"
            class="acv-messages__list"
            :role="wide ? undefined : 'dialog'"
            :aria-label="t('messages.list')"
            data-messages-list-panel
        >
            <AgentMessagesList
                :tab="props.tab"
                :sections="props.sections"
                :selected-contact="selectedContact"
                :now="props.now"
                :locale="props.locale"
                @update:tab="emit('update:tab', $event)"
                @open-contact="openContact"
                @retry-contacts="emit('retry-contacts', $event)"
            >
                <template #sessions><slot name="sessions" /></template>
            </AgentMessagesList>
            <IconButton v-if="wide" icon-class="i-lucide-panel-left-close" size="sm" class="acv-messages__collapse" :title="t('messages.collapseList')" :aria-label="t('messages.collapseList')" data-messages-collapse @click="collapseList" />
        </section>
        <div class="acv-messages__chat" data-messages-chat>
            <slot />
        </div>
    </div>
</template>

<style scoped>
.acv-messages {
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
}

.acv-messages__strip {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 52px;
    padding: 8px 0;
    overflow-y: auto;
    border-right: var(--border-w) solid var(--border-color);
}

.acv-messages__strip-item {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
}

.acv-messages__strip-item:hover {
    background: var(--bg-hover);
}

.acv-messages__strip-item.is-current {
    background: var(--accent-bg);
}

.acv-messages__strip-avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    object-fit: cover;
}

.acv-messages__strip-avatar--initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-subtle);
    font-size: var(--text-xs);
}

.acv-messages__strip-icon {
    width: 16px;
    height: 16px;
}

.acv-messages__strip-dot {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-main);
    pointer-events: none;
}

.acv-messages__strip-dot[data-strip-waiting] {
    background: var(--status-warning);
}

.acv-messages__strip-divider {
    flex-shrink: 0;
    width: 24px;
    height: 1px;
    background: var(--border-color);
}

.acv-messages__list {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-panel);
}

/* 宽版：列表栏。 */
.acv-messages--wide .acv-messages__list {
    flex-shrink: 0;
    width: 260px;
    border-right: var(--border-w) solid var(--border-color);
}

/* 窄版：抽屉，从头像列右边拉出、压在聊天区上。 */
.acv-messages--narrow .acv-messages__list {
    position: absolute;
    z-index: 4;
    top: 0;
    bottom: 0;
    left: 52px;
    width: min(300px, 85%);
    border-right: var(--border-w) solid var(--border-color);
    box-shadow: var(--elevation-raised);
}

.acv-messages__collapse {
    position: absolute;
    top: 6px;
    right: 6px;
}

.acv-messages__chat {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
}
</style>
