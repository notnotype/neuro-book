export const LAB_PREFERENCES_STORAGE_KEY = "nb-lab:preferences:v1";

export type LabPreferenceCatalog = {
    themeIds: readonly string[];
    colorwayIds: readonly string[];
    canvasBackdropIds: readonly string[];
    pageBackdropIds: readonly string[];
    zooms: readonly number[];
};

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
    key: "themeId" | "colorwayId" | "pageBackdropId" | "canvasBackdropId",
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
