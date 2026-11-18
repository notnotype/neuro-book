/**
 * Playwright 输出目录按检出分开（docs/testing/README.md 的“验证门禁”）：检出根的判定、检出名与最终路径。函数在
 * `neuro-book-test-support`（两个包的 Playwright 配置共用），测试放在用它的配置旁边：那个包的类型检查没有 bun 的类型。
 */

import {afterEach, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, sep} from "node:path";

import {checkoutKey, findCheckoutRoot, resolveAgentPlaywrightRoot} from "@notnotype/neuro-book-test-support/paths";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const roots: string[] = [];
afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
});

async function tmp(): Promise<string> {
    const root = await createTestTmpRoot("paths-playwright", "paths.test");
    roots.push(root);
    return root;
}

describe("findCheckoutRoot", () => {
    it("主工作区的 .git 是目录，worktree 的 .git 是文件：都从深处的包目录找回检出根", async () => {
        const root = await tmp();
        await mkdir(join(root, "main", ".git"), {recursive: true});
        await mkdir(join(root, "main", "packages", "neuro-book", "e2e"), {recursive: true});
        await mkdir(join(root, "main", ".worktree", "w1", "packages", "neuro-book", "e2e"), {recursive: true});
        await writeFile(join(root, "main", ".worktree", "w1", ".git"), "gitdir: ../../.git/worktrees/w1\n");
        expect(findCheckoutRoot(join(root, "main", "packages", "neuro-book", "e2e"))).toBe(join(root, "main"));
        // worktree 在主工作区的目录里：先遇到的是它自己的 .git 文件，不是外面的主工作区。
        expect(findCheckoutRoot(join(root, "main", ".worktree", "w1", "packages", "neuro-book", "e2e"))).toBe(join(root, "main", ".worktree", "w1"));
    });

    it("一路都没有 .git（例如导出的源码包）：用传入的目录自己", async () => {
        const root = await tmp();
        await mkdir(join(root, "export", "e2e"), {recursive: true});
        expect(findCheckoutRoot(join(root, "export", "e2e"))).toBe(join(root, "export", "e2e"));
    });
});

describe("checkoutKey", () => {
    it("同一个路径得到同一个名字；目录名相同、位置不同的两个检出得到不同的名字", () => {
        expect(checkoutKey("/work/a/neuro-book")).toBe(checkoutKey("/work/a/neuro-book"));
        expect(checkoutKey("/work/a/neuro-book")).not.toBe(checkoutKey("/work/b/neuro-book"));
        expect(checkoutKey("/work/a/neuro-book").startsWith("neuro-book-")).toBe(true);
    });

    it("目录名里不安全的字符换成短横线，名字不超过 33 个字符", () => {
        const key = checkoutKey("/work/a/一个 很长的 worktree 名字，带空格与中文，一直写到超过二十四个字符为止");
        expect(key).toMatch(/^[A-Za-z0-9._-]+$/u);
        expect(key.length).toBeLessThanOrEqual(33);
    });
});

describe("resolveAgentPlaywrightRoot", () => {
    it("在 Agent 临时根的 playwright/<套件>/ 下，一个检出一个目录：两个 worktree 的输出目录互不相同", async () => {
        const root = await tmp();
        await mkdir(join(root, "main", ".git"), {recursive: true});
        await mkdir(join(root, "main", "e2e"), {recursive: true});
        await mkdir(join(root, "main", ".worktree", "w1", "e2e"), {recursive: true});
        await writeFile(join(root, "main", ".worktree", "w1", ".git"), "gitdir: x\n");
        const env = {NBOOK_AGENT_TEMP_ROOT: join(root, "agent-temp")};
        const first = resolveAgentPlaywrightRoot("neuro-book", join(root, "main", "e2e"), env);
        const second = resolveAgentPlaywrightRoot("neuro-book", join(root, "main", ".worktree", "w1", "e2e"), env);
        expect(first.startsWith(join(root, "agent-temp", "playwright", "neuro-book") + sep)).toBe(true);
        expect(second.startsWith(join(root, "agent-temp", "playwright", "neuro-book") + sep)).toBe(true);
        expect(first).not.toBe(second);
        // 同一个检出里不同的包目录（neuro-book 与 nb-story 各一份配置）也各有各的套件目录。
        expect(resolveAgentPlaywrightRoot("nb-story", join(root, "main", "e2e"), env)).not.toBe(first);
    });

    it("套件名要是安全的单个路径段", () => {
        expect(() => resolveAgentPlaywrightRoot("../x", "/work/a")).toThrow();
    });
});
