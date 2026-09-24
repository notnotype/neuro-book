<script setup lang="ts">
/**
 * 桌面标题栏菜单模块：包含全量平铺菜单栏（File / Edit / View / Help）与紧凑汉堡菜单两态。
 *
 * 两态统一复用正统 @notnotype/nb-ui 的 NbDropdown（基于 Reka UI 原语）。
 * 紧凑态先列出四组，再逐级展开各组原有命令。
 */
import {useEventListener} from "@vueuse/core";
import {computed} from "vue";
import type {DesktopMenuCommandId} from "@notnotype/neuro-book-contracts/desktop";
import {Dropdown as NbDropdown, IconButton as NbIconButton, type DropdownItem} from "@notnotype/nb-ui/components";
import type {TitleBarHostCapabilities, TitleBarMenuGroupModel, TitleBarMenuPresentation} from "nbook/app/utils/workbench-chrome";
import {resolveTitleBarMenuGroups} from "nbook/app/utils/workbench-chrome";

const props = defineProps<{
    capabilities: TitleBarHostCapabilities;
    rendererMenus: boolean;
    presentation: TitleBarMenuPresentation;
    openMenu: string | null;
}>();

const emit = defineEmits<{
    (e: "update:openMenu", value: string | null): void;
    (e: "invoke-command", command: DesktopMenuCommandId): void;
}>();

const menus = computed(() => resolveTitleBarMenuGroups(props.capabilities));

function groupDisplayLabel(label: string): string {
    const map: Record<string, string> = {
        File: "文件(F)",
        Edit: "编辑(E)",
        View: "查看(V)",
        Help: "帮助(H)",
    };
    return map[label] ?? label;
}

function dropdownItemsForGroup(group: TitleBarMenuGroupModel): DropdownItem[] {
    return group.items.map((item) => ({
        label: item.label,
        value: item.command,
        disabled: item.disabled,
        title: item.disabledReason ?? undefined,
    }));
}

const compactDropdownItems = computed<DropdownItem[]>(() => menus.value.map((group) => ({
    label: groupDisplayLabel(group.label),
    value: `group:${group.label}`,
    children: dropdownItemsForGroup(group),
})));

function onSelectCommand(command: string): void {
    emit("update:openMenu", null);
    emit("invoke-command", command as DesktopMenuCommandId);
}

function onOpenGroupChange(label: string, open: boolean): void {
    emit("update:openMenu", open ? label : null);
}

function onCompactOpenChange(open: boolean): void {
    emit("update:openMenu", open ? "compact" : null);
}

function switchGroup(offset: number): void {
    const labels = menus.value.map((group) => group.label);
    const current = labels.indexOf(props.openMenu ?? "");
    if (current < 0) return;
    const next = labels[(current + offset + labels.length) % labels.length];
    if (next === undefined) return;
    emit("update:openMenu", next);
}

useEventListener(document, "keydown", (event) => {
    if (!props.openMenu || props.openMenu === "project") return;
    if (event.key === "Escape") {
        event.preventDefault();
        const currentMenu = props.openMenu;
        emit("update:openMenu", null);
        const trigger = document.querySelector<HTMLElement>(`[data-menu-button="${currentMenu}"]`);
        trigger?.focus();
        return;
    }
    if (props.openMenu === "compact") return;
    if (event.key === "ArrowRight") {
        event.preventDefault();
        switchGroup(1);
    } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        switchGroup(-1);
    }
});
</script>

<template>
    <div class="desktop-title-bar__menus-root">
        <!-- 全量平铺模式：四组一级菜单全部接入统一的 NbDropdown -->
        <div v-if="rendererMenus && presentation === 'full'" class="desktop-title-bar__menus">
            <div
                v-for="group in menus"
                :key="group.label"
                class="desktop-title-bar__menu-group"
                :data-menu="group.label"
            >
                <NbDropdown
                    :items="dropdownItemsForGroup(group)"
                    :open="openMenu === group.label"
                    align="start"
                    side="bottom"
                    :side-offset="6"
                    menu-class="min-w-[170px]"
                    :content-props="{'data-titlebar-menu-panel': 'group'}"
                    @update:open="onOpenGroupChange(group.label, $event)"
                    @select="onSelectCommand"
                >
                    <button
                        type="button"
                        class="desktop-title-bar__menu"
                        :data-menu-button="group.label"
                        aria-haspopup="menu"
                        :aria-expanded="openMenu === group.label"
                    >
                        {{ groupDisplayLabel(group.label) }}
                    </button>
                </NbDropdown>
            </div>
        </div>

        <!-- 紧凑汉堡模式：同样接入统一的 NbDropdown -->
        <div v-else-if="rendererMenus" class="desktop-title-bar__menu-group" data-menu="compact">
            <NbDropdown
                :items="compactDropdownItems"
                :open="openMenu === 'compact'"
                align="start"
                side="bottom"
                :side-offset="6"
                menu-class="min-w-[200px] max-w-[320px]"
                menu-max-height="none"
                :content-props="{'data-titlebar-menu-panel': 'compact'}"
                @update:open="onCompactOpenChange"
                @select="onSelectCommand"
            >
                <NbIconButton
                    size="sm"
                    icon-class="i-lucide-menu"
                    title="应用程序菜单"
                    aria-label="应用程序菜单"
                    data-menu-button="compact"
                    class="cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-main)]"
                />
            </NbDropdown>
        </div>
    </div>
</template>

<style scoped>
.desktop-title-bar__menus-root,
.desktop-title-bar__menus {
    display: flex;
    align-items: center;
    height: 100%;
    min-width: 0;
    flex-shrink: 0;
    flex-wrap: nowrap;
    white-space: nowrap;
}

.desktop-title-bar__menu-group {
    position: relative;
    flex-shrink: 0;
    flex-wrap: nowrap;
    white-space: nowrap;
}

.desktop-title-bar__menu {
    height: var(--control-h-sm);
    color: inherit;
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    -webkit-app-region: no-drag;
    border: none;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
    flex-wrap: nowrap;
    white-space: nowrap;
    padding: 0 var(--space-3);
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.desktop-title-bar__menu:hover {
    color: var(--text-main);
    background: var(--bg-hover);
}
</style>
