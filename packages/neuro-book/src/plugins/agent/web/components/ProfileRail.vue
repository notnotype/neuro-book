<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref} from "vue";

import type {ProfileView} from "../profile-view";
import {useAgentPageText} from "../text";

/**
 * Profile 设置页的左栏（同名 .md）：一行一项，有问题时行尾是图标；来源在详情头部的提示里。
 *
 * 原因写在条目的 `title` 里（同“服务商与模型”的左栏），不另挂图标的提示：条目本来就用 `title` 写放不下的名称，两种提示叠在
 * 一起会同时冒出来。读屏从 `aria-describedby` 读原因；被引用的那段文字是 `hidden`，不并进条目的名称。
 */
const props = withDefaults(defineProps<{
    items: readonly ProfileView[];
    current: string;
    disabled?: boolean;
}>(), {disabled: false});

const emit = defineEmits<{
    (e: "select", key: string): void;
    (e: "create"): void;
}>();

const text = useAgentPageText();
/** 不可用是禁止图标、有错误是警示图标；颜色另照 `statusText.tone`（缺工具、key 被占用的不可用是警示色）。 */
const STATUS_ICON = {unavailable: "i-lucide-circle-slash", error: "i-lucide-circle-alert"} as const;
const statusIdOf = (key: string): string => `profile-rail-status-${key}`;
const titleOf = (item: ProfileView): string => (item.statusText === null ? item.name : `${item.name}\n${item.statusText.text}`);
const root = ref<HTMLElement | null>(null);
const groups = computed(() => [
    {id: "main", title: null, items: props.items.filter((item) => !item.hidden)},
    {id: "background", title: text("profiles.rail.background"), items: props.items.filter((item) => item.hidden)},
].filter((group) => group.items.length > 0));

function onKeydown(event: KeyboardEvent): void {
    // 只管左栏的项：“新建”按钮上的方向键不算左栏导航。
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-profile-rail-item")) return;
    const keys = groups.value.flatMap((group) => group.items.map((item) => item.key));
    const at = keys.indexOf(props.current);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(keys.length - 1, at + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = keys.length - 1;
    if (next === null) return;
    event.preventDefault();
    emit("select", keys[next]!);
    void nextTick(() => root.value?.querySelector<HTMLElement>("[aria-current='page']")?.focus());
}
</script>

<template>
    <nav ref="root" class="profile-rail" :aria-label="text('profiles.rail.label')" @keydown="onKeydown">
        <template v-for="group in groups" :key="group.id">
            <div v-if="group.title !== null" class="profile-rail__title">{{ group.title }}</div>
            <div class="profile-rail__list">
                <button
                    v-for="item in group.items"
                    :key="item.key"
                    type="button"
                    class="profile-rail__item nb-ui-focus-ring-inset"
                    :aria-current="item.key === current ? 'page' : undefined"
                    :tabindex="item.key === current ? 0 : -1"
                    :data-profile-rail-item="item.key"
                    :title="titleOf(item)"
                    :aria-describedby="item.statusText === null ? undefined : statusIdOf(item.key)"
                    @click="emit('select', item.key)"
                >
                    <span :class="item.icon" class="profile-rail__icon" aria-hidden="true" />
                    <span class="profile-rail__name">{{ item.name }}</span>
                    <span class="profile-rail__end" aria-hidden="true">
                        <span v-if="item.statusText !== null" :class="[STATUS_ICON[item.statusText.kind], `profile-rail__flag--${item.statusText.tone}`]" class="profile-rail__flag" :data-profile-rail-status="item.statusText.tone" />
                    </span>
                    <span v-if="item.statusText !== null" :id="statusIdOf(item.key)" hidden>{{ item.statusText.text }}</span>
                </button>
            </div>
        </template>
        <Button size="sm" variant="ghost" icon-class="i-lucide-plus" block :disabled="disabled" data-profile-create @click="emit('create')">{{ text("profiles.rail.new") }}</Button>
    </nav>
</template>

<style scoped>
.profile-rail {
    display: flex;
    width: 164px;
    flex-shrink: 0;
    flex-direction: column;
    gap: var(--space-1);
    /* 底部留白：滚到底时最后一个按钮的聚焦光晕不被滚动区裁掉。 */
    padding: 0 var(--space-3) var(--space-2) var(--space-2);
    overflow-y: auto;
    border-right: var(--border-w) solid var(--divider);
}

.profile-rail__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.profile-rail__title {
    margin-top: var(--space-3);
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

/* 单行，高度同设置窗口左栏与“服务商与模型”的左栏。 */
.profile-rail__item {
    display: flex;
    width: 100%;
    min-height: var(--control-h-sm);
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-1) 0 var(--space-3);
    font-size: var(--text-sm);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
}

/* 设置窗口是玻璃面：悬停与当前项用半透明叠色，同窗口左栏。 */
.profile-rail__item:hover {
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

.profile-rail__item[aria-current="page"] {
    background: var(--overlay-item-active);
}

.profile-rail__icon {
    flex-shrink: 0;
    color: var(--text-muted);
}

.profile-rail__name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

/* 行尾定宽一格：有没有问题，名称都不挪。 */
.profile-rail__end {
    display: inline-flex;
    width: 22px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
}

.profile-rail__flag {
    display: block;
    width: 14px;
    height: 14px;
}

.profile-rail__flag--warning {
    color: var(--status-warning);
}

.profile-rail__flag--error {
    color: var(--status-danger);
}
</style>
