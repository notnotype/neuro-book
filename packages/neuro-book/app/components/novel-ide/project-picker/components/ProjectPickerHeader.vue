<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    isLoading?: boolean;
    hasLoadError?: boolean;
    isCreating?: boolean;
}>(), {
    isLoading: false,
    hasLoadError: false,
    isCreating: false,
});

const emit = defineEmits<{
    (e: "open-user-assets"): void;
    (e: "create-book"): void;
}>();

const {t} = useI18n();
</script>

<template>
    <section class="flex flex-col gap-4 border-b border-[var(--border-color)] pb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-5 sm:pb-7">
        <div class="min-w-0">
            <h1 class="font-serif text-xl font-bold tracking-tight text-[var(--text-main)] sm:text-2xl">
                {{ t("ide.picker.title") }}
            </h1>
            <p class="mt-1.5 text-xs leading-5 text-[var(--text-secondary)] sm:mt-2 sm:text-sm sm:leading-6">
                {{ t("ide.picker.subtitle") }}
            </p>
        </div>
        <div class="grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-row sm:gap-2.5">
            <Button
                type="button"
                variant="secondary"
                icon-class="i-lucide-folder-cog"
                class="justify-center sm:justify-start"
                @click="emit('open-user-assets')"
            >
                {{ t("ide.picker.openUserAssets") }}
            </Button>
            <Button
                type="button"
                variant="primary"
                icon-class="i-lucide-book-plus"
                class="justify-center sm:justify-start"
                :disabled="isLoading || hasLoadError || isCreating"
                @click="emit('create-book')"
            >
                {{ t("ide.bookshelf.createBook") }}
            </Button>
        </div>
    </section>
</template>
