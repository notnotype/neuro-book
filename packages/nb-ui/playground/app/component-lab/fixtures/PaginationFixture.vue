<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Pagination from "../../../../src/components/controls/Pagination.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "compact" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 超椭圆分段页码 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平线条", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光胶囊", value: "crystal"},
    {label: "方案 4: 极度紧凑输入直达", value: "compact"},
    {label: "方案 5: 实底工控高反差方块", value: "solid"},
];

const page = ref(3);
const controls = ref<Record<string, string | boolean>>({});

const pageCount = computed(() => {
    const parsed = Number.parseInt(String(controls.value.pageCount ?? "9"), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 9;
});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    if (props.sceneId === "first") page.value = 1;
    else if (props.sceneId === "last") page.value = Number.parseInt(String(defaults.pageCount ?? "9"), 10) || 9;
    else page.value = 3;
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
        <!-- 顶层设计风格切换栏 -->
        <div class="mb-6 flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Pagination 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击各页码或前后翻页按钮体验分页切换</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 超椭圆分段页码（推荐）</strong>——`rounded-[6px]` 超椭圆页码方块；按压带有 <code>active:scale-[0.92]</code> 弹性微缩放，选中态为 <strong>纯正品牌实底白字</strong>。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平线条</strong>——去页码外框；当前页仅以加粗文字与下方 2px 品牌线标记，手感清爽。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光胶囊</strong>——75% 磨砂晶体底座；当前活跃页码向外扩散 <strong>3.5px 品牌弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'compact'" class="scheme-banner-text">
                        <strong>方案 4：极度紧凑输入直达</strong>——极简翻页按钮搭配居中等宽页码输入框，适合海量长篇章节快速定位。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差方块</strong>——深色饱满实底，页码以高反差对比白字呈现。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-binary h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品章节列表与历史版本分页</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    分页 · Pagination
                </span>
            </div>

            <div class="flex justify-center p-3 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Pagination
                    id="nb-lab-target"
                    v-model:page="page"
                    :page-count="pageCount"
                    @update:page="report('update:page', {value: $event})"
                />
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>当前处于: 第 {{ page }} 页 / 共 {{ pageCount }} 页</span>
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
