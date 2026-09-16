/**
 * 对抗性探针 D（身份/寻址守卫与生命周期）：
 * 构造期守卫、release 后是否仍发起读取/写入、释放幂等。
 */
import {describe, expect, it} from "vitest";
import {defineStorageState} from "nbook/shared/storage/definition";
import {createGridLayoutHost} from "nbook/app/utils/workbench/storage-grid-host";
import {createDefaultGrid, credential, openProbeHost, OWNER, probeDefinition, scriptedTransport} from "./probe-harness";

describe("探针 D：守卫与生命周期", () => {
    it("构造期守卫拒绝 owner 不匹配、record 模式与 resource 不符、不安全标识", async () => {
        const otherDefinition = defineStorageState({
            owner: "nbook.other",
            key: "layout",
            scope: "user",
            records: "identified",
            schemaVersion: 2,
            defaultValue: createDefaultGrid().serialize(),
            validate: () => true,
        });
        const singleDefinition = defineStorageState({
            owner: OWNER,
            key: "layout",
            scope: "user",
            records: "single",
            schemaVersion: 2,
            defaultValue: createDefaultGrid().serialize(),
            validate: () => true,
        });
        const wrongVersion = defineStorageState({
            owner: OWNER,
            key: "layout",
            scope: "user",
            records: "identified",
            schemaVersion: 3,
            defaultValue: createDefaultGrid().serialize(),
            validate: () => true,
        });
        const probe = scriptedTransport();
        const {handle, workbench} = await openProbeHost({transport: probe.transport});
        const base = {grid: createDefaultGrid(), handle, resolveRef: () => null};

        expect(() => createGridLayoutHost({...base, definition: otherDefinition, resource: "main"})).toThrow(TypeError);
        expect(() => createGridLayoutHost({...base, definition: probeDefinition()})).toThrow(/稳定资源标识/);
        expect(() => createGridLayoutHost({...base, definition: singleDefinition, resource: "main"})).toThrow(/single/);
        expect(() => createGridLayoutHost({...base, definition: probeDefinition(), resource: "Main/Ref"})).toThrow(/安全逻辑标识/);
        expect(() => createGridLayoutHost({...base, definition: wrongVersion as never, resource: "main"})).toThrow(/schemaVersion/);
        await workbench.release();
    });

    it("release 幂等；释放后不写盘、拒绝手势与重试；open() 的重读行为被记录", async () => {
        const probe = scriptedTransport({
            onRead: () => ({kind: "value", value: createDefaultGrid().serialize(), schemaVersion: 2, credential: credential("rev-1")}),
            onSave: async () => credential("rev-2"),
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport});
        await host.open();
        host.setContainer({width: 1200, height: 800});
        expect(host.state.phase).toBe("ready");

        const readsAfterOpen = probe.readCount();
        await host.release();
        await host.release();
        expect(host.state.phase).toBe("released");
        expect(host.gestureStart({branchId: "root", sizes: [30, 45, 25]})).toEqual({ok: false, diagnosis: "布局宿主尚未完成读取，不能开始手势"});
        expect((await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 45, 25]})).status).toBe("rejected");
        expect((await host.retry()).status).toBe("rejected");
        expect(probe.attempts).toHaveLength(0);
        expect(host.state.pending).toBeNull();

        // 观察：已打开的宿主 release 后再 open() 复用既有 promise，不产生新读取。
        await host.open();
        expect(probe.readCount()).toBe(readsAfterOpen);
        await workbench.release();
    });

    it("从未打开的宿主 release 后 open()：不接受新动作且不发起读取（修后期望）", async () => {
        const probe = scriptedTransport({
            onRead: () => ({kind: "value", value: createDefaultGrid().serialize(), schemaVersion: 2, credential: credential("rev-1")}),
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport});
        await host.release();
        const readsBefore = probe.readCount();
        await host.open();
        expect(probe.readCount()).toBe(readsBefore); // 修后：release 后 open() 不再发起读取
        await workbench.release();
    });
});
