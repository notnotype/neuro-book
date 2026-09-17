<script setup lang="ts">
import {computed} from "vue";

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
}>(), {
    path: "",
    items: undefined,
    symbols: () => [],
});

const emit = defineEmits<{
    (e: "navigate", item: BreadcrumbItem): void;
}>();

function resolveFileIcon(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    switch (ext) {
        case "md":
            return "i-lucide-file-text text-[var(--accent-text)]";
        case "json":
            return "i-lucide-braces text-amber-500";
        case "html":
        case "htm":
            return "i-lucide-code-xml text-orange-500";
        case "env":
            return "i-lucide-key-round text-amber-400";
        case "ts":
        case "tsx":
            return "i-lucide-file-code-2 text-blue-500";
        case "js":
        case "jsx":
            return "i-lucide-file-code text-yellow-500";
        case "vue":
            return "i-lucide-file-code text-emerald-500";
        default:
            return "i-lucide-file-text text-[var(--text-muted)]";
    }
}

const resolvedSegments = computed<BreadcrumbItem[]>(() => {
    if (props.items && props.items.length > 0) {
        return [...props.items];
    }
    if (!props.path) return [];

    const parts = props.path.split("/").filter(Boolean);
    const result: BreadcrumbItem[] = [];
    let accPath = "";

    parts.forEach((part, index) => {
        accPath = accPath ? `${accPath}/${part}` : part;
        const isLastFile = index === parts.length - 1;
        result.push({
            id: accPath,
            label: part,
            path: accPath,
            iconClass: isLastFile ? resolveFileIcon(part) : "i-lucide-folder text-[var(--text-muted)]",
            isLast: isLastFile && props.symbols.length === 0,
        });
    });

    if (props.symbols && props.symbols.length > 0) {
        props.symbols.forEach((sym, index) => {
            result.push({
                id: sym.id,
                label: sym.label,
                iconClass: sym.iconClass || "i-lucide-braces text-sky-500",
                isLast: index === props.symbols.length - 1,
            });
        });
    }

    return result;
});

function handleItemClick(item: BreadcrumbItem): void {
    emit("navigate", item);
}
</script>

<template>
    <nav
        aria-label="文件路径大纲导航"
        class="editor-breadcrumbs flex h-6 shrink-0 items-center overflow-x-auto overflow-y-hidden border-b border-[var(--divider)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-secondary)] select-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
        <ol class="flex items-center gap-1 min-w-0">
            <template v-for="(item, index) in resolvedSegments" :key="item.id">
                <li
                    v-if="index > 0"
                    class="flex items-center text-[var(--text-muted)]"
                    aria-hidden="true"
                >
                    <span class="i-lucide-chevron-right h-3 w-3 shrink-0" />
                </li>

                <li class="flex items-center min-w-0">
                    <button
                        type="button"
                        class="flex items-center gap-1 rounded-[var(--radius-control)] px-1 py-0.5 leading-tight transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]"
                        :class="item.isLast ? 'text-[var(--text-main)] font-medium' : 'text-[var(--text-secondary)]'"
                        :title="item.path || item.label"
                        @click="handleItemClick(item)"
                    >
                        <span v-if="item.iconClass" :class="item.iconClass" class="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span class="truncate max-w-[140px]">{{ item.label }}</span>
                    </button>
                </li>
            </template>
        </ol>
    </nav>
</template>
