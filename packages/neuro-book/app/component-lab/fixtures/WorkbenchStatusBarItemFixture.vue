<script setup lang="ts">
/**
 * WorkbenchStatusBarItem 的 Lab 场景：状态栏里的一项在三档形态下的样子。
 *
 * fixture 扮演**状态栏宿主**：它画那条 22px 的栏、决定左右分组，把已经解析好的文案与变体交给
 * 每一项；项只回传 `click()`（不带参数——谁是它由 fixture 自己知道）。
 *
 * 三档场景都是确定性内存值，无网络、无持久化：
 *   - default：图标 + 文本 + 角标，并含一项激活态（说明 active 是「对应东西正开着」）；
 *   - variants：error / warning / info / success 四个语义变体的角标与配色；
 *   - readonly：clickable=false 的项——根是 span、不进 Tab 序列；点它只会留下一条「栏收到了指针事件、
 *     项没有发事件」的对照记录，好让「不发事件」这条合同在事件面板里可见。
 */
import {computed, ref, watch} from "vue";
import WorkbenchStatusBarItem, {
    type WorkbenchStatusBarItemVariant,
} from "nbook/app/components/workbench/WorkbenchStatusBarItem.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

type LabStatusItem = {
    id: string;
    label?: string;
    icon?: string;
    badge?: string | number;
    variant?: WorkbenchStatusBarItemVariant;
    clickable?: boolean;
    active?: boolean;
    title: string;
};

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();
const emitLabEvent = useLabEventSink();
const publishLabData = useLabDataSink();

/** 每档场景的确定性初值：左右两组项。 */
const SCENES: Record<string, {left: readonly LabStatusItem[]; right: readonly LabStatusItem[]}> = {
    default: {
        left: [
            {id: "remote", icon: "i-lucide-radio", label: "NeuroBook", title: "已连接本地环境"},
            {id: "branch", icon: "i-lucide-git-branch", label: "refactor/w00003-nb-ui-adoption", title: "当前分支"},
            {id: "errors", icon: "i-lucide-x-circle", badge: 3, variant: "error", title: "错误数"},
            {id: "sync", icon: "i-lucide-refresh-cw", label: "0↓ 1↑", title: "与远程仓库同步"},
        ],
        right: [
            {id: "cursor", label: "第 42 行，第 18 列", title: "光标行列位置"},
            {id: "panel", icon: "i-lucide-panel-bottom", label: "面板", active: true, title: "面板正在显示"},
            {id: "notifications", icon: "i-lucide-bell", badge: 5, title: "通知面板"},
        ],
    },
    variants: {
        left: [
            {id: "errors", icon: "i-lucide-x-circle", badge: 5, variant: "error", title: "错误数"},
            {id: "warnings", icon: "i-lucide-alert-triangle", badge: 12, variant: "warning", title: "警告数"},
            {id: "infos", icon: "i-lucide-info", badge: 14, variant: "info", title: "信息提示数"},
            {id: "checks", icon: "i-lucide-check-circle-2", badge: 27, variant: "success", title: "通过的检查"},
        ],
        right: [
            {id: "counts", icon: "i-lucide-hash", badge: 0, title: "default 变体的角标（对照）"},
            {id: "plain", label: "无图标的文本项", title: "只有文案的项"},
        ],
    },
    readonly: {
        left: [
            {id: "readonly-branch", icon: "i-lucide-git-branch", label: "main", clickable: false, title: "只读：当前分支"},
            {id: "readonly-errors", icon: "i-lucide-x-circle", badge: 0, variant: "error", clickable: false, title: "只读：错误数"},
        ],
        right: [
            {id: "readonly-encoding", label: "UTF-8", clickable: false, title: "只读：文件编码"},
            {id: "readonly-language", label: "TypeScript", clickable: false, title: "只读：语言模式"},
            {id: "readonly-cursor", label: "第 1 行，第 1 列", clickable: false, title: "只读：光标位置"},
        ],
    },
};

const stage = computed(() => SCENES[props.scene] ?? SCENES.default!);

