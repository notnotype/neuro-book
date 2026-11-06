<script setup lang="ts">
/** 标题行的动作（同名 .md）：一排 24px 图标按钮加“⋯”下拉，点了交给宿主执行。视图标题与编辑区标题共用。 */
import {DropdownMenu, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import type {TitleActionsModel} from "./title-actions";

defineOptions({name: "TitleActions"});

const props = defineProps<{
    model: TitleActionsModel;
    /** 菜单身份（拥有者定：视图标题是视图、容器与模式、交付状态、代际）：变了就关掉打开着的“⋯”，之前的选择不执行。 */
    identity: string;
    /** “⋯”的可访问名称。 */
    moreLabel: string;
}>();
const emit = defineEmits<{run: [key: string]}>();

const open = ref(false);
/** 打开时记下的身份；选择只在它与此刻相同时生效（菜单原语先报关闭、再报选择，所以关闭时不清）。 */
const origin = ref<string | null>(null);

const items = computed<DropdownMenuItemData[]>(() => props.model.menu.flatMap((section, index) => [
    ...(index > 0 ? [{label: "", id: `separator:${String(index)}`, separator: true}] : []),
    ...section.map((entry): DropdownMenuItemData => ({
        label: entry.title,
        id: entry.key,
        ...(entry.icon === null ? {} : {iconClass: entry.icon}),
        disabled: entry.disabledReason !== null,
        ...(entry.disabledReason === null ? {} : {title: entry.disabledReason}),
        ...(entry.pressed === undefined ? {} : {type: "checkbox" as const, checked: entry.pressed}),
        ...(entry.shortcut === undefined ? {} : {shortcut: entry.shortcut}),
    })),
]));

function setOpen(next: boolean): void {
    open.value = next;
    if (next) origin.value = props.identity;
}

watch(() => props.identity, () => {
    open.value = false;
    origin.value = null;
});

function select(key: string): void {
    const from = origin.value;
    origin.value = null;
    open.value = false;
    if (from !== null && from === props.identity) emit("run", key);
}
</script>

<template>
    <span class="title-actions">
        <IconButton
            v-for="entry in model.buttons"
            :key="entry.key"
            size="xs"
            :icon-class="entry.icon ?? ''"
            :aria-label="entry.title"
            :title="entry.disabledReason ?? entry.title"
            :aria-pressed="entry.pressed"
            :disabled="entry.disabledReason !== null"
            :data-title-action="entry.command"
            :data-title-action-key="entry.key"
            @click="emit('run', entry.key)"
        />
        <DropdownMenu v-if="model.menu.length > 0" :items="items" :open="open" align="end" @update:open="setOpen" @select="select">
            <IconButton size="xs" icon-class="i-lucide-ellipsis" :aria-label="moreLabel" :title="moreLabel" data-title-actions-more />
        </DropdownMenu>
    </span>
</template>

<style scoped>
.title-actions {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}
</style>
