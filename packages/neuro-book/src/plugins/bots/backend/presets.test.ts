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

import {Value} from "typebox/value";

import {AVATAR_MAX_BYTES, PresetDeclarationSchema, presetsPoint, SEED_MAX_BYTES, SEED_MAX_FILES} from "../shared/contracts";
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
        const heavy = await pack("heavy", {"a/persona.md": "人设", "a/avatar.png": "图".repeat(Math.ceil(AVATAR_MAX_BYTES / 3) + 1)});
        const seedHeavy = await pack("seedheavy", {"a/persona.md": "人设", "a/avatar.png": "图", "seed/a.md": "x".repeat(SEED_MAX_BYTES / 2), "seed/b.md": "x".repeat(SEED_MAX_BYTES / 2 + 1)});
        const seedLink = await pack("seedlink", {"a/persona.md": "人设", "a/avatar.png": "图", "seed/ok.md": "x"});
        await symlink(join(outside, "secret.md"), join(seedLink, "seed", "linked.md"));
        const {presets, reports} = table(locator({good, linked, big, crowded, heavy, seedheavy: seedHeavy, seedlink: seedLink}));
        const cases: Array<[string, string, BotPresetDeclaration]> = [
            ["good.ok", "good", {...DECLARATION, memorySeed: "seed"}],
            ["linked.bad", "linked", DECLARATION],
            ["good.missing", "good", {...DECLARATION, persona: "a/nope.md"}],
            ["big.bad", "big", DECLARATION],
            ["good.extension", "good", {...DECLARATION, avatar: "a/persona.md"}],
            ["crowded.bad", "crowded", {...DECLARATION, memorySeed: "seed"}],
            ["heavy.avatar", "heavy", DECLARATION],
            ["seedheavy.bad", "seedheavy", {...DECLARATION, memorySeed: "seed"}],
            ["seedlink.bad", "seedlink", {...DECLARATION, memorySeed: "seed"}],
            ["nobody.bad", "nobody", DECLARATION],
        ];
        for (const [id, plugin, declaration] of cases) presets.receiver.published!(handle(id, plugin, declaration), undefined);
        const settled = await Promise.all(cases.map(([id]) => presets.settled(id)));
        expect(settled.map((preset) => preset?.id ?? null)).toEqual(["good.ok", ...cases.slice(1).map(() => null)]);
        expect(presets.get("good.ok")).toMatchObject({persona: join(good, "a", "persona.md"), avatar: join(good, "a", "avatar.png"), memorySeed: join(good, "seed")});
        // 每个不可用的各有一条诊断，原因说的是它自己那处毛病。
        const reasons = new Map(reports.map((report) => [report.preset as string, report.reason as string]));
        expect([...reasons.keys()].sort()).toEqual(cases.slice(1).map(([id]) => id).sort());
        expect(Object.fromEntries([...reasons].map(([id, reason]) => [id, reason.split("：")[0]]))).toEqual({
            "linked.bad": "a/persona.md 不是插件包里的普通文件",
            "good.missing": "a/nope.md 不是插件包里的普通文件",
            "big.bad": expect.stringContaining("a/persona.md 有"),
            "good.extension": "头像要是 png、jpg、jpeg、webp 图片",
            "crowded.bad": "记忆种子 seed",
            "heavy.avatar": expect.stringContaining("a/avatar.png 有"),
            "seedheavy.bad": "记忆种子 seed",
            "seedlink.bad": "记忆种子 seed",
            "nobody.bad": "a/persona.md 不是插件包里的普通文件",
        });
        expect([reasons.get("crowded.bad"), reasons.get("seedheavy.bad"), reasons.get("seedlink.bad")]).toEqual([expect.stringContaining("多于"), expect.stringContaining("合计超过"), expect.stringContaining("linked.md 不是普通文件或目录")]);
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

    test("输出 1、输入与前置条件：声明的结构与路径规则由贡献点交给平台校验：名字单行 1–40 个字符，路径是插件包里 / 分段的相对路径", () => {
        const accepted = (declaration: Record<string, unknown>): boolean => Value.Check(PresetDeclarationSchema, declaration) && presetsPoint.validate!({declaration} as never) === null;
        expect(accepted({...DECLARATION})).toBe(true);
        expect(accepted({...DECLARATION, memorySeed: "seed/notes"})).toBe(true);
        for (const name of ["", "两行\n名字", "字".repeat(41)]) expect([name, accepted({...DECLARATION, name})]).toEqual([name, false]);
        for (const path of ["../a.md", "/a.md", "a//b.md", "C:a.md", "a\\b.md", "./a.md"]) {
            expect([path, accepted({...DECLARATION, persona: path})]).toEqual([path, false]);
            expect([path, accepted({...DECLARATION, memorySeed: path})]).toEqual([path, false]);
        }
        expect(accepted({...DECLARATION, extra: true})).toBe(false);
    });
});
