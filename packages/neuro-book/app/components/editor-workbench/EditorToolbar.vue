<script setup lang="ts">
import {computed} from "vue";
import {Dropdown, IconButton, type DropdownItem, type MenubarItemData, type MenubarMenuData} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    menus?: MenubarMenuData[];
    showSplit?: boolean;
}>(), {
    menus: () => [],
    showSplit: true,
});

const emit = defineEmits<{
    (e: "select", item: MenubarItemData): void;
    (e: "split"): void;
}>();

const {t} = useI18n();

const originalItemByValue = new Map<string, MenubarItemData>();

const dropdownItems = computed<DropdownItem[]>(() => {
    originalItemByValue.clear();
    const result: DropdownItem[] = [];

    props.menus.forEach((menu, menuIndex) => {
        if (!menu.items || menu.items.length === 0) return;

        // 分组之间插入优雅分割线（对齐 VS Code 下拉菜单排布）
        if (result.length > 0) {
            result.push({
                label: "",
                value: `sep-${menu.id || menuIndex}`,
                separator: true,
            });
        }

        for (const item of menu.items) {
            originalItemByValue.set(item.value, item);

            const isCheckable = typeof item.checked === "boolean" || item.type === "checkbox" || item.type === "radio";
            const isChecked = Boolean(item.checked);

            let iconClass = item.iconClass;
            if (isCheckable) {
                iconClass = isChecked ? "i-lucide-check" : "invisible i-lucide-check";
            }

            result.push({
                label: isCheckable && isChecked
                    ? `${item.label} (${t("editorWorkbench.selected")})`
                    : item.label,
                value: item.value,
                disabled: Boolean(menu.disabled || item.disabled),
                shortcut: item.shortcut,
                iconClass,
                active: isChecked,
            });
        }
    });

    return result;
});

function handleSelect(value: string): void {
    const original = originalItemByValue.get(value);
    if (!original || original.disabled) {
        return;
    }
    emit("select", original);
}
</script>

<template>
    <nav
        class="editor-toolbar flex shrink-0 items-center gap-0.5 select-none"
        aria-label="Editor Workbench Actions"
    >
        <IconButton
            v-if="showSplit && dropdownItems.length > 0"
            icon-class="i-lucide-columns-2"
            size="sm"
            variant="default"
            :title="t('editorWorkbench.splitRight') || '向右拆分编辑器'"
            :aria-label="t('editorWorkbench.splitRight') || '向右拆分编辑器'"
            class="editor-toolbar-split-btn cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-main)]"
            @click="emit('split')"
        />
        <Dropdown
            v-if="dropdownItems.length > 0"
            :items="dropdownItems"
            align="end"
            side="bottom"
            :side-offset="6"
            menu-class="min-w-[200px] max-w-[300px]"
            @select="handleSelect"
        >
            <IconButton
                icon-class="i-lucide-more-horizontal"
                size="sm"
                variant="default"
                :title="t('editorWorkbench.moreActions')"
                :aria-label="t('editorWorkbench.moreActions')"
                class="editor-toolbar-more-btn cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-main)]"
            />
        </Dropdown>
    </nav>
</template>
