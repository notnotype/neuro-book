<script setup lang="ts">
// 承诺账本右侧详情区:标题区(状态/派生阶段/重要性/tags)+ 承诺内容 / 兑现预期 / 节奏与期限 + 节拍时间线。
// 纯展示子组件:数据与写操作全由宿主 PlotPromiseLedgerTab 承担,这里只 emit 动作。
import {computed} from "vue";
import {
    PLANNING_TONE_CLASSES,
    PROMISE_BEAT_KIND_META,
    PROMISE_BEAT_STATE_META,
    PROMISE_DERIVED_STAGE_META,
    PROMISE_IMPORTANCE_META,
    PROMISE_STATUS_META,
} from "nbook/app/components/novel-ide/plot/planning/plot-planning.types";
import type {PlotThreadPanelChapter} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {StoryPromiseDetailDto, StoryPromiseStatusDto} from "nbook/shared/dto/plot.dto";

const props = defineProps<{
    // 当前选中承诺的详情;为空表示未选中(展示空态)。
    detail: StoryPromiseDetailDto | null;
    loading?: boolean;
    // 为空表示详情加载正常;非空为宿主传入的加载错误文案。
    error?: string;
    // 章节视图模型(带卷名/序号),期限章与节拍所在章的显示名优先取这里。
    chapters: PlotThreadPanelChapter[];
}>();

const emit = defineEmits<{
    (e: "edit"): void;
    (e: "addBeat"): void;
    // 生命周期转换目标状态:fulfilled=兑现 / abandoned=放弃 / open=重开。
    (e: "changeStatus", status: StoryPromiseStatusDto): void;
    (e: "delete"): void;
    (e: "removeBeat", sceneId: string): void;
    (e: "selectScene", sceneId: string): void;
}>();

// 章 id → 「序号 标题」显示名。
const chapterLabelById = computed(() => new Map(props.chapters.map((chapter) => [chapter.id, `${chapter.numberLabel} ${chapter.title}`.trim()])));

// 章 id → 全书章序(chapters prop 的顺序即承载树章序,由宿主按 acts[].chapters + ungroupedChapters 拍平)。
const chapterIndexById = computed(() => new Map(props.chapters.map((chapter, index) => [chapter.id, index])));

/**
 * 节拍时间线排序:先按所在章的全书章序,同章内再按 scene.chapterSortOrder(它只是章内序号,跨章不可直接比较);
 * 未挂章 / 所在章已不在承载树中的垫底,组内按节拍创建时间。
 */
const sortedBeats = computed(() => {
    return [...(props.detail?.beats ?? [])].sort((left, right) => {
        const leftChapter = left.scene.chapter ? chapterIndexById.value.get(left.scene.chapter.id) : undefined;
        const rightChapter = right.scene.chapter ? chapterIndexById.value.get(right.scene.chapter.id) : undefined;
        if (leftChapter !== undefined && rightChapter !== undefined) {
            if (leftChapter !== rightChapter) {
                return leftChapter - rightChapter;
            }
            return (left.scene.chapterSortOrder ?? 0) - (right.scene.chapterSortOrder ?? 0);
        }
        if (leftChapter !== undefined) {
            return -1;
        }
        if (rightChapter !== undefined) {
            return 1;
        }
        return left.createdAt.localeCompare(right.createdAt);
    });
});

/**
 * 当前状态可用的生命周期动作:open → 兑现 / 放弃;fulfilled / abandoned → 重开。
 */
const statusActions = computed<Array<{status: StoryPromiseStatusDto; label: string; iconClass: string}>>(() => {
    if (!props.detail) {
        return [];
    }
    if (props.detail.status === "open") {
        return [
            {status: "fulfilled", label: "兑现", iconClass: "i-lucide-circle-check"},
            {status: "abandoned", label: "放弃", iconClass: "i-lucide-circle-off"},
        ];
    }
    return [{status: "open", label: "重开", iconClass: "i-lucide-rotate-ccw"}];
});

/**
 * 章显示名:优先面板 chapters(带序号),回退接口自带的章标题。
 */
function chapterLabel(chapterId: string, fallbackTitle: string): string {
    return chapterLabelById.value.get(chapterId) ?? fallbackTitle;
}
</script>

