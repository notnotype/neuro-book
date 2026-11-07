<script setup lang="ts">
import {AlertDialog, Button, Select, Spinner} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, watch} from "vue";

import type {ProfileView, ToolChange} from "../profile-view";
import {useAgentPageText} from "../text";
import NewProfileDialog from "./NewProfileDialog.vue";
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
    /** “新建并打开”：交回新的 key，或失败原因；交回时目录里已经有它。 */
    createProfile?: (name: string) => Promise<{readonly key: string} | {readonly reason: string}>;
    /** 确认后的删除：交回时目录里已经没有它，失败由包装通知。 */
    deleteProfile?: (key: string) => Promise<void>;
}>(), {writable: true, initial: undefined, addTools: async () => null, createProfile: async () => ({reason: ""}), deleteProfile: async () => undefined});

const emit = defineEmits<{
    (e: "retry"): void;
    (e: "model", key: string, value: string): void;
    (e: "approval", key: string, value: string): void;
    (e: "open-file", key: string): void;
    (e: "remove-tool", key: string, id: string): void;
    (e: "restore-tools", key: string): void;
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

const page = ref<HTMLElement | null>(null);

// ---- 新建 ----
const creating = ref(false);
const createBusy = ref(false);
const createStatus = ref("");
function openCreate(): void {
    createStatus.value = "";
    creating.value = true;
}
async function create(name: string): Promise<void> {
    createBusy.value = true;
    const result = await props.createProfile(name);
    createBusy.value = false;
    if ("reason" in result) {
        createStatus.value = result.reason;
        return;
    }
    creating.value = false;
    selected.value = result.key;
}

// ---- 删除 ----
/** 打开确认框时定下：确认框不跟着当前项挂载，删掉之后当前项变了它还要发 `closed`。 */
const removing = ref(false);
const removeTarget = ref<ProfileView | null>(null);
function openRemove(profile: ProfileView): void {
    removeTarget.value = profile;
    removing.value = true;
}
/** 确认之后的删除：确认框关闭的动画可能先结束，移焦点要等它，否则焦点落在马上要消失的项上。 */
let removal: Promise<void> | null = null;
function confirmRemove(): void {
    if (removeTarget.value !== null) removal = props.deleteProfile(removeTarget.value.key);
}
/** 确认框关闭后移焦点（输出 23）：删掉了就到新的当前项，取消了不动。 */
async function onRemoveClosed(): Promise<void> {
    if (removal === null) return;
    await removal;
    removal = null;
    await nextTick();
    // 窄布局里左栏隐藏，聚焦它的项不生效，换成顶上的下拉。
    for (const selector of ["[data-profile-rail-item][aria-current='page']", "[data-profile-picker] input, [data-profile-picker]"]) {
        const element = page.value?.querySelector<HTMLElement>(selector);
        if (element === null || element === undefined || element.offsetParent === null) continue;
        element.focus();
        return;
    }
}

const pickerOptions = computed(() => ordered.value.map((profile) => ({value: profile.key, label: profile.name, description: profile.statusText?.text ?? profile.source})));
</script>

<template>
    <div ref="page" class="profile-page" data-agent-profiles-page>
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
            <ProfileRail class="profile-page__rail" :items="ordered" :current="current.key" :disabled="!writable" @select="(key) => (selected = key)" @create="openCreate" />
            <div class="profile-page__main">
                <div class="profile-page__picker">
                    <Select :model-value="current.key" :options="pickerOptions" size="sm" :aria-label="text('profiles.rail.label')" data-profile-picker @update:model-value="(key: string) => (selected = key)" />
                    <Button size="sm" variant="ghost" icon-class="i-lucide-plus" :disabled="!writable" data-profile-create-short @click="openCreate">{{ text("profiles.rail.newShort") }}</Button>
                </div>
                <ProfileDetail
                    :key="current.key"
                    :profile="current"
                    :disabled="!writable"
                    @model="(value) => emit('model', current!.key, value)"
                    @approval="(value) => emit('approval', current!.key, value)"
                    @open-file="emit('open-file', current!.key)"
                    @delete="openRemove(current!)"
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
        <NewProfileDialog v-model:open="creating" :busy="createBusy" :status="createStatus" @create="create" @edit="createStatus = ''" />
        <AlertDialog
            v-if="removeTarget !== null"
            v-model:open="removing"
            :title="text('profiles.remove.title', {name: removeTarget.name})"
            :description="text('profiles.remove.description')"
            :confirm-label="text('profiles.remove.confirm')"
            data-profile-remove
            @confirm="confirmRemove"
            @closed="onRemoveClosed"
        />
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
