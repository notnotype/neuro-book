<script setup lang="ts">
/**
 * “消息”视图的外框（同名 .md）：列表、头像列、聊天区各一份 DOM，按 `layout` 只改位置与显隐，聊天区在宽窄之间不重挂。
 * 抽屉是视图里自己画的一块（非模态），不用 nb-ui 的 `Drawer`：那个传送到页面、整页模态，会盖住整个工作台。
 *
 * 左右两块是 nb-layout 的 `Splitter` 的两块面板，宽窄两种版式都在：左边那块装头像列与列表，宽版时拖它右边的线改列表栏的宽度、拖窄了收成
 * 头像列；窄版时它固定收成头像列、线不可拖，列表作为抽屉从这块面板里伸出去压在聊天区上，所以这块面板在窄版不裁切（`overflow: "visible"`）。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import type {SplitterGestureState} from "@notnotype/nb-layout";
import {Splitter} from "@notnotype/nb-layout/vue";
import type {SplitterPanelConfig} from "@notnotype/nb-layout/vue";
import {IconButton} from "@notnotype/nb-ui/components";

import type {AgentLocale, MessagesContactSection, MessagesRecentSession} from "../../types";
import {provideAgentText} from "../text";
import AgentMessagesList from "./AgentMessagesList.vue";

const props = withDefaults(defineProps<{
    layout: "wide" | "narrow";
    listCollapsed: boolean;
    /** 宽版列表栏的宽度（CSS px）；放不下时按当时的上限显示，不改这个值。 */
    listWidth?: number;
    drawerOpen: boolean;
    tab: "bot" | "sessions";
    sections: readonly MessagesContactSection[];
    selected: {readonly kind: "contact"; readonly key: string} | {readonly kind: "session"; readonly id: string} | null;
    recentSessions: readonly MessagesRecentSession[];
    drawerAnchor?: HTMLElement | null;
    now: number;
    locale?: AgentLocale;
    /**
     * 宿主自绘窗口头（视图第一行就是窗口头）：列表的切换行与头像列顶上那一行是窗口的拖动区（`data-window-drag`），头像列顶上那一行高
     * `--acv-head-height`，窄版的抽屉从这个高度下面拉出、不压住对话头。
     */
    windowDrag?: boolean;
}>(), {listWidth: 260, drawerAnchor: null, locale: undefined, windowDrag: false});

