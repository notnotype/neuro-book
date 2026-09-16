import {afterEach, describe, expect, it, vi} from "vitest";

describe("SQLite native handle release across HMR", () => {
    afterEach(() => {
        vi.doUnmock("node:v8");
        vi.doUnmock("node:vm");
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it("重载后进程已经启用 GC，仍能释放后来关闭的 native 句柄", async () => {
        const collect = vi.fn();
        const expose = vi.fn();
        vi.stubGlobal("gc", undefined);
        vi.stubGlobal("Bun", undefined);
        vi.stubGlobal("__sqliteHandleReleaseGcExposed", false);
        vi.doMock("node:v8", () => ({default: {setFlagsFromString: expose}}));
        vi.doMock("node:vm", () => ({default: {runInNewContext: () => collect}}));
        vi.resetModules();

        const first = await import("nbook/server/workspace-files/sqlite-handle-release");
        first.collectReleasedSqliteHandles({force: true});
        vi.resetModules();
        const reloaded = await import("nbook/server/workspace-files/sqlite-handle-release");
        reloaded.collectReleasedSqliteHandles({force: true});

        expect(collect).toHaveBeenCalledTimes(2);
        expect(expose).toHaveBeenCalledOnce();
    });
});
