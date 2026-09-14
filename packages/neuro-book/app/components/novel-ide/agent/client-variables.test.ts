import {describe, expect, it} from "vitest";
import {applyClientVariablePatch, buildAgentClientState} from "nbook/app/components/novel-ide/agent/client-variables";
import type {VariablePatchRequest} from "nbook/server/agent/variables/types";

function buildState() {
    return buildAgentClientState({
        activePanel: "manuscript",
        theme: "nbook",
        novelId: "novel-1",
        workspace: "workspace/demo",
        workspaceKind: "novel",
        selectedFilePath: null,
        selectedStoryThreadId: null,
        selectedStorySceneId: null,
        previousSelectedFilePath: null,
        fileChangedSinceLastSend: false,
        selectionVersion: 1,
    });
}

function replaceRequest(path: string, value: string | null): VariablePatchRequest {
    return {
        namespace: "client",
        path,
        operations: [{op: "replace", path: "", value}],
    };
}

describe("client variable patch", () => {
    it("waits for async theme setter before returning applied value", async () => {
        const events: string[] = [];

        const appliedValue = await applyClientVariablePatch(replaceRequest("ide.theme", "macos"), buildState(), {
            setTheme: async (value) => {
                await Promise.resolve();
                events.push(value);
                return true;
            },
        });

        expect(events).toEqual(["macos"]);
        expect(appliedValue).toBe("macos");
    });

    it("rejects theme patch when async setter reports failure", async () => {
        await expect(applyClientVariablePatch(replaceRequest("ide.theme", "nbook"), buildState(), {
            setTheme: async () => false,
        })).rejects.toThrow("client.ide.theme 应用失败");
    });

    it("still rejects unsupported theme ids before calling setter", async () => {
        for (const themeId of ["missing-theme", "sepia", "tokyo-night", "custom-night"]) {
            let called = false;

            await expect(applyClientVariablePatch(replaceRequest("ide.theme", themeId), buildState(), {
                setTheme: () => {
                    called = true;
                },
            })).rejects.toThrow("client.ide.theme 只能写入");
            expect(called).toBe(false);
        }
    });
});
