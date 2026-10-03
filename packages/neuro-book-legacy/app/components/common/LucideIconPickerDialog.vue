<script setup lang="ts">
import {Dialog} from "@notnotype/nb-ui/components";
import {lucideIconOptions, normalizeLucideIconName, type LucideIconOption} from "nbook/app/utils/lucide-icons";

const props = defineProps<{
    modelValue: boolean;
    selectedIcon?: string | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "select", value: string): void;
}>();

const keyword = ref("");

const selectedIconName = computed(() => normalizeLucideIconName(props.selectedIcon) ?? "");
const filteredOptions = computed<LucideIconOption[]>(() => {
    const normalizedKeyword = keyword.value.trim().toLowerCase();
    if (!normalizedKeyword) {
        return lucideIconOptions;
    }
    return lucideIconOptions.filter((item) => item.name.includes(normalizedKeyword));
});

/**
 * 关闭图标选择器。
 */
function closeDialog(): void {
    emit("update:modelValue", false);
}

/**
 * 选择一个 lucide 图标名。
 */
function selectIcon(iconName: string): void {
    emit("select", iconName);
    closeDialog();
}
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        title="选择图标"
        width="640px"
        height="min(720px, 82vh)"
        :show-footer="false"
        closable
        teleport-target=".novel-ide-theme"
        @update:model-value="emit('update:modelValue', $event)"
        @request-close="closeDialog"
    >
        <!-- 图标搜索栏 -->
        <div class="relative shrink-0">
            <span class="i-lucide-search absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"></span>
            <input v-model="keyword" type="text" class="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] py-2 pl-8 pr-3 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" placeholder="搜索 lucide 图标名，例如 map、book、user...">
        </div>

        <!-- 图标网格 -->
        <div class="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2 overflow-y-auto pr-1 custom-scrollbar">
            <button
                v-for="icon in filteredOptions"
                :key="icon.name"
                type="button"
                class="flex min-w-0 flex-col items-center gap-2 rounded-lg border px-2 py-2.5 text-center transition-colors"
                :class="selectedIconName === icon.name ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                :title="icon.name"
                @click="selectIcon(icon.name)"
            >
                <span :class="icon.className" class="h-5 w-5 shrink-0"></span>
                <span class="w-full truncate text-[10px]">{{ icon.name }}</span>
            </button>
        </div>

        <div v-if="filteredOptions.length === 0" class="rounded-lg border border-dashed border-[var(--border-color)] py-8 text-center text-xs text-[var(--text-muted)]">
            没有匹配的图标
        </div>
    </Dialog>
</template>
