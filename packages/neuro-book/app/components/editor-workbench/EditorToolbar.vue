<script setup lang="ts">
import {computed, inject} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";
import {
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuRoot,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "reka-ui";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "@notnotype/nb-ui/theme";
import type {MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";

export interface EditorToolbarAction {
    id: string;
    label: string;
    iconClass: string;
    title?: string;
    active?: boolean;
    disabled?: boolean;
    onClick?: () => void;
}

const props = withDefaults(defineProps<{
    menus?: MenubarMenuData[];
    /** 是否提供分屏入口；默认关闭，宿主按产品能力打开。 */
    allowSplit?: boolean;
    actions?: EditorToolbarAction[];
    statusText?: string;
}>(), {
    menus: () => [],
    allowSplit: false,
    actions: () => [],
    statusText: "",
});

const emit = defineEmits<{
    (e: "select", item: MenubarItemData): void;
    (e: "split"): void;
    (e: "action", actionId: string): void;
}>();

const {t} = useI18n();

/** 窗口内的浮层跟随窗口层级（由 DialogWindow 注入）；未被窗口承载时回退到普通页面层级。 */
const popoverZIndex = inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);

const hasItems = computed(() => {
    return props.menus.some((m) => m.items && m.items.length > 0);
});

function handleSelect(item: MenubarItemData): void {
    if (item.disabled || item.separator) {
        return;
    }
    emit("select", item);
}
</script>

<template>
    <nav
        class="editor-toolbar flex shrink-0 items-center gap-1 select-none"
        aria-label="Editor Workbench Actions"
    >
        <!-- 状态信息插槽 (例如 "已保存") -->
        <slot name="status">
            <span
                v-if="statusText"
                class="editor-toolbar-status mr-1 text-[11px] font-normal text-[var(--text-muted)] select-none"
            >
                {{ statusText }}
            </span>
        </slot>

        <!-- 扩展操作插槽 (例如 Markdown 预览切换、比较等) -->
        <slot name="actions">
            <template v-for="action in actions" :key="action.id">
                <IconButton
                    :icon-class="action.iconClass"
                    size="sm"
                    :variant="action.active ? 'secondary' : 'default'"
                    :title="action.title || action.label"
                    :aria-label="action.label"
                    :disabled="action.disabled"
                    class="editor-toolbar-custom-action cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-main)]"
                    :class="action.active ? '!text-[var(--accent-text)] bg-[var(--bg-hover)]' : ''"
                    @click="action.onClick ? action.onClick() : emit('action', action.id)"
                />
            </template>
        </slot>

        <IconButton
            v-if="allowSplit && (hasItems || (actions && actions.length > 0))"
            icon-class="i-lucide-columns-2"
            size="sm"
            variant="default"
            :title="t('editorWorkbench.splitRight')"
            :aria-label="t('editorWorkbench.splitRight')"
            class="editor-toolbar-split-btn cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-main)]"
            @click="emit('split')"
        />

        <DropdownMenuRoot v-if="hasItems">
            <DropdownMenuTrigger as-child>
                <IconButton
                    icon-class="i-lucide-more-horizontal"
                    size="sm"
                    variant="default"
                    :title="t('editorWorkbench.moreActions')"
                    :aria-label="t('editorWorkbench.moreActions')"
                    class="editor-toolbar-more-btn cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-main)]"
                />
            </DropdownMenuTrigger>

            <DropdownMenuPortal>
                <DropdownMenuContent
                    align="end"
                    side="bottom"
                    :side-offset="6"
                    :style="{ zIndex: popoverZIndex }"
                    class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion min-w-[200px] max-w-[320px] p-1.5 text-[var(--text-main)] outline-none select-none"
                >
                    <template v-for="(menu, menuIndex) in props.menus" :key="menu.id || menuIndex">
                        <!-- 菜单组间分隔线 -->
                        <DropdownMenuSeparator
                            v-if="menuIndex > 0 && menu.items && menu.items.length > 0"
                            class="my-1 h-[1px] bg-[var(--divider)]"
                        />

                        <template v-for="item in menu.items" :key="item.value">
                            <!-- 分隔项 -->
                            <DropdownMenuSeparator
                                v-if="item.separator"
                                class="my-1 h-[1px] bg-[var(--divider)]"
                            />

                            <!-- 具备子菜单项 (如导出作品展开 EPUB/PDF) -->
                            <DropdownMenuSub v-else-if="item.children && item.children.length > 0">
                                <DropdownMenuSubTrigger
                                    :disabled="item.disabled"
                                    class="nb-ui-popover-item flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] motion-reduce:transition-none hover:bg-[var(--overlay-item-active)] data-[state=open]:bg-[var(--overlay-item-active)] data-[highlighted]:bg-[var(--overlay-item-active)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <div class="flex items-center gap-2 truncate">
                                        <span v-if="item.iconClass" :class="[item.iconClass, 'h-4 w-4 shrink-0']" aria-hidden="true" />
                                        <span class="truncate">{{ item.label }}</span>
                                    </div>
                                    <span class="i-lucide-chevron-right h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                                </DropdownMenuSubTrigger>

                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent
                                        :side-offset="4"
                                        :style="{ zIndex: popoverZIndex + 1 }"
                                        class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion min-w-[180px] p-1.5 text-[var(--text-main)] outline-none select-none"
                                    >
                                        <template v-for="child in item.children" :key="child.value">
                                            <DropdownMenuSeparator
                                                v-if="child.separator"
                                                class="my-1 h-[1px] bg-[var(--divider)]"
                                            />
                                            <DropdownMenuItem
                                                v-else
                                                :disabled="child.disabled"
                                                :data-tone="child.tone"
                                                class="nb-ui-popover-item flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] motion-reduce:transition-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                                :class="child.tone === 'danger'
                                                    ? 'text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] data-[highlighted]:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)]'
                                                    : 'text-[var(--text-main)] hover:bg-[var(--overlay-item-active)] data-[highlighted]:bg-[var(--overlay-item-active)]'"
                                                @click="handleSelect(child)"
                                            >
                                                <div class="flex items-center gap-2 truncate">
                                                    <span v-if="child.iconClass" :class="[child.iconClass, 'h-4 w-4 shrink-0']" aria-hidden="true" />
                                                    <span class="truncate">{{ child.label }}</span>
                                                </div>
                                                <span v-if="child.shortcut" class="font-mono text-[10px] text-[var(--text-muted)] shrink-0 ml-2">{{ child.shortcut }}</span>
                                            </DropdownMenuItem>
                                        </template>
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>

                            <!-- 复选/单选菜单项（标准 ARIA menuitemcheckbox 语义） -->
                            <DropdownMenuCheckboxItem
                                v-else-if="item.type === 'checkbox' || typeof item.checked === 'boolean'"
                                :model-value="Boolean(item.checked)"
                                :disabled="item.disabled"
                                class="nb-ui-popover-item flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] motion-reduce:transition-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[var(--overlay-item-active)] data-[highlighted]:bg-[var(--overlay-item-active)]"
                                @select="handleSelect(item)"
                            >
                                <div class="flex items-center gap-2 truncate">
                                    <span class="h-3.5 w-3.5 shrink-0 flex items-center justify-center" aria-hidden="true">
                                        <span v-if="item.checked" class="i-lucide-check h-3.5 w-3.5 text-[var(--accent-text)]" />
                                    </span>
                                    <span class="truncate">{{ item.label }}</span>
                                </div>
                                <span v-if="item.shortcut" class="font-mono text-[10px] text-[var(--text-muted)] shrink-0 ml-2">{{ item.shortcut }}</span>
                            </DropdownMenuCheckboxItem>

                            <!-- 普通叶子菜单项 -->
                            <DropdownMenuItem
                                v-else
                                :disabled="item.disabled"
                                :data-tone="item.tone"
                                class="nb-ui-popover-item flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] motion-reduce:transition-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                :class="item.tone === 'danger'
                                    ? 'text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] data-[highlighted]:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)]'
                                    : 'text-[var(--text-main)] hover:bg-[var(--overlay-item-active)] data-[highlighted]:bg-[var(--overlay-item-active)]'"
                                @click="handleSelect(item)"
                            >
                                <div class="flex items-center gap-2 truncate">
                                    <span v-if="item.iconClass" :class="[item.iconClass, 'h-4 w-4 shrink-0']" aria-hidden="true" />
                                    <span class="truncate">{{ item.label }}</span>
                                </div>
                                <span v-if="item.shortcut" class="font-mono text-[10px] text-[var(--text-muted)] shrink-0 ml-2">{{ item.shortcut }}</span>
                            </DropdownMenuItem>
                        </template>
                    </template>
                </DropdownMenuContent>
            </DropdownMenuPortal>
        </DropdownMenuRoot>
    </nav>
</template>
