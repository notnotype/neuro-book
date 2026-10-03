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
    <section class="picker-header-section">
        <div class="min-w-0 flex-1">
            <h1 class="picker-header-title">
                {{ t("ide.picker.title") }}
            </h1>
        </div>
        <div class="picker-header-actions">
            <Button
                type="button"
                variant="secondary"
                icon-class="i-lucide-folder-cog"
                class="justify-center"
                @click="emit('open-user-assets')"
            >
                {{ t("ide.picker.openUserAssets") }}
            </Button>
            <Button
                type="button"
                variant="primary"
                icon-class="i-lucide-book-plus"
                class="justify-center"
                :disabled="isLoading || hasLoadError || isCreating"
                @click="emit('create-book')"
            >
                {{ t("ide.bookshelf.createBook") }}
            </Button>
        </div>
    </section>
</template>

<style scoped>
.picker-header-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 1.25rem;
}

.picker-header-title {
    font-family: var(--font-serif, serif);
    font-size: 1.25rem;
    line-height: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.025em;
    color: var(--text-main);
}

.picker-header-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    width: 100%;
    flex-shrink: 0;
}

@container (min-width: 580px) {
    .picker-header-section {
        flex-direction: row;
        align-items: flex-end;
        justify-content: space-between;
        gap: 1.25rem;
        padding-bottom: 1.75rem;
    }

    .picker-header-title {
        font-size: 1.5rem;
        line-height: 2rem;
    }

    .picker-header-actions {
        display: flex;
        width: auto;
        flex-direction: row;
        gap: 0.625rem;
    }
}
</style>
