<script setup lang="ts">
import { ref, computed } from "vue";
import { onClickOutside } from "@vueuse/core";
import ReferenceSelectorPopover from "nbook/app/components/common/form/ReferenceSelectorPopover.vue";
import type { AgentTriggerMenuSection } from "nbook/app/components/novel-ide/agent/trigger-menu";
import type { SelectOption } from "nbook/app/components/common/form/FormSelect.vue";

const props = defineProps<{
    modelValue: string | null;
    options: SelectOption[];
    placeholder?: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string | null): void;
}>();

const open = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);

onClickOutside(containerRef, () => {
    open.value = false;
});

const toggle = () => {
    open.value = !open.value;
};

const displayLabel = computed(() => {
    if (!props.modelValue) return props.placeholder || "选择目标...";
    const opt = props.options.find(o => o.value === props.modelValue);
    return opt ? opt.label : props.modelValue;
});

const menuSections = computed<AgentTriggerMenuSection[]>(() => {
    return [
        {
            id: "targets",
            title: "引用目标",
            items: props.options.map(opt => ({
                id: opt.value,
                label: opt.label,
                description: opt.value,
                iconClass: "i-lucide-bookmark"
            }))
        }
    ];
});

const activeIndex = ref(0);

const onSelect = (id: string) => {
    emit("update:modelValue", id);
    open.value = false;
};
</script>

<template>
    <div ref="containerRef" class="relative flex-1 min-w-0">
        <button
            ref="triggerRef"
            type="button"
            class="flex h-7 w-full items-center justify-between rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-left text-[12px] text-[var(--text-main)] outline-none transition-colors hover:bg-[var(--bg-hover)]"
            :class="open ? '!border-[var(--accent-main)] ring-1 ring-[var(--accent-main)]/30' : ''"
            @click="toggle"
        >
            <span class="truncate pr-2" :class="!modelValue ? 'text-[var(--text-muted)] opacity-80' : ''">
                {{ displayLabel }}
            </span>
            <span class="i-lucide-chevron-down h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-200" :class="open ? '-rotate-180 text-[var(--text-main)]' : ''"></span>
        </button>

        <ReferenceSelectorPopover
            v-if="open"
            title="选择要引用的节点"
            prefix="REF"
            :sections="menuSections"
            :active-index="activeIndex"
            :anchor-element="triggerRef"
            density="compact"
            @select="onSelect"
            @hover="activeIndex = $event"
        />
    </div>
</template>
