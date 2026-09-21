import {afterEach, describe, expect, it} from "vitest";
import {
    applyActivePanelPatch,
    applyClientVariablePatch,
    buildAgentClientState,
} from "nbook/app/components/novel-ide/agent/client-variables";
import {
    registerWorkbenchToolRevealPort,
    type WorkbenchToolRevealPort,
    type WorkbenchToolRevealOutcome,
} from "nbook/app/utils/workbench/tool-reveal-port";
import type {NovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
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

const releases: Array<() => void> = [];

/** 登记一个只回答能力与回执的揭示端口：端口自身的行为在 `tool-reveal-port.test.ts` 里验证。 */
function registerPort(options: {
    readonly capability?: readonly NovelIdeTab[];
    readonly outcome?: WorkbenchToolRevealOutcome;
} = {}): {readonly calls: Array<NovelIdeTab | null>} {
    const calls: Array<NovelIdeTab | null> = [];
    const port: WorkbenchToolRevealPort = {
        capability: () => options.capability ?? ["files"],
        reveal: async (panel) => {
            calls.push(panel);
            return options.outcome ?? (panel === null
                ? {status: "cleared"}
                : {status: "revealed", partId: "left", viewId: "nbook.files", persisted: "saved"});
        },
    };
    releases.push(registerWorkbenchToolRevealPort(port));
    return {calls};
}

afterEach(() => {
    for (const release of releases.splice(0)) {
        release();
    }
});

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

    it("ide.activePanel 由登记的揭示端口回答能力：未接入的页签在调用 setter 之前就被拒绝", async () => {
        const port = registerPort({capability: ["files"]});
        let called = false;

        await expect(applyClientVariablePatch(replaceRequest("ide.activePanel", "characters"), buildState(), {
            setActivePanel: () => {
                called = true;
                return true;
            },
        })).rejects.toThrow("当前工作台未接入该工具视图");

        expect(called).toBe(false);
        expect(port.calls).toEqual([]);
    });

    it("ide.activePanel 写入已接入的页签时调用 setter 并返回应用后的值", async () => {
        registerPort({capability: ["files"]});
        const received: Array<NovelIdeTab | null> = [];

        const appliedValue = await applyClientVariablePatch(replaceRequest("ide.activePanel", "files"), buildState(), {
            setActivePanel: (value) => {
                received.push(value);
                return true;
            },
        });

        expect(received).toEqual(["files"]);
        expect(appliedValue).toBe("files");
    });

    it("没有登记揭示端口时显式拒绝：不静默当成已应用", async () => {
        await expect(applyClientVariablePatch(replaceRequest("ide.activePanel", "files"), buildState(), {
            setActivePanel: () => true,
        })).rejects.toThrow("没有登记工具揭示端口");
    });

    it("applyActivePanelPatch 把端口的拒绝原因与未登记原样说清楚", async () => {
        registerPort({capability: ["files"], outcome: {status: "rejected", diagnosis: "工具位置记录还没完成首次读取，本次调整没有保存"}});
        await expect(applyActivePanelPatch("files")).rejects.toThrow("工具位置记录还没完成首次读取");

        // 端口报告 pending（UI 已应用、保存未确认）时确认已应用的值，不谎报 saved。
        for (const release of releases.splice(0)) {
            release();
        }
        registerPort({capability: ["files"], outcome: {status: "revealed", partId: "left", viewId: "nbook.files", persisted: "pending"}});
        expect(await applyActivePanelPatch("files")).toBe(true);

        for (const release of releases.splice(0)) {
            release();
        }
        await expect(applyActivePanelPatch(null)).rejects.toThrow("没有登记工具揭示端口");
    });

    it("ide.activePanel 仍然只接受词表里的页签或 null", async () => {
        registerPort();
        for (const invalid of ["manuscript", "rag", "nbook.files"]) {
            await expect(applyClientVariablePatch(replaceRequest("ide.activePanel", invalid), buildState(), {
                setActivePanel: () => true,
            })).rejects.toThrow("client.ide.activePanel 只能写入");
        }
    });
});
