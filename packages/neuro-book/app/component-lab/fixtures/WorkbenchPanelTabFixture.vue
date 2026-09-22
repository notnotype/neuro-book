<script setup lang="ts">
/**
 * WorkbenchPanelTab 的 Lab 场景：受控面板标签条上的三档状态。
 *
 * fixture 扮演**宿主**：它持有标签列表与激活项，把已经解析好的 label 交给页签，页签只回传
 * `click(id)` / `close(id)`。这里没有第二个状态机——关闭真的移除本地列表里的那一项，激活项跟着
 * 邻居走；禁用项不响应（原生 disabled），事件日志里因此什么都不会出现。
 *
 * 键盘场景演示的是**宿主的责任**：组件的文档写明「方向键 / Home / End 的漫游归标签条」，
 * 所以 fixture 自己实现一条 `role="tablist"`：roving tabindex（只有当前项进 Tab 序列）、
 * 左右方向键环形移动、Home/End 到首尾；`Enter` / `Space` 由原生按钮直接变成一次 click，
 * 与指针点击走同一条激活路径——点与键盘的结果都进 Lab 事件通道。
 *
 * 场景（初值确定性、无网络、无持久化）：
 *   - default：四个页签、其一激活（带角标与图标）；
 *   - disabled：一个禁用项 + 两个可关闭项，点禁用项与关闭按钮的结果都不改激活项；
 *   - keyboard：聚焦后方向键 / Enter 由这里实现的标签条驱动，焦点与激活都进事件。
 */
import {computed, ref, watch} from "vue";
import WorkbenchPanelTab from "nbook/app/components/workbench/WorkbenchPanelTab.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

type LabTab = {
    id: string;
    label: string;
    icon?: string;
    badge?: string | number;
    closable?: boolean;
    disabled?: boolean;
};

const props = defineProps<{scene: string; data?: unknown}>();
const emitLabEvent = useLabEventSink();
const publishLabData = useLabDataSink();

/** 每档场景的确定性初值：标签集合 + 初始激活项。 */
const SCENES: Record<string, {tabs: readonly LabTab[]; active: string}> = {
    default: {
        tabs: [
            {id: "problems", label: "问题", icon: "i-lucide-alert-circle", badge: 44},
            {id: "output", label: "输出", icon: "i-lucide-file-text"},
            {id: "debug", label: "调试控制台", icon: "i-lucide-terminal"},
            {id: "ports", label: "端口", icon: "i-lucide-radio", badge: 2},
        ],
        active: "problems",
    },
    disabled: {
        tabs: [
            {id: "problems", label: "问题", icon: "i-lucide-alert-circle", badge: 3},
            {id: "output", label: "输出", icon: "i-lucide-file-text", disabled: true},
            {id: "debug", label: "调试控制台", icon: "i-lucide-terminal", closable: true},
            {id: "ports", label: "端口", icon: "i-lucide-radio", closable: true},
        ],
        active: "problems",
    },
    keyboard: {
        tabs: [
            {id: "problems", label: "问题", badge: 3},
            {id: "output", label: "输出"},
            {id: "debug", label: "调试控制台"},
            {id: "terminal", label: "终端"},
        ],
        active: "problems",
    },
};

const stage = computed(() => SCENES[props.scene] ?? SCENES.default!);
const tabs = ref<LabTab[]>([...stage.value.tabs]);
const activeTab = ref(stage.value.active);
const focusedTab = ref(stage.value.active);
const strip = ref<HTMLElement | null>(null);

/** 换场景 = 重建初值（普通交互不重挂场景）。 */
watch(() => props.scene, () => {
    tabs.value = [...stage.value.tabs];
    activeTab.value = stage.value.active;
    focusedTab.value = stage.value.active;
}, {immediate: true});

function onTabClick(id: string, event: MouseEvent): void {
    const tab = tabs.value.find((candidate) => candidate.id === id);
    if (tab === undefined || tab.disabled === true) {
        return;
    }
    activeTab.value = id;
    emitLabEvent("panel-tab-click", {id, detail: event.detail});
}

function onTabClose(id: string): void {
    const index = tabs.value.findIndex((candidate) => candidate.id === id);
    if (index < 0) {
        return;
    }
    tabs.value = tabs.value.filter((candidate) => candidate.id !== id);
    emitLabEvent("panel-tab-close", {id, remaining: tabs.value.map((tab) => tab.id)});
    if (activeTab.value === id) {
        const next = tabs.value[Math.min(index, tabs.value.length - 1)];
        activeTab.value = next?.id ?? "";
    }
}