<template>
    <!-- 承诺详情区(右栏) -->
    <section class="flex min-h-0 min-w-0 flex-1 flex-col">
        <!-- 未选中 / 首载空态 -->
        <div v-if="!props.detail" class="flex min-h-0 flex-1 items-center justify-center">
            <div class="flex flex-col items-center gap-2 px-6 text-center">
                <span :class="props.loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-scroll-text opacity-40'" class="h-8 w-8 text-[var(--text-muted)]"></span>
                <div class="text-[12px] text-[var(--text-muted)]">{{ props.loading ? "正在加载承诺详情..." : "在左侧选择一个承诺查看账目" }}</div>
                <div v-if="props.error" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-1.5 text-[11px] text-[var(--status-danger)]">{{ props.error }}</div>
            </div>
        </div>

        <template v-else>
            <!-- 详情头部:标题 + 状态链 chips + 操作按钮 -->
            <header class="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-panel)]/60 px-5 py-3.5">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-2">
                            <h3 class="min-w-0 truncate text-[15px] font-semibold text-[var(--text-main)]">{{ props.detail.title }}</h3>
                            <span v-if="props.loading" class="i-lucide-loader-circle h-3.5 w-3.5 shrink-0 animate-spin text-[var(--text-muted)]"></span>
                            <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="PLANNING_TONE_CLASSES[PROMISE_STATUS_META[props.detail.status].tone].chip">{{ PROMISE_STATUS_META[props.detail.status].label }}</span>
                            <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px]" :class="PLANNING_TONE_CLASSES[PROMISE_DERIVED_STAGE_META[props.detail.derivedStage].tone].chip" title="派生阶段:由有效节拍推导">{{ PROMISE_DERIVED_STAGE_META[props.detail.derivedStage].label }}</span>
                            <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px]" :class="PLANNING_TONE_CLASSES[PROMISE_IMPORTANCE_META[props.detail.importance].tone].chip">重要性 {{ PROMISE_IMPORTANCE_META[props.detail.importance].label }}</span>
                        </div>
                        <div class="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                            <span class="font-mono" title="机器名(供互指引用)">{{ props.detail.name }}</span>
                            <span v-for="tag in props.detail.tags" :key="tag" class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">#{{ tag }}</span>
                        </div>
                    </div>
                    <!-- 操作区:编辑 / 生命周期 / 删除 -->
                    <div class="flex shrink-0 items-center gap-1.5">
                        <button type="button" data-testid="plot-promise-edit" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('edit')">
                            <span class="i-lucide-pencil-line h-3.5 w-3.5"></span>
                            编辑
                        </button>
                        <button v-for="action in statusActions" :key="action.status" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('changeStatus', action.status)">
                            <span class="h-3.5 w-3.5" :class="action.iconClass"></span>
                            {{ action.label }}
                        </button>
                        <button type="button" data-testid="plot-promise-delete" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)] transition-colors hover:border-[var(--status-danger-border)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" title="删除承诺(物理删除,节拍一并删除)" @click="emit('delete')">
                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                        </button>
                    </div>
                </div>
            </header>

            <!-- 详情主体滚动区 -->
            <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 custom-scrollbar">
                <div v-if="props.error" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">{{ props.error }}</div>

                <!-- 承诺内容 / 兑现预期 -->
                <section class="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
                    <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/50 px-3.5 py-3">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">承诺内容(向读者许了什么)</div>
                        <p class="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed" :class="props.detail.summary ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'">{{ props.detail.summary || "未填写" }}</p>
                    </div>
                    <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/50 px-3.5 py-3">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">兑现预期(只给兑现场的 writer)</div>
                        <p class="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed" :class="props.detail.payoffExpectation ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'">{{ props.detail.payoffExpectation ?? "未填写" }}</p>
                    </div>
                </section>

                <!-- 节奏与期限 -->
                <section class="grid grid-cols-2 gap-2.5">
                    <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/50 px-3.5 py-3">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">参考节奏</div>
                        <div class="mt-1.5 flex items-center gap-1.5 text-[12px]" :class="props.detail.cadenceChapters ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'">
                            <span class="i-lucide-timer h-3.5 w-3.5 shrink-0"></span>
                            {{ props.detail.cadenceChapters ? `每 ${props.detail.cadenceChapters} 章` : "未设置" }}
                        </div>
                    </div>
                    <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/50 px-3.5 py-3">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">兑现期限章</div>
                        <!-- deadlineChapterId 非空而 deadlineChapter 为空 = 期限章已被删除,danger 提示 -->
                        <div v-if="props.detail.deadlineChapterId && !props.detail.deadlineChapter" class="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--status-danger)]">
                            <span class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0"></span>
                            期限章已删除
                        </div>
                        <div v-else class="mt-1.5 flex items-center gap-1.5 text-[12px]" :class="props.detail.deadlineChapter ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'">
                            <span class="i-lucide-flag h-3.5 w-3.5 shrink-0"></span>
                            <span class="truncate">{{ props.detail.deadlineChapter ? chapterLabel(props.detail.deadlineChapter.id, props.detail.deadlineChapter.title) : "无期限" }}</span>
                        </div>
                    </div>
                </section>

                <!-- 节拍时间线(按章序) -->
                <section>
                    <div class="mb-2 flex items-center justify-between">
                        <div class="text-[11px] font-semibold text-[var(--text-main)]">节拍时间线({{ sortedBeats.length }})</div>
                        <button type="button" data-testid="plot-promise-add-beat" class="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]" @click="emit('addBeat')">
                            <span class="i-lucide-plus h-3 w-3"></span>
                            添加节拍
                        </button>
                    </div>

                    <!-- 无节拍空态:承诺尚未埋设 -->
                    <div v-if="sortedBeats.length === 0" class="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-[var(--border-color)] px-4 py-6 text-center">
                        <span class="i-lucide-sprout h-5 w-5 text-[var(--text-muted)] opacity-60"></span>
                        <div class="text-[11px] text-[var(--text-muted)]">还没有节拍。先在某个场景「埋设」,承诺才算落地。</div>
                    </div>

                    <ol v-else class="space-y-1.5">
                        <li v-for="beat in sortedBeats" :key="beat.id" class="group flex items-start gap-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/50 px-3 py-2">
                            <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]" :title="PROMISE_BEAT_KIND_META[beat.kind].label">
                                <span class="h-3.5 w-3.5 text-[var(--text-secondary)]" :class="PROMISE_BEAT_KIND_META[beat.kind].iconClass"></span>
                            </span>
                            <div class="min-w-0 flex-1">
                                <div class="flex min-w-0 items-center gap-2">
                                    <span class="shrink-0 text-[11px] font-semibold text-[var(--text-secondary)]">{{ PROMISE_BEAT_KIND_META[beat.kind].label }}</span>
                                    <!-- 场景标题可点击:跳回线程规划 tab 并选中该场 -->
                                    <button type="button" class="min-w-0 truncate text-left text-[12px] font-medium text-[var(--text-main)] underline-offset-2 transition-colors hover:text-[var(--accent-text)] hover:underline" :title="`跳到场景:${beat.scene.title || '未命名 Scene'}`" @click="emit('selectScene', beat.sceneId)">{{ beat.scene.title || "未命名 Scene" }}</button>
                                    <span class="shrink-0 text-[10px] text-[var(--text-muted)]">{{ beat.scene.chapter ? chapterLabel(beat.scene.chapter.id, beat.scene.chapter.title) : "未挂章" }}</span>
                                    <span class="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" :class="PLANNING_TONE_CLASSES[PROMISE_BEAT_STATE_META[beat.state].tone].chip">{{ PROMISE_BEAT_STATE_META[beat.state].label }}</span>
                                    <button type="button" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] opacity-0 transition-all hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)] group-hover:opacity-100" title="删除节拍" @click="emit('removeBeat', beat.sceneId)">
                                        <span class="i-lucide-trash-2 h-3 w-3"></span>
                                    </button>
                                </div>
                                <div v-if="beat.note" class="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-secondary)]">{{ beat.note }}</div>
                            </div>
                        </li>
                    </ol>
                </section>
            </div>
        </template>
    </section>
</template>
