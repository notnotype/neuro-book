/**
 * 初始化 Skill（docs/specs/agent/skills.md 输出 18–21 与场景 4、5）：真跑应用的 Bun 安装（只依赖本地的 `file:` 包，不联网），
 * 另起一个进程拿锁。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {SkillCatalog} from "./catalog";
import {SkillInstaller} from "./install";
import {MARKER_FILE} from "./readiness";

let tmp = "";
let counter = 0;
const cleanups: Array<() => Promise<void> | void> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-agent", "skills-install");
});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 一个用户的 Skill，依赖同级目录里的本地包 `local-dep`；脚本导入它。 */
async function scene() {
    counter += 1;
    const base = join(tmp, `s${String(counter)}`);
    const skills = join(base, "skills");
    const dep = join(base, "local-dep");
    await mkdir(dep, {recursive: true});
    await writeFile(join(dep, "package.json"), JSON.stringify({name: "local-dep", version: "1.0.0", main: "index.js"}));
    await writeFile(join(dep, "index.js"), "module.exports = {answer: 42};\n");
    const directory = join(skills, "epub-export");
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, "SKILL.md"), "---\nname: epub-export\ndescription: 导出\n---\n\n正文\n");
    await writeFile(join(directory, "package.json"), JSON.stringify({name: "epub-export", private: true, dependencies: {"local-dep": `file:${dep}`}}));
    await writeFile(join(directory, "run.js"), "console.log(require(\"local-dep\").answer);\n");
    const locksRoot = join(base, "locks");
    let installer: SkillInstaller | null = null;
    const catalog = await SkillCatalog.open({roots: [{source: "user", root: skills, watch: false}], clock: systemClock, report: () => undefined, installing: (id) => installer?.installing(id) ?? false});
    installer = new SkillInstaller({item: (id) => catalog.item(id), refresh: (id) => catalog.refresh(id), locksRoot, bun: process.execPath, clock: systemClock});
    const own = installer;
    cleanups.push(() => catalog.close(), () => own.stop());
    return {directory, catalog, installer: own, locksRoot};
}

const status = (catalog: SkillCatalog) => catalog.item("user.epub-export")?.entry.status;

describe("初始化", () => {
    test("场景 4：没有 bun.lock 时先要 resolve；确认后装好、生成锁文件、写下标记、变成可用，脚本能导入依赖；之后按锁装", async () => {
        const {directory, catalog, installer} = await scene();
        expect(status(catalog)).toBe("needs-init");
        expect(await installer.plan("user.epub-export")).toEqual({ok: true, plan: {lock: false, dependencies: ["local-dep"]}});
        expect(await installer.init("user.epub-export")).toEqual({ok: false, code: "lock-missing"});

        expect(await installer.init("user.epub-export", {resolve: true})).toEqual({ok: true});
        expect(status(catalog)).toBe("ready");
        expect(JSON.parse(await readFile(join(directory, MARKER_FILE), "utf8"))).toMatchObject({schema: 1, runtime: "bun", bun: Bun.version});
        const plan = await installer.plan("user.epub-export");
        expect(plan.ok && plan.plan.lock).toBe(true);
        const run = Bun.spawnSync([process.execPath, "run.js"], {cwd: directory});
        expect(run.stdout.toString().trim()).toBe("42");

        await rm(join(directory, "node_modules"), {recursive: true});
        await catalog.refresh("user.epub-export");
        expect(status(catalog)).toBe("needs-init");
        expect(await installer.init("user.epub-export")).toEqual({ok: true});
        expect(status(catalog)).toBe("ready");
    }, 60_000);

    test("同一个进程里同时请求两次，并入同一次；装不上时写下原因、回到未初始化", async () => {
        const {directory, catalog, installer} = await scene();
        await writeFile(join(directory, "package.json"), JSON.stringify({name: "epub-export", private: true, dependencies: {"not-here": "file:./missing-dir"}}));
        await catalog.refresh("user.epub-export");
        const first = installer.init("user.epub-export", {resolve: true});
        const second = installer.init("user.epub-export", {resolve: true});
        expect(second).toBe(first);
        const result = await first;
        expect(result).toMatchObject({ok: false, code: "install-failed"});
        expect(catalog.item("user.epub-export")?.entry).toMatchObject({status: "needs-init", problem: {code: "install-failed"}});
    }, 60_000);

    test("场景 5：别的进程拿着锁时得 busy、状态是正在初始化；那个进程被杀之后再初始化能成功", async () => {
        const {catalog, installer, locksRoot} = await scene();
        await mkdir(locksRoot, {recursive: true});
        // 子进程从本目录起，经包名找到同一个锁模块。
        const holder = Bun.spawn([process.execPath, "-e", `const {tryLock} = await import("@notnotype/nb-harness/file-lock"); const lock = tryLock(${JSON.stringify(join(locksRoot, "user.epub-export.lock"))}); console.log(lock === null ? "missed" : "held"); await new Promise(() => {});`], {cwd: import.meta.dir, stdout: "pipe", stdin: "ignore"});
        cleanups.push(() => void holder.kill("SIGKILL"));
        const reader = holder.stdout.getReader();
        const line = new TextDecoder().decode((await reader.read()).value);
        expect(line.trim()).toBe("held");
        await catalog.refresh("user.epub-export");
        expect(status(catalog)).toBe("initializing");
        expect(await installer.init("user.epub-export", {resolve: true})).toEqual({ok: false, code: "busy"});

        holder.kill("SIGKILL");
        await holder.exited;
        await catalog.refresh("user.epub-export");
        await waitUntil("锁放掉后回到未初始化", () => status(catalog) === "needs-init" || undefined);
        expect(await installer.init("user.epub-export", {resolve: true})).toEqual({ok: true});
    }, 60_000);

    test("内置的、没有 package.json 的不能初始化；没有这个 id 得 skill-not-found", async () => {
        const {directory, catalog, installer} = await scene();
        await rm(join(directory, "package.json"));
        await catalog.refresh("user.epub-export");
        expect(await installer.init("user.epub-export")).toEqual({ok: false, code: "not-initializable"});
        expect(await installer.plan("user.nothing")).toEqual({ok: false, code: "skill-not-found"});
    });
});
