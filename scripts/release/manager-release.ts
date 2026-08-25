#!/usr/bin/env bun
import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {Command} from "commander";

import {run, runCapture} from "#scripts/utils/process.mjs";

type ReleaseOptions = {
    version: string;
    push: boolean;
    yes: boolean;
    dryRun: boolean;
};

const ROOT = resolve(import.meta.dir, "..", "..");
const PACKAGE_PATH = resolve(ROOT, "packages", "neuro-book-manager", "package.json");

const program = new Command()
    .name("manager-release")
    .description("Release @notnotype/neuro-book-manager independently from the app.");

for (const channel of ["stable", "canary"] as const) {
    program.command(channel)
        .requiredOption("--version <version>", "Manager SemVer；canary 必须带 prerelease。")
        .option("--push", "推送 release commit 和 manager tag。", false)
        .option("--yes", "确认执行远端发布准备。", false)
        .option("--dry-run", "只输出计划。", false)
        .action((options: ReleaseOptions) => releaseManager(channel, options));
}

await program.parseAsync(process.argv);

/** 更新 Manager 版本、验证、提交并创建 manager-v* tag。 */
async function releaseManager(channel: "stable" | "canary", options: ReleaseOptions): Promise<void> {
    const version = normalizeVersion(options.version);
    if (channel === "stable" && version.includes("-")) {
        throw new Error("stable Manager 版本不能包含 prerelease。");
    }
    if (channel === "canary" && !version.includes("-")) {
        throw new Error("canary Manager 版本必须包含 prerelease。");
    }
    const tag = `manager-v${version}`;
    const current = await packageVersion();
    if (options.dryRun) {
        console.log(JSON.stringify({channel, current, version, tag, push: options.push}, null, 4));
        return;
    }
    if (!options.yes || !options.push) {
        throw new Error("真实 Manager release 必须同时传 --yes --push。");
    }
    const status = (await runCapture("git", ["status", "--porcelain", "--untracked-files=normal"], {cwd: ROOT})).trim();
    if (status) {
        throw new Error("Manager release 要求工作区完全干净。");
    }
    const packageJson = JSON.parse(await readFile(PACKAGE_PATH, "utf8")) as {version: string};
    packageJson.version = version;
    await writeFile(PACKAGE_PATH, `${JSON.stringify(packageJson, null, 4)}\n`, "utf8");
    await run("bun", ["install", "--lockfile-only"], {cwd: ROOT});
    await run("bun", ["run", "--cwd", "packages/neuro-book", "runtime:typecheck"], {cwd: ROOT});
    await run("bun", ["run", "manager:typecheck"], {cwd: ROOT});
    await run("bun", ["run", "manager:test"], {cwd: ROOT});
    await run("bun", ["run", "manager:pack"], {cwd: ROOT});
    await run("git", ["add", "packages/neuro-book-manager/package.json", "bun.lock"], {cwd: ROOT});
    await run("git", ["commit", "-m", `chore(manager): release v${version}`], {cwd: ROOT});
    await run("git", ["tag", tag], {cwd: ROOT});
    await run("git", ["push", "origin", "HEAD:master"], {cwd: ROOT});
    await run("git", ["push", "origin", tag], {cwd: ROOT});
    console.log(`Manager release tag pushed: ${tag}`);
}

function normalizeVersion(input: string): string {
    const version = input.trim().replace(/^v/u, "");
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
        throw new Error(`非法 Manager SemVer：${input}`);
    }
    return version;
}

async function packageVersion(): Promise<string> {
    const packageJson = JSON.parse(await readFile(PACKAGE_PATH, "utf8")) as {version: string};
    return packageJson.version;
}