/** 普通交互不该改场景：这里只记「最近一次点击落到谁身上」。 */
const lastClicked = ref("");

watch(() => props.scene, () => {
    lastClicked.value = "";
}, {immediate: true});

function onItemClick(id: string, variant: WorkbenchStatusBarItemVariant | undefined): void {
    lastClicked.value = id;
    emitLabEvent("status-item-click", {id, variant: variant ?? "default"});
}

/**
 * 只读对照：栏自己收到指针事件，但项（span）不会发任何东西。
 * 记录里带上项 id，于是「点击发生了、事件没发生」在事件面板里是两行可对照的事实。
 */
function onStripPointer(event: MouseEvent): void {
    const element = (event.target as HTMLElement | null)?.closest("[data-status-item-id]");
    const id = element?.getAttribute("data-status-item-id") ?? "";
    if (id === "") {
        return;
    }
    const item = [...stage.value.left, ...stage.value.right].find((candidate) => candidate.id === id);
    if (item?.clickable === false) {
        emitLabEvent("status-strip-pointer", {id, itemEvents: 0});
    }
}

const SCENE_NOTES: Record<string, string> = {
    default: "图标 + 文本 + 角标：分支名与计数各占一项，右侧「面板」处于激活态（底色 + 文字提亮）。点任意可点项都会在事件里留下 id。",
    variants: "四个语义变体（error / warning / info / success）的文字与角标都取对应状态色；最后一项是 default 变体的角标对照。",
    readonly: "clickable=false：根是 <span>，不进 Tab 序列、没有悬停也没有事件。点它们只会留下 status-strip-pointer（栏收到了指针），不会有 status-item-click。",
};

const stageNote = computed(() => SCENE_NOTES[props.scene] ?? "");

watch([stage, lastClicked], () => {
    publishLabData({
        scene: props.scene,
        lastClicked: lastClicked.value,
        left: stage.value.left.map((item) => ({id: item.id, clickable: item.clickable !== false, variant: item.variant ?? "default"})),
        right: stage.value.right.map((item) => ({id: item.id, clickable: item.clickable !== false, variant: item.variant ?? "default"})),
    });
}, {immediate: true});
</script>

<template>
    <div class="flex h-full w-full flex-col justify-end">
        <LabFixtureControls>
            <div class="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                <span data-lab-note>{{ stageNote }}</span>
                <span>最近一次点击：<strong class="font-mono text-[var(--text-main)]" data-lab-last-clicked>{{ lastClicked || "（无）" }}</strong></span>
            </div>
        </LabFixtureControls>

        <div class="flex flex-1 items-center justify-center bg-[var(--panel-surface)] text-[var(--text-xs)] text-[var(--text-muted)] select-none">
            <span>编辑器主体内容区域</span>
        </div>

        <div
            class="flex h-[22px] w-full shrink-0 items-stretch justify-between border-t border-[var(--divider)] bg-[var(--panel-surface)] px-[var(--space-2)]"
            data-lab-status-strip
            @click="onStripPointer"
        >
            <div class="flex min-w-0 items-center gap-[var(--space-1)]">
                <WorkbenchStatusBarItem
                    v-for="item in stage.left"
                    :key="item.id"
                    data-lab-subject
                    :id="item.id"
                    :label="item.label"
                    :icon="item.icon"
                    :badge="item.badge"
                    :variant="item.variant"
                    :clickable="item.clickable"
                    :active="item.active"
                    :title="item.title"
                    @click="onItemClick(item.id, item.variant)"
                />
            </div>

            <div class="flex min-w-0 items-center gap-[var(--space-1)]">
                <WorkbenchStatusBarItem
                    v-for="item in stage.right"
                    :key="item.id"
                    data-lab-subject
                    :id="item.id"
                    :label="item.label"
                    :icon="item.icon"
                    :badge="item.badge"
                    :variant="item.variant"
                    :clickable="item.clickable"
                    :active="item.active"
                    :title="item.title"
                    @click="onItemClick(item.id, item.variant)"
                />
            </div>
        </div>
    </div>
</template>
