import {mkdir, rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {createProductRuntimeContract} from "nbook/shared/product-runtime-contract";
import {auditProductContract} from "./contract-audit";

describe("Task 140 Product Contract adapter", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("只接受 v5 commands 下的可迁移入口，并返回可脱敏审计结果", async () => {
        const root = resolve(".agent", "tmp", "t140-contract-audit", `${Date.now()}-${Math.random().toString(16).slice(2)}`);
        roots.push(root);
        await mkdir(resolve(root, "server"), {recursive: true});
        await writeFile(resolve(root, "server", "runtime-contract.json"), JSON.stringify(createProductRuntimeContract({
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
        })), "utf8");
        const audit = await auditProductContract(root);
        expect(audit.schema).toBe("nbook.product-runtime-contract/v5");
        expect(audit.entries).toHaveLength(7);
        expect(audit.unsafeEntries).toEqual([]);
    });
});
