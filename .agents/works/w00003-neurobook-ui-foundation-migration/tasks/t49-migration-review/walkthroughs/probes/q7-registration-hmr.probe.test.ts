/**
 * 探针 4（Q7，R2 追加复核）——试图证伪的声明：
 * "定义实例改放 globalThis 槽后，模块重载复用同一批实例，注册落回'同一实例重复登记'的幂等合同，
 *  宿主内已有等价定义继续服务；代价是同进程内改定义清单需真正重启 Nitro。"
 *
 * 做法：真实宿主 + 真实插件本体（`defineNitroPlugin` 换恒等替身）+ 仓库自己的 HMR 交接机制
 * （`vi.resetModules()` 重新实例化模块图，而宿主注册表按 `storage-host-hmr.test.ts` 的设计跨重载存活）。
 * 关键判据不只是"不抛错"，而是"重载后拿到的定义是不是注册表里的同一批实例"。
 */
import {describe, expect, it, vi} from "vitest";
import {createStorageActionHost} from "nbook/server/storage/fixtures/storage-action-host";
import {defineWorkbenchSurfaceSizesState, WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY} from "nbook/shared/storage/workbench-state";
import {WORKBENCH_MIGRATION_OWNER} from "nbook/shared/storage/workbench-migration";

vi.mock("nitropack/runtime", () => ({
    defineNitroPlugin: (plugin: unknown) => plugin,
}));

type HostSlot = {readonly registry: {resolveAddress: (owner: string, key: string) => unknown}};

function hostSlot(): HostSlot {
    const slot = (globalThis as unknown as {__nbookStorageHostV4?: HostSlot}).__nbookStorageHostV4;
    if (slot === undefined) throw new Error("隔离宿主未建立全局槽");
    return slot;
}

async function loadPlugin(): Promise<() => void> {
    const module = await import("nbook/server/plugins/storage-definitions");
    return module.default as unknown as () => void;
}

describe("探针 4：定义注册跨模块重载的幂等性（R2）", () => {
    it("同一实例重复执行幂等；模块重载后复用同一批实例、不抛错、宿主继续服务", async () => {
        const host = await createStorageActionHost();
        try {
            const plugin = await loadPlugin();
            plugin();
            plugin();
            const contextId = await host.issue();
            await expect(host.bind(contextId, WORKBENCH_LAYOUT_OWNER)).resolves.toBeDefined();

            const beforeReload = (await import("nbook/server/storage/product-definitions")).productStorageDefinitions();
            const registeredSurface = hostSlot().registry.resolveAddress(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY);

            // 模拟 HMR：模块图重新实例化（宿主全局槽保留注册表）。
            vi.resetModules();
            await import("nbook/server/storage/host");
            const definitionsAfterReload = await import("nbook/server/storage/product-definitions");
            const pluginAfterReload = await loadPlugin();

            // 声明：重载后重新执行插件不抛错，且是同一批实例的幂等重复登记。
            expect(() => pluginAfterReload()).not.toThrow();
            expect(definitionsAfterReload.productStorageDefinitions()).toBe(beforeReload);
            expect(hostSlot().registry.resolveAddress(WORKBENCH_LAYOUT_OWNER, WORKBENCH_SURFACE_SIZES_KEY)).toBe(registeredSurface);
            await expect(host.bind(contextId, WORKBENCH_LAYOUT_OWNER)).resolves.toBeDefined();
            await expect(host.bind(contextId, WORKBENCH_MIGRATION_OWNER)).resolves.toBeDefined();

            // 代价如实：重载后的模块若自己重新构造定义，得到的是**另一个实例**——
            // 槽位只保证"不因重载而冲突"，不保证"重载会采用新代码里的清单"。
            const freshInstance = defineWorkbenchSurfaceSizesState() as unknown;
            expect(freshInstance).not.toBe(registeredSurface);

            // 再次重载仍是同一批实例（幂等不止一次）。
            vi.resetModules();
            const third = await import("nbook/server/storage/product-definitions");
            expect(third.productStorageDefinitions()).toBe(beforeReload);
        } finally {
            await host.close();
        }
    });
});
