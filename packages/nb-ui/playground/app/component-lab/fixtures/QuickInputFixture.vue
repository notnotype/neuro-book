<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Button from "../../../../src/components/controls/Button.vue";
import Dialog from "../../../../src/components/feedback/Dialog.vue";
import QuickInput, {type QuickInputItem} from "../../../../src/components/feedback/QuickInput.vue";
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

const controls = ref<Record<string, string | boolean>>({});
const query = ref(">");
const activeId = ref<string | null>(null);
const focusRequest = ref(0);
const hostDialogOpen = ref(false);

// 领域数据：长篇写作工作区的真实命令形态
const commandItems: readonly QuickInputItem[] = [
    {id: "chapter.new", label: "新建章节文档", category: "章节", description: "在当前分卷末尾追加一章", shortcut: "Ctrl+N"},
    {id: "outline.reorder", label: "重排分卷大纲", category: "大纲", description: "按拖拽顺序重写卷目录"},
    {id: "world.entity", label: "打开世界观词条", category: "设定集", description: "按名称检索人物、势力与地点", shortcut: "Ctrl+K"},
    {id: "export.epub", label: "导出 EPUB 电子书", category: "导出", description: "合并全部已发布章节"},
    {id: "agent.review", label: "请 Agent 审阅本章", category: "Agent", description: "以计划模式检查逻辑与设定冲突"},
    {id: "theme.toggle", label: "切换明暗配色", category: "外观", description: "在浅色与深色配色之间切换", shortcut: "Ctrl+Shift+L"},
];

const longListItems: readonly QuickInputItem[] = Array.from({length: 80}, (_, index) => ({
    id: `scene.${index + 1}`,
    label: `第 ${index + 1} 场：${["雨夜追缉", "旧宅密谈", "码头分别", "档案室回溯"][index % 4]}（设定稿 ${index + 1}）`,
    category: "场景卡",
    description: `约 ${800 + index * 37} 字的场景梗概，含出场人物与伏笔清单`,
}));

const disabledItems: readonly QuickInputItem[] = [
    {id: "chapter.new", label: "新建章节文档", category: "章节", description: "在当前分卷末尾追加一章"},
    {id: "export.mobi", label: "导出 MOBI（转换器未安装）", category: "导出", disabled: true},
    {id: "world.entity", label: "打开世界观词条", category: "设定集", description: "按名称检索人物、势力与地点"},
    {id: "agent.review", label: "请 Agent 审阅本章（未配置模型）", category: "Agent", disabled: true},
];

const sceneItems = computed<readonly QuickInputItem[]>(() => {
    if (props.sceneId === "empty") return [];
    if (props.sceneId === "disabled") return disabledItems;
    if (props.sceneId === "long-list") return longListItems;
    return commandItems;
});

// 宿主的匹配只在这一层演示：原语不认识查询语义，只负责呈现宿主给的候选与活动项
const visibleItems = computed(() => {
    const text = query.value.replace(/^>/u, "").trim().toLowerCase();
    if (text === "") return sceneItems.value;
    return sceneItems.value.filter((item) => item.label.toLowerCase().includes(text));
});

const open = computed(() => Boolean(controls.value.open));
const loading = computed(() => props.sceneId === "loading");
const stateText = computed(() => `query=${JSON.stringify(query.value)} · activeId=${activeId.value ?? "null"} · items=${visibleItems.value.length}`);

function setControl(id: string, value: string | boolean): void {
    controls.value = {...controls.value, [id]: value};
}

/** 宿主的活动项规则：保留仍然有效的 activeId，失效就取第一个 enabled，空列表给 null */
function syncActiveId(): void {
    const items = visibleItems.value;
    const current = activeId.value;
    if (current !== null && items.some((item) => item.id === current && !item.disabled)) return;
    activeId.value = items.find((item) => !item.disabled)?.id ?? null;
}

watch(visibleItems, syncActiveId, {immediate: true});

function openPanel(): void {
    query.value = ">";
    syncActiveId();
    setControl("open", true);
}

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    query.value = ">";
    activeId.value = null;
    focusRequest.value = 0;
    hostDialogOpen.value = false;
    syncActiveId();
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

onMounted(() => void nextTick(() => emit("rendered")));
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div class="macos-compact-card space-y-5">
            <div class="flex items-start justify-between gap-4 border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-terminal-square h-4 w-4 text-[var(--accent-main)]" aria-hidden="true"></span>
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">写作工作区命令面板</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_14%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    受控原语 · QuickInput
                </span>
            </div>

            <div class="flex flex-wrap items-center gap-2">
                <Button
                    id="nb-lab-target"
                    variant="primary"
                    icon-class="i-lucide-command"
                    @click="openPanel"
                >
                    打开快速输入
                </Button>
                <Button variant="secondary" :disabled="!open" @click="focusRequest += 1">
                    重新聚焦输入框
                </Button>
                <Button
                    v-if="sceneId === 'dialog-stack'"
                    variant="secondary"
                    icon-class="i-lucide-app-window"
                    @click="hostDialogOpen = true"
                >
                    打开底层 Dialog
                </Button>
            </div>

            <div class="rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                {{ stateText }}
            </div>

            <p class="text-[11px] text-[var(--text-muted)]">
                浮层 portal 到 body：切换主题、配色与预览宽度时它仍在视口顶部居中，不受画布缩放影响。
                键盘合同：↑↓ 走活动项（跳过禁用、首尾回绕）、Enter 提交、Esc 只关本层、Tab 不逃出浮层。
            </p>
        </div>

        <Dialog v-model="hostDialogOpen" title="底层 Dialog 与浮层叠加" show-cancel>
            <p class="text-[var(--text-sm)] text-[var(--text-secondary)]">
                这是 nb-ui 既有模态 Dialog。在这里打开 QuickInput 后，第一次 Escape 只关闭上层浮层，第二次才关掉本对话框。
            </p>
            <div class="mt-3">
                <Button variant="primary" icon-class="i-lucide-command" @click="openPanel">
                    在 Dialog 内打开快速输入
                </Button>
            </div>
        </Dialog>

        <QuickInput
            :open="open"
            :query="query"
            :items="visibleItems"
            :active-id="activeId"
            title="写作工作区命令"
            placeholder="输入命令名称，或以 : 输入行号"
            empty-text="没有匹配的命令"
            :message="loading ? '正在加载候选命令…' : ''"
            :loading="loading"
            :focus-request="focusRequest"
            @update:open="(value: boolean) => { emit('lab-event', 'update:open', value); setControl('open', value); }"
            @update:query="(value: string) => { emit('lab-event', 'update:query', value); query = value; }"
            @update:active-id="(value: string | null) => { emit('lab-event', 'update:activeId', value); activeId = value; }"
            @accept="(id: string) => { emit('lab-event', 'accept', id); setControl('open', false); }"
            @close="(reason: string) => emit('lab-event', 'close', reason)"
            @closed="emit('lab-event', 'closed')"
        />
    </FixtureShell>
</template>
