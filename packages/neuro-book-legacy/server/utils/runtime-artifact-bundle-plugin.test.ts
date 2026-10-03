import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {build} from "esbuild";
import {runtimeArtifactBundlePlugin} from "nbook/server/utils/runtime-artifact-bundle-plugin";
import type {RuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Runtime Artifact bundle plugin", () => {
    it("批准包根缺少依赖时不向 importer 祖先回退", async () => {
        const root = await mkdtemp(testHostPath("nbook-authoring-plugin-"));
        roots.push(root);
        const packageRoot = join(root, "authoring", "package.json");
        await mkdir(join(root, "authoring"), {recursive: true});
        await writeFile(packageRoot, `${JSON.stringify({name: "fixture-authoring", private: true})}\n`, "utf8");
        const context: RuntimeArtifactCompilerContext = {
            kind: "product-candidate",
            root,
            productRuntime: true,
            imageRoot: root,
            outputRoot: root,
            nbookRoot: resolve("."),
            compilerPackageRoot: packageRoot,
            compilerNodeModulesRoot: join(root, "authoring", "node_modules"),
            artifactRuntimeRequireRoot: join(root, "server", "index.mjs"),
            tsconfigPath: resolve("tsconfig.json"),
        };

        await expect(build({
            bundle: true,
            entryPoints: [resolve("variable-sdk", "index.ts")],
            logLevel: "silent",
            outfile: join(root, "output.mjs"),
            plugins: [runtimeArtifactBundlePlugin(context, "fixture-authoring")],
            platform: "node",
        })).rejects.toThrow("Authoring Kit 未登记依赖：typebox");
    });
});
