import {afterEach, describe, expect, it, vi} from "vitest";
import {
    projectModuleRegistry,
    projectModuleToken,
    registerProjectModule,
    replaceProjectModulesForTest,
    type ProjectModule,
} from "nbook/server/workspace-files/project-module";

describe("ProjectModule registry", () => {
    let restore = replaceProjectModulesForTest([]);

    afterEach(() => {
        restore();
        restore = replaceProjectModulesForTest([]);
    });

    it("required Module不完整时拒绝产生可打开的registry快照", () => {
        registerProjectModule(module("database", "required"));
        expect(() => projectModuleRegistry()).toThrow("history、file-index");
    });

    it("按稳定依赖顺序冻结当前generation，后续替换只影响未来快照", () => {
        const oldDatabase = module("database", "required");
        registerProjectModule(module("file-index", "required"));
        registerProjectModule(oldDatabase);
        registerProjectModule(module("history", "required"));
        registerProjectModule(module("agent-sql", "lazy"));
        registerProjectModule(module("plot-world", "lazy"));

        const oldGeneration = projectModuleRegistry();
        const newDatabase = module("database", "required");
        registerProjectModule(newDatabase);
        const newGeneration = projectModuleRegistry();

        expect(oldGeneration.required.map(({token}) => token.name)).toEqual(["database", "history", "file-index"]);
        expect(oldGeneration.lazy.map(({token}) => token.name)).toEqual(["plot-world", "agent-sql"]);
        expect(oldGeneration.required[0]).toBe(oldDatabase);
        expect(newGeneration.required[0]).toBe(newDatabase);
    });

    it("HMR重载registry Module后旧provider仍读取未来generation的新descriptor", async () => {
        registerProjectModule(module("database", "required"));
        registerProjectModule(module("history", "required"));
        registerProjectModule(module("file-index", "required"));
        const capturedProvider = projectModuleRegistry;

        vi.resetModules();
        const freshRegistry = await import("nbook/server/workspace-files/project-module");
        const replacement = module("database", "required");
        freshRegistry.registerProjectModule(replacement);

        expect(capturedProvider().required[0]).toBe(replacement);
    });
});

/** 测试descriptor：本文件只验证registry Interface，不启动真实资源。 */
function module(
    name: ProjectModule["token"]["name"],
    kind: ProjectModule["token"]["kind"],
): ProjectModule {
    return {
        token: projectModuleToken(name, kind),
        start: () => ({ready: Promise.resolve(), close: async () => undefined}),
    };
}
