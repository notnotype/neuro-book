<script setup lang="ts">
/**
 * WorkbenchActivityBar 的 Lab 场景（纯 props，无产品依赖）。
 *
 * 演示重点：
 * 1. 三组几何：主入口在上、次要入口居中、底部入口贴底；每项 40px、步距 44px；
 * 2. overflow：矮容器里次要入口从尾部进 More 菜单，菜单里保留 active 与禁用理由；
 * 3. disabled：禁用项不执行，理由进 tooltip 与 aria-label；
 * 4. short：极短高度下主入口组与底部组各自滚动，More 不会被盖住；
 * 5. active：当前入口的底色、文字色与左侧标记条。
 */
import {computed, ref, watch} from "vue";
import WorkbenchActivityBar, {type ActivityItem} from "nbook/app/components/workbench/WorkbenchActivityBar.vue";
import {useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const primary: ActivityItem[] = [
    {id: "files", label: "文件", icon: "i-lucide-files", active: true},
    {id: "search", label: "搜索", icon: "i-lucide-search"},
    {id: "outline", label: "大纲", icon: "i-lucide-list-tree"},
    {id: "world", label: "世界引擎", icon: "i-lucide-globe-2"},
];

const secondary: ActivityItem[] = [
    {id: "trace", label: "链路查看器", icon: "i-lucide-activity"},
    {id: "history", label: "历史收件箱", icon: "i-lucide-inbox"},
];

const footer: ActivityItem[] = [
    {id: "account", label: "账户", icon: "i-lucide-user-round"},
    {id: "settings", label: "设置", icon: "i-lucide-settings"},
];

/** 溢出场景：次要入口多于高容器放得下的数量，其余从 More 进入。 */
const longSecondary: ActivityItem[] = [
    ...secondary,
    {id: "jobs", label: "任务中心", icon: "i-lucide-list-checks"},
    {id: "ports", label: "端口", icon: "i-lucide-radio"},
    {id: "output", label: "输出", icon: "i-lucide-file-text"},
    {id: "problems", label: "问题", icon: "i-lucide-alert-circle", reason: "还没有诊断结果"},
];

/** 禁用场景：与 Project 未打开时的产品状态同形——入口在，但点不动并给出原因。 */
const disabledPrimary: ActivityItem[] = [
    {id: "files", label: "文件", icon: "i-lucide-files", disabled: true, reason: "请先打开一个 Project"},
    {id: "search", label: "搜索", icon: "i-lucide-search", disabled: true, reason: "请先打开一个 Project"},
    {id: "outline", label: "大纲", icon: "i-lucide-list-tree"},
];

/** 短高度场景：主入口多于容器放得下的数量，靠自身滚动兜住。 */
const longPrimary: ActivityItem[] = [
    ...primary,
    {id: "characters", label: "人物", icon: "i-lucide-users-round"},
    {id: "source-control", label: "源代码管理", icon: "i-lucide-git-branch"},
];

const badgeFooter: ActivityItem[] = [
    {id: "account", label: "账户", icon: "i-lucide-user-round"},
    {id: "settings", label: "设置", icon: "i-lucide-settings", badge: 2},
];

type LabActivityScene = Readonly<{
    height: number;
    primary: ActivityItem[];
    secondary: ActivityItem[];
    footer: ActivityItem[];
}>;

const sceneConfigs = {
    default: {height: 620, primary, secondary, footer},
    overflow: {height: 320, primary: primary.slice(0, 2), secondary: longSecondary, footer},
    disabled: {height: 620, primary: disabledPrimary, secondary, footer},
    short: {height: 220, primary: longPrimary, secondary: longSecondary, footer: badgeFooter},
} satisfies Record<string, LabActivityScene>;

const lastInvoked = ref("");

const config = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    const scene = sceneConfigs[props.scene as keyof typeof sceneConfigs] ?? sceneConfigs.default;
    return {
        ...scene,
        height: typeof data.height === "number" && Number.isFinite(data.height) ? data.height : scene.height,
    };
});

function onInvoke(id: string): void {
    lastInvoked.value = id;
    emitLabEvent("activity-invoke", {id});
}

watch(() => props.scene, () => {
    lastInvoked.value = "";
});
</script>

<template>
    <div class="flex h-full w-full">
        <LabFixtureControls>
            <div class="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                <div class="font-medium text-[var(--text-main)]">活动栏（通用件 · 纯 props）</div>
                <div>主入口 {{ config.primary.length }} 项 · 次要入口 {{ config.secondary.length }} 项 · 底部入口 {{ config.footer.length }} 项</div>
                <div>最近触发：<span class="font-mono text-[var(--text-main)]">{{ lastInvoked === "" ? "（还没点）" : lastInvoked }}</span></div>
            </div>
        </LabFixtureControls>

        <!-- 活动栏贴左充满视口高度 -->
        <div class="h-full w-[48px] shrink-0 border-r border-[var(--divider)] bg-[var(--bg-main)]">
            <WorkbenchActivityBar
                data-lab-subject="activity-bar"
                class="h-full w-full"
                :primary="config.primary"
                :secondary="config.secondary"
                :footer="config.footer"
                label="工作台导航（Lab 演示）"
                more-label="更多"
                @invoke="onInvoke"
            />
        </div>

        <!-- 模拟工作区其余部分 -->
        <div class="flex flex-1 items-center justify-center bg-[var(--panel-surface)] text-xs text-[var(--text-muted)] select-none">
            <span>工作台内容区域（可通过拖拽画布下沿调整高度观察滚动表现）</span>
        </div>
    </div>
</template>
