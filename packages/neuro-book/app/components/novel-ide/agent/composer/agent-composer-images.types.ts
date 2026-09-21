import type {ComposerImageEditorPort} from "nbook/app/components/novel-ide/agent/useComposerImageTransaction";
import type {
    ComposerImageNode,
    ComposerPendingImage,
    ComposerStableImage,
    ComposerImageUsage,
} from "nbook/app/components/novel-ide/agent/composer-image-transaction";
import type {AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";

export type AgentImageEditorTarget = "composer" | "history";

export interface AgentComposerImagesState {
    generation: number;
    stableImages: readonly ComposerStableImage[];
    pendingImages: readonly ComposerPendingImage[];
    usage: ComposerImageUsage;
    failed: boolean;
    metadataError: boolean;
    budgetError: boolean;
    canRegister: boolean;
    canInsert: boolean;
    menuRefreshKey: string | number;
    resolvedItems: readonly AgentSessionAttachmentItemDto[];
}

export interface AgentEditorReadyEvent {
    target: AgentImageEditorTarget;
    editorId: string;
    editor: ComposerImageEditorPort | null;
}

export interface AgentImageFilesEvent {
    target: AgentImageEditorTarget;
    files: readonly File[];
    position?: number;
}

export interface AgentImageDocumentEvent {
    target: AgentImageEditorTarget;
    nodes: readonly ComposerImageNode[];
}

export interface AgentImageRetryEvent {
    target: AgentImageEditorTarget;
    uploadId: string;
}

export interface AgentImageRemoveEvent {
    target: AgentImageEditorTarget;
    uploadId: string;
}

export interface AgentImageRetryMetadataEvent {
    target: AgentImageEditorTarget;
}

export interface AgentImageFilesBlockedEvent {
    target: AgentImageEditorTarget;
}
