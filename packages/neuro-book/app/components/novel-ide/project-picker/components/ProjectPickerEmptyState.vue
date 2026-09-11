<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";

defineEmits<{
    (e: "create-book"): void;
}>();

const {t} = useI18n();
</script>

<template>
    <section
        class="flex min-h-[300px] flex-col items-center justify-center rounded-[var(--radius-panel,8px)] border border-dashed border-[var(--border-color)] bg-[color-mix(in_srgb,var(--bg-panel)_40%,transparent)] px-4 py-10 text-center sm:min-h-[320px] sm:px-6 sm:py-14"
    >
        <div class="flex h-12 w-12 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--accent-main)] shadow-sm">
            <span class="i-lucide-book-open-text h-6 w-6"></span>
        </div>
        <h2 class="mt-4 text-base font-semibold text-[var(--text-main)]">{{ t("ide.picker.emptyTitle") }}</h2>
        <p class="mt-2 max-w-[420px] text-xs leading-5 text-[var(--text-secondary)] sm:text-sm sm:leading-6">{{ t("ide.picker.empty") }}</p>
        <Button
            type="button"
            variant="primary"
            icon-class="i-lucide-book-plus"
            class="mt-6"
            @click="$emit('create-book')"
        >
            {{ t("ide.bookshelf.createBook") }}
        </Button>
    </section>
</template>
