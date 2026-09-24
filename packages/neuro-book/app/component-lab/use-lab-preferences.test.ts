import {nextTick, ref} from "vue";
import {describe, expect, it} from "vitest";
import {LAB_PREFERENCES_STORAGE_KEY, LAB_SESSION_STORAGE_KEY} from "./lab-preferences-store";
import {useLabPreferences} from "./use-lab-preferences";

const catalog = {
    themeIds: ["nbook", "macos"],
    colorwayIds: ["nbook-light", "nbook-dark"],
    canvasBackdropIds: ["panel", "checker"],
    pageBackdropIds: ["theme", "custom"],
    zooms: [0.5, 1, 2],
    componentNames: ["EditorWorkbench", "ViewportCanvas", "MarkdownView"],
};

const defaults = {
    themeId: "nbook",
    colorwayId: "nbook-dark",
    pageBackdropId: "theme",
    canvasBackdropId: "panel",
    canvasZoom: 1,
    leftPanelWidth: 300,
    rightPanelWidth: 380,
    selectedComponentName: "EditorWorkbench",
    selectedSceneId: "",
};

describe("useLabPreferences", () => {
    it("restores a saved theme and colorway without overwriting them during hydration", async () => {
        const storage = new MemoryStorage();
        storage.setItem(LAB_PREFERENCES_STORAGE_KEY, JSON.stringify({
            schema: 1,
            themeId: "macos",
            colorwayId: "nbook-light",
            canvasZoom: 2,
            activeInspectTab: "commands",
        }));
        const state = createState();
        const preferences = useLabPreferences({
            storage: () => storage,
            catalog,
            defaults,
            state,
            hasCustomWallpaper: () => false,
        });

        await preferences.restore();

        expect(state.themeId.value).toBe("macos");
        expect(state.colorwayId.value).toBe("nbook-light");
        expect(state.canvasZoom.value).toBe("2");
        expect(state.activeInspectTab.value).toBe("commands");
        expect(JSON.parse(storage.getItem(LAB_PREFERENCES_STORAGE_KEY) ?? "{}")).toMatchObject({
            themeId: "macos",
            colorwayId: "nbook-light",
            activeInspectTab: "commands",
        });
    });

    it("persists the user sidebar preference instead of a responsive forced collapse", async () => {
        const storage = new MemoryStorage();
        const state = createState();
        const preferences = useLabPreferences({
            storage: () => storage,
            catalog,
            defaults,
            state,
            hasCustomWallpaper: () => false,
        });
        await preferences.restore();

        state.leftCollapsed.value = true;
        state.rightCollapsed.value = true;
        await nextTick();
        expect(storage.getItem(LAB_PREFERENCES_STORAGE_KEY)).toBeNull();

        preferences.setLeftCollapsed(true);
        await nextTick();
        expect(JSON.parse(storage.getItem(LAB_PREFERENCES_STORAGE_KEY) ?? "{}")).toMatchObject({
            leftCollapsed: true,
            rightCollapsed: false,
        });

        // 拖动侧栏改的是同一份偏好：宽度也要跟着落盘，否则刷新后又弹回默认值
        state.leftPanelWidth.value = 420;
        await nextTick();
        expect(JSON.parse(storage.getItem(LAB_PREFERENCES_STORAGE_KEY) ?? "{}")).toMatchObject({
            leftPanelWidth: 420,
        });
    });

    it("uses defaults and keeps reset safe when the storage accessor throws", async () => {
        const state = createState();
        const preferences = useLabPreferences({
            storage: () => {
                throw new Error("SecurityError");
            },
            catalog,
            defaults,
            state,
            hasCustomWallpaper: () => false,
        });

        await expect(preferences.restore()).resolves.toBeUndefined();
        expect(state.themeId.value).toBe("nbook");
        expect(state.canvasBackdropId.value).toBe("panel");
        await expect(preferences.reset(() => undefined)).resolves.toBeUndefined();
        state.themeId.value = "macos";
        await nextTick();
        expect(state.themeId.value).toBe("macos");
    });

    it("isolates selected component and scene per tab using sessionStorage and keeps localStorage unpolluted", async () => {
        const sharedLocalStorage = new MemoryStorage();
        const tab1Session = new MemoryStorage();
        const tab2Session = new MemoryStorage();

        const stateTab1 = createState();
        const stateTab2 = createState();

        const tab1 = useLabPreferences({
            storage: () => sharedLocalStorage,
            sessionStorage: () => tab1Session,
            catalog,
            defaults,
            state: stateTab1,
            hasCustomWallpaper: () => false,
        });

        const tab2 = useLabPreferences({
            storage: () => sharedLocalStorage,
            sessionStorage: () => tab2Session,
            catalog,
            defaults,
            state: stateTab2,
            hasCustomWallpaper: () => false,
        });

        await tab1.restore();
        await tab2.restore();

        // 标签页 1 选中 EditorWorkbench，标签页 2 选中 ViewportCanvas
        stateTab1.selectedComponentName.value = "EditorWorkbench";
        stateTab1.selectedSceneId.value = "default";
        stateTab2.selectedComponentName.value = "ViewportCanvas";
        stateTab2.selectedSceneId.value = "preview";
        await nextTick();

        // 两个标签页各自的 sessionStorage 存储各自的组件与场景
        expect(JSON.parse(tab1Session.getItem(LAB_SESSION_STORAGE_KEY) ?? "{}")).toMatchObject({
            selectedComponentName: "EditorWorkbench",
            selectedSceneId: "default",
        });
        expect(JSON.parse(tab2Session.getItem(LAB_SESSION_STORAGE_KEY) ?? "{}")).toMatchObject({
            selectedComponentName: "ViewportCanvas",
            selectedSceneId: "preview",
        });

        // 关键：共享的 localStorage 绝对不能被写入 selectedComponentName，避免跨标签页污染
        const localData = JSON.parse(sharedLocalStorage.getItem(LAB_PREFERENCES_STORAGE_KEY) ?? "{}");
        expect(localData.selectedComponentName).toBeUndefined();
        expect(localData.selectedSceneId).toBeUndefined();

        // 标签页 1 刷新（restore），依然恢复为 EditorWorkbench
        const restoredTab1 = createState();
        const tab1Reload = useLabPreferences({
            storage: () => sharedLocalStorage,
            sessionStorage: () => tab1Session,
            catalog,
            defaults,
            state: restoredTab1,
            hasCustomWallpaper: () => false,
        });
        await tab1Reload.restore();
        expect(restoredTab1.selectedComponentName.value).toBe("EditorWorkbench");
        expect(restoredTab1.selectedSceneId.value).toBe("default");

        // 标签页 2 刷新（restore），依然恢复为 ViewportCanvas
        const restoredTab2 = createState();
        const tab2Reload = useLabPreferences({
            storage: () => sharedLocalStorage,
            sessionStorage: () => tab2Session,
            catalog,
            defaults,
            state: restoredTab2,
            hasCustomWallpaper: () => false,
        });
        await tab2Reload.restore();
        expect(restoredTab2.selectedComponentName.value).toBe("ViewportCanvas");
        expect(restoredTab2.selectedSceneId.value).toBe("preview");
    });

    it("prioritizes URL query parameters over sessionStorage and localStorage", async () => {
        const sharedLocalStorage = new MemoryStorage();
        const sessionStore = new MemoryStorage();
        sessionStore.setItem(LAB_SESSION_STORAGE_KEY, JSON.stringify({
            schema: 1,
            selectedComponentName: "EditorWorkbench",
            selectedSceneId: "tab-scene",
        }));
        sharedLocalStorage.setItem(LAB_PREFERENCES_STORAGE_KEY, JSON.stringify({
            schema: 1,
            selectedComponentName: "MarkdownView",
            selectedSceneId: "local-scene",
        }));

        const state = createState();
        const preferences = useLabPreferences({
            storage: () => sharedLocalStorage,
            sessionStorage: () => sessionStore,
            getUrlParams: () => ({component: "ViewportCanvas", scene: "url-scene"}),
            catalog,
            defaults,
            state,
            hasCustomWallpaper: () => false,
        });

        await preferences.restore();

        // URL 参数拥有最高优先级
        expect(state.selectedComponentName.value).toBe("ViewportCanvas");
        expect(state.selectedSceneId.value).toBe("url-scene");
    });

    it("starts in hydrating state and marks hydrating=false after restore completes", async () => {
        const storage = new MemoryStorage();
        const state = createState();
        const preferences = useLabPreferences({
            storage: () => storage,
            catalog,
            defaults,
            state,
            hasCustomWallpaper: () => false,
        });

        // 在 restore 完成前，处于 hydrating 阶段
        expect(preferences.hydrating.value).toBe(true);

        await preferences.restore();

        // restore 完成后，hydrating 结束
        expect(preferences.hydrating.value).toBe(false);
    });

    it("does not apply saved session scene from a different component when URL specifies a new component without scene", async () => {
        const sessionStore = new MemoryStorage();
        sessionStore.setItem(LAB_SESSION_STORAGE_KEY, JSON.stringify({
            schema: 1,
            selectedComponentName: "EditorWorkbench",
            selectedSceneId: "tab-scene",
        }));

        const state = createState();
        const preferences = useLabPreferences({
            storage: () => new MemoryStorage(),
            sessionStorage: () => sessionStore,
            getUrlParams: () => ({component: "ViewportCanvas"}),
            catalog,
            defaults,
            state,
            hasCustomWallpaper: () => false,
        });

        await preferences.restore();

        expect(state.selectedComponentName.value).toBe("ViewportCanvas");
        // ViewportCanvas 没有在 URL 中给 scene，且不同于 session 中的 EditorWorkbench，不应继承 tab-scene
        expect(state.selectedSceneId.value).toBe("");
    });
});

function createState() {
    return {
        themeId: ref("nbook"),
        colorwayId: ref("nbook-dark"),
        pageBackdropId: ref("theme"),
        canvasBackdropId: ref("panel"),
        canvasZoom: ref("1"),
        canvasWidth: ref(0),
        canvasHeight: ref(0),
        leftCollapsed: ref(false),
        rightCollapsed: ref(false),
        preferredLeftCollapsed: ref(false),
        preferredRightCollapsed: ref(false),
        leftPanelWidth: ref(300),
        rightPanelWidth: ref(380),
        selectedComponentName: ref(""),
        selectedSceneId: ref(""),
        activeInspectTab: ref("doc"),
    };
}

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();

    get length(): number {
        return this.values.size;
    }

    clear(): void {
        this.values.clear();
    }

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}
