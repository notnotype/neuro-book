import {nextTick, ref} from "vue";
import {describe, expect, it} from "vitest";
import {LAB_PREFERENCES_STORAGE_KEY} from "./lab-preferences-store";
import {useLabPreferences} from "./use-lab-preferences";

const catalog = {
    themeIds: ["nbook", "macos"],
    colorwayIds: ["nbook-light", "nbook-dark"],
    canvasBackdropIds: ["panel", "checker"],
    pageBackdropIds: ["theme", "custom"],
    zooms: [0.5, 1, 2],
};

const defaults = {
    themeId: "nbook",
    colorwayId: "nbook-dark",
    pageBackdropId: "theme",
    canvasBackdropId: "panel",
    canvasZoom: 1,
    leftPanelWidth: 300,
    rightPanelWidth: 380,
};

describe("useLabPreferences", () => {
    it("restores a saved theme and colorway without overwriting them during hydration", async () => {
        const storage = new MemoryStorage();
        storage.setItem(LAB_PREFERENCES_STORAGE_KEY, JSON.stringify({
            schema: 1,
            themeId: "macos",
            colorwayId: "nbook-light",
            canvasZoom: 2,
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
        expect(JSON.parse(storage.getItem(LAB_PREFERENCES_STORAGE_KEY) ?? "{}")).toMatchObject({
            themeId: "macos",
            colorwayId: "nbook-light",
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
