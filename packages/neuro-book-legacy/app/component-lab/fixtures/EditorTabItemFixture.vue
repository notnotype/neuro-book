<script setup lang="ts">
import {computed} from "vue";
import EditorTabItem from "nbook/app/components/editor-workbench/EditorTabItem.vue";
import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EditorTabItem>(() => props.input);
const emitLabEvent = useLabEventSink();
type Tab = InstanceType<typeof EditorTabItem>["$props"]["tab"];
const currentTab = computed(() => props.input?.props?.tab as Tab);
const tabActive = computed(() => Boolean(props.input?.props?.active));
const tabPinned = computed(() => Boolean(props.input?.props?.pinned));
const tabPreview = computed(() => currentTab.value?.preview ?? false);
const tabDirty = computed(() => currentTab.value?.dirty ?? false);
const tabStatusText = computed(() => currentTab.value?.statusText ?? "");
const tabDescription = computed(() => currentTab.value?.description ?? "");

function changeTab(patch: Partial<Tab>): void {
    subject.write("props", "tab", {...currentTab.value, ...patch});
}

function handleSelect(path: string): void {
    const active = !tabActive.value;
    emitLabEvent("tab-select", {path, active});
    subject.write("props", "active", active);
}

function handleClose(path: string): void {
    emitLabEvent("tab-close", {path});
}

function handleUnpin(path: string): void {
    emitLabEvent("tab-unpin", {path});
    subject.write("props", "pinned", false);
    changeTab({pinned: false});
}

function handleKeep(path: string): void {
    emitLabEvent("tab-keep", {path});
    changeTab({preview: false});
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
                    @click="subject.write('props', 'active', !tabActive)"
                >
                    {{ tabActive ? "激活态 (Active)" : "普通态 (Inactive)" }}
                </button>

                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="tabPinned ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="subject.write('props', 'pinned', !tabPinned); changeTab({pinned: !tabPinned})"
                >
                    {{ tabPinned ? "已固定 (Pinned)" : "未固定" }}
                </button>

                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="tabPreview ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="changeTab({preview: !tabPreview})"
                >
                    {{ tabPreview ? "预览态 (Preview)" : "常规文档" }}
                </button>

                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="tabDirty ? 'bg-[var(--status-warning)] text-black' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="changeTab({dirty: !tabDirty})"
                >
                    {{ tabDirty ? "未保存 (Dirty)" : "已保存" }}
                </button>

                <div class="flex items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] p-0.5">
                    <span class="px-1 text-[10px] text-[var(--text-muted)]">Git:</span>
                    <button
                        type="button"
                        class="h-5 cursor-pointer rounded px-1 text-[11px]"
                        :class="tabStatusText === '' ? 'bg-[var(--bg-hover)] font-bold' : ''"
                        @click="changeTab({statusText: undefined})"
                    >
                        无
                    </button>
                    <button
                        type="button"
                        class="h-5 cursor-pointer rounded px-1 text-[11px] text-[var(--status-warning)]"
                        :class="tabStatusText === 'M' ? 'bg-[var(--bg-hover)] font-bold' : ''"
                        @click="changeTab({statusText: 'M'})"
                    >
                        M
                    </button>
                    <button
                        type="button"
                        class="h-5 cursor-pointer rounded px-1 text-[11px] text-[var(--status-success)]"
                        :class="tabStatusText === 'U' ? 'bg-[var(--bg-hover)] font-bold' : ''"
                        @click="changeTab({statusText: 'U'})"
                    >
                        U
                    </button>
                </div>

                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="tabDescription ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="changeTab({description: tabDescription ? undefined : '...\\story'})"
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
                    v-bind="subject.bindings.value"
                    @select="handleSelect"
                    @close="handleClose"
                    @unpin="handleUnpin"
                    @keep="handleKeep"
                />
            </div>
        </main>
    </div>
</template>
