import {afterEach, describe, expect, it} from "vitest";
import {
    registerWorkbenchToolRevealPort,
    revealWorkbenchToolPanel,
    workbenchToolRevealPort,
    type WorkbenchToolRevealPort,
} from "nbook/app/utils/workbench/tool-reveal-port";

/**
 * 揭示端口的登记、释放与"未登记显式失败"。
 *
 * 端口是 Agent 写入工具上下文的唯一入口：没有宿主时必须失败，绝不能静默当成功（否则 ack 会谎报已应用）。
 */

const releases: Array<() => void> = [];

function portOf(capability: WorkbenchToolRevealPort["capability"]): WorkbenchToolRevealPort {
    return {
        capability,
        reveal: async (panel) => (panel === null
            ? {status: "cleared"}
            : {status: "revealed", partId: "left", viewId: "nbook.files", persisted: "saved"}),
    };
}

function register(port: WorkbenchToolRevealPort): void {
    releases.push(registerWorkbenchToolRevealPort(port));
}

afterEach(() => {
    for (const release of releases.splice(0)) {
        release();
    }
});

describe("工具揭示端口", () => {
    it("未登记时显式失败，不静默成功", async () => {
        expect(workbenchToolRevealPort()).toBeNull();
        expect(await revealWorkbenchToolPanel("files")).toEqual({status: "unregistered"});
        expect(await revealWorkbenchToolPanel(null)).toEqual({status: "unregistered"});
    });

    it("登记后由宿主回答能力与揭示结果", async () => {
        register(portOf(() => ["files"]));

        expect(workbenchToolRevealPort()?.capability()).toEqual(["files"]);
        expect(await revealWorkbenchToolPanel("files")).toEqual({
            status: "revealed",
            partId: "left",
            viewId: "nbook.files",
            persisted: "saved",
        });
        expect(await revealWorkbenchToolPanel(null)).toEqual({status: "cleared"});
    });

    it("释放只摘自己那一次登记：旧宿主的 cleanup 不会摘掉新宿主的端口", async () => {
        const first = portOf(() => []);
        const second = portOf(() => ["files"]);
        const releaseFirst = registerWorkbenchToolRevealPort(first);
        releases.push(releaseFirst);
        register(second);

        releaseFirst();

        expect(workbenchToolRevealPort()?.capability()).toEqual(["files"]);
        expect(await revealWorkbenchToolPanel("files")).toMatchObject({status: "revealed"});
    });

    it("宿主拒绝时把原因原样交给调用方（首读未就绪 / 未接入都不吞）", async () => {
        register({
            capability: () => [],
            reveal: async () => ({status: "rejected", diagnosis: "工具位置记录还没完成首次读取，本次调整没有保存"}),
        });

        expect(await revealWorkbenchToolPanel("files")).toEqual({
            status: "rejected",
            diagnosis: "工具位置记录还没完成首次读取，本次调整没有保存",
        });
    });
});
