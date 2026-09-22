<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Drawer from "../../../../src/components/feedback/Drawer.vue";
import Button from "../../../../src/components/controls/Button.vue";
import Badge from "../../../../src/components/display/Badge.vue";
import FormInput from "../../../../src/components/form/FormInput.vue";
import FormTextarea from "../../../../src/components/form/FormTextarea.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "sheet" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生贴边磨砂侧板 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平侧栏", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光岛", value: "crystal"},
    {label: "方案 4: 底部工作流交互页", value: "sheet"},
    {label: "方案 5: 实底工控高反差面板", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const drawerOpen = ref(false);

const direction = computed(() => (controls.value.direction as any) || (designStyle.value === "sheet" ? "bottom" : "right"));
const handle = computed(() => Boolean(controls.value.handle) || designStyle.value === "sheet");

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    drawerOpen.value = false;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Drawer 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击按钮唤出抽屉体验侧滑手感与半透明磨砂遮罩</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生贴边磨砂侧板（推荐）</strong>——75% 高斯半透明磨砂背板；内嵌 1px 环境反光微边框，平滑丝滑抽拉滑入，遮罩带 24% 环境柔光暗化。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平侧栏</strong>——纯白/纯黑实底；无复杂光影，去边框去阴影，纯粹排版。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光岛</strong>——抽屉边缘不贴死屏幕；外围悬浮 12px 留白，向内扩散 <strong>8px 品牌弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'sheet'" class="scheme-banner-text">
                        <strong>方案 4：底部工作流交互页 (Bottom Sheet)</strong>——自屏幕底部滑出，顶部带有药丸形拖拽把手。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差面板</strong>——深色饱满实底，硬质高对比侧板。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-panel-right text-[var(--accent-main)] h-4 w-4" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">长篇小说人物档案与世界观设定抽屉</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    抽屉 · Drawer
                </span>
            </div>

            <div class="flex items-center gap-3">
                <Drawer
                    id="nb-lab-target"
                    v-model:open="drawerOpen"
                    :direction="direction"
                    :handle="handle"
                    title="世界观与人物设定详情"
                    description="长篇写作设定集快速侧边栏"
                    @update:open="emit('lab-event', 'update:open', $event)"
                >
                    <template #trigger>
                        <Button variant="primary" icon-class="i-lucide-panel-right">
                            打开设定集抽屉 ({{ direction.toUpperCase() }})
                        </Button>
                    </template>

                    <div class="space-y-4 py-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-[var(--text-main)]">主要出场人物</span>
                            <Badge size="sm" tone="accent">核心主角</Badge>
                        </div>

                        <div>
                            <span class="block text-xs font-medium text-[var(--text-secondary)] mb-1">人物姓名</span>
                            <FormInput model-value="林澈 (Lin Che)" />
                        </div>

                        <div>
                            <span class="block text-xs font-medium text-[var(--text-secondary)] mb-1">义体与背景设定</span>
                            <FormTextarea
                                model-value="前荒坂第七生化实验室首席深潜者，三年前在特异奇点事故中脱离组织，目前在新东京下层街区以自由义体调试师身份隐居。"
                                :rows="4"
                            />
                        </div>
                    </div>

                    <template #footer>
                        <Button size="sm" variant="secondary" @click="drawerOpen = false">取消</Button>
                        <Button size="sm" variant="primary" @click="drawerOpen = false">保存设定</Button>
                    </template>
                </Drawer>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>滑出方向: {{ direction.toUpperCase() }}</span>
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
