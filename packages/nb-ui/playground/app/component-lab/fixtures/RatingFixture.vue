<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Rating, {type RatingSize} from "../../../../src/components/display/Rating.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "numeric" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 琥珀暖金星标 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平圆点", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光星团", value: "crystal"},
    {label: "方案 4: 精工数字刻度联动", value: "numeric"},
    {label: "方案 5: 实底工控高反差方块", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const score1 = ref(4);
const score2 = ref(5);
const score3 = ref(3);

const size = computed<RatingSize>(() => (controls.value.size as RatingSize) || "md");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    score1.value = 4;
    score2.value = 5;
    score3.value = 3;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Rating 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">悬停与点击星星体验缩放与评分交互</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 琥珀暖金星标（推荐）</strong>——深琥珀暖金色；悬停 <code>hover:scale-115</code>，点击 <code>active:scale-95</code>，非刺眼黄，温润沉稳。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平圆点</strong>——将星标抽象为 5 颗等距纯色微圆点，手感极简纯平。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光星团</strong>——激活状态星标向外扩散 <strong>4px 琥珀柔光弥散晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'numeric'" class="scheme-banner-text">
                        <strong>方案 4：精工数字刻度联动</strong>——星标后联动等宽数字评分徽章（如 4.0 / 5.0）。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差方块</strong>——以 5 颗独立硬质工控瓷块呈现，高亮实心填充。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-star h-4 w-4 text-[var(--status-warning)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">长篇小说读者审校反馈与评价</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--status-warning)_14%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[color-mix(in_srgb,var(--status-warning)_80%,black)]">
                    星级评分 · Rating
                </span>
            </div>

            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">章节情节节奏与悬念张力</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">读者心跳弧线与主线戏剧冲突</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <Rating
                            id="nb-lab-target"
                            v-model="score1"
                            :size="size"
                            :disabled="disabled"
                            @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                        />
                        <span v-if="designStyle === 'numeric'" class="text-xs font-mono font-bold text-[var(--text-main)]">{{ score1 }}.0</span>
                    </div>
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">世界观设定自洽严谨度</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">科技树硬度与社会阶层结构</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <Rating
                            v-model="score2"
                            :size="size"
                            :disabled="disabled"
                        />
                        <span v-if="designStyle === 'numeric'" class="text-xs font-mono font-bold text-[var(--text-main)]">{{ score2 }}.0</span>
                    </div>
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">核心出场人物心理弧光</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">行为动机与情感共鸣</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <Rating
                            v-model="score3"
                            :size="size"
                            :disabled="disabled"
                        />
                        <span v-if="designStyle === 'numeric'" class="text-xs font-mono font-bold text-[var(--text-main)]">{{ score3 }}.0</span>
                    </div>
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>综合均分: {{ ((score1 + score2 + score3) / 3).toFixed(1) }} / 5.0</span>
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
