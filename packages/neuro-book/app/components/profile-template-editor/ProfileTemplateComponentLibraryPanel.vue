<script setup lang="ts">
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import Tooltip from "nbook/app/components/common/Tooltip.vue";
import ProfileTemplateLibraryItem from "nbook/app/components/profile-template-editor/ProfileTemplateLibraryItem.vue";
import type {
    ComponentLibraryGroup,
    ComponentLibraryGroupView,
} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";
import type {ProfileTemplateNodeType} from "nbook/shared/dto/profile-template.dto";

const props = defineProps<{
    search: string;
    activeGroup: ComponentLibraryGroup;
    groupTabs: Array<{value: ComponentLibraryGroup; label: string}>;
    componentGroups: ComponentLibraryGroupView[];
}>();

const emit = defineEmits<{
    (e: "update:search", value: string): void;
    (e: "update:activeGroup", value: ComponentLibraryGroup): void;
    (e: "collapse"): void;
    (e: "add-node", type: ProfileTemplateNodeType): void;
}>();
</script>

<template>
    <!-- 左侧组件库：组件拖入画布或点击快速添加 -->
    <aside class="panel flex min-h-0 min-w-0 flex-col">
        <div class="mb-3 flex items-start justify-between gap-2">
            <div>
                <div class="panel-title">组件库</div>
                <div class="mt-1 text-[11px] text-[var(--text-muted)]">拖拽组件到画布中编辑</div>
            </div>
            <Tooltip text="收起组件库" placement="bottom">
                <button type="button" class="panel-icon-btn" aria-label="收起组件库" @click="emit('collapse')">
                    <span class="i-lucide-panel-left-close h-4 w-4"></span>
                </button>
            </Tooltip>
        </div>
        <div class="relative mb-3">
            <span class="i-lucide-search absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"></span>
            <FormInput :model-value="props.search" placeholder="搜索组件（如：Message）" class="pl-8" type="search" @update:model-value="emit('update:search', $event)" />
        </div>
        <div class="mb-3 flex flex-wrap gap-1">
            <button
                v-for="tab in props.groupTabs"
                :key="tab.value"
                class="library-tab"
                :class="props.activeGroup === tab.value ? 'active' : ''"
                @click="emit('update:activeGroup', tab.value)"
            >
                {{ tab.label }}
            </button>
        </div>
        <div class="min-h-0 flex-1 space-y-4 overflow-auto pr-1 custom-scrollbar">
            <section v-for="group in props.componentGroups" :key="group.group">
                <div class="mb-2 text-[11px] font-semibold text-[var(--text-secondary)]">{{ group.label }}</div>
                <div class="space-y-2">
                    <ProfileTemplateLibraryItem
                        v-for="item in group.items"
                        :key="item.type"
                        :type="item.type"
                        :label="item.label"
                        :description="item.description"
                        :icon-class="item.iconClass"
                        :item-class="`component-${item.group} library-node-${item.type}`"
                        @add="emit('add-node', $event)"
                    />
                </div>
            </section>
        </div>
        <div class="mt-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/60 p-3 text-[11px] leading-5 text-[var(--text-muted)]">
            <span class="i-lucide-lightbulb mr-1 inline-block h-3.5 w-3.5 align-text-bottom"></span>
            提示：点击组件快速添加到当前选中节点。
        </div>
    </aside>
</template>

<style scoped>
.panel {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-panel);
    padding: 12px;
    box-shadow: 0 16px 44px color-mix(in srgb, var(--shadow-color) 5%, transparent);
}

.panel-title {
    color: var(--text-main);
    font-size: 13px;
    font-weight: 700;
}

.panel-icon-btn {
    display: inline-flex;
    height: 28px;
    width: 28px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    color: var(--text-muted);
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.panel-icon-btn:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
    color: var(--accent-text);
}

.component-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    border: 1px solid var(--component-border, var(--border-color));
    border-radius: 7px;
    background: var(--component-bg, var(--bg-input));
    padding: 9px;
    text-align: left;
    transition: border-color 0.18s ease, background-color 0.18s ease, transform 0.18s ease;
}

.component-item:hover {
    border-color: var(--component-accent, var(--accent-main));
    background: color-mix(in srgb, var(--component-bg, var(--bg-input)) 84%, var(--bg-panel));
    transform: translateY(-1px);
}

.component-icon {
    display: flex;
    height: 28px;
    width: 28px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--component-border, var(--border-color));
    border-radius: 7px;
    background: color-mix(in srgb, var(--component-bg, var(--bg-input)) 64%, var(--bg-panel));
    color: var(--component-accent, var(--accent-text));
}

.library-tab {
    height: 24px;
    border-radius: 6px;
    padding: 0 8px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    transition: background-color 0.18s ease, color 0.18s ease;
}

.library-tab:hover,
.library-tab.active {
    background: var(--accent-bg);
    color: var(--accent-text);
}
</style>
