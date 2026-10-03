import type {
    SubjectStateDto,
    WorkbenchJsonValue,
    WorldIssueDto,
    WorldSchemaProjectionDto,
    WorldSliceDto,
    WorldSlicePatchDto,
    WorldSubjectDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {ProjectRagSourceStatusDto} from "nbook/shared/dto/project-rag.dto";

export type WorldWorkbenchPreviewSubject = WorldSubjectDto;
export type WorldWorkbenchPreviewSchema = WorldSchemaProjectionDto;

export type WorldWorkbenchPreviewSlice = Omit<WorldSliceDto, "patches"> & {
    mutations: WorldSlicePatchDto[];
};

export type WorldWorkbenchPreviewSnapshot = {
    sliceId: string;
    subjects: SubjectStateDto[];
};

export type WorldWorkbenchPreviewSlicePatch = {
    time: string;
    title: string;
    summary: string;
    kind: string;
};

export type WorldWorkbenchPreviewMutationValuePatch = {
    mutationIndex: number;
    sliceId: string;
    value: WorldWorkbenchPreviewJsonValue;
};

export type WorldWorkbenchPreviewMutationListPatch = {
    patches: WorldSlicePatchDto[];
    sliceId: string;
};

export type WorldWorkbenchPreviewValueDraftSummary = {
    attr: string;
    mutationIndex: number;
    sliceId: string;
    sliceTitle: string;
    subjectId: string;
};

export type WorldWorkbenchPreviewMetadataDraftSummary = {
    draftKind: string;
    draftSummary: string;
    draftTime: string;
    draftTitle: string;
    sliceId: string;
    sliceTitle: string;
};

export type WorldWorkbenchPreviewMutationFocus = {
    attr: string;
    issueKey?: string;
    subjectId: string;
};

export type WorldWorkbenchPreviewIssueStatus = "open" | "confirmed" | "ignored";

export type WorldWorkbenchPreviewIssueTriageState = {
    identity?: string;
    key: string;
    status: WorldWorkbenchPreviewIssueStatus;
    updatedAt: string;
};

export type WorldWorkbenchPreviewIssueTriagePatch = {
    identity?: string;
    key: string;
    status: WorldWorkbenchPreviewIssueStatus;
};

export type WorldWorkbenchPreviewIssueTriageSummary = {
    confirmed: number;
    done: number;
    ignored: number;
    open: number;
    total: number;
};

export type WorldWorkbenchPreviewSliceReviewSummary = WorldWorkbenchPreviewIssueTriageSummary & {
    sliceId: string;
};

export type WorldWorkbenchPreviewReviewQueueItem = {
    attr: string;
    code: WorldIssueDto["code"];
    explanation: WorldIssueDto["explanation"];
    identity?: string;
    issueIndex: number;
    key: string;
    label: WorldIssueDto["label"];
    message: string;
    op?: WorldIssueDto["op"];
    patchId?: string;
    path?: string;
    severity: WorldIssueDto["severity"];
    sliceId: string;
    sliceTime: string;
    sliceTitle: string;
    status: WorldWorkbenchPreviewIssueStatus;
    subjectId: string;
    title: string;
};

export type WorldWorkbenchPreviewReviewQueueMode = "open" | "all";

export type WorldWorkbenchPreviewSubjectFilterMode = "any" | "all";

export type WorldWorkbenchPreviewSliceHealthFilter = "all" | "open" | "done" | "clean" | "draft";

export type WorldWorkbenchPreviewSubjectStat = {
    confirmedIssueCount: number;
    doneIssueCount: number;
    ignoredIssueCount: number;
    issueCount: number;
    latestKind: string;
    latestTime: string;
    mutationCount: number;
    openIssueCount: number;
    sliceCount: number;
    subjectId: string;
};

export type WorldWorkbenchPreviewSubjectSystemPath = {
    label: string;
    path: string;
};

export type WorldWorkbenchPreviewSubjectSystemSummary = {
    actorImportPath: string;
    canonicalSource: string;
    controlledBy: string;
    directStatePath: string;
    displayName: string;
    eventCount: number | null;
    leaderOnlyPath: string;
    legacyKind: string;
    memoryCount: number | null;
    mindFileExists: boolean;
    profile: string;
    ragIndexSources: WorldWorkbenchPreviewSubjectSystemPath[];
    sourcePath: string;
    sourceStatuses: ProjectRagSourceStatusDto[];
    stateFileExists: boolean;
    subjectFileExists: boolean;
    subjectFiles: WorldWorkbenchPreviewSubjectSystemPath[];
    subjectId: string;
    subjectSystemVersion: string;
    syncStatus: "linked" | "pending-world-subject" | "orphan-world-subject";
    soulFileExists: boolean;
};

export type WorldWorkbenchSubjectFileProposal = {
    eventDraft: string;
    eventJsonLine: string;
    eventsPath: string;
    memoryFacts: string[];
    memoryJsonLines: string[];
    memoryPath: string;
    statePath: string;
    stateReviewReasons: string[];
    subjectId: string;
    subjectName: string;
    subjectPath: string;
    sliceId: string;
    sliceKind: string;
    sliceTime: string;
    sliceTitle: string;
    sourceKind: "direct-mutation" | "focused-world-context";
    sourceLabel: string;
};

export type WorldWorkbenchPreviewSubjectGroup = {
    subject: WorldWorkbenchPreviewSubject | null;
    subjectId: string;
    mutations: WorldSlicePatchDto[];
};

export type WorldWorkbenchPreviewJsonValue = WorkbenchJsonValue;
