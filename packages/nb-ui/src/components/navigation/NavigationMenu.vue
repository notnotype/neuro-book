<script setup lang="ts">
import {
    NavigationMenuContent,
    NavigationMenuIndicator,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuRoot,
    NavigationMenuTrigger,
    NavigationMenuViewport,
} from "reka-ui";
import {NB_Z_INDEX} from "../../theme/z-index";

export interface NavigationMenuLinkItem {
    title: string;
    description?: string;
    href?: string;
    iconClass?: string;
}

export interface NavigationMenuItemData {
    id: string;
    label: string;
    links?: NavigationMenuLinkItem[];
    href?: string;
}

const props = withDefaults(defineProps<{
    modelValue?: string;
    defaultValue?: string;
    items?: NavigationMenuItemData[];
    orientation?: "horizontal" | "vertical";
}>(), {
    modelValue: undefined,
    defaultValue: undefined,
    items: () => [],
    orientation: "horizontal",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "select", link: NavigationMenuLinkItem): void;
}>();
</script>

<template>
    <NavigationMenuRoot
        :model-value="props.modelValue"
        :default-value="props.defaultValue"
        :orientation="props.orientation"
        class="relative z-10 flex w-full justify-center select-none"
        @update:model-value="(val) => emit('update:modelValue', val)"
    >
        <NavigationMenuList class="flex items-center gap-1 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] p-1 backdrop-blur-md shadow-sm">
            <NavigationMenuItem
                v-for="item in props.items"
                :key="item.id"
                :value="item.id"
            >
                <!-- 普通链接 -->
                <NavigationMenuLink
                    v-if="!item.links || item.links.length === 0"
                    :href="item.href || '#'"
                    class="nb-ui-focus-ring flex items-center rounded-[calc(var(--radius-control)*0.75)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] cursor-pointer"
                >
                    {{ item.label }}
                </NavigationMenuLink>

                <!-- 带下拉菜单的内容触发器 -->
                <template v-else>
                    <NavigationMenuTrigger
                        class="nb-ui-focus-ring group flex items-center gap-1 rounded-[calc(var(--radius-control)*0.75)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] data-[state=open]:bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] cursor-pointer"
                    >
                        <span>{{ item.label }}</span>
                        <span class="i-lucide-chevron-down h-3.5 w-3.5 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] group-data-[state=open]:rotate-180" aria-hidden="true" />
                    </NavigationMenuTrigger>

                    <NavigationMenuContent
                        class="absolute top-0 left-0 w-full p-2"
                    >
                        <div class="grid w-[380px] grid-cols-2 gap-2 p-2">
                            <NavigationMenuLink
                                v-for="link in item.links"
                                :key="link.title"
                                :href="link.href || '#'"
                                class="nb-ui-focus-ring flex flex-col gap-1 rounded-[var(--radius-control)] p-2.5 transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] cursor-pointer text-left"
                                @click="emit('select', link)"
                            >
                                <div class="flex items-center gap-2">
                                    <span v-if="link.iconClass" :class="[link.iconClass, 'h-4 w-4 text-[var(--accent-main)]']" aria-hidden="true" />
                                    <span class="text-xs font-semibold text-[var(--text-main)]">{{ link.title }}</span>
                                </div>
                                <span v-if="link.description" class="text-[11px] text-[var(--text-muted)] leading-normal">{{ link.description }}</span>
                            </NavigationMenuLink>
                        </div>
                    </NavigationMenuContent>
                </template>
            </NavigationMenuItem>

            <NavigationMenuIndicator
                class="top-full z-10 flex h-2.5 items-end justify-center overflow-hidden transition-[transform,opacity] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] data-[state=visible]:animate-in data-[state=hidden]:animate-out"
            >
                <div class="relative top-[60%] h-2 w-2 rotate-45 rounded-tl-[2px] bg-[var(--bg-panel)] shadow-md" />
            </NavigationMenuIndicator>
        </NavigationMenuList>

        <!-- 视口容器 -->
        <div class="perspective-[2000px] absolute top-full left-0 flex w-full justify-center">
            <NavigationMenuViewport
                :style="{
                    zIndex: NB_Z_INDEX.popover,
                }"
                class="nb-ui-popover-surface nb-ui-menu-surface relative mt-2 h-[var(--reka-navigation-menu-viewport-height)] w-full origin-[top_center] overflow-hidden transition-[width,height] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-standard)] md:w-[var(--reka-navigation-menu-viewport-width)]"
            />
        </div>
    </NavigationMenuRoot>
</template>
