<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref} from "vue";

import type {ProfileView} from "../profile-view";
import {useAgentPageText} from "../text";

/** Profile 设置页的左栏（同名 .md）。 */
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
                    @click="emit('select', item.key)"
                >
                    <span :class="item.icon" class="profile-rail__icon" aria-hidden="true" />
                    <span class="profile-rail__text">
                        <span class="profile-rail__name">{{ item.name }}</span>
                        <span :class="`profile-rail__status profile-rail__status--${item.statusText?.tone ?? 'muted'}`">{{ item.statusText?.text ?? item.source }}</span>
                    </span>
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
    padding: 0 var(--space-3) 0 var(--space-2);
    overflow-y: auto;
    border-right: var(--border-w) solid var(--divider);
}

.profile-rail__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.profile-rail__title {
    margin-top: var(--space-3);
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.profile-rail__item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
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

.profile-rail__text {
    display: flex;
    min-width: 0;
    flex-direction: column;
}

.profile-rail__name {
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.profile-rail__status {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.profile-rail__status--warning {
    color: var(--status-warning);
}

.profile-rail__status--error {
    color: var(--status-danger);
}
</style>
