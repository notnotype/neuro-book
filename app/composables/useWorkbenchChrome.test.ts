import {describe, expect, it} from "vitest";
import {createWorkbenchChromeRegistry} from "nbook/app/composables/useWorkbenchChrome";

describe("Workbench Chrome registry", () => {
    it("lets the active page own title-bar state without stale page cleanup clearing its successor", () => {
        const registry = createWorkbenchChromeRegistry();
        const bookshelf = {
            title: () => "我的书架",
            appearance: () => "light" as const,
            surfaceActive: () => false,
            layoutMode: () => "ide" as const,
            studioPanelOpen: () => false,
            agentJobsActiveCount: () => 0,
            toggleLayoutMode: () => undefined,
            toggleStudioPanel: () => undefined,
        };
        const workspace = {
            ...bookshelf,
            title: () => "第一部",
            surfaceActive: () => true,
        };

        const releaseBookshelf = registry.register(bookshelf);
        const releaseWorkspace = registry.register(workspace);

        releaseBookshelf();
        expect(registry.current.value).toBe(workspace);

        releaseWorkspace();
        expect(registry.current.value).toBeNull();
    });
});
