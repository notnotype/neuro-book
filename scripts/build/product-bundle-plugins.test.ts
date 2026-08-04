import {execFile} from "node:child_process";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {promisify} from "node:util";

import {build} from "esbuild";
import {describe, expect, it} from "vitest";
import {productRuntimeCompatibilityPlugin} from "nbook/scripts/build/product-bundle-plugins";

const execFileAsync = promisify(execFile);

describe("Product bundle plugins", () => {
    it("在 gaxios 稳定源码路径内投影 node-fetch fallback", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-gaxios-plugin-"));
        try {
            const sourcePath = join(root, "gaxios", "build", "cjs", "src", "gaxios.js");
            await mkdir(join(root, "gaxios", "build", "cjs", "src"), {recursive: true});
            await writeFile(sourcePath, [
                "export const fetchImplementation = (await import('node-fetch')).default;",
            ].join("\n"), "utf8");
            const result = await build({
                entryPoints: [sourcePath],
                bundle: true,
                format: "esm",
                platform: "node",
                write: false,
                plugins: [productRuntimeCompatibilityPlugin()],
            });
            expect(result.outputFiles[0]!.text).toContain("globalThis.fetch.bind(globalThis)");
            expect(result.outputFiles[0]!.text).not.toContain("node-fetch");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("统一静态化pi-ai已知loader，只保留auth context opaque seam", async () => {
        const probe = await execFileAsync("bun", ["-e", BUN_PLUGIN_PROBE], {
            cwd: process.cwd(),
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        const result = JSON.parse(probe.stdout) as {opaqueImports: number; specifiers: string[]};

        expect(result.opaqueImports).toBe(1);
        expect(result.specifiers).toEqual(expect.arrayContaining([
            "node:fs",
            "node:os",
            "node:path",
            "./bedrock-converse-stream.js",
            "./anthropic.js",
            "./openai-codex.js",
            "./github-copilot.js",
        ]));
    });

    it("为code splitting后的Web提取CommonJS入口保留命名导出", async () => {
        const workspaceRoot = resolve(".agent", "tmp");
        await mkdir(workspaceRoot, {recursive: true});
        const root = await mkdtemp(join(workspaceRoot, "readability-interop-"));
        const sourceRoot = join(root, "source");
        const outputRoot = join(root, "output");
        try {
            await mkdir(sourceRoot, {recursive: true});
            await writeFile(join(sourceRoot, "readability.mjs"), [
                "export async function webExtractionExportTypes() {",
                "    const [{Readability}, {gfm}] = await Promise.all([",
                '        import("@mozilla/readability"),',
                '        import("turndown-plugin-gfm"),',
                "    ]);",
                "    return [typeof Readability, typeof gfm];",
                "}",
            ].join("\n"), "utf8");
            await writeFile(join(sourceRoot, "sentinel.mjs"), "export const sentinel = true;\n", "utf8");

            await build({
                absWorkingDir: process.cwd(),
                entryPoints: {
                    readability: join(sourceRoot, "readability.mjs"),
                    sentinel: join(sourceRoot, "sentinel.mjs"),
                },
                bundle: true,
                splitting: true,
                format: "esm",
                platform: "node",
                target: "esnext",
                minify: true,
                outdir: outputRoot,
                outExtension: {".js": ".mjs"},
                plugins: [productRuntimeCompatibilityPlugin()],
            });

            const bundle = await import(`${pathToFileURL(join(outputRoot, "readability.mjs")).href}?interop-test`);
            expect(await bundle.webExtractionExportTypes()).toEqual(["function", "function"]);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});

const BUN_PLUGIN_PROBE = String.raw`
import {resolve} from "node:path";
import {build} from "esbuild";
import {init, parse} from "es-module-lexer";
import {productPiAiImportPlugin} from "nbook/scripts/build/product-bundle-plugins";
await init;
const result = await build({
    entryPoints: [
        resolve("node_modules/@earendil-works/pi-ai/dist/auth/context.js"),
        resolve("node_modules/@earendil-works/pi-ai/dist/env-api-keys.js"),
        resolve("node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.lazy.js"),
        resolve("node_modules/@earendil-works/pi-ai/dist/utils/oauth/load.js"),
    ],
    bundle: true,
    target: "esnext",
    platform: "node",
    format: "esm",
    minify: true,
    sourcemap: false,
    write: false,
    outdir: "probe-output",
    plugins: [productPiAiImportPlugin()],
    external: ["*"],
});
const imports = [];
for (const output of result.outputFiles) {
    const [outputImports] = parse(output.text);
    imports.push(...outputImports);
}
console.log(JSON.stringify({
    opaqueImports: imports.filter((item) => !item.n && item.d >= 0).length,
    specifiers: imports.flatMap((item) => item.n ?? []),
}));
`;
