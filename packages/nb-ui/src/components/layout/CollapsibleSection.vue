<script setup lang="ts">
import Collapsible from "./Collapsible.vue";

/**
 * 折叠区段：一条标题行 + 可折叠内容。
 *
 * 标题行是「一节」的入口而不是列表项——静止态不画描边与填色，只在悬停时给整行底色；
 * 结构固定为「图标 + 标题 + meta 徽标 + chevron」，图标与 chevron 在悬停 / 展开时转到 accent。
 * 需要裸触发器时用 `Collapsible`。
 */
const props = withDefaults(defineProps<{
    /**
     * 受控展开态。区段只支持受控：chevron 必须与内容同源，
     * 留一条没人走的非受控路径只会让箭头指向反了。
     */
    open?: boolean;
    disabled?: boolean;
    /** 标题前的图标类（i-lucide-*）；缺省不渲染图标 */
    iconClass?: string;
    /** 标题文字 */
    label: string;
}>(), {
    open: false,
    disabled: false,
    iconClass: "",
    label: "",
});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
}>();
</script>

<template>
    <Collapsible
        :open="props.open"
        :disabled="props.disabled"
        @update:open="emit('update:open', $event)"
    >
        <template #trigger>
            <button
                type="button"
                :disabled="props.disabled"
                class="group flex min-h-8 w-full select-none items-center gap-1.5 rounded-[var(--radius-control)] px-[var(--space-3)] py-1.5 text-left transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--bg-hover)_60%,transparent)] active:bg-[color-mix(in_srgb,var(--bg-hover)_85%,transparent)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
            >
                <span
                    v-if="props.iconClass"
                    :class="props.iconClass"
                    class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-colors [transition-duration:var(--motion-fast)] group-hover:text-[var(--accent-main)]"
                    aria-hidden="true"
                ></span>
                <span class="min-w-0 flex-1 truncate text-sm text-[var(--text-main)] [font-weight:var(--weight-strong)]">{{ props.label }}</span>
                <slot name="meta"></slot>
                <span
                    class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]"
                    :class="props.open ? 'rotate-180 text-[var(--accent-main)]' : ''"
                    aria-hidden="true"
                ></span>
            </button>
        </template>

        <slot></slot>
    </Collapsible>
</template>
