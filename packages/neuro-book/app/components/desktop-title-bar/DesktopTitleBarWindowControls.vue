<script setup lang="ts">
/**
 * 桌面标题栏窗口控制按钮模块（Windows 自绘 Chrome 风格）：
 * 包含最小化、最大化/还原、关闭三个控制按钮。
 *
 * 宽度 46px 满高属系统绘制惯例，关闭键悬停为红色背景。
 */
import type {TitleBarWindowCommand} from "./desktop-title-bar.types";

defineEmits<{
    (e: "window-command", command: TitleBarWindowCommand): void;
}>();
</script>

<template>
    <div class="desktop-title-bar__window-controls" role="group" aria-label="窗口控制">
        <button
            type="button"
            title="最小化"
            aria-label="最小化"
            @click="$emit('window-command', 'minimize')"
        >
            <span class="i-lucide-minus h-3.5 w-3.5"></span>
        </button>

        <button
            type="button"
            title="最大化 / 还原"
            aria-label="最大化"
            @click="$emit('window-command', 'toggle-maximize')"
        >
            <span class="i-lucide-square h-3 w-3"></span>
        </button>

        <button
            type="button"
            class="desktop-title-bar__close"
            title="关闭"
            aria-label="关闭"
            @click="$emit('window-command', 'close')"
        >
            <span class="i-lucide-x h-3.5 w-3.5"></span>
        </button>
    </div>
</template>

<style scoped>
.desktop-title-bar__window-controls {
    display: flex;
    height: 100%;
    align-items: center;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
}

.desktop-title-bar__window-controls button {
    display: flex;
    width: 46px;
    height: 100%;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.desktop-title-bar__window-controls button:hover {
    color: var(--text-main);
    background: var(--bg-hover);
}

.desktop-title-bar__window-controls .desktop-title-bar__close:hover {
    color: var(--text-inverse);
    background: var(--status-danger);
}
</style>
