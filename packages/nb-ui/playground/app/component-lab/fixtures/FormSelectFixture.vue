<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {
    SelectContent,
    SelectItem,
    SelectItemIndicator,
    SelectItemText,
    SelectPortal,
    SelectRoot,
    SelectTrigger,
    SelectViewport,
} from "reka-ui";
import {NB_Z_INDEX} from "../../../../src/theme/z-index";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import FormCheckbox from "../../../../src/components/form/FormCheckbox.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, getLabScene, type LabComponentDefinition} from "../registry";
import type {FormSelectOption} from "../../../../src/components/form/FormSelect.vue";
import {useFloatingScrollbar} from "../../../../src/composables/useFloatingScrollbar";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

// 锁定用户黄金参数：65% 面色、8px 模糊、130% 饱和、1.0 亮度
const customOpacity = ref(65);
const customBlur = ref(8);
const customSaturate = ref(130);
const customBrightness = ref(100);

// 虚化与提示模式对比切换
const fadeMode = ref<"alpha" | "pill" | "depth" | "clean">("alpha");
const fadeModeOptions = [
    {label: "模式 1: Alpha 纯净透光渐隐 (推荐)", value: "alpha"},
    {label: "模式 2: macOS 悬浮指示胶囊", value: "pill"},
    {label: "模式 3: 景深柔润消融", value: "depth"},
    {label: "模式 4: 经典硬边齐腰半截", value: "clean"},
];

// 数据集切换：默认 14 项长列表方便直接验收
const dataPreset = ref<"long" | "search" | "format">("long");
const presetOptions = [
    {label: "14 项长列表滚动 (重点验收)", value: "long"},
    {label: "搜索建议 (对齐图二)", value: "search"},
    {label: "常用文档格式 (7 项)", value: "format"},
];

// 截断高度方案切换：以 50% 齐腰横截为黄金标准，确保底部永远只露出严格半个 item
const heightScheme = ref<"h5_mid" | "h6_mid" | "h5_base" | "h6_base" | "custom">("h5_mid");
const heightSchemeOptions = [
    {label: "5.5项严格截半(194px·推荐)", value: "h5_mid"},
    {label: "6.5项严格截半(228px)", value: "h6_mid"},
    {label: "5.5项基线横截(196px)", value: "h5_base"},
    {label: "6.5项基线横截(230px)", value: "h6_base"},
    {label: "自定义高度", value: "custom"},
];
const customViewportHeight = ref(194);

const activeViewportHeight = computed(() => {
    // 选项不足以产生截半溢出时自然展开；超出 5 项时长列表一律锁定黄金截半高度
    if (currentOptions.value.length <= 5) return "auto";
    if (heightScheme.value === "h5_mid") return "194px";
    if (heightScheme.value === "h6_mid") return "228px";
    if (heightScheme.value === "h5_base") return "196px";
    if (heightScheme.value === "h6_base") return "230px";
    return `${customViewportHeight.value}px`;
});

const useChevronPill = ref(false);

const selectedSearch = ref("today");
const selectedFormat = ref("docx");
const selectedLong = ref("docx");

const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));

/** 场景属性「展开方向」驱动被测 Reka Select 的定位；auto 交给 popper 碰撞自动判定 */
const resolvedSide = computed<"top" | "bottom" | undefined>(() => {
    if (controls.value.direction === "up") return "top";
    if (controls.value.direction === "down") return "bottom";
    return undefined;
});

const searchOptions: FormSelectOption[] = [
    {label: "New York trip", value: "today", description: "today", iconClass: "i-lucide-search"},
    {label: "Sender contains: New York trip", value: "sender", iconClass: "i-lucide-user"},
    {label: "Subject contains: New York trip", value: "subject", iconClass: "i-lucide-mail"},
    {label: "Attachment name contains: New York trip", value: "attachment", iconClass: "i-lucide-paperclip"},
];

const formatOptions: FormSelectOption[] = [
    {label: "Markdown（.md）", value: "md", iconClass: "i-lucide-file-text"},
    {label: "纯文本（.txt）", value: "txt", iconClass: "i-lucide-file"},
    {label: "富文本（.rtf）", value: "rtf", iconClass: "i-lucide-file-type"},
    {label: "Word 文档（.docx）", value: "docx", iconClass: "i-lucide-file-text"},
    {label: "EPUB 电子书（.epub）", value: "epub", iconClass: "i-lucide-book-open"},
    {label: "HTML 网页（.html）", value: "html", iconClass: "i-lucide-globe"},
    {label: "PDF 文档（暂不可用）", value: "pdf", disabled: true, iconClass: "i-lucide-file-x"},
];

