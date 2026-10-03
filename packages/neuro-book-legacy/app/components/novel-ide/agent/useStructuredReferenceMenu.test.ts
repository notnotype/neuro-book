import {describe, expect, it, vi} from "vitest";
import {nextTick, ref} from "vue";
import {useStructuredReferenceMenu} from "nbook/app/composables/useStructuredReferenceMenu";

const skillItems = [
    {
        name: "小说初始化流程",
        description: "初始化小说项目。",
        sourcePath: "assets/agent/skills/小说初始化流程/SKILL.md",
        metadata: {},
    },
];

describe("useStructuredReferenceMenu", () => {
    it("coalesces concurrent skill catalog refreshes and updates the active menu", async () => {
        let resolveFetch: (items: typeof skillItems) => void = () => {};
        const fetchMock = vi.fn(() => new Promise<typeof skillItems>((resolve) => {
            resolveFetch = resolve;
        }));
        const previousFetch = globalThis.$fetch;
        globalThis.$fetch = fetchMock as unknown as typeof globalThis.$fetch;

        try {
            const menu = useStructuredReferenceMenu({
                novelId: ref("workspace/test"),
                selectedStoryThreadId: ref(null),
                selectedStorySceneId: ref(null),
                workspaceTree: ref([]),
            });

            const initialState = menu.resolveMenu({kind: "skill", query: "小说"});
            void menu.refreshSkillCatalog();

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(initialState.sections[0]?.items[0]?.id).toBe("skill:loading");

            resolveFetch(skillItems);
            await Promise.resolve();
            await nextTick();

            const loadedState = menu.resolveMenu({kind: "skill", query: "小说"});

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(loadedState.sections[0]?.items[0]?.id).toBe("skill:小说初始化流程");

            await menu.refreshSkillCatalog();
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            globalThis.$fetch = previousFetch;
        }
    });
});
