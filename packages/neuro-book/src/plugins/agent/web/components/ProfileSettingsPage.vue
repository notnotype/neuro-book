<script setup lang="ts">
import {Button, Select, Spinner} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import type {ProfileView, ToolChange} from "../profile-view";
import {useAgentPageText} from "../text";
import ProfileDetail from "./ProfileDetail.vue";
import ProfileRail from "./ProfileRail.vue";
import ProfileToolsSection from "./ProfileToolsSection.vue";

/** 设置窗口的“Profile”分区（同名 .md）：只管选中与布局，取数与写入在 `profile-page.ts`。 */
const props = withDefaults(defineProps<{
    state: "loading" | "ready" | {failed: string};
    profiles: readonly ProfileView[];
    writable?: boolean;
    initial?: string;
    /** “添加工具”的“完成”：交回失败原因，成功交回 null。 */
    addTools?: (key: string, change: ToolChange) => Promise<string | null>;
}>(), {writable: true, initial: undefined, addTools: async () => null});

const emit = defineEmits<{
    (e: "retry"): void;
    (e: "model", key: string, value: string): void;
    (e: "approval", key: string, value: string): void;
    (e: "open-file", key: string): void;
    (e: "remove-tool", key: string, id: string): void;
    (e: "restore-tools", key: string): void;
    (e: "create"): void;
}>();

const text = useAgentPageText();
/** 左栏的顺序：可选的在前，后台的在后。 */
const ordered = computed(() => [...props.profiles.filter((profile) => !profile.hidden), ...props.profiles.filter((profile) => profile.hidden)]);
const selected = ref(props.initial ?? "");
const current = computed(() => ordered.value.find((profile) => profile.key === selected.value) ?? ordered.value[0] ?? null);
// 选中的没了（删了、重载后没了）：回到第一项。
watch(current, (profile) => {
    if (profile !== null) selected.value = profile.key;
}, {immediate: true});

const pickerOptions = computed(() => ordered.value.map((profile) => ({value: profile.key, label: profile.name, description: profile.statusText?.text ?? profile.source})));
</script>

<template>
    <div class="profile-page" data-agent-profiles-page>
        <div v-if="state === 'loading'" class="profile-page__state" role="status" aria-busy="true" data-profile-loading>
            <Spinner />
            <p>{{ text("profiles.loading") }}</p>
        </div>
        <div v-else-if="state !== 'ready'" class="profile-page__state" role="alert" data-profile-load-failed>
            <span class="i-lucide-circle-alert profile-page__state-icon" aria-hidden="true" />
            <p>{{ text("profiles.loadFailed", {code: state.failed}) }}</p>
            <Button size="sm" variant="secondary" data-profile-retry @click="emit('retry')">{{ text("profiles.retry") }}</Button>
        </div>
        <div v-else-if="current !== null" class="profile-page__split">
            <ProfileRail class="profile-page__rail" :items="ordered" :current="current.key" :disabled="!writable" @select="(key) => (selected = key)" @create="emit('create')" />
            <div class="profile-page__main">
                <div class="profile-page__picker">
                    <Select :model-value="current.key" :options="pickerOptions" size="sm" :aria-label="text('profiles.rail.label')" data-profile-picker @update:model-value="(key: string) => (selected = key)" />
                    <Button size="sm" variant="ghost" icon-class="i-lucide-plus" :disabled="!writable" data-profile-create @click="emit('create')">{{ text("profiles.rail.newShort") }}</Button>
                </div>
                <ProfileDetail
                    :key="current.key"
                    :profile="current"
                    :disabled="!writable"
                    @model="(value) => emit('model', current!.key, value)"
                    @approval="(value) => emit('approval', current!.key, value)"
                    @open-file="emit('open-file', current!.key)"
                >
                    <ProfileToolsSection
                        v-if="current.tools !== null"
                        :tools="current.tools"
                        :disabled="!writable"
                        :add-tools="(change) => addTools(current!.key, change)"
                        @remove="(id) => emit('remove-tool', current!.key, id)"
                        @restore="emit('restore-tools', current!.key)"
                    />
                </ProfileDetail>
            </div>
        </div>
    </div>
</template>

<style scoped>
.profile-page {
    height: 100%;
    min-height: 0;
    container-type: inline-size;
}

.profile-page__state {
    display: flex;
    height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.profile-page__state p {
    margin: 0;
}

.profile-page__state-icon {
    width: 20px;
    height: 20px;
    color: var(--status-danger);
}

.profile-page__split {
    display: flex;
    height: 100%;
    min-height: 0;
    gap: var(--space-5);
}

/* 自己滚动的区域会裁掉贴边控件的焦点环：两侧留一点内边距。 */
.profile-page__main {
    min-width: 0;
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) var(--space-2) var(--space-5);
}

.profile-page__picker {
    display: none;
}

/* 页面不到 600px：左栏收成顶上的下拉加“新建”（输出 1）。 */
@container (max-width: 600px) {
    .profile-page__rail {
        display: none;
    }

    .profile-page__picker {
        display: flex;
        gap: var(--space-2);
        margin-bottom: var(--space-4);
    }

    .profile-page__picker > :first-child {
        min-width: 0;
        flex: 1;
    }
}
</style>
