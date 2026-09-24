<script setup lang="ts">
/**
 * 桌面标题栏右侧操作控制模块：
 * 1. Agent 侧栏开关：带连接状态指示点（本地绿 / 远程蓝）；
 * 2. 布局控制工具组（参考 VS Code）：切换主侧栏、切换底部面板。
 */
import {IconButton as NbIconButton} from "@notnotype/nb-ui/components";
import type {TitleBarHostCapabilities} from "nbook/app/utils/workbench-chrome";

const props = withDefaults(defineProps<{
    capabilities: TitleBarHostCapabilities;
    agentPanelAvailable: boolean;
    agentPanelOpen: boolean;
    connection: "local" | "remote" | null;
    showLayoutControls?: boolean;
    sidebarOpen?: boolean;
    bottomPanelOpen?: boolean;
}>(), {
    showLayoutControls: true,
    sidebarOpen: true,
    bottomPanelOpen: false,
});

const emit = defineEmits<{
    (e: "toggle-agent-panel"): void;
    (e: "toggle-sidebar"): void;
    (e: "toggle-bottom-panel"): void;
}>();

function onToggleAgent(): void {
    if (!props.capabilities.surfaceActive) return;
    emit("toggle-agent-panel");
}
</script>

<template>
    <div class="desktop-title-bar__actions" role="toolbar" aria-label="标题栏快捷控制">
        <!-- 布局切换控制组 (VS Code 风格) -->
        <div v-if="showLayoutControls" class="desktop-title-bar__layout-group">
            <NbIconButton
                size="sm"
                :variant="sidebarOpen ? 'accent' : 'default'"
                class="desktop-title-bar__action-btn"
                :class="{'desktop-title-bar__action-btn--active': sidebarOpen}"
                title="切换主侧栏显示"
                aria-label="切换主侧栏"
                data-titlebar-action="toggle-sidebar"
                icon-class="i-lucide-panel-left"
                @click="emit('toggle-sidebar')"
            />

            <NbIconButton
                size="sm"
                :variant="bottomPanelOpen ? 'accent' : 'default'"
                class="desktop-title-bar__action-btn"
                :class="{'desktop-title-bar__action-btn--active': bottomPanelOpen}"
                title="切换底部面板显示"
                aria-label="切换底部面板"
                data-titlebar-action="toggle-bottom-panel"
                icon-class="i-lucide-panel-bottom"
                @click="emit('toggle-bottom-panel')"
            />
        </div>

        <!-- 分割细线 -->
        <div v-if="showLayoutControls && agentPanelAvailable" class="desktop-title-bar__actions-divider"></div>

        <!-- Agent 助手开关按钮 -->
        <NbIconButton
            v-if="agentPanelAvailable"
            size="sm"
            :variant="agentPanelOpen ? 'accent' : 'default'"
            class="desktop-title-bar__action-btn desktop-title-bar__agent-btn"
            :class="{'desktop-title-bar__action-btn--active': agentPanelOpen}"
            :disabled="!capabilities.surfaceActive"
            :aria-pressed="agentPanelOpen"
            :title="capabilities.surfaceActive ? (agentPanelOpen ? '关闭 Agent 助手' : '打开 Agent 助手') : '请先打开一个 Project'"
            aria-label="Agent 助手"
            data-titlebar-action="toggle-agent-panel"
            icon-class="i-lucide-bot"
            @click="onToggleAgent"
        >
            <span
                v-if="connection"
                class="desktop-title-bar__connection-dot"
                :class="connection === 'remote' ? 'desktop-title-bar__connection-dot--remote' : ''"
                :title="connection === 'remote' ? '已连接远程后端' : '已连接本地运行环境'"
            ></span>
        </NbIconButton>
    </div>
</template>

<style scoped>
.desktop-title-bar__actions {
    display: flex;
    height: 100%;
    align-items: center;
    gap: var(--space-1);
    -webkit-app-region: no-drag;
}

.desktop-title-bar__layout-group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.desktop-title-bar__actions-divider {
    width: var(--border-w);
    height: 14px;
    background: var(--divider);
    margin: 0 2px;
}

.desktop-title-bar__action-btn {
    display: flex;
    width: var(--control-h-sm);
    height: var(--control-h-sm);
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    border-radius: var(--radius-control);
    background: transparent;
    border: none;
    cursor: pointer;
    transition:
        background-color var(--motion-fast) var(--ease-standard),
        color var(--motion-fast) var(--ease-standard);
}

.desktop-title-bar__action-btn:hover {
    color: var(--text-main);
    background: var(--bg-hover);
}

.desktop-title-bar__action-btn--active {
    color: var(--accent-main);
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
}

.desktop-title-bar__action-btn:disabled {
    cursor: not-allowed;
    opacity: 0.35;
}

.desktop-title-bar__agent-btn {
    position: relative;
}

.desktop-title-bar__connection-dot {
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 6px;
    height: 6px;
    background: var(--status-success);
    border: var(--border-w) solid var(--bg-panel);
    border-radius: var(--radius-pill);
}

.desktop-title-bar__connection-dot--remote {
    background: var(--status-info);
}

@media (max-width: 640px) {
    .desktop-title-bar__layout-group {
        display: none;
    }
    .desktop-title-bar__actions-divider {
        display: none;
    }
}
</style>
