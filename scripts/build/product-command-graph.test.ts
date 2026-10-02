import {execFile} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join, relative} from "node:path";
import {pathToFileURL} from "node:url";
import {promisify} from "node:util";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {describe, expect, it} from "vitest";
import {buildProductCommands, PRODUCT_COMMAND_SOURCES} from "#scripts/build/product-command-bundle";

describe("正式 Product 命令构建图", () => {
    it("不同正式命令入口共享同一源模块的实例与可变状态", async () => {
        const root = await createTestTmpRoot("product-command-graph");
        try {
            const sourceRoot = join(root, "source");
            const imageRoot = join(root, "image");
            const shared = join(sourceRoot, "shared.mjs");
            await mkdir(sourceRoot, {recursive: true});
            await writeFile(shared, "export const state = {count: 0}; export function increment() {return ++state.count;}\n");
            for (const source of Object.values(PRODUCT_COMMAND_SOURCES)) {
                const entry = join(sourceRoot, source);
                await mkdir(dirname(entry), {recursive: true});
                const specifier = relative(dirname(entry), shared).replaceAll("\\", "/");
                await writeFile(entry, `export {state, increment} from ${JSON.stringify(specifier.startsWith(".") ? specifier : `./${specifier}`)};\n`);
            }
            await mkdir(join(sourceRoot, "prisma", "migrations", "sqlite"), {recursive: true});
            await writeFile(join(sourceRoot, "prisma", "schema.sqlite.prisma"), "// fixture schema\n");
            const result = await buildProductCommands(imageRoot, sourceRoot);
            const entries = [result.entries.profile, result.entries.variable, result.entries.workspace];
            const probe = `const modules = await Promise.all(${JSON.stringify(entries.map((entry) => pathToFileURL(join(imageRoot, entry)).href))}.map((entry) => import(entry))); console.log(JSON.stringify({same: modules.every((module) => module.state === modules[0].state), increments: modules.map((module) => module.increment()), count: modules[0].state.count}));`;
            const {stdout} = await promisify(execFile)("bun", ["--no-install", "--no-env-file", "--eval", probe], {cwd: root, timeout: 10_000});
            expect(JSON.parse(stdout)).toEqual({same: true, increments: [1, 2, 3], count: 3});
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});
