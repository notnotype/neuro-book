<script setup lang="ts">
import {computed} from "vue";
import {Menubar, type MenubarItemData, type MenubarMenuData} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    menus?: MenubarMenuData[];
}>(), {
    menus: () => [],
});

const emit = defineEmits<{
    (e: "select", item: MenubarItemData): void;
}>();

const {t} = useI18n();

const originalItemByValue = new Map<string, MenubarItemData>();

function mapItem(item: MenubarItemData): MenubarItemData {
    originalItemByValue.set(item.value, item);

    const isCheckable = typeof item.checked === "boolean" || item.type === "checkbox" || item.type === "radio";
    const mappedChildren = item.children && item.children.length > 0 ? item.children.map(mapItem) : undefined;

    if (!isCheckable) {
        if (mappedChildren) {
            return {
                ...item,
                children: mappedChildren,
            };
        }
        return item;
    }

    const isChecked = Boolean(item.checked);
    return {
        ...item,
        label: isChecked ? `${item.label} (${t("editorWorkbench.selected")})` : item.label,
        iconClass: isChecked ? "i-lucide-check" : "invisible i-lucide-check",
        children: mappedChildren,
    };
}

const displayMenus = computed<MenubarMenuData[]>(() => {
    originalItemByValue.clear();
    return props.menus.map((menu) => ({
        ...menu,
        items: menu.items.map(mapItem),
    }));
});

function handleSelect(item: MenubarItemData): void {
    const original = originalItemByValue.get(item.value) ?? item;
    emit("select", original);
}
</script>

<template>
    <nav
        class="editor-toolbar flex shrink-0 items-center select-none"
        aria-label="Editor Workbench Menus"
    >
        <Menubar
            :menus="displayMenus"
            size="sm"
            @select="handleSelect"
        />
    </nav>
</template>
