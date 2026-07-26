<script setup lang="ts">
import {computed} from "vue";
import type {JsonValue, WorldPreviewSchemaType} from "nbook/app/utils/world-engine-preview";
import type {StagedStateEdit, StateViewTypeConfig} from "nbook/app/utils/world-engine-state-view";
import {resolveCardLayout, stagedEditKey, formatStateValue} from "nbook/app/utils/world-engine-state-view";
import type {SubjectStateDto, WorldSubjectDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import WorldEngineStateOverviewValue from "nbook/app/components/novel-ide/world-engine/state-overview/WorldEngineStateOverviewValue.vue";

const props = defineProps<{
    subject: WorldSubjectDto;
    /** 当前时间推算出的状态；subject 在该时刻可能尚不存在（undefined）。 */
    state: SubjectStateDto | undefined;
    schemaType: WorldPreviewSchemaType | undefined;
    typeConfig: StateViewTypeConfig | undefined;
    subjects: WorldSubjectDto[];
    subjectNameMap: Map<string, string>;
    stagedEdits: Map<string, StagedStateEdit>;
    readonly?: boolean;
}>();

const emit = defineEmits<{
    stage: [edit: StagedStateEdit];
    unstage: [key: string];
    showHistory: [subjectId: string];
}>();

const layout = computed(() => resolveCardLayout(props.schemaType?.attrs ?? [], props.typeConfig));

const cardTitle = computed(() => {
    const titleAttr = props.typeConfig?.titleAttr;
    if (titleAttr && props.state) {
        const value = props.state.attrs[titleAttr];
        if (typeof value === "string" && value.trim()) {
            return value;
        }
    }
    return props.subject.name || props.subject.id;
});

const stagedCount = computed(() => {
    let count = 0;
    for (const edit of props.stagedEdits.values()) {
        if (edit.subjectId === props.subject.id) count += 1;
    }
    return count;
});

function attrValue(name: string): JsonValue | undefined {
    return props.state?.attrs[name];
}

function stagedValueFor(name: string): JsonValue | undefined {
    return props.stagedEdits.get(stagedEditKey({subjectId: props.subject.id, path: `/${name}`}))?.value;
}

function stageAttr(name: string, label: string, value: JsonValue): void {
    emit("stage", {
        subjectId: props.subject.id,
        subjectName: cardTitle.value,
        path: `/${name}`,
        attrLabel: label,
        value,
        originalText: formatStateValue(attrValue(name)),
    });
}

function unstageAttr(name: string): void {
    emit("unstage", stagedEditKey({subjectId: props.subject.id, path: `/${name}`}));
}
</script>

<template>
    <div class="flex min-w-0 flex-col overflow-hidden rounded-md border bg-[var(--we-bg-panel)]" :class="stagedCount ? 'border-[var(--we-warning-border)]' : 'border-[var(--we-border)]'" :data-testid="`state-overview-card-${props.subject.id}`">
        <!-- 卡片头 -->
        <div class="flex items-center justify-between gap-2 border-b border-[var(--we-border)] px-3 py-2">
            <div class="flex min-w-0 items-center gap-2">
                <span class="min-w-0 truncate text-[13px] font-semibold text-[var(--we-text-main)]">{{ cardTitle }}</span>
                <span v-if="cardTitle !== props.subject.id" class="shrink-0 font-mono text-[10px] text-[var(--we-text-muted)]">{{ props.subject.id }}</span>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
                <span v-if="stagedCount" class="rounded bg-[color-mix(in_srgb,var(--we-warning)_16%,transparent)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">{{ stagedCount }} 项修改</span>
                <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="查看该主体的变更历史" @click="emit('showHistory', props.subject.id)">
                    <span class="i-lucide-history h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>

        <!-- 无状态提示（该时刻 subject 尚未出现） -->
        <div v-if="!props.state" class="px-3 py-4 text-center text-[12px] text-[var(--we-text-muted)]">当前时间点没有该主体的状态记录</div>
        <div v-else-if="!props.schemaType" class="px-3 py-4 text-center text-[12px] text-[var(--we-text-muted)]">缺少 {{ props.subject.type }} 的 Schema 定义</div>

        <template v-else>
            <!-- pinned 关键属性 -->
            <div v-if="layout.pinned.length" class="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-[var(--we-border)] bg-[color-mix(in_srgb,var(--we-accent,transparent)_4%,transparent)] px-3 py-2">
                <WorldEngineStateOverviewValue
                    v-for="view in layout.pinned"
                    :key="`pinned:${view.attr.name}`"
                    :view="view"
                    :value="attrValue(view.attr.name)"
                    :staged-value="stagedValueFor(view.attr.name)"
                    :subjects="props.subjects"
                    :subject-name-map="props.subjectNameMap"
                    :readonly="props.readonly"
                    @stage="stageAttr(view.attr.name, view.label, $event)"
                    @unstage="unstageAttr(view.attr.name)"
                />
            </div>

            <!-- 分组属性 -->
            <div class="flex flex-col divide-y divide-[var(--we-border)]">
                <details v-for="(section, index) in layout.sections" :key="section.title" :open="index === 0 || layout.sections.length <= 2" class="group/section">
                    <summary class="flex cursor-pointer select-none items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)]">
                        <span class="i-lucide-chevron-right h-3 w-3 transition-transform group-open/section:rotate-90"></span>
                        {{ section.title }}
                        <span class="font-mono text-[10px] font-normal normal-case">{{ section.views.length }}</span>
                    </summary>
                    <div class="grid grid-cols-2 gap-x-3 gap-y-2 px-3 pb-2.5 pt-0.5">
                        <WorldEngineStateOverviewValue
                            v-for="view in section.views"
                            :key="`${section.title}:${view.attr.name}`"
                            :view="view"
                            :value="attrValue(view.attr.name)"
                            :staged-value="stagedValueFor(view.attr.name)"
                            :subjects="props.subjects"
                            :subject-name-map="props.subjectNameMap"
                            :readonly="props.readonly"
                            :class="view.widget === 'item-list' || view.widget === 'json' || view.widget === 'chips' ? 'col-span-2' : ''"
                            @stage="stageAttr(view.attr.name, view.label, $event)"
                            @unstage="unstageAttr(view.attr.name)"
                        />
                    </div>
                </details>
            </div>
        </template>
    </div>
</template>
