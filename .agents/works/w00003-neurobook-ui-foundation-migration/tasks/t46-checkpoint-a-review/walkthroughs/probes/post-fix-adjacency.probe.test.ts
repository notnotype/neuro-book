/**
 * 追加复核探针 G（修复相邻路径不得被破坏）：
 * G1 真"值已相同"仍判 saved（不得改判 unsaved）；G2 reconcile 未落地仍 unsaved 且停自动重放；
 * G3 missing 首次打开保持默认且不落盘、首存用空 revision 凭据；G4 open() 守卫不影响正常重开与订阅建立。
 */
import {describe, expect, it} from "vitest";
import {StorageAdapterError} from "nbook/app/utils/storage/value-transport";
import {childIds, credential, idsOf, openProbeHost, scriptedTransport, threeLeafRecord, widthOf} from "./probe-harness";

describe("探针 G：修复相邻路径", () => {
    it("G1 重读核对显示意图已落地：仍判 saved，且不重复提交", async () => {
        const probe = scriptedTransport({
            // 读取 3（核对）返回"已经包含本次意图（outline 360）"的记录。
            onRead: (index) => index === 3
                ? {kind: "value", value: threeLeafRecord(360, "landed"), schemaVersion: 2, credential: credential("rev-9")}
                : {kind: "value", value: threeLeafRecord(240, "seed"), schemaVersion: 2, credential: credential("rev-1")},
            onSave: async () => {
                throw new StorageAdapterError({code: null, status: null, message: "Storage 请求超时", committed: null});
            },
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport});
        await host.open();
        host.setContainer({width: 1200, height: 800});

        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const outcome = await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 45, 25]});

        expect(outcome).toMatchObject({status: "saved", fields: [], credential: credential("rev-9")});
        expect(host.state.pending).toBeNull();
        expect(probe.attempts).toHaveLength(1);
        expect(host.state.issues.some((issue) => issue.kind === "save" && issue.message.includes("没有落点"))).toBe(false);
        await workbench.release();
    });

    it("G2 重读核对显示意图尚未落地：仍 unsaved、保留意图、不自动重发", async () => {
        const probe = scriptedTransport({
            onRead: () => ({kind: "value", value: threeLeafRecord(240, "seed"), schemaVersion: 2, credential: credential("rev-2")}),
            onSave: async () => {
                throw new StorageAdapterError({code: null, status: null, message: "Storage 请求超时", committed: null});
            },
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport});
        await host.open();
        host.setContainer({width: 1200, height: 800});

        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const outcome = await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 45, 25]});

        expect(outcome.status).toBe("unsaved");
        expect(outcome.status === "unsaved" ? outcome.diagnosis : "").toContain("未确认");
        expect(host.state.pending).toMatchObject({
            retryable: true,
            autoReplayed: true,
            fields: [{id: "outline", axis: "width", value: 360}],
        });
        expect(probe.attempts).toHaveLength(1);
        expect(widthOf(host, "outline")).toBe(360);
        await workbench.release();
    });

    it("G3 missing 首次打开：保持产品默认且不落盘，首存使用空 revision 凭据", async () => {
        const probe = scriptedTransport({
            onRead: () => ({kind: "missing", credential: credential(null)}),
            onSave: async () => credential("rev-1"),
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport});
        await host.open();

        expect(host.state.projection?.status).toBe("default");
        expect(host.state.writable).toBe(true);
        expect(host.state.blocked).toBeNull();
        expect(host.state.credential).toEqual(credential(null));
        expect(idsOf(host.grid.root())).toEqual(["root", "outline", "editor", "console"]);
        expect(probe.attempts).toHaveLength(0);

        host.setContainer({width: 1200, height: 800});
        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: true});
        const saved = await host.gestureEnd({branchId: "root", active: ["outline", "editor"], sizes: [30, 45, 25]});
        expect(saved.status).toBe("saved");
        expect(probe.attempts[0]!.expected).toEqual(credential(null));
        expect(childIds(probe.attempts[0]!.value)).toEqual(["outline", "editor", "console"]);
        await workbench.release();
    });

    it("G4 open() 守卫不影响正常重开：读取失败后重开仍一次发布并建立订阅，之后不再重复读取", async () => {
        let reads = 0;
        const probe = scriptedTransport({
            onRead: () => {
                reads += 1;
                // 读取 1（首次 open）与读取 2（该次订阅初始快照）都失败；读取 3/4 成功。
                if (reads <= 2) {
                    throw new StorageAdapterError({code: null, status: null, message: "Storage 读取失败", committed: null});
                }
                return {kind: "value", value: threeLeafRecord(320, "seed"), schemaVersion: 2, credential: credential("rev-1")};
            },
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport});
        await host.open();

        expect(host.state.projection).toBeNull();
        expect(host.state.blocked).toBe("unavailable");
        expect(host.state.writable).toBe(false);
        expect(widthOf(host, "outline")).toBe(240);

        // 重开：一次读取、一次发布，并建立订阅。
        await host.open();
        expect(host.state.projection?.status).toBe("confirmed");
        expect(host.state.writable).toBe(true);
        expect(host.state.credential).toEqual(credential("rev-1"));
        expect(widthOf(host, "outline")).toBe(320);

        // 订阅已建立：再次 open() 不产生新读取。
        const readsBefore = reads;
        await host.open();
        expect(reads).toBe(readsBefore);
        await workbench.release();
    });
});
