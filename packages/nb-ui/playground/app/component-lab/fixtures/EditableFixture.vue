<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Editable, {type EditableSize} from "../../../../src/components/controls/Editable.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "outlined" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 触觉微拟物 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简双击即改", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光胶囊", value: "crystal"},
    {label: "方案 4: 精工线框显式按钮", value: "outlined"},
    {label: "方案 5: 实底工控高对比磁贴", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const chapterTitle = ref("第03章：幽灵协议与量子密钥");
const characterName = ref("林澈 (Lin Che)");
const characterRole = ref("前荒坂第七生化实验室首席深潜调试师");

const size = computed<EditableSize>(() => (controls.value.size as EditableSize) || "md");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    chapterTitle.value = "第03章：幽灵协议与量子密钥";
    characterName.value = "林澈 (Lin Che)";
    characterRole.value = "前荒坂第七生化实验室首席深潜调试师";
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Editable 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击文字或铅笔图标体验就地编辑与保存</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 触觉微拟物（推荐）</strong>——常态纯净排版；悬停淡出微型笔形图标，点击平滑展开 <strong>6% 实底输入槽 + 2.5px 柔光光晕</strong>，操作按键带有 <code>active:scale-[0.92]</code> 物理触觉。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简双击即改</strong>——去边框去按钮；悬停显现极细虚线下划线，点击就地获得原生输入焦点。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光胶囊</strong>——编辑态激活 75% 磨砂晶体背板与 <strong>4px 品牌弥散光圈</strong>。
                    </span>
                    <span v-else-if="designStyle === 'outlined'" class="scheme-banner-text">
                        <strong>方案 4：精工线框显式按钮</strong>——常驻 1px 精工细线微框与独立方块触发器，工业级工整感。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高对比磁贴</strong>——常态 8% 浅色磁贴，激活后切换为深色实底 + 高反差高亮白字。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-pencil-line h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品大纲与人物档案就地修改</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    就地编辑 · Editable
                </span>
            </div>

            <div class="space-y-4">
                <!-- 章节标题重命名 -->
                <div>
                    <span class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">分卷章节大纲标题 (点击或铅笔图标编辑):</span>
                    <Editable
                        id="nb-lab-target"
                        v-model="chapterTitle"
                        :size="size"
                        :disabled="disabled"
                        placeholder="输入章节标题..."
                        @submit="emit('lab-event', 'submit', $event)"
                    />
                </div>

                <!-- 角色名称修改 -->
                <div class="pt-3 border-t border-[var(--divider)]">
                    <span class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">核心出场人物姓名:</span>
                    <Editable
                        v-model="characterName"
                        size="lg"
                        :disabled="disabled"
                    />
                </div>

                <!-- 角色头衔说明 -->
                <div>
                    <span class="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">人物身份与阵营背景:</span>
                    <Editable
                        v-model="characterRole"
                        size="sm"
                        :disabled="disabled"
                    />
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-5 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>当前编辑条目数: 3 项</span>
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
