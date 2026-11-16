<script setup lang="ts">
import type {SnapshotProvider} from "@notnotype/nb-models/contract";
import {Button, ContextMenu, IconButton} from "@notnotype/nb-ui/components";
import type {ContextMenuCloseReason} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref} from "vue";

import type {CheckState} from "../models-store";
import {checkKey} from "../models-store";
import {useModelsText} from "../text";

/**
 * “服务商与模型”页的左栏（docs/specs/models/settings-pages.md 输出 1、12）：顶上“全部模型”，下面是添加过的服务商，最后“添加服务商”。
 * 选择照设置窗口左栏：当前项 `aria-current`，上下键与 Home、End 在项之间移动并选中，只有当前项在 Tab 序列里。
 *
 * 每家一行：名称，行尾一格写模型数或问题图标；悬停或聚焦时这一格换成删除图标。删除图标与条目是并列的兄弟（按钮里不能套
 * 按钮），不在 Tab 序列里：键盘在条目上按 Delete 删除、Shift+F10 或菜单键开右键菜单。
 *
 * 问题的原因写在条目的 `title` 里，不挂在图标的提示上：悬停整行时图标让位给删除图标，挂在图标上就永远悬停不到。读屏从
 * `aria-describedby` 读原因；被引用的那段文字是 `hidden`，不并进条目的名称。
 */
const props = withDefaults(defineProps<{
    providers: readonly SnapshotProvider[];
    /** 当前项：服务商 id，或 `"all"`（全部模型）。 */
    current: string;
    checks?: ReadonlyMap<string, CheckState>;
    disabled?: boolean;
}>(), {checks: () => new Map(), disabled: false});

const emit = defineEmits<{
    (e: "select", id: string): void;
    (e: "add"): void;
    (e: "remove", id: string): void;
}>();

const text = useModelsText();
const root = ref<HTMLElement | null>(null);

const total = (): number => props.providers.reduce((sum, provider) => sum + provider.models.filter((model) => model.enabled).length, 0);

type Status = {readonly text: string; readonly tone: "muted" | "warning" | "error"; readonly icon: string | null; readonly count: number};

/** 行尾一格：密钥的问题先说，再说检测失败，都没有时写启用了几个模型。有问题时是图标，原因在提示与读屏描述里。 */
function status(provider: SnapshotProvider): Status {
    const count = provider.models.filter((model) => model.enabled).length;
    if (provider.key.kind === "none" && provider.auth !== "none") return {text: text("rail.keyMissing"), tone: "warning", icon: "i-lucide-key-round", count};
    if (provider.key.kind === "env" && !provider.key.found) return {text: text("rail.envMissing"), tone: "error", icon: "i-lucide-circle-alert", count};
    if (provider.models.some((model) => {
        const state = props.checks.get(checkKey(provider.id, model.id));
        return state?.status === "done" && !state.result.ok;
    })) return {text: text("rail.checkFailed"), tone: "error", icon: "i-lucide-circle-alert", count};
    return {text: text("rail.models", {count}), tone: "muted", icon: null, count};
}

/** 每次渲染每家只算一次。 */
const statuses = computed(() => new Map(props.providers.map((provider) => [provider.id, status(provider)])));
const statusOf = (provider: SnapshotProvider): Status => statuses.value.get(provider.id) ?? status(provider);
const statusIdOf = (id: string): string => `provider-rail-status-${id}`;
/** 悬停条目的提示：名称（放不下时截断），有问题时第二行写原因。 */
const titleOf = (provider: SnapshotProvider): string => {
    const current = statusOf(provider);
    return current.icon === null ? provider.name : `${provider.name}\n${current.text}`;
};

// ---- 右键菜单 ----
const menu = ref<{readonly open: boolean; readonly x: number; readonly y: number; readonly id: string | null}>({open: false, x: 0, y: 0, id: null});
const menuItems = computed(() => [{label: text("remove.menu"), iconClass: "i-lucide-trash-2", tone: "danger" as const, action: () => {
    if (menu.value.id !== null) emit("remove", menu.value.id);
}}]);

function openMenu(id: string, x: number, y: number): void {
    if (props.disabled) return;
    menu.value = {open: true, x, y, id};
}

/** 只读时不拦：浏览器自己的右键菜单照常出来。 */
function openMenuAt(event: MouseEvent, id: string): void {
    if (props.disabled) return;
    event.preventDefault();
    openMenu(id, event.clientX, event.clientY);
}

/** Escape、Tab 关掉菜单时焦点回到那一项；选了“删除”时交给确认框，点到别处时焦点已随用户走了。 */
function onMenuClose(reason: ContextMenuCloseReason): void {
    const id = menu.value.id;
    if (id === null || (reason !== "escape" && reason !== "tab")) return;
    void nextTick(() => itemOf(id)?.focus());
}

const itemOf = (id: string): HTMLElement | null => root.value?.querySelector<HTMLElement>(`[data-provider-rail-item="${CSS.escape(id)}"]`) ?? null;

function onKeydown(event: KeyboardEvent): void {
    // 只管左栏的项：“添加服务商”按钮上的方向键不算左栏导航。
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-provider-rail-item")) return;
    const id = event.target.getAttribute("data-provider-rail-item")!;
    if (id !== "all" && !props.disabled) {
        if (event.key === "Delete") {
            event.preventDefault();
            emit("remove", id);
            return;
        }
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            event.preventDefault();
            const rect = event.target.getBoundingClientRect();
            openMenu(id, rect.left + 24, rect.bottom);
            return;
        }
    }
    const ids = ["all", ...props.providers.map((provider) => provider.id)];
    const at = ids.indexOf(props.current);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(ids.length - 1, at + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    if (next === null) return;
    event.preventDefault();
    emit("select", ids[next]!);
    void nextTick(() => root.value?.querySelector<HTMLElement>("[aria-current='page']")?.focus());
}
</script>

