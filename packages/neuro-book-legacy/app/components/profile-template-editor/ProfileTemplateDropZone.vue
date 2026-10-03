<script setup lang="ts">
import {useDroppable} from "@dnd-kit/vue";

const props = withDefaults(defineProps<{
    id: string;
    parentId: string;
    position: "inside" | "root";
    active: boolean;
    disabled?: boolean;
    label?: string;
}>(), {
    disabled: false,
    label: "拖拽组件到此处添加",
});

const elementRef = ref<HTMLElement | null>(null);

useDroppable({
    id: computed(() => props.id),
    type: "profile-template-drop-zone",
    accept: ["profile-template-node", "library-node"],
    data: computed(() => ({
        kind: "profile-template-drop" as const,
        parentId: props.parentId,
        targetId: null,
        position: props.position,
    })),
    element: elementRef,
    disabled: computed(() => props.disabled),
});
</script>

<template>
    <div ref="elementRef" class="profile-template-drop-zone" :data-active="props.active || undefined">
        <span class="i-lucide-plus h-4 w-4"></span>
        <span>{{ props.label }}</span>
    </div>
</template>
