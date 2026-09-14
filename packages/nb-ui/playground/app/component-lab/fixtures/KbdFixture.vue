<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Kbd, {type KbdSize} from "../../../../src/components/display/Kbd.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "retro" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 实体微拟物键帽 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平文字", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光键帽", value: "crystal"},
    {label: "方案 4: 复古机械键帽凹陷", value: "retro"},
    {label: "方案 5: 实底工控高反差磁键", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const size = computed<KbdSize>(() => (controls.value.size as KbdSize) || "md");

const shortcuts = [
    {action: "快速全局搜索 / 命令面板", keys: ["⌘", "K"]},
    {action: "保存当前章节草稿与快照", keys: ["⌘", "S"]},
    {action: "开启全屏沉浸专注写作模式", keys: ["⌃", "⌘", "F"]},
    {action: "撤销上一段输入", keys: ["⌘", "Z"]},
    {action: "重做", keys: ["⇧", "⌘", "Z"]},
    {action: "智能续写与情节分支灵感", keys: ["⌥", "Space"]},
    {action: "添加行内词条批注与注释", keys: ["⌘", "⌥", "N"]},
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Kbd 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">在快捷键清单中体验键帽的立体物理按压质感</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 实体微拟物键帽（推荐）</strong>——`rounded-[4.5px]` 超椭圆；10% 浅灰底 + 底部 1.5px 浮雕阴影与 1px 细微框，按压 <code>active:scale-[0.92]</code> 带有明显的物理下沉。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平文字</strong>——去浮雕阴影；仅靠 8% 纯平底色与等宽字符，手感极轻。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光键帽</strong>——75% 磨砂晶体键帽，边缘微透光，外圈扩散 <strong>2.5px 柔和微光</strong>。
                    </span>
                    <span v-else-if="designStyle === 'retro'" class="scheme-banner-text">
                        <strong>方案 4：复古机械键帽凹陷</strong>——带有明显的内嵌凹槽深度感与高反差刻印。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差磁键</strong>——深色饱满实底，纯白反色高对比等宽字。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-keyboard h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">写作工作区全键盘流快捷键指南</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    快捷键帽 · Kbd
                </span>
            </div>

            <div class="divide-y divide-[color-mix(in_srgb,var(--border-color)_40%,transparent)]">
                <div
                    v-for="item in shortcuts"
                    :key="item.action"
                    class="flex items-center justify-between py-2.5"
                >
                    <span class="text-xs font-medium text-[var(--text-main)]">{{ item.action }}</span>
                    <div class="flex items-center gap-1">
                        <Kbd
                            id="nb-lab-target"
                            v-for="key in item.keys"
                            :key="key"
                            :size="size"
                        >
                            {{ key }}
                        </Kbd>
                    </div>
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>收录高频快捷键: {{ shortcuts.length }} 组</span>
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
