<script setup lang="ts">
/**
 * 桌面标题栏居中命令搜索中心（VS Code Command Center 风格）：
 * 1. 居中命令搜索胶囊：显示当前上下文与快捷键提示（Ctrl P / ⌘P）；
 * 2. 点击即可呼出全局命令面板 WorkbenchCommandPalette；
 * 3. 悬停与聚焦微反光动效，符合桌面专业 IDE 质感。
 */
import {computed} from "vue";
import {tryUseWorkbenchCommands} from "nbook/app/composables/useWorkbenchCommands";

const props = defineProps<{
    /** 当前工程名或自定义提示，不传则显示默认提示 */
    projectTitle?: string;
    /** 窗口整体 tooltip 文案 */
    windowTitle?: string;
}>();

const emit = defineEmits<{
    (e: "open-command-palette"): void;
}>();

// 尝试注入工作台命令宿主（如果在工作台或 Lab 环境下）
const commandsHost = tryUseWorkbenchCommands();

const isMac = computed(() => {
    if (typeof navigator === "undefined") return false;
    return /macintosh|mac os x/i.test(navigator.userAgent);
});

const shortcutKey = computed(() => (isMac.value ? "⌘P" : "Ctrl P"));

const searchPlaceholder = computed(() => {
    if (props.projectTitle && props.projectTitle !== "我的书架") {
        return `${props.projectTitle} · 搜索命令与文件`;
    }
    return "搜索命令、文件与章节...";
});

function handleClick(): void {
    emit("open-command-palette");
    if (commandsHost) {
        commandsHost.openPalette("commands");
    }
}
</script>

<template>
    <div
        class="desktop-title-bar__command-center-wrap desktop-title-bar__drag-surface"
        data-tauri-drag-region
        :title="windowTitle || '全局命令搜索中心'"
    >
        <button
            type="button"
            class="desktop-title-bar__command-center"
            data-titlebar-search
            title="搜索命令与文件 (快捷键 Ctrl+P / ⌘P)"
            aria-label="打开命令面板"
            @click="handleClick"
        >
            <span class="i-lucide-search h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
            <span class="desktop-title-bar__command-label">{{ searchPlaceholder }}</span>
            <kbd class="desktop-title-bar__shortcut-badge" aria-hidden="true">{{ shortcutKey }}</kbd>
        </button>
    </div>
</template>

<style scoped>
.desktop-title-bar__command-center-wrap {
    display: flex;
    min-width: 80px;
    height: 100%;
    align-items: center;
    justify-content: center;
    padding: 0 var(--space-2);
    flex: 1 1 auto;
    overflow: hidden;
}

.desktop-title-bar__drag-surface {
    -webkit-app-region: drag;
}

.desktop-title-bar__command-center {
    display: flex;
    width: min(440px, 100%);
    min-width: 80px;
    height: var(--control-h-sm);
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    color: var(--text-secondary);
    background: var(--control-surface);
    border: var(--border-w) solid var(--control-outline);
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    cursor: pointer;
    user-select: none;
    flex-wrap: nowrap;
    white-space: nowrap;
    -webkit-app-region: no-drag;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text-main) 4%, transparent);
    transition:
        border-color var(--motion-fast) var(--ease-standard),
        background-color var(--motion-fast) var(--ease-standard),
        color var(--motion-fast) var(--ease-standard),
        box-shadow var(--motion-fast) var(--ease-standard);
}

.desktop-title-bar__command-center:hover {
    color: var(--text-main);
    background: var(--bg-hover);
    border-color: color-mix(in srgb, var(--accent-main) 40%, var(--control-outline));
    box-shadow: 0 1px 4px color-mix(in srgb, var(--accent-main) 12%, transparent);
}

.desktop-title-bar__command-center:focus-visible {
    outline: none;
    border-color: var(--accent-main);
    box-shadow: var(--focus-ring);
}

.desktop-title-bar__command-label {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    color: var(--text-muted);
}

.desktop-title-bar__command-center:hover .desktop-title-bar__command-label {
    color: var(--text-secondary);
}

.desktop-title-bar__shortcut-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 16px;
    padding: 0 4px;
    border-radius: var(--radius-xs, 2px);
    border: var(--border-w) solid var(--divider);
    background: var(--bg-subtle);
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    font-weight: var(--weight-medium);
    line-height: 1;
    flex-shrink: 0;
    white-space: nowrap;
}

@media (max-width: 640px) {
    .desktop-title-bar__shortcut-badge {
        display: none;
    }
}
</style>
