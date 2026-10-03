import type {
    ProjectRagDebugRequestDto,
    ProjectRagInspectorDto,
    ProjectRagSearchResultDto,
} from "nbook/shared/dto/project-rag.dto";

export type RagInspectorMainMode = "chunks" | "search";
export type RagInspectorLimit = 100 | 200 | 500;
export type RagInspectorSourceFilter = "events" | "memory";
export type RagInspectorDebugAction = ProjectRagDebugRequestDto["action"];
export type RagInspectorChunk = NonNullable<ProjectRagInspectorDto["selectedSubject"]>["chunks"][number];
export type RagInspectorSearchCandidate = ProjectRagSearchResultDto["candidates"][number];
export type RagInspectorDetailSelection = {
    kind: "overview";
} | {
    kind: "chunk";
    chunk: RagInspectorChunk;
} | {
    kind: "search";
    candidate: RagInspectorSearchCandidate;
};
