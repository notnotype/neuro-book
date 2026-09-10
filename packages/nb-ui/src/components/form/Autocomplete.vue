<script setup lang="ts">
import {inject} from "vue";
import {
    AutocompleteAnchor,
    AutocompleteContent,
    AutocompleteEmpty,
    AutocompleteInput,
    AutocompleteItem,
    AutocompleteItemIndicator,
    AutocompletePortal,
    AutocompleteRoot,
    AutocompleteViewport,
} from "reka-ui";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";

/** 窗口内的浮层跟随窗口层级（由 DialogWindow 注入）；未被窗口承载时回退到普通页面层级。 */
const popoverZIndex = inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);


export interface AutocompleteOption {
    value: string;
    label?: string;
    description?: string;
    iconClass?: string;
    disabled?: boolean;
}

const props = withDefaults(defineProps<{
    modelValue?: string;
    defaultValue?: string;
    options?: AutocompleteOption[];
    placeholder?: string;
    disabled?: boolean;
    size?: "sm" | "md" | "lg";
}>(), {
    modelValue: undefined,
    defaultValue: "",
    options: () => [],
    placeholder: "输入关键词搜索联想...",
    disabled: false,
    size: "md",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "select", option: AutocompleteOption): void;
}>();
</script>

<template>
    <AutocompleteRoot
        :model-value="props.modelValue"
        :default-value="props.defaultValue"
        :disabled="props.disabled"
        class="relative w-full"
        @update:model-value="(val) => emit('update:modelValue', val as string)"
    >
        <AutocompleteAnchor class="relative flex w-full items-center">
            <AutocompleteInput
                :placeholder="props.placeholder"
                class="nb-ui-control nb-ui-focus-ring w-full rounded-[var(--radius-control)] border bg-[var(--bg-panel)] px-3 text-[var(--text-main)] outline-none transition-colors [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-40"
                :class="[
                    props.size === 'sm' ? 'nb-ui-control-h-sm text-xs' : '',
                    props.size === 'md' ? 'nb-ui-control-h-md text-sm' : '',
                    props.size === 'lg' ? 'nb-ui-control-h-lg text-base' : '',
                ]"
            />
        </AutocompleteAnchor>

        <AutocompletePortal>
            <AutocompleteContent
                :side-offset="4"
                :style="{
                    zIndex: popoverZIndex,
                    backgroundColor: 'color-mix(in srgb, var(--bg-panel) 90%, transparent)',
                    backdropFilter: 'blur(16px) saturate(130%) brightness(1.0)',
                    WebkitBackdropFilter: 'blur(16px) saturate(130%) brightness(1.0)',
                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent), 0 8px 24px -4px color-mix(in srgb, var(--shadow-color) 24%, transparent)',
                }"
                class="nb-ui-popover-surface nb-ui-popover-motion min-w-[220px] rounded-[var(--radius-panel)] p-1 text-[var(--text-main)] outline-none select-none"
            >
                <AutocompleteViewport class="max-h-60 overflow-y-auto p-1 space-y-0.5">
                    <AutocompleteEmpty class="py-4 text-center text-xs text-[var(--text-muted)]">
                        无匹配联想结果
                    </AutocompleteEmpty>

                    <AutocompleteItem
                        v-for="option in props.options"
                        :key="option.value"
                        :value="option.value"
                        :disabled="option.disabled"
                        class="nb-ui-focus-ring group flex items-center justify-between gap-2 rounded-[calc(var(--radius-control)*0.75)] px-2.5 py-1.5 text-xs text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] data-[highlighted]:bg-[color-mix(in_srgb,var(--accent-main)_14%,transparent)] data-[highlighted]:text-[var(--accent-main)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                        @select="emit('select', option)"
                    >
                        <div class="flex items-center gap-2 truncate">
                            <span v-if="option.iconClass" :class="[option.iconClass, 'h-4 w-4 shrink-0 text-[var(--text-muted)] group-data-[highlighted]:text-[var(--accent-main)]']" aria-hidden="true" />
                            <div class="flex flex-col truncate">
                                <span class="font-medium truncate">{{ option.label || option.value }}</span>
                                <span v-if="option.description" class="text-[11px] text-[var(--text-muted)] truncate">{{ option.description }}</span>
                            </div>
                        </div>

                        <AutocompleteItemIndicator class="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--accent-main)]">
                            <span class="i-lucide-check h-3.5 w-3.5" aria-hidden="true" />
                        </AutocompleteItemIndicator>
                    </AutocompleteItem>
                </AutocompleteViewport>
            </AutocompleteContent>
        </AutocompletePortal>
    </AutocompleteRoot>
</template>
