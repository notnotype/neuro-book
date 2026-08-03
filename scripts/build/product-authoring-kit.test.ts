import {execFile} from "node:child_process";
import {access, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";
import {assertAuthoringDeclarationSourcePaths} from "nbook/scripts/build/product-authoring-kit";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Product Profile Authoring Kit", () => {
    it("区分精确运行根与 Source Root 后代路径", () => {
        expect(() => assertAuthoringDeclarationSourcePaths(
            'declare const applicationRoot: "/app";',
            "/app",
            "profile-sdk/index.d.ts",
        )).not.toThrow();
        expect(() => assertAuthoringDeclarationSourcePaths(
            'declare const sourcePath: "/app/profile-sdk/index.ts";',
            "/app",
            "profile-sdk/index.d.ts",
        )).toThrow("泄漏");
    });

    it("只投影 compiler、SDK 与可达声明图", async () => {
        const outputRoot = await mkdtemp(join(tmpdir(), "nbook-product-authoring-kit-"));
        temporaryRoots.push(outputRoot);

        await execFileAsync("bun", ["scripts/build/product-authoring-kit.ts"], {
            cwd: process.cwd(),
            env: {...process.env, NEURO_BOOK_OUTPUT_DIR: outputRoot},
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        const authoringRoot = join(outputRoot, "server", "authoring");

        for (const required of [
            ["profile-compile-worker.mjs"],
            ["types", "profile-sdk", "index.d.ts"],
            ["types", "profile-sdk", "contracts.d.ts"],
            ["types", "profile-sdk", "writing.d.ts"],
            ["types", "variable-sdk", "index.d.ts"],
            ["sdk-source", "profile-sdk", "contracts.ts"],
            ["sdk-source", "profile-sdk", "writing.ts"],
            ["nbook", "profile-sdk", "writing.mjs"],
            ["nbook", "variable-sdk", "index.mjs"],
            ["nbook", "world-engine", "schema", "index.mjs"],
            ["nbook", "world-engine", "zod.mjs"],
            ["node_modules", "typebox", "package.json"],
            ["node_modules", "@types", "node", "index.d.ts"],
            ["node_modules", "undici-types", "package.json"],
        ]) {
            // Bun 与 Node 对成功 access 的返回值不同；没有抛错即表示文件存在。
            await access(join(authoringRoot, ...required));
        }
        const projectedJsxRuntime = await readFile(
            join(authoringRoot, "nbook", "profile-sdk", "jsx-runtime.mjs"),
            "utf8",
        );
        const projectedJsxDevRuntime = await readFile(
            join(authoringRoot, "nbook", "profile-sdk", "jsx-dev-runtime.mjs"),
            "utf8",
        );
        expect(projectedJsxRuntime).toContain('from"./index.mjs"');
        expect(projectedJsxDevRuntime).toContain('from"./jsx-runtime.mjs"');
        expect(`${projectedJsxRuntime}\n${projectedJsxDevRuntime}`).not.toMatch(/from["']nbook\//u);
        for (const forbidden of ["server", "app", "docs"]) {
            await expect(access(join(authoringRoot, forbidden))).rejects.toMatchObject({code: "ENOENT"});
        }
        await expect(access(join(authoringRoot, "types", "authoring-runtime-globals.d.ts")))
            .rejects.toMatchObject({code: "ENOENT"});
        await expect(access(join(authoringRoot, "types", "optional-peers", "modelcontextprotocol-client.d.ts")))
            .rejects.toMatchObject({code: "ENOENT"});
        await expect(access(join(authoringRoot, "node_modules", "h3")))
            .rejects.toMatchObject({code: "ENOENT"});
        const dependencyManifest = JSON.parse(await readFile(join(authoringRoot, "authoring-dependencies.json"), "utf8")) as {
            schema?: string;
            dependencies?: Array<{name?: string}>;
            instances?: Array<{name?: string; version?: string; kind?: string; location?: string; topLevel?: boolean}>;
        };
        expect(dependencyManifest.schema).toBe("nbook.product-authoring-dependencies/v2");
        expect(dependencyManifest.dependencies?.map((dependency) => dependency.name).sort())
            .toEqual(["@types/node", "typebox", "undici-types"]);
        expect([...new Set(dependencyManifest.instances?.map((instance) => instance.name))].sort())
            .toEqual(["@types/node", "typebox", "undici-types"]);
        for (const forbiddenPackage of [
            "@earendil-works/pi-agent-core",
            "@earendil-works/pi-ai",
            "@prisma/client",
            "zod",
        ]) {
            await expect(access(join(authoringRoot, "node_modules", ...forbiddenPackage.split("/"))))
                .rejects.toMatchObject({code: "ENOENT"});
        }
        const worldSchemaRuntime = await readFile(
            join(authoringRoot, "nbook", "world-engine", "schema", "index.mjs"),
            "utf8",
        );
        expect(worldSchemaRuntime).toContain("../zod.mjs");
        expect(worldSchemaRuntime).not.toContain('from"zod"');
        const zodRuntime = await import(pathToFileURL(
            join(authoringRoot, "nbook", "world-engine", "zod.mjs"),
        ).href) as {z?: {object?: unknown}; default?: {object?: unknown}};
        expect(typeof zodRuntime.z?.object).toBe("function");
        expect(typeof zodRuntime.default?.object).toBe("function");

        const probePath = join(authoringRoot, "profile-smoke.tsx");
        const probeTsconfigPath = join(authoringRoot, "tsconfig.smoke.json");
        await writeFile(probePath, `
/** @jsxImportSource nbook/profile-sdk */
/** @jsxRuntime automatic */
import {ProfilePrompt, Static, System, Type, builtin, defineAgentProfile, toolset} from "nbook/profile-sdk";
import {DEFAULT_WRITING_STYLE_PRESET} from "nbook/profile-sdk/writing";

const InitialSchema = Type.Object({topic: Type.String()});
type Initial = Static<typeof InitialSchema>;

export default defineAgentProfile({
    manifest: {key: "authoring-smoke", name: DEFAULT_WRITING_STYLE_PRESET},
    initialSchema: InitialSchema,
    tools: toolset(builtin.file.read),
    context(ctx) {
        const initial: Initial = ctx.initial;
        return <ProfilePrompt><System>{initial.topic}</System></ProfilePrompt>;
    },
});
`, "utf8");
        await writeFile(join(authoringRoot, "variable-smoke.ts"), `
import {Type, defineWorkspaceRootVariable, type VariableDefinition} from "nbook/variable-sdk";

export const definitions: VariableDefinition[] = [defineWorkspaceRootVariable({
    key: "authoring.topic",
    schema: Type.String(),
    default: "",
})];
`, "utf8");
        await writeFile(probeTsconfigPath, `${JSON.stringify({
            extends: "./tsconfig.json",
            include: ["./profile-smoke.tsx", "./variable-smoke.ts"],
        }, null, 4)}\n`, "utf8");
        await execFileAsync("bun", [resolve("node_modules/typescript/bin/tsc"), "--project", probeTsconfigPath, "--pretty", "false"], {
            cwd: authoringRoot,
            env: {...process.env},
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });

        const bundleRoot = join(authoringRoot, "smoke-output");
        const bundleScriptPath = join(authoringRoot, "bundle-smoke.ts");
        await writeFile(bundleScriptPath, `
import {join} from "node:path";
const authoringRoot = import.meta.dir;
const aliases = new Map([
    ["nbook/profile-sdk", join(authoringRoot, "nbook", "profile-sdk", "index.mjs")],
    ["nbook/profile-sdk/writing", join(authoringRoot, "nbook", "profile-sdk", "writing.mjs")],
    ["nbook/profile-sdk/jsx-runtime", join(authoringRoot, "nbook", "profile-sdk", "jsx-runtime.mjs")],
    ["nbook/profile-sdk/jsx-dev-runtime", join(authoringRoot, "nbook", "profile-sdk", "jsx-dev-runtime.mjs")],
]);
const result = await Bun.build({
    entrypoints: [join(authoringRoot, "profile-smoke.tsx")],
    outdir: join(authoringRoot, "smoke-output"),
    target: "bun",
    format: "esm",
    minify: true,
    sourcemap: "none",
    external: ["bun", "bun:*"],
    plugins: [{
        name: "authoring-sdk",
        setup(build) {
            build.onResolve({filter: /^nbook\\/profile-sdk(?:\\/writing|\\/jsx(?:-dev)?-runtime)?$/u}, (args) => {
                const path = aliases.get(args.path);
                if (!path) throw new Error(\`没有 Authoring SDK alias：\${args.path}\`);
                return {path};
            });
        },
    }],
});
if (!result.success) throw new Error(result.logs.map((log) => log.message).join("\\n"));
console.log(JSON.stringify({path: result.outputs[0].path}));
`, "utf8");
        const bundleResult = await execFileAsync("bun", [bundleScriptPath], {
            cwd: authoringRoot,
            env: {...process.env},
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        const bundledProfilePath = (JSON.parse(bundleResult.stdout) as {path: string}).path;
        await access(bundleRoot);
        const {stdout} = await execFileAsync("bun", ["-e", `
const profile = await import(${JSON.stringify(pathToFileURL(bundledProfilePath).href)});
if (profile.default?.manifest?.key !== "authoring-smoke") throw new Error("unexpected Profile export");
console.log(profile.default.manifest.key);
`], {
            cwd: authoringRoot,
            env: {...process.env},
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        expect(stdout.trim()).toBe("authoring-smoke");

        const declarationFiles: string[] = [];
        const collectDeclarations = async (directory: string): Promise<void> => {
            for (const entry of await readdir(directory, {withFileTypes: true})) {
                const path = join(directory, entry.name);
                if (entry.isDirectory()) await collectDeclarations(path);
                else if (/\.d\.(?:ts|mts|cts)$/u.test(entry.name)) declarationFiles.push(path);
            }
        };
        await collectDeclarations(authoringRoot);
        expect(declarationFiles.length).toBeLessThan(2_000);
        const machinePath = process.cwd().replaceAll("\\", "/");
        for (const declarationFile of declarationFiles) {
            const declarationSource = (await readFile(declarationFile, "utf8")).replaceAll("\\", "/");
            expect(declarationSource).not.toContain(machinePath);
            expect(declarationSource).not.toMatch(/node_modules\/(?:\.bun|\.pnpm)\//u);
            expect(declarationSource).not.toMatch(/(?:\.\.\/)+node_modules\//u);
        }
    }, 360_000);
});
