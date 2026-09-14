<script setup lang="ts">
/**
 * WorkbenchStatusBar 的 Lab 场景。
 *
 * 演示重点：
 * 1. 左右分组几何：左侧工作空间/Git/问题统计，右侧编码/光标位置/语言/通知；
 * 2. 状态项与角标：支持图标按钮、带角标计数（错误红/警告黄/信息蓝）；
 * 3. 悬停与点击交互：项级 hover 反馈、点击事件记录进 Lab 事件面板；
 * 4. 极窄高度契约：实测 ~22px（token 约束 calc(var(--space-7) - var(--space-1))）；
 * 5. 溢出保护：窄容器下不换行、单行截断。
 */
import {computed, ref} from "vue";
import WorkbenchStatusBar from "nbook/app/components/workbench/WorkbenchStatusBar.vue";
import WorkbenchStatusBarItem from "nbook/app/components/workbench/WorkbenchStatusBarItem.vue";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

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

const isSyncing = ref(false);

function onItemClick(id: string): void {
    if (id === "sync") {
        isSyncing.value = !isSyncing.value;
    }
    emitLabEvent("status-bar-item-click", {id, time: Date.now()});
}
</script>

<template>
    <div class="flex h-full w-full flex-col justify-center items-center bg-[var(--bg-main)] p-4 box-sizing: border-box;">
        <div class="mb-4 text-center text-xs text-[var(--text-muted)]">
            <p class="font-medium text-[var(--text-main)]">Workbench 状态栏（极窄 ~22px 契约）</p>
            <p class="mt-1">左侧项目状态与诊断计数 · 右侧编辑器上下文与通知</p>
        </div>

        <!-- 状态栏演示卡槽（支持普通宽度或窄容器模式） -->
        <div
            class="w-full overflow-hidden rounded-[var(--radius-panel)] border border-[var(--panel-outline)] bg-[var(--bg-panel)] shadow-[var(--elevation-raised)] transition-all [transition-duration:var(--motion-base)]"
            :class="config.narrow ? 'max-w-[360px]' : 'max-w-[880px]'"
            data-testid="status-bar-container"
        >
            <!-- 模拟上方的工作区面 -->
            <div class="flex h-32 items-center justify-center bg-[var(--panel-surface)] text-xs text-[var(--text-muted)]">
                <span>编辑器主体内容区域（状态栏吸附于其底部）</span>
            </div>

            <!-- 状态栏主体：与上方保持 1px 分隔线 -->
            <WorkbenchStatusBar data-lab-subject="statusbar">
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
                        id="errors"
                        icon="i-lucide-x-circle"
                        :badge="config.errors"
                        variant="error"
                        title="错误数"
                        @click="onItemClick('errors')"
                    />

                    <!-- 警告计数 -->
                    <WorkbenchStatusBarItem
                        id="warnings"
                        icon="i-lucide-alert-triangle"
                        :badge="config.warnings"
                        variant="warning"
                        title="警告数"
                        @click="onItemClick('warnings')"
                    />

                    <!-- 信息计数 -->
                    <WorkbenchStatusBarItem
                        id="infos"
                        icon="i-lucide-info"
                        :badge="config.infos"
                        variant="info"
                        title="信息提示数"
                        @click="onItemClick('infos')"
                    />
                </template>

                <template #right>
                    <!-- 行列信息 -->
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
    </div>
</template>