/** 可聚焦的页签元素（跳过禁用项——原生按钮禁用后拿不到焦点）。 */
function focusables(): HTMLButtonElement[] {
    const root = strip.value;
    return root === null
        ? []
        : [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter((element) => !element.disabled);
}

function moveFocus(event: KeyboardEvent, delta: number | "first" | "last"): void {
    const elements = focusables();
    if (elements.length === 0) {
        return;
    }
    const current = elements.indexOf(document.activeElement as HTMLButtonElement);
    const last = elements.length - 1;
    const index = delta === "first" ? 0
        : delta === "last" ? last
            : current < 0 ? 0
                : current === last && delta > 0 ? 0
                    : current === 0 && delta < 0 ? last
                        : Math.min(last, Math.max(0, current + delta));
    event.preventDefault();
    const element = elements[index]!;
    element.focus();
    focusedTab.value = element.getAttribute("data-tab-id") ?? focusedTab.value;
}

/** 宿主的键盘合同：方向键 / Home / End 漫游；Enter / Space 由原生按钮变成 click。 */
function onStripKeydown(event: KeyboardEvent): void {
    switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
            moveFocus(event, 1);
            break;
        case "ArrowLeft":
        case "ArrowUp":
            moveFocus(event, -1);
            break;
        case "Home":
            moveFocus(event, "first");
            break;
        case "End":
            moveFocus(event, "last");
            break;
        default:
            break;
    }
}

function onTabFocus(id: string): void {
    if (focusedTab.value === id) {
        return;
    }
    focusedTab.value = id;
    emitLabEvent("panel-tab-focus", {id});
}

const SCENE_NOTES: Record<string, string> = {
    default: "四个页签横向平铺，其一激活：点了换激活项（组件自己不改激活态，改这里的是 fixture），角标与图标各出现一处。",
    disabled: "禁用项不响应指针与键盘、不发事件；可关闭项点右侧关闭区只发 close（冒泡被阻断，不会顺带激活）。",
    keyboard: "聚焦任意页签后：←/→ 环形漫游、Home/End 到首尾、Enter/Space 激活；焦点与激活都记进「事件」。",
};

const stageNote = computed(() => SCENE_NOTES[props.scene] ?? "");

watch([tabs, activeTab, focusedTab], () => {
    publishLabData({
        scene: props.scene,
        active: activeTab.value,
        focused: focusedTab.value,
        tabs: tabs.value.map((tab) => ({id: tab.id, disabled: tab.disabled === true, closable: tab.closable === true})),
    });
}, {immediate: true});
</script>

<template>
    <div class="flex h-full w-full flex-col">
        <LabFixtureControls>
            <div class="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                <span data-lab-note>{{ stageNote }}</span>
                <div class="flex items-center gap-4">
                    <span>当前焦点：<strong class="font-mono text-[var(--text-main)]" data-lab-focus>{{ focusedTab || "（无）" }}</strong></span>
                    <span>当前激活：<strong class="font-mono text-[var(--text-main)]" data-lab-active>{{ activeTab || "（无）" }}</strong></span>
                </div>
            </div>
        </LabFixtureControls>

        <!-- 面板标签条充满视口宽度 -->
        <div
            ref="strip"
            role="tablist"
            aria-label="面板标签"
            class="flex w-full shrink-0 items-stretch gap-[var(--space-1)] overflow-x-auto border-b border-[var(--divider)] bg-[var(--panel-surface)] px-[var(--space-2)]"
            data-lab-tab-strip
            @keydown="onStripKeydown"
        >
            <WorkbenchPanelTab
                v-for="tab in tabs"
                :key="tab.id"
                data-lab-subject
                :id="tab.id"
                :label="tab.label"
                :icon="tab.icon"
                :badge="tab.badge"
                :closable="tab.closable"
                :disabled="tab.disabled"
                :active="tab.id === activeTab"
                :tabindex="tab.id === focusedTab && tab.disabled !== true ? 0 : -1"
                @click="onTabClick"
                @close="onTabClose"
                @focus="onTabFocus(tab.id)"
            />
        </div>

        <div class="flex flex-1 items-center justify-center bg-[var(--bg-panel)] text-xs text-[var(--text-muted)] select-none">
            <span>面板内容区域（显示激活标签：{{ activeTab || "（无）" }}）</span>
        </div>
    </div>
</template>
