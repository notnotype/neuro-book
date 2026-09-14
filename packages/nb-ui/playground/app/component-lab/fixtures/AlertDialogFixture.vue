<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import AlertDialog, {type AlertDialogTone} from "../../../../src/components/feedback/AlertDialog.vue";
import Button from "../../../../src/components/controls/Button.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "banner" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生警示弹窗 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平卡片", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光模态框", value: "crystal"},
    {label: "方案 4: 顶部红边安全警示条", value: "banner"},
    {label: "方案 5: 实底工控高反差面板", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const alertOpen = ref(false);
const tone = computed<AlertDialogTone>(() => (controls.value.tone as AlertDialogTone) || "danger");

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    alertOpen.value = false;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">AlertDialog 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击按钮唤出破坏性操作二次确认模态窗</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生警示弹窗（推荐）</strong>——`rounded-[14px]` 超椭圆；75% 高斯磨砂背板 + 1px 环境反光微边框，按钮遵循 macOS 规范（主动作靠右加粗，取消靠左），<code>scale-[0.96]->1</code> 弹性入场。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平卡片</strong>——去磨砂去阴影；纯色扁平卡片与大字号标题，手感清爽。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光模态框</strong>——模态框外沿向外扩散 <strong>8px 红色/品牌弥散光晕</strong>，高质感晶体。
                    </span>
                    <span v-else-if="designStyle === 'banner'" class="scheme-banner-text">
                        <strong>方案 4：顶部红边安全警示条</strong>——顶部带有 4px 警示色（Danger/Warning）实色条带，强化不可逆提示。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差面板</strong>——深色饱满实底，高反差黑白对比。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-alert-triangle text-[var(--status-danger)] h-4 w-4" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品章节删除与不可逆销毁确认</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--status-danger)_14%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--status-danger)]">
                    二次确认 · AlertDialog
                </span>
            </div>

            <div class="flex items-center gap-3">
                <AlertDialog
                    id="nb-lab-target"
                    v-model:open="alertOpen"
                    title="确定要彻底删除《第03章：幽灵协议》吗？"
                    description="此操作将永久抹除本地 SQLite 数据库及历史快照中的该章节全部正文与批注数据，该操作不可逆。"
                    confirm-text="确认彻底删除"
                    cancel-text="暂不删除"
                    :tone="tone"
                    @confirm="emit('lab-event', 'confirm'); alertOpen = false"
                    @cancel="emit('lab-event', 'cancel'); alertOpen = false"
                >
                    <template #trigger>
                        <Button :variant="tone === 'danger' ? 'danger' : 'primary'" icon-class="i-lucide-trash-2">
                            触发删除二次确认弹窗 ({{ tone.toUpperCase() }})
                        </Button>
                    </template>
                </AlertDialog>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>警示级别: {{ tone.toUpperCase() }}</span>
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
