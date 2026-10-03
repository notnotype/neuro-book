import {afterEach, describe, expect, it} from "vitest";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"

import {ensurePrismaRuntime, resolvePrismaRuntimePlan} from "nbook/server/deploy/prisma-runtime-preflight";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-prisma-preflight-"));
    tempRoots.push(root);
    return root;
}

async function writeGenerateScript(root: string): Promise<string> {
    const generateScriptPath = join(root, "scripts", "db", "prisma-generate.mjs");
    await mkdir(dirname(generateScriptPath), {recursive: true});
    await writeFile(generateScriptPath, "", "utf8");
    return generateScriptPath;
}

async function writeNuxtCli(root: string): Promise<void> {
    const nuxtPath = join(root, "node_modules", ".bin", "nuxt");
    await mkdir(dirname(nuxtPath), {recursive: true});
    await writeFile(nuxtPath, "", "utf8");
}

async function writeNuxtTsConfig(root: string): Promise<void> {
    const nuxtTsConfigPath = join(root, ".nuxt", "tsconfig.json");
    await mkdir(dirname(nuxtTsConfigPath), {recursive: true});
    await writeFile(nuxtTsConfigPath, "{}", "utf8");
}

afterEach(async () => {
    for (const root of tempRoots.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

describe("Prisma runtime preflight", () => {
    it("源码模式缺少 App Prisma Client 时会自动生成", async () => {
        const root = await tempRoot();
        const generateScriptPath = await writeGenerateScript(root);
        const clientPath = join(root, "server", "generated", "prisma", "client.ts");
        const calls: Array<{command: string; args: string[]}> = [];
        await writeNuxtCli(root);

        await ensurePrismaRuntime({
            cwd: root,
            scriptPath: join(root, "scripts", "cli", "create-admin.ts"),
            runCommand: async (command, args) => {
                calls.push({command, args});
                if (args[0] === "run") {
                    const nuxtTsConfigPath = join(root, ".nuxt", "tsconfig.json");
                    await mkdir(dirname(nuxtTsConfigPath), {recursive: true});
                    await writeFile(nuxtTsConfigPath, "{}", "utf8");
                    return;
                }
                await mkdir(dirname(clientPath), {recursive: true});
                await writeFile(clientPath, "", "utf8");
            },
        });

        expect(calls).toEqual([
            {
                command: process.execPath,
                args: ["run", "nuxt:prepare"],
            },
            {
                command: process.execPath,
                args: [generateScriptPath],
            },
        ]);
    });

    it("源码模式缺少 Nuxt CLI 时直接提示安装依赖", async () => {
        const root = await tempRoot();
        const calls: string[] = [];
        await writeGenerateScript(root);

        await expect(ensurePrismaRuntime({
            cwd: root,
            scriptPath: join(root, "scripts", "cli", "create-admin.ts"),
            runCommand: async (command) => {
                calls.push(command);
            },
        })).rejects.toThrow("源码部署缺少本地 Nuxt CLI");

        expect(calls).toEqual([]);
    });

    it("源码模式残留 Nuxt TS 配置但缺少 Nuxt CLI 时也提示安装依赖", async () => {
        const root = await tempRoot();
        const calls: string[] = [];
        await writeGenerateScript(root);
        await writeNuxtTsConfig(root);

        await expect(ensurePrismaRuntime({
            cwd: root,
            scriptPath: join(root, "scripts", "cli", "create-admin.ts"),
            runCommand: async (command) => {
                calls.push(command);
            },
        })).rejects.toThrow("源码部署缺少本地 Nuxt CLI");

        expect(calls).toEqual([]);
    });

    it("Nuxt prepare 失败时不会误报 Prisma generate", async () => {
        const root = await tempRoot();
        await writeGenerateScript(root);
        await writeNuxtCli(root);

        await expect(ensurePrismaRuntime({
            cwd: root,
            scriptPath: join(root, "scripts", "cli", "create-admin.ts"),
            runCommand: async (_command, args) => {
                if (args[0] === "run") {
                    throw new Error("nuxt missing");
                }
            },
        })).rejects.toThrow("Nuxt prepare 失败：nuxt missing");
    });

    it("Prisma generate 失败时保留 Prisma 阶段提示", async () => {
        const root = await tempRoot();
        await writeGenerateScript(root);
        await writeNuxtCli(root);
        await writeNuxtTsConfig(root);

        await expect(ensurePrismaRuntime({
            cwd: root,
            scriptPath: join(root, "scripts", "cli", "create-admin.ts"),
            runCommand: async () => {
                throw new Error("generate missing");
            },
        })).rejects.toThrow("Prisma generate 失败：generate missing");
    });

    it("Product 模式信任已验证 bundle，不再寻找或生成源码 Prisma Client", async () => {
        const root = await tempRoot();
        const calls: string[] = [];
        const commandPath = join(root, ".output", "server", "commands", "chunks", "create-admin.mjs");
        const plan = resolvePrismaRuntimePlan({
            cwd: root,
            scriptPath: commandPath,
        });

        await expect(ensurePrismaRuntime({
            cwd: root,
            scriptPath: commandPath,
            exists: (path) => path.replaceAll("\\", "/") === commandPath.replaceAll("\\", "/"),
            runCommand: async (command) => {
                calls.push(command);
            },
        })).resolves.toBeUndefined();
        expect(plan.mode).toBe("product");
        expect(plan.clientPath).toBe(commandPath.replaceAll("\\", "/"));
        expect(calls).toEqual([]);
    });

    it("has-users 不再顶层导入 Prisma", async () => {
        const text = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "cli", "has-users.ts"), "utf8");

        expect(text).not.toContain('import {prisma} from "nbook/server/utils/prisma"');
        expect(text).toContain('await import("nbook/server/utils/prisma")');
    });
});
