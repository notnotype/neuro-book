<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import {resolveFileIcon} from "../../utils/editor-workbench/editor-icon";

export type BreadcrumbItem = {
    id: string;
    label: string;
    iconClass?: string;
    path?: string;
    isLast?: boolean;
    data?: unknown;
};

const props = withDefaults(defineProps<{
    /** 当前文件路径，用于自动解析层级面包屑 */
    path?: string;
    /** 外部直接提供的自定义面包屑节点（若提供则优先使用） */
    items?: readonly BreadcrumbItem[];
    /** 附加符号节点（例如 Markdown 标题大纲或代码符号） */
    symbols?: readonly {id: string; label: string; iconClass?: string}[];
    /** 是否展示底部分割线（默认 true；嵌入独立卡片或外层已有边框时可设为 false 避免底边框重叠加粗） */
    bordered?: boolean;
}>(), {
    path: "",
    items: undefined,
    symbols: () => [],
    bordered: true,
});

const emit = defineEmits<{
    (e: "navigate", item: BreadcrumbItem): void;
}>();

const scrollContainerRef = ref<HTMLOListElement | null>(null);

function resolveSymbols(): BreadcrumbItem[] {
    if (!props.symbols || props.symbols.length === 0) return [];
    return props.symbols.map((sym, index) => ({
        id: sym.id,
        label: sym.label,
        iconClass: sym.iconClass || "i-lucide-braces text-[var(--accent-text)]",
        isLast: index === props.symbols!.length - 1,
    }));
}

const resolvedSegments = computed<BreadcrumbItem[]>(() => {
    const symbolItems = resolveSymbols();
    const hasSymbols = symbolItems.length > 0;

    if (props.items && props.items.length > 0) {
        const baseItems = props.items.map((item, idx) => ({
            ...item,
            isLast: hasSymbols ? false : idx === props.items!.length - 1,
        }));
        return [...baseItems, ...symbolItems];
    }

    const rawPath = props.path?.trim();
    if (!rawPath) return symbolItems;

    // 统一 Windows 反斜杠为正斜杠，消除连续斜杠并去除首尾斜杠
    const normalized = rawPath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
    const parts = normalized.split("/").filter(Boolean);
    const result: BreadcrumbItem[] = [];
    let accPath = "";

    parts.forEach((part, index) => {
        accPath = accPath ? `${accPath}/${part}` : part;
        const isLastFile = index === parts.length - 1;
        result.push({
            id: accPath,
            label: part,
            path: accPath,
            // 严格对齐 VS Code：路径目录段不显示文件夹图标，保持清爽；只有末尾具体文件显示图标
            iconClass: isLastFile ? resolveFileIcon(part) : undefined,
            isLast: isLastFile && !hasSymbols,
        });
    });

    return [...result, ...symbolItems];
});

function handleItemClick(item: BreadcrumbItem): void {
    emit("navigate", item);
}

/** 鼠标滚轮横向平滑滚动面包屑 */
function handleWheel(event: WheelEvent): void {
    const container = scrollContainerRef.value;
    if (!container || container.scrollWidth <= container.clientWidth) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(delta) > 0) {
        event.preventDefault();
        container.scrollLeft += delta;
    }
}

/** 键盘方向键在面包屑项之间巡检 */
function handleKeydown(index: number, event: KeyboardEvent): void {
    const container = scrollContainerRef.value;
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    if (!buttons.length) return;

    if (event.key === "ArrowRight") {
        event.preventDefault();
        const nextIdx = (index + 1) % buttons.length;
        buttons[nextIdx]?.focus();
    } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const prevIdx = (index - 1 + buttons.length) % buttons.length;
        buttons[prevIdx]?.focus();
    } else if (event.key === "Home") {
        event.preventDefault();
        buttons[0]?.focus();
    } else if (event.key === "End") {
        event.preventDefault();
        buttons[buttons.length - 1]?.focus();
    }
}

/** 确保激活末尾项处于视口可见范围 */
function ensureActiveVisible(): void {
    nextTick(() => {
        const container = scrollContainerRef.value;
        if (!container) return;
        const lastBtn = container.querySelector("li:last-child button");
        if (lastBtn instanceof HTMLElement && typeof lastBtn.scrollIntoView === "function") {
            lastBtn.scrollIntoView({
                behavior: "auto",
                block: "nearest",
                inline: "nearest",
            });
        }
    });
}

onMounted(() => {
    ensureActiveVisible();
});

watch(
    () => [props.path, props.items, props.symbols],
    () => ensureActiveVisible(),
    {deep: true},
);
</script>

<template>
    <nav
        aria-label="文件路径大纲导航"
        class="editor-breadcrumbs flex h-[22px] w-full min-w-0 shrink-0 items-center justify-between bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-secondary)] select-none"
        :class="bordered ? 'border-b border-[var(--divider)]' : ''"
        @wheel="handleWheel"
    >
        <ol
            ref="scrollContainerRef"
            class="flex flex-1 items-center gap-0.5 min-w-0 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
            <template v-for="(item, index) in resolvedSegments" :key="item.id">
                <li
                    v-if="index > 0"
                    class="flex shrink-0 items-center h-[18px] text-[var(--text-muted)] opacity-60 mx-0.5"
                    aria-hidden="true"
                >
                    <span class="i-lucide-chevron-right h-2.5 w-2.5 shrink-0" />
                </li>

                <li class="flex shrink-0 items-center min-w-0">
                    <button
                        type="button"
                        :aria-current="item.isLast ? 'location' : undefined"
                        class="inline-flex items-center gap-1.5 h-[18px] px-1.5 rounded-[4px] text-[11px] leading-none transition-colors [transition-duration:var(--motion-fast)] motion-reduce:transition-none hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]"
                        :class="item.isLast ? 'text-[var(--text-main)] font-medium' : 'text-[var(--text-secondary)]'"
                        :title="item.path || item.label"
                        @click="handleItemClick(item)"
                        @keydown="handleKeydown(index, $event)"
                    >
                        <span v-if="item.iconClass" :class="item.iconClass" class="h-3 w-3 shrink-0 -translate-y-px" aria-hidden="true" />
                        <span class="truncate max-w-[160px] leading-none">{{ item.label }}</span>
                    </button>
                </li>
            </template>
        </ol>

        <!-- 面包屑尾部插槽 (如 VS Code 右侧“文本编辑器 ⌵”) -->
        <div v-if="$slots.trailing" class="editor-breadcrumbs-trailing flex shrink-0 items-center pl-1.5">
            <slot name="trailing" />
        </div>
    </nav>
</template>