const longOptions: FormSelectOption[] = [
    {label: "Markdown（.md）", value: "md", iconClass: "i-lucide-file-text"},
    {label: "纯文本（.txt）", value: "txt", iconClass: "i-lucide-file"},
    {label: "富文本（.rtf）", value: "rtf", iconClass: "i-lucide-file-type"},
    {label: "Word 文档（.docx）", value: "docx", iconClass: "i-lucide-file-text"},
    {label: "EPUB 电子书（.epub）", value: "epub", iconClass: "i-lucide-book-open"},
    {label: "HTML 网页（.html）", value: "html", iconClass: "i-lucide-globe"},
    {label: "LaTeX 源码（.tex）", value: "tex", iconClass: "i-lucide-code"},
    {label: "JSON 数据（.json）", value: "json", iconClass: "i-lucide-database"},
    {label: "YAML 配置文件（.yaml）", value: "yaml", iconClass: "i-lucide-settings"},
    {label: "CSV 电子表格（.csv）", value: "csv", iconClass: "i-lucide-table"},
    {label: "XML 格式数据（.xml）", value: "xml", iconClass: "i-lucide-file-code"},
    {label: "OpenDocument（.odt）", value: "odt", iconClass: "i-lucide-file-type"},
    {label: "FictionBook（.fb2）", value: "fb2"},
    {label: "PDF 文档（暂不可用）", value: "pdf", disabled: true},
];

const currentOptions = computed(() => {
    if (dataPreset.value === "search") return searchOptions;
    if (dataPreset.value === "long") return longOptions;
    return formatOptions;
});

const currentModelValue = computed({
    get(): string {
        if (dataPreset.value === "search") return selectedSearch.value;
        if (dataPreset.value === "long") return selectedLong.value;
        return selectedFormat.value;
    },
    set(v: string) {
        if (dataPreset.value === "search") selectedSearch.value = v;
        else if (dataPreset.value === "long") selectedLong.value = v;
        else selectedFormat.value = v;
        report("update:modelValue", {value: v});
    },
});

function getLabel(val: string): string {
    return currentOptions.value.find((o) => o.value === val)?.label ?? "Word 文档（.docx）";
}

const dynamicPopoverStyle = computed(() => ({
    zIndex: NB_Z_INDEX.popover,
    width: "var(--reka-select-trigger-width)",
    minWidth: "var(--reka-select-trigger-width)",
    backgroundColor: `color-mix(in srgb, var(--bg-panel) ${customOpacity.value}%, transparent)`,
    backdropFilter: `blur(${customBlur.value}px) saturate(${customSaturate.value}%) brightness(${customBrightness.value / 100})`,
    WebkitBackdropFilter: `blur(${customBlur.value}px) saturate(${customSaturate.value}%) brightness(${customBrightness.value / 100})`,
}));

// ---------- 100% 绝对可见 + 100% 鼠标完全可拖拽的 macOS 悬浮滚动条 ----------
const {
    scrollThumbTop,
    scrollThumbHeight,
    isScrollable,
    isDragging,
    isScrolledFromTop,
    isScrolledToBottom,
    setViewportRef,
    handleViewportScroll,
    handleThumbMouseDown,
} = useFloatingScrollbar();

// 智能双向感知渐隐：刚打开时顶部 100% 实体纯净；向下滚动后顶部自动消隐；到底后底部自动转为实体
const dynamicMaskStyle = computed(() => {
    // 只有在内容未填满且无需滚动时才不加遮罩
    if (!isScrollable.value && currentOptions.value.length <= 5) {
        return {};
    }
    const topFade = isScrolledFromTop.value;
    const bottomFade = !isScrolledToBottom.value;

    if (!topFade && !bottomFade) {
        return {};
    }

    if (fadeMode.value === "alpha" || fadeMode.value === "depth") {
        // 遮罩宽度必须达到 22px，确保能够完全覆盖露出 15~16px 的半个 item，文字在半项处柔润消散
        const fadePx = fadeMode.value === "alpha" ? 22 : 36;
        const midPx = Math.round(fadePx * 0.4);

        const topStops = topFade
            ? `transparent 0%, rgba(0, 0, 0, 0.35) ${midPx}px, #000000 ${fadePx}px`
            : "#000000 0%";
        const bottomStops = bottomFade
            ? `#000000 calc(100% - ${fadePx}px), rgba(0, 0, 0, 0.35) calc(100% - ${midPx}px), transparent 100%`
            : "#000000 100%";

        const mask = `linear-gradient(to bottom, ${topStops}, ${bottomStops})`;
        return {
            WebkitMaskImage: mask,
            maskImage: mask,
        };
    }
    return {};
});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
}

