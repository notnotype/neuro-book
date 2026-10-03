import type {AgentProfileCatalogItemDto} from "nbook/shared/dto/agent-profile.dto";
import type {
    ProfileTemplateNodeType,
    ProfileTemplatePropValue,
} from "nbook/shared/dto/profile-template.dto";

export type ComponentLibraryGroup = "all" | "sets" | "messages" | "flow" | "privileged";

export type ComponentLibraryItem = {
    type: ProfileTemplateNodeType;
    label: string;
    description: string;
    iconClass: string;
    group: ComponentLibraryGroup;
};

export type ComponentLibraryGroupView = {
    group: ComponentLibraryGroup;
    label: string;
    items: ComponentLibraryItem[];
};

export type InspectorTab = "source" | "props" | "variables" | "runtime" | "agent";

export type SelectOption = {
    value: string;
    label: string;
    description?: string;
    meta?: AgentProfileCatalogItemDto;
};

export type PreviewVariableItem = {
    label: string;
    value: string;
    path: string;
    currentValue?: unknown;
    editable: boolean;
    description?: string;
    valueType: string;
    source: string;
    schema?: Record<string, unknown> | null;
    children?: PreviewVariableItem[];
};

export type PreviewVariableGroup = {
    group: string;
    items: PreviewVariableItem[];
};

export type SelectedPropEntry = [string, ProfileTemplatePropValue];
