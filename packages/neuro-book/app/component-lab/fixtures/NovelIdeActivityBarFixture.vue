<script setup lang="ts">
/**
 * NovelIdeActivityBar 的 Lab 场景（产品活动栏 · 假 DTO）。
 *
 * 演示重点：
 * 1. default：桌面壳里 Project 已打开——上半是主侧栏的两个容器（工具 / 面板，其一选中），下半是工具命令与账户/设置；
 * 2. disabled：书架态（未打开 Project）——容器仍可选中（选择只改可见性偏好），工具命令点不动，理由进 tooltip 与 aria-label；
 * 3. account：给一个假 AuthUserDto，账户格整项换成账户菜单（个人中心 / 管理员后台 / 本地退出）。
 *
 * 全部交互只记录进 Lab 事件面板；fixture 不发任何产品请求，也不读写产品存储。
 */
import {computed, ref, watch} from "vue";
import type {AuthUserDto} from "nbook/shared/dto/auth.dto";
import NovelIdeActivityBar, {type WorkbenchActivityContainer} from "nbook/app/components/novel-ide/NovelIdeActivityBar.vue";
import {useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const labUser: AuthUserDto = {
    id: "lab-user",
    username: "lab-author",
    displayName: "写作实验员",
    role: "admin",
    sessionVersion: 1,
};

/** 两个容器：与产品容器切片同形（标题与图标已解析），fixture 只给字面量。 */
const LAB_CONTAINERS: readonly WorkbenchActivityContainer[] = [
    {containerId: "lab.container.tools", title: "工具", icon: "i-lucide-files", location: "sidebar-left", partId: "left", viewIds: [], canMoveContainer: true},
    {containerId: "lab.container.panel", title: "面板", icon: "i-lucide-panel-bottom", location: "sidebar-left", partId: "left", viewIds: [], canMoveContainer: true},
];

type LabActivityScene = Readonly<{
    activeContainerId: string | null;
    desktopAvailable: boolean;
    surfaceActive: boolean;
    userAssetsMode: boolean;
    currentUser: AuthUserDto | null;
}>;

const sceneConfigs = {
    default: {activeContainerId: LAB_CONTAINERS[0]!.containerId, desktopAvailable: true, surfaceActive: true, userAssetsMode: false, currentUser: null},
    disabled: {activeContainerId: LAB_CONTAINERS[1]!.containerId, desktopAvailable: true, surfaceActive: false, userAssetsMode: false, currentUser: null},
    account: {activeContainerId: LAB_CONTAINERS[0]!.containerId, desktopAvailable: true, surfaceActive: true, userAssetsMode: false, currentUser: labUser},
} satisfies Record<string, LabActivityScene>;

const lastEvent = ref("");

const config = computed(() => {
    return sceneConfigs[props.scene as keyof typeof sceneConfigs] ?? sceneConfigs.default;
});

function onEvent(name: string, payload?: unknown): void {
    lastEvent.value = payload === undefined ? name : `${name} → ${JSON.stringify(payload)}`;
    emitLabEvent(name, payload);
}

watch(() => props.scene, () => {
    lastEvent.value = "";
});
</script>

<template>
    <div class="flex h-full w-full">
        <LabFixtureControls>
            <div class="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                <div class="font-medium text-[var(--text-main)]">产品活动栏（假 DTO · 不发产品请求）</div>
                <div>场景 {{ props.scene }}：{{ config.surfaceActive ? "Project 已打开" : "书架态（未打开 Project）" }} · 活动容器 {{ config.activeContainerId ?? "（无）" }}</div>
                <div>最近事件：<span class="font-mono text-[var(--text-main)]">{{ lastEvent === "" ? "（还没有）" : lastEvent }}</span></div>
            </div>
        </LabFixtureControls>

        <!-- 活动栏贴左满高 -->
        <div class="h-full w-[48px] shrink-0 border-r border-[var(--divider)] bg-[var(--bg-main)]">
            <NovelIdeActivityBar
                data-lab-subject="novel-ide-activity-bar"
                class="h-full w-full"
                :containers="LAB_CONTAINERS"
                :active-container-id="config.activeContainerId"
                :desktop-available="config.desktopAvailable"
                :surface-active="config.surfaceActive"
                :user-assets-mode="config.userAssetsMode"
                :current-user="config.currentUser"
                @open-home="onEvent('open-home')"
                @open-container="onEvent('open-container', $event)"
                @open-world-engine="onEvent('open-world-engine')"
                @open-trace-viewer="onEvent('open-trace-viewer')"
                @open-history-inbox="onEvent('open-history-inbox')"
                @open-plot-workbench="onEvent('open-plot-workbench')"
                @open-settings="onEvent('open-settings')"
                @open-profile="onEvent('open-profile')"
                @open-admin="onEvent('open-admin')"
                @logout="onEvent('logout')"
            />
        </div>

        <!-- 模拟工作区其余部分 -->
        <div class="flex flex-1 items-center justify-center bg-[var(--panel-surface)] text-xs text-[var(--text-muted)] select-none">
            <span>工作区主视区（活动栏吸附于视口左侧）</span>
        </div>
    </div>
</template>