<template>
    <nav ref="root" class="provider-rail" :aria-label="text('rail.label')" @keydown="onKeydown">
        <button
            type="button"
            class="provider-rail__item nb-ui-focus-ring-inset"
            :aria-current="current === 'all' ? 'page' : undefined"
            :tabindex="current === 'all' ? 0 : -1"
            :title="text('rail.available', {count: total()})"
            data-provider-rail-item="all"
            @click="emit('select', 'all')"
        >
            <span class="i-lucide-layers provider-rail__icon" aria-hidden="true" />
            <span class="provider-rail__name">{{ text("rail.all") }}</span>
            <span class="provider-rail__end provider-rail__count">{{ total() }}</span>
        </button>
        <div class="provider-rail__divider" />
        <div class="provider-rail__list">
            <div
                v-for="provider in providers"
                :key="provider.id"
                class="provider-rail__row"
                :class="{'is-menu': menu.open && menu.id === provider.id, 'is-removable': !disabled}"
                @contextmenu="openMenuAt($event, provider.id)"
            >
                <button
                    type="button"
                    class="provider-rail__item nb-ui-focus-ring-inset"
                    :aria-current="provider.id === current ? 'page' : undefined"
                    :aria-describedby="statusIdOf(provider.id)"
                    :tabindex="provider.id === current ? 0 : -1"
                    :title="titleOf(provider)"
                    :data-provider-rail-item="provider.id"
                    @click="emit('select', provider.id)"
                >
                    <span :class="provider.kind === 'catalog' ? 'i-lucide-cloud' : 'i-lucide-server'" class="provider-rail__icon" aria-hidden="true" />
                    <span class="provider-rail__name">{{ provider.name }}</span>
                    <span class="provider-rail__end" :data-provider-status="statusOf(provider).tone" aria-hidden="true">
                        <span v-if="statusOf(provider).icon !== null" :class="[statusOf(provider).icon, `provider-rail__flag--${statusOf(provider).tone}`]" class="provider-rail__flag" />
                        <span v-else class="provider-rail__count">{{ statusOf(provider).count }}</span>
                    </span>
                    <span :id="statusIdOf(provider.id)" hidden>{{ statusOf(provider).text }}</span>
                </button>
                <IconButton
                    v-if="!disabled"
                    class="provider-rail__remove"
                    size="xs"
                    icon-class="i-lucide-trash-2"
                    tabindex="-1"
                    :title="text('remove.button')"
                    :aria-label="text('remove.label', {name: provider.name})"
                    :data-provider-remove="provider.id"
                    @click="emit('remove', provider.id)"
                />
            </div>
        </div>
        <Button size="sm" variant="ghost" icon-class="i-lucide-plus" block :disabled="disabled" data-provider-add @click="emit('add')">{{ text("rail.add") }}</Button>
        <ContextMenu :open="menu.open" :x="menu.x" :y="menu.y" :items="menuItems" @request-close="onMenuClose" @update:open="(open) => (menu = {...menu, open})" />
    </nav>
</template>

<style scoped>
.provider-rail {
    display: flex;
    width: 164px;
    flex-shrink: 0;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 var(--space-3) 0 var(--space-2);
    overflow-y: auto;
    border-right: var(--border-w) solid var(--divider);
}

.provider-rail__divider {
    height: var(--border-w);
    margin: var(--space-1) var(--space-3);
    background: var(--divider);
}

.provider-rail__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

/* 一行：条目按钮占满，删除图标绝对定位叠在行尾那一格上。 */
.provider-rail__row {
    position: relative;
}

/* 单行，高度同设置窗口左栏。 */
.provider-rail__item {
    display: flex;
    width: 100%;
    min-height: var(--control-h-sm);
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-1) 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
}

/* 设置窗口是玻璃面：悬停与当前项用半透明叠色，同窗口左栏，不用层级轴的不透明色。 */
.provider-rail__item:hover,
.provider-rail__row:hover .provider-rail__item,
.provider-rail__row.is-menu .provider-rail__item {
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

.provider-rail__item[aria-current="page"],
.provider-rail__row:hover .provider-rail__item[aria-current="page"],
.provider-rail__row.is-menu .provider-rail__item[aria-current="page"] {
    background: var(--overlay-item-active);
}

.provider-rail__icon {
    flex-shrink: 0;
    color: var(--text-muted);
}

.provider-rail__name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

/* 行尾一格定宽：模型数、问题图标与删除图标在同一列，名称不随状态挪动。 */
.provider-rail__end {
    display: inline-flex;
    width: 22px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
}

.provider-rail__count {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
}

.provider-rail__flag {
    display: block;
    width: 14px;
    height: 14px;
}

.provider-rail__flag--warning {
    color: var(--status-warning);
}

.provider-rail__flag--error {
    color: var(--status-danger);
}

.provider-rail__remove {
    position: absolute;
    top: 50%;
    right: 2px;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-50%);
}

/* 悬停、聚焦或菜单开着的那一行：行尾一格让位给删除图标。 */
.provider-rail__row.is-removable:is(:hover, :focus-within, .is-menu) .provider-rail__remove {
    opacity: 1;
    pointer-events: auto;
}

.provider-rail__row.is-removable:is(:hover, :focus-within, .is-menu) .provider-rail__end {
    visibility: hidden;
}
</style>
