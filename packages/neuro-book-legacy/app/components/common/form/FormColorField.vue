<script setup lang="ts">
import type {CSSProperties} from "vue";
import {colord} from "colord";
import {ColorPicker} from "vue3-colorpicker";
import "vue3-colorpicker/style.css";
import {THEME_HOST_SELECTOR} from "nbook/app/utils/theme/host";

type PickerColorValue = string | {
    r: number | string;
    g: number | string;
    b: number | string;
    a?: number;
};

type PickerRgbColor = {
    r: number;
    g: number;
    b: number;
    a?: number;
};

/** 浏览器原生吸管 API（Chromium）；不支持的浏览器不渲染吸管按钮 */
type EyeDropperInstance = {
    open: (options?: {signal?: AbortSignal}) => Promise<{sRGBHex: string}>;
};
type EyeDropperConstructor = new () => EyeDropperInstance;

/** 弹层估算尺寸，仅用于翻转与视口收敛计算 */
const POPOVER_WIDTH = 276;
const POPOVER_HEIGHT = 330;

const props = withDefaults(defineProps<{
    modelValue: string;
    label?: string;
    variableName?: string;
    placeholder?: string;
    allowAlpha?: boolean;
    disabled?: boolean;
    /** 弹层调色盘配色，跟随被编辑主题的明暗模式 */
    pickerTheme?: "white" | "black";
}>(), {
    label: "",
    variableName: "",
    placeholder: "#000000",
    allowAlpha: true,
    disabled: false,
    pickerTheme: "white",
});

const emit = defineEmits<{
    (event: "update:modelValue", value: string): void;
    (event: "valid-change", value: boolean): void;
}>();

const {t} = useI18n();
const fieldRef = ref<HTMLElement | null>(null);
const swatchRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const popoverOpen = ref(false);
const popoverStyle = ref<CSSProperties>({});
const draftValue = ref(props.modelValue);
const eyeDropperCtor = ref<EyeDropperConstructor | null>(null);

const valid = computed(() => {
    return colord(draftValue.value.trim()).isValid();
});
const pickerColor = computed(() => valid.value ? draftValue.value : "#000000");
const swatchStyle = computed(() => ({
    background: valid.value
        ? draftValue.value
        : "linear-gradient(135deg, var(--bg-input) 0 25%, var(--status-danger-bg) 25% 50%, var(--bg-input) 50% 75%, var(--status-danger-bg) 75% 100%)",
}));
/** 弹层挂到主题宿主，保证消费主题变量且不被 Dialog/浮动窗口裁剪 */
const popoverTeleportTarget = computed(() => {
    return (fieldRef.value?.closest(THEME_HOST_SELECTOR) as HTMLElement | null) ?? "body";
});

/**
 * 写入输入框草稿；只有合法颜色会同步给父组件。
 */
function commitDraft(value: string): void {
    draftValue.value = value;
    const nextValid = colord(value.trim()).isValid();
    emit("valid-change", nextValid);
    if (nextValid) {
        emit("update:modelValue", value.trim());
    }
}

/**
 * 处理取色器输出，并按 alpha 需求统一成 hex 或 rgba 字符串。
 */
function updatePickerColor(value: PickerColorValue): void {
    const color = colord(normalizePickerColor(value));
    if (!color.isValid()) {
        return;
    }
    const nextValue = props.allowAlpha && color.alpha() < 1
        ? color.toRgbString()
        : color.toHex();
    commitDraft(nextValue);
}

/**
 * 第三方取色器会返回字符串或 RGB object；这里统一成 colord 可接受的输入。
 */
function normalizePickerColor(value: PickerColorValue): string | PickerRgbColor {
    if (typeof value === "string") {
        return value;
    }
    return {
        r: Number(value.r),
        g: Number(value.g),
        b: Number(value.b),
        a: value.a,
    };
}

/**
 * 按触发色块位置计算弹层 fixed 坐标，越界时向上翻转、横向收敛进视口。
 */
function openPopover(): void {
    if (props.disabled || !swatchRef.value) {
        return;
    }
    const rect = swatchRef.value.getBoundingClientRect();
    const openUp = rect.bottom + POPOVER_HEIGHT + 8 > window.innerHeight && rect.top - POPOVER_HEIGHT - 8 > 0;
    const left = Math.min(Math.max(rect.left, 8), Math.max(window.innerWidth - POPOVER_WIDTH - 8, 8));
    popoverStyle.value = openUp
        ? {left: `${left}px`, bottom: `${window.innerHeight - rect.top + 6}px`}
        : {left: `${left}px`, top: `${rect.bottom + 6}px`};
    popoverOpen.value = true;
}

/**
 * 切换弹层显隐。
 */
function togglePopover(): void {
    if (popoverOpen.value) {
        popoverOpen.value = false;
        return;
    }
    openPopover();
}

/**
 * 调用浏览器原生吸管，从屏幕取色。用户 Esc 取消时静默忽略。
 */
