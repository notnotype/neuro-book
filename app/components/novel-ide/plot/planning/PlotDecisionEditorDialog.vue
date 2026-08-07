<script setup lang="ts">
// 决策(StoryDecision)编辑对话框:新建 / 编辑共用。
// open 态字段:name/title/question/options/anchor/deadline/serves/dependsOn/note;
// 编辑已 decided 的决策时,decided 态字段(decision/motivation/risk/rejectedAlternatives)也可编辑(整体替换语义),
// 但状态转换(拍板/作废/重开)不在此对话框做,走账本 tab 的专门动作。
// anchor 写入是 {kind,id?,path?} 整体替换:story 不带载体,content 只带 path,其余 kind 只带 id(D12)。
import {computed, reactive, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import {DECISION_ANCHOR_KIND_META} from "nbook/app/components/novel-ide/plot/planning/plot-planning.types";
import type {
    PlotThreadPanelChapter,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {
    StoryActDto,
    StoryDecisionAnchorInputDto,
    StoryDecisionAnchorKindDto,
    StoryDecisionDto,
    StoryPromiseDto,
} from "nbook/shared/dto/plot.dto";

// 编辑器提交载荷:宿主 tab 按 mode 映射到 Create/Update 请求;列表字段(options/serves/dependsOn/anchor)整体替换。
export type PlotDecisionEditorSave = {
    name: string;
    title: string;
    question: string;
    options: Array<{option: string; note: string | null}>;
    // 为空表示无拍板期限(显式清空)。
    deadlineChapterId: string | null;
    serves: string[];
    dependsOn: string[];
    // 主锚点(整体替换):story 不带载体,content 只带 path,其余 kind 只带 id。
    anchor: StoryDecisionAnchorInputDto;
    // 为空表示显式清空备注(dropped 态备注承载失效原因,清空会被服务层拒绝)。
    note: string | null;
    // 仅编辑已拍板(decided)决策时非空:decided 态字段整体替换;为空表示本次提交不含 decided 态字段。
    decidedFields: {
        decision: string;
        motivation: string;
        risk: string;
        rejectedAlternatives: Array<{option: string; whyRejected: string | null}>;
    } | null;
};

const props = defineProps<{
    visible: boolean;
    mode: "create" | "edit";
    // 编辑对象;mode=create 时为空。
    decision: StoryDecisionDto | null;
    // anchor 选择器与期限章下拉数据源(来自工作台 props)。
    acts: StoryActDto[];
    chapters: PlotThreadPanelChapter[];
    threads: PlotThreadPanelThread[];
    scenes: PlotThreadPanelScene[];
    // anchor kind=promise 的候选(宿主 tab 自拉的承诺列表)。
    promises: StoryPromiseDto[];
    saving?: boolean;
    // 为空表示宿主侧无保存错误。
    error?: string;
}>();

const emit = defineEmits<{
    (e: "update:visible", value: boolean): void;
    (e: "save", payload: PlotDecisionEditorSave): void;
}>();

// 标量字段草稿:可空字段空串在提交时映射 null(显式清空)。
const draft = reactive({
    name: "",
    title: "",
    question: "",
    deadlineChapterId: "",
    note: "",
    anchorKind: "story" as StoryDecisionAnchorKindDto,
    // anchor 载体:实体类 kind 用 anchorId;content 用 anchorPath;story 两者皆空。
    anchorId: "",
    anchorPath: "",
    // decided 态三段(仅编辑已拍板决策时使用)。
    decision: "",
    motivation: "",
    risk: "",
});
// 行编辑列表:行对象直接被行内 v-model 修改(serves/dependsOn 也用 {value} 对象行,规避对索引访问的 undefined 收窄)。
// deadTarget 记录装载时已判死的引用原文(DTO valid=false);为空表示装载时引用有效或该行为新加行。
const optionRows = ref<Array<{option: string; note: string}>>([]);
const servesRows = ref<Array<{value: string; deadTarget: string | null}>>([]);
const dependsOnRows = ref<Array<{value: string; deadTarget: string | null}>>([]);
const rejectedRows = ref<Array<{option: string; whyRejected: string}>>([]);
// 本地校验错误;为空表示当前无校验问题。
const validationError = ref("");

const dialogTitle = computed(() => props.mode === "create" ? "新建决策" : "编辑决策");
// 是否在编辑一条已拍板的决策(decided 态字段区随之出现)。
const editingDecided = computed(() => props.mode === "edit" && props.decision?.status === "decided");
// 编辑态改名警示:name 供文档/章节简报/Agent 指令按名引用,改名后这些引用不会自动更新(serves/dependsOn 互指按 id,不受影响)。
const nameChanged = computed(() => props.mode === "edit" && props.decision !== null && draft.name.trim() !== props.decision.name);

// anchor kind 下拉(META 声明序:全书/卷/章/线/场/承诺/内容节点)。
const anchorKindOptions: SelectOption[] = (Object.keys(DECISION_ANCHOR_KIND_META) as StoryDecisionAnchorKindDto[])
    .map((kind) => ({value: kind, label: DECISION_ANCHOR_KIND_META[kind].label}));

// 卷下拉(anchor kind=act),来自承载树透传;为空数组表示当前 Story 尚未建卷(模板降级为提示文案)。
const actOptions = computed<SelectOption[]>(() => props.acts.map((act) => ({
    value: act.id,
    label: act.title || act.name,
})));

// 章节下拉(anchor kind=chapter 与期限章共用素材)。
const chapterOptions = computed<SelectOption[]>(() => props.chapters.map((chapter) => ({
    value: chapter.id,
    label: `${chapter.numberLabel} ${chapter.title}`,
    description: chapter.volumeTitle,
})));

// 期限章下拉;空值表示无拍板期限。
const deadlineOptions = computed<SelectOption[]>(() => [
    {value: "", label: "无期限"},
    ...chapterOptions.value,
]);

// 线程下拉(anchor kind=thread)。
const threadOptions = computed<SelectOption[]>(() => props.threads.map((thread) => ({
    value: thread.id,
    label: thread.title || "未命名 Thread",
})));

// 场景下拉(anchor kind=scene):按 threads 声明序 → threadSortOrder,label=「线名 · 场名」,description=挂章信息。
const sceneOptions = computed<SelectOption[]>(() => {
    const chapterTitles = new Map(props.chapters.map((chapter) => [chapter.id, `${chapter.numberLabel} ${chapter.title}`]));
    return props.threads.flatMap((thread) => props.scenes
        .filter((scene) => scene.threadId === thread.id)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder)
        .map((scene) => ({
            value: scene.id,
            label: `${thread.title || "未命名 Thread"} · ${scene.title || "未命名 Scene"}`,
            description: scene.chapterId ? (chapterTitles.get(scene.chapterId) ?? "挂章已删除") : "未挂章",
        })));
});

// 承诺下拉(anchor kind=promise),来自宿主 tab 自拉的列表。
const promiseOptions = computed<SelectOption[]>(() => props.promises.map((promise) => ({
    value: promise.id,
    label: promise.title || promise.name,
    description: promise.name,
})));

/** 把当前 decision(或空)同步到本地草稿。 */
function syncDraft(): void {
    const decision = props.decision;
    draft.name = decision?.name ?? "";
    draft.title = decision?.title ?? "";
    draft.question = decision?.question ?? "";
    draft.deadlineChapterId = decision?.deadlineChapterId ?? "";
    draft.note = decision?.note ?? "";
    draft.anchorKind = decision?.anchorKind ?? "story";
    draft.anchorId = decision?.anchorTargetId ?? "";
    draft.anchorPath = decision?.anchorPath ?? "";
    draft.decision = decision?.decision ?? "";
    draft.motivation = decision?.motivation ?? "";
    draft.risk = decision?.risk ?? "";
    optionRows.value = (decision?.options ?? []).map((row) => ({option: row.option, note: row.note ?? ""}));
    // 装载时记录死引用原文:目标已删除的行给行内 danger 标注(服务层对整单跑存在性校验,留着死引用会保存失败)。
    servesRows.value = (decision?.serves ?? []).map((row) => ({value: row.target, deadTarget: row.valid ? null : row.target}));
    dependsOnRows.value = (decision?.dependsOn ?? []).map((row) => ({value: row.target, deadTarget: row.valid ? null : row.target}));
    rejectedRows.value = (decision?.rejectedAlternatives ?? []).map((row) => ({option: row.option, whyRejected: row.whyRejected ?? ""}));
    validationError.value = "";
}

watch(() => [props.visible, props.decision] as const, ([visible]) => {
    if (visible) {
        syncDraft();
    }
}, {immediate: true});

/** 切换锚点类型:载体字段随 kind 重置,防止把 A 类实体 id 提交成 B 类锚点。 */
function changeAnchorKind(value: string): void {
    const kind = value as StoryDecisionAnchorKindDto;
    if (kind === draft.anchorKind) {
        return;
    }
    draft.anchorKind = kind;
    draft.anchorId = "";
    draft.anchorPath = "";
}

/**
 * 行内死引用判定:装载时已判死且用户尚未改动原文时给 danger 标注;
 * 改过原文后不再断言(改后是否有效交服务层校验)。
 */
function isDeadRefRow(row: {value: string; deadTarget: string | null}): boolean {
    return row.deadTarget !== null && row.value.trim() === row.deadTarget;
}

/** 空串转 null(显式清空),否则 trim 后返回。 */
function toNullable(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** 关闭对话框(不提交)。 */
function closeDialog(): void {
    emit("update:visible", false);
}

/** 客户端校验并提交;必填缺失或 anchor 载体与 kind 不匹配时写本地校验错误,不发请求。 */
function submit(): void {
    const name = draft.name.trim();
    const title = draft.title.trim();
    const question = draft.question.trim();
    if (!name) {
        validationError.value = "name 不能为空(小写字母/数字/连字符)";
        return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        validationError.value = "name 仅允许小写字母、数字和中划线";
        return;
    }
    if (!title) {
        validationError.value = "标题不能为空";
        return;
    }
    if (!question) {
        validationError.value = "待决问题(question)不能为空";
        return;
    }

    // 候选行:整行全空的行静默丢弃;只填了补充说明的行视为漏填必填项。
    // 候选文本必须唯一(trim 后比较):拍板按候选文本识别被选项,重复会让否决记录错乱(服务层同样拒绝)。
    const options: Array<{option: string; note: string | null}> = [];
    const seenOptions = new Set<string>();
    for (const row of optionRows.value) {
        const option = row.option.trim();
        const note = row.note.trim();
        if (!option && !note) {
            continue;
        }
        if (!option) {
            validationError.value = "候选方案的内容不能为空(该行只填了补充说明)";
            return;
        }
        if (seenOptions.has(option)) {
            validationError.value = `候选方案重复:「${option}」;拍板按候选文本识别被选项,请修改为不同表述`;
            return;
        }
        seenOptions.add(option);
        options.push({option, note: note || null});
    }

    // anchor 按 kind 组装载体(整体替换)。
    let anchor: StoryDecisionAnchorInputDto;
    if (draft.anchorKind === "story") {
        anchor = {kind: "story"};
    } else if (draft.anchorKind === "content") {
        const path = draft.anchorPath.trim();
        if (!path) {
            validationError.value = "锚点为内容节点时必须填写相对路径";
            return;
        }
        anchor = {kind: "content", path};
    } else {
        const id = draft.anchorId.trim();
        if (!id) {
            validationError.value = `锚点为「${DECISION_ANCHOR_KIND_META[draft.anchorKind].label}」时必须选择/填写目标实体`;
            return;
        }
        anchor = {kind: draft.anchorKind, id};
    }

    const serves = servesRows.value.map((row) => row.value.trim()).filter((row) => row.length > 0);
    const dependsOn = dependsOnRows.value.map((row) => row.value.trim()).filter((row) => row.length > 0);

    // decided 态字段:仅编辑已拍板决策时提交;三段必须保持非空(decided 不变式,服务层还有一道校验)。
    let decidedFields: PlotDecisionEditorSave["decidedFields"] = null;
    if (editingDecided.value) {
        const decisionText = draft.decision.trim();
        const motivationText = draft.motivation.trim();
        const riskText = draft.risk.trim();
        if (!decisionText || !motivationText || !riskText) {
            validationError.value = "已拍板的决策必须保留非空的 结论/动机/风险";
            return;
        }
        const rejectedAlternatives: Array<{option: string; whyRejected: string | null}> = [];
        for (const row of rejectedRows.value) {
            const option = row.option.trim();
            const whyRejected = row.whyRejected.trim();
            if (!option && !whyRejected) {
                continue;
            }
            if (!option) {
                validationError.value = "否决记录的候选内容不能为空(该行只填了否决理由)";
                return;
            }
            rejectedAlternatives.push({option, whyRejected: whyRejected || null});
        }
        decidedFields = {decision: decisionText, motivation: motivationText, risk: riskText, rejectedAlternatives};
    }

    validationError.value = "";
    emit("save", {
        name,
        title,
        question,
        options,
        deadlineChapterId: draft.deadlineChapterId.trim() || null,
        serves,
        dependsOn,
        anchor,
        note: toNullable(draft.note),
        decidedFields,
    });
}
</script>

<template>
    <!-- 决策编辑对话框 -->
    <Dialog
        :model-value="props.visible"
        :title="dialogTitle"
        width="720px"
        show-cancel
        overlay-type="opaque"
        :busy="props.saving"
        @request-close="closeDialog"
        @update:model-value="emit('update:visible', $event)"
    >
        <template #header-extra>
            <div v-if="props.saving || props.error" class="ml-2 flex items-center text-xs">
                <span v-if="props.saving" class="flex items-center gap-1 text-[var(--text-muted)]">
                    <span class="i-lucide-loader-circle animate-spin"></span>
                    保存中
                </span>
                <span v-else class="text-[var(--status-danger)]">{{ props.error }}</span>
            </div>
        </template>
        <template #footer>
            <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.saving" @click="closeDialog">取消</button>
            <button class="inline-flex items-center justify-center h-8 min-w-[92px] px-4 rounded-md text-[13px] font-medium cursor-pointer border border-transparent bg-[var(--accent-main)] text-[var(--text-inverse)] transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.saving" @click="submit">
                <span v-if="props.saving" class="flex items-center gap-1">
                    <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                    保存中
                </span>
                <span v-else>确定</span>
            </button>
        </template>

        <!-- 决策表单主体 -->
        <div class="mt-1 space-y-3 px-1">
            <div v-if="validationError" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-1.5 text-[11px] text-[var(--status-danger)]">{{ validationError }}</div>

            <FormField label="标题">
                <FormInput v-model="draft.title" placeholder="如 莉娅的真实身份怎么揭" />
            </FormField>

            <FormField :label="props.mode === 'create' ? 'name(必填,供互指引用)' : 'name(供互指引用)'">
                <FormInput v-model="draft.name" placeholder="如 d-liya-truth(小写字母/数字/连字符)" />
                <!-- 改名破坏按名引用的行内警示,仅编辑态且已改动时出现;不举 decision:// 协议例(serves/dependsOn 互指按 id,不受改名影响) -->
                <div v-if="nameChanged" class="mt-1 flex items-start gap-1.5 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1 text-[11px] text-[var(--status-warning)]">
                    <span class="i-lucide-triangle-alert mt-0.5 h-3 w-3 shrink-0"></span>
                    <span>name 可能被文档、章节简报与 Agent 指令按名引用,改名后这些引用不会自动更新,保存前请确认。</span>
                </div>
            </FormField>

            <FormField label="待决问题(question,必填)">
                <FormTextarea v-model="draft.question" :rows="3" placeholder="要拍板的问题本身,如「莉娅的身世在第几卷、以什么方式揭晓」" />
            </FormField>

            <!-- 候选方案行编辑 -->
            <FormField label="候选方案(options)">
                <div class="space-y-1.5">
                    <div v-for="(row, index) in optionRows" :key="index" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-2">
                        <div class="flex items-center gap-1.5">
                            <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--bg-hover)] text-[10px] font-semibold text-[var(--text-muted)]">{{ index + 1 }}</span>
                            <div class="min-w-0 flex-1">
                                <FormInput v-model="row.option" placeholder="候选方案内容(必填)" />
                            </div>
                            <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" title="移除该候选" @click="optionRows.splice(index, 1)">
                                <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                            </button>
                        </div>
                        <div class="mt-1.5">
                            <FormInput v-model="row.note" placeholder="补充说明(可空)" />
                        </div>
                    </div>
                    <button type="button" class="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--border-color)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="optionRows.push({option: '', note: ''})">
                        <span class="i-lucide-plus h-3 w-3"></span>
                        添加候选
                    </button>
                </div>
            </FormField>

            <!-- 主锚点:kind 下拉 + 按 kind 联动的载体选择 -->
            <FormField label="主锚点(anchor)">
                <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                    <FormSelect :model-value="draft.anchorKind" :options="anchorKindOptions" @update:model-value="changeAnchorKind" />
                    <div v-if="draft.anchorKind === 'story'" class="flex h-7 items-center rounded-md border border-dashed border-[var(--border-color)] px-2.5 text-[11px] text-[var(--text-muted)]">锚在全书层,无需选择载体</div>
                    <FormSelect v-else-if="draft.anchorKind === 'chapter'" v-model="draft.anchorId" :options="chapterOptions" placeholder="选择章节" />
                    <FormSelect v-else-if="draft.anchorKind === 'thread'" v-model="draft.anchorId" :options="threadOptions" placeholder="选择线程" />
                    <FormSelect v-else-if="draft.anchorKind === 'scene'" v-model="draft.anchorId" :options="sceneOptions" placeholder="选择场景(线名 · 场名)" />
                    <FormSelect v-else-if="draft.anchorKind === 'promise'" v-model="draft.anchorId" :options="promiseOptions" placeholder="选择承诺" />
                    <!-- act:卷下拉(承载树透传);尚未建卷时降级为提示,避免可选但不可完成 -->
                    <FormSelect v-else-if="draft.anchorKind === 'act' && props.acts.length > 0" v-model="draft.anchorId" :options="actOptions" placeholder="选择卷" />
                    <div v-else-if="draft.anchorKind === 'act'" class="flex h-7 items-center rounded-md border border-dashed border-[var(--border-color)] px-2.5 text-[11px] text-[var(--text-muted)]">暂无卷(Act):先在剧情面板章节条「+卷」创建</div>
                    <FormInput v-else v-model="draft.anchorPath" placeholder="内容节点相对路径,如 lorebook/character/chen-yao/" />
                </div>
            </FormField>

            <FormField label="拍板期限章">
                <FormSelect v-model="draft.deadlineChapterId" :options="deadlineOptions" placeholder="无期限" />
            </FormField>

            <!-- serves 字符串行编辑:死引用行给 danger 标注(服务层整单校验,留着会保存失败) -->
            <FormField label="服务对象(serves)">
                <div class="space-y-1.5">
                    <div v-for="(row, index) in servesRows" :key="index">
                        <div class="flex items-center gap-1.5">
                            <div class="min-w-0 flex-1">
                                <FormInput v-model="row.value" placeholder="promise://{id} / decision://{id} / thread://{id} / scene://{id} 或内容节点相对路径" />
                            </div>
                            <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" title="移除该引用" @click="servesRows.splice(index, 1)">
                                <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                            </button>
                        </div>
                        <div v-if="isDeadRefRow(row)" class="mt-1 flex items-start gap-1.5 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-1 text-[11px] text-[var(--status-danger)]">
                            <span class="i-lucide-unlink mt-0.5 h-3 w-3 shrink-0"></span>
                            <span>该引用目标已删除(死引用):保存前请移除本行或改指向存在的对象,否则整个保存会被拒绝。</span>
                        </div>
                    </div>
                    <button type="button" class="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--border-color)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="servesRows.push({value: '', deadTarget: null})">
                        <span class="i-lucide-plus h-3 w-3"></span>
                        添加服务对象
                    </button>
                </div>
            </FormField>

            <!-- dependsOn 字符串行编辑:死引用行给 danger 标注(同 serves) -->
            <FormField label="依赖前置(dependsOn)">
                <div class="space-y-1.5">
                    <div v-for="(row, index) in dependsOnRows" :key="index">
                        <div class="flex items-center gap-1.5">
                            <div class="min-w-0 flex-1">
                                <FormInput v-model="row.value" placeholder="promise://{id} / decision://{id} / thread://{id} / scene://{id} 或内容节点相对路径" />
                            </div>
                            <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" title="移除该引用" @click="dependsOnRows.splice(index, 1)">
                                <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                            </button>
                        </div>
                        <div v-if="isDeadRefRow(row)" class="mt-1 flex items-start gap-1.5 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-1 text-[11px] text-[var(--status-danger)]">
                            <span class="i-lucide-unlink mt-0.5 h-3 w-3 shrink-0"></span>
                            <span>该引用目标已删除(死引用):保存前请移除本行或改指向存在的对象,否则整个保存会被拒绝。</span>
                        </div>
                    </div>
                    <button type="button" class="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--border-color)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="dependsOnRows.push({value: '', deadTarget: null})">
                        <span class="i-lucide-plus h-3 w-3"></span>
                        添加依赖
                    </button>
                </div>
            </FormField>

            <FormField label="备注">
                <FormTextarea v-model="draft.note" :rows="2" placeholder="额外备注(可空)" />
                <!-- dropped 态备注即失效原因,清空会破坏不变式,提前提示 -->
                <div v-if="props.decision?.status === 'dropped'" class="mt-1 text-[11px] text-[var(--text-muted)]">当前决策已作废:备注承载失效原因,清空会被服务层拒绝。</div>
            </FormField>

            <!-- decided 态字段区:仅编辑已拍板决策时出现,整体替换语义 -->
            <div v-if="editingDecided" class="mt-1 space-y-3 border-t border-[var(--border-color)] pt-3">
                <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">已拍板字段(整体替换)</div>
                <div class="text-[11px] text-[var(--text-muted)]">这里只修订已拍板的文本;状态转换(重开/作废)在详情页的操作栏做。</div>
                <FormField label="结论(decision)">
                    <FormTextarea v-model="draft.decision" :rows="3" placeholder="最终怎么定(decided 态必须非空)" />
                </FormField>
                <FormField label="动机(motivation)">
                    <FormTextarea v-model="draft.motivation" :rows="2" placeholder="为什么这样定(decided 态必须非空)" />
                </FormField>
                <FormField label="风险(risk · writer 的刹车点)">
                    <FormTextarea v-model="draft.risk" :rows="2" placeholder="沿此结论写下去要注意什么(decided 态必须非空)" />
                </FormField>
                <FormField label="否决记录(rejectedAlternatives)">
                    <div class="space-y-1.5">
                        <div v-for="(row, index) in rejectedRows" :key="index" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-2">
                            <div class="flex items-center gap-1.5">
                                <div class="min-w-0 flex-1">
                                    <FormInput v-model="row.option" placeholder="被否决的候选(必填)" />
                                </div>
                                <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" title="移除该否决记录" @click="rejectedRows.splice(index, 1)">
                                    <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                </button>
                            </div>
                            <div class="mt-1.5">
                                <FormInput v-model="row.whyRejected" placeholder="否决理由(可空=待补理由)" />
                            </div>
                        </div>
                        <button type="button" class="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--border-color)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="rejectedRows.push({option: '', whyRejected: ''})">
                            <span class="i-lucide-plus h-3 w-3"></span>
                            添加否决记录
                        </button>
                    </div>
                </FormField>
            </div>
        </div>
    </Dialog>
</template>
