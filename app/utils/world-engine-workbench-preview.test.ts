import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import type {SubjectStateDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSnapshot,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";
import {
    cloneMockWorkbenchSlices,
    mockWorkbenchSchema,
    mockWorkbenchSubjects,
} from "nbook/app/utils/world-engine-workbench-preview-mock";
import {
    applyWorkbenchPreviewMutationListPatch,
    applyWorkbenchPreviewMutationPatch,
    reduceWorkbenchPreviewSnapshots,
} from "nbook/app/utils/world-engine-workbench-preview-state";
import {
    formatWorkbenchPreviewValue,
    parseWorkbenchPreviewMutationValue,
} from "nbook/app/utils/world-engine-workbench-preview-value";
import {
    buildWorkbenchPreviewFiltersAfterSavedEdit,
    matchesWorkbenchPreviewSliceFilter,
} from "nbook/app/utils/world-engine-workbench-preview-filter";
import {isWorldWorkbenchSubjectSystemMaintenanceSlice} from "nbook/app/utils/world-engine-workbench-slice-classifier";

const pagePath = fileURLToPath(new URL("../pages/world-engine.workbench-preview.vue", import.meta.url));
const workbenchDialogPath = fileURLToPath(new URL("../components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue", import.meta.url));
const mockPath = fileURLToPath(new URL("./world-engine-workbench-preview-mock.ts", import.meta.url));
const stateUtilPath = fileURLToPath(new URL("./world-engine-workbench-preview-state.ts", import.meta.url));
const valueUtilPath = fileURLToPath(new URL("./world-engine-workbench-preview-value.ts", import.meta.url));
const filterUtilPath = fileURLToPath(new URL("./world-engine-workbench-preview-filter.ts", import.meta.url));
const realUtilPath = fileURLToPath(new URL("./world-engine-workbench-real.ts", import.meta.url));
const sidebarPath = fileURLToPath(new URL("../components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSidebar.vue", import.meta.url));
const sliceListPath = fileURLToPath(new URL("../components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceList.vue", import.meta.url));
const sliceCardPath = fileURLToPath(new URL("../components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceCard.vue", import.meta.url));
const inspectorPath = fileURLToPath(new URL("../components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewInspector.vue", import.meta.url));
const editorPath = fileURLToPath(new URL("../components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewMutationEditor.vue", import.meta.url));
const patchEditorPath = fileURLToPath(new URL("../components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewPatchEditor.vue", import.meta.url));
const sliceComposerPath = fileURLToPath(new URL("../components/novel-ide/world-engine/WorldEngineMutationEditor.vue", import.meta.url));
const valueInputPath = fileURLToPath(new URL("../components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewValueInput.vue", import.meta.url));
const typesPath = fileURLToPath(new URL("../components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types.ts", import.meta.url));
const comboboxPath = fileURLToPath(new URL("../components/common/form/Combobox.vue", import.meta.url));
const formNumberInputPath = fileURLToPath(new URL("../components/common/form/FormNumberInput.vue", import.meta.url));
const formSelectPath = fileURLToPath(new URL("../components/common/form/FormSelect.vue", import.meta.url));
const segmentedControlPath = fileURLToPath(new URL("../components/common/form/SegmentedControl.vue", import.meta.url));
const lowCodeRadioPath = fileURLToPath(new URL("../components/common/low-code-form/LowCodeRadioField.vue", import.meta.url));
const zhLocalePath = fileURLToPath(new URL("../i18n/locales/zh-CN.ts", import.meta.url));
const enLocalePath = fileURLToPath(new URL("../i18n/locales/en-US.ts", import.meta.url));

function removedToken(...parts: string[]): string {
    return parts.join("");
}

async function readSource(path: string): Promise<string> {
    return (await readFile(path, "utf-8")).replace(/\r\n/g, "\n");
}

function findSnapshotSubject(snapshots: WorldWorkbenchPreviewSnapshot[], sliceId: string, subjectId: string): SubjectStateDto {
    const snapshot = snapshots.find((item) => item.sliceId === sliceId);
    const subject = snapshot?.subjects.find((item) => item.subjectId === subjectId);
    expect(subject).toBeTruthy();
    return subject as SubjectStateDto;
}

describe("World Engine Workbench preview redesign", () => {
    it("保留 mock 数据源和三栏 preview 入口", async () => {
        const page = await readSource(pagePath);
        const workbenchDialog = await readSource(workbenchDialogPath);
        const mock = await readSource(mockPath);
        const stateUtil = await readSource(stateUtilPath);
        const valueUtil = await readSource(valueUtilPath);
        const filterUtil = await readSource(filterUtilPath);
        const realUtil = await readSource(realUtilPath);
        const sidebar = await readSource(sidebarPath);
        const sliceList = await readSource(sliceListPath);
        const sliceCard = await readSource(sliceCardPath);
        const inspector = await readSource(inspectorPath);
        const editor = await readSource(editorPath);
        const patchEditor = await readSource(patchEditorPath);
        const sliceComposer = await readSource(sliceComposerPath);
        const valueInput = await readSource(valueInputPath);
        const types = await readSource(typesPath);
        const combobox = await readSource(comboboxPath);
        const formNumberInput = await readSource(formNumberInputPath);
        const formSelect = await readSource(formSelectPath);
        const segmentedControl = await readSource(segmentedControlPath);
        const lowCodeRadio = await readSource(lowCodeRadioPath);
        const zhLocale = await readSource(zhLocalePath);
        const enLocale = await readSource(enLocalePath);

        expect(page).toContain("World Engine Workbench Preview");
        expect(page).toContain("WorldEngineWorkbenchPreviewSidebar");
        expect(page).toContain("WorldEngineWorkbenchPreviewSliceList");
        expect(page).toContain("WorldEngineWorkbenchPreviewMutationEditor");
        expect(page).toContain("WorldEngineWorkbenchPreviewInspector");
        expect(page).toContain("world-engine-workbench-preview world-engine-workbench-theme");
        expect(page).toContain("useIdeTheme");
        expect(page).toContain("mountThemeHost");
        expect(page).toContain("storeToRefs");
        expect(page).toContain("themeHostRef");
        expect(page).not.toContain("--we-bg-canvas: #f6f8f7");
        expect(page).not.toContain("--we-bg-panel: #ffffff");
        expect(page).not.toContain("--we-accent: #078768");
        expect(page).not.toContain("--bg-main: var(--we-bg-canvas)");
        expect(page).not.toContain("--accent-main: var(--we-accent)");
        expect(page).toContain("mock 数据源");
        expect(page).toContain("mockWorkbenchSubjectSystemSummaries");
        expect(page).toContain(":subject-system-summaries=\"mockWorkbenchSubjectSystemSummaries\"");
        expect(page).toContain("function openMockWorkspacePath(path: string): void");
        expect(page).toContain("mock 预览不会打开真实文件");
        expect(page).toContain("function commitMockSubjectEventProposal(proposal: WorldWorkbenchSubjectFileProposal): void");
        expect(page).toContain("mock 预览不会写入 events.jsonl");
        expect(page).toContain("@commit-subject-event-proposal=\"commitMockSubjectEventProposal\"");
        expect(page).toContain("@open-workspace-path=\"openMockWorkspacePath\"");
        expect(page.match(/@open-workspace-path="openMockWorkspacePath"/g)?.length).toBeGreaterThanOrEqual(2);
        expect(page).toContain("inspectorVisible");
        expect(page).toContain("v-show=\"inspectorVisible\"");
        expect(page).toContain("applySlicePatch");
        expect(page).toContain("applyMutationValuePatch");
        expect(page).toContain("applyWorkbenchPreviewMutationPatch");
        expect(page).toContain("reduceWorkbenchPreviewSnapshots");
        expect(page).toContain("resetMockData");
        expect(page).toContain("resetVersion");
        expect(page).toContain("subjectFilterMode");
        expect(page).toContain("isSubjectFilterMode");
        expect(page).toContain("sliceSearch");
        expect(page).toContain("sliceKindFilter");
        expect(page).toContain("sliceHealthFilter");
        expect(page).toContain("isSliceHealthFilter");
        expect(page).toContain("filter === \"draft\"");
        expect(page).toContain("focusedSubjectId");
        expect(page).toContain("focusSubject");
        expect(page).toContain("function focusSubjectContext(subjectId: string): void");
        expect(page).toContain("function clearSubjectContext(): void");
        expect(page).toContain(":focused-subject-id=\"focusedSubjectId\"");
        expect(page).toContain("@focus-subject-context=\"focusSubjectContext\"");
        expect(page).toContain("@clear-subject-context=\"clearSubjectContext\"");
        expect(sidebar).toContain("const activeSubjectContextId = computed(() => props.focusedSubjectId && subjectSystemSummaryMap.value.has(props.focusedSubjectId) ? props.focusedSubjectId : \"\");");
        expect(sidebar).toContain("v-if=\"activeSubjectContextId\"");
        expect(sidebar).toContain(":aria-pressed=\"activeSubjectContextId === subject.id\"");
        expect(sidebar).toContain("{{ activeSubjectContextId === subject.id ? \"语境中\" : \"语境\" }}");
        expect(page).toContain("focusReviewIssue");
        expect(page).toContain("highlightedMutationFocus");
        expect(page).toContain("clearMutationFocus");
        expect(page).toContain("removeSubjectFilter");
        expect(page).toContain("previousSnapshotSubjects");
        expect(page).toContain("localDraftStorageKey");
        expect(page).toContain("restoreLocalDraft");
        expect(page).toContain("persistLocalDraft");
        expect(page).toContain("isLocalDraft");
        expect(page).toContain("localDraftSuppressed");
        expect(page).toContain("subjectStats");
        expect(page).toContain("WorldWorkbenchPreviewSubjectStat");
        expect(page).toContain("reviewQueueItems");
        expect(page).toContain("currentReviewQueueIndex");
        expect(page).toContain("WorldWorkbenchPreviewReviewQueueItem");
        expect(page).toContain("issueTriageStates");
        expect(page).toContain("reviewQueueMode");
        expect(page).toContain("isReviewQueueMode");
        expect(page).toContain("updateIssueTriage");
        expect(page).toContain("reviewTriageSummary");
        expect(page).toContain("sliceReviewSummaries");
        expect(page).toContain("WorldWorkbenchPreviewSliceReviewSummary");
        expect(page).toContain("worldViewFilterParts");
        expect(page).toContain("const modeLabel = subjectFilterMode.value === \"all\" ? \"全部 subject\" : \"任一 subject\";");
        expect(page).toContain([
            "function clearSubjectFilter(): void {",
            "    selectedSubjectIds.value = [];",
            "    subjectFilterMode.value = \"any\";",
            "}",
        ].join("\n"));
        expect(page).toContain("subjectFilterMode.value = selectedSubjectIds.value.length && isSubjectFilterMode(draft.subjectFilterMode) ? draft.subjectFilterMode : \"any\";");
        expect(page).toContain([
            "function removeSubjectFilter(subjectId: string): void {",
            "    selectedSubjectIds.value = selectedSubjectIds.value.filter((id) => id !== subjectId);",
            "    if (!selectedSubjectIds.value.length) {",
            "        subjectFilterMode.value = \"any\";",
            "    }",
            "}",
        ].join("\n"));
        expect(page).toContain("当前视角");
        expect(page).toContain("sliceHealthFilterLabel");
        expect(page).toContain("shortFilterText");
        expect(page).toContain("draft.version === 4");
        expect(page).toContain("neuro-book:world-engine-workbench-preview:draft:v4");
        expect(page).toContain("defaultSidebarWidth");
        expect(page).toContain("defaultInspectorWidth");
        expect(page).toContain("const defaultSidebarWidth = 320;");
        expect(page).toContain("const defaultInspectorWidth = 420;");
        expect(page).toContain("defaultMutationEditorHeight");
        expect(page).toContain("sidebarWidth = ref(defaultSidebarWidth)");
        expect(page).toContain("inspectorWidth = ref(defaultInspectorWidth)");
        expect(page).toContain("mutationEditorHeight = ref(defaultMutationEditorHeight)");
        expect(page).toContain("validPanelSize");
        expect(page).toContain("draft.sidebarWidth, 220, 420, defaultSidebarWidth");
        expect(page).toContain("draft.inspectorWidth, 300, 560, defaultInspectorWidth");
        expect(page).toContain("draft.mutationEditorHeight, 160, 520, defaultMutationEditorHeight");
        expect(page).toContain("sidebarWidth: sidebarWidth.value");
        expect(page).toContain("inspectorWidth: inspectorWidth.value");
        expect(page).toContain("mutationEditorHeight: mutationEditorHeight.value");
        expect(page).toContain("typeof draft.sidebarWidth === \"number\"");
        expect(page).toContain("typeof draft.inspectorWidth === \"number\"");
        expect(page).toContain("typeof draft.mutationEditorHeight === \"number\"");
        expect(page).toContain(":width=\"sidebarWidth\"");
        expect(page).toContain(":width=\"inspectorWidth\"");
        expect(page).toContain(":height=\"mutationEditorHeight\"");
        expect(page).toContain("@update:width=\"sidebarWidth = $event\"");
        expect(page).toContain("@update:width=\"inspectorWidth = $event\"");
        expect(page).toContain("@update:height=\"mutationEditorHeight = $event\"");
        expect(page).toContain("world-inspector-restore-rail");
        expect(page).toContain("toggleInspectorPanel");
        expect(page).toContain("@click=\"toggleInspectorPanel\"");
        expect(page).toContain("浏览器临时 mock");
        expect(page).toContain("已恢复浏览器草稿");
        expect(page).toContain("localStorage.removeItem(localDraftStorageKey)");
        expect(page).toContain("mutationEditorCollapsed = ref(true)");
        expect(page).toContain("metadataDraftSummaries");
        expect(page).toContain("WorldWorkbenchPreviewMetadataDraftSummary");
        expect(page).toContain("update-metadata-drafts");
        expect(page).toContain("metadataDraftSliceCount");
        expect(page).toContain("valueDraftSliceCount");
        expect(page).toContain("draftSliceIds");
        expect(page).toContain("totalDraftSliceCount");
        expect(page).toContain("draftSummaryTitle");
        expect(page).toContain("inspectorButtonTitle");
        expect(page).toContain("world-workbench-inspector-toggle");
        expect(page).toContain("world-workbench-draft-summary");
        expect(page).toContain("showAllDraftSlices");
        expect(page).toContain("worldEngine.workbenchPreview.drafts");
        expect(page).toContain("meta {{ metadataDraftSliceCount }}");
        expect(page).toContain("value {{ valueDraftSliceCount }}");
        expect(page).toContain("metadata 草稿");
        expect(page).toContain("valueDraftSummaries");
        expect(page).toContain("WorldWorkbenchPreviewValueDraftSummary");
        expect(page).toContain("update-value-drafts");
        expect(page).toContain("openDraftSurfacesForSlice");
        expect(page).toContain("openInspectorPanel");
        expect(page).toContain("expandMutationEditorPanel");
        expect(page).toContain(":open-inspector-panel=\"openInspectorPanel\"");
        expect(page).toContain("const subjectFileProposalFocusVersion = ref(0);");
        expect(page).toContain("function openInspectorPanel(target?: \"subject-file-proposals\"): void");
        expect(page).toContain("function toggleInspectorPanel(): void");
        expect(page).toContain("openInspectorPanel(selectedSliceSubjectFileProposalCount.value ? \"subject-file-proposals\" : undefined);");
        expect(page).toContain("selectedSliceSubjectFileProposalCount");
        expect(page).toContain("inspectorButtonAttentionClass");
        expect(page).toContain("data-testid=\"world-workbench-inspector-proposal-count\"");
        expect(page).toContain("data-testid=\"world-inspector-restore-proposal-count\"");
        expect(page).toContain("subjectFileProposalFocusVersion.value += 1;");
        expect(page).toContain(":subject-file-proposal-focus-version=\"subjectFileProposalFocusVersion\"");
        expect(page).toContain("metadataDraftSummaries.value.some((draft) => draft.sliceId === firstDraftSliceId)");
        expect(page).toContain("valueDraftSummaries.value.some((draft) => draft.sliceId === firstDraftSliceId)");
        expect(page).toContain(":open-draft-inspector=\"openInspectorPanel\"");
        expect(page).toContain(":expand-draft-editor=\"expandMutationEditorPanel\"");
        expect(page).toContain("sliceHealthFilter.value !== \"draft\"");
        expect(page).toContain("inspectorVisible.value = true");
        expect(page).toContain("mutationEditorCollapsed.value = false");

        expect(mock).toContain("mockWorkbenchSchema");
        expect(mock).toContain("mockWorkbenchSubjects");
        expect(mock).toContain("mockWorkbenchSubjectSystemSummaries");
        expect(mock).toContain("mockWorkbenchSlices");
        expect(mock).toContain("mockWorkbenchSnapshots");
        expect(mock).toContain("world");
        expect(mock).toContain("location");
        expect(mock).toContain("character");
        expect(mock).toContain("item");
        expect(mock).toContain("backstory");
        expect(mock).toContain("remove/append 编辑路径");
        expect(mock).toContain("masked");
        expect(mock).toContain("旧剑旧伤补充可能遮蔽艾莉娜此前对东塔线索的理解");
        expect(mock).not.toContain(removedToken("cor", "rection"));
        expect(mock).toContain("findMockSnapshot");
        expect(stateUtil).toContain("applyWorkbenchPreviewMutationPatch");
        expect(stateUtil).toContain("reduceWorkbenchPreviewSnapshots");
        expect(stateUtil).toContain("schema default");
        expect(stateUtil).toContain("replace");
        expect(stateUtil).toContain("increment");
        expect(stateUtil).toContain("append");
        expect(valueUtil).toContain("parseWorkbenchPreviewMutationValue");
        expect(valueUtil).toContain("formatWorkbenchPreviewValue");
        expect(filterUtil).toContain("matchesWorkbenchPreviewSliceFilter");
        expect(filterUtil).toContain("matchesWorkbenchPreviewSubjectFilter");
        expect(filterUtil).toContain("matchesWorkbenchPreviewKindFilter");
        expect(filterUtil).toContain("matchesWorkbenchPreviewHealthFilter");
        expect(filterUtil).toContain("metadataDraftCount");
        expect(filterUtil).toContain("valueDraftCount");
        expect(filterUtil).toContain("matchesWorkbenchPreviewKeywordFilter");
        expect(filterUtil).toContain("buildWorkbenchPreviewFiltersAfterSavedEdit");
        expect(realUtil).toContain("sourceLabel: sourceKind === \"direct-mutation\" ? \"直接触及该主体\" : \"当前主体语境下的 world 事件建议\"");
        expect(realUtil).toContain("`source: ${proposal.sourceLabel}`");
        expect(realUtil).toContain("`sliceId: ${proposal.sliceId}`");
        expect(realUtil).toContain("sliceId: input.slice.id");
        expect(formSelect).toContain("type SelectSize = \"default\" | \"sm\"");
        expect(formSelect).toContain("size?: SelectSize");
        expect(formSelect).toContain(":style=\"panelStyle\"");
        expect(formSelect).not.toContain("panelSizeClass");
        expect(combobox).toContain("type ComboboxSize = \"default\" | \"sm\"");
        expect(combobox).toContain("autocomplete=\"off\"");
        expect(combobox).toContain("disabled?: boolean");
        expect(formNumberInput).toContain("type NumberInputSize = \"default\" | \"sm\"");
        expect(formNumberInput).toContain("inputmode=\"decimal\"");
        expect(formNumberInput).toContain("stepValueBy");
        expect(formNumberInput).toContain("i-lucide-chevron-up");
        expect(segmentedControl).toContain("SegmentedControlOption");
        expect(segmentedControl).toContain("SegmentedControlValue");
        expect(segmentedControl).toContain("count?: number | string");
        expect(segmentedControl).toContain("disabled?: boolean");
        expect(segmentedControl).toContain("title?: string");
        expect(segmentedControl).toContain("tone?: SegmentedControlTone");
        expect(segmentedControl).toContain("(e: \"update:modelValue\", value: SegmentedControlValue): void");
        expect(segmentedControl).toContain(":aria-pressed=\"isSelected(option)\"");
        expect(segmentedControl).toContain(":data-testid=\"option.testId\"");
        expect(segmentedControl).toContain("option.disabled");
        expect(lowCodeRadio).toContain("SegmentedControl");
        expect(lowCodeRadio).toContain("SegmentedControlValue");
        expect(lowCodeRadio).toContain("props.field.options.map");

        expect(sidebar).toContain("Schema");
        expect(sidebar).toContain("const schemaSourcePath = \"world-engine/schema/index.ts\";");
        expect(sidebar).toContain("const calendarSourcePath = \"world-engine/calendar.ts\";");
        expect(sidebar).toContain("(e: \"openWorkspacePath\", path: string): void;");
        expect(sidebar).toContain("@click=\"emit('openWorkspacePath', schemaSourcePath)\"");
        expect(sidebar).toContain("@click=\"emit('openWorkspacePath', calendarSourcePath)\"");
        expect(sidebar).toContain("function subjectSystemFilePath");
        expect(sidebar).toContain("function openSubjectSystemFile");
        expect(sidebar).toContain("title=\"打开 subject.md\"");
        expect(sidebar).toContain("title=\"打开 events.jsonl\"");
        expect(sidebar).toContain("title=\"打开 memory.jsonl\"");
        expect(sidebar).toContain("title=\"打开 state.md\"");
        expect(sidebar).toContain("{{ schemaSourcePath }}");
        expect(sidebar).toContain("{{ calendarSourcePath }}");
        expect(sidebar).toContain("Subjects");
        expect(sidebar).toContain("focusedSubjectId?: string;");
        expect(sidebar).toContain("(e: \"clearSubjectContext\"): void;");
        expect(sidebar).toContain("function clearSubjectContext(): void");
        expect(sidebar).toContain("emit(\"clearSubjectContext\");");
        expect(sidebar).toContain("清语境");
        expect(sidebar).toContain("语境中");
        expect(sidebar).toContain(":aria-pressed=\"activeSubjectContextId === subject.id\"");
        expect(sidebar).toContain("清空主体文件建议语境，不改变 timeline 过滤");
        expect(sidebar).toContain("FormSelect");
        expect(sidebar).toContain("<FormSelect v-model=\"selectedType\"");
        expect(sidebar).not.toContain("<select v-model=\"selectedType\"");
        expect(sidebar).toContain("toggleSubject");
        expect(sidebar).toContain("整体世界");
        expect(sidebar).toContain("清空过滤");
        expect(sidebar).toContain("toggleCollapsed");
        expect(sidebar).not.toContain("py-3 pr-11");
        expect(sidebar).toContain("resetKey");
        expect(sidebar).toContain("subjectStats");
        expect(sidebar).toContain("subjectStatMap");
        expect(sidebar).toContain("valueDraftSummaries");
        expect(sidebar).toContain("subjectDraftCountMap");
        expect(sidebar).toContain("draftSubjectCount");
        expect(sidebar).toContain("subjectDraftCount");
        expect(sidebar).toContain("activeSubjectCount");
        expect(sidebar).toContain("openReviewSubjectCount");
        expect(sidebar).toContain("doneReviewSubjectCount");
        expect(sidebar).toContain("world-sidebar-collapsed-summary");
        expect(sidebar).toContain("useResizablePanel");
        expect(sidebar).toContain("resizeHandleRef");
        expect(sidebar).toContain("panelStyle");
        expect(sidebar).toContain("isResizing");
        expect(sidebar).toContain("update:width");
        expect(sidebar).toContain("props.width");
        expect(sidebar).toContain("minSize: 220");
        expect(sidebar).toContain("maxSize: 420");
        expect(sidebar).toContain("edge: \"right\"");
        expect(sidebar).toContain("onResize: (width) => emit(\"update:width\", width)");
        expect(sidebar).toContain("onResizeEnd: (width) => emit(\"update:width\", width)");
        expect(sidebar).toContain("worldEngine.workbenchPreview.activeSubjects");
        expect(sidebar).toContain("worldEngine.workbenchPreview.selectedSubjects");
        expect(sidebar).toContain("worldEngine.workbenchPreview.subjectsWithOpenReviewIssues");
        expect(sidebar).toContain("worldEngine.workbenchPreview.subjectsWithValueDrafts");
        expect(sidebar).toContain("SubjectReviewFilter");
        expect(sidebar).toContain("SegmentedControl");
        expect(sidebar).toContain("subjectReviewFilterOptions");
        expect(sidebar).toContain("updateSubjectReviewFilter");
        expect(sidebar).toContain("subjectReviewFilter");
        expect(sidebar).toContain("matchesReviewFilter");
        expect(sidebar).toContain("setSubjectReviewFilter");
        expect(sidebar).toContain("clearSubjectReviewFilter");
        expect(sidebar).toContain("subjectReviewFilterLabel");
        expect(sidebar).toContain("subjectReviewTitle");
        expect(sidebar).toContain(":model-value=\"subjectReviewFilter\"");
        expect(sidebar).toContain(":options=\"subjectReviewFilterOptions\"");
        expect(sidebar).toContain("size=\"xs\"");
        expect(sidebar).toContain(":aria-pressed=\"selectedSubjectSet.has(subject.id)\"");
        expect(sidebar).toContain("左栏筛选");
        expect(sidebar).toContain("latestTime");
        expect(sidebar).toContain("mutationCount");
        expect(sidebar).toContain("issueCount");
        expect(sidebar).toContain("openIssueCount");
        expect(sidebar).toContain("doneIssueCount");
        expect(sidebar).toContain("confirmedIssueCount");
        expect(sidebar).toContain("ignoredIssueCount");
        expect(sidebar).toContain("confirmed");
        expect(sidebar).toContain("ignored");
        expect(sidebar).toContain("active");
        expect(sidebar).toContain("open");
        expect(sidebar).toContain("done");
        expect(sidebar).toContain("draft");
        expect(sidebar).toContain("worldEngine.workbenchPreview.valueDraftSubjects");
        expect(sidebar).toContain("slice metadata 草稿请使用中间 timeline 的 draft 过滤");
        expect(sidebar).toContain("worldEngine.workbenchPreview.valueCountShort");
        expect(sidebar).toContain("worldEngine.workbenchPreview.valueDraftCountTitle");
        expect(sidebar).not.toContain("worldEngine.workbenchPreview.attrCount");
        expect(sidebar).toContain("'border-[var(--we-border)] bg-[var(--we-bg-panel)] hover:border-[var(--we-border-strong)] hover:bg-[var(--we-bg-hover)]'");
        expect(sidebar).not.toContain("'border-transparent hover:border-[var(--we-border)] hover:bg-[var(--we-bg-hover)]'");

        expect(sliceList).toContain("WorldWorkbenchPreviewSubjectFilterMode");
        expect(sliceList).toContain("WorldWorkbenchPreviewSliceHealthFilter");
        expect(sliceList).toContain("WorldWorkbenchPreviewReviewQueueItem");
        expect(sliceList).toContain("SegmentedControl");
        expect(sliceList).toContain("SegmentedControlOption");
        expect(sliceList).toContain("SegmentedControlValue");
        expect(sliceList).toContain("matchesWorkbenchPreviewSliceFilter");
        expect(sliceList).toContain("busy?: boolean;");
        expect(sliceList).toContain("updateSubjectFilterMode");
        expect(sliceList).toContain("updateSliceSearch");
        expect(sliceList).toContain("updateSliceKindFilter");
        expect(sliceList).toContain("updateSliceHealthFilter");
        expect(sliceList).toContain("disabled: props.busy");
        expect(sliceList).toContain("function clearKindAndHealthFilters(): void");
        expect(sliceList).toContain("function toggleMaintenanceSlices(): void");
        expect(sliceList).toContain("watch(filteredSlices, (nextSlices) => {\n    if (props.busy) {");
        expect(sliceList).toContain(":disabled=\"props.busy || !previousVisibleSlice\"");
        expect(sliceList).toContain(":disabled=\"props.busy || !nextVisibleSlice\"");
        expect(sliceList).toContain(":disabled=\"props.busy\"");
        expect(sliceList).toContain("<FormInput :model-value=\"props.sliceSearch\" type=\"search\" :placeholder=\"t('worldEngine.workbenchPreview.searchSlicePlaceholder')\" :disabled=\"props.busy\"");
        expect(sliceList).toContain("resetKey");
        expect(sliceList).toContain("sliceKindFilter");
        expect(sliceList).toContain("sliceHealthFilter");
        expect(sliceList).toContain("showMaintenanceSlices");
        expect(sliceList).toContain("hiddenMaintenanceSliceCount");
        expect(sliceList).toContain("slice-list-maintenance-toggle");
        expect(sliceList).toContain("维护切片");
        expect(sliceList).toContain("isWorldWorkbenchSubjectSystemMaintenanceSlice");
        expect(sliceList).toContain("sliceReviewSummaryMap");
        expect(sliceList).toContain("reviewQueueItemsBySlice");
        expect(sliceList).toContain("focusReviewIssue");
        expect(sliceList).toContain("metadataDraftSummaries");
        expect(sliceList).toContain("metadataDraftCountMap");
        expect(sliceList).toContain("metadataDraftSummaryMap");
        expect(sliceList).toContain("metadata-draft-count");
        expect(sliceList).toContain("metadata-draft-summary");
        expect(sliceList).toContain("valueDraftSummaries");
        expect(sliceList).toContain("valueDraftCountMap");
        expect(sliceList).toContain("value-draft-count");
        expect(sliceList).toContain("draftCountForSlice");
        expect(sliceList).toContain("任一 subject");
        expect(sliceList).toContain("全部 subject");
        expect(sliceList).toContain("activeFilterChips");
        expect(sliceList).toContain("WorkbenchPreviewFilterChip");
        expect(sliceList).toContain("WorkbenchPreviewResultStats");
        expect(sliceList).toContain("WorkbenchPreviewDraftQueueItem");
        expect(sliceList).toContain("draftQueueItems");
        expect(sliceList).toContain("focusDraftQueueItem");
        expect(sliceList).toContain("showDraftSlices");
        expect(sliceList).toContain("openInspectorPanel: (target?: \"subject-file-proposals\") => void;");
        expect(sliceList).toContain("openSubjectFileProposals(sliceId: string, subjectId: string)");
        expect(sliceList).toContain("emit(\"focusSubject\", subjectId);");
        expect(sliceList).toContain("props.openInspectorPanel(\"subject-file-proposals\");");
        expect(sliceList).toContain("openDraftInspector");
        expect(sliceList).toContain("expandDraftEditor");
        expect(sliceList).toContain("subjectSystemSummaries?: WorldWorkbenchPreviewSubjectSystemSummary[]");
        expect(sliceList).toContain(":subject-system-summaries=\"props.subjectSystemSummaries ?? []\"");
        expect(sliceList).toContain("Draft Queue");
        expect(sliceList).toContain("slice-list-draft-queue");
        expect(sliceList).toContain("slice-list-draft-queue-item");
        expect(sliceList).toContain("查看草稿切片");
        expect(sliceList).toContain("清空 search / kind / subject 过滤");
        expect(sliceList).toContain("displayTitle");
        expect(sliceList).toContain("displayTime");
        expect(sliceList).toContain("preview");
        expect(sliceList).toContain("metadataDraftCount");
        expect(sliceList).toContain("valueDraftCount");
        expect(sliceList).toContain("collectResultStats");
        expect(sliceList).toContain("statusShortcutSlices");
        expect(sliceList).toContain("statusShortcutStats");
        expect(sliceList).toContain("sliceHealthFilter: \"all\"");
        expect(sliceList).toContain("kindShortcutSlices");
        expect(sliceList).toContain("kindShortcutCountMap");
        expect(sliceList).toContain("subjectFilterModeOptions");
        expect(sliceList).toContain("kindFilterOptions");
        expect(sliceList).toContain("statusFilterOptions");
        expect(sliceList).toContain("sliceKindFilter: \"all\"");
        expect(sliceList).toContain("data-testid=\"slice-list-filter-toolbar\"");
        expect(sliceList).toContain("rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1.5");
        expect(sliceList).toContain("font-mono text-[10px] uppercase tracking-[0.12em]");
        expect(sliceList).toContain("statusShortcutStats.value.openSlices");
        expect(sliceList).toContain("statusShortcutStats.value.doneSlices");
        expect(sliceList).toContain("statusShortcutStats.value.cleanSlices");
        expect(sliceList).toContain("statusShortcutStats.value.draftSlices");
        expect(sliceList).toContain("scopeLabel");
        expect(sliceList).toContain("currentVisibleSliceIndex");
        expect(sliceList).toContain("previousVisibleSlice");
        expect(sliceList).toContain("nextVisibleSlice");
        expect(sliceList).toContain("visibleSlicePositionLabel");
        expect(sliceList).toContain("navigateVisibleSlice");
        expect(sliceList).toContain("上一个可见切片");
        expect(sliceList).toContain("下一个可见切片");
        expect(sliceList).toContain("handleFilterChipAction");
        expect(sliceList).toContain(":model-value=\"props.sliceKindFilter\"");
        expect(sliceList).toContain(":options=\"kindFilterOptions\"");
        expect(sliceList).toContain(":model-value=\"props.sliceHealthFilter\"");
        expect(sliceList).toContain(":options=\"statusFilterOptions\"");
        expect(sliceList).toContain("kindShortcutCountMap.value.get(kind) ?? 0");
        expect(sliceList).toContain(":model-value=\"props.subjectFilterMode\"");
        expect(sliceList).toContain(":options=\"subjectFilterModeOptions\"");
        expect(sliceList).toContain("shortChipValue");
        expect(sliceList).toContain("当前筛选");
        expect(sliceList).not.toContain("worldEngine.workbenchPreview.visibleSlices");
        expect(sliceList).not.toContain("worldEngine.workbenchPreview.subjectsTouched");
        expect(sliceList).not.toContain("worldEngine.workbenchPreview.openSlicesIssues");
        expect(sliceList).not.toContain("slice-stat-open-filter");
        expect(sliceList).not.toContain("slice-stat-done-filter");
        expect(sliceList).not.toContain("slice-stat-clean-filter");
        expect(sliceList).not.toContain("slice-stat-draft-filter");
        expect(sliceList).toContain("只看仍有 open issue 的切片");
        expect(sliceList).toContain("只看 review 已处理完成的切片");
        expect(sliceList).toContain("只看没有派生 issue 的 clean 切片");
        expect(sliceList).toContain("只看有未应用草稿的切片");
        expect(sliceList).toContain("drafts");
        expect(sliceList).toContain("整体世界");
        expect(sliceList).toContain("单 subject");
        expect(sliceList).toContain("多 subject");
        expect(sliceList).toContain("data-testid=\"slice-list-clear-subject-filter-top\"");
        expect(sliceList).toContain("清空 subject 过滤，回到整体世界时间线");
        expect(sliceList).toContain("worldEngine.workbenchPreview.subjectMode");
        expect(sliceList).toContain("匹配任一");
        expect(sliceList).toContain("匹配全部");
        expect(sliceList).toContain("open");
        expect(sliceList).toContain("done");
        expect(sliceList).toContain("clean");
        expect(sliceList).toContain("selectedSubjectFilters");
        expect(sliceList).toContain("removeSubjectFilter");
        expect(sliceList).toContain("恢复完整时间线");
        expect(sliceList).not.toContain("relative space-y-3 pl-7");
        expect(sliceList).not.toContain("absolute bottom-3 left-3 top-3 w-px");
        expect(sliceList).not.toContain("absolute -left-[22px] top-8");
        expect(sliceCard).toContain("patchGroups");
        expect(sliceCard).toContain("data-testid=\"world-slice-card\"");
        expect(sliceCard).not.toContain("data-testid=\"world-slice-select-button\"");
        expect(sliceCard).toContain("metadataDraftCount");
        expect(sliceCard).toContain("metadataDraftSummary");
        expect(sliceCard).toContain("hasMetadataDraft");
        expect(sliceCard).toContain("meta draft");
        expect(sliceCard).toContain("未应用 metadata 草稿");
        expect(sliceCard).toContain("metadataDraftDiffLabel");
        expect(sliceCard).toContain("displayTitle");
        expect(sliceCard).toContain("已应用");
        expect(sliceCard).toContain("valueDraftCount");
        expect(sliceCard).toContain("hasValueDraft");
        expect(sliceCard).toContain("value draft {{ props.valueDraftCount }}");
        expect(sliceCard).toContain("未应用 value 草稿");
        expect(sliceCard).not.toContain("选择切片");
        expect(sliceCard).toContain("sliceReviewSummary");
        expect(sliceCard).toContain("reviewItems");
        expect(sliceCard).toContain("visibleReviewItems");
        expect(sliceCard).toContain("hiddenReviewItemCount");
        expect(sliceCard).toContain("data-testid=\"slice-card-issue-row\"");
        expect(sliceCard).toContain("buildWorldWorkbenchSubjectFileProposals");
        expect(sliceCard).toContain("const subjectFileProposals = computed(() => buildWorldWorkbenchSubjectFileProposals");
        expect(sliceCard).toContain("subjectFileProposalCount");
        expect(sliceCard).toContain("(e: \"openSubjectFileProposals\", sliceId: string, subjectId: string): void;");
        expect(sliceCard).toContain("function openSubjectFileProposals(): void");
        expect(sliceCard).toContain("emit(\"openSubjectFileProposals\", props.slice.id, subjectFileProposals.value[0]?.subjectId ?? \"\");");
        expect(sliceCard).toContain("data-testid=\"slice-card-subject-file-proposal-count\"");
        expect(sliceCard).toContain("type=\"button\"");
        expect(sliceCard).toContain("@click.stop=\"openSubjectFileProposals\"");
        expect(sliceCard).toContain("files {{ subjectFileProposalCount }}");
        expect(sliceCard).toContain("按当前主体语境，当前切片有主体文件建议");
        expect(sliceCard).toContain("focusReviewIssue");
        expect(sliceCard).toContain("worldWorkbenchIssueLevel");
        expect(sliceCard).toContain("worldWorkbenchIssueStatusLabel");
        expect(realUtil).toContain("export function worldWorkbenchIssueLevel");
        expect(realUtil).toContain("export function worldWorkbenchIssueStatusLabel");
        expect(realUtil).toContain("severity === \"advisory\"");
        expect(realUtil).not.toContain("code === \"base-shifted\" || code === \"masked\"");
        expect(sliceCard).toContain("reviewBadgeLabel");
        expect(sliceCard).toContain("hasOpenIssues");
        expect(sliceCard).toContain("按 subject 分组");
        expect(sliceCard).toContain("props.slice.title");
        expect(sliceCard).toContain("props.slice.summary");
        expect(sliceCard).toContain("props.slice.kind");
        expect(sliceCard).toContain("const opLabels: Record<string, string>");
        expect(sliceCard).toContain("append: \"追加\"");
        expect(sliceCard).toContain("increment: \"增减\"");
        expect(sliceCard).toContain("remove: \"移除\"");
        expect(sliceCard).toContain("replace: \"设置\"");
        expect(sliceCard).toContain("function opLabel(op: string): string");
        expect(sliceCard).toContain("formatWorkbenchPreviewValue");
        expect(sliceCard).toContain("function patchValueLabel(mutation: WorldWorkbenchPreviewSubjectGroup[\"mutations\"][number]): string");
        expect(sliceCard).toContain("xl:grid-cols-[184px_minmax(0,1fr)]");
        expect(sliceCard).toContain("(e: \"insertSliceBefore\", sliceId: string): void;");
        expect(sliceCard).toContain("(e: \"insertSliceAfter\", sliceId: string): void;");
        expect(sliceCard).toContain("function insertSliceBefore(): void");
        expect(sliceCard).toContain("function insertSliceAfter(): void");
        expect(sliceCard).toContain("在此 Slice 之前插入新 Slice");
        expect(sliceCard).toContain("在此 Slice 之后插入新 Slice");
        expect(sliceCard).toContain("i-lucide-arrow-up-to-line");
        expect(sliceCard).toContain("i-lucide-arrow-down-to-line");
        expect(sliceCard).toContain("@click.stop=\"insertSliceBefore\"");
        expect(sliceCard).toContain("@click.stop=\"insertSliceAfter\"");
        expect(sliceCard).toContain("grid-cols-[minmax(88px,0.56fr)_44px_minmax(96px,1.65fr)_minmax(0,0.72fr)]");
        expect(sliceCard).toContain("{{ mutation.path }}");
        expect(sliceCard).toContain("{{ opLabel(mutation.op) }}");
        expect(sliceCard).toContain("{{ mutation.summary ?? \"\" }}");
        expect(sliceCard).toContain(":title=\"patchValueLabel(mutation)\"");
        expect(sliceCard).toContain("{{ patchValueLabel(mutation) }}");
        expect(sliceCard).toContain("maxVisiblePatchesPerSubject = 6");
        expect(sliceCard).toContain("visiblePatches(group)");
        expect(sliceCard).toContain("hiddenPatchCount(group)");
        expect(sliceCard).toContain("+{{ hiddenPatchCount(group) }} patches");
        expect(sliceCard).toContain("role=\"button\"");
        expect(sliceCard).toContain("tabindex=\"0\"");
        expect(sliceCard).toContain("@click.stop=\"focusSubject(group.subjectId)\"");
        expect(sliceCard).toContain("@keydown.enter.stop.prevent=\"focusSubject(group.subjectId)\"");
        expect(sliceCard).toContain("@keydown.space.stop.prevent=\"focusSubject(group.subjectId)\"");
        expect(sliceList).toContain("(e: \"insertSliceBefore\", sliceId: string): void;");
        expect(sliceList).toContain("(e: \"insertSliceAfter\", sliceId: string): void;");
        expect(sliceList).toContain("@insert-slice-before=\"emit('insertSliceBefore', $event)\"");
        expect(sliceList).toContain("@insert-slice-after=\"emit('insertSliceAfter', $event)\"");
        expect(workbenchDialog).toContain("type SliceComposerInsertContext");
        expect(workbenchDialog).toContain("const sliceComposerInsertContext = ref<SliceComposerInsertContext | null>(null);");
        expect(workbenchDialog).toContain("function openSliceComposerAroundSlice(sliceId: string, direction: \"before\" | \"after\"): void");
        expect(workbenchDialog).toContain("@insert-slice-before=\"openSliceComposerAroundSlice($event, 'before')\"");
        expect(workbenchDialog).toContain("@insert-slice-after=\"openSliceComposerAroundSlice($event, 'after')\"");
        expect(workbenchDialog).toContain(":insert-slice-context=\"sliceComposerInsertContext\"");
        expect(sliceComposer).toContain("suggestAdjacentPreviewTime");
        expect(sliceComposer).toContain("insertSliceContext?: {");
        expect(sliceComposer).toContain("return suggestAdjacentPreviewTime(examples, usedTimes, context.anchorTime, context.direction);");

        expect(inspector).toContain("worldEngine.workbenchPreview.sliceContext");
        expect(zhLocale).toContain("sliceContext");
        expect(enLocale).toContain("sliceContext");
        expect(inspector).toContain("focusedSubjectId");
        expect(inspector).toContain("focusSubject");
        expect(inspector).toContain("FormInput");
        expect(inspector).toContain("FormSelect");
        expect(inspector).toContain("FormTextarea");
        expect(inspector).toContain("busy?: boolean;");
        expect(inspector).toContain("discardDraftSliceId?: string;");
        expect(inspector).toContain("discardMetadataDraftForSlice");
        expect(inspector).toContain("backstory");
        expect(inspector).not.toContain(removedToken("cor", "rection"));
        expect(inspector).toContain("应用到预览");
        expect(inspector).toContain("metadataDraftDirty");
        expect(inspector).toContain("metadataDrafts");
        expect(inspector).toContain("persistMetadataDraft");
        expect(inspector).toContain("persistMetadataDraft(previousSliceId, {");
        expect(inspector).toContain("baseline: WorldWorkbenchPreviewSlicePatch");
        expect(inspector).toContain("resetMetadataDrafts");
        expect(inspector).toContain("metadataDraftStatusLabel");
        expect(inspector).not.toContain("MetadataDraftDiffRow");
        expect(inspector).not.toContain("metadataDraftDiffRows");
        expect(inspector).not.toContain("metadata-draft-diff");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.metadataDraftDiff");
        expect(inspector).toContain("metadataDraftSummaries");
        expect(inspector).toContain("WorldWorkbenchPreviewMetadataDraftSummary");
        expect(inspector).toContain("draftTitle");
        expect(inspector).toContain("updateMetadataDrafts");
        expect(inspector).toContain("resetDraft");
        expect(inspector).toContain("if (props.busy || !metadataDraftDirty.value) {");
        expect(inspector).toContain("<FormInput v-model=\"draft.time\" :disabled=\"props.busy\" />");
        expect(inspector).toContain("<FormSelect v-model=\"draft.kind\" :options=\"kindOptions\" :disabled=\"props.busy\" />");
        expect(inspector).toContain("<FormTextarea v-model=\"draft.summary\" :rows=\"4\" :disabled=\"props.busy\" />");
        expect(inspector).toContain(":disabled=\"props.busy || !metadataDraftDirty\"");
        expect(inspector).toContain("未应用修改");
        expect(inspector).toContain("已同步");
        expect(inspector).toContain("还原");
        expect(inspector).toContain("useResizablePanel");
        expect(inspector).toContain("resizeHandleRef");
        expect(inspector).toContain("panelStyle");
        expect(inspector).toContain("isResizing");
        expect(inspector).toContain("props.width");
        expect(inspector).toContain("update:width");
        expect(inspector).toContain("minSize: 300");
        expect(inspector).toContain("maxSize: 560");
        expect(inspector).toContain("edge: \"left\"");
        expect(inspector).toContain("onResize: (width) => emit(\"update:width\", width)");
        expect(inspector).toContain("onResizeEnd: (width) => emit(\"update:width\", width)");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.reviewIssues");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.reviewQueue");
        expect(inspector).toContain("flex min-h-0 flex-1 flex-col gap-3");
        expect(inspector).not.toContain("subject-system-summary");
        expect(inspector).toContain("order-6 rounded-md");
        expect(inspector).not.toContain("Subject System");
        expect(inspector).not.toContain("来自 simulation/subjects 的真实主体系统摘要");
        expect(inspector).not.toContain("path only");
        expect(inspector).toContain("subject-file-proposals");
        expect(inspector).toContain("subjectFileProposalFocusVersion?: number;");
        expect(inspector).toContain("const subjectFileProposalsRef = ref<HTMLElement | null>(null);");
        expect(inspector).toContain("function scrollSubjectFileProposalsIntoView(): Promise<void>");
        expect(inspector).toContain("subjectFileProposalsRef.value?.scrollIntoView({block: \"start\"});");
        expect(inspector).toContain("watch(() => props.subjectFileProposalFocusVersion");
        expect(inspector).toContain("ref=\"subjectFileProposalsRef\"");
        expect(inspector).toContain("subjectFileProposalCount");
        expect(inspector).toContain("data-testid=\"subject-file-proposal-count\"");
        expect(inspector).toContain("仅生成建议，不会自动写入 simulation/subjects");
        expect(inspector).toContain("proposal.eventJsonLine");
        expect(inspector).toContain("proposal.memoryJsonLines");
        expect(inspector).toContain("(e: \"commitSubjectEventProposal\", proposal: WorldWorkbenchSubjectFileProposal): void;");
        expect(inspector).toContain("committedSubjectEventKeys?: string[];");
        expect(inspector).toContain("committedSubjectEventKeySet");
        expect(inspector).toContain("worldWorkbenchSubjectEventProposalKey(proposal)");
        expect(inspector).toContain("这条 events.jsonl 经历已在当前会话处理。");
        expect(inspector).toContain("function commitSubjectEventProposal(proposal: WorldWorkbenchSubjectFileProposal): void");
        expect(inspector).toContain("emit(\"commitSubjectEventProposal\", proposal);");
        expect(inspector).toContain("确认后追加到 events.jsonl");
        expect(inspector).toContain("已追加");
        expect(inspector).toContain("追加");
        expect(inspector).toContain("proposal.sourceKind === 'direct-mutation'");
        expect(inspector).toContain("proposal.sourceLabel");
        expect(inspector).toContain("function copyAllSubjectFileProposals(): Promise<void>");
        expect(inspector).toContain("join(\"\\n\\n---\\n\\n\")");
        expect(inspector).toContain("title=\"复制全部主体文件建议\"");
        expect(inspector).toContain("全部主体文件建议已复制。");
        expect(inspector).toContain("function copySubjectFileProposalText(text: string, successMessage: string): Promise<boolean>");
        expect(inspector).toContain("notification.error(\"复制失败，请手动选择文本后复制。\");");
        expect(inspector).toContain("function copySubjectFileProposalTextAndOpen(text: string, successMessage: string, path: string): Promise<void>");
        expect(inspector).toContain("World Engine 工作台正在同步，请稍候再打开目标文件。");
        expect(inspector).toContain("目标文件路径为空，无法打开。");
        expect(inspector).toContain("if (copied) {");
        expect(inspector).toContain("openSubjectFileProposalPath(path);");
        expect(inspector).toContain("title=\"复制 events.jsonl 行\"");
        expect(inspector).toContain("title=\"复制 events.jsonl 行并打开文件，确认后追加到文件末尾\"");
        expect(inspector).toContain("title=\"复制 memory.jsonl 候选行\"");
        expect(inspector).toContain("title=\"复制 memory.jsonl 候选行并打开文件，确认后追加新行或按 topic 改写\"");
        expect(inspector).toContain("title=\"复制 state.md 审查提示\"");
        expect(inspector).toContain("title=\"复制 state.md 审查提示并打开文件，打开后检查对应区块\"");
        expect(inspector).toContain("复制并打开");
        expect(inspector).toContain("events.jsonl 行已复制，打开文件后确认并追加到末尾。");
        expect(inspector).toContain("proposal.stateReviewReasons.join('\\n')");
        expect(inspector).toContain("state.md 审查提示已复制。");
        expect(inspector).toContain("写入前确认第一人称口吻、角色当时知道什么；确认后追加到 events.jsonl 末尾。");
        expect(inspector).toContain("memory.jsonl 候选行已复制，打开文件后确认追加新行或按 topic 改写。");
        expect(inspector).toContain("memory.jsonl 是当前认知快照；写入前确认追加新行，还是按 topic 改写已有行。");
        expect(inspector).toContain("state.md 审查提示已复制，打开文件后检查对应区块。");
        expect(inspector).toContain("(e: \"openWorkspacePath\", path: string): void;");
        expect(inspector).toContain("function openSubjectFileProposalPath(path: string): void");
        expect(inspector).toContain("title=\"打开 events.jsonl\"");
        expect(inspector).toContain("title=\"打开 memory.jsonl\"");
        expect(inspector).toContain("title=\"打开 state.md\"");
        expect(inspector).toContain("order-7 flex flex-col gap-2");
        expect(inspector).not.toContain("reviewQueueItems");
        expect(inspector).not.toContain("reviewTriageSummary");
        expect(inspector).not.toContain("reviewQueueMode");
        expect(inspector).not.toContain("updateReviewQueueMode");
        expect(inspector).not.toContain("visibleReviewQueueItems");
        expect(inspector).not.toContain("activeVisibleQueueIndex");
        expect(inspector).not.toContain("currentIssueOutsideVisibleQueue");
        expect(inspector).not.toContain("currentReviewQueueItem");
        expect(inspector).not.toContain("updateIssueTriage");
        expect(inspector).not.toContain("IssueTriageOption");
        expect(inspector).not.toContain("issueTriageOptions");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.triageProgress");
        expect(inspector).not.toContain("currentReviewQueueIndex");
        expect(inspector).not.toContain("previousReviewQueueItem");
        expect(inspector).not.toContain("nextReviewQueueItem");
        expect(inspector).not.toContain("focusReviewQueueItem");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.onlyOpen");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.allIssues");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.openQueueClear");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.previousOpen");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.nextOpen");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.previousIssue");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.nextIssue");
        expect(inspector).not.toContain("issueLevel");
        expect(inspector).toContain("props.slice.time");
        expect(inspector).toContain("props.slice.title");
        expect(inspector).toContain("props.slice.summary");
        expect(inspector).toContain("props.slice.kind");
        expect(inspector).not.toContain("base-shifted");
        expect(inspector).not.toContain("masked");
        expect(inspector).toContain("worldEngine.workbenchPreview.stateSnapshot");
        expect(inspector).toContain("JsonViewer");
        expect(inspector).toContain("nbook/app/components/common/JsonViewer.vue");
        expect(inspector).toContain("rawSnapshotValue");
        expect(inspector).toContain("<JsonViewer :value=\"rawSnapshotValue\" :max-height=\"400\" />");
        expect(inspector).not.toContain("SnapshotTreeNode");
        expect(inspector).not.toContain("SnapshotTreeView");
        expect(inspector).not.toContain("snapshotTreeNodes");
        expect(inspector).not.toContain("buildSnapshotTreeNode");
        expect(inspector).not.toContain("snapshot-tree-node");
        expect(inspector).not.toContain("rawSnapshotJson");
        expect(inspector).not.toContain("<pre class=\"max-h-72");
        expect(inspector).toContain("完整世界");
        expect(inspector).toContain("只看触及主体");
        expect(inspector).toContain(":aria-pressed=\"showFullState\"");
        expect(inspector).not.toContain("worldEngine.workbenchPreview.schemaExcerpt");

        expect(editor).toContain("worldEngine.workbenchPreview.reviewWorkbench");
        expect(editor).toContain("审查工作台");
        expect(editor).not.toContain("Mutation Editor");
        expect(editor).not.toContain("变更编辑器");
        expect(editor).toContain("JsonViewer");
        expect(editor).toContain("nbook/app/components/common/JsonViewer.vue");
        expect(editor).toContain("<JsonViewer v-if=\"activeSubjectState\" class=\"min-h-0 flex-1\" :value=\"activeSubjectState.attrs\" :main-menu-bar=\"false\" :max-height=\"0\" />");
        expect(editor).not.toContain("stateRows");
        expect(editor).not.toContain("WorldWorkbenchPreviewAttrRow");
        expect(editor).toContain("useResizablePanel");
        expect(editor).toContain("resizeHandleRef");
        expect(editor).toContain("panelStyle");
        expect(editor).toContain("isResizing");
        expect(editor).toContain("props.height");
        expect(editor).toContain("update:height");
        expect(editor).toContain("minSize: 160");
        expect(editor).toContain("maxSize: 520");
        expect(editor).toContain("edge: \"top\"");
        expect(editor).toContain("onResize: (height) => emit(\"update:height\", height)");
        expect(editor).toContain("onResizeEnd: (height) => emit(\"update:height\", height)");
        expect(editor).toContain("SegmentedControl");
        expect(editor).toContain("SegmentedControlOption");
        expect(editor).toContain("SegmentedControlValue");
        expect(editor).toContain("editorViewOptions");
        expect(editor).toContain("reviewQueueModeOptions");
        expect(editor).toContain("subjectNavigationScopeOptions");
        expect(editor).toContain("updateEditorView");
        expect(editor).toContain("updateReviewQueueMode");
        expect(editor).toContain("updateSubjectNavigationScope");
        expect(editor).toContain("问题处理");
        expect(editor).toContain("Subject 视图");
        expect(editor).toContain("总变更");
        expect(editor).toContain(":model-value=\"view\"");
        expect(editor).toContain(":options=\"editorViewOptions\"");
        expect(editor).toContain("editorSummary");
        expect(editor).toContain("activeSubjectSummary");
        expect(editor).toContain("focusedSubjectId");
        expect(editor).toContain("highlightedMutationFocus");
        expect(editor).toContain("setActiveSubject");
        expect(editor).toContain("filteredTouchedSubjectIds");
        expect(editor).toContain("navigateSubjectSlice");
        expect(editor).toContain("SubjectNavigationScope");
        expect(editor).toContain("subjectNavigationScope");
        expect(editor).toContain("setSubjectNavigationScope");
        expect(editor).toContain("matchesNavigationScope");
        expect(editor).toContain("matchesWorkbenchPreviewSliceFilter");
        expect(editor).toContain("sliceReviewSummaryMap");
        expect(editor).toContain("sliceKindFilter");
        expect(editor).toContain("sliceHealthFilter");
        expect(editor).toContain("sliceSearch");
        expect(editor).toContain("relatedSlicePosition");
        expect(editor).toContain("subjectNavigationScopeLabel");
        expect(editor).toContain("subject 轨迹");
        expect(editor).toContain("过滤组合");
        expect(editor).toContain(":aria-pressed=\"activeSubjectId === subjectId\"");
        expect(editor).toContain(":model-value=\"subjectNavigationScope\"");
        expect(editor).toContain(":options=\"subjectNavigationScopeOptions\"");
        expect(editor).toContain("previousRelatedSlice");
        expect(editor).toContain("nextRelatedSlice");
        expect(editor).toContain("valueDrafts");
        expect(editor).toContain("busy?: boolean;");
        expect(editor).toContain("discardDraftSliceId?: string;");
        expect(editor).toContain("discardValueDraftsForSlice");
        expect(editor).toContain("resetKey");
        expect(editor).toContain("resetAllValueDrafts");
        expect(editor).toContain("requestResetAllValueDrafts");
        expect(editor).toContain("if (props.busy)");
        expect(editor).toContain("const key = valueDraftKey(index);");
        expect(editor).toContain("hasValueDraft");
        expect(editor).toContain("ValueDraftSummary");
        expect(editor).toContain("allDirtyValueDrafts");
        expect(editor).toContain("allDirtyValueDraftCount");
        expect(editor).toContain("otherSliceDirtyDrafts");
        expect(editor).toContain("otherSliceDirtyDraftCount");
        expect(editor).toContain("nextOtherSliceDraft");
        expect(editor).toContain("navigateToOtherDraft");
        expect(editor).toContain("valueDraftKeyForSlice");
        expect(editor).toContain("其他切片");
        expect(editor).toContain("跳到草稿");
        expect(editor).toContain("清空草稿");
        expect(editor).toContain("data-testid=\"mutation-editor-next-draft-slice\"");
        expect(editor).toContain("data-testid=\"mutation-editor-clear-all-drafts\"");
        expect(editor).toContain("data-testid=\"mutation-editor-next-draft-toolbar\"");
        expect(editor).toContain("data-testid=\"mutation-editor-clear-all-drafts-toolbar\"");
        expect(editor).toContain("data-testid=\"world-review-panel\"");
        expect(editor).toContain("reviewPanelStyle");
        expect(editor).toContain("height: \"40px\"");
        expect(editor).toContain("transition-[height] duration-300");
        expect(editor).toContain("class=\"flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3\"");
        expect(editor).toContain("class=\"min-h-0 flex-1 space-y-3 overflow-y-auto custom-scrollbar\"");
        expect(editor).toContain("class=\"grid min-h-0 flex-1 gap-3 xl:grid-cols-[240px_minmax(0,1fr)]\"");
        expect(editor).toContain("class=\"flex min-h-0 flex-col overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] p-2.5\"");
        expect(editor).toContain("class=\"min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 custom-scrollbar\"");
        expect(editor).toContain("class=\"grid min-h-0 flex-1 gap-3 2xl:grid-cols-2\"");
        expect(editor).toContain("class=\"flex min-h-0 flex-col\"");
        expect(editor).toContain("WorldEngineWorkbenchPreviewPatchEditor");
        expect(editor).toContain("activeSubjectPatchEditorRows");
        expect(patchEditor).toContain("class=\"min-h-0 flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-2 custom-scrollbar pr-1\"");
        expect(patchEditor).toContain("主行编辑 patch 字段，次行编辑 summary");
        expect(patchEditor).toContain("data-testid=\"mutation-editor-row\"");
        expect(patchEditor).toContain("class=\"flex flex-col gap-2 rounded-md border border-[var(--we-border)] p-2.5 text-[11px] transition-colors\"");
        expect(patchEditor).toContain("class=\"flex min-w-0 flex-1 items-start gap-2\"");
        expect(patchEditor).toContain("class=\"mt-0.5 flex shrink-0 items-center justify-end gap-0.5\"");
        expect(patchEditor).toContain("FormSelect");
        expect(patchEditor).toContain("Combobox");
        expect(patchEditor).toContain("pathOptions");
        expect(patchEditor).toContain("(e: \"append\"): void");
        expect(patchEditor).toContain("(e: \"save\"): void");
        expect(patchEditor).toContain("(e: \"reset\"): void");
        expect(patchEditor).toContain("@click=\"emit('append')\"");
        expect(patchEditor).toContain("@click=\"emit('save')\"");
        expect(patchEditor).toContain("@click=\"emit('reset')\"");
        expect(editor).toContain("@append=\"appendPatchDraft\"");
        expect(editor).toContain("@save=\"savePatchDrafts\"");
        expect(editor).toContain("@reset=\"resetPatchDrafts\"");
        expect(editor).toContain(":dirty=\"patchDraftDirty\"");
        expect(editor).toContain(":error=\"patchDraftError\"");
        expect(patchEditor).toContain("<Combobox :model-value=\"row.mutation.path\"");
        expect(patchEditor).toContain("<FormSelect :model-value=\"row.mutation.op\"");
        expect(patchEditor).toContain("size=\"sm\"");
        expect(patchEditor).not.toContain(">attr</span>");
        expect(patchEditor).not.toContain(">op</span>");
        expect(patchEditor).not.toContain(">value</span>");
        expect(patchEditor).not.toContain("attrSelectOptions");
        expect(patchEditor).not.toContain("pathDatalistId");
        expect(patchEditor).not.toContain("<input :value=\"row.mutation.path\"");
        expect(patchEditor).not.toContain("<datalist");
        expect(patchEditor).not.toContain("<FormSelect :model-value=\"row.mutation.path\"");
        expect(patchEditor).not.toContain("<select :value=\"row.mutation.op\"");
        expect(patchEditor).not.toContain("切片前");
        expect(patchEditor).not.toContain("切片后");
        expect(editor).toContain("Transition name=\"world-review-panel-body\"");
        expect(editor).toContain(".world-review-panel-body-enter-active");
        expect(editor).toContain("transform: translateY(8px)");
        expect(patchEditor).toContain("data-testid=\"mutation-editor-row\"");
        expect(editor).toContain("data-testid=\"mutation-editor-apply-all-banner\"");
        expect(editor).toContain("data-testid=\"mutation-editor-reset-all-banner\"");
        expect(editor).toContain("dirtyMutationRows");
        expect(editor).toContain("dirtyValueDraftCount");
        expect(editor).toContain("valueDraftErrorCount");
        expect(editor).toContain("valueDraftStatusLabel");
        expect(editor).toContain("applyDirtyValueDrafts");
        expect(editor).toContain("resetDirtyValueDrafts");
        expect(editor).toContain(":disabled=\"props.busy || !dirtyValueDraftCount\"");
        expect(editor).toContain(":disabled=\"props.busy || !isValueDraftDirty(row.index, row.mutation)\"");
        expect(editor).toContain("parseDirtyValueDrafts");
        expect(editor).toContain("worldEngine.workbenchPreview.draftChanges");
        expect(editor).toContain("未应用");
        expect(editor).toContain("已同步");
        expect(editor).toContain("应用全部");
        expect(editor).toContain("还原全部");
        expect(editor).toContain("dirty");
        expect(editor).toContain("WorldEngineWorkbenchPreviewValueInput");
        expect(patchEditor).toContain("WorldEngineWorkbenchPreviewValueInput");
        expect(editor).toContain("parseWorkbenchPreviewMutationValue");
        expect(editor).toContain("parseMutationJson");
        expect(editor).toContain("opOptionsForPreviewAttr");
        expect(editor).toContain("resolvePreviewAttrPath");
        expect(editor).toContain("defaultMutationForPreviewSubject");
        expect(editor).toContain("defaultValueForPreviewAttr");
        expect(editor).toContain("updateMutationPatches");
        expect(editor).toContain("updateMutationValue");
        expect(editor).toContain("updateValueDrafts");
        expect(editor).toContain("patchDrafts");
        expect(editor).toContain("patchValueDrafts");
        expect(editor).toContain("patchDraftDirty");
        expect(editor).toContain("activeSubjectPatchDraftRows");
        expect(editor).toContain("activeSubjectPatchEditorRows");
        expect(editor).toContain("savePatchDrafts");
        expect(editor).toContain("resetPatchDrafts");
        expect(editor).toContain("appendPatchDraft");
        expect(editor).toContain("duplicatePatchDraft");
        expect(editor).toContain("deletePatchDraft");
        expect(editor).toContain("movePatchDraft");
        expect(editor).toContain("updatePatchDraftPath");
        expect(editor).toContain("updatePatchDraftOp");
        expect(editor).toContain("updatePatchValueDraft");
        expect(editor).toContain("updatePatchDraftSummary");
        expect(editor).toContain("path");
        expect(patchEditor).toContain("summary");
        expect(patchEditor).toContain("patch draft");
        expect(editor).toContain("previousSnapshotSubjects");
        expect(editor).toContain("mutationBeforeValue");
        expect(editor).toContain("mutationAfterValue");
        expect(editor).toContain("isHighlightedMutation");
        expect(editor).toContain("reviewFocusContext");
        expect(editor).not.toContain("Review Focus");
        expect(editor).toContain("reviewMutationContext");
        expect(editor).toContain("reviewIssueExplanation");
        expect(editor).toContain("MutationContextItem");
        expect(editor).toContain("MutationContextTriple");
        expect(editor).toContain("IssueExplanation");
        expect(editor).toContain("MutationContextExplanation");
        expect(editor).toContain("mutationTimelineForIssue");
        expect(editor).toContain("findCurrentMutationContext");
        expect(editor).toContain("attrPathRelated");
        expect(editor).toContain("same subject + attr path");
        expect(editor).toContain("data-testid=\"mutation-context\"");
        expect(editor).toContain("data-testid=\"mutation-context-card\"");
        expect(editor).toContain("前一个 mutation");
        expect(editor).toContain("当前 mutation");
        expect(editor).toContain("后一个 mutation");
        expect(editor).toContain("没有更早的相关 mutation");
        expect(editor).toContain("没有更晚的相关 mutation");
        expect(editor).toContain("context.explanation.whatHappened");
        expect(editor).toContain("context.explanation.whyItMatters");
        expect(editor).toContain("context.explanation.suggestedAction");
        expect(editor).not.toContain("buildIssueExplanation");
        expect(editor).toContain("buildMutationContextExplanation");
        expect(editor).toContain("这不是后端 issue，只是当前工作台的定位状态。");
        expect(editor).not.toContain("mutationContextBeforeValue");
        expect(editor).not.toContain("mutationContextAfterValue");
        expect(editor).not.toContain("snapshotSubjectsForSlice");
        expect(editor).not.toContain("previousSnapshotSubjectsForSlice");
        expect(editor).not.toContain(">before<");
        expect(editor).not.toContain(">after<");
        expect(editor).toContain("发生了什么");
        expect(editor).toContain("为什么要看");
        expect(editor).toContain("建议处理");
        expect(editor).toContain("动作");
        expect(editor).toContain("依赖/覆盖关系");
        expect(editor).toContain("为什么相关");
        expect(editor).toContain("需要确认");
        expect(editor).toContain("reviewFocusContext.label");
        expect(editor).toContain("{{ item.label }}");
        expect(editor).toContain("item.severity");
        expect(editor).not.toContain("A1（提醒）");
        expect(editor).not.toContain("A2（提醒）");
        expect(editor).not.toContain("E1（持久）");
        expect(editor).not.toContain("E2（持久）");
        expect(editor).not.toContain("code === \"broken-relative\"");
        expect(editor).not.toContain("code === \"dangling-ref\"");
        expect(editor).not.toContain("code === \"base-shifted\"");
        expect(editor).not.toContain("code === \"masked\"");
        expect(editor).toContain("mutationActionPhrase");
        expect(editor).toContain("mutationRelationText");
        expect(editor).toContain("mutationConfirmationText");
        expect(editor).toContain("mutationValueLabel");
        expect(editor).toContain("readableValue");
        expect(editor).toContain("incrementValuePhrase");
        expect(editor).not.toContain("relativeOperationQuestion");
        expect(editor).toContain("mutation.op === \"replace\"");
        expect(editor).toContain("mutation.op === \"remove\"");
        expect(editor).toContain("mutation.op === \"increment\"");
        expect(editor).toContain("使用 append");
        expect(editor).toContain("currentSliceReviewItems");
        expect(editor).toContain("worldWorkbenchIssueLevel");
        expect(editor).toContain("worldWorkbenchIssueStatusLabel");
        expect(editor).toContain("data-testid=\"mutation-editor-issue-row\"");
        expect(editor).toContain("focusReviewIssue");
        expect(editor).toContain("updateIssueTriage");
        expect(editor).toContain("IssueTriageOption");
        expect(editor).toContain("issueTriageOptions");
        expect(editor).toContain(":aria-pressed=\"reviewFocusContext.status === option.status\"");
        expect(editor).toContain("worldEngine.workbenchPreview.triageProgress");
        expect(editor).toContain("worldEngine.workbenchPreview.reviewQueueSummary");
        expect(editor).toContain("worldEngine.workbenchPreview.onlyOpen");
        expect(editor).toContain("worldEngine.workbenchPreview.allIssues");
        expect(editor).toContain("worldEngine.workbenchPreview.previousOpen");
        expect(editor).toContain("worldEngine.workbenchPreview.nextOpen");
        expect(editor).toContain("previousReviewQueueItem");
        expect(editor).toContain("nextReviewQueueItem");
        expect(editor).toContain("待处理");
        expect(editor).toContain("确认");
        expect(editor).toContain("忽略");
        expect(editor).toContain("clearReviewFocus");
        expect(editor).toContain("clearMutationFocus");
        expect(editor).toContain("清除定位");
        expect(editor).toContain("issue target");
        expect(editor).toContain("切片前");
        expect(editor).toContain("切片后");
        expect(editor).toContain("此时状态");
        expect(patchEditor).toContain("本切片变更");
        expect(valueInput).toContain("resolveInputKind");
        expect(valueInput).toContain("FormSelect");
        expect(valueInput).toContain("FormNumberInput");
        expect(valueInput).toContain("refSubjectType");
        expect(valueInput).toContain("v-else-if=\"inputKind === 'number'\"");
        expect(valueInput).toContain("inputKind === 'ref'");
        expect(valueInput).toContain("inputKind === 'boolean'");
        expect(valueInput).toContain("inputKind === 'enum'");
        expect(valueInput).toContain("inputKind === 'json'");
        expect(valueInput).toContain("size=\"sm\"");
        expect(valueInput).not.toContain("<select");

        expect(types).toContain("WorldWorkbenchPreviewSlice");
        expect(types).toContain("WorldWorkbenchPreviewSnapshot");
        expect(types).toContain("WorldWorkbenchPreviewSlicePatch");
        expect(types).toContain("WorldWorkbenchPreviewMutationFocus");
        expect(types).toContain("WorldWorkbenchPreviewMutationValuePatch");
        expect(types).toContain("WorldWorkbenchPreviewMetadataDraftSummary");
        expect(types).toContain("draftTitle");
        expect(types).toContain("WorldWorkbenchPreviewValueDraftSummary");
        expect(types).toContain("WorldWorkbenchPreviewIssueStatus");
        expect(types).toContain("WorldWorkbenchPreviewIssueTriageState");
        expect(types).toContain("WorldWorkbenchPreviewIssueTriagePatch");
        expect(types).toContain("WorldWorkbenchPreviewIssueTriageSummary");
        expect(types).toContain("WorldWorkbenchPreviewSliceReviewSummary");
        expect(types).toContain("WorldWorkbenchPreviewReviewQueueItem");
        expect(types).toContain("WorldWorkbenchPreviewReviewQueueMode");
        expect(types).toContain("WorldWorkbenchPreviewSubjectFilterMode");
        expect(types).toContain("WorldWorkbenchPreviewSliceHealthFilter");
        expect(types).toContain("WorldWorkbenchPreviewSubjectStat");
        expect(types).toContain("openIssueCount");
        expect(types).toContain("doneIssueCount");
        expect(types).toContain("confirmedIssueCount");
        expect(types).toContain("ignoredIssueCount");
        expect(types).toContain("sourceKind: \"direct-mutation\" | \"focused-world-context\";");
        expect(types).toContain("sourceLabel: string;");
        expect(types).toContain("sliceId: string;");
        expect(types).toContain("sliceTime: string;");
        expect(types).toContain("sliceTitle: string;");
        expect(types).toContain("sliceKind: string;");
    });

    it("从 schema default 和 slices reduce 出稳定 mock snapshots", () => {
        const snapshots = reduceWorkbenchPreviewSnapshots(cloneMockWorkbenchSlices(), mockWorkbenchSubjects, mockWorkbenchSchema);

        expect(findSnapshotSubject(snapshots, "slice-world-init", "erina").attrs).toMatchObject({
            hp: 100,
            inventory: [],
            events: [],
        });
        expect(findSnapshotSubject(snapshots, "slice-erina-arrives", "erina").attrs.inventory).toEqual(["subject://old-sword"]);
        expect(findSnapshotSubject(snapshots, "slice-erina-arrives", "old-sword").attrs.durability).toBe(95);
        expect(findSnapshotSubject(snapshots, "slice-east-tower-opened", "old-sword").attrs.durability).toBe(80);
        expect(findSnapshotSubject(snapshots, "slice-old-sword-backstory", "old-sword").attrs.durability).toBe(82);
        expect(findSnapshotSubject(snapshots, "slice-erina-hands-sword", "erina").attrs.inventory).toEqual([]);
        expect(findSnapshotSubject(snapshots, "slice-erina-hands-sword", "moran").attrs.inventory).toEqual(["subject://old-sword"]);
        expect(findSnapshotSubject(snapshots, "slice-erina-hands-sword", "old-sword").attrs.owner).toBe("subject://moran");
    });

    it("mock snapshot append 与运行时一致：普通 list 保留重复，collection 去重", () => {
        const slices: WorldWorkbenchPreviewSlice[] = [{
            id: "slice-append-semantics",
            time: "C01:00:01",
            title: "append 语义检查",
            summary: "普通 list 与 collection 的 append 语义不同。",
            kind: "event",
            mutations: [
                {subjectId: "erina", path: "/events", op: "append", value: "重复事件"},
                {subjectId: "erina", path: "/events", op: "append", value: "重复事件"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://old-sword"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://old-sword"},
            ],
        }];

        const snapshots = reduceWorkbenchPreviewSnapshots(slices, mockWorkbenchSubjects, mockWorkbenchSchema);
        const erina = findSnapshotSubject(snapshots, "slice-append-semantics", "erina");

        expect(erina.attrs.events).toEqual(["重复事件", "重复事件"]);
        expect(erina.attrs.inventory).toEqual(["subject://old-sword"]);
    });

    it("应用 mutation value patch 后重算 snapshots 且不会重复叠加相对 mutation", () => {
        const slices = cloneMockWorkbenchSlices();
        const namePatch = applyWorkbenchPreviewMutationPatch({
            schema: mockWorkbenchSchema,
            slices,
            subjects: mockWorkbenchSubjects,
            patch: {
                sliceId: "slice-world-init",
                mutationIndex: 2,
                value: "新王都",
            },
        });
        expect(namePatch?.label).toBe("capital/name");
        expect(findSnapshotSubject(namePatch?.snapshots ?? [], "slice-world-init", "capital").attrs.name).toBe("新王都");
        expect(findSnapshotSubject(namePatch?.snapshots ?? [], "slice-erina-arrives", "capital").attrs.name).toBe("新王都");

        const durabilityPatch = applyWorkbenchPreviewMutationPatch({
            schema: mockWorkbenchSchema,
            slices,
            subjects: mockWorkbenchSubjects,
            patch: {
                sliceId: "slice-erina-arrives",
                mutationIndex: 4,
                value: -10,
            },
        });
        expect(durabilityPatch?.label).toBe("old-sword/durability");
        expect(findSnapshotSubject(durabilityPatch?.snapshots ?? [], "slice-erina-arrives", "old-sword").attrs.durability).toBe(90);
        expect(findSnapshotSubject(durabilityPatch?.snapshots ?? [], "slice-east-tower-opened", "old-sword").attrs.durability).toBe(75);
        expect(findSnapshotSubject(durabilityPatch?.snapshots ?? [], "slice-old-sword-backstory", "old-sword").attrs.durability).toBe(82);
        expect(findSnapshotSubject(durabilityPatch?.snapshots ?? [], "slice-erina-arrives", "erina").attrs.inventory).toEqual(["subject://old-sword"]);
    });

    it("应用 mutation list patch 后整块替换 slice mutations 并重算 snapshots", () => {
        const slices = cloneMockWorkbenchSlices();
        const result = applyWorkbenchPreviewMutationListPatch({
            schema: mockWorkbenchSchema,
            slices,
            subjects: mockWorkbenchSubjects,
            patch: {
                sliceId: "slice-erina-arrives",
                patches: [
                    {subjectId: "erina", path: "/location", op: "replace", value: "subject://east-tower", summary: "改为东塔"},
                    {subjectId: "erina", path: "/events", op: "append", value: "提前抵达东塔"},
                ],
            },
        });

        expect(result?.slices.find((slice) => slice.id === "slice-erina-arrives")?.mutations).toEqual([
            {subjectId: "erina", path: "/location", op: "replace", value: "subject://east-tower", summary: "改为东塔"},
            {subjectId: "erina", path: "/events", op: "append", value: "提前抵达东塔"},
        ]);
        expect(findSnapshotSubject(result?.snapshots ?? [], "slice-erina-arrives", "erina").attrs.location).toBe("subject://east-tower");
        expect(findSnapshotSubject(result?.snapshots ?? [], "slice-erina-arrives", "old-sword").attrs.owner).toBeUndefined();
    });

    it("解析审查工作台 value 草稿时区分 JSON-like 输入和普通文本", () => {
        expect(parseWorkbenchPreviewMutationValue("新王都")).toEqual({ok: true, value: "新王都"});
        expect(parseWorkbenchPreviewMutationValue(" subject://capital ")).toEqual({ok: true, value: " subject://capital "});
        expect(parseWorkbenchPreviewMutationValue("-10")).toEqual({ok: true, value: -10});
        expect(parseWorkbenchPreviewMutationValue("true")).toEqual({ok: true, value: true});
        expect(parseWorkbenchPreviewMutationValue("null")).toEqual({ok: true, value: null});
        expect(parseWorkbenchPreviewMutationValue('"80"')).toEqual({ok: true, value: "80"});
        expect(parseWorkbenchPreviewMutationValue('{"level":"alert","locked":false}')).toEqual({
            ok: true,
            value: {level: "alert", locked: false},
        });
        expect(parseWorkbenchPreviewMutationValue("{broken")).toEqual({
            ok: false,
            error: "value 看起来像 JSON，但不是合法 JSON",
        });
        expect(formatWorkbenchPreviewValue({level: "normal", locked: true})).toBe('{"level":"normal","locked":true}');
    });

    it("共享 Slice List 过滤器同时覆盖 subject / kind / status / search", () => {
        const slices = cloneMockWorkbenchSlices();
        const openSummary = {confirmed: 0, done: 0, ignored: 0, open: 1, sliceId: "slice-east-tower-opened", total: 1};
        const doneSummary = {confirmed: 1, done: 1, ignored: 0, open: 0, sliceId: "slice-east-tower-opened", total: 1};
        const target = slices.find((slice) => slice.id === "slice-east-tower-opened");
        const clean = slices.find((slice) => slice.id === "slice-world-init");
        expect(target).toBeTruthy();
        expect(clean).toBeTruthy();

        expect(matchesWorkbenchPreviewSliceFilter({
            selectedSubjectIds: ["erina", "old-sword"],
            slice: target!,
            sliceHealthFilter: "open",
            sliceKindFilter: "event",
            sliceReviewSummary: openSummary,
            sliceSearch: "durability",
            subjectFilterMode: "all",
        })).toBe(true);
        expect(matchesWorkbenchPreviewSliceFilter({
            selectedSubjectIds: ["erina", "moran"],
            slice: target!,
            sliceHealthFilter: "open",
            sliceKindFilter: "event",
            sliceReviewSummary: openSummary,
            sliceSearch: "durability",
            subjectFilterMode: "all",
        })).toBe(false);
        expect(matchesWorkbenchPreviewSliceFilter({
            selectedSubjectIds: ["erina", "moran"],
            slice: target!,
            sliceHealthFilter: "done",
            sliceKindFilter: "event",
            sliceReviewSummary: doneSummary,
            sliceSearch: "东塔",
            subjectFilterMode: "any",
        })).toBe(true);
        expect(matchesWorkbenchPreviewSliceFilter({
            selectedSubjectIds: [],
            slice: clean!,
            sliceHealthFilter: "clean",
            sliceKindFilter: "init",
            sliceReviewSummary: undefined,
            sliceSearch: "王都",
            subjectFilterMode: "any",
        })).toBe(true);
        expect(matchesWorkbenchPreviewSliceFilter({
            selectedSubjectIds: [],
            slice: clean!,
            sliceHealthFilter: "draft",
            sliceKindFilter: "all",
            sliceReviewSummary: undefined,
            sliceSearch: "",
            subjectFilterMode: "any",
            metadataDraftCount: 0,
            valueDraftCount: 0,
        })).toBe(false);
        expect(matchesWorkbenchPreviewSliceFilter({
            selectedSubjectIds: [],
            slice: clean!,
            sliceHealthFilter: "draft",
            sliceKindFilter: "all",
            sliceReviewSummary: undefined,
            sliceSearch: "",
            subjectFilterMode: "any",
            metadataDraftCount: 0,
            valueDraftCount: 1,
        })).toBe(true);
        expect(matchesWorkbenchPreviewSliceFilter({
            selectedSubjectIds: [],
            slice: clean!,
            sliceHealthFilter: "draft",
            sliceKindFilter: "all",
            sliceReviewSummary: undefined,
            sliceSearch: "",
            subjectFilterMode: "any",
            metadataDraftCount: 1,
            valueDraftCount: 0,
        })).toBe(true);

        expect(buildWorkbenchPreviewFiltersAfterSavedEdit({
            editedSlice: target!,
            selectedSubjectIds: ["moran"],
            sliceHealthFilter: "open",
            sliceKindFilter: "init",
            sliceSearch: "missing keyword",
            subjectFilterMode: "all",
        })).toEqual({
            selectedSubjectIds: [],
            sliceHealthFilter: "all",
            sliceKindFilter: "all",
            sliceSearch: "",
            subjectFilterMode: "any",
        });
        expect(buildWorkbenchPreviewFiltersAfterSavedEdit({
            editedSlice: target!,
            selectedSubjectIds: ["erina"],
            sliceHealthFilter: "all",
            sliceKindFilter: "event",
            sliceSearch: "durability",
            subjectFilterMode: "any",
        })).toEqual({
            selectedSubjectIds: ["erina"],
            sliceHealthFilter: "all",
            sliceKindFilter: "event",
            sliceSearch: "durability",
            subjectFilterMode: "any",
        });
    });

    it("识别主体系统维护切片，避免技术迁移记录默认占据主视图", () => {
        expect(isWorldWorkbenchSubjectSystemMaintenanceSlice({
            kind: "init",
            title: "主体系统信息边界收口",
            summary: "移除 World Engine 当前状态中的主体系统源文件全文与 RAG 镜像",
        })).toBe(true);
        expect(isWorldWorkbenchSubjectSystemMaintenanceSlice({
            kind: "init",
            title: "旧主体链接初始化",
            summary: "写入 sourcePath / legacyKind",
        })).toBe(true);
        expect(isWorldWorkbenchSubjectSystemMaintenanceSlice({
            kind: "init",
            title: "主体经历记忆初始化",
            summary: "把 events.jsonl 作为角色 episodic memory",
        })).toBe(true);
        expect(isWorldWorkbenchSubjectSystemMaintenanceSlice({
            kind: "event",
            title: "主体系统遭到破坏",
            summary: "这是世界内发生的事件，不是维护切片",
        })).toBe(false);
        expect(isWorldWorkbenchSubjectSystemMaintenanceSlice({
            kind: "init",
            title: "创建 命定之诗世界",
            summary: "初始化世界 subject",
        })).toBe(false);
    });
});
