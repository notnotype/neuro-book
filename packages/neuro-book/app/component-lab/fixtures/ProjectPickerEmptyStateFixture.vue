<script setup lang="ts">
import ProjectPickerEmptyState from "nbook/app/components/novel-ide/project-picker/components/ProjectPickerEmptyState.vue";

const emit = defineEmits<{
    (e: "event", name: string, payload?: unknown): void;
}>();
</script>

<template>
    <div class="flex h-full w-full items-center justify-center p-6 sm:p-12" data-lab-subject>
        <div class="w-full max-w-[540px]">
            <ProjectPickerEmptyState @create-book="emit('event', 'create-book')" />
        </div>
    </div>
</template>
