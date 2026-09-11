import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import type {ProjectPickerRecoveryEntry, ProjectPickerRecoveryState} from "nbook/app/utils/project-picker-recovery";
import type {ProjectCoverRecoveryState} from "nbook/app/utils/project-cover-recovery";

export interface ProjectPickerCreatePayload {
    title: string;
    summary: string;
    genre?: string;
}

export interface ProjectPickerRecoverSessionPayload {
    session: AgentSessionSummaryDto;
    targetProjectRoot: string | null;
}

export interface ProjectPickerCoverMutationPayload {
    project: ProjectMetadataDto;
    file: File | null;
}

export interface ProjectPickerViewProps {
    projects: readonly ProjectMetadataDto[];
    projectTags?: Record<string, readonly string[]> | ((project: ProjectMetadataDto) => readonly string[] | undefined);
    isLoading?: boolean;
    loadError?: string;
    isCreating?: boolean;
    isCreateFormOpen?: boolean;
    createRecoveryNotice?: string;
    createRecovery?: ProjectPickerRecoveryEntry | null;
    deleteBusyRoots?: ReadonlySet<string>;
    pickerRecoveries?: ProjectPickerRecoveryState;
    coverRecoveries?: ProjectCoverRecoveryState;
    coverRefreshVersions?: Record<string, number>;
    failedCoverRoots?: ReadonlySet<string>;
    recoveryExpanded?: boolean;
    recoveryLoading?: boolean;
    recoveryLoaded?: boolean;
    recoveryError?: string;
    recoverySessions?: readonly AgentSessionSummaryDto[];
    recoveryTotal?: number;
    recoveryHasMore?: boolean;
    recoveryActionId?: number | null;
    resolveCoverUrl?: (projectRoot: string) => string;
    resolveOriginalCoverUrl?: (projectRoot: string) => string;
    coverDialogOpen?: boolean;
    coverDialogProject?: ProjectMetadataDto | null;
    coverBusy?: boolean;
    coverError?: string;
    coverRecoveryNotice?: string;
    teleportTarget?: string | boolean;
}

export interface ProjectPickerViewEmits {
    (e: "open", projectRoot: string): void;
    (e: "open-user-assets"): void;
    (e: "open-create-form"): void;
    (e: "cancel-create-form"): void;
    (e: "create", payload: ProjectPickerCreatePayload): void;
    (e: "retry-create-recovery"): void;
    (e: "delete", project: ProjectMetadataDto): void;
    (e: "retry-delete-recovery", projectRoot: string): void;
    (e: "retry-load"): void;
    (e: "toggle-recovery"): void;
    (e: "load-more-recovery"): void;
    (e: "retry-recovery"): void;
    (e: "recover-session", payload: ProjectPickerRecoverSessionPayload): void;
    (e: "open-cover-dialog", project: ProjectMetadataDto): void;
    (e: "close-cover-dialog"): void;
    (e: "upload-cover", payload: {project: ProjectMetadataDto; file: File}): void;
    (e: "clear-cover", project: ProjectMetadataDto): void;
    (e: "retry-cover-recovery", projectRoot: string): void;
    (e: "cover-error", projectRoot: string): void;
    (e: "update:coverDialogOpen", value: boolean): void;
    (e: "update:coverDialogProject", value: ProjectMetadataDto | null): void;
}
