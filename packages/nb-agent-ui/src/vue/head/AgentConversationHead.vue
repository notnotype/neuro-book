<script setup lang="ts">
/**
 * 对话视图的头（同名 .md）：三列，可以整体送到视图之外（工作台面板头的标题区）。
 *
 * 三列各是一个 `Teleport`，没有位置时 `disabled`、就地渲染。位置来了又走（面板成了标签条、又变回一个标签）时 Vue 只搬 DOM、
 * 不重建组件，所以开着的菜单与宿主放进右列的浮层都还在；整行的 `header` 用 `v-show` 藏，不能用 `v-if`，否则里面的 `Teleport`
 * 跟着卸载，状态就丢了。
 */
import {computed, shallowRef} from "vue";
import {DropdownMenu, IconButton, Popover} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";

import type {AgentConversationContext} from "../../types";
import {useAgentText} from "../host";

/** 根是头加会话列表的浮层两个节点：attrs 落在头上。 */
defineOptions({name: "AgentConversationHead", inheritAttrs: false});

const props = defineProps<{
    ctx: AgentConversationContext;
    targets: {readonly start: HTMLElement; readonly title: HTMLElement; readonly end: HTMLElement; readonly anchor: HTMLElement} | null;
    newSession: boolean;
    hasSessions: boolean;
    sessionsOpen: boolean;
    draftProfile: {readonly name: string; readonly icon: string} | null;
    pinned: ReadonlyArray<{readonly id: string; readonly icon: string; readonly label: string}>;
    overflowItems: ReadonlyArray<DropdownMenuItemData>;
    /** 右列最后画“关闭”（宿主把对话放在可关的面板里时）。 */
    closable: boolean;
    /**
     * 头是窗口的拖动区（宿主自绘窗口头时）：根上写 `data-window-drag`，按住空白、标题文字、头像拖的是宿主的窗口，按钮照旧。
     * 高度与右端让位由宿主经 `--acv-head-height`、`--acv-head-inset-end` 给。
     */
    windowDrag?: boolean;
}>();

const emit = defineEmits<{
    (e: "select", sessionId: string): void;
    (e: "create"): void;
    (e: "update:sessionsOpen", open: boolean): void;
    (e: "header-action", id: string): void;
    (e: "overflow", value: string): void;
    (e: "close"): void;
}>();

const slots = defineSlots<{
    sessions?: () => unknown;
    trailing?: () => unknown;
}>();

const {t} = useAgentText();

const session = computed(() => props.ctx.session);
/** 直接的父会话：`path` 从根排到父会话，不含本会话。 */
const parent = computed(() => session.value?.path?.at(-1) ?? null);
const icon = computed(() => session.value?.profileIcon ?? props.draftProfile?.icon ?? null);
/** 头像读不出来（404、坏图）时换回 Profile 图标，不留一个破图；记的是失败的地址，换了地址再试。 */
const brokenAvatar = shallowRef<string | null>(null);
const avatar = computed(() => {
    const src = session.value?.avatar ?? null;
    return src === brokenAvatar.value ? null : src;
});
const title = computed(() => (session.value === null ? t("header.newConversation") : session.value.title || t("header.untitled")));
const summary = computed(() => session.value?.summary || undefined);

/** 画在原处时中列的按钮，会话列表锚在它上面；送进标题区时锚在宿主给的按钮上。 */
const ownTitle = shallowRef<HTMLElement | null>(null);
const anchor = computed(() => props.targets?.anchor ?? ownTitle.value);
const placed = computed(() => props.targets !== null);
</script>

