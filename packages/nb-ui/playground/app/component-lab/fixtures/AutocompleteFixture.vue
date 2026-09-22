<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Autocomplete, {type AutocompleteOption} from "../../../../src/components/form/Autocomplete.vue";
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
    {label: "方案 1: macOS 智能聚焦浮层 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平卡片", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光气泡", value: "crystal"},
    {label: "方案 4: 精工微线框与标签", value: "outlined"},
    {label: "方案 5: 实底工控高对比瓷片", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const keyword = ref("");
const selectedItem = ref<AutocompleteOption | null>(null);

const size = computed(() => (controls.value.size as any) || "md");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

const worldBuildingOptions: AutocompleteOption[] = [
    {value: "荒坂第七实验室", label: "荒坂第七实验室", description: "深潜脑机接口与记忆芯片研发机构", iconClass: "i-lucide-building"},
    {value: "幽灵协议", label: "幽灵协议", description: "暗网反追踪底层加密通讯协议", iconClass: "i-lucide-shield-alert"},
    {value: "量子密钥生成器", label: "量子密钥生成器", description: "用于解密神经元突触加密锁的核心装置", iconClass: "i-lucide-key"},
    {value: "林澈 (Lin Che)", label: "林澈 (Lin Che)", description: "前首席深潜调试师，代号「渡鸦」", iconClass: "i-lucide-user"},
    {value: "下城区霓虹雨巷", label: "下城区霓虹雨巷", description: "地下反抗军聚集地与黑市交易中心", iconClass: "i-lucide-map-pin"},
    {value: "天穹轨道空港", label: "天穹轨道空港", description: "地表至同步轨道浮空城枢纽", iconClass: "i-lucide-plane"},
];

function handleSelect(opt: AutocompleteOption): void {
    selectedItem.value = opt;
    emit("lab-event", "select", opt);
}

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    keyword.value = "";
    selectedItem.value = null;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Autocomplete 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">输入关键词（如“荒坂”、“量子”）展开联想池</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 智能聚焦浮层（推荐）</strong>——`rounded-[6px]` 超椭圆；深灰 6% 实底输入槽，下拉弹层 75% 高斯磨砂 + 柔光反光边缘，候选项 Hover 时淡出 <strong>12% 品牌柔光底板</strong>。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平卡片</strong>——`rounded-[8px]` 现代大圆角；纯粹的浓度跃升底板，下拉候选项无边框，纯靠 14% 柔和底色高亮。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光气泡</strong>——`rounded-full` 胶囊输入框；下拉气泡扩散 <strong>4px 环境光晕</strong>，词条悬停微放大。
                    </span>
                    <span v-else-if="designStyle === 'outlined'" class="scheme-banner-text">
                        <strong>方案 4：精工微线框与标签</strong>——`rounded-[5px]` 锐利精工框；候选项配备类型角标，结构感极强。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高对比瓷片</strong>——常态 14% 实底 + 纯黑/纯白高对比高亮，选定词条后以实体瓷片徽标沉淀。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg pb-28">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-sparkles h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">设定集词条与设定快捷联想插入</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    自动补全 · Autocomplete
                </span>
            </div>

            <div class="space-y-4">
                <div class="space-y-2">
                    <label class="block text-xs font-semibold text-[var(--text-secondary)]">搜索设定词条（支持即时键入过滤）:</label>
                    <Autocomplete
                        id="nb-lab-target"
                        v-model="keyword"
                        :options="worldBuildingOptions"
                        :size="size"
                        :disabled="disabled"
                        placeholder="键入关键词（如'荒坂'、'量子'、'林澈'、'下城'）..."
                        @select="handleSelect"
                    />
                </div>

                <!-- 选定词条解析卡片展示 -->
                <div v-if="selectedItem" class="rounded-lg p-3 border border-[color-mix(in_srgb,var(--accent-main)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-main)_8%,transparent)]">
                    <div class="flex items-center gap-2 mb-1">
                        <span v-if="selectedItem.iconClass" :class="selectedItem.iconClass" class="h-4 w-4 text-[var(--accent-main)]" />
                        <span class="text-xs font-bold text-[var(--text-main)]">{{ selectedItem.label }}</span>
                        <span class="text-[10px] font-mono rounded px-1.5 py-0.2 bg-[var(--accent-main)] text-[var(--text-inverse)]">已选定</span>
                    </div>
                    <p class="text-xs text-[var(--text-secondary)] leading-relaxed">{{ selectedItem.description }}</p>
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-5 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>当前候选池: {{ worldBuildingOptions.length }} 项设定</span>
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
