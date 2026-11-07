<script setup lang="ts">
/**
 * 设置页面里的一张列表加下一级页面（同名 .md，docs/specs/settings/settings-window.md 输出 19）：受控，`modelValue` 为
 * `null` 时画列表，为某一项的 id 时画这一项的内容（默认插槽），并经窗口的标题区通道把标题区换成“‹ 页面标题”与这一项的标题。
 *
 * 值永远由调用方改：点一行发 `update:modelValue(id)`，返回发 `update:modelValue(null)`，组件自己不记“打开了哪一项”。
 */
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";

import {usePageChrome} from "./page-chrome";
import {settingsUiText} from "./text";
import type {SettingsUiKey} from "./text";

/** 状态文字的色调：成功、警告、出错各取对应的状态色，淡色（缺省）取次要文字色。 */
export type SettingsPageListTone = "success" | "warning" | "error" | "muted";

export interface SettingsPageListItem {
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    /** 图标类名，例如 i-lucide-server。 */
    readonly icon?: string;
    /** 右端的状态文字，例如“已连接”。 */
    readonly status?: string;
    readonly tone?: SettingsPageListTone;
    /** 标题后画一个小圆点：这一项有改动（例如没保存的草稿）。 */
    readonly modified?: boolean;
}

defineOptions({name: "SettingsPageList"});

const props = defineProps<{
    items: ReadonlyArray<SettingsPageListItem>;
    /** 打开的项的 id；`null` 是列表。 */
    modelValue: string | null;
    /** 列表的可访问名称。 */
    label: string;
}>();

const emit = defineEmits<{
    (event: "update:modelValue", id: string | null): void;
}>();

defineSlots<{
    /** 打开的这一项的内容。 */
    default?(props: {item: SettingsPageListItem}): unknown;
}>();

/** “返回”“有改动”两处固定文字在 `nbook.settings` 的目录里，经宿主注入的翻译端口翻译。 */
const port = useText();
const text = (key: SettingsUiKey): string => port.t(settingsUiText(key));

const chrome = usePageChrome();
const root = ref<HTMLElement | null>(null);
/** 打开的那一项；`modelValue` 指向一个不存在的项（例如刚被删掉）时当作没有打开，画列表。 */
const opened = computed(() => (props.modelValue === null ? null : (props.items.find((item) => item.id === props.modelValue) ?? null)));

/**
 * 标题替换：打开一项时登记，换一项、返回、卸载时撤销。通道是单槽，撤销函数只撤自己这一次登记，所以先撤旧的再登记新的。
 * 标题随这一项的标题变（例如页面里正在改名字），所以按 id 与标题一起监听。
 */
let undo: (() => void) | null = null;
watch([() => opened.value?.id, () => opened.value?.title], ([id, title]) => {
    undo?.();
    undo = null;
    if (chrome !== null && id !== undefined && title !== undefined) undo = chrome.claim({title, back: goBack});
}, {immediate: true});
onBeforeUnmount(() => {
    undo?.();
    undo = null;
});

/**
 * 打开一项时点的那一行随列表一起卸载，焦点会掉到 body：放到详情上，读屏念出这一项的名字，接着 `Tab` 进第一个控件、
 * `Shift+Tab` 到返回。焦点没有丢（例如调用方从标题区的按钮打开、或自己把焦点放到了别处）时不动。
 */
watch(() => opened.value?.id, async (id, before) => {
    if (id === undefined || before !== undefined) return;
    await nextTick();
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    // 不滚动：详情比视野高时浏览器会把它的顶边滚到最上面，窄窗口里标题区（返回在那里）就被滚走了。
    root.value?.querySelector<HTMLElement>("[data-settings-page-list-detail]")?.focus({preventScroll: true});
});

/**
 * 返回：发出 `null`，等调用方把列表画回来之后，把焦点放回刚才那一行（点“返回”的按钮随详情一起消失，焦点会丢）。
 * 调用方没有改值（拒绝返回）时不动焦点。
 */
async function goBack(): Promise<void> {
    const id = props.modelValue;
    if (id === null) return;
    emit("update:modelValue", null);
    await nextTick();
    if (props.modelValue !== null) return;
    root.value?.querySelector<HTMLElement>(`[data-settings-page-list-item="${CSS.escape(id)}"]`)?.focus();
}
</script>

