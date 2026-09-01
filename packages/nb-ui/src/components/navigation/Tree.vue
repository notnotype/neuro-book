<script setup lang="ts">
import {computed} from "vue";
import {
    TreeItem,
    TreeRoot,
} from "reka-ui";

export interface GenericTreeNode {
    id: string;
    title: string;
    iconClass?: string;
    disabled?: boolean;
    children?: GenericTreeNode[];
}

/**
 * 根节点的形状。
 *
 * 树本身是一份列表，「它是不是一张卡片」是摆放它的人才知道的事：摆进侧栏就该是裸列表，
 * 摆进空白区才需要一张卡片把它收住。默认仍是 card，因为已有调用方都依赖这个外观。
 */
export type TreeSurface = "card" | "plain";

const props = withDefaults(defineProps<{
    items?: GenericTreeNode[];
    modelValue?: string | string[];
    expanded?: string[];
    multiple?: boolean;
    disabled?: boolean;
    surface?: TreeSurface;
}>(), {
    items: () => [],
    modelValue: undefined,
    expanded: () => [],
    multiple: false,
    disabled: false,
    surface: "card",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: any): void;
    (e: "update:expanded", value: string[]): void;
    (e: "select", node: GenericTreeNode): void;
}>();

const surfaceClass = computed(() => props.surface === "card"
    ? "rounded-[var(--radius-panel)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[var(--panel-surface)] p-2 shadow-sm"
    : "p-2");
</script>

<template>
    <TreeRoot
        v-slot="{ flattenItems }"
        :items="props.items"
        :get-key="(item) => item.id"
        :get-children="(item) => item.children"
        :model-value="(props.modelValue as any)"
        :expanded="props.expanded"
        :multiple="props.multiple"
        :disabled="props.disabled"
        class="w-full select-none list-none space-y-0.5"
        :class="surfaceClass"
        @update:model-value="(val) => emit('update:modelValue', val)"
        @update:expanded="(val) => emit('update:expanded', val as string[])"
    >
        <TreeItem
            v-for="item in flattenItems"
            :key="item._id"
            v-slot="{ isExpanded, isSelected }"
            :style="{ paddingLeft: `${item.level * 16 + 8}px` }"
            :value="item.value"
            :level="item.level"
            class="nb-ui-focus-ring group flex items-center justify-between gap-2 rounded-[calc(var(--radius-control)*0.75)] py-1.5 pr-2 text-xs text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] data-[selected]:bg-[color-mix(in_srgb,var(--accent-main)_14%,transparent)] data-[selected]:text-[var(--accent-main)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            @select="emit('select', item.value)"
        >
            <div class="flex items-center gap-2 truncate">
                <!-- 展开/收起箭头 -->
                <span
                    v-if="item.hasChildren"
                    class="i-lucide-chevron-right h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]"
                    :class="isExpanded ? 'rotate-90 text-[var(--text-main)]' : ''"
                    aria-hidden="true"
                />
                <span v-else class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />

                <!-- 图标 -->
                <span
                    v-if="item.value.iconClass"
                    :class="[item.value.iconClass, 'h-4 w-4 shrink-0', isSelected ? 'text-[var(--accent-main)]' : 'text-[var(--text-muted)]']"
                    aria-hidden="true"
                />
                <span v-else-if="item.hasChildren" class="i-lucide-folder h-4 w-4 shrink-0 text-[var(--accent-main)]" aria-hidden="true" />
                <span v-else class="i-lucide-file-text h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />

                <!-- 节点标题 -->
                <span class="truncate font-medium">{{ item.value.title }}</span>
            </div>
        </TreeItem>
    </TreeRoot>
</template>
