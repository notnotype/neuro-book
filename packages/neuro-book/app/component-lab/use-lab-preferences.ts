import {nextTick, ref, watch} from "vue";
import type {Ref} from "vue";
import {
    clearLabPreferences,
    clearLabSession,
    loadLabPreferences,
    loadLabSession,
    saveLabPreferences,
    saveLabSession,
} from "./lab-preferences-store";
import type {LabPreferenceCatalog, LabPreferences, LabSessionState} from "./lab-preferences-store";

type LabPreferenceState = {
    themeId: Ref<string>;
    colorwayId: Ref<string>;
    pageBackdropId: Ref<string>;
    canvasBackdropId: Ref<string>;
    canvasZoom: Ref<string>;
    canvasWidth: Ref<number>;
    canvasHeight: Ref<number>;
    leftCollapsed: Ref<boolean>;
    rightCollapsed: Ref<boolean>;
    preferredLeftCollapsed: Ref<boolean>;
    preferredRightCollapsed: Ref<boolean>;
    leftPanelWidth: Ref<number>;
    rightPanelWidth: Ref<number>;
    selectedComponentName?: Ref<string>;
    selectedSceneId?: Ref<string>;
    activeInspectTab?: Ref<string>;
};

type LabPreferenceDefaults = {
    themeId: string;
    colorwayId: string;
    pageBackdropId: string;
    canvasBackdropId: string;
    canvasZoom: number;
    leftPanelWidth: number;
    rightPanelWidth: number;
    selectedComponentName?: string;
    selectedSceneId?: string;
    activeInspectTab?: string;
};

type UseLabPreferencesOptions = {
    storage: () => Storage;
    catalog: LabPreferenceCatalog;
    defaults: LabPreferenceDefaults;
    state: LabPreferenceState;
    hasCustomWallpaper: () => boolean;
    sessionStorage?: () => Storage;
    getUrlParams?: () => {component?: string; scene?: string};
};

