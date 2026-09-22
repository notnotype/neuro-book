/**
 * 对抗性探针 B（未确认意图分类）——已按返工后的期望更新为回归证据。
 *
 * 更新前（返工前 revision 5fcdf8b8）断言：`status === "saved"`、`pending === null`（钉住缺陷）。
 * 更新后（返工后）断言：`status === "unsaved"`、未确认意图保留、无写入、可 retry/abandon。
 */
import {describe, expect, it} from "vitest";
import {StorageAdapterError} from "nbook/app/utils/storage/value-transport";
import type {GridLayoutRecord} from "nbook/app/utils/workbench/storage-grid-host";
import {childIds, credential, idsOf, openProbeHost, scriptedTransport, twoLeafRecord} from "./probe-harness";

/** 外部窗口改写后的记录：outline 节点已不存在。 */
function structureChangedRecord(): GridLayoutRecord {
    return {
        version: 2,
        note: "structure-changed",
        root: {
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            size: {width: 0, height: 0},
            children: [
                {kind: "leaf", id: "outline-v2", ref: "outline-v2", size: {width: 240, height: 0}},
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 660, height: 0}},
            ],
        },
    } as unknown as GridLayoutRecord;
}

describe("探针 B：重放无落点时的结果分类（返回修后行为）", () => {
    it("冲突重读后主动字段没有落点：不报 saved、保留未确认意图、无补写，retry/abandon 可用", async () => {
        const probe = scriptedTransport({
            onRead: (index) => index === 3 || index >= 4
                ? {kind: "value", value: structureChangedRecord(), schemaVersion: 2, credential: credential("rev-2")}
                : {kind: "value", value: twoLeafRecord(), schemaVersion: 2, credential: credential("rev-1")},
            onSave: async () => {
                throw new StorageAdapterError({code: "STORAGE_REVISION_CONFLICT", status: 409, message: "冲突", committed: false});
            },
        });
        const {host, workbench} = await openProbeHost({
            transport: probe.transport,
            resolveRef: (ref) => ({ref}),
        });
        await host.open();
        host.setContainer({width: 1200, height: 800});
        expect(childIds(twoLeafRecord())).toEqual(["outline", "editor"]);

        expect(host.gestureStart({branchId: "root", sizes: [35, 65]})).toEqual({ok: true});
        const outcome = await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 70]});

        // 修后行为：不得声称已保存；未确认意图保留；只发生过那一次被拒的条件提交。
        expect(outcome.status).toBe("unsaved");
        expect(host.state.pending?.fields).toEqual([{id: "outline", axis: "width", value: 270}]);
        expect(host.state.pending).toMatchObject({retryable: true, autoReplayed: true});
        expect(probe.attempts).toHaveLength(1);
        expect(host.state.issues.some((issue) => issue.kind === "save" && issue.message.includes("没有落点"))).toBe(true);

        // 显式重试仍无落点：依旧不谎报保存，意图继续保留。
        const retried = await host.retry();
        expect(retried.status).toBe("unsaved");
        expect(host.state.pending?.fields).toEqual([{id: "outline", axis: "width", value: 270}]);
        expect(probe.attempts).toHaveLength(1);

        // 放弃采用已确认记录、不补写；呈现回到已确认结构（outline-v2 可解析）。
        host.abandon();
        expect(host.state.pending).toBeNull();
        expect(idsOf(host.grid.root())).toEqual(["root", "outline-v2", "editor"]);
        expect(probe.attempts).toHaveLength(1);
        await workbench.release();
    });
});
