<script setup lang="ts">
import {computed, ref, watch, onMounted, onUnmounted} from "vue";
import {onClickOutside} from "@vueuse/core";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import ModelPickerContent from "./ModelPickerContent.vue";
import type {
    ModelPickerModelItem,
    ModelPickerRoleItem,
    ModelPickerSelectionValue,
} from "./model-picker.types";

const props = withDefaults(defineProps<{
    open: boolean;
    modelValue: ModelPickerSelectionValue;
    roles?: ModelPickerRoleItem[];
    models: ModelPickerModelItem[];
    showSpecialistInPicker?: boolean;
    thinkingLevel?: ThinkingLevelDto | null;
    direction?: "up" | "down" | "auto";
    align?: "start" | "end" | "center";
    disabled?: boolean;
    triggerClass?: string;
    popoverClass?: string;
    pickerWidthClass?: string;
    pickerHeightClass?: string;
}>(), {
    roles: () => [],
    showSpecialistInPicker: false,
    thinkingLevel: null,
    direction: "auto",
    align: "start",
    disabled: false,
    triggerClass: "",
    popoverClass: "",
    pickerWidthClass: "w-[640px] max-w-[calc(100vw-32px)]",
    pickerHeightClass: "h-[470px]",
});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "update:modelValue", value: string): void;
    (e: "update:thinkingLevel", value: ThinkingLevelDto | null): void;
    (e: "select", value: string, item: ModelPickerRoleItem | ModelPickerModelItem): void;
}>();

const rootRef = ref<HTMLElement | null>(null);

// 解析当前触发按钮上显示的展示信息（图标、标签、描述）
const activeDisplay = computed(() => {
    const val = props.modelValue;
    if (!val) {
        return {
            icon: "i-lucide-cpu",
            title: "选择模型...",
            subtitle: "",
        };
    }

    if (val.startsWith("role:")) {
        const roleId = val.replace("role:", "");
        const role = props.roles.find((r) => r.id === roleId);
        if (role) {
            const bound = role.modelLabel || role.modelKey || "未配置";
            return {
                icon: role.iconClass || "i-lucide-bot",
                title: role.name,
                subtitle: bound,
            };
        }
    }

    const model = props.models.find((m) => m.key === val || m.modelId === val);
    if (model) {
        return {
            icon: model.reasoning ? "i-lucide-sparkles" : (model.input.includes("image") ? "i-lucide-eye" : "i-lucide-cpu"),
            title: model.label,
            subtitle: "",
        };
    }

    // 默认回落
    return {
        icon: "i-lucide-cpu",
        title: val,
        subtitle: "",
    };
});

const effectiveDirection = ref<"up" | "down">("up");

function computeDirection(): void {
    if (props.direction === "up" || props.direction === "down") {
        effectiveDirection.value = props.direction;
        return;
    }
    if (typeof window !== "undefined" && rootRef.value) {
        const rect = rootRef.value.getBoundingClientRect();
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceAbove < 400 && spaceBelow > spaceAbove) {
            effectiveDirection.value = "down";
        } else {
            effectiveDirection.value = "up";
        }
    }
}

watch(() => props.open, (isOpen) => {
    if (isOpen) {
        computeDirection();
    }
}, { immediate: true });

function toggleOpen(): void {
    if (props.disabled) return;
    computeDirection();
    emit("update:open", !props.open);
}

function handleClose(): void {
    emit("update:open", false);
}

function handleSelect(value: string, item: ModelPickerRoleItem | ModelPickerModelItem): void {
    emit("update:modelValue", value);
    emit("select", value, item);
    emit("update:open", false);
}

onClickOutside(rootRef, () => {
    if (props.open) {
        emit("update:open", false);
    }
});

function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && props.open) {
        event.stopPropagation();
        emit("update:open", false);
    }
}

onMounted(() => {
    window.addEventListener("keydown", handleKeydown, true);
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleKeydown, true);
});
</script>

<template>
    <div ref="rootRef" class="relative inline-flex min-w-0" :class="props.triggerClass">
        <!-- 触发按钮：方案 1 轻量胶囊按钮 (Ghost Capsule Trigger) -->
        <slot name="trigger" :toggle="toggleOpen" :active="activeDisplay">
            <button
                type="button"
                role="combobox"
                :aria-expanded="props.open"
                aria-haspopup="dialog"
                :disabled="props.disabled"
                class="nb-ui-focus-ring inline-flex h-[26px] items-center gap-1.5 rounded-[var(--radius-control)] border border-transparent px-2 py-0.5 text-xs text-[var(--text-main)] outline-none transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                @click="toggleOpen"
            >
                <div class="flex items-center gap-1.5 truncate">
                    <span :class="activeDisplay.icon" class="h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]"></span>
                    <span class="truncate font-medium">{{ activeDisplay.title }}</span>
                    <span v-if="activeDisplay.subtitle" class="truncate text-[11px] text-[var(--text-muted)]">
                        · {{ activeDisplay.subtitle }}
                    </span>
                </div>
                <span
                    class="i-lucide-chevrons-up-down h-3 w-3 shrink-0 text-[var(--text-muted)] opacity-60 transition-transform [transition-duration:var(--motion-fast)]"
                    :class="props.open ? 'rotate-180 text-[var(--accent-main)]' : ''"
                ></span>
            </button>
        </slot>

        <!-- 浮层内容面板：精致发丝反光与通透空气柔影，避免沉重黑晕 -->
        <div
            v-if="props.open"
            class="model-picker-popover-panel nb-ui-popover-motion absolute z-50 overflow-hidden rounded-2xl border border-[color:var(--panel-outline,var(--border-color))] bg-[var(--bg-panel)]/95 backdrop-blur-md"
            :class="[
                effectiveDirection === 'up' ? 'bottom-full mb-3' : 'top-full mt-3',
                props.align === 'end' ? 'right-0' : props.align === 'center' ? 'left-1/2 [translate:-50%_0]' : 'left-0',
                props.pickerWidthClass,
                props.pickerHeightClass,
                props.popoverClass,
            ]"
        >
            <ModelPickerContent
                :model-value="props.modelValue"
                :roles="props.roles"
                :models="props.models"
                :show-specialist-in-picker="props.showSpecialistInPicker"
                :thinking-level="props.thinkingLevel"
                width-class="w-full"
                height-class="h-full"
                @update:model-value="emit('update:modelValue', $event)"
                @update:thinking-level="emit('update:thinkingLevel', $event)"
                @select="handleSelect"
                @close="handleClose"
            />
        </div>
    </div>
</template>

<style scoped>
.model-picker-popover-panel {
    /* 采用多层微扩散空气柔影 + 1px 精准发丝轮廓，彻底消除原本 80px 浓黑阴影带来的脏感与压迫感 */
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--panel-outline, var(--border-color)) 75%, transparent),
        inset 0 1px 0 0 rgb(255 255 255 / 0.45),
        0 4px 12px -2px color-mix(in srgb, var(--shadow-color) 8%, transparent),
        0 14px 32px -4px color-mix(in srgb, var(--shadow-color) 10%, transparent),
        0 24px 48px -12px color-mix(in srgb, var(--shadow-color) 6%, transparent);
}
</style>
