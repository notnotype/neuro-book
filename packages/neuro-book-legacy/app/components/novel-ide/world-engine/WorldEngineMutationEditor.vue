<script setup lang="ts">
import {computed, reactive, ref, watch} from "vue";
import WorldEngineMutationBuilder from "nbook/app/components/novel-ide/world-engine/WorldEngineMutationBuilder.vue";
import WorldEngineMutationEditorHeader from "nbook/app/components/novel-ide/world-engine/WorldEngineMutationEditorHeader.vue";
import WorldEngineSliceDraftForm from "nbook/app/components/novel-ide/world-engine/WorldEngineSliceDraftForm.vue";
import {useDialog} from "nbook/app/composables/useDialog";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    clampMutationIndex,
    defaultMutationForPreviewAttr,
    defaultMutationForPreviewSubject,
    defaultValueForPreviewAttr,
    deleteMutationAt,
    duplicateMutationAt,
    formatJsonInputValue,
    formatWorldEngineConflictMessage,
    insertMutationAfter,
    isJsonObjectValue,
    moveMutationAt,
    opOptionsForPreviewAttr,
    parseLooseJsonValue,
    parseMutationJson,
    parseMutationListJson,
    previewAttrValueType,
    replaceMutationAt,
    resolvePreviewAttrPath,
    suggestAdjacentPreviewTime,
    suggestNextPreviewTime,
    suggestSliceTime,
    type JsonValue,
    type WorldMutationDraft,
    type WorldMutationOp,
    type WorldPreviewSchemaAttr,
    type WorldPreviewSchemaType,
} from "nbook/app/utils/world-engine-preview";
import type {
    SubjectStateDto,
    SliceWriteResultDto,
    WorldSchemaProjectionDto,
    WorldSliceDto,
    WorldSlicePatchDto,
    WorldSubjectDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

type BuilderValueMode = "hidden" | "number" | "boolean" | "enum" | "ref" | "object" | "json" | "text";
type ObjectBuilderRow = {key: string; value: string; enabled: boolean};
const props = defineProps<{
    projectRoot: string;
    schema: WorldSchemaProjectionDto | null;
    subjects: WorldSubjectDto[];
    selectedSubjectId: string;
    selectedSlice: WorldSliceDto | null;
    loadSliceKey: number;
    newSliceKey: number;
    stateResult: SubjectStateDto[];
    usedTimes?: string[];
    insertSliceContext?: {
        anchorTime: string;
        direction: "before" | "after";
        version: number;
    } | null;
    busy?: boolean;
}>();

const emit = defineEmits<{
    (e: "dirtyChange", dirty: boolean): void;
    (e: "savingChange", saving: boolean): void;
    (e: "saved", payload: {result: SliceWriteResultDto; time: string; editing: boolean; continueAfterSave: boolean; contextSubjectId: string; mutations: WorldSlicePatchDto[]}): void;
    (e: "error", message: string): void;
    (e: "notice", message: string): void;
}>();
const initialSubjectId = props.selectedSubjectId || props.subjects[0]?.id || "world";
const initialMutation = defaultMutationForPreviewSubject(props.schema?.subjectTypes ?? [], props.subjects, initialSubjectId);
const sliceForm = reactive({
    time: suggestedNewSliceTime(),
    title: "新的世界切面",
    summary: "",
    kind: "event",
    mutations: defaultSliceMutations(initialSubjectId),
});
const mutationBuilder = reactive({
    subjectId: initialMutation.subjectId,
    path: initialMutation.path,
    op: initialMutation.op,
    value: initialMutation.op === "remove" ? "" : formatBuilderValue(initialMutation.value),
});
const objectBuilderRows = ref<ObjectBuilderRow[]>([{key: "", value: "", enabled: true}]);
const saving = ref(false);
const editingSliceId = ref("");
const cleanSnapshot = ref("");
const pendingLoadSelectedSlice = ref(false);
const mutationLoadIndex = ref("0");
const lastContinueSaveNotice = ref("");
const builderDraftDirty = ref(false);
const {confirm: confirmDialog} = useDialog();

const schemaTypes = computed<WorldPreviewSchemaType[]>(() => props.schema?.subjectTypes ?? []);
const selectedSubject = computed<WorldSubjectDto | null>(() => props.subjects.find((subject) => subject.id === mutationBuilder.subjectId) ?? null);
const builderAttrs = computed<WorldPreviewSchemaAttr[]>(() => attrsForSubjectId(mutationBuilder.subjectId));
const builderAttr = computed<WorldPreviewSchemaAttr | null>(() => resolvePreviewAttrPath(builderAttrs.value, mutationBuilder.path));
const builderHasSchemaAttr = computed(() => builderAttrs.value.some((item) => attrToPointer(item.name) === mutationBuilder.path));
const builderOpOptions = computed<WorldMutationOp[]>(() => opOptionsForAttr(mutationBuilder.path));
const builderValueHint = computed(() => {
    const attr = builderAttr.value;
    if (!attr) {
        return "dynamic value";
    }
    const valueType = previewAttrValueType(attr) ?? "object";
    return attr.kind === "list" || attr.kind === "collection" ? `${attr.kind}<${valueType}>` : `${attr.kind}:${valueType}`;
});
const builderValueMode = computed<BuilderValueMode>(() => resolveBuilderValueMode(builderAttr.value, mutationBuilder.op));
const enumValueOptions = computed<Array<{label: string; value: string}>>(() => {
    return enumOptionsForAttr(builderAttr.value);
});
const refValueOptions = computed<Array<{label: string; value: string}>>(() => {
    return refOptionsForAttr(builderAttr.value);
});
const objectFieldEntries = computed<Array<{key: string; attr: WorldPreviewSchemaAttr}>>(() => {
    return Object.entries(builderAttr.value?.fields ?? {}).map(([key, attr]) => ({key, attr}));
});
const objectHasFixedFields = computed(() => builderValueMode.value === "object" && objectFieldEntries.value.length > 0);
const mutationValidation = computed(() => parseMutationJson(sliceForm.mutations));
const sliceValidation = computed(() => {
    if (!sliceForm.time.trim()) {
        return {ok: false, message: "time 不能为空"};
    }
    return mutationValidation.value;
});
const builderDisabled = computed(() => Boolean(props.busy) || saving.value);
const mutationLoadOptions = computed<Array<{label: string; value: string}>>(() => {
    const parsed = mutationValidation.value;
    if (!parsed.ok) {
        return [];
    }
    return parsed.value.map((mutation, index) => ({
        label: `#${index + 1} ${mutation.subjectId}${mutation.path} ${mutation.op}`,
        value: String(index),
    }));
});
const sliceActionLabel = computed(() => editingSliceId.value ? "保存 Slice 编辑" : "写入 Slice");
const canSubmit = computed(() => Boolean(props.projectRoot) && !props.busy && !saving.value && sliceValidation.value.ok);
const hasDirtyDraft = computed(() => cleanSnapshot.value !== "" && (serializeSliceForm() !== cleanSnapshot.value || builderDraftDirty.value));
markCleanSliceForm();

/** 写入新 slice 或整块替换当前编辑中的 slice。 */
async function submitSlice(options: {continueAfterSave?: boolean} = {}): Promise<void> {
    if (!props.projectRoot || props.busy || saving.value) {
        return;
    }
    if (!applyDirtyBuilderDraftBeforeSubmit()) {
        return;
    }
    const validation = sliceValidation.value;
    if (!validation.ok) {
        emit("error", validation.message);
        return;
    }
    const parsed = mutationValidation.value;
    if (!parsed.ok) {
        emit("error", parsed.message);
        return;
    }

    saving.value = true;
    emit("savingChange", true);
    try {
        const editing = Boolean(editingSliceId.value);
        const continueAfterSave = options.continueAfterSave === true && !editing;
        const lastMutation = parsed.value.at(-1);
        const selectedSubjectId = props.selectedSubjectId.trim();
        const defaultForSelected = selectedSubjectId ? defaultMutationForPreviewSubject(props.schema?.subjectTypes ?? [], props.subjects, selectedSubjectId) : null;
        const keepSelectedContext = Boolean(
            selectedSubjectId
            && lastMutation
            && defaultForSelected
            && defaultForSelected.subjectId === lastMutation.subjectId
            && defaultForSelected.path === lastMutation.path
            && defaultForSelected.op === lastMutation.op,
        );
        const contextSubjectId = keepSelectedContext ? selectedSubjectId : lastMutation?.subjectId || selectedSubjectId || mutationBuilder.subjectId || "world";
        const result = await $fetch<SliceWriteResultDto>(editing ? `/api/projects/world-engine/slices/${encodeURIComponent(editingSliceId.value)}/edit` : "/api/projects/world-engine/slices", {
            method: "POST",
            query: projectQuery(),
            body: {
                time: sliceForm.time.trim(),
                title: sliceForm.title.trim(),
                summary: sliceForm.summary.trim(),
                kind: sliceForm.kind.trim() || "event",
                patches: parsed.value,
            },
        });
        const savedTime = sliceForm.time.trim();
        editingSliceId.value = "";
        pendingLoadSelectedSlice.value = false;
        if (continueAfterSave) {
            sliceForm.time = suggestedNewSliceTime([savedTime]);
            sliceForm.title = "新的世界切面";
            sliceForm.summary = "";
            sliceForm.kind = "event";
            applyDefaultSliceMutation(contextSubjectId);
            lastContinueSaveNotice.value = result.issues.length
                ? `上一条已写入 ${result.sliceId}，返回 ${result.issues.length} 个 issue，已准备下一步草稿。`
                : `上一条已写入 ${result.sliceId}，已准备下一步草稿。`;
        } else {
            lastContinueSaveNotice.value = "";
        }
        markCleanSliceForm();
        emit("saved", {result, time: savedTime, editing, continueAfterSave, contextSubjectId, mutations: parsed.value});
    } catch (error) {
        emit("error", formatWorldEngineConflictMessage(resolveApiErrorMessage(error, editingSliceId.value ? "编辑 slice 失败" : "写入 slice 失败")));
    } finally {
        saving.value = false;
        emit("savingChange", false);
    }
}

/** 写入并继续下一步的按钮回调。 */
function submitSliceAndContinue(): Promise<void> {
    return submitSlice({continueAfterSave: true});
}

/** 将当前选中的 timeline slice 载入编辑表单。 */
function loadSelectedSlice(): void {
    if (props.busy || saving.value) {
        return;
    }
    if (hasDirtyDraft.value) {
        pendingLoadSelectedSlice.value = true;
        emit("notice", "当前编辑器有未保存草稿。确认放弃后再载入所选 slice。");
        return;
    }
    forceLoadSelectedSlice();
}

/** 放弃当前草稿，并载入所选 slice。 */
function discardDraftAndLoadSelectedSlice(): void {
    if (props.busy || saving.value) {
        return;
    }
    pendingLoadSelectedSlice.value = false;
    forceLoadSelectedSlice();
}

function forceLoadSelectedSlice(): void {
    const slice = props.selectedSlice;
    if (!slice) {
        emit("error", "请先选择一个 slice。");
        return;
    }
    editingSliceId.value = slice.id;
    lastContinueSaveNotice.value = "";
    sliceForm.time = slice.time;
    sliceForm.title = slice.title;
    sliceForm.summary = slice.summary;
    sliceForm.kind = slice.kind;
    sliceForm.mutations = JSON.stringify(slice.patches ?? [], null, 2);
    mutationLoadIndex.value = "0";
    if ((slice.patches ?? []).length) {
        loadMutationToBuilder(0, true);
    }
    builderDraftDirty.value = false;
    markCleanSliceForm();
    emit("notice", `正在编辑 slice ${slice.id}`);
}

/** 回到新建 slice 模式。 */
async function clearEditMode(): Promise<void> {
    if (props.busy || saving.value) {
        return;
    }
    if (hasDirtyDraft.value && import.meta.client && !await confirmDialog("当前编辑器有未保存草稿，确定切换到新建模式吗？", "Slice Composer 草稿未保存")) {
        return;
    }
    editingSliceId.value = "";
    lastContinueSaveNotice.value = "";
    sliceForm.title = "新的世界切面";
    sliceForm.summary = "";
    sliceForm.kind = "event";
    sliceForm.time = suggestedNewSliceTime();
    applyDefaultSliceMutation(props.selectedSubjectId || mutationBuilder.subjectId || "world");
    mutationLoadIndex.value = "0";
    pendingLoadSelectedSlice.value = false;
    builderDraftDirty.value = false;
    markCleanSliceForm();
}

/** 使用 schema attr 快速填充一条 mutation。 */
function fillMutation(typeName: string, attr: WorldPreviewSchemaAttr): void {
    if (builderDisabled.value) {
        return;
    }
    const subjectId = subjectIdForSchemaType(typeName);
    if (!subjectId) {
        emit("error", `当前 Project 还没有 ${typeName} subject，不能使用该 schema shortcut。请先创建对应 subject。`);
        return;
    }
    const mutation = defaultMutationForPreviewAttr(subjectId, attr, props.subjects);
    sliceForm.mutations = JSON.stringify([mutation], null, 2);
    mutationLoadIndex.value = "0";
    mutationBuilder.subjectId = subjectId;
    mutationBuilder.path = attrToPointer(attr.name);
    mutationBuilder.op = mutation.op;
    mutationBuilder.value = formatBuilderValue(mutation.value);
    syncObjectRowsFromBuilderValue();
    builderDraftDirty.value = false;
}

/** 将 Builder 当前输入追加或替换到 mutations JSON。 */
function addBuilderMutation(mode: "append" | "replace"): void {
    if (builderDisabled.value) {
        return;
    }
    const mutation = buildMutationFromBuilder();
    if (!mutation) {
        return;
    }
    const current = parseMutationListJson(sliceForm.mutations);
    if (mode === "append" && !current.ok && sliceForm.mutations.trim()) {
        emit("error", current.message);
        return;
    }
    const next = mode === "append" && current.ok ? [...current.value, mutation] : [mutation];
    sliceForm.mutations = JSON.stringify(next, null, 2);
    mutationLoadIndex.value = mode === "append" ? String(next.length - 1) : "0";
    builderDraftDirty.value = false;
}

/** 在当前选中的 mutation 后插入 Builder 当前内容。 */
function insertAfterSelectedBuilderMutation(): void {
    if (builderDisabled.value) {
        return;
    }
    const mutation = buildMutationFromBuilder();
    if (!mutation) {
        return;
    }
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        emit("error", parsed.message);
        return;
    }
    const result = insertMutationAfter(parsed.value, Number(mutationLoadIndex.value), mutation);
    if (!result.ok) {
        emit("error", result.message);
        return;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    builderDraftDirty.value = false;
    emit("notice", `已在第 ${result.value.index} 条 mutation 后插入新 mutation。`);
}

/** 复制当前选中的 mutation 到下一位。 */
function duplicateSelectedBuilderMutation(): void {
    if (builderDisabled.value) {
        return;
    }
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        emit("error", parsed.message);
        return;
    }
    const result = duplicateMutationAt(parsed.value, Number(mutationLoadIndex.value));
    if (!result.ok) {
        emit("error", result.message);
        return;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    loadMutationToBuilder(result.value.index, true);
    builderDraftDirty.value = false;
    emit("notice", `已复制所选 mutation 到第 ${result.value.index + 1} 位。`);
}

/** 用 Builder 当前输入原位替换 mutations JSON 中选中的 mutation。 */
function replaceSelectedBuilderMutation(): void {
    if (builderDisabled.value) {
        return;
    }
    const mutation = buildMutationFromBuilder();
    if (!mutation) {
        return;
    }
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        emit("error", parsed.message);
        return;
    }
    const result = replaceMutationAt(parsed.value, Number(mutationLoadIndex.value), mutation);
    if (!result.ok) {
        emit("error", result.message);
        return;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    builderDraftDirty.value = false;
    emit("notice", `已替换第 ${result.value.index + 1} 条 mutation。`);
}

/** 删除 mutations JSON 中当前选中的 mutation。 */
function deleteSelectedBuilderMutation(): void {
    if (builderDisabled.value) {
        return;
    }
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        emit("error", parsed.message);
        return;
    }
    const deletedIndex = Number(mutationLoadIndex.value);
    const result = deleteMutationAt(parsed.value, deletedIndex);
    if (!result.ok) {
        emit("error", result.message);
        return;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    if (result.value.mutations.length) {
        loadMutationToBuilder(result.value.index, true);
    } else {
        builderDraftDirty.value = false;
    }
    emit("notice", result.value.mutations.length ? `已删除第 ${deletedIndex + 1} 条 mutation。` : "已删除最后一条 mutation，保存前请先添加新的 mutation。");
}

/** 将当前选中的 mutation 上移或下移一位。 */
function moveSelectedBuilderMutation(direction: "up" | "down"): void {
    if (builderDisabled.value) {
        return;
    }
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        emit("error", parsed.message);
        return;
    }
    const result = moveMutationAt(parsed.value, Number(mutationLoadIndex.value), direction);
    if (!result.ok) {
        emit("error", result.message);
        return;
    }
    if (!result.value.changed) {
        emit("notice", result.value.message ?? "所选 mutation 已经在边界。");
        return;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    loadMutationToBuilder(result.value.index, true);
    emit("notice", `已将 mutation 移动到第 ${result.value.index + 1} 位。`);
}

/** 保存前把作者已编辑但尚未应用的 Builder 草稿同步进 mutations JSON，避免提交旧值。 */
function applyDirtyBuilderDraftBeforeSubmit(): boolean {
    if (!builderDraftDirty.value) {
        return true;
    }
    const mutation = buildMutationFromBuilder();
    if (!mutation) {
        return false;
    }
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        emit("error", parsed.message);
        return false;
    }
    const result = replaceMutationAt(parsed.value, Number(mutationLoadIndex.value), mutation);
    if (!result.ok) {
        emit("error", result.message);
        return false;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    builderDraftDirty.value = false;
    return true;
}

/** 从 Builder 表单构造 patch，集中处理 subject / path / value 校验。 */
function buildMutationFromBuilder(): WorldMutationDraft | null {
    if (!mutationBuilder.subjectId.trim()) {
        emit("error", "patch subjectId 不能为空");
        return null;
    }
    if (!mutationBuilder.path.trim()) {
        emit("error", "patch path 不能为空");
        return null;
    }

    const mutation: WorldMutationDraft = {
        subjectId: mutationBuilder.subjectId.trim(),
        path: mutationBuilder.path.trim(),
        op: mutationBuilder.op,
    };
    if (mutationBuilder.op !== "remove") {
        const parsedValue = parseBuilderValue();
        if (!parsedValue.ok) {
            emit("error", parsedValue.message);
            return null;
        }
        mutation.value = parsedValue.value;
    }
    return mutation;
}

/** 按输入控件语义解析 Builder value；文本框保持原始字符串，避免 `[验收]` 被误当 JSON 数组。 */
function parseBuilderValue(): ReturnType<typeof parseLooseJsonValue> {
    if (builderValueMode.value === "object") {
        return parseObjectBuilderRows();
    }
    if (builderValueMode.value === "json") {
        return parseJsonObjectBuilderValue();
    }
    if (builderValueMode.value === "text" || builderValueMode.value === "ref") {
        return {ok: true, value: mutationBuilder.value};
    }
    return parseLooseJsonValue(mutationBuilder.value);
}

/** 解析顶层 JSON object value；用于 list / collection 的 object item 输入。 */
function parseJsonObjectBuilderValue(): ReturnType<typeof parseLooseJsonValue> {
    const parsedValue = parseLooseJsonValue(mutationBuilder.value);
    if (!parsedValue.ok) {
        return parsedValue;
    }
    if (!isJsonObjectValue(parsedValue.value)) {
        return {ok: false, message: "mutation value 必须是 JSON object"};
    }
    return parsedValue;
}

/** 把 mutations JSON 的指定 mutation 回填到 Builder，便于编辑已有 slice。 */
function loadMutationToBuilder(index: number, silent = false): void {
    if (builderDisabled.value) {
        return;
    }
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        emit("error", parsed.message);
        return;
    }
    const mutation = parsed.value[index];
    if (!mutation) {
        emit("error", "当前 mutations JSON 没有可载入的 mutation");
        return;
    }
    mutationLoadIndex.value = String(index);
    mutationBuilder.subjectId = mutation.subjectId;
    mutationBuilder.path = mutation.path;
    mutationBuilder.op = mutation.op;
    mutationBuilder.value = mutation.op === "remove" ? "" : formatBuilderValue(mutation.value);
    syncObjectRowsFromBuilderValue();
    builderDraftDirty.value = false;
    if (!silent) {
        emit("notice", `已把第 ${index + 1} 条 mutation 载入 Builder。`);
    }
}

