export const LAB_PREFERENCES_STORAGE_KEY = "nb-lab:preferences:v1";

export type LabPreferenceCatalog = {
    themeIds: readonly string[];
    colorwayIds: readonly string[];
    canvasBackdropIds: readonly string[];
    pageBackdropIds: readonly string[];
    zooms: readonly number[];
    componentNames?: readonly string[];
};

/**
 * 侧栏宽度的边界：拖拽与恢复共用同一组值，避免两处各夹一次。
 * 上限只守「另一栏与画布还站得住」以外的部分，真正的上限还要看窗口宽度（在 LabShell 里算）。
 */
export const LAB_PANEL_WIDTH_LIMITS = {
    left: {min: 220, max: 560},
    right: {min: 280, max: 720},
} as const;

export type LabPanelSide = keyof typeof LAB_PANEL_WIDTH_LIMITS;

export type LabPreferences = {
    schema?: 1;
    themeId?: string;
    colorwayId?: string;
    pageBackdropId?: string;
    canvasBackdropId?: string;
    canvasZoom?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    leftCollapsed?: boolean;
    rightCollapsed?: boolean;
    /** 左侧栏（组件树）宽度，px */
    leftPanelWidth?: number;
    /** 右侧栏（检视）宽度，px */
    rightPanelWidth?: number;
    /** 当前选中的组件名 */
    selectedComponentName?: string;
    /** 当前选中的场景 ID */
    selectedSceneId?: string;
    /** 右侧检视栏激活的 Tab */
    activeInspectTab?: string;
};

const MAX_CANVAS_SIZE = 16_384;

export function loadLabPreferences(storage: Storage, catalog: LabPreferenceCatalog): LabPreferences {
    try {
        const raw = storage.getItem(LAB_PREFERENCES_STORAGE_KEY);
        if (raw === null) {
            return {};
        }
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed) || parsed.schema !== 1) {
            return {};
        }
        const preferences: LabPreferences = {schema: 1};
        copyAllowedString(parsed, "themeId", catalog.themeIds, preferences);
        copyAllowedString(parsed, "colorwayId", catalog.colorwayIds, preferences);
        copyAllowedString(parsed, "pageBackdropId", catalog.pageBackdropIds, preferences);
        copyAllowedString(parsed, "canvasBackdropId", catalog.canvasBackdropIds, preferences);
        if (typeof parsed.canvasZoom === "number" && catalog.zooms.includes(parsed.canvasZoom)) {
            preferences.canvasZoom = parsed.canvasZoom;
        }
        copyCanvasSize(parsed, "canvasWidth", preferences);
        copyCanvasSize(parsed, "canvasHeight", preferences);
        copyBoolean(parsed, "leftCollapsed", preferences);
        copyBoolean(parsed, "rightCollapsed", preferences);
        copyPanelWidth(parsed, "leftPanelWidth", LAB_PANEL_WIDTH_LIMITS.left, preferences);
        copyPanelWidth(parsed, "rightPanelWidth", LAB_PANEL_WIDTH_LIMITS.right, preferences);
        if (catalog.componentNames) {
            copyAllowedString(parsed, "selectedComponentName", catalog.componentNames, preferences);
        } else if (typeof parsed.selectedComponentName === "string" && parsed.selectedComponentName.length <= 100) {
            preferences.selectedComponentName = parsed.selectedComponentName;
        }
        if (typeof parsed.selectedSceneId === "string" && /^[a-zA-Z0-9_.-]+$/.test(parsed.selectedSceneId) && parsed.selectedSceneId.length <= 100) {
            preferences.selectedSceneId = parsed.selectedSceneId;
        }
        if (typeof parsed.activeInspectTab === "string" && ["doc", "events", "data", "element"].includes(parsed.activeInspectTab)) {
            preferences.activeInspectTab = parsed.activeInspectTab;
        }
        return preferences;
    } catch {
        return {};
    }
}

export function saveLabPreferences(storage: Storage, preferences: LabPreferences): boolean {
    try {
        storage.setItem(LAB_PREFERENCES_STORAGE_KEY, JSON.stringify({...preferences, schema: 1}));
        return true;
    } catch {
        return false;
    }
}

export function clearLabPreferences(storage: Storage): boolean {
    try {
        storage.removeItem(LAB_PREFERENCES_STORAGE_KEY);
        return true;
    } catch {
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyAllowedString(
    source: Record<string, unknown>,
    key: "themeId" | "colorwayId" | "pageBackdropId" | "canvasBackdropId" | "selectedComponentName",
    allowed: readonly string[],
    target: LabPreferences,
): void {
    const value = source[key];
    if (typeof value === "string" && allowed.includes(value)) {
        target[key] = value;
    }
}

function copyCanvasSize(
    source: Record<string, unknown>,
    key: "canvasWidth" | "canvasHeight",
    target: LabPreferences,
): void {
    const value = source[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_CANVAS_SIZE) {
        target[key] = value;
    }
}

function copyBoolean(
    source: Record<string, unknown>,
    key: "leftCollapsed" | "rightCollapsed",
    target: LabPreferences,
): void {
    const value = source[key];
    if (typeof value === "boolean") {
        target[key] = value;
    }
}

/** 越界与小数一律丢弃而不是夹紧：夹紧会让「拖动前的旧值」静默变成另一个宽度。 */
function copyPanelWidth(
    source: Record<string, unknown>,
    key: "leftPanelWidth" | "rightPanelWidth",
    limits: {readonly min: number; readonly max: number},
    target: LabPreferences,
): void {
    const value = source[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= limits.min && value <= limits.max) {
        target[key] = value;
    }
}
