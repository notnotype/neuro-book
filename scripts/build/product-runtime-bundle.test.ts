import {execFile} from "node:child_process";
import {createRequire} from "node:module";
import {access, mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {pathToFileURL} from "node:url";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {currentProductPlatform} from "nbook/packages/neuro-book-manager/src/platform";
import {assertBundledRuntimeSourcePaths} from "nbook/scripts/build/product-runtime-bundle";
import {
    PRODUCT_COMMAND_CHUNK_BASENAME,
    productOpaqueImportDefinitions,
} from "nbook/scripts/build/product-runtime-islands";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Product Runtime bundle", () => {
    it("区分短 Source Root 与其真实后代路径", () => {
        expect(() => assertBundledRuntimeSourcePaths([
            'export const applicationRoot = "/app";',
            'export {resolveApiErrorMessage} from "nbook/app/utils/api-error";',
        ].join("\n"), "/app")).not.toThrow();

        expect(() => assertBundledRuntimeSourcePaths(
            'export const sourcePath = "/app/server/runtime/index.ts";',
            "/app",
        )).toThrow("泄漏");
        expect(() => assertBundledRuntimeSourcePaths(
            'export const sourcePath = "C:\\\\source\\\\server\\\\runtime\\\\index.ts";',
            "C:\\source",
        )).toThrow("泄漏");
    });

    it("server runtime 只通过 package island require TypeScript", async () => {
        const sourceFiles = (await readdir("server", {recursive: true}))
            .filter((filePath) => filePath.endsWith(".ts")
                && !filePath.endsWith(".test.ts")
                && !filePath.endsWith(".d.ts"))
            .sort((left, right) => left.localeCompare(right));
        const forbiddenImport = /^\s*import\s+(?!type\b)(?:[^;\n]*\sfrom\s+)?["']typescript["'];?|\bimport\(\s*["']typescript["']\s*\)/mu;
        for (const relativePath of sourceFiles) {
            const source = await readFile(join("server", relativePath), "utf8");
            expect(source, `${relativePath} 不得把 TypeScript compiler 放入 Nitro module graph`)
                .not.toMatch(forbiddenImport);
        }
    });

    it("把 native 物理 URL 收敛到镜像内 package island，并清除 package manager metadata", async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), "nbook-product-runtime-bundle-"));
        temporaryRoots.push(outputRoot);
        const serverRoot = join(outputRoot, "server");
        const scratchRoot = join(outputRoot, ".build-scratch");
        await mkdir(serverRoot, {recursive: true});
        const requireFromSource = createRequire(import.meta.url);
        const esbuildEntry = pathToFileURL(requireFromSource.resolve("esbuild")).href;
        const zodEntry = pathToFileURL(requireFromSource.resolve("zod")).href;
        const yamlEntry = pathToFileURL(requireFromSource.resolve("yaml")).href;
        const chunkRoot = join(serverRoot, "chunks", "_");
        await Promise.all([
            mkdir(chunkRoot, {recursive: true}),
            mkdir(join(serverRoot, "commands"), {recursive: true}),
            mkdir(join(serverRoot, "authoring"), {recursive: true}),
        ]);
        await Promise.all([
            writeFile(join(serverRoot, "commands", "placeholder.mjs"), "export default true;\n", "utf8"),
            writeFile(join(serverRoot, "authoring", "placeholder.mjs"), "export default true;\n", "utf8"),
            writeFile(join(serverRoot, "authoring", "tsconfig.json"), JSON.stringify({
                compilerOptions: {target: "ESNext", lib: ["ESNext", "DOM", "DOM.Iterable"]},
            }), "utf8"),
        ]);
        await writeFile(join(serverRoot, "index.mjs"), [
            'import {createRequire} from "node:module";',
            'import "./chunks/_/cfg.mjs";',
            `import esbuild from ${JSON.stringify(esbuildEntry)};`,
            `import zod from ${JSON.stringify(zodEntry)};`,
            `import * as zodAgain from ${JSON.stringify(zodEntry)};`,
            'import {JSDOM} from "jsdom";',
            `import YAML from ${JSON.stringify(yamlEntry)};`,
            'const metadata = "../node_modules/.bun/zod@4.3.6/node_modules/zod/index.js";',
            "export {metadata};",
            "export default [esbuild.transform, zod.string, zodAgain.string, JSDOM, globalThis.__tsVersion, YAML.parse];",
        ].join("\n"), "utf8");
        await writeFile(join(chunkRoot, "cfg.mjs"), [
            'import {createRequire} from "node:module";',
            'globalThis._importMeta_ = globalThis._importMeta_ || {url:new URL("../../index.mjs", import.meta.url).href,env:process.env};',
            'const runtimeRequire = createRequire(globalThis._importMeta_.url);',
            'globalThis.__tsVersion = runtimeRequire("typescript").version;',
            'console.log(globalThis.__tsVersion);',
        ].join("\n"), "utf8");

        await execFileAsync("bun", ["scripts/build/product-runtime-bundle.ts"], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: outputRoot,
                NEURO_BOOK_PRODUCT_SCRATCH_ROOT: scratchRoot,
            },
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        const source = await readFile(join(serverRoot, "index.mjs"), "utf8");
        const islands = JSON.parse(await readFile(join(serverRoot, "native-islands.json"), "utf8")) as {
            schema: string;
            platform: string;
            islands: Array<{packages: string[]}>;
            opaqueImports: ReturnType<typeof productOpaqueImportDefinitions>;
        };

        expect(source).toContain("esbuild");
        expect(source).not.toContain(esbuildEntry);
        expect(source).not.toContain(zodEntry);
        expect(source).not.toContain(yamlEntry);
        expect(source).not.toContain("/.bun/");
        expect(source).not.toContain("/.pnpm/");
        expect(source).not.toContain("file:///_entry.js");
        expect(source).not.toContain('new URL("../../index.mjs"');
        expect(source).toContain("./node_modules/esbuild/lib/main.js");
        expect(source).toContain("./node_modules/jsdom/lib/api.js");
        expect(source).not.toContain('import("node-fetch")');
        expect(source).not.toContain("import('node-fetch')");
        expect(source).toContain("node_modules/zod/");
        expect(islands.platform).toBe(currentProductPlatform());
        expect(islands.schema).toBe("nbook.product-native-islands/v2");
        expect(islands.opaqueImports).toEqual(productOpaqueImportDefinitions());
        expect(islands.opaqueImports).toContainEqual(expect.objectContaining({
            pathPattern: `commands/chunks/${PRODUCT_COMMAND_CHUNK_BASENAME}-*.mjs`,
            count: 3,
        }));
        const islandPackages = islands.islands.flatMap((island) => island.packages);
        expect(islandPackages).toEqual(expect.arrayContaining(["jsdom", "typescript", "undici"]));
        await expect(access(join(serverRoot, "node_modules", "jsdom", "package.json"))).resolves.toBeUndefined();
        await expect(access(join(serverRoot, "node_modules", "typescript", "lib", "typescript.js"))).resolves.toBeUndefined();
        const executed = await execFileAsync("bun", ["--no-install", join(serverRoot, "index.mjs")], {
            cwd: outputRoot,
            env: {...process.env, NODE_PATH: ""},
            windowsHide: true,
        });
        expect(executed.stdout.trim()).toBe(requireFromSource("typescript").version);
        expect(dirname(requireFromSource.resolve("esbuild/package.json"))).not.toBe(serverRoot);
        await expect(access(join(scratchRoot, "runtime-bundle"))).rejects.toMatchObject({code: "ENOENT"});
    }, 60_000);

    it("拒绝候选镜像外的 runtime bundle scratch", async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), "nbook-product-runtime-bundle-image-"));
        const scratchRoot = await mkdtemp(join(tmpdir(), "nbook-product-runtime-bundle-scratch-"));
        temporaryRoots.push(outputRoot, scratchRoot);
        await mkdir(join(outputRoot, "server"), {recursive: true});
        await writeFile(join(outputRoot, "server", "index.mjs"), "export default true;\n", "utf8");

        await expect(execFileAsync("bun", ["scripts/build/product-runtime-bundle.ts"], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NEURO_BOOK_OUTPUT_DIR: outputRoot,
                NEURO_BOOK_PRODUCT_SCRATCH_ROOT: scratchRoot,
            },
            windowsHide: true,
        })).rejects.toThrow("scratch 必须位于候选镜像内");
    });
});
