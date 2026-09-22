<script setup lang="ts">
import {computed, ref, inject} from "vue";
import {
    PopoverContent,
    PopoverPortal,
    PopoverRoot,
    PopoverTrigger,
} from "reka-ui";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";
import Button from "../controls/Button.vue";

/** 窗口内的浮层跟随窗口层级（由 DialogWindow 注入）；未被窗口承载时回退到普通页面层级。 */
const popoverZIndex = inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);


const props = withDefaults(defineProps<{
    modelValue?: string;
    defaultValue?: string;
    disabled?: boolean;
    readonly?: boolean;
    swatches?: string[];
    showInput?: boolean;
    size?: "sm" | "md";
}>(), {
    modelValue: undefined,
    defaultValue: "#3B82F6",
    disabled: false,
    readonly: false,
    swatches: () => [
        "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899", "#EF4444",
        "#F59E0B", "#10B981", "#06B6D4", "#64748B", "#1E293B",
    ],
    showInput: true,
    size: "md",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
}>();

const isOpen = ref(false);
const currentColor = computed(() => props.modelValue ?? props.defaultValue);

function selectColor(color: string): void {
    if (props.disabled || props.readonly) return;
    emit("update:modelValue", color);
}

function handleInput(e: Event): void {
    const val = (e.target as HTMLInputElement).value;
    if (val) emit("update:modelValue", val);
}
</script>

<template>
    <PopoverRoot v-model:open="isOpen">
        <PopoverTrigger as-child>
            <div
                class="nb-ui-control nb-ui-focus-ring inline-flex items-center gap-2 rounded-[var(--radius-control)] border bg-[var(--bg-panel)] px-2 transition-colors [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-40"
                :class="props.size === 'sm' ? 'nb-ui-control-h-sm text-xs' : 'nb-ui-control-h-md text-sm'"
                :aria-disabled="props.disabled"
            >
                <!-- 颜色方块 Swatch -->
                <span
                    class="h-4 w-4 shrink-0 rounded-[calc(var(--radius-control)*0.6)] border border-[color-mix(in_srgb,var(--text-main)_20%,transparent)] shadow-sm"
                    :style="{backgroundColor: currentColor}"
                />
                <span class="font-mono text-xs text-[var(--text-main)] uppercase">{{ currentColor }}</span>
            </div>
        </PopoverTrigger>

        <PopoverPortal>
            <PopoverContent
                :side-offset="6"
                :style="{
                    zIndex: popoverZIndex,
                }"
                class="nb-ui-popover-surface nb-ui-popover-motion w-56 rounded-[var(--radius-panel)] p-3 text-[var(--text-main)] outline-none select-none space-y-3"
                @close-auto-focus="(e) => e.preventDefault()"
            >
                <!-- 原生取色与实时预览 -->
                <div class="flex items-center gap-2">
                    <input
                        type="color"
                        :value="currentColor"
                        :disabled="props.disabled || props.readonly"
                        class="h-8 w-10 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] bg-transparent p-0.5"
                        @input="handleInput"
                    >
                    <input
                        type="text"
                        :value="currentColor"
                        :disabled="props.disabled || props.readonly"
                        class="nb-ui-control nb-ui-control-h-sm w-full rounded-[var(--radius-control)] border bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] px-2 font-mono text-xs text-[var(--text-main)] uppercase outline-none"
                        @input="handleInput"
                    >
                </div>

                <!-- 预设色板网格 Swatches -->
                <div v-if="props.swatches && props.swatches.length > 0" class="pt-2 border-t border-[var(--divider)]">
                    <span class="block text-[11px] font-medium text-[var(--text-muted)] mb-2">预设色板</span>
                    <div class="grid grid-cols-5 gap-1.5">
                        <button
                            v-for="color in props.swatches"
                            :key="color"
                            type="button"
                            class="relative flex h-6 w-full items-center justify-center rounded-[calc(var(--radius-control)*0.6)] border border-[color-mix(in_srgb,var(--text-main)_15%,transparent)] transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:scale-110 cursor-pointer"
                            :style="{backgroundColor: color}"
                            @click="selectColor(color)"
                        >
                            <span
                                v-if="currentColor.toLowerCase() === color.toLowerCase()"
                                class="i-lucide-check h-3.5 w-3.5 text-[var(--text-inverse)] shadow-sm"
                                aria-hidden="true"
                            />
                        </button>
                    </div>
                </div>

                <div class="flex justify-end pt-1">
                    <Button size="sm" variant="secondary" @click="isOpen = false">
                        完成
                    </Button>
                </div>
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>
