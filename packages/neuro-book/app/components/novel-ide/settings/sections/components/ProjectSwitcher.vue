<script setup lang="ts">
import {computed} from "vue";
import {FormSelect} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";

/**
 * 项目切换：设置界面的「项目」作用域里，左栏这一行不再是只读标签，而是可切换的项目选择。
 * 只负责选择动作，项目清单与当前项都由宿主给（视图不读 store、不发请求）。
 */
const props = withDefaults(defineProps<{
    /** 可切换的项目 */
    projects: Array<{id: string; name: string}>;
    /** 当前项目 id；null = 尚未确定 */
    modelValue: string | null;
    disabled?: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:modelValue", value: string): void;
}>();

const {t} = useI18n();

const options = computed<FormSelectOption[]>(() => props.projects.map((project) => ({
    value: project.id,
    label: project.name,
})));
</script>

<template>
    <div class="flex min-w-0 shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--divider)] pb-[var(--space-3)]">
        <span class="i-lucide-folder-cog h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
        <FormSelect
            class="min-w-0 flex-1"
            :model-value="props.modelValue ?? ''"
            :options="options"
            :placeholder="t('settings.panels.projectSwitcher.placeholder')"
            :aria-label="t('settings.panels.projectSwitcher.label')"
            :disabled="props.disabled || props.projects.length === 0"
            @update:model-value="emit('update:modelValue', $event)"
        />
    </div>
</template>