async function pickFromScreen(): Promise<void> {
    const ctor = eyeDropperCtor.value;
    if (!ctor || props.disabled) {
        return;
    }
    try {
        const result = await new ctor().open();
        commitDraft(result.sRGBHex);
    } catch {
        // 用户取消吸管（AbortError），无需提示
    }
}

/**
 * 弹层打开期间，容器滚动或视口尺寸变化时关闭弹层，避免坐标漂移。
 */
function closeOnViewportChange(): void {
    if (popoverOpen.value) {
        popoverOpen.value = false;
    }
}

/**
 * 弹层打开期间捕获 Esc：只关弹层，不冒泡到外层 Dialog/浮动窗口。
 */
function handlePopoverKeydown(event: KeyboardEvent): void {
    if (popoverOpen.value && event.key === "Escape") {
        event.stopPropagation();
        popoverOpen.value = false;
    }
}

onClickOutside(popoverRef, () => {
    popoverOpen.value = false;
}, {ignore: [swatchRef]});

useEventListener(() => import.meta.client ? document : null, "scroll", closeOnViewportChange, {capture: true, passive: true});
useEventListener(() => import.meta.client ? window : null, "resize", closeOnViewportChange, {passive: true});
useEventListener(() => import.meta.client ? document : null, "keydown", handlePopoverKeydown, {capture: true});

onMounted(() => {
    eyeDropperCtor.value = (globalThis as typeof globalThis & {EyeDropper?: EyeDropperConstructor}).EyeDropper ?? null;
});

watch(() => props.modelValue, (value) => {
    if (value !== draftValue.value) {
        draftValue.value = value;
    }
});

watch(() => props.disabled, (disabled) => {
    if (disabled) {
        popoverOpen.value = false;
    }
});
</script>

<template>
    <!-- 通用颜色字段 -->
    <div ref="fieldRef" class="form-color-field block">
        <span v-if="label || variableName" class="mb-1.5 flex min-w-0 items-center justify-between gap-3">
            <span v-if="label" class="truncate text-xs font-medium text-[var(--text-secondary)]">{{ label }}</span>
            <code v-if="variableName" class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ variableName }}</code>
        </span>

        <span class="flex h-9 items-center gap-2 rounded-md border bg-[var(--bg-input)] px-1.5 transition-colors" :class="valid ? 'border-[var(--border-color)] focus-within:border-[var(--accent-main)]' : 'border-[var(--status-danger-border)]'">
            <!-- 色块按钮：打开调色盘弹层 -->
            <button ref="swatchRef" type="button" class="relative h-6 w-6 shrink-0 overflow-hidden rounded border border-[var(--border-color)] shadow-sm transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60" :title="t('common.colorFieldOpenPicker')" :disabled="disabled" @click="togglePopover">
                <span class="nb-color-checkerboard absolute inset-0"></span>
                <span class="absolute inset-0" :style="swatchStyle"></span>
            </button>
            <input
                class="min-w-0 flex-1 bg-transparent text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                :value="draftValue"
                :placeholder="placeholder"
                :disabled="disabled"
                spellcheck="false"
                @input="commitDraft(($event.target as HTMLInputElement).value)"
            >
            <!-- 吸管按钮：仅支持原生 EyeDropper 的浏览器显示 -->
            <button v-if="eyeDropperCtor" type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-60" :title="t('common.colorFieldEyedropper')" :disabled="disabled" @click="void pickFromScreen()">
                <span class="i-lucide-pipette h-3.5 w-3.5"></span>
            </button>
        </span>

        <span v-if="draftValue && !valid" class="mt-1 block text-[11px] text-[var(--status-danger)]">{{ t("common.colorFieldInvalid") }}</span>

        <!-- 调色盘弹层：teleport 到主题宿主，fixed 定位不受滚动容器裁剪 -->
        <Teleport :to="popoverTeleportTarget">
            <div v-if="popoverOpen" ref="popoverRef" class="nb-color-popover fixed z-[9400] rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-2" :style="popoverStyle">
                <ClientOnly>
                    <ColorPicker
                        is-widget
                        picker-type="chrome"
                        :pure-color="pickerColor"
                        :format="allowAlpha ? 'rgb' : 'hex'"
                        :disable-alpha="!allowAlpha"
                        :disable-history="true"
                        :theme="pickerTheme"
                        lang="ZH-cn"
                        @update:pure-color="updatePickerColor"
                    />
                </ClientOnly>
            </div>
        </Teleport>
    </div>
</template>

<style scoped>
/* 透明色底纹：alpha 颜色时透出棋盘格 */
.nb-color-checkerboard {
    background-image: conic-gradient(var(--border-color) 0 25%, transparent 0 50%, var(--border-color) 0 75%, transparent 0);
    background-size: 8px 8px;
    opacity: 0.6;
}

.nb-color-popover {
    box-shadow:
        0 12px 32px color-mix(in srgb, var(--shadow-color) 24%, transparent),
        0 2px 8px color-mix(in srgb, var(--shadow-color) 12%, transparent);
}

/* 内嵌 widget 模式去掉库自带的外框阴影，由弹层容器统一承担 */
.nb-color-popover :deep(.vc-colorpicker) {
    box-shadow: none;
    background: transparent;
}
</style>
