<script setup lang="ts">
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";

type ProfileLoadStatus = ConfigAgentProfileSettingsDto["agentProfiles"][number]["loadStatus"];

/** 二级导航中的单个 Profile 条目视图。 */
export type AgentProfileNavItem = {
    profileKey: string;
    name: string;
    status: ProfileLoadStatus;
    /** 显式覆盖的字段总数（模型 + 运行策略 + Profile 设置），0 表示完全跟随默认 */
    overrideCount: number;
    /** 当前草稿与已保存配置不同 */
    dirty: boolean;
    /** 是否是当前生效的默认 Profile */
    isDefault: boolean;
};

const props = defineProps<{
    items: AgentProfileNavItem[];
    /** 空串表示选中"默认设置"页，否则是 profileKey */
    activeKey: string;
    search: string;
    /** 默认设置页是否有未保存改动 */
    defaultsDirty: boolean;
}>();

const emit = defineEmits<{
    (event: "update:activeKey", value: string): void;
    (event: "update:search", value: string): void;
}>();

const {t} = useI18n();

const isDefaultsActive = computed(() => props.activeKey === "");

const filteredItems = computed(() => {
    const keyword = props.search.trim().toLowerCase();
    if (!keyword) {
        return props.items;
    }
    return props.items.filter((item) => item.profileKey.toLowerCase().includes(keyword) || item.name.toLowerCase().includes(keyword));
});

/** 编译状态指示点：加载成功用 success，编译中用 info 呼吸灯，其余 5 种失败态统一 danger。 */
function statusDotClass(status: ProfileLoadStatus): string {
    if (status === "loaded") {
        return "bg-[var(--status-success)]";
    }
    if (status === "compiling") {
        return "animate-pulse bg-[var(--status-info)]";
    }
    return "bg-[var(--status-danger)]";
}
</script>

<template>
    <!-- Agent Profile 二级导航：默认设置 + 可搜索的 Profile 列表。作为 grid item 需 min-h-0 解除自动最小尺寸，
         列表区 flex-1 min-h-0 在栏内独立滚动（Profile 过多时搜索框与默认设置入口保持可见）。 -->
    <aside class="flex min-h-0 flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 shadow-sm">
        <!-- 搜索 -->
        <div class="px-1 pb-2 pt-1">
            <FormInput :model-value="props.search" type="search" :placeholder="t('settings.panels.profileModels.nav.searchPlaceholder')" @update:model-value="emit('update:search', $event)">
                <template #prefix>
                    <span class="i-lucide-search h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                </template>
            </FormInput>
        </div>

        <!-- 默认设置入口 -->
        <div class="px-1">
            <button
                type="button"
                class="group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-300"
                :class="isDefaultsActive ? 'bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                @click="emit('update:activeKey', '')"
            >
                <div class="absolute left-0 top-1/2 h-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent-main)] transition-all duration-300" :class="isDefaultsActive ? 'opacity-100' : 'scale-y-0 opacity-0'"></div>
                <span class="i-lucide-sliders-horizontal h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110" :class="isDefaultsActive ? 'text-[var(--accent-main)]' : 'text-[var(--text-muted)]'"></span>
                <div class="min-w-0 flex-1">
                    <div class="truncate text-[13px] font-medium" :class="isDefaultsActive ? 'text-[var(--accent-text)]' : 'text-[var(--text-main)]'">{{ t("settings.panels.profileModels.nav.defaults") }}</div>
                    <div class="mt-0.5 truncate text-[11px] opacity-70">{{ t("settings.panels.profileModels.nav.defaultsDescription") }}</div>
                </div>
                <span v-if="props.defaultsDirty" class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-warning)]" :title="t('settings.panels.profileModels.unsavedChanges')"></span>
            </button>
        </div>

        <!-- Profile 列表 -->
        <div class="px-3 pb-1.5 pt-3">
            <div class="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">Agent Profiles</div>
            <div class="mt-1 text-[11px] leading-4 text-[var(--text-secondary)] opacity-80">{{ t("settings.panels.profileModels.nav.profilesHint") }}</div>
        </div>

        <!-- 列表在左栏内独立滚动，不随右侧表单或 Dialog body 同步滚动。 -->
        <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 pb-1 custom-scrollbar">
            <button
                v-for="item in filteredItems"
                :key="item.profileKey"
                type="button"
                class="group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all duration-300"
                :class="props.activeKey === item.profileKey ? 'bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                @click="emit('update:activeKey', item.profileKey)"
            >
                <!-- 激活状态左侧指示条 -->
                <div class="absolute left-0 top-1/2 h-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent-main)] transition-all duration-300" :class="props.activeKey === item.profileKey ? 'opacity-100' : 'scale-y-0 opacity-0'"></div>

                <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="statusDotClass(item.status)" :title="t(`settings.panels.profileModels.status.${item.status}`)"></span>

                <div class="min-w-0 flex-1">
                    <div class="truncate text-[13px] font-medium" :class="props.activeKey === item.profileKey ? 'text-[var(--accent-text)]' : 'text-[var(--text-main)]'">{{ item.name }}</div>
                    <div class="mt-0.5 truncate font-mono text-[10px] opacity-70">{{ item.profileKey }}</div>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                    <span v-if="item.isDefault" class="i-lucide-star h-3 w-3 text-[var(--accent-main)]" :title="t('settings.panels.profileModels.currentDefault')"></span>
                    <span v-if="item.dirty" class="h-1.5 w-1.5 rounded-full bg-[var(--status-warning)]" :title="t('settings.panels.profileModels.unsavedChanges')"></span>
                    <span v-if="item.overrideCount > 0" class="rounded-full bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]" :title="t('settings.panels.profileModels.overrideCount', {count: item.overrideCount})">{{ item.overrideCount }}</span>
                </div>
            </button>

            <div v-if="filteredItems.length === 0" class="m-1 rounded-xl border border-dashed border-[var(--border-color)] px-4 py-8 text-center text-xs leading-6 text-[var(--text-secondary)]">
                {{ props.items.length === 0 ? t("settings.panels.profileModels.nav.empty") : t("settings.panels.profileModels.nav.noMatch") }}
            </div>
        </div>
    </aside>
</template>
