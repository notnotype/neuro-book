#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {preparePrismaEnv} from "./prisma-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const applicationPackageRoot = resolve(scriptDir, "..", "..");
const applicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT?.trim()
    ? resolve(process.env.NEURO_BOOK_APPLICATION_ROOT)
    : applicationPackageRoot;
const configRoot = await existingConfigRoot(applicationRoot, applicationPackageRoot);
const configPath = resolve(configRoot, "prisma.config.ts");
const env = preparePrismaEnv({applicationRoot});
const bunCommand = Bun.which("bun") ?? process.execPath;

await runPrismaGenerate(resolve(configRoot, "prisma", "schema.sqlite.prisma"));
await runPrismaGenerate(resolve(configRoot, "prisma", "project.schema.prisma"));

/** 顺序生成App与Project Client，任一schema失败都立即终止发布链。 */
async function runPrismaGenerate(schema) {
    const retryDelays = [0, 250, 500, 1_000, 2_000];
    for (const [attempt, delayMs] of retryDelays.entries()) {
        if (delayMs > 0) {
            await sleep(delayMs);
        }
        const result = await spawnPrismaGenerate(schema);
        if (result.signal) {
            process.kill(process.pid, result.signal);
            return;
        }
        if (result.code === 0) {
            return;
        }
        const canRetry = result.stderr.includes("EBUSY") && attempt < retryDelays.length - 1;
        if (!canRetry) {
            process.exit(result.code ?? 1);
        }
        console.warn(`Prisma generate遇到Windows文件占用，准备重试 ${schema}（${attempt + 2}/${retryDelays.length}）`);
    }
}

/** 执行一次Prisma generate，并保留stderr用于识别Windows瞬时文件占用。 */
async function spawnPrismaGenerate(schema) {
    const child = spawn(bunCommand, [
        "x",
        "prisma",
        "generate",
        "--config",
        configPath,
        "--schema",
        schema,
    ], {
        cwd: applicationRoot,
        env: {...process.env, DATABASE_KIND: env.kind, DATABASE_URL: env.databaseUrl},
        stdio: ["inherit", "inherit", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
        stderr += chunk;
        process.stderr.write(chunk);
    });
    const result = await new Promise((resolvePromise) => {
        child.once("exit", (code, signal) => resolvePromise({code, signal}));
    });
    return {...result, stderr};
}

async function existingConfigRoot(primary, fallback) {
    const {access} = await import("node:fs/promises");
    try {
        await access(resolve(primary, "prisma.config.ts"));
        return primary;
    } catch {
        return fallback;
    }
}
