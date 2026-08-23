import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

import {describe, expect, it} from "vitest";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const APPLICATION_ROOT = resolve(ROOT, "packages", "neuro-book");

type RootPackage = {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
};

type ReleaseWorkflow = string;

type GeneratedTsConfig = {
    extends?: string;
    include?: string[];
    compilerOptions: {
        module: string;
        moduleResolution: string;
    };
};

describe("Manager release clean-checkout contract", () => {
    it("Runtime typecheck self-prepares Prisma and directly owns imported mdast types", async () => {
        const packageJson = JSON.parse(
            await readFile(resolve(APPLICATION_ROOT, "package.json"), "utf8"),
        ) as RootPackage;
        const releaseWorkflow = await readFile(
            resolve(ROOT, ".github", "workflows", "release-manager.yml"),
            "utf8",
        ) as ReleaseWorkflow;
        const generatedTsConfig = JSON.parse(
            (await readFile(resolve(APPLICATION_ROOT, "server", "generated", "tsconfig.json"), "utf8"))
                .replace(/^\s*\/\/.*$/gmu, ""),
        ) as GeneratedTsConfig;
        const sharedTsConfig = JSON.parse(
            await readFile(resolve(APPLICATION_ROOT, "shared", "tsconfig.json"), "utf8"),
        ) as GeneratedTsConfig;

        expect(packageJson.scripts["runtime:typecheck"]).toMatch(/^bun run generate && /u);
        expect(releaseWorkflow.indexOf("bun run --cwd packages/neuro-book nuxt:prepare")).toBeGreaterThan(-1);
        expect(releaseWorkflow.indexOf("bun run --cwd packages/neuro-book nuxt:prepare")).toBeLessThan(
            releaseWorkflow.indexOf("bun run manager:test"),
        );
        expect(packageJson.devDependencies["@types/mdast"]).toBeTruthy();
        expect(generatedTsConfig.extends).toBeUndefined();
        expect(generatedTsConfig.compilerOptions).toMatchObject({
            module: "ESNext",
            moduleResolution: "Bundler",
        });
        expect(sharedTsConfig.extends).toBeUndefined();
        expect(sharedTsConfig.compilerOptions).toMatchObject({
            module: "ESNext",
            moduleResolution: "Bundler",
        });
    });
});
