<script setup lang="ts">
/**
 * WorkbenchStatusBar 的 Lab 场景。
 *
 * 演示重点：
 * 1. 左右分组几何：左侧工作空间/Git/问题统计，右侧编码/光标位置/语言/通知；
 * 2. 状态项与角标：支持图标按钮、带角标计数（错误红/警告黄/信息蓝）；
 * 3. 悬停与激活交互：项级 2px 微圆角悬停反馈，点击事件记录进 Lab 事件面板；
 * 4. 极窄高度契约：实测 ~22px（token 约束 calc(var(--space-7) - var(--space-1))）；
 * 5. 溢出保护：窄容器（如 390px 手机视口）下单行截断、文字自适应省略，绝不换行；
 * 6. 全宽平直底栏：作为工作台底栏无大胶囊圆角，严密贴合视口底边。
 */
import {computed, ref, watch} from "vue";
import WorkbenchStatusBar from "nbook/app/components/workbench/WorkbenchStatusBar.vue";
import WorkbenchStatusBarItem from "nbook/app/components/workbench/WorkbenchStatusBarItem.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const publishLabData = useLabDataSink();

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value !== "" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const config = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    return {
        branch: readString(data.branch, "refactor/w00003-nb-ui-adoption"),
        errors: readNumber(data.errors, props.scene === "errors" ? 5 : (props.scene === "clean" ? 0 : 0)),
        warnings: readNumber(data.warnings, props.scene === "errors" ? 12 : (props.scene === "clean" ? 0 : 3)),
        infos: readNumber(data.infos, props.scene === "errors" ? 8 : (props.scene === "clean" ? 0 : 14)),
        line: readNumber(data.line, 42),
        column: readNumber(data.column, 18),
        encoding: readString(data.encoding, "UTF-8"),
        language: readString(data.language, "TypeScript"),
        narrow: props.scene === "narrow",
    };
});

// 可在 Controls 中动态调节的状态
const dynamicErrors = ref(0);
const dynamicWarnings = ref(0);
const dynamicInfos = ref(0);
const isSyncing = ref(false);
const activePanel = ref(false);

watch(() => props.scene, () => {
    dynamicErrors.value = config.value.errors;
    dynamicWarnings.value = config.value.warnings;
    dynamicInfos.value = config.value.infos;
    isSyncing.value = false;
    activePanel.value = false;
}, {immediate: true});

function onItemClick(id: string): void {
    if (id === "sync") {
        isSyncing.value = !isSyncing.value;
    }
    if (id === "panel") {
        activePanel.value = !activePanel.value;
    }
    emitLabEvent("status-bar-item-click", {id, time: Date.now()});
}

watch([dynamicErrors, dynamicWarnings, dynamicInfos, isSyncing, activePanel], () => {
    publishLabData({
        scene: props.scene,
        branch: config.value.branch,
        errors: dynamicErrors.value,
        warnings: dynamicWarnings.value,
        infos: dynamicInfos.value,
        isSyncing: isSyncing.value,
        activePanel: activePanel.value,
    });
}, {immediate: true});
</script>

