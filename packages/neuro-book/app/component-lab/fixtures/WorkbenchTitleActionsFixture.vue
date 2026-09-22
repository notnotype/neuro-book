<script setup lang="ts">
/**
 * WorkbenchTitleActions 的 Lab 场景：受控标题操作组件的四种形态。
 *
 * fixture 扮演**宿主**：它持有唯一的状态（勾选、禁用原因、菜单点击结果），把已经求值好的展示项交给
 * 组件，组件只回传 `invoke(id)`——这里没有第二个状态机，也没有命令执行（那是宿主的事）。
 *
 * 四个场景：
 *   - default：两个 primary 按钮 + 一个 secondary 项（「更多」里）；
 *   - overflow：六个 primary 按钮 + 自适应宽度滑块，用来观察「放不下的折进更多」；
 *   - disabled：一条禁用项带原因（按钮仍然渲染，`title` / `aria-label` / 菜单项都带上原因）；
 *   - checked：受控 checkbox 与 radio 子菜单（选谁由宿主的 `checked` 决定，组件不自己改）。
 *
 * 溢出折叠按**父容器可用宽度**判断，所以 fixture 给组件一个宽度确定的盒子（固定宽 + 滑块），
 * 不靠浏览器窗口宽度。
 */
import {computed, ref, watch} from "vue";
import {useLabDataSink, useLabEventSink} from "nbook/app/component-lab/lab-event-sink";
import WorkbenchTitleActions from "nbook/app/components/workbench/WorkbenchTitleActions.vue";
import type {WorkbenchTitleActionItem} from "nbook/app/utils/workbench/view-title-actions";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{scene: string; data?: unknown}>();
const emitLabEvent = useLabEventSink();
const publishLabData = useLabDataSink();

const ICONS: readonly string[] = [
    "i-lucide-refresh-cw",
    "i-lucide-wand-2",
    "i-lucide-list-tree",
    "i-lucide-search",
    "i-lucide-bell",
    "i-lucide-star",
];

/** 场景宽度：overflow 场景用一个明显的窄盒子，好让折叠真的发生。 */
const WIDTHS: Record<string, number> = {
    default: 420,
    overflow: 170,
    disabled: 420,
    checked: 420,
};

const width = ref(WIDTHS[props.scene] ?? 420);
const marked = ref(false);
const density = ref<"compact" | "comfortable">("comfortable");
const lastInvoked = ref("");

const primary = computed<readonly WorkbenchTitleActionItem[]>(() => {
    if (props.scene === "overflow") {
        return ICONS.map((icon, index) => ({id: `action-${index + 1}`, label: `动作 ${index + 1}`, icon}));
    }
    if (props.scene === "disabled") {
        return [
            {id: "maximize", label: "最大化面板", icon: "i-lucide-maximize-2", disabled: true, reason: "居中对齐后可最大化"},
            {id: "hide", label: "隐藏面板", icon: "i-lucide-eye-off"},
        ];
    }
    if (props.scene === "checked") {
        return [{
            id: "mark",
            label: "标记当前视图",
            icon: "i-lucide-star",
            type: "checkbox",
            checked: marked.value,
        }];
    }
    return [
        {id: "refresh", label: "刷新", icon: "i-lucide-refresh-cw"},
        {id: "pin", label: "固定", icon: "i-lucide-star"},
    ];
});

const secondary = computed<readonly WorkbenchTitleActionItem[]>(() => {
    if (props.scene === "checked") {
        return [
            {
                id: "density",
                label: "列表密度",
                icon: "i-lucide-list",
                children: [
                    {id: "density:comfortable", label: "宽松", type: "radio", group: "density", checked: density.value === "comfortable"},
                    {id: "density:compact", label: "紧凑", type: "radio", group: "density", checked: density.value === "compact"},
                ],
            },
            {id: "reset", label: "重置标记", icon: "i-lucide-undo-2", disabled: !marked.value, reason: "还没有标记"},
        ];
    }
    return [{id: "secondary-demo", label: "示例次要动作", icon: "i-lucide-wand-2"}];
});

/** 点击落地：勾选与 radio 由**宿主**改（组件是受控的），事件只是通知 Lab。 */
function onInvoke(id: string): void {
    lastInvoked.value = id;
    if (id === "mark") {
        marked.value = !marked.value;
    }
    if (id === "reset") {
        marked.value = false;
    }
    if (id === "density:compact" || id === "density:comfortable") {
        density.value = id === "density:compact" ? "compact" : "comfortable";
    }
    emitLabEvent("title-action-invoke", {id, marked: marked.value, density: density.value});
}

watch(() => props.scene, () => {
    width.value = WIDTHS[props.scene] ?? 420;
    marked.value = false;
    density.value = "comfortable";
    lastInvoked.value = "";
}, {immediate: true});

watch([marked, density, lastInvoked, width], () => {
    publishLabData({scene: props.scene, width: width.value, marked: marked.value, density: density.value, lastInvoked: lastInvoked.value});
}, {immediate: true});
</script>

<template>
    <div class="flex h-full w-full flex-col">
        <LabFixtureControls>
            <div class="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
                <label class="flex items-center gap-2">
                    <span>标题条可用宽度</span>
                    <input v-model.number="width" type="range" min="60" max="520" step="10" class="w-[160px]">
                    <strong class="font-mono text-[var(--text-main)]" data-lab-width>{{ width }}px</strong>
                </label>
                <span>最近一次点击：<strong class="font-mono text-[var(--text-main)]" data-lab-last-invoke>{{ lastInvoked || "（无）" }}</strong></span>
            </div>
        </LabFixtureControls>

        <div class="flex flex-1 items-center justify-center p-6">
            <div class="flex items-center rounded-[var(--radius-panel)] border border-[var(--panel-outline)] bg-[var(--panel-surface)] p-[var(--space-2)]" :style="{width: `${width}px`, maxWidth: '100%'}">
                <WorkbenchTitleActions
                    data-lab-subject
                    scope="view"
                    :primary="primary"
                    :secondary="secondary"
                    :context-key="`${scene}|${marked}|${density}`"
                    label="视图操作"
                    @invoke="onInvoke"
                />
            </div>
        </div>
    </div>
</template>
