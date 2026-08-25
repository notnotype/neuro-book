#!/usr/bin/env bun
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {materializePublicManagerPackage} from "#scripts/release/public-manager-package";
import {run, runCapture} from "#scripts/utils/process.mjs";

const ROOT = resolve(import.meta.dir, "..", "..");
const PACKAGE_ROOT = resolve(ROOT, "packages", "neuro-book-manager");
const packageJson = await Bun.file(resolve(PACKAGE_ROOT, "package.json")).json() as {name: string; version: string};
const temporaryRoot = await mkdtemp(join(tmpdir(), "neuro-book-public-manager-"));

try {
    const publicPackage = await materializePublicManagerPackage(packageJson.version, temporaryRoot);
    // actions/checkout可能只有单提交；只在对象缺失时抓取公开gitHead。
    // 不能使用--depth：它会把原本完整的开发仓库改写为shallow repository。
    try {
        await runCapture("git", ["cat-file", "-e", `${publicPackage.gitHead}^{commit}`], {cwd: ROOT});
    } catch {
        await run("git", ["fetch", "--no-tags", "origin", publicPackage.gitHead], {cwd: ROOT});
        await runCapture("git", ["cat-file", "-e", `${publicPackage.gitHead}^{commit}`], {cwd: ROOT});
    }
    const changedInputs = (await runCapture("git", [
        "diff",
        "--name-only",
        publicPackage.gitHead,
        "--",
        "bun.lock",
        "packages/neuro-book-manager/package.json",
        "packages/neuro-book-manager/scripts/build.mjs",
        "packages/neuro-book-manager/src",
        "server/runtime",
    ], {cwd: ROOT})).trim();
    if (changedInputs) {
        throw new Error(`当前Manager构建输入晚于npm公开gitHead ${publicPackage.gitHead}：\n${changedInputs}`);
    }
    // 隔离安装公开包及其生产依赖：验证不得依赖宿主任意 node_modules（bun auto-install
    // 或家目录残留都会让结果不可信）。
    await writeFile(join(temporaryRoot, "package.json"), "{\"private\":true}\n", "utf8");
    await run("bun", ["add", join(temporaryRoot, "public-manager.tgz"), "--cwd", temporaryRoot], temporaryRoot);
    const installedExecutable = join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "dist", "neuro-book.mjs");
    const reportedVersion = (await runCapture("bun", [installedExecutable, "--version"], {cwd: ROOT})).trim();
    if (reportedVersion !== packageJson.version) {
        throw new Error(`npm公开Manager --version错误：${reportedVersion}`);
    }
    console.log(`Manager ${packageJson.version}已由gitHead ${publicPackage.gitHead}公开，当前构建输入未漂移。`);
} finally {
    await rm(temporaryRoot, {recursive: true, force: true});
}
