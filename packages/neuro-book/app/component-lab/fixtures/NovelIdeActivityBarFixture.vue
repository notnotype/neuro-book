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
import {ref, watch} from "vue";
import NovelIdeActivityBar from "nbook/app/components/novel-ide/NovelIdeActivityBar.vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof NovelIdeActivityBar>(() => props.input, [
    "open-home", "open-container", "open-world-engine", "open-trace-viewer", "open-history-inbox",
    "open-plot-workbench", "open-settings", "open-profile", "open-admin", "logout", "container-action",
]);
const lastEvent = ref("");
function onEvent(name: string, payload?: unknown): void {
    lastEvent.value = payload === undefined ? name : `${name} → ${JSON.stringify(payload)}`;
}
watch(() => props.scene, () => { lastEvent.value = ""; });
</script>

<template>
    <div class="flex h-full w-full">
        <LabFixtureControls>
            <div class="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                <div class="font-medium text-[var(--text-main)]">产品活动栏（假 DTO · 不发产品请求）</div>
                <div>场景 {{ props.scene }}：{{ subject.bindings.value.surfaceActive ? "Project 已打开" : "书架态（未打开 Project）" }} · 活动容器 {{ subject.bindings.value.activeContainerId ?? "（无）" }}</div>
                <div>最近事件：<span class="font-mono text-[var(--text-main)]">{{ lastEvent === "" ? "（还没有）" : lastEvent }}</span></div>
            </div>
        </LabFixtureControls>

        <!-- 活动栏贴左满高 -->
        <div class="h-full w-[48px] shrink-0 border-r border-[var(--divider)] bg-[var(--bg-main)]">
            <NovelIdeActivityBar
                data-lab-subject="novel-ide-activity-bar"
                class="h-full w-full"
                v-bind="subject.bindings.value"
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
