/**
 * 对抗性探针 C（读取分类与订阅乱序）：
 * C1 deleted 与 missing 的分类/首存凭据；C2 迟到的旧订阅快照会怎样影响基线，以及后续提交能否自愈。
 */
import {describe, expect, it} from "vitest";
import {StorageAdapterError} from "nbook/app/utils/storage/value-transport";
import {childIds, credential, openProbeHost, scriptedTransport, threeLeafRecord, widthOf} from "./probe-harness";

describe("探针 C：deleted 分类与迟到订阅快照", () => {
    it("C1 deleted 记录按产品默认呈现且不落盘，首次保存使用墓碑凭据", async () => {
        const probe = scriptedTransport({
            onRead: () => ({kind: "deleted", credential: credential("tomb-1")}),
            onSave: async () => credential("rev-new"),
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport});
        await host.open();

        expect(host.state.projection?.status).toBe("default");
        expect(host.state.writable).toBe(true);
        expect(host.state.blocked).toBeNull();
        expect(host.state.credential).toEqual(credential("tomb-1"));
        expect(host.state.issues.some((issue) => issue.kind === "save")).toBe(false);

        host.setContainer({width: 1200, height: 800});
        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const outcome = await host.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]});

        expect(outcome.status).toBe("saved");
        expect(probe.attempts).toHaveLength(1);
        expect(probe.attempts[0]!.expected).toEqual(credential("tomb-1"));
        expect(childIds(probe.attempts[0]!.value)).toEqual(["outline", "editor", "console"]);
        await workbench.release();
    });

    it("C2 迟到的旧订阅快照只改基线不改呈现；下一次提交经 CAS 冲突自愈且保留外来字段", async () => {
        const current = threeLeafRecord(300, "current");
        const stale = threeLeafRecord(240, "stale");
        const probe = scriptedTransport({
            // 读取 1：打开时的读取（当前记录 rev-2）；读取 2：订阅初始快照（迟到/旧的 rev-1）；读取 3：冲突重读（当前记录）。
            onRead: (index) => index === 2
                ? {kind: "value", value: stale, schemaVersion: 2, credential: credential("rev-1")}
                : {kind: "value", value: current, schemaVersion: 2, credential: credential("rev-2")},
            onSave: async (_value, index) => {
                if (index === 1) {
                    throw new StorageAdapterError({code: "STORAGE_REVISION_CONFLICT", status: 409, message: "记录已被其它窗口改写", committed: false});
                }
                return credential("rev-3");
            },
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport});
        await host.open();
        host.setContainer({width: 1200, height: 800});

        // 打开后呈现来自 rev-2（300）；迟到快照把基线换成了 rev-1（240），但呈现没有被重挂。
        expect(widthOf(host, "outline")).toBe(300);
        expect(host.state.credential).toEqual(credential("rev-1"));

        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const outcome = await host.gestureEnd({branchId: "root", active: ["editor"], sizes: [30, 45, 25]});

        expect(outcome.status).toBe("saved");
        expect(probe.attempts).toHaveLength(2);
        const stored = probe.attempts[1]!.value;
        // 外来/当前记录的 outline 300 保留，只写入本次主动字段 editor。
        expect(childIds(stored)).toEqual(["outline", "editor", "console"]);
        const children = (stored.root as unknown as {children: Array<{id: string; size: {width: number}}>}).children;
        expect(children[0]!.size.width).toBe(300);
        expect(children[1]!.size.width).toBe(567);
        expect(children[2]!.size.width).toBe(300);
        expect(stored.note).toBe("current");
        await workbench.release();
    });
});
