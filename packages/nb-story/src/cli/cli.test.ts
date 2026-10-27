/**
 * `nbstory` 命令行（docs/specs/story/cli-skill.md 输出 1 到 3、6、7，F1、F2，验收 1、2）。子进程跑真实命令。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {StoryMethod} from "../contract/contract";
import {openTestBook, type TestBook} from "../../testing/api";
import {runCli} from "../../testing/processes";

let book: TestBook;

beforeAll(async () => {
    book = await openTestBook("cli");
});

afterAll(async () => {
    await book.close();
});

/** 每条查询命令：命令行参数，以及对应方法与解码后应得的参数。 */
const CASES: {args: string[]; method: StoryMethod; params: Record<string, unknown>}[] = [
    {args: ["books"], method: "books.list", params: {}},
    {args: ["info", "--at", "7"], method: "book.info", params: {at: {chapter: 7}}},
    {args: ["stats", "--at", "38.57"], method: "book.stats", params: {at: {chapter: 38, paragraph: 57}}},
    {args: ["chapter", "37", "--at", "38"], method: "chapter.digest", params: {chapter: 37, at: {chapter: 38}}},
    {args: ["find", "狐", "--kind", "person", "--at", "38", "--limit", "5"], method: "entities.list", params: {query: "狐", kind: "person", at: {chapter: 38}, limit: 5}},
    {args: ["card", "e6-2", "--at", "38", "--perspective", "e8-2"], method: "entity.card", params: {entity: "e6-2", at: {chapter: 38}, perspective: "e8-2"}},
    {args: ["knowledge", "e1-1", "--state", "unaware", "--query", "南", "--at", "100"], method: "entity.knowledge", params: {entity: "e1-1", state: "unaware", query: "南", at: {chapter: 100}}},
    {args: ["statements", "e8-2", "--at", "38"], method: "entity.statements", params: {entity: "e8-2", at: {chapter: 38}}},
    {args: ["appearances", "苏天晴", "--query", "风信子", "--at", "38"], method: "entity.episodes", params: {entity: "苏天晴", query: "风信子", at: {chapter: 38}}},
    {args: ["ties", "苏天晴", "--at", "50"], method: "entity.relations", params: {entity: "苏天晴", at: {chapter: 50}}},
    {args: ["between", "苏天晴", "e47-5", "--at", "50"], method: "entity.relation", params: {entity: "苏天晴", other: "e47-5", at: {chapter: 50}}},
    {args: ["knows", "--at", "38"], method: "secrets.matrix", params: {at: {chapter: 38}}},
    {args: ["relations", "--perspective", "e1-1", "--kinds", "person,persona", "--min-together", "2", "--at", "38"], method: "graph.relations", params: {perspective: "e1-1", kinds: ["person", "persona"], minTogether: 2, at: {chapter: 38}}},
    {args: ["ledger", "--at", "38"], method: "ledger.tracks", params: {at: {chapter: 38}}},
    {args: ["track", "神典石", "--at", "38"], method: "ledger.track", params: {track: "神典石", at: {chapter: 38}}},
    {args: ["questions", "--state", "open", "--sort", "raised", "--at", "38"], method: "questions.list", params: {state: "open", sort: "raised", at: {chapter: 38}}},
    {args: ["timeline", "--order", "source", "--at", "38"], method: "timeline", params: {order: "source", at: {chapter: 38}}},
    {args: ["episodes", "--query", "风信子", "--at", "38"], method: "episodes.list", params: {query: "风信子", at: {chapter: 38}}},
    {args: ["arcs", "--at", "38"], method: "arcs.list", params: {at: {chapter: 38}}},
    {args: ["search", "神典石", "--kinds", "statement,source", "--at", "38.57"], method: "search", params: {query: "神典石", kinds: ["statement", "source"], at: {chapter: 38, paragraph: 57}}},
    {args: ["read", "38.48-60", "--at", "38.57"], method: "source.read", params: {from: {chapter: 38, paragraph: 48}, to: {chapter: 38, paragraph: 60}, at: {chapter: 38, paragraph: 57}}},
    {args: ["read", "37", "--at", "38"], method: "source.read", params: {from: {chapter: 37}, at: {chapter: 38}}},
    {args: ["para", "38.36", "--at", "38"], method: "source.records", params: {chapter: 38, paragraph: 36, at: {chapter: 38}}},
];

describe("命令与方法一致（输出 1、验收 1）", () => {
    test.each(CASES)("$args.0：--json 的 data 与进程内调用的结果逐字段相同", async ({args, method, params}) => {
        const run = await runCli([...args, "--library", book.library, "--json"]);
        expect(run.code).toBe(0);
        const local = await book.api.call(method, params);
        expect(local.ok).toBe(true);
        expect(JSON.parse(run.stdout)).toEqual({ok: true, data: local.ok ? local.value : null});
    });

    test("给人读的输出出处写成“章.段”", async () => {
        const run = await runCli(["track", "神典石", "--at", "38", "--library", book.library]);
        expect(run.code).toBe(0);
        expect(run.stdout).toContain("〔38.36〕");
        expect(run.stdout).toContain("原文比累加多 800");
    });
});