/** 接收 Builder 子组件的字段更新，保留父组件里的 watcher 与校验链路。 */
function updateBuilderField(field: "subjectId" | "path" | "op" | "value", value: string): void {
    if (builderDisabled.value) {
        return;
    }
    if (field === "op") {
        mutationBuilder.op = value as WorldMutationOp;
        builderDraftDirty.value = true;
        return;
    }
    mutationBuilder[field] = value;
    builderDraftDirty.value = true;
}

/** 更新 Builder 要从 mutations JSON 载入的 mutation 序号。 */
function updateMutationLoadIndex(value: string): void {
    if (builderDisabled.value) {
        return;
    }
    mutationLoadIndex.value = value;
}

function attrsForSubjectId(subjectId: string): WorldPreviewSchemaAttr[] {
    const subject = props.subjects.find((item) => item.id === subjectId);
    const typeName = subject?.type ?? schemaTypes.value[0]?.type ?? "";
    return schemaTypes.value.find((item) => item.type === typeName)?.attrs ?? [];
}

function opOptionsForAttr(path: string): WorldMutationOp[] {
    const attr = resolvePreviewAttrPath(builderAttrs.value, path);
    return opOptionsForPreviewAttr(attr);
}

function subjectIdForSchemaType(typeName: string): string {
    return props.subjects.find((subject) => subject.type === typeName)?.id ?? "";
}

