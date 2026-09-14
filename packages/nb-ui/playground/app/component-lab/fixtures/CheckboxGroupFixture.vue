<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import CheckboxGroup, {type CheckboxOption} from "../../../../src/components/form/CheckboxGroup.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

// 5 种不同设计方案切换
const designStyle = ref<"macos" | "minimal" | "crystal" | "tile" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 超椭圆检查器 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平勾选", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光胶囊", value: "crystal"},
    {label: "方案 4: 独立磁吸选择卡片", value: "tile"},
    {label: "方案 5: 实底工控高反差方块", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const selectedValues = ref(["epub", "toc"]);

const orientation = computed(() => (controls.value.orientation as any) || "vertical");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

const exportOptions: CheckboxOption[] = [
    {value: "epub", label: "生成 EPUB 3.0 电子书", description: "包含完整书签、元数据与封面"},
    {value: "pdf", label: "导出印刷级 PDF 文档", description: "高分辨率排版与自适应出血线"},
    {value: "toc", label: "自动生成多级目录与大纲索引", description: "方便快速章节定位与跳转"},
    {value: "watermark", label: "添加作品防盗版权水印", description: "在页脚嵌入作者签名与唯一哈希"},
];

function selectAll(): void {
    selectedValues.value = exportOptions.map(o => o.value);
    emit("lab-event", "update:modelValue", selectedValues.value);
}

function clearAll(): void {
    selectedValues.value = [];
    emit("lab-event", "update:modelValue", selectedValues.value);
}

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    selectedValues.value = ["epub", "toc"];
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

onMounted(() => void nextTick(() => emit("rendered")));
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <!-- 顶层设计风格切换栏 -->
        <div class="mb-6 flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">CheckboxGroup 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击各复选框体验多选联动与全选/清空</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 超椭圆检查器（推荐）</strong>——`rounded-[5px]` Squircle；14% 浅灰实底 + 纯正 Apple 蓝底白勾，按压 <code>active:scale-[0.92]</code>，矢量对勾缩放弹出。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平勾选</strong>——无实心外底；常态仅 1px 极细微边框，选中态底色跃升至 <strong>16% 柔和蓝底</strong>。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光胶囊</strong>——选中条目浮现 <strong>3.5px 品牌柔和环境弥散光晕</strong>，晶体质感。
                    </span>
                    <span v-else-if="designStyle === 'tile'" class="scheme-banner-text">
                        <strong>方案 4：独立磁吸选择卡片</strong>——每个多选项封装为独立 75% 磨砂小卡片，整块区域可点击。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差方块</strong>——`rounded-[4px]` 硬质方框；选中态整项切换为深色饱和实底 + 反色高对比文字。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-check-square h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品发布导出勾选项配置</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    复选组 · CheckboxGroup
                </span>
            </div>

            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <span class="block text-xs font-semibold text-[var(--text-secondary)]">作品导出附件与排版项:</span>
                    <div class="flex items-center gap-2 text-xs">
                        <button type="button" class="text-[var(--accent-main)] hover:underline cursor-pointer" @click="selectAll">全选</button>
                        <span class="text-[var(--text-muted)]">/</span>
                        <button type="button" class="text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer" @click="clearAll">清空</button>
                    </div>
                </div>

                <CheckboxGroup
                    id="nb-lab-target"
                    v-model="selectedValues"
                    :options="exportOptions"
                    :orientation="orientation"
                    :disabled="disabled"
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                />
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>已选中: {{ selectedValues.length }} / {{ exportOptions.length }} 项</span>
                <span>当前方案: {{ designOptions.find(o => o.value === designStyle)?.label }}</span>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.macos-compact-card {
    width: 100%;
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

.scheme-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-panel) 70%, transparent);
    backdrop-filter: blur(12px);
    border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
}

.scheme-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    background: var(--accent-main);
    color: var(--text-inverse);
    letter-spacing: 0.02em;
    flex-shrink: 0;
}

.scheme-banner-text {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
}
</style>