<template>
    <div class="flex h-full w-full flex-col justify-between overflow-hidden bg-[var(--bg-main)]">
        <LabFixtureControls>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="font-medium text-[var(--text-secondary)]">状态栏动态调试：</span>

                <!-- 模拟错误增减 -->
                <div class="flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-1.5 py-0.5">
                    <span class="text-[10px] text-[var(--status-danger)]">错误: {{ dynamicErrors }}</span>
                    <button
                        type="button"
                        class="h-4 w-4 cursor-pointer rounded bg-[var(--bg-hover)] text-center leading-none text-[10px]"
                        @click="dynamicErrors = Math.max(0, dynamicErrors - 1)"
                    >
                        -
                    </button>
                    <button
                        type="button"
                        class="h-4 w-4 cursor-pointer rounded bg-[var(--bg-hover)] text-center leading-none text-[10px]"
                        @click="dynamicErrors += 1"
                    >
                        +
                    </button>
                </div>

                <!-- 模拟同步切换 -->
                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="isSyncing ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="isSyncing = !isSyncing"
                >
                    {{ isSyncing ? "同步中 (旋转)" : "切换同步态" }}
                </button>

                <!-- 模拟面板状态切换 -->
                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="activePanel ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="activePanel = !activePanel"
                >
                    {{ activePanel ? "底部面板: 打开" : "底部面板: 关闭" }}
                </button>

                <span class="text-[var(--text-muted)]">|</span>
                <span class="text-xs text-[var(--text-secondary)]">
                    提示：点击顶栏「手机 (390px)」可观察窄屏自动单行截断
                </span>
            </div>
        </LabFixtureControls>

        <!-- 工作台视口主区（模拟 IDE 编辑区背景） -->
        <div class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center select-none">
            <div class="i-lucide-layout text-3xl text-[var(--text-muted)] opacity-50"></div>
            <div class="text-xs font-medium text-[var(--text-secondary)]">工作台工作区视口</div>
            <div class="max-w-md text-[11px] text-[var(--text-muted)]">
                状态栏以 22px 契约平直吸附于视口最底部，支持拖拽画布手柄实时走查全屏与窄屏截断行为。
            </div>
        </div>

        <!-- 核心被测组件：整条状态栏（平直贴附底边，无大药丸胶囊圆角） -->
        <WorkbenchStatusBar data-lab-subject="statusbar" class="w-full shrink-0">
            <template #left>
                <!-- 远程/主入口 -->
                <WorkbenchStatusBarItem
                    id="remote"
                    icon="i-lucide-radio"
                    label="NeuroBook"
                    title="已连接本地环境"
                    @click="onItemClick('remote')"
                />

                <!-- Git 分支 -->
                <WorkbenchStatusBarItem
                    id="branch"
                    icon="i-lucide-git-branch"
                    :label="config.branch"
                    title="当前分支"
                    @click="onItemClick('branch')"
                />

                <!-- 同步按钮 -->
                <WorkbenchStatusBarItem
                    id="sync"
                    icon="i-lucide-refresh-cw"
                    :label="isSyncing ? '同步中...' : '0↓ 1↑'"
                    title="与远程仓库同步"
                    :class="{'animate-spin': isSyncing}"
                    @click="onItemClick('sync')"
                />

                <!-- 错误计数 -->
                <WorkbenchStatusBarItem
                    v-if="dynamicErrors > 0 || props.scene !== 'clean'"
                    id="errors"
                    icon="i-lucide-x-circle"
                    :badge="dynamicErrors"
                    variant="error"
                    title="错误数"
                    @click="onItemClick('errors')"
                />

                <!-- 警告计数 -->
                <WorkbenchStatusBarItem
                    v-if="dynamicWarnings > 0 || props.scene !== 'clean'"
                    id="warnings"
                    icon="i-lucide-alert-triangle"
                    :badge="dynamicWarnings"
                    variant="warning"
                    title="警告数"
                    @click="onItemClick('warnings')"
                />

                <!-- 信息计数 -->
                <WorkbenchStatusBarItem
                    v-if="dynamicInfos > 0 || props.scene !== 'clean'"
                    id="infos"
                    icon="i-lucide-info"
                    :badge="dynamicInfos"
                    variant="info"
                    title="信息提示数"
                    @click="onItemClick('infos')"
                />
            </template>

            <template #right>
                <!-- 光标行列 -->
                <WorkbenchStatusBarItem
                    id="cursor"
                    :label="`第 ${config.line} 行，第 ${config.column} 列`"
                    title="光标行列位置"
                    @click="onItemClick('cursor')"
                />

                <!-- 编码 -->
                <WorkbenchStatusBarItem
                    id="encoding"
                    :label="config.encoding"
                    title="文件编码"
                    @click="onItemClick('encoding')"
                />

                <!-- 语言 -->
                <WorkbenchStatusBarItem
                    id="language"
                    :label="config.language"
                    title="语言模式"
                    @click="onItemClick('language')"
                />

                <!-- 底部面板切换 -->
                <WorkbenchStatusBarItem
                    id="panel"
                    icon="i-lucide-panel-bottom"
                    label="面板"
                    :active="activePanel"
                    title="切换底部面板"
                    @click="onItemClick('panel')"
                />

                <!-- 通知小铃铛 -->
                <WorkbenchStatusBarItem
                    id="notifications"
                    icon="i-lucide-bell"
                    title="通知面板"
                    @click="onItemClick('notifications')"
                />
            </template>
        </WorkbenchStatusBar>
    </div>
</template>
