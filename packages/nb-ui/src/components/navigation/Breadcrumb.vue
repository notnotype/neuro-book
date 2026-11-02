<script setup lang="ts">
import {useUiText} from "../../text-port";

export interface BreadcrumbItemData {
    label: string;
    href?: string;
    iconClass?: string;
    current?: boolean;
}

const props = withDefaults(defineProps<{
    items?: BreadcrumbItemData[];
    separatorIcon?: string;
    /** 导航区的读屏名称；同一页有多条面包屑时各给一个。缺省经翻译端口取。 */
    ariaLabel?: string;
}>(), {
    items: () => [],
    separatorIcon: "i-lucide-chevron-right",
});

const text = useUiText();

const emit = defineEmits<{
    (e: "click", item: BreadcrumbItemData, event: MouseEvent): void;
}>();
</script>

<template>
    <nav :aria-label="props.ariaLabel ?? text('breadcrumb.label')" class="flex items-center">
        <ol class="flex flex-wrap items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
            <template v-for="(item, index) in props.items" :key="index">
                <li class="inline-flex items-center gap-1">
                    <a
                        v-if="item.href && !item.current"
                        :href="item.href"
                        class="nb-ui-focus-ring inline-flex items-center gap-1 rounded-[calc(var(--radius-control)*0.5)] text-[var(--text-secondary)] transition-colors [transition-duration:var(--motion-fast)] hover:text-[var(--text-main)] hover:underline"
                        @click="emit('click', item, $event)"
                    >
                        <span v-if="item.iconClass" :class="item.iconClass" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                        <span>{{ item.label }}</span>
                    </a>

                    <span
                        v-else
                        class="inline-flex items-center gap-1 select-none"
                        :class="item.current ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-secondary)]'"
                        :aria-current="item.current ? 'page' : undefined"
                    >
                        <span v-if="item.iconClass" :class="item.iconClass" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                        <span>{{ item.label }}</span>
                    </span>
                </li>

                <!-- 分隔符 -->
                <li
                    v-if="index < props.items.length - 1"
                    class="text-[var(--text-muted)] select-none shrink-0"
                    aria-hidden="true"
                >
                    <slot name="separator">
                        <span :class="props.separatorIcon" class="h-3.5 w-3.5 block"></span>
                    </slot>
                </li>
            </template>
        </ol>
    </nav>
</template>