function report(name: string, payload?: unknown): void {
    if (!props.definition.events.includes(name)) return;
    emit("lab-event", name, payload);
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

onMounted(() => void nextTick(() => emit("rendered")));
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <!-- 顶层控制面板 -->
        <div class="mb-6 flex flex-col gap-3">
            <!-- 顶层控制面板：高度与提示方案 -->
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--text-secondary)]">截断高度基准:</span>
                    <SegmentedControl
                        v-model="heightScheme"
                        :options="heightSchemeOptions"
                        size="sm"
                    />
                </div>
                <div v-if="heightScheme === 'custom'" class="flex items-center gap-2">
                    <span class="text-xs text-[var(--text-muted)] font-mono">{{ customViewportHeight }}px</span>
                    <input
                        v-model.number="customViewportHeight"
                        type="range"
                        min="170"
                        max="260"
                        step="1"
                        class="w-28 cursor-pointer accent-[var(--accent-main)]"
                    />
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--text-secondary)]">底部提示方案:</span>
                    <SegmentedControl
                        v-model="fadeMode"
                        :options="fadeModeOptions"
                        size="sm"
                    />
                </div>
                <div class="flex items-center gap-4">
                    <SegmentedControl
                        v-model="dataPreset"
                        :options="presetOptions"
                        size="sm"
                    />
                    <FormCheckbox
                        v-model="useChevronPill"
                        label="胶囊箭头"
                    />
                </div>
            </div>

            <!-- 说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">当前方案</span>
                    <span v-if="fadeMode === 'alpha'" class="scheme-banner-text">
                        <strong>模式 1：Alpha 纯净透光渐隐（内联硬件 Mask 实装生效）</strong>：文字与图标自身透明度向底边平滑消散为 0，底部的 4K 磨砂玻璃背景 100% 保持晶莹纯粹，没有任何死白雾色块污染。
                    </span>
                    <span v-else-if="fadeMode === 'pill'" class="scheme-banner-text">
                        <strong>模式 2：macOS 悬浮指示胶囊</strong>：底部悬浮极简半透向下微箭头胶囊，滑动到底部自动隐去，直观指引向下滚动。
                    </span>
                    <span v-else-if="fadeMode === 'depth'" class="scheme-banner-text">
                        <strong>模式 3：景深柔润消融（宽幅 64px 消散梯度）</strong>：结合更宽幅的 Alpha 消隐，产生极强的大光圈景深散焦感。
                    </span>
                    <span v-else-if="fadeMode === 'clean'" class="scheme-banner-text">
                        <strong>模式 4：经典硬边齐腰半截</strong>：0 渐变遮罩，完全依靠精确的 50% 齐腰横截线条传递视觉线索。
                    </span>
                </div>
            </div>
        </div>

        <!-- 紧凑 macOS 容器卡片 -->
        <div class="macos-compact-card">
            <!-- 容器标题栏 -->
            <div class="mb-3 flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">导出文档设置</h3>
                    <p class="text-xs text-[var(--text-muted)]">半透明纯白磨砂面板，悬浮于窗口与桌面之上。</p>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-main)]">
                    {{ customOpacity }}% 面色 · 14 项长列表
                </span>
            </div>

            <!-- 输入控件 -->
            <div class="stage-box">
                <SelectRoot v-model="currentModelValue">
                    <!-- 原版原生标准 Trigger 输入框：与 FormInput 严格共用 .nb-ui-control 基类 -->
                    <SelectTrigger
                        id="nb-lab-target"
                        class="nb-ui-control nb-ui-control-h-md nb-ui-control-px border flex w-full items-center justify-between rounded-[var(--radius-control)] bg-[var(--control-surface)] text-[var(--text-sm)] text-[var(--text-main)] outline-none cursor-pointer user-select-none disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="Boolean(controls.disabled) || scene.disabled === true"
                    >
                        <div class="flex min-w-0 items-center gap-2 pr-2">
                            <span v-if="dataPreset === 'search'" class="i-lucide-search h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]"></span>
                            <span class="truncate text-left text-[var(--text-main)] text-[13.5px]">
                                {{ getLabel(currentModelValue) }}
                            </span>
                        </div>

                        <!-- 箭头部分 -->
                        <span v-if="useChevronPill" class="trigger-chevron-pill" aria-hidden="true">
                            <span class="i-lucide-chevron-down h-3.5 w-3.5 transition-transform [transition-duration:var(--motion-fast)] data-[state=open]:rotate-180"></span>
                        </span>
                        <span
                            v-else
                            class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform [transition-duration:var(--motion-fast)] data-[state=open]:rotate-180"
                            aria-hidden="true"
                        ></span>
                    </SelectTrigger>

                    <!-- 下拉浮层 -->
                    <SelectPortal>
                        <SelectContent
                            position="popper"
                            :side="resolvedSide"
                            :body-lock="false"
                            :disable-outside-pointer-events="false"
                            :side-offset="7"
                            :style="dynamicPopoverStyle"
                            class="dynamic-popover-panel relative overflow-hidden p-1.5"
                            @close-auto-focus="(event) => event.preventDefault()"
                        >
                            <!-- 滚动视口：直接绑定动态 mask 属性，100% 穿透生效 -->
                            <SelectViewport
                                :ref="setViewportRef"
                                class="clean-scroll-viewport w-full"
                                :class="isScrollable ? 'pr-1.5' : ''"
                                :style="[
                                    {
                                        height: activeViewportHeight,
                                        maxHeight: activeViewportHeight,
                                    },
                                    dynamicMaskStyle,
                                ]"
                                @scroll="handleViewportScroll"
                            >
                                <SelectItem
                                    v-for="opt in currentOptions"
                                    :key="opt.value"
                                    :value="opt.value"
                                    :disabled="opt.disabled"
                                    class="clean-item flex items-center justify-between px-2.5 py-1.5 text-[13px] rounded-[5px] cursor-pointer outline-none select-none mb-1 last:mb-0"
                                    :class="[
                                        currentModelValue === opt.value ? 'is-active-item' : '',
                                    ]"
                                >
                                    <div class="flex min-w-0 items-center gap-2.5">
                                        <span
                                            v-if="opt.iconClass"
                                            :class="opt.iconClass"
                                            class="h-3.5 w-3.5 shrink-0 transition-colors"
                                            :style="{color: currentModelValue === opt.value ? 'var(--text-main)' : 'var(--text-secondary)'}"
                                        ></span>
                                        <SelectItemText class="truncate text-[var(--text-main)]">{{ opt.label }}</SelectItemText>
                                    </div>
                                    <div class="flex items-center gap-1.5 shrink-0 pl-2">
                                        <span
                                            v-if="opt.description"
                                            class="text-xs transition-colors"
                                            :style="{color: currentModelValue === opt.value ? 'var(--accent-text)' : 'var(--text-muted)'}"
                                        >{{ opt.description }}</span>
                                        <SelectItemIndicator v-if="!controls.hideCheckmark">
                                            <span class="i-lucide-check h-3.5 w-3.5 text-[var(--accent-main)]"></span>
                                        </SelectItemIndicator>
                                    </div>
                                </SelectItem>
                            </SelectViewport>

                            <!-- 模式 2：macOS 原生悬浮向下指示胶囊（精致半透微胶囊） -->
                            <div
                                v-if="dataPreset === 'long' && fadeMode === 'pill' && !isScrolledToBottom"
                                class="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-full px-2.5 py-0.5 bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] backdrop-blur-md border border-[color-mix(in_srgb,var(--border-color)_80%,transparent)] shadow-sm animate-bounce [animation-duration:1.8s]"
                                aria-hidden="true"
                            >
                                <span class="i-lucide-chevron-down h-3 w-3 text-[var(--text-secondary)]"></span>
                                <span class="text-[10px] font-medium text-[var(--text-secondary)]">向下滑动</span>
                            </div>

                            <!-- 100% 绝对可见、100% 鼠标完全可按住拖拽的 macOS 4px 悬浮胶囊滑块 -->
                            <div
                                v-if="isScrollable"
                                class="absolute right-[3px] top-1.5 bottom-1.5 w-1 z-20 flex flex-col justify-start"
                            >
                                <div
                                    class="w-1 rounded-full cursor-pointer transition-colors"
                                    :class="isDragging ? 'bg-[color-mix(in_srgb,var(--text-main)_75%,transparent)]' : 'bg-[color-mix(in_srgb,var(--text-main)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-main)_70%,transparent)]'"
                                    :style="{
                                        height: `${scrollThumbHeight}px`,
                                        transform: `translateY(${scrollThumbTop}px)`,
                                    }"
                                    @mousedown="handleThumbMouseDown"
                                ></div>
                            </div>
                        </SelectContent>
                    </SelectPortal>
                </SelectRoot>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.scheme-banner {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--bg-panel) 70%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
}
.scheme-pill {
    font-size: 11px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    background: var(--accent-main);
    color: #ffffff;
    flex-shrink: 0;
}
.scheme-banner-text {
    font-size: var(--text-xs);
    color: var(--text-main);
    line-height: 1.4;
}