const emit = defineEmits<{
    "update:listCollapsed": [collapsed: boolean];
    "update:listWidth": [width: number];
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
/**
 * 拖动中列表栏收起了没有：拖过收起的门槛时面板已经是头像列的宽度，受控的 `listCollapsed` 要到松手才变，这段时间按它画；
 * 不在拖动时为 null。
 */
const draggedCollapsed = ref<boolean | null>(null);
const collapsed = computed(() => draggedCollapsed.value ?? props.listCollapsed);
/** 头像列：窄版，或宽版收起了列表栏。 */
const showStrip = computed(() => !wide.value || collapsed.value);
/** 列表显示着：宽版是列表栏，窄版是抽屉。 */
const listShown = computed(() => (wide.value ? !collapsed.value : props.drawerOpen));

// ─── 分栏 ─────────────────────────────────────────────────────────────

const LIST = "list";
const CHAT = "chat";
/** 头像列的宽度，也是列表栏收起后的宽度。 */
const STRIP_WIDTH = 52;
const LIST_MIN_WIDTH = 200;
const LIST_MAX_WIDTH = 420;
/** 宽版给聊天区留的最小宽度：列表栏的上限随视图变窄而降。窄版不设，视图再窄也照样分得出两块。 */
const CHAT_MIN_WIDTH = 320;
/** 拖到最小宽度以内再过这么多就收成头像列；收起后往外拖过这么多就展开。 */
const COLLAPSE_THRESHOLD = 40;

/** 宿主给的宽度夹到范围里；视图窄、聊天区的下限再压它一道是分栏做的。 */
const boundedListWidth = computed(() => Math.min(LIST_MAX_WIDTH, Math.max(LIST_MIN_WIDTH, props.listWidth)));
/**
 * 用 computed 生成：`Splitter` 未受控时 `panels` 换了对象就按 `defaultSizePx` 重新分配，这里的值只随宽度、收起与版式变，重新分配是幂等的。
 * 收起状态取受控的 `listCollapsed`，不取拖动中的：拖动中改约束会让手势作废。
 */
const panels = computed<SplitterPanelConfig[]>(() => [
    {
        id: LIST,
        label: t("messages.list"),
        defaultSizePx: boundedListWidth.value,
        minSizePx: LIST_MIN_WIDTH,
        maxSizePx: LIST_MAX_WIDTH,
        sizing: "fixed",
        overflow: wide.value ? "hidden" : "visible",
        collapse: {collapsedSize: STRIP_WIDTH, restoreSize: boundedListWidth.value, collapseThreshold: COLLAPSE_THRESHOLD, expandThreshold: COLLAPSE_THRESHOLD, collapsed: !wide.value || props.listCollapsed},
    },
    {id: CHAT, label: t("messages.chat"), minSizePx: wide.value ? CHAT_MIN_WIDTH : 0, sizing: "weight"},
]);

function onGestureUpdate(state: SplitterGestureState): void {
    // `collapsed` 只列与手势开始时不同的面板：拖过门槛又拖回来时没有这一项（回到按下的位置时分栏补发一次空的），回到受控的值。
    draggedCollapsed.value = state.collapsed[LIST] ?? props.listCollapsed;
}

/**
 * 拖完（或键盘调完）：收起状态与宽度交回宿主，否则下一次重新分配回到原样。收着的时候不记宽度（那是头像列的宽度）。
 * 交回的是松手时显示的宽度：视图窄、宽度被聊天区的下限压着时拖一下，记着的宽度就换成压过的这个值（同名 .md 的“拖宽度”）。
 */
function onGestureEnd(state: SplitterGestureState): void {
    draggedCollapsed.value = null;
    const next = state.collapsed[LIST] ?? props.listCollapsed;
    if (next !== props.listCollapsed) emit("update:listCollapsed", next);
    const width = state.sizesPx[0];
    if (!next && width !== undefined && Math.round(width) !== props.listWidth) emit("update:listWidth", Math.round(width));
}
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
    <div ref="rootRef" class="acv-messages" :class="[`acv-messages--${props.layout}`, {'acv-messages--window-drag': props.windowDrag}]" :data-messages-layout="props.layout" @pointerdown.capture="onPointerDown">
        <Splitter :panels="panels" :disabled="!wide" @gesture-update="onGestureUpdate" @gesture-end="onGestureEnd" @gesture-cancel="draggedCollapsed = null">
            <template #panel-list>
                <nav v-show="showStrip" class="acv-messages__strip" :aria-label="t('messages.strip')" data-messages-strip>
                    <div class="acv-messages__strip-head" :data-window-drag="props.windowDrag ? '' : undefined" data-messages-strip-head>
                        <IconButton
                            :icon-class="wide ? 'i-lucide-panel-left-open' : 'i-lucide-menu'"
                            size="sm"
                            :title="wide ? t('messages.expandList') : t('messages.openList')"
                            :aria-label="wide ? t('messages.expandList') : t('messages.openList')"
                            :aria-expanded="wide ? undefined : props.drawerOpen"
                            data-messages-toggle
                            @click="toggleFromStrip"
                        />
                    </div>
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
                        :window-drag="props.windowDrag"
                        @update:tab="emit('update:tab', $event)"
                        @open-contact="openContact"
                        @retry-contacts="emit('retry-contacts', $event)"
                    >
                        <template #sessions><slot name="sessions" /></template>
                        <template v-if="wide" #switch-end>
                            <IconButton icon-class="i-lucide-panel-left-close" size="sm" :title="t('messages.collapseList')" :aria-label="t('messages.collapseList')" data-messages-collapse @click="collapseList" />
                        </template>
                    </AgentMessagesList>
                </section>
            </template>
            <template #panel-chat>
                <div class="acv-messages__chat" data-messages-chat>
                    <slot />
                </div>
            </template>
        </Splitter>
    </div>
</template>

<style scoped>
.acv-messages {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    /* 抽屉的宽度按视图的宽度算（`cqi`）：它的包含块是 52 像素的头像列那块面板，百分比用不上。 */
    container-type: inline-size;
    /* 两块之间的线由分栏画，颜色同别处的描边。 */
    --nb-layout-splitter-seam: var(--border-color);
}

.acv-messages__strip {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 52px;
    height: 100%;
    padding: 8px 0;
    overflow-y: auto;
}

.acv-messages__strip-head {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 100%;
    user-select: none;
}

/* 自绘窗口头时头像列顶上那一行与对话头同高、顶到窗口顶，空白处能拖窗口。 */
.acv-messages--window-drag .acv-messages__strip {
    padding-top: 0;
}

.acv-messages--window-drag .acv-messages__strip-head {
    height: var(--acv-head-height, 40px);
    touch-action: none;
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

/*
 * 宽版：列表栏，铺满分栏给的那块，但不窄于列表栏的最小宽度：面板比它窄的时候（往收起的门槛拖、收起与展开的宽度过渡中）
 * 列表被面板裁掉右边，不跟着挤成一条。数与 `LIST_MIN_WIDTH` 相同。
 */
.acv-messages--wide .acv-messages__list {
    width: 100%;
    min-width: 200px;
    height: 100%;
}

/* 窄版：抽屉，从头像列那块面板的右边伸出去、压在聊天区与分栏的线上（线的层级是 1）。 */
.acv-messages--narrow .acv-messages__list {
    position: absolute;
    z-index: 4;
    top: 0;
    bottom: 0;
    left: 100%;
    width: min(300px, 85cqi);
    border-right: var(--border-w) solid var(--border-color);
    box-shadow: var(--elevation-raised);
}

/* 自绘窗口头时抽屉从头那一行下面拉出：不盖住对话头与宿主盖在右上角的按钮。 */
.acv-messages--window-drag.acv-messages--narrow .acv-messages__list {
    top: var(--acv-head-height, 40px);
    border-top: var(--border-w) solid var(--border-color);
}

.acv-messages__chat {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
}
</style>
