<script setup lang="ts">
import {computed} from "vue";
import EditorBreadcrumbs, {type BreadcrumbItem} from "nbook/app/components/editor-workbench/EditorBreadcrumbs.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const updateLabData = useLabDataSink();

const samplePath = computed<string>(() =>
    props.scene === "long"
        ? "packages/neuro-book/app/components/novel-ide/settings/sections/providers/components/ProviderSettingsViewFixtureLongPathComponentName.vue"
        : "src/story/chapter-01.md"
);

const symbols = [
    {id: "sym-1", label: "第一节：潮声"},
    {id: "sym-2", label: "核心冲突"},
];

function handleNavigate(item: BreadcrumbItem): void {
    emitLabEvent("navigate", {id: item.id, label: item.label, path: item.path});
    updateLabData({lastNavigated: item.id});
}
</script>

<template>
    <div class="flex h-full w-full flex-col">
        <LabFixtureControls>
            <div class="text-xs text-[var(--text-secondary)]">
                EditorBreadcrumbs：22px 紧凑路径与大纲符号。可通过 Lab 顶栏切换「随窗口」、「平板 (768px)」或「手机 (390px)」观察横滑防挤压与溢出响应。
            </div>
        </LabFixtureControls>

        <div class="w-full">
            <EditorBreadcrumbs
                data-lab-subject
                class="w-full"
                :path="samplePath"
                :symbols="symbols"
                @navigate="handleNavigate"
            >
                <template #trailing>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[4px] text-[11px] leading-none text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                        title="切换编辑器类型"
                    >
                        <span class="leading-none">文本编辑器</span>
                        <span class="i-lucide-chevron-down h-2.5 w-2.5 opacity-70 -translate-y-px" />
                    </button>
                </template>
            </EditorBreadcrumbs>
        </div>
    </div>
</template>