<template>
    <header v-show="!placed" class="acv-head" data-agent-head :data-window-drag="props.windowDrag === true ? '' : undefined" v-bind="$attrs">
        <div class="acv-head__start">
            <Teleport :to="props.targets?.start ?? null" :disabled="!placed">
                <IconButton
                    v-if="parent !== null"
                    size="xs"
                    icon-class="i-lucide-arrow-left"
                    :title="t('header.back')"
                    :aria-label="t('header.back')"
                    data-header-back
                    @click="emit('select', parent.id)"
                />
                <IconButton
                    v-else-if="session !== null && props.newSession"
                    size="xs"
                    icon-class="i-lucide-plus"
                    :title="t('header.newSession')"
                    :aria-label="t('header.newSession')"
                    data-header-new
                    @click="emit('create')"
                />
            </Teleport>
        </div>
        <button
            v-if="props.hasSessions"
            ref="ownTitle"
            type="button"
            class="acv-head__title acv-head__title--button"
            aria-haspopup="dialog"
            :aria-expanded="props.sessionsOpen"
            data-header-sessions
            @click="emit('update:sessionsOpen', !props.sessionsOpen)"
        >
            <Teleport :to="props.targets?.title ?? null" :disabled="!placed">
                <img v-if="avatar !== null" :src="avatar" alt="" class="acv-head__avatar" draggable="false" data-header-avatar @error="brokenAvatar = avatar">
                <span v-else-if="icon !== null" :class="[icon, 'acv-head__icon']" aria-hidden="true" />
                <span class="acv-head__name" :title="summary" data-header-title>{{ title }}</span>
                <span class="i-lucide-chevron-down acv-head__chevron" aria-hidden="true" />
            </Teleport>
        </button>
        <div v-else class="acv-head__title">
            <Teleport :to="props.targets?.title ?? null" :disabled="!placed">
                <img v-if="avatar !== null" :src="avatar" alt="" class="acv-head__avatar" draggable="false" data-header-avatar @error="brokenAvatar = avatar">
                <span v-else-if="icon !== null" :class="[icon, 'acv-head__icon']" aria-hidden="true" />
                <span class="acv-head__name" :title="summary" data-header-title>{{ title }}</span>
            </Teleport>
        </div>
        <div class="acv-head__end">
            <Teleport :to="props.targets?.end ?? null" :disabled="!placed">
                <slot name="trailing" />
                <IconButton
                    v-for="entry in props.pinned"
                    :key="entry.id"
                    size="xs"
                    :icon-class="entry.icon"
                    :title="entry.label"
                    :aria-label="entry.label"
                    :data-header-action="entry.id"
                    @click="emit('header-action', entry.id)"
                />
                <DropdownMenu v-if="session !== null && props.overflowItems.length > 0" :items="[...props.overflowItems]" root-class="acv-head__more" align="end" @select="(value: string) => emit('overflow', value)">
                    <IconButton size="xs" icon-class="i-lucide-ellipsis" :title="t('header.more')" :aria-label="t('header.more')" data-header-more />
                </DropdownMenu>
                <IconButton v-if="props.closable" size="xs" icon-class="i-lucide-x" :title="t('header.close')" :aria-label="t('header.close')" data-header-close @click="emit('close')" />
            </Teleport>
        </div>
    </header>
    <Popover
        v-if="slots.sessions !== undefined"
        :open="props.sessionsOpen && anchor !== null"
        :anchor="anchor"
        side="bottom"
        align="center"
        content-class="acv-head__sessions"
        @update:open="(open: boolean) => emit('update:sessionsOpen', open)"
    >
        <slot name="sessions" />
    </Popover>
</template>

<style scoped>
.acv-head {
    display: grid;
    flex-shrink: 0;
    grid-template-columns: minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr);
    align-items: center;
    gap: var(--space-1);
    /* 宿主自绘窗口头时给高度与右端让位（盖在右端的窗口按钮），缺省不让位。 */
    height: var(--acv-head-height, 32px);
    padding: 0 calc(12px + var(--acv-head-inset-end, 0px)) 0 12px;
    user-select: none;
}

/* 作窗口拖动区时触摸按住就起拖，不滚动；高度缺省与消息列表的切换行一样是 40px（两栏第一行等高）。 */
.acv-head[data-window-drag] {
    height: var(--acv-head-height, 40px);
    touch-action: none;
}

.acv-head__start,
.acv-head__end {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.acv-head__end {
    justify-content: flex-end;
}

.acv-head__title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
}

.acv-head__title--button {
    height: var(--control-h-sm);
    padding-inline: var(--space-2);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

.acv-head__title--button:hover,
.acv-head__title--button[aria-expanded="true"] {
    background: var(--bg-hover);
}

/* 作用域属性在渲染时就写在元素上，送进面板头的几格照样带着，这几条两处都生效。 */
.acv-head__avatar {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    object-fit: cover;
}

.acv-head__icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: var(--accent-text);
}

.acv-head__name {
    min-width: 0;
    overflow: hidden;
    color: var(--text-main);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    text-overflow: ellipsis;
}

.acv-head__chevron {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

:global(.acv-head__sessions) {
    width: min(420px, 90vw);
    height: min(480px, 70vh);
    padding: 0;
}

:global(.acv-head__more) {
    position: relative;
    display: inline-block;
}
</style>
