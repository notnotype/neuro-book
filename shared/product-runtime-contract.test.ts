import {mkdir, rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it} from "vitest";
import {
    assertProductRuntimeContractFiles,
    createProductRuntimeContract,
    parseProductRuntimeContract,
    PRODUCT_BUN_RUNTIME_ARGS,
    PRODUCT_RUNTIME_PREVIOUS_CONTRACT_SCHEMA,
    productRuntimeCwd,
    resolveProductRuntimeCommand,
    resolveProductRuntimeChecks,
} from "nbook/shared/product-runtime-contract";

describe("Product Runtime Contract", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("Bun Product 禁止自动安装和隐式加载 cwd .env", () => {
        expect(PRODUCT_BUN_RUNTIME_ARGS).toEqual(["--no-install", "--no-env-file"]);
    });

    it("严格解析逻辑命令并执行参数策略", () => {
        const contract = contractFixture();
        expect(resolveProductRuntimeCommand(contract, "profile", ["compile"]).fixedArgs).toEqual(["compile"]);
        expect(() => resolveProductRuntimeCommand(contract, "start", ["unexpected"])).toThrow("不接受额外参数");
        expect(() => resolveProductRuntimeCommand(contract, "unknown-command")).toThrow("未知 Product Runtime command");
        expect(() => parseProductRuntimeContract({...contract, extra: true})).toThrow("字段不匹配");
        expect(() => parseProductRuntimeContract({
            ...contract,
            commands: {...contract.commands, start: {...contract.commands.start, entry: "../outside.mjs"}},
        })).toThrow("可迁移 .mjs 路径");
    });

    it("新镜像只接受 v4，Manager 旧镜像读取可显式接受 v3", () => {
        const current = contractFixture();
        const {"world-engine-config": _removed, ...previousChecks} = current.checks;
        const previous = {
            ...current,
            schema: PRODUCT_RUNTIME_PREVIOUS_CONTRACT_SCHEMA,
            checks: previousChecks,
        };
        expect(() => parseProductRuntimeContract(previous)).toThrow("schema 不受支持");
        expect(parseProductRuntimeContract(previous, {allowPrevious: true}).schema)
            .toBe(PRODUCT_RUNTIME_PREVIOUS_CONTRACT_SCHEMA);
    });

    it("交互式CLI保留调用cwd，其余命令固定Application Root", () => {
        expect(productRuntimeCwd("command", "workspace", "application", "invocation")).toBe("invocation");
        expect(productRuntimeCwd("command", "profile", "application", "invocation")).toBe("application");
        expect(productRuntimeCwd("command", "variable", "application", "invocation")).toBe("application");
        expect(productRuntimeCwd("command", "create-admin", "application", "invocation")).toBe("application");
        expect(productRuntimeCwd("check", "workspace-cli", "application", "invocation")).toBe("application");
    });

    it("check all 按当前合同解析全部检查入口并包含 World Engine smoke", () => {
        const contract = contractFixture();
        const checks = resolveProductRuntimeChecks(contract);

        expect(checks).toHaveLength(Object.keys(contract.checks).length);
        expect(checks.at(-1)?.entry).toBe(contract.checks["world-engine-config"].entry);
        expect(checks.every((check) => !check.allowAdditionalArgs)).toBe(true);
        expect(checks.find((check) => check.entry === contract.checks["application-state"].entry)?.fixedArgs)
            .toEqual(["--plan"]);
    });

    it("验证 bootstrap 与所有合同入口实际存在", async () => {
        const root = resolve(".agent", "tmp", "product-contract-test", randomUUID());
        roots.push(root);
        const contract = contractFixture();
        const entries = new Set([
            "server/commands/product-command.mjs",
            ...Object.values(contract.commands).map((item) => item.entry),
            ...Object.values(contract.internal).map((item) => item.entry),
            ...Object.values(contract.checks).map((item) => item.entry),
        ]);
        for (const entry of entries) {
            const path = resolve(root, ...entry.split("/"));
            await mkdir(resolve(path, ".."), {recursive: true});
            await writeFile(path, "export {};\n", "utf8");
        }
        await expect(assertProductRuntimeContractFiles(contract, root)).resolves.toBeUndefined();
        await rm(resolve(root, "server", "commands", "profile.mjs"));
        await expect(assertProductRuntimeContractFiles(contract, root)).rejects.toThrow("入口不存在");
    });
});

function contractFixture() {
    return createProductRuntimeContract({
        productStart: "server/commands/product-start.mjs",
        sqliteMigrate: "server/commands/sqlite-migrate.mjs",
        applicationStateMigration: "server/commands/migrate-application-state.mjs",
        createAdmin: "server/commands/create-admin.mjs",
        profile: "server/commands/profile.mjs",
        variable: "server/commands/variable.mjs",
        workspace: "server/commands/workspace.mjs",
        prepareSystemAssets: "server/commands/prepare-system-assets.mjs",
        checkMigrations: "server/commands/check-migrations.mjs",
        profileAuthoringSmoke: "server/commands/product-profile-authoring-smoke.mjs",
        variableAuthoringSmoke: "server/commands/product-variable-authoring-smoke.mjs",
        imageVariantSmoke: "server/commands/product-image-variant-smoke.mjs",
        sqliteVecSmoke: "server/commands/sqlite-vec-smoke.mjs",
        webFetchSmoke: "server/commands/product-web-fetch-smoke.mjs",
        worldEngineConfigSmoke: "server/commands/product-world-engine-config-smoke.mjs",
    });
}
