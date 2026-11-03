/**
 * 暂存目录与暂存文件的寿命（docs/specs/workspace/resources.md 的“副作用与数据”）：真实临时目录与 proper-lockfile。
 * “另一个实例正在写”用另一份活性锁模拟：同一进程里的两次 `holdLock` 与两个进程一样互斥（锁是目录）。提交本身经写入接口
 * 在真实项目子进程上测（`workspace-files.test.ts`）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createStage, ensureStagingDirectory, sweepStaging} from "./backend/staging";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "staging");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const report = (): void => undefined;

async function fresh(): Promise<string> {
    const dir = join(tmp, randomUUID());
    await mkdir(dir);
    return dir;
}

describe("暂存目录", () => {
    it("按段建好；已有的照用", async () => {
        const root = await fresh();
        await mkdir(join(root, ".nbook"));
        const made = await ensureStagingDirectory(root, [".nbook", "staging"]);
        expect(made).toEqual({ok: true, path: join(root, ".nbook", "staging")});
        expect(await ensureStagingDirectory(root, [".nbook", "staging"])).toEqual(made);
    });

    it("某一段是链接：失败，不跟到链接目标里去建", async () => {
        const root = await fresh();
        const outside = await fresh();
        await symlink(outside, join(root, ".nbook"));
        const made = await ensureStagingDirectory(root, [".nbook", "staging"]);
        expect(made.ok).toBe(false);
        expect(await readdir(outside)).toEqual([]);
    });
});

describe("清理", () => {
    it("写入方还持着活性锁的不删，写入方已不在的删掉，别的文件不碰", async () => {
        const directory = await fresh();
        const live = await createStage(directory, report);
        if (!live.ok) throw new Error(live.detail);
        const orphan = join(directory, `${randomUUID()}.stage`);
        await writeFile(orphan, "残留");
        await writeFile(join(directory, "别的.txt"), "不是暂存");

        await sweepStaging(directory, report);
        expect(existsSync(live.stage.path)).toBe(true);
        expect(existsSync(orphan)).toBe(false);
        expect(existsSync(join(directory, "别的.txt"))).toBe(true);

        await live.stage.release();
        await sweepStaging(directory, report);
        expect(existsSync(live.stage.path)).toBe(false);
        expect((await readdir(directory)).sort()).toEqual(["别的.txt"]);
    });

    it("discard 删掉暂存并放锁", async () => {
        const directory = await fresh();
        const created = await createStage(directory, report);
        if (!created.ok) throw new Error(created.detail);
        await created.stage.discard();
        expect(await readdir(directory)).toEqual([]);
    });
});
