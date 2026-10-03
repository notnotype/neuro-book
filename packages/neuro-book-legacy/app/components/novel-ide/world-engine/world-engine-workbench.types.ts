import type {
    JsonValue,
    WorldPatchOp,
    WorldPreviewSchemaType,
} from "nbook/app/utils/world-engine-preview";

export type WorkbenchJsonValue = JsonValue;

export type WorldSchemaProjectionDto = {
    subjectTypes: WorldPreviewSchemaType[];
    calendar: {
        format: string;
        examples: string[];
    };
};

export type WorldSubjectDto = {
    id: string;
    type: string;
    name: string;
};

export type WorldSlicePatchDto = {
    patchId?: string;
    subjectId: string;
    path: string;
    op: WorldPatchOp;
    value?: WorkbenchJsonValue;
    summary?: string;
};

export type WorldSliceDto = {
    id: string;
    time: string;
    previousTime?: string;
    title: string;
    summary: string;
    kind: string;
    patches?: WorldSlicePatchDto[];
    issues?: WorldIssueDto[];
};

export type SubjectStateDto = {
    subjectId: string;
    type: string;
    attrs: Record<string, WorkbenchJsonValue>;
};

export type WorldIssueSeverityDto = "error" | "advisory";
export type WorldIssueLabelDto = "E1" | "E2" | "E3" | "E4" | "E5" | "A1" | "A2";
export type WorldIssueExplanationDto = {
    whatHappened: string;
    whyItMatters: string;
    suggestedAction: string;
};

/** 数据校验问题：后端负责生成 label/title/explanation，前端只负责展示和 triage。 */
export type WorldIssueDto = {
    code: "broken-relative" | "dangling-ref" | "base-shifted" | "masked" | "invalid-path" | "cross-ref" | "embedding-whole-replace";
    label: WorldIssueLabelDto;
    severity: WorldIssueSeverityDto;
    sliceId?: string;
    patchId?: string;
    subjectId: string;
    attr: string;
    path?: string;
    op?: WorldPatchOp;
    title: string;
    message: string;
    explanation: WorldIssueExplanationDto;
};

export type WorldStateQueryDto = {
    subjects: SubjectStateDto[];
    issues: WorldIssueDto[];
};

export type WorldStateDto = {
    time: string;
    subjects: SubjectStateDto[];
    issues: WorldIssueDto[];
};

export type SliceWriteResultDto = {
    sliceId: string;
    issues: WorldIssueDto[];
};

export type CreateSubjectResultDto = {
    subjectId: string;
    issues: WorldIssueDto[];
};

export type DeleteSliceResultDto = {
    issues: WorldIssueDto[];
};

export type SubjectEventCommitResultDto = {
    status: "appended" | "already-exists";
    subjectId: string;
    subjectPath: string;
    eventsPath: string;
    sliceId?: string;
    event: {
        tick?: string;
        time?: string;
        text: string;
    };
    line: string;
    dirty: boolean;
};
