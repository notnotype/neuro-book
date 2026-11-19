/**
 * 预设的文件核对与代次（docs/specs/bots/bots.md 输出 1 与“时序与寿命”）：真实文件，插件包按入口用的同一个查找（`entryInside`：逐段
 * `lstat`、不跟随链接）。贡献句柄只带接收方读的字段；平台的贡献点校验与插件包查询各有自己的测试（plugin-platform）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {lstat, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {ContributionHandle} from "@notnotype/nb-runtime/plugins";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {entryInside} from "nbook/plugin-platform/backend/plugin-files";

import {SEED_MAX_FILES} from "../shared/contracts";
import type {BotPresetDeclaration} from "../shared/contracts";
import {PresetTable} from "./presets";
import type {PresetLocator} from "./presets";

let tmp = "";
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-bots", "presets");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const DECLARATION: BotPresetDeclaration = {name: "测试", avatar: "a/avatar.png", profile: "test.profile", persona: "a/persona.md"};

/** 一个插件包：`files` 是相对包根的文件。交回包根。 */
async function pack(name: string, files: Readonly<Record<string, string>>): Promise<string> {
    const root = join(tmp, name);
    for (const [path, text] of Object.entries(files)) {
        await mkdir(join(root, path, ".."), {recursive: true});
        await writeFile(join(root, path), text);
    }
    return root;
}

/** `done` 数查完的调用：核对查完头像（最后一个文件）之后只剩读它的大小。 */
const locator = (roots: Readonly<Record<string, string>>, gate?: () => Promise<void>, done?: {count: number}): PresetLocator => async (plugin, path, kind) => {
    await gate?.();
    const root = roots[plugin];
    if (root === undefined) return null;
    const found = await entryInside(root, path.split("/"), kind);
    if (done !== undefined) done.count += 1;
    return typeof found === "object" && "path" in found ? found.path : null;
};

/** 等一次核对走完：两个文件都查过，再等它读完头像的大小、交回结果。 */
async function checkedTwice(done: {count: number}, avatar: string): Promise<void> {
    await waitUntil("两个文件都查过", () => done.count >= 2);
    await lstat(avatar);
    for (let round = 0; round < 3; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

const handle = (id: string, plugin: string, declaration: BotPresetDeclaration = DECLARATION) => ({id, plugin, declaration}) as unknown as ContributionHandle<BotPresetDeclaration>;

function table(locate: PresetLocator): {readonly presets: PresetTable; readonly reports: Array<Readonly<Record<string, unknown>>>} {
    const reports: Array<Readonly<Record<string, unknown>>> = [];
    return {presets: new PresetTable({locate, report: (_code, _message, data) => reports.push(data)}), reports};
}

describe("预设的文件核对", () => {
    test("输出 1：文件都在、都合规的可用；越出插件包（链接）、不在、太大、扩展名不对、记忆种子含链接或文件太多的不可用，各写一条诊断，别的预设不受影响", async () => {
        const outside = await pack("outside", {"secret.md": "包外的文件"});
        const good = await pack("good", {"a/persona.md": "人设", "a/avatar.png": "图", "seed/notes.md": "种子"});
        const linked = await pack("linked", {"a/avatar.png": "图"});
        await symlink(join(outside, "secret.md"), join(linked, "a", "persona.md"));
        const big = await pack("big", {"a/persona.md": "字".repeat(100_000), "a/avatar.png": "图"});
        const crowded = await pack("crowded", {"a/persona.md": "人设", "a/avatar.png": "图", ...Object.fromEntries(Array.from({length: SEED_MAX_FILES + 1}, (_, index) => [`seed/${String(index)}.md`, "x"]))});
        const {presets, reports} = table(locator({good, linked, big, crowded}));
        const cases: Array<[string, string, BotPresetDeclaration]> = [
            ["good.ok", "good", {...DECLARATION, memorySeed: "seed"}],
            ["linked.bad", "linked", DECLARATION],
            ["good.missing", "good", {...DECLARATION, persona: "a/nope.md"}],
            ["big.bad", "big", DECLARATION],
            ["good.extension", "good", {...DECLARATION, avatar: "a/persona.md"}],
            ["crowded.bad", "crowded", {...DECLARATION, memorySeed: "seed"}],
            ["nobody.bad", "nobody", DECLARATION],
        ];
        for (const [id, plugin, declaration] of cases) presets.receiver.published!(handle(id, plugin, declaration), undefined);
        const settled = await Promise.all(cases.map(([id]) => presets.settled(id)));
        expect(settled.map((preset) => preset?.id ?? null)).toEqual(["good.ok", null, null, null, null, null, null]);
        expect(presets.get("good.ok")).toMatchObject({persona: join(good, "a", "persona.md"), avatar: join(good, "a", "avatar.png"), memorySeed: join(good, "seed")});
        expect(reports.map((report) => report.preset).sort()).toEqual(cases.slice(1).map(([id]) => id).sort());
    });

    test("时序与寿命：撤回之后才查完的结果作废，不复活；同一个 id 再发布时旧结果不盖掉新的", async () => {
        const good = await pack("generations", {"a/persona.md": "人设", "a/avatar.png": "图"});
        let release!: () => void;
        let blocked = true;
        const gate = () => (blocked ? new Promise<void>((resolve) => {
            release = resolve;
        }) : Promise.resolve());
        const done = {count: 0};
        const {presets} = table(locator({generations: good}, gate, done));
        presets.receiver.published!(handle("p.one", "generations"), undefined);
        presets.receiver.revoke!(handle("p.one", "generations"), undefined, "revoked" as never);
        blocked = false;
        release();
        expect(await presets.settled("p.one")).toBeNull();
        await checkedTwice(done, join(good, "a", "avatar.png"));
        expect(presets.get("p.one")).toBeUndefined();

        blocked = true;
        presets.receiver.published!(handle("p.two", "generations", {...DECLARATION, name: "旧的"}), undefined);
        const releaseOld = release;
        blocked = false;
        presets.receiver.published!(handle("p.two", "generations", {...DECLARATION, name: "新的"}), undefined);
        expect((await presets.settled("p.two"))?.declaration.name).toBe("新的");
        releaseOld();
        await new Promise((resolve) => setImmediate(resolve));
        expect(presets.get("p.two")?.declaration.name).toBe("新的");
    });
});
