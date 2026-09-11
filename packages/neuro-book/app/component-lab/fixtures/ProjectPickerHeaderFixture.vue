<script setup lang="ts">
import {computed, ref, watch} from "vue";
import ProjectPickerHeader from "nbook/app/components/novel-ide/project-picker/components/ProjectPickerHeader.vue";

const props = defineProps<{
    scene?: string;
    sceneId?: string;
    data?: unknown;
}>();

const emit = defineEmits<{
    (e: "event", name: string, payload?: unknown): void;
}>();

const currentScene = computed(() => props.scene ?? props.sceneId ?? "default");

const isLoading = ref(false);
const hasLoadError = ref(false);
const isCreating = ref(false);

watch(currentScene, (scene) => {
    isLoading.value = false;
    hasLoadError.value = false;
    isCreating.value = false;

    if (scene === "loading") {
        isLoading.value = true;
    } else if (scene === "creating") {
        isCreating.value = true;
    } else if (scene === "load-error") {
        hasLoadError.value = true;
    }
}, {immediate: true});
</script>

<template>
    <div
        class="flex h-full w-full items-center justify-center p-6"
        :class="currentScene === 'phone' ? 'max-w-[390px] mx-auto border-x border-[var(--border-color)]' : 'max-w-[900px] mx-auto'"
        data-lab-subject
    >
        <div class="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 shadow-sm">
            <ProjectPickerHeader
                :is-loading="isLoading"
                :has-load-error="hasLoadError"
                :is-creating="isCreating"
                @open-user-assets="emit('event', 'open-user-assets')"
                @create-book="emit('event', 'create-book')"
            />
        </div>
    </div>
</template>
