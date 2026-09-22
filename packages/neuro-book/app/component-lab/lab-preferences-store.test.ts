import {describe, expect, it} from "vitest";
import {
    LAB_PREFERENCES_STORAGE_KEY,
    clearLabPreferences,
    loadLabPreferences,
    saveLabPreferences,
} from "./lab-preferences-store";
import type {LabPreferenceCatalog, LabPreferences} from "./lab-preferences-store";

const catalog: LabPreferenceCatalog = {
    themeIds: ["nbook", "macos"],
    colorwayIds: ["nbook-light", "nbook-dark"],
    canvasBackdropIds: ["panel", "checker"],
    pageBackdropIds: ["theme", "custom"],
    zooms: [0.5, 1, 2],
    componentNames: ["EditorWorkbench", "ViewportCanvas", "MarkdownView"],
};

const preferences: LabPreferences = {
    schema: 1,
    themeId: "macos",
    colorwayId: "nbook-light",
    pageBackdropId: "custom",
    canvasBackdropId: "checker",
    canvasZoom: 2,
    canvasWidth: 390,
    canvasHeight: 844,
    leftCollapsed: true,
    rightCollapsed: false,
    leftPanelWidth: 320,
    rightPanelWidth: 420,
    selectedComponentName: "EditorWorkbench",
    selectedSceneId: "mixed",
    activeInspectTab: "data",
};

describe("Lab preferences store", () => {
    it("round-trips validated Lab-only UI preferences", () => {
        const storage = new MemoryStorage();

        expect(saveLabPreferences(storage, preferences)).toBe(true);
        expect(loadLabPreferences(storage, catalog)).toEqual(preferences);

        // 第五个检视 tab 也走同一份白名单往返
        storage.clear();
        expect(saveLabPreferences(storage, {...preferences, activeInspectTab: "commands"})).toBe(true);
        expect(loadLabPreferences(storage, catalog)).toEqual({...preferences, activeInspectTab: "commands"});
    });

    it("keeps valid fields and drops untrusted values independently", () => {
        const storage = new MemoryStorage();
        storage.setItem(LAB_PREFERENCES_STORAGE_KEY, JSON.stringify({
            schema: 1,
            themeId: "macos",
            colorwayId: "foreign-colorway",
            pageBackdropId: "theme",
            canvasBackdropId: "foreign-backdrop",
            canvasZoom: 3,
            canvasWidth: -1,
            canvasHeight: 1200.5,
            leftCollapsed: true,
            rightCollapsed: "false",
            // 越界、非整数与其它类型的宽度都要丢掉：它们是上次拖动留下的，不能静默变成另一个值
            leftPanelWidth: 9_999,
            rightPanelWidth: 300.5,
            selectedComponentName: "NonExistentComponent",
            selectedSceneId: "invalid scene with spaces!",
            activeInspectTab: "unsupported-tab",
            fixtureData: {secret: "must not enter the preference model"},
        }));

        expect(loadLabPreferences(storage, catalog)).toEqual({
            schema: 1,
            themeId: "macos",
            pageBackdropId: "theme",
            leftCollapsed: true,
        });
    });

    it("ignores malformed JSON and unknown schema versions", () => {
        const storage = new MemoryStorage();
        storage.setItem(LAB_PREFERENCES_STORAGE_KEY, "{");
        expect(loadLabPreferences(storage, catalog)).toEqual({});

        storage.setItem(LAB_PREFERENCES_STORAGE_KEY, JSON.stringify({schema: 2, themeId: "macos"}));
        expect(loadLabPreferences(storage, catalog)).toEqual({});
    });

    it("fails open when browser storage rejects writes or deletion", () => {
        const storage = new ThrowingStorage();

        expect(saveLabPreferences(storage, preferences)).toBe(false);
        expect(clearLabPreferences(storage)).toBe(false);
        expect(loadLabPreferences(storage, catalog)).toEqual({});
    });
});

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

class ThrowingStorage implements Storage {
    get length(): number {
        return 0;
    }

    clear(): void {
        throw new Error("blocked");
    }

    getItem(): string | null {
        throw new Error("blocked");
    }

    key(): string | null {
        return null;
    }

    removeItem(): void {
        throw new Error("blocked");
    }

    setItem(): void {
        throw new Error("quota");
    }
}
