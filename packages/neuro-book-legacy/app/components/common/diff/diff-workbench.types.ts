export type DiffWorkbenchMode = "diff" | "merge" | "current-base" | "incoming-base";
export type DiffWorkbenchUnavailableReason = "missing" | "binary" | "too_large" | "unsupported";

export type DiffWorkbenchDocument = {
    id: string;
    title: string;
    path?: string;
    language?: string;
    diffable?: boolean;
    unavailableReason?: DiffWorkbenchUnavailableReason;
    notice?: string;
    metadata?: {
        currentBytes?: number;
        incomingBytes?: number;
        currentSha256?: string;
        incomingSha256?: string;
    };
    baseContent?: string;
    currentContent: string;
    incomingContent: string;
    resultContent?: string;
    currentLabel?: string;
    incomingLabel?: string;
    baseLabel?: string;
    resultLabel?: string;
};

export type DiffWorkbenchAction =
    | {id: "cancel"; label?: string; tone?: "default" | "primary" | "danger"; disabled?: boolean; closeOnAction?: boolean}
    | {id: "use-current"; label?: string; tone?: "default" | "primary" | "danger"; disabled?: boolean; closeOnAction?: boolean}
    | {id: "use-incoming"; label?: string; tone?: "default" | "primary" | "danger"; disabled?: boolean; closeOnAction?: boolean}
    | {id: "save-result"; label?: string; tone?: "default" | "primary" | "danger"; disabled?: boolean; closeOnAction?: boolean}
    | {id: "open-file"; label?: string; tone?: "default" | "primary" | "danger"; disabled?: boolean; closeOnAction?: boolean}
    | {id: string; label: string; tone?: "default" | "primary" | "danger"; disabled?: boolean; closeOnAction?: boolean};

export type DiffWorkbenchActionPayload = {
    actionId: string;
    resultContent: string;
    document: DiffWorkbenchDocument;
};
