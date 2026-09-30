<script setup lang="ts">
/**
 * AgentSessionAttachmentPanel 的 Component Lab 规范夹具。
 */
import {computed, watch} from "vue";
import AgentSessionAttachmentPanel from "nbook/app/components/novel-ide/agent/panels/attachments/AgentSessionAttachmentPanel.vue";
import type {AgentAttachmentUrlResolver} from "nbook/app/components/novel-ide/agent/agent-attachment";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {sampleAttachmentSvgByEntryId, sampleSessionAttachments} from "./AgentExtraPanels.scenes";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentSessionAttachmentPanel>(() => props.input, [
    "load-more",
    "insert",
    "close",
]);
const syncLabData = useLabDataSink();

const items = computed(() => subject.bindings.value.items);
const search = computed(() => subject.bindings.value.search);
const loading = computed(() => subject.bindings.value.loading);
const hasMore = computed(() => subject.bindings.value.hasMore);
const insertDisabled = computed(() => subject.bindings.value.insertDisabled);

watch([() => props.scene, items, search, loading, hasMore, insertDisabled], () => {
    syncLabData({
        scene: props.scene,
        itemCount: items.value.length,
        search: search.value,
        loading: loading.value,
        hasMore: hasMore.value,
        insertDisabled: insertDisabled.value,
    });
}, {immediate: true});

const resolveAttachmentUrl: AgentAttachmentUrlResolver = ({entryId}) => {
    if (entryId && sampleAttachmentSvgByEntryId[entryId]) {
        return sampleAttachmentSvgByEntryId[entryId]!;
    }
    return sampleAttachmentSvgByEntryId["entry-att-1"]!;
};

function handleSearchUpdate(keyword: string): void {
    const normalized = keyword.trim().toLowerCase();
    const filtered = normalized
        ? sampleSessionAttachments.filter((item) => (item.attachment.name ?? item.attachment.attachmentId).toLowerCase().includes(normalized))
        : sampleSessionAttachments;
    subject.write("props", "items", filtered);
    subject.write("props", "total", filtered.length);
}

function handleLoadMore(): void {
    subject.write("props", "hasMore", false);
}

function toggleAttachmentsControl(): void {
    const next = items.value.length > 0 ? [] : sampleSessionAttachments;
    subject.write("props", "items", next);
    subject.write("props", "total", next.length);
    if (next.length > 0) {
        subject.write("model", "search", "");
    }
}
</script>

<template>
    <div class="novel-ide-theme relative h-full w-full [transform:translateZ(0)]">
        <AgentSessionAttachmentPanel
            data-lab-subject
            class="!static !inset-auto !max-h-none h-full w-full"
            v-bind="subject.bindings.value"
            :resolve-attachment-url="resolveAttachmentUrl"
            @update:search="handleSearchUpdate"
            @load-more="handleLoadMore"
        />
    </div>

    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <span class="text-[var(--text-secondary)]">AgentSessionAttachmentPanel 调试</span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="subject.write('props', 'insertDisabled', !insertDisabled)"
                >
                    {{ insertDisabled ? "启用插入" : "禁用插入" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="subject.write('props', 'loading', !loading)"
                >
                    {{ loading ? "停止加载" : "切换加载态" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="toggleAttachmentsControl"
                >
                    {{ items.length > 0 ? "清空附件" : "恢复附件" }}
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
