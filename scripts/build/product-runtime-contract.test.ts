import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("Product 临时验收实例合同", () => {
    it("只复制 verified .output，并通过 bundle commands 运行", async () => {
        const source = await readFile(resolve("scripts", "deploy", "product-runtime.mjs"), "utf8");

        expect(source).toContain('".agent", "product-runtime-acceptance"');
        expect(source).toContain("ProductRuntimeImageBuilder");
        expect(source).toContain("openVerified");
        expect(source).toContain('resolve(stageRoot, ".output")');
        expect(source).toContain("PRODUCT_RUNTIME_COMMAND_BOOTSTRAP");
        expect(source).toContain('`.output/${PRODUCT_RUNTIME_COMMAND_BOOTSTRAP}`');
        expect(source).toContain("proper-lockfile");
        expect(source).toContain("sweepStaleAcceptances");
        expect(source).not.toContain('|| "product"');
        expect(source).not.toContain('copyPath("server"');
        expect(source).not.toContain("prepareProductSystemAssets");
    });

    it("bootstrap、启动器与验收实例的Bun子进程都禁止自动安装", async () => {
        const [bootstrap, start, acceptance] = await Promise.all([
            readFile(resolve("server", "runtime", "product-command.ts"), "utf8"),
            readFile(resolve("server", "runtime", "product-start-command.mjs"), "utf8"),
            readFile(resolve("scripts", "deploy", "product-runtime.mjs"), "utf8"),
        ]);

        expect(bootstrap).toContain("[...PRODUCT_BUN_RUNTIME_ARGS, entry, ...args]");
        expect(start).toContain("[...PRODUCT_BUN_RUNTIME_ARGS, entry, ...process.argv.slice(2)]");
        expect(start).toContain("...PRODUCT_BUN_RUNTIME_ARGS,");
        expect(acceptance).toContain("await run(process.execPath, [");
        expect(acceptance).toContain("...PRODUCT_BUN_RUNTIME_ARGS,");
    });
});
