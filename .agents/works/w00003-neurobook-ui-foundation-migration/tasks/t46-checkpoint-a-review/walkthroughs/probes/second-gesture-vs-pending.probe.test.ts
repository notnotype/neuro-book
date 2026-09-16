/**
 * 对抗性探针 E（未确认意图与后续手势）：
 * 一次未确认（unsaved）之后用户再拖一次并成功保存时，先前的未确认意图是被保留、被拒绝、还是被静默丢弃。
 */
import {describe, expect, it} from "vitest";
import {StorageAdapterError} from "nbook/app/utils/storage/value-transport";
import {childIds, credential, openProbeHost, scriptedTransport, threeLeafRecord, widthOf} from "./probe-harness";

describe("探针 E：未确认意图与后续手势", () => {
    it("unsaved 后再手势成功保存：观察先前未确认意图与呈现的走向", async () => {
        const foreign = threeLeafRecord(240, "foreign");
        const probe = scriptedTransport({
            onRead: () => ({kind: "value", value: foreign, schemaVersion: 2, credential: credential("rev-2")}),
            onSave: async (_value, index) => {
                if (index === 1) {
                    throw new StorageAdapterError({code: "STORAGE_REVISION_CONFLICT", status: 409, message: "冲突", committed: false});
                }
                if (index === 2) {
                    throw new StorageAdapterError({code: null, status: null, message: "Storage 服务暂不可用", committed: false});
                }
                return credential("rev-3");
            },
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport});
        await host.open();
        host.setContainer({width: 1200, height: 800});

        // 第一次手势：冲突 → 重放 → 明确拒绝 → 未确认意图（outline 360）。
        expect(host.gestureStart({branchId: "root", sizes: [20, 55, 25]})).toEqual({ok: true});
        const first = await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 45, 25]});
        expect(first.status).toBe("unsaved");
        expect(host.state.pending?.fields).toEqual([{id: "outline", axis: "width", value: 360}]);
        expect(widthOf(host, "outline")).toBe(360);

        // 第二次手势：改的是 console，保存成功。
        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const second = await host.gestureEnd({branchId: "root", active: ["console"], sizes: [30, 40, 30]});
        expect(second.status).toBe("saved");

        const stored = probe.attempts.at(-1)!.value;
        expect(childIds(stored)).toEqual(["outline", "editor", "console"]);
        const children = (stored.root as unknown as {children: Array<{id: string; size: {width: number}}>}).children;
        // 观察：先前未确认的 outline 意图既没有写盘，也没有留在 pending 里，也没有被报告为被丢弃。
        expect(children[0]!.size.width).toBe(240);
        expect(children[2]!.size.width).toBe(360);
        expect(host.state.pending).toBeNull();
        expect(host.state.issues.some((issue) => issue.kind === "save" && issue.message.includes("outline"))).toBe(false);
        // 呈现仍显示本次窗口的第一次调整（360），与已确认记录（240）不一致。
        expect(widthOf(host, "outline")).toBe(360);
        await workbench.release();
    });
});