/* 紧凑 macOS 卡片容器 */
.macos-compact-card {
    width: 100%;
    max-width: 480px;
    margin: var(--space-3) auto 0;
    padding: var(--space-5) var(--space-6);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg-panel) 75%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
    box-shadow: 0 20px 48px -12px color-mix(in srgb, var(--shadow-color) 26%, transparent),
                0 2px 8px color-mix(in srgb, var(--shadow-color) 8%, transparent);
}

.stage-box {
    position: relative;
    width: 100%;
    margin-top: var(--space-2);
}

/* 胶囊箭头样式 */
.trigger-chevron-pill {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
    color: var(--accent-main);
    flex-shrink: 0;
    transition: background-color var(--motion-fast) var(--ease-standard);
}
.clean-trigger[data-state="open"] .trigger-chevron-pill {
    background: var(--accent-main);
    color: #ffffff;
}

/* ---------- macOS 原生微缩放展开收起动画 ---------- */
@keyframes macos-dropdown-enter {
    0% {
        opacity: 0;
        transform: scale(0.96) translateY(-4px);
    }
    100% {
        opacity: 1;
        transform: scale(1) translateY(0);
    }
}

@keyframes macos-dropdown-exit {
    0% {
        opacity: 1;
        transform: scale(1) translateY(0);
    }
    100% {
        opacity: 0;
        transform: scale(0.97) translateY(-2px);
    }
}

