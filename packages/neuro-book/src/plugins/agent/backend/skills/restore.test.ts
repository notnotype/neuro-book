/**
 * 压缩之后放回 Skill（docs/specs/agent/skills.md 输出 16、17 与场景 6）：真实的 Skill 目录与文件；放回参数按内核的合同给出
 * （`path` 是压缩前的路径，`kept` 说哪些事件仍在上下文里）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {CompactionRestoreArgs, CompactionRestored, LogEvent} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {SkillCatalog} from "./catalog";
import {SKILLS_EXTENSION} from "./extension";
import {RESTORE_SKILL_TOKENS, restoreSkills} from "./restore";

let tmp = "";
let counter = 0;
const opened: SkillCatalog[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-agent", "skills-restore");
});
afterEach(async () => {
    for (const catalog of opened.splice(0)) await catalog.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function catalogWith(bodies: Readonly<Record<string, string>>) {
    counter += 1;
    const root = join(tmp, `c${String(counter)}`);
    for (const [name, body] of Object.entries(bodies)) {
        await mkdir(join(root, name), {recursive: true});
        await writeFile(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: 说明\n---\n\n${body}\n`);
    }
    const catalog = await SkillCatalog.open({roots: [{source: "user", root, watch: false}], clock: systemClock, report: () => undefined});
    opened.push(catalog);
    return {root, catalog};
}

let seq = 0;
const skillEvent = (name: string, body?: string): LogEvent => {
    seq += 1;
    return {id: `e${String(seq)}`, seq, at: 0, parent: null, scope: "path", kind: "conv", type: `${SKILLS_EXTENSION}/skill`, version: 1, data: {id: `user.${name}`, name, location: `skills://user.${name}/SKILL.md`, ...(body === undefined ? {sameAs: true} : {body, truncated: false})}} as unknown as LogEvent;
};

const args = (path: readonly LogEvent[], options: {readonly kept?: ReadonlySet<string>; readonly contextWindow?: number; readonly replacement?: string | null} = {}): CompactionRestoreArgs => ({
    signal: new AbortController().signal,
    method: "summary",
    replacement: options.replacement === undefined ? "摘要" : options.replacement,
    path,
    contextWindow: options.contextWindow ?? 200_000,
    kept: (id) => options.kept?.has(id) ?? false,
});

const reports: string[] = [];
const options = (catalog: SkillCatalog) => ({catalog, report: (code: string) => void reports.push(code)});
const filesRestored: CompactionRestored = {notices: ["最近的文件"], restored: [{kind: "file", target: "home://a.md", tokens: 1_000, truncated: false}]};

describe("压缩之后放回 Skill", () => {
    test("场景 6：用过两个 Skill，放回它们现在的正文，最近的在前、按 id 去重；接在文件之后；仍在上下文里的不放第二份", async () => {
        const {root, catalog} = await catalogWith({"style-guide": "文风第二版", "lore-check": "设定核对", "outline": "提纲"});
        const path = [skillEvent("style-guide", "文风第一版"), skillEvent("lore-check", "设定核对"), skillEvent("style-guide"), skillEvent("outline", "提纲")];
        await writeFile(join(root, "style-guide", "SKILL.md"), "---\nname: style-guide\ndescription: 说明\n---\n\n文风第二版\n");
        const result = await restoreSkills(options(catalog), args(path, {kept: new Set([path[3]!.id])}), filesRestored);
        expect(result.notices[0]).toBe("最近的文件");
        expect(result.notices.slice(1).map((text) => /<skill id="([^"]+)"/u.exec(text)?.[1])).toEqual(["user.style-guide", "user.lore-check"]);
        expect(result.notices[1]).toContain("文风第二版");
        expect((result.restored as ReadonlyArray<{kind: string; target: string}>).map((item) => `${item.kind}:${item.target}`)).toEqual(["file:home://a.md", "skill:user.style-guide", "skill:user.lore-check"]);
    });

    test("每个至多 5,000 token；64k 窗口时放回合计不超过窗口的 25%（文件先占）；没有换掉对话时不放", async () => {
        const long = Array.from({length: 4_000}, (_, index) => `第 ${String(index)} 行，规则说明。`).join("\n");
        const {catalog} = await catalogWith({"big-a": long, "big-b": long, "big-c": long});
        const path = [skillEvent("big-a", "x"), skillEvent("big-b", "x"), skillEvent("big-c", "x")];
        const wide = await restoreSkills(options(catalog), args(path), {notices: []});
        for (const item of wide.restored as ReadonlyArray<{tokens: number; truncated: boolean}>) {
            expect(item.truncated).toBe(true);
            expect(item.tokens).toBeLessThanOrEqual(RESTORE_SKILL_TOKENS + 200);
        }
        const narrow = await restoreSkills(options(catalog), args(path, {contextWindow: 64_000}), filesRestored);
        const total = (narrow.restored as ReadonlyArray<{tokens: number}>).reduce((sum, item) => sum + item.tokens, 0);
        expect(total).toBeLessThanOrEqual(64_000 * 0.25 + 200);
        expect(await restoreSkills(options(catalog), args(path, {replacement: null}), filesRestored)).toBe(filesRestored);
    });

    test("输出 17：一个 Skill 已不在或读不到，跳过它并写 restore-skipped，别的照常放回", async () => {
        const {root, catalog} = await catalogWith({"kept-one": "还在", "gone": "要删的"});
        await rm(join(root, "gone", "SKILL.md"));
        reports.length = 0;
        const result = await restoreSkills(options(catalog), args([skillEvent("kept-one", "还在"), skillEvent("gone", "要删的"), skillEvent("never-there", "无")]), {notices: []});
        expect((result.restored as ReadonlyArray<{target: string}>).map((item) => item.target)).toEqual(["user.kept-one"]);
        expect(reports).toEqual(["restore-skipped", "restore-skipped"]);
    });
});
