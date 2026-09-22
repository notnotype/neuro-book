<script setup lang="ts">
import {computed, ref, watch} from "vue";
import EditorTabItem from "nbook/app/components/editor-workbench/EditorTabItem.vue";
import type {EditorTabPresentation} from "nbook/app/components/editor-workbench/editor-view.types";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const updateLabData = useLabDataSink();

const tabTitle = ref<string>("chapter-01.md");
const tabPath = ref<string>("src/story/chapter-01.md");
const tabActive = ref<boolean>(false);
const tabPinned = ref<boolean>(false);
const tabPreview = ref<boolean>(false);
const tabDirty = ref<boolean>(false);
const tabStatusText = ref<string>("");
const tabDescription = ref<string>("");
const tabIconClass = ref<string>("i-lucide-file-text");

function applyScene(sceneName: string): void {
    tabTitle.value = "chapter-01.md";
    tabPath.value = "src/story/chapter-01.md";
    tabActive.value = false;
    tabPinned.value = false;
    tabPreview.value = false;
    tabDirty.value = false;
    tabStatusText.value = "";
    tabDescription.value = "";
    tabIconClass.value = "i-lucide-file-text";

    switch (sceneName) {
        case "active":
            tabActive.value = true;
            break;
        case "pinned":
            tabPinned.value = true;
            break;
        case "preview":
            tabPreview.value = true;
            break;
        case "dirty":
            tabDirty.value = true;
            break;
        case "git-modified":
            tabStatusText.value = "M";
            tabDirty.value = true;
            break;
        case "git-untracked":
            tabStatusText.value = "U";
            break;
        case "with-description":
            tabDescription.value = "...\\story";
            break;
        default:
            break;
    }
}

watch(
    () => props.scene,
    (newScene) => {
        applyScene(newScene || "default");
    },
    {immediate: true},
);

const currentTab = computed<EditorTabPresentation>(() => ({
    path: tabPath.value,
    title: tabTitle.value,
    pinned: tabPinned.value,
    preview: tabPreview.value,
    dirty: tabDirty.value,
    statusText: tabStatusText.value || undefined,
    description: tabDescription.value || undefined,
    iconClass: tabIconClass.value,
}));

function handleSelect(path: string): void {
    tabActive.value = !tabActive.value;
    emitLabEvent("tab-select", {path, active: tabActive.value});
    updateLabData({active: tabActive.value});
}

function handleClose(path: string): void {
    emitLabEvent("tab-close", {path});
}

function handleUnpin(path: string): void {
    tabPinned.value = false;
    emitLabEvent("tab-unpin", {path});
    updateLabData({pinned: false});
}

function handleKeep(path: string): void {
    tabPreview.value = false;
    emitLabEvent("tab-keep", {path});
    updateLabData({preview: false});
}
</script>

<template>
    <div class="flex h-full min-h-[360px] w-full flex-col overflow-hidden bg-[var(--panel-surface)] text-[var(--text-main)]">
        <LabFixtureControls>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="font-medium text-[var(--text-secondary)]">原子状态控制：</span>

                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="tabActive ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="tabActive = !tabActive"
                >
                    {{ tabActive ? "激活态 (Active)" : "普通态 (Inactive)" }}
                </button>

                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="tabPinned ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="tabPinned = !tabPinned"
                >
                    {{ tabPinned ? "已固定 (Pinned)" : "未固定" }}
                </button>

                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="tabPreview ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="tabPreview = !tabPreview"
                >
                    {{ tabPreview ? "预览态 (Preview)" : "常规文档" }}
                </button>

                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="tabDirty ? 'bg-[var(--status-warning)] text-black' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="tabDirty = !tabDirty"
                >
                    {{ tabDirty ? "未保存 (Dirty)" : "已保存" }}
                </button>

                <div class="flex items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] p-0.5">
                    <span class="px-1 text-[10px] text-[var(--text-muted)]">Git:</span>
                    <button
                        type="button"
                        class="h-5 cursor-pointer rounded px-1 text-[11px]"
                        :class="tabStatusText === '' ? 'bg-[var(--bg-hover)] font-bold' : ''"
                        @click="tabStatusText = ''"
                    >
                        无
                    </button>
                    <button
                        type="button"
                        class="h-5 cursor-pointer rounded px-1 text-[11px] text-[var(--status-warning)]"
                        :class="tabStatusText === 'M' ? 'bg-[var(--bg-hover)] font-bold' : ''"
                        @click="tabStatusText = 'M'"
                    >
                        M
                    </button>
                    <button
                        type="button"
                        class="h-5 cursor-pointer rounded px-1 text-[11px] text-[var(--status-success)]"
                        :class="tabStatusText === 'U' ? 'bg-[var(--bg-hover)] font-bold' : ''"
                        @click="tabStatusText = 'U'"
                    >
                        U
                    </button>
                </div>

                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="tabDescription ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="tabDescription = tabDescription ? '' : '...\\story'"
                >
                    {{ tabDescription ? "消歧义路径: 有" : "消歧义路径: 无" }}
                </button>

            </div>
        </LabFixtureControls>

        <main class="flex flex-1 flex-col items-center justify-center p-8 gap-4">
            <div class="text-xs text-[var(--text-secondary)]">
                单零件独立呈现（圆角药丸形态，高度 28px / 固定 26px，内边距与字体居中）；这一份是纯展示：拖动源只在宿主提供编辑会话时才登记，落点线属于标签栏场景。
            </div>

            <!-- 模拟标签栏插槽承载该单一零件 -->
            <div class="flex h-[36px] items-center rounded-[var(--radius-panel)] border border-[var(--divider)] bg-[var(--bg-panel)] px-4 shadow-xs">
                <EditorTabItem
                    data-lab-subject
                    :tab="currentTab"
                    :active="tabActive"
                    :pinned="tabPinned"
                    @select="handleSelect"
                    @close="handleClose"
                    @unpin="handleUnpin"
                    @keep="handleKeep"
                />
            </div>
        </main>
    </div>
</template>