/* 动态 Popover 面板外框 + 动画挂载 */
:global(.dynamic-popover-panel) {
    border-radius: 10px !important;
    border: 1px solid color-mix(in srgb, var(--text-main) 12%, transparent) !important;
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent),
        0 6px 16px -2px color-mix(in srgb, var(--shadow-color) 16%, transparent),
        0 20px 48px -4px color-mix(in srgb, var(--shadow-color) 28%, transparent),
        0 36px 80px -8px color-mix(in srgb, var(--shadow-color) 20%, transparent) !important;
    transform-origin: var(--reka-select-content-transform-origin, top center);
}

:global(.dynamic-popover-panel[data-state="open"]) {
    animation: macos-dropdown-enter var(--motion-enter, 140ms) cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

:global(.dynamic-popover-panel[data-state="closed"]) {
    animation: macos-dropdown-exit var(--motion-fast, 90ms) cubic-bezier(0.4, 0, 1, 1) forwards;
}

/* 丝滑半透 Hover 态 */
.clean-item {
    color: var(--text-main);
    transition: background-color var(--motion-fast) var(--ease-standard),
                color var(--motion-fast) var(--ease-standard);
}

.clean-item:hover,
.clean-item[data-highlighted] {
    background-color: color-mix(in srgb, var(--text-main) 8%, transparent) !important;
}

.clean-item.is-active-item,
.clean-item[data-state="checked"] {
    background-color: color-mix(in srgb, var(--accent-main) 14%, transparent) !important;
    color: var(--text-main);
    font-weight: 500;
}

.clean-item[data-state="checked"]:hover,
.clean-item[data-state="checked"][data-highlighted] {
    background-color: color-mix(in srgb, var(--accent-main) 20%, transparent) !important;
}

.clean-item[data-disabled] {
    opacity: 0.4;
    cursor: not-allowed;
}

/* 视口基础滚动 */
.clean-scroll-viewport {
    overflow-y: auto !important;
    overscroll-behavior: contain !important;
    scrollbar-width: none !important;
}

.clean-scroll-viewport::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
}
</style>
