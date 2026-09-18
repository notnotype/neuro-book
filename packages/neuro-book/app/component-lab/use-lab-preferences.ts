import {nextTick, ref, watch} from "vue";
import type {Ref} from "vue";
import {clearLabPreferences, loadLabPreferences, saveLabPreferences} from "./lab-preferences-store";
import type {LabPreferenceCatalog, LabPreferences} from "./lab-preferences-store";

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
};

export function useLabPreferences(options: UseLabPreferencesOptions) {
    const hydrating = ref(false);
    let ready = false;

    function current(): LabPreferences {
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
        const saved = storage === null ? {} : loadLabPreferences(storage, options.catalog);
        const state = options.state;
        const defaults = options.defaults;
        state.themeId.value = saved.themeId ?? defaults.themeId;
        state.colorwayId.value = saved.colorwayId ?? defaults.colorwayId;
        state.pageBackdropId.value = saved.pageBackdropId === "custom" && !options.hasCustomWallpaper()
            ? defaults.pageBackdropId
            : saved.pageBackdropId ?? defaults.pageBackdropId;
        state.canvasBackdropId.value = saved.canvasBackdropId ?? defaults.canvasBackdropId;
        state.canvasZoom.value = String(saved.canvasZoom ?? defaults.canvasZoom);
        state.canvasWidth.value = saved.canvasWidth ?? 0;
        state.canvasHeight.value = saved.canvasHeight ?? 0;
        state.preferredLeftCollapsed.value = saved.leftCollapsed ?? false;
        state.preferredRightCollapsed.value = saved.rightCollapsed ?? false;
        state.leftCollapsed.value = state.preferredLeftCollapsed.value;
        state.rightCollapsed.value = state.preferredRightCollapsed.value;
        state.leftPanelWidth.value = saved.leftPanelWidth ?? defaults.leftPanelWidth;
        state.rightPanelWidth.value = saved.rightPanelWidth ?? defaults.rightPanelWidth;
        if (state.selectedComponentName && saved.selectedComponentName) {
            state.selectedComponentName.value = saved.selectedComponentName;
        }
        if (state.selectedSceneId && saved.selectedSceneId) {
            state.selectedSceneId.value = saved.selectedSceneId;
        }
        if (state.activeInspectTab && saved.activeInspectTab) {
            state.activeInspectTab.value = saved.activeInspectTab;
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

    const watchedRefs = [
        options.state.themeId,
        options.state.colorwayId,
        options.state.pageBackdropId,
        options.state.canvasBackdropId,
        options.state.canvasZoom,
        options.state.canvasWidth,
        options.state.canvasHeight,
        options.state.preferredLeftCollapsed,
        options.state.preferredRightCollapsed,
        options.state.leftPanelWidth,
        options.state.rightPanelWidth,
        ...(options.state.selectedComponentName ? [options.state.selectedComponentName] : []),
        ...(options.state.selectedSceneId ? [options.state.selectedSceneId] : []),
        ...(options.state.activeInspectTab ? [options.state.activeInspectTab] : []),
    ];

    watch(watchedRefs, () => {
        const storage = getStorage();
        if (ready && storage !== null) {
            saveLabPreferences(storage, current());
        }
    });

    function getStorage(): Storage | null {
        try {
            return options.storage();
        } catch {
            return null;
        }
    }

    return {hydrating, reset, restore, setLeftCollapsed, setRightCollapsed};
}
