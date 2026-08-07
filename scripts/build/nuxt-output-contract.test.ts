import {execFile} from "node:child_process";
import {readFile, readdir} from "node:fs/promises";
import {join, resolve} from "node:path";
import {promisify} from "node:util";
import {describe, expect, it} from "vitest";

import {
    isProductRuntimeIslandModule,
    productRuntimeIslandPackageNames,
} from "nbook/scripts/build/product-runtime-islands";

const execFileAsync = promisify(execFile);
const configProbe = [
    "import {loadNuxtConfig} from '@nuxt/kit';",
    "const config = await loadNuxtConfig({cwd: process.cwd()});",
    "const nitroExternal = config.nitro?.externals?.external ?? [];",
    "const typescriptPath = 'C:/repo/node_modules/.bun/typescript@5.9.3/node_modules/typescript/lib/typescript.js';",
    "console.log(JSON.stringify({outputDir: config.nitro?.output?.dir, buildId: config.buildId, appManifest: config.experimental?.appManifest, external: nitroExternal, externalTypeScript: nitroExternal.some((matcher) => typeof matcher === 'function' && matcher(typescriptPath))}));",
].join(" ");

type NuxtProductConfigProbe = {
    outputDir: string;
    buildId: string;
    appManifest: boolean;
    external: string[];
    externalTypeScript: boolean;
};

describe("Nuxt raw Product output", () => {
    it("没有 Builder 注入输出目录时只写 Developer Build State", async () => {
        const {stdout} = await execFileAsync("bun", ["-e", configProbe], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: "",
                NEURO_BOOK_PRODUCT_IMAGE_ROOT: "",
                NEURO_BOOK_PRODUCT_SOURCE_DIGEST: "",
            },
            windowsHide: true,
        });

        const config = JSON.parse(stdout) as NuxtProductConfigProbe;
        expect(config.outputDir).toBe(resolve(".nuxt", "product-raw"));
        expect(config.outputDir).not.toBe(resolve(".output"));
        expect(config.appManifest).toBe(true);
        expect(config.external).toEqual(expect.arrayContaining(productRuntimeIslandPackageNames()));
        expect(config.externalTypeScript).toBe(true);
    });

    it("保留 Builder 候选目录并使用 Source digest 派生稳定 build ID", async () => {
        const candidate = resolve(".agent", "tmp", "nuxt-output-contract", ".output");
        const sourceDigest = `sha256:${"a".repeat(64)}`;
        const {stdout} = await execFileAsync("bun", ["-e", configProbe], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: candidate,
                NEURO_BOOK_PRODUCT_IMAGE_ROOT: candidate,
                NEURO_BOOK_PRODUCT_SOURCE_DIGEST: sourceDigest,
            },
            windowsHide: true,
        });

        expect(JSON.parse(stdout) as NuxtProductConfigProbe).toEqual({
            outputDir: candidate,
            buildId: sourceDigest.slice("sha256:".length),
            appManifest: false,
            external: expect.arrayContaining(productRuntimeIslandPackageNames()),
            externalTypeScript: true,
        });
    });

    it.each([
        ["只设置 output root", resolve(".agent", "tmp", "nuxt-output-only"), "", "同时注入"],
        ["只设置 image root", "", resolve(".agent", "tmp", "nuxt-image-only"), "同时注入"],
        [
            "注入不一致的两个 root",
            resolve(".agent", "tmp", "nuxt-output-mismatch"),
            resolve(".agent", "tmp", "nuxt-image-mismatch"),
            "不一致",
        ],
    ])("%s 时拒绝 raw Product build", async (_label, outputRoot, imageRoot, expectedMessage) => {
        await expect(execFileAsync("bun", ["-e", configProbe], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: outputRoot,
                NEURO_BOOK_PRODUCT_IMAGE_ROOT: imageRoot,
                NEURO_BOOK_PRODUCT_SOURCE_DIGEST: "",
            },
            windowsHide: true,
        })).rejects.toThrow(expectedMessage);
    });

    it.each([
        ["缺少", ""],
        ["无效", "sha256:bad"],
    ])("%s Source digest 时拒绝 raw Product build", async (_label, sourceDigest) => {
        const candidate = resolve(".agent", "tmp", "nuxt-output-digest");
        await expect(execFileAsync("bun", ["-e", configProbe], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: candidate,
                NEURO_BOOK_PRODUCT_IMAGE_ROOT: candidate,
                NEURO_BOOK_PRODUCT_SOURCE_DIGEST: sourceDigest,
            },
            windowsHide: true,
        })).rejects.toThrow(sourceDigest ? "Source digest 无效" : "注入 Source digest");
    });

    it("Product island matcher 覆盖 bare、Bun、pnpm 与 scoped package", () => {
        const sharpPlatformPackage = productRuntimeIslandPackageNames()
            .find((packageName) => packageName.startsWith("@img/sharp-"));
        expect(sharpPlatformPackage).toBeTruthy();
        expect(isProductRuntimeIslandModule("typescript")).toBe(true);
        expect(isProductRuntimeIslandModule("typescript/lib/typescript.js?raw")).toBe(true);
        expect(isProductRuntimeIslandModule("C:\\repo\\node_modules\\.bun\\typescript@5.9.3\\node_modules\\typescript\\lib\\typescript.js"))
            .toBe(true);
        expect(isProductRuntimeIslandModule("/repo/node_modules/.pnpm/jsdom@29.1.1/node_modules/jsdom/lib/api.js"))
            .toBe(true);
        expect(isProductRuntimeIslandModule(`/repo/node_modules/${sharpPlatformPackage}/lib/sharp.node`))
            .toBe(true);
        expect(isProductRuntimeIslandModule("zod/v4")).toBe(false);
        expect(isProductRuntimeIslandModule("\0virtual:typescript")).toBe(false);
    });

    it("Nitro plugin 不得用不会被 runtime 等待的 async callback 启动后台门禁", async () => {
        const pluginRoot = resolve("server", "plugins");
        const pluginFiles = (await readdir(pluginRoot))
            .filter((fileName) => fileName.endsWith(".ts") && !fileName.endsWith(".test.ts"));
        const invalid: string[] = [];
        for (const fileName of pluginFiles) {
            const source = await readFile(join(pluginRoot, fileName), "utf8");
            if (/defineNitroPlugin\(\s*async\b/u.test(source)) invalid.push(fileName);
        }

        expect(invalid).toEqual([]);
        const startup = await readFile(resolve("server", "middleware", "00-product-startup.ts"), "utf8");
        expect(startup).toContain("const startup = productRuntimeReady()");
        expect(startup).toContain("await startup");
    });
});