export function useLabPreferences(options: UseLabPreferencesOptions) {
    const hydrating = ref(true);
    let ready = false;

    function currentPreferences(): LabPreferences {
        const state = options.state;
        const res: LabPreferences = {
            schema: 1,
            themeId: state.themeId.value,
            colorwayId: state.colorwayId.value,
            pageBackdropId: state.pageBackdropId.value,
            canvasBackdropId: state.canvasBackdropId.value,
            canvasZoom: Number(state.canvasZoom.value),
            canvasWidth: state.canvasWidth.value,
            canvasHeight: state.canvasHeight.value,
            leftCollapsed: state.preferredLeftCollapsed.value,
            rightCollapsed: state.preferredRightCollapsed.value,
            leftPanelWidth: state.leftPanelWidth.value,
            rightPanelWidth: state.rightPanelWidth.value,
        };
        // 仅在未提供独立 sessionStorage 访问器时（例如轻量测试模式），才在 localStorage 里兜底回写这些字段
        if (!options.sessionStorage) {
            if (state.selectedComponentName?.value) {
                res.selectedComponentName = state.selectedComponentName.value;
            }
            if (state.selectedSceneId?.value) {
                res.selectedSceneId = state.selectedSceneId.value;
            }
            if (state.activeInspectTab?.value) {
                res.activeInspectTab = state.activeInspectTab.value;
            }
        }
        return res;
    }

    function currentSession(): LabSessionState {
        const state = options.state;
        const res: LabSessionState = {
            schema: 1,
            canvasZoom: Number(state.canvasZoom.value),
            canvasWidth: state.canvasWidth.value,
            canvasHeight: state.canvasHeight.value,
        };
        if (state.selectedComponentName?.value) {
            res.selectedComponentName = state.selectedComponentName.value;
        }
        if (state.selectedSceneId?.value) {
            res.selectedSceneId = state.selectedSceneId.value;
        }
        if (state.activeInspectTab?.value) {
            res.activeInspectTab = state.activeInspectTab.value;
        }
        return res;
    }

    async function restore(): Promise<void> {
        hydrating.value = true;
        const storage = getStorage();
        const savedPrefs = storage === null ? {} : loadLabPreferences(storage, options.catalog);
        const sessionStore = getSessionStorage();
        const savedSession = sessionStore === null ? {} : loadLabSession(sessionStore, options.catalog);
        const urlParams = options.getUrlParams ? options.getUrlParams() : undefined;

        const state = options.state;
        const defaults = options.defaults;
        state.themeId.value = savedPrefs.themeId ?? defaults.themeId;
        state.colorwayId.value = savedPrefs.colorwayId ?? defaults.colorwayId;
        state.pageBackdropId.value = savedPrefs.pageBackdropId === "custom" && !options.hasCustomWallpaper()
            ? defaults.pageBackdropId
            : savedPrefs.pageBackdropId ?? defaults.pageBackdropId;
        state.canvasBackdropId.value = savedPrefs.canvasBackdropId ?? defaults.canvasBackdropId;

        // 缩放与尺寸优先从 session 读取，其次偏好，最后默认值
        state.canvasZoom.value = String(savedSession.canvasZoom ?? savedPrefs.canvasZoom ?? defaults.canvasZoom);
        state.canvasWidth.value = savedSession.canvasWidth ?? savedPrefs.canvasWidth ?? 0;
        state.canvasHeight.value = savedSession.canvasHeight ?? savedPrefs.canvasHeight ?? 0;

        state.preferredLeftCollapsed.value = savedPrefs.leftCollapsed ?? false;
        state.preferredRightCollapsed.value = savedPrefs.rightCollapsed ?? false;
        state.leftCollapsed.value = state.preferredLeftCollapsed.value;
        state.rightCollapsed.value = state.preferredRightCollapsed.value;
        state.leftPanelWidth.value = savedPrefs.leftPanelWidth ?? defaults.leftPanelWidth;
        state.rightPanelWidth.value = savedPrefs.rightPanelWidth ?? defaults.rightPanelWidth;

        // 组件恢复优先级：URL 参数 > sessionStorage > localStorage 兜底 > defaults
        const urlComponent = resolveValidComponent(urlParams?.component, options.catalog);
        const resolvedComponent = urlComponent
            ?? savedSession.selectedComponentName
            ?? savedPrefs.selectedComponentName
            ?? defaults.selectedComponentName
            ?? "";
        if (state.selectedComponentName) {
            state.selectedComponentName.value = resolvedComponent;
        }
        if (state.selectedSceneId) {
            const urlScene = resolveValidScene(urlParams?.scene);
            const isSameSessionComp = !urlComponent || urlComponent === savedSession.selectedComponentName;
            const isSamePrefsComp = !urlComponent || urlComponent === savedPrefs.selectedComponentName;
            state.selectedSceneId.value = urlScene
                ?? (isSameSessionComp ? savedSession.selectedSceneId : undefined)
                ?? (isSamePrefsComp ? savedPrefs.selectedSceneId : undefined)
                ?? defaults.selectedSceneId
                ?? "";
        }
        if (state.activeInspectTab) {
            state.activeInspectTab.value = savedSession.activeInspectTab
                ?? savedPrefs.activeInspectTab
                ?? defaults.activeInspectTab
                ?? "doc";
        }
        await nextTick();
        hydrating.value = false;
        ready = true;
    }

    async function reset(applyResponsiveLayout: () => void): Promise<void> {
        ready = false;
        hydrating.value = true;
        const storage = getStorage();
        if (storage !== null) {
            clearLabPreferences(storage);
        }
        const sessionStore = getSessionStorage();
        if (sessionStore !== null) {
            clearLabSession(sessionStore);
        }
        const state = options.state;
        const defaults = options.defaults;
        state.themeId.value = defaults.themeId;
        state.colorwayId.value = defaults.colorwayId;
        state.pageBackdropId.value = defaults.pageBackdropId;
        state.canvasBackdropId.value = defaults.canvasBackdropId;
        state.canvasZoom.value = String(defaults.canvasZoom);
        state.canvasWidth.value = 0;
        state.canvasHeight.value = 0;
        state.preferredLeftCollapsed.value = false;
        state.preferredRightCollapsed.value = false;
        state.leftCollapsed.value = false;
        state.rightCollapsed.value = false;
        state.leftPanelWidth.value = defaults.leftPanelWidth;
        state.rightPanelWidth.value = defaults.rightPanelWidth;
        if (state.selectedComponentName) {
            state.selectedComponentName.value = defaults.selectedComponentName ?? "";
        }
        if (state.selectedSceneId) {
            state.selectedSceneId.value = defaults.selectedSceneId ?? "";
        }
        if (state.activeInspectTab) {
            state.activeInspectTab.value = defaults.activeInspectTab ?? "doc";
        }
        applyResponsiveLayout();
        await nextTick();
        hydrating.value = false;
        ready = true;
    }

    function setLeftCollapsed(value: boolean): void {
        options.state.leftCollapsed.value = value;
        options.state.preferredLeftCollapsed.value = value;
    }

    function setRightCollapsed(value: boolean): void {
        options.state.rightCollapsed.value = value;
        options.state.preferredRightCollapsed.value = value;
    }

    const watchedPreferencesRefs = [
        options.state.themeId,
        options.state.colorwayId,
        options.state.pageBackdropId,
        options.state.canvasBackdropId,
        options.state.preferredLeftCollapsed,
        options.state.preferredRightCollapsed,
        options.state.leftPanelWidth,
        options.state.rightPanelWidth,
    ];

    watch(watchedPreferencesRefs, () => {
        const storage = getStorage();
        if (ready && storage !== null) {
            saveLabPreferences(storage, currentPreferences());
        }
    });

    const watchedSessionRefs = [
        options.state.canvasZoom,
        options.state.canvasWidth,
        options.state.canvasHeight,
        ...(options.state.selectedComponentName ? [options.state.selectedComponentName] : []),
        ...(options.state.selectedSceneId ? [options.state.selectedSceneId] : []),
        ...(options.state.activeInspectTab ? [options.state.activeInspectTab] : []),
    ];

    watch(watchedSessionRefs, () => {
        if (!ready) {
            return;
        }
        if (options.sessionStorage) {
            const sessionStore = getSessionStorage();
            if (sessionStore !== null) {
                saveLabSession(sessionStore, currentSession());
            }
        } else {
            // 降级模式：若无独立的 sessionStorage（例如旧单元测试），仍保持存入 storage
            const storage = getStorage();
            if (storage !== null) {
                saveLabPreferences(storage, currentPreferences());
            }
        }
    });

    function getStorage(): Storage | null {
        try {
            return options.storage();
        } catch {
            return null;
        }
    }

    function getSessionStorage(): Storage | null {
        try {
            if (options.sessionStorage) {
                return options.sessionStorage();
            }
            return options.storage();
        } catch {
            return null;
        }
    }

    return {hydrating, reset, restore, setLeftCollapsed, setRightCollapsed};
}

function resolveValidComponent(name: string | undefined, catalog: LabPreferenceCatalog): string | undefined {
    if (!name || typeof name !== "string") {
        return undefined;
    }
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
        return undefined;
    }
    if (catalog.componentNames && !catalog.componentNames.includes(trimmed)) {
        return undefined;
    }
    return trimmed;
}

function resolveValidScene(scene: string | undefined): string | undefined {
    if (!scene || typeof scene !== "string") {
        return undefined;
    }
    const trimmed = scene.trim();
    if (trimmed.length === 0 || trimmed.length > 100 || !/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}
