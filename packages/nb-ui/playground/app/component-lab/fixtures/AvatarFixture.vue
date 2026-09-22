<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Avatar, {type AvatarShape, type AvatarSize} from "../../../../src/components/display/Avatar.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "hex" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 超椭圆微光环 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平圆环", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光徽标", value: "crystal"},
    {label: "方案 4: 赛博几何切割角标", value: "hex"},
    {label: "方案 5: 实底工控高反差方块", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const shape = computed<AvatarShape>(() => (controls.value.shape as AvatarShape) || "squircle");
const size = computed<AvatarSize>(() => (controls.value.size as AvatarSize) || "md");

const characters = [
    {name: "林澈 (Lin Che)", fallback: "LC", role: "主角 · 前荒坂首席深潜调试师", tone: "primary"},
    {name: "阿九 (Nine)", fallback: "A9", role: "配角 · 下城区第七黑市情报掮客", tone: "warning"},
    {name: "荒坂科研部", fallback: "AK", role: "势力 · 新东京巨型生化财阀", tone: "danger"},
    {name: "幽灵协议 (Ghost)", fallback: "GP", role: "系统 · 自主演化量子脑机协议", tone: "info"},
];

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Avatar 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">在角色档案列表中预览头像的比例与质感</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 超椭圆微光环（推荐）</strong>——`rounded-[28%]` Squircle 连续曲率；14% 渐变浅底 + 纯正实底字母，悬停 <code>hover:scale-105</code> 弹性回弹，雅致温润。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平圆环</strong>——`rounded-full` 正圆；去多余光影，纯色扁平字母与无边框设计。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光徽标</strong>——75% 磨砂晶体背板，外沿扩散 <strong>3.5px 品牌弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'hex'" class="scheme-banner-text">
                        <strong>方案 4：赛博几何切割角标</strong>——硬边微倒角；赛博朋克与科幻设定集人物专属硬朗风格。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差方块</strong>——`rounded-[4px]` 硬质方块，深色饱和实底 + 反色高对比字符。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-user-circle-2 h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品核心出场人物与阵营头像</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    人物头像 · Avatar
                </span>
            </div>

            <!-- 尺寸梯度一览 -->
            <div>
                <span class="block text-xs font-semibold text-[var(--text-secondary)] mb-3">尺寸阶梯梯度 (XS ~ XL):</span>
                <div class="flex items-center gap-4 flex-wrap p-3 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                    <Avatar
                        id="nb-lab-target"
                        fallback="NB"
                        :shape="shape"
                        size="xs"
                    />
                    <Avatar
                        fallback="NB"
                        :shape="shape"
                        size="sm"
                    />
                    <Avatar
                        fallback="NB"
                        :shape="shape"
                        size="md"
                    />
                    <Avatar
                        fallback="NB"
                        :shape="shape"
                        size="lg"
                    />
                    <Avatar
                        fallback="NB"
                        :shape="shape"
                        size="xl"
                    />
                </div>
            </div>

            <!-- 人物角色列表应用示例 -->
            <div class="space-y-2">
                <span class="block text-xs font-semibold text-[var(--text-secondary)] mb-1">主要登场人物列表:</span>
                <div
                    v-for="char in characters"
                    :key="char.name"
                    class="flex items-center justify-between p-2.5 rounded-[var(--radius-control)] hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] transition-colors border border-[color-mix(in_srgb,var(--border-color)_30%,transparent)]"
                >
                    <div class="flex items-center gap-3">
                        <Avatar
                            :fallback="char.fallback"
                            :shape="shape"
                            :size="size"
                        />
                        <div>
                            <span class="block text-xs font-semibold text-[var(--text-main)]">{{ char.name }}</span>
                            <span class="block text-[11px] text-[var(--text-muted)]">{{ char.role }}</span>
                        </div>
                    </div>
                    <span class="text-[11px] font-mono text-[var(--text-muted)]">ACTIVE</span>
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>头像外形模式: {{ shape.toUpperCase() }}</span>
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