function schemaTypeShortcutDisabled(typeName: string): boolean {
    return builderDisabled.value || !subjectIdForSchemaType(typeName);
}

function schemaTypeShortcutTitle(typeName: string): string {
    return subjectIdForSchemaType(typeName)
        ? `使用 ${typeName} subject 创建 mutation`
        : `当前 Project 还没有 ${typeName} subject`;
}

function refreshBuilderDefaultValue(): void {
    if (mutationBuilder.op === "remove") {
        mutationBuilder.value = "";
        return;
    }
    const attr = resolvePreviewAttrPath(builderAttrs.value, mutationBuilder.path);
    if (!attr) {
        return;
    }
    const value = defaultValueForPreviewAttr(attr, props.subjects);
    mutationBuilder.value = formatBuilderValue(value);
    syncObjectRowsFromBuilderValue();
}

function formatBuilderValue(value: JsonValue | undefined): string {
    return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function enumOptionsForAttr(attr: WorldPreviewSchemaAttr | null): Array<{label: string; value: string}> {
    return (attr?.enum ?? []).map((value) => {
        const formattedValue = formatJsonInputValue(value);
        return {
            label: formatBuilderValue(value),
            value: formattedValue,
        };
    });
}

function refOptionsForAttr(attr: WorldPreviewSchemaAttr | null): Array<{label: string; value: string}> {
    const refType = parseRefType(previewAttrValueType(attr));
    if (!refType) {
        return [];
    }
    return props.subjects
        .filter((subject) => subject.type === refType)
        .map((subject) => ({
            label: `${subject.name || subject.id} · ${subject.id}`,
            value: `subject://${subject.id}`,
        }));
}

function resolveBuilderValueMode(attr: WorldPreviewSchemaAttr | null, op: WorldMutationOp): BuilderValueMode {
    if (op === "remove") {
        return "hidden";
    }
    const valueType = previewAttrValueType(attr);
    if (attr?.enum?.length) {
        return "enum";
    }
    if (parseRefType(valueType)) {
        return "ref";
    }
    if (attr?.kind === "object") {
        return "object";
    }
    if (valueType === "object") {
        return "json";
    }
    if (valueType === "int" || valueType === "float") {
        return "number";
    }
    if (valueType === "bool") {
        return "boolean";
    }
    return "text";
}

/** 新增一行 object value 的 key/value 输入。 */
function addObjectBuilderRow(): void {
    if (builderDisabled.value) {
        return;
    }
    objectBuilderRows.value = [...objectBuilderRows.value, {key: "", value: "", enabled: true}];
    builderDraftDirty.value = true;
}

/** 删除一行 object value 输入，至少保留一行空输入。 */
function removeObjectBuilderRow(index: number): void {
    if (builderDisabled.value) {
        return;
    }
    const nextRows = objectBuilderRows.value.filter((_, rowIndex) => rowIndex !== index);
    objectBuilderRows.value = nextRows.length ? nextRows : [{key: "", value: "", enabled: true}];
    syncObjectRowsToBuilderValue();
    builderDraftDirty.value = true;
}

/** 更新 object 行后同步生成 JSON 字符串。 */
function updateObjectBuilderRow(index: number, patch: Partial<ObjectBuilderRow>): void {
    if (builderDisabled.value) {
        return;
    }
    objectBuilderRows.value = objectBuilderRows.value.map((row, rowIndex) => {
        if (rowIndex !== index) {
            return row;
        }
        const nextRow = {...row, ...patch};
        const nextKey = nextRow.key.trim();
        if (patch.key !== undefined && patch.value === undefined && !row.value.trim() && nextKey) {
            const attr = objectFieldAttr(nextKey);
            if (attr) {
                nextRow.value = defaultObjectFieldValue(attr);
            }
        }
        return nextRow;
    });
    syncObjectRowsToBuilderValue();
    builderDraftDirty.value = true;
}

function objectFieldAttr(rowKey: string): WorldPreviewSchemaAttr | null {
    const key = rowKey.trim();
    if (!key) {
        return null;
    }
    const fixedField = objectFieldEntries.value.find((entry) => entry.key === key)?.attr;
    if (fixedField) {
        return fixedField;
    }
    const attr = builderAttr.value;
    if (attr?.kind !== "object" || objectFieldEntries.value.length || !attr.itemType) {
        return null;
    }
    return {
        name: key,
        kind: attr.itemType === "object" ? "object" : "scalar",
        type: attr.itemType === "object" ? undefined : attr.itemType,
    };
}

function objectFieldValueMode(rowKey: string): BuilderValueMode {
    const mode = resolveBuilderValueMode(objectFieldAttr(rowKey), "replace");
    if (mode === "object") {
        return "json";
    }
    return mode === "hidden" ? "text" : mode;
}

function objectFieldEnumOptions(rowKey: string): Array<{label: string; value: string}> {
    return enumOptionsForAttr(objectFieldAttr(rowKey));
}

function objectFieldRefOptions(rowKey: string): Array<{label: string; value: string}> {
    return refOptionsForAttr(objectFieldAttr(rowKey));
}

/** 把 object key/value 行同步为 builder JSON 字符串。 */
function syncObjectRowsToBuilderValue(): void {
    if (builderValueMode.value !== "object") {
        return;
    }
    const parsedValue = parseObjectBuilderRows();
    mutationBuilder.value = JSON.stringify(parsedValue.ok ? parsedValue.value : {}, null, 2);
}

/** 解析 object value 行；key 为空的行会被忽略。 */
function parseObjectBuilderRows(): ReturnType<typeof parseLooseJsonValue> {
    const nextValue: {[key: string]: JsonValue} = {};
    for (const row of objectBuilderRows.value) {
        if (!row.enabled) {
            continue;
        }
        const key = row.key.trim();
        if (!key) {
            continue;
        }
        const parsedValue = parseLooseJsonValue(row.value);
        if (!parsedValue.ok) {
            return {ok: false, message: `object value.${key} 解析失败：${parsedValue.message}`};
        }
        if (objectFieldValueMode(key) === "json" && !isJsonObjectValue(parsedValue.value)) {
            return {ok: false, message: `object value.${key} 必须是 JSON object`};
        }
        nextValue[key] = parsedValue.value;
    }
    return {ok: true, value: nextValue};
}

/** 从 builder JSON 字符串恢复 object key/value 行，便于 schema shortcut 和切换 attr 后继续编辑。 */
function syncObjectRowsFromBuilderValue(): void {
    if (builderValueMode.value !== "object") {
        return;
    }
    const parsedValue = parseLooseJsonValue(mutationBuilder.value);
    const currentRecord = parsedValue.ok && isJsonObjectValue(parsedValue.value) ? parsedValue.value : null;
    if (objectFieldEntries.value.length) {
        objectBuilderRows.value = objectFieldEntries.value.map((entry) => ({
            key: entry.key,
            value: currentRecord && Object.prototype.hasOwnProperty.call(currentRecord, entry.key)
                ? formatBuilderValue(currentRecord[entry.key])
                : defaultObjectFieldValue(entry.attr),
            enabled: Boolean(currentRecord && Object.prototype.hasOwnProperty.call(currentRecord, entry.key)),
        }));
        syncObjectRowsToBuilderValue();
        return;
    }
    if (!currentRecord) {
        objectBuilderRows.value = [{key: "", value: "", enabled: true}];
        return;
    }
    const rows = Object.entries(currentRecord).map(([key, value]) => ({
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
        enabled: true,
    }));
    objectBuilderRows.value = rows.length ? rows : [{key: "", value: "", enabled: true}];
}

function defaultObjectFieldValue(attr: WorldPreviewSchemaAttr): string {
    return formatBuilderValue(defaultValueForPreviewAttr(attr, props.subjects));
}

function parseRefType(type: string | undefined): string | null {
    const match = /^ref\(([^)]+)\)$/.exec(type ?? "");
    return match?.[1] ?? null;
}