<template>
    <div ref="root" class="settings-page-list" :data-state="opened === null ? 'list' : 'detail'">
        <ul v-if="opened === null" class="settings-page-list__items" :aria-label="label">
            <li v-for="item in items" :key="item.id" class="settings-page-list__entry">
                <button type="button" class="settings-page-list__row nb-ui-focus-ring" :data-settings-page-list-item="item.id" @click="emit('update:modelValue', item.id)">
                    <span v-if="item.icon !== undefined" class="settings-page-list__icon" aria-hidden="true">
                        <span :class="item.icon"></span>
                    </span>
                    <span class="settings-page-list__text">
                        <span class="settings-page-list__title">
                            <span class="settings-page-list__title-text">{{ item.title }}</span>
                            <span v-if="item.modified === true" class="settings-page-list__dot" role="img" :aria-label="text('pageList.modified')" data-settings-page-list-modified></span>
                        </span>
                        <span v-if="item.description !== undefined" class="settings-page-list__description">{{ item.description }}</span>
                    </span>
                    <span v-if="item.status !== undefined" class="settings-page-list__status" :data-tone="item.tone ?? 'muted'" data-settings-page-list-status>{{ item.status }}</span>
                    <span class="i-lucide-chevron-right settings-page-list__chevron" aria-hidden="true"></span>
                </button>
            </li>
        </ul>
        <div v-else class="settings-page-list__detail" role="region" :aria-label="opened.title" tabindex="-1" data-settings-page-list-detail>
            <!-- 在设置窗口里返回在标题区；没有窗口（例如 Lab 单独渲染）时详情上方自己画一行。 -->
            <button v-if="chrome === null" type="button" class="settings-page-list__back nb-ui-focus-ring" data-settings-page-list-back @click="goBack">
                <span class="i-lucide-chevron-left" aria-hidden="true"></span>
                <span>{{ text('pageList.back') }}</span>
            </button>
            <slot :item="opened" />
        </div>
    </div>
</template>

<style scoped>
/* 详情只在打开时由程序聚焦一次（接住随列表卸载的焦点），它是容器不是控件，不画焦点环。 */
.settings-page-list__detail:focus {
    outline: none;
}

.settings-page-list {
    min-width: 0;
}

.settings-page-list__items {
    display: flex;
    margin: 0;
    padding: 0;
    flex-direction: column;
    gap: var(--space-1);
    list-style: none;
}

/*
 * 行没有描边：悬停时一层淡底。行比内容列宽一个内边距，文字仍与上下的内容对齐，淡底两端各伸出一点；按下不缩放，也不换色，
 * 只靠悬停的淡底与焦点环表示状态。
 */
.settings-page-list__row {
    display: flex;
    width: calc(100% + 2 * var(--space-4));
    min-width: 0;
    align-items: center;
    gap: var(--space-5);
    margin-inline: calc(-1 * var(--space-4));
    padding: var(--space-4);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-main);
    font: inherit;
    text-align: left;
    cursor: pointer;
    outline: none;
    transition-property: background-color;
    transition-duration: var(--motion-fast);
    transition-timing-function: var(--ease-layout);
}

.settings-page-list__row:hover {
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
}

.settings-page-list__icon {
    display: grid;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    place-items: center;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--status-info) 14%, transparent);
    color: var(--status-info);
    font-size: var(--text-md);
}

.settings-page-list__text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
}

.settings-page-list__title {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-ui);
}

.settings-page-list__title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 与 SettingsRow 的“已修改”圆点同一个大小与颜色。 */
.settings-page-list__dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: var(--radius-pill);
    background: var(--accent-main);
}

.settings-page-list__description {
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.settings-page-list__status {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.settings-page-list__status[data-tone="success"] {
    color: var(--status-success);
}

.settings-page-list__status[data-tone="warning"] {
    color: var(--status-warning);
}

.settings-page-list__status[data-tone="error"] {
    color: var(--status-danger);
}

.settings-page-list__chevron {
    flex-shrink: 0;
    color: var(--text-muted);
}

.settings-page-list__back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    outline: none;
}
</style>