describe("退出码与失败（输出 2、7，F1、F2）", () => {
    test("查询失败退出码 1；--json 时标准输出只有一个带错误码的 JSON", async () => {
        const run = await runCli(["card", "心月狐", "--at", "7", "--library", book.library, "--json"]);
        expect(run.code).toBe(1);
        expect(JSON.parse(run.stdout)).toEqual({ok: false, error: expect.objectContaining({code: "entity_not_found"})});
        const human = await runCli(["card", "心月狐", "--at", "7", "--library", book.library]);
        expect(human.code).toBe(1);
        expect(human.stderr).toContain("entity_not_found");
        expect(human.stderr).toContain("下一步");
    });

    test("未知命令、未知选项、缺参数、写法不对的位置都是用法错误，退出码 2 并打印用法", async () => {
        for (const args of [["nope"], ["card", "e1-1", "--nope", "1"], ["card"], ["card", "e1-1", "--at", "abc"], ["read", "38.x"], ["read", "38.1-2-999"], []]) {
            const run = await runCli([...args, "--library", book.library]);
            expect(run.code).toBe(2);
            expect(`${run.stdout}${run.stderr}`).toContain("用法：nbstory");
        }
    });

    test("--help 退出码 0：不带命令列出全部命令，带命令只列这条命令的用法与选项", async () => {
        const all = await runCli(["--help"]);
        expect(all.code).toBe(0);
        expect(all.stdout).toContain("用法：nbstory");
        expect(all.stdout).toContain("card");
        const one = await runCli(["relations", "--help"]);
        expect(one.code).toBe(0);
        expect(one.stdout).toContain("用法：nbstory relations");
        expect(one.stdout).toContain("--min-together");
        expect(one.stdout).not.toContain("人物卡");
    });

    test("--version 输出版本，不再落到“没有命令”", async () => {
        const run = await runCli(["--version"]);
        expect(run.code).toBe(0);
        expect(run.stdout.trim()).toMatch(/^nbstory \d+\.\d+\.\d+/u);
        expect(run.stderr).toBe("");
    });

    test("config 动作的 --help 给这个动作自己的选项", async () => {
        const init = await runCli(["config", "init", "--help"]);
        expect(init.code).toBe(0);
        expect(init.stdout).toContain("--base-url");
        expect(init.stdout).toContain("--force");
        const set = await runCli(["config", "set", "--help"]);
        expect(set.code).toBe(0);
        expect(set.stdout).toContain("--max-tokens");
        expect(set.stdout).toContain("ingest.model");
    });

    test("选项写在命令前后、写成 --名=值都一样；开关带等号也算打开", async () => {
        const trailing = await runCli(["card", "e1-1", "--at", "38", "--library", book.library, "--json"]);
        expect(trailing.code).toBe(0);
        const variants = [
            ["--library", book.library, "--json", "card", "e1-1", "--at=38"],
            ["--at", "38", "--library", book.library, "card", "e1-1", "--json=true"],
            ["--at=38", "--json", "card", "--library", book.library, "e1-1"],
        ];
        for (const result of await Promise.all(variants.map(args => runCli(args)))) expect(result.stdout).toBe(trailing.stdout);
    });

    test("名字对应几个对象时列出候选", async () => {
        const run = await runCli(["card", "小破书", "--at", "38", "--library", book.library]);
        expect(run.code).toBe(1);
        expect(run.stderr).toContain("e1-1");
        expect(run.stderr).toContain("e1-2");
    });
});

describe("不剧透（验收 2）", () => {
    test("card 苏天晴 --at 7 里没有 8.48 才出现的“心月狐”；knows --at 7 里没有第 8 章及以后揭晓的秘密", async () => {
        const card = await runCli(["card", "苏天晴", "--at", "7", "--library", book.library]);
        expect(card.code).toBe(0);
        expect(card.stdout).not.toContain("心月狐");
        const knows = await runCli(["knows", "--at", "7", "--library", book.library, "--json"]);
        const rows = (JSON.parse(knows.stdout) as {data: {rows: {id: string}[]}}).data.rows.map(row => row.id);
        expect(rows.every(id => ["x4-1", "x6-1", "x21-1"].includes(id))).toBe(true);
    });

    test("read 39.1 --at 38.57 退出码 1，错误码 beyond_position", async () => {
        const run = await runCli(["read", "39.1", "--at", "38.57", "--library", book.library, "--json"]);
        expect(run.code).toBe(1);
        expect((JSON.parse(run.stdout) as {error: {code: string}}).error.code).toBe("beyond_position");
    });
});

describe("导入（输出 6）", () => {
    test("成功时输出新书的 id；失败时书库不变", async () => {
        const isolated = await openTestBook("cli-import");
        try {
            const ok = await runCli(["import", join(isolated.root, "sample-100ch.json"), "--title", "Fox Two", "--library", isolated.library]);
            expect(ok.code).toBe(0);
            expect(ok.stdout).toContain("fox-two");
            const bad = join(isolated.root, "bad.json");
            await writeFile(bad, "{}");
            const before = (await readdir(isolated.library)).sort();
            const failed = await runCli(["import", bad, "--title", "Bad", "--library", isolated.library, "--json"]);
            expect(failed.code).toBe(1);
            expect((JSON.parse(failed.stdout) as {error: {code: string}}).error.code).toBe("unsupported_format");
            expect((await readdir(isolated.library)).sort()).toEqual(before);
        } finally {
            await isolated.close();
        }
    });
});