function attrToPointer(attr: string): string {
    return `/${attr.split(".").filter(Boolean).map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function defaultSliceMutations(subjectId: string): string {
    return JSON.stringify([defaultMutationForPreviewSubject(props.schema?.subjectTypes ?? [], props.subjects, subjectId)], null, 2);
}

/** 生成默认 patch 草稿，并让 Builder 表单与 textarea 保持同一个 subject/path/op。 */
function applyDefaultSliceMutation(subjectId: string): void {
    const mutation = defaultMutationForPreviewSubject(props.schema?.subjectTypes ?? [], props.subjects, subjectId);
    sliceForm.mutations = JSON.stringify([mutation], null, 2);
    mutationLoadIndex.value = "0";
    mutationBuilder.subjectId = mutation.subjectId;
    mutationBuilder.path = mutation.path;
    mutationBuilder.op = mutation.op;
    mutationBuilder.value = mutation.op === "remove" ? "" : formatBuilderValue(mutation.value);
    syncObjectRowsFromBuilderValue();
    builderDraftDirty.value = false;
}

function suggestedNewSliceTime(extraUsedTimes: string[] = []): string {
    const examples = props.schema?.calendar.examples ?? [];
    const usedTimes = [...(props.usedTimes ?? []), ...extraUsedTimes];
    const context = props.insertSliceContext;
    if (context?.anchorTime) {
        return suggestAdjacentPreviewTime(examples, usedTimes, context.anchorTime, context.direction);
    }
    if (usedTimes.length) {
        return suggestNextPreviewTime(examples, usedTimes);
    }
    return suggestSliceTime(examples);
}

function projectQuery(): {projectRoot: string} {
    return {projectRoot: props.projectRoot};
}

function serializeSliceForm(): string {
    return JSON.stringify({
        time: sliceForm.time,
        title: sliceForm.title,
        summary: sliceForm.summary,
        kind: sliceForm.kind,
        mutations: sliceForm.mutations,
        editingSliceId: editingSliceId.value,
    });
}

function markCleanSliceForm(): void {
    cleanSnapshot.value = serializeSliceForm();
}

watch(() => props.selectedSubjectId, (subjectId) => {
    if (!subjectId || mutationBuilder.subjectId === subjectId) {
        return;
    }
    if (!editingSliceId.value && hasDirtyDraft.value) {
        emit("notice", "当前编辑器有未保存草稿，已保留现有 mutations。");
        return;
    }
    if (!editingSliceId.value) {
        applyDefaultSliceMutation(subjectId);
        markCleanSliceForm();
    }
});

watch(() => props.schema, () => {
    const wasClean = !hasDirtyDraft.value;
    if (!sliceForm.time) {
        sliceForm.time = suggestedNewSliceTime();
    }
    if (wasClean && !editingSliceId.value) {
        sliceForm.time = suggestedNewSliceTime();
        applyDefaultSliceMutation(props.selectedSubjectId || mutationBuilder.subjectId || "world");
    }
    if (wasClean) {
        markCleanSliceForm();
    }
});

watch(() => props.usedTimes?.join("\u0000") ?? "", () => {
    const wasClean = !hasDirtyDraft.value;
    if (wasClean && !editingSliceId.value) {
        sliceForm.time = suggestedNewSliceTime();
        markCleanSliceForm();
    }
});

watch(hasDirtyDraft, (dirty) => {
    emit("dirtyChange", dirty);
}, {flush: "sync", immediate: true});

watch(() => mutationBuilder.subjectId, () => {
    const attrs = attrsForSubjectId(mutationBuilder.subjectId);
    if (attrs.length && !attrs.some((attr) => attrToPointer(attr.name) === mutationBuilder.path)) {
        mutationBuilder.path = attrs[0] ? attrToPointer(attrs[0].name) : mutationBuilder.path;
    }
    refreshBuilderDefaultValue();
});

watch(() => mutationBuilder.path, () => {
    const options = opOptionsForAttr(mutationBuilder.path);
    if (!options.includes(mutationBuilder.op)) {
        mutationBuilder.op = options[0] ?? "replace";
    }
    refreshBuilderDefaultValue();
});

watch(() => builderValueMode.value, (mode) => {
    if (mode === "object") {
        syncObjectRowsFromBuilderValue();
    }
});

watch(() => mutationLoadOptions.value.length, (length) => {
    if (length === 0) {
        mutationLoadIndex.value = "0";
        return;
    }
    const index = Number(mutationLoadIndex.value);
    if (!Number.isInteger(index) || index < 0 || index >= length) {
        mutationLoadIndex.value = String(clampMutationIndex(length, index));
    }
});

watch(() => props.loadSliceKey, () => {
    loadSelectedSlice();
});

watch(() => props.newSliceKey, (key) => {
    if (key > 0) {
        void clearEditMode();
    }
});

watch(() => props.insertSliceContext?.version ?? 0, (version) => {
    if (version > 0 && !editingSliceId.value) {
        sliceForm.time = suggestedNewSliceTime();
        markCleanSliceForm();
    }
});

defineExpose({
    /** 供父级 Workbench 在关闭前同步查询，避免事件 flush 时机导致草稿保护失效。 */
    hasUnsavedDraft: () => hasDirtyDraft.value,
});
</script>

<template>
    <section class="p-5">
        <WorldEngineMutationEditorHeader
            :has-selected-slice="Boolean(props.selectedSlice)"
            :saving="saving"
            :busy="props.busy ?? false"
            :editing-slice-id="editingSliceId"
            :has-dirty-draft="hasDirtyDraft"
            :pending-load-selected-slice="pendingLoadSelectedSlice"
            @load-selected-slice="loadSelectedSlice"
            @clear-edit-mode="void clearEditMode()"
            @discard-draft-and-load-selected-slice="discardDraftAndLoadSelectedSlice"
        />

        <div v-if="lastContinueSaveNotice" data-testid="slice-composer-continue-save-notice" class="mb-4 flex items-center gap-2 rounded-md border border-[var(--we-success-border)] bg-[var(--we-success-soft)] px-3 py-2 text-[12px] text-[var(--we-success)]">
            <span class="i-lucide-check-circle-2 h-4 w-4 shrink-0"></span>
            <span class="min-w-0 truncate">{{ lastContinueSaveNotice }}</span>
        </div>

        <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <WorldEngineSliceDraftForm
                v-model:time="sliceForm.time"
                v-model:title="sliceForm.title"
                v-model:kind="sliceForm.kind"
                v-model:summary="sliceForm.summary"
                v-model:mutations="sliceForm.mutations"
                :validation-ok="sliceValidation.ok"
                :validation-message="sliceValidation.ok ? '' : sliceValidation.message"
                :can-submit="canSubmit"
                :saving="saving"
                :editing-slice-id="editingSliceId"
                :action-label="sliceActionLabel"
                :show-continue-action="!editingSliceId"
                :submit-action="submitSlice"
                :submit-and-continue-action="submitSliceAndContinue"
                @submit="submitSlice"
                @submit-and-continue="submitSlice({continueAfterSave: true})"
            >
                <WorldEngineMutationBuilder
                    :disabled="builderDisabled"
                    :builder="mutationBuilder"
                    :subjects="props.subjects"
                    :selected-subject-type-label="selectedSubject?.type ?? 'subject'"
                    :builder-attrs="builderAttrs"
                    :builder-has-schema-attr="builderHasSchemaAttr"
                    :builder-op-options="builderOpOptions"
                    :builder-value-hint="builderValueHint"
                    :builder-value-mode="builderValueMode"
                    :enum-value-options="enumValueOptions"
                    :ref-value-options="refValueOptions"
                    :object-builder-rows="objectBuilderRows"
                    :object-has-fixed-fields="objectHasFixedFields"
                    :object-field-value-mode="objectFieldValueMode"
                    :object-field-enum-options="objectFieldEnumOptions"
                    :object-field-ref-options="objectFieldRefOptions"
                    :mutation-load-options="mutationLoadOptions"
                    :mutation-load-index="mutationLoadIndex"
                    :state-result="props.stateResult"
                    :add-mutation-action="addBuilderMutation"
                    :delete-selected-mutation-action="deleteSelectedBuilderMutation"
                    :duplicate-selected-mutation-action="duplicateSelectedBuilderMutation"
                    :insert-after-selected-mutation-action="insertAfterSelectedBuilderMutation"
                    :replace-selected-mutation-action="replaceSelectedBuilderMutation"
                    :update-builder-field-action="updateBuilderField"
                    @update-builder-field="updateBuilderField"
                    @update-object-row="updateObjectBuilderRow"
                    @update-mutation-load-index="updateMutationLoadIndex"
                    @add-object-row="addObjectBuilderRow"
                    @remove-object-row="removeObjectBuilderRow"
                    @load-mutation="loadMutationToBuilder"
                    @add-mutation="addBuilderMutation"
                    @insert-after-selected-mutation="insertAfterSelectedBuilderMutation"
                    @duplicate-selected-mutation="duplicateSelectedBuilderMutation"
                    @replace-selected-mutation="replaceSelectedBuilderMutation"
                    @delete-selected-mutation="deleteSelectedBuilderMutation"
                    @move-selected-mutation="moveSelectedBuilderMutation"
                />
            </WorldEngineSliceDraftForm>

            <aside class="space-y-3">
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                    <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Schema Shortcuts</div>
                    <div v-for="type in schemaTypes" :key="`editor:${type.type}`" class="mb-3 last:mb-0">
                        <div class="mb-1 text-[12px] font-medium text-[var(--text-main)]">{{ type.type }}</div>
                        <div class="flex flex-wrap gap-1">
                            <button v-for="attr in type.attrs" :key="`editor:${type.type}:${attr.name}`" type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="schemaTypeShortcutDisabled(type.type)" :title="schemaTypeShortcutTitle(type.type)" @click="fillMutation(type.type, attr)">
                                {{ attr.name }}
                            </button>
                        </div>
                    </div>
                </div>
            </aside>
        </div>
    </section>
</template>
