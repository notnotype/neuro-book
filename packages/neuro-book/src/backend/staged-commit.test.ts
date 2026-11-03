/**
 * 暂存文件的提交（`commitStaged`，docs/specs/workspace/resources.md 的“暂存与提交”）：真实临时目录与 proper-lockfile。
 * “并发”用 `decide` 第一次被调用时改动目标来制造：它恰好落在读目标之后、放到位之前，是提交要防的那个窗口。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {createHash, randomUUID} from "node:crypto";
import {existsSync, statSync, writeFileSync} from "node:fs";
import {chmod, mkdir, readdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {holdLock} from "./locked-replace";
import {commitStaged} from "./staged-commit";
import type {StagedCommitOptions, StagedCurrent} from "./staged-commit";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-backend", "staged-commit");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const hash = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** 一个用例的目录：目标、暂存与锁各在里面。 */
async function place(staged: string = "新内容"): Promise<{readonly dir: string; readonly file: string; readonly stage: string; readonly lockPath: string}> {
    const dir = join(tmp, randomUUID());
    await mkdir(join(dir, "staging"), {recursive: true});
    const stage = join(dir, "staging", `${randomUUID()}.stage`);
    await writeFile(stage, staged, {mode: 0o600});
    return {dir, file: join(dir, "目标.md"), stage, lockPath: join(dir, "target.lock")};
}

function options(stage: string, lockPath: string, overrides: Partial<StagedCommitOptions<string>> = {}): StagedCommitOptions<string> {
    return {
        lockPath,
        staged: stage,
        decide: () => ({proceed: true}),
        keepBytes: 1024,
        temporaryPath: (file) => `${file}.${randomUUID()}.tmp`,
        committed: async () => undefined,
        report: () => undefined,
        ...overrides,
    };
}

describe("commitStaged", () => {
    it("新建：内容就是暂存的，暂存被消费，权限位与普通新建文件相同", async () => {
        const {file, stage, lockPath} = await place("第一章");
        const result = await commitStaged(file, options(stage, lockPath, {decide: (current) => (current === null ? {proceed: true} : {done: "conflict"})}));
        expect(result).toMatchObject({ok: true, before: null});
        expect(await readFile(file, "utf8")).toBe("第一章");
        expect(existsSync(stage)).toBe(false);
        expect((await stat(file)).mode & 0o777).toBe(0o666 & ~process.umask());
    });

    it("覆盖：旧内容的哈希与字节交给 decide，权限位沿用原文件", async () => {
        const {file, stage, lockPath} = await place("新的");
        await writeFile(file, "旧的");
        await chmod(file, 0o640);
        const seen: StagedCurrent[] = [];
        const result = await commitStaged(file, options(stage, lockPath, {decide: (current) => {
            seen.push(current);
            return {proceed: true};
        }}));
        expect(result.ok).toBe(true);
        expect(seen[0]).toMatchObject({hash: hash("旧的"), bytes: new TextEncoder().encode("旧的")});
        expect(await readFile(file, "utf8")).toBe("新的");
        expect((await stat(file)).mode & 0o777).toBe(0o640);
    });

    it("decide 以 done 结束：目标不动，暂存留给写入方", async () => {
        const {file, stage, lockPath} = await place();
        await writeFile(file, "旧的");
        const result = await commitStaged(file, options(stage, lockPath, {decide: () => ({done: "conflict"})}));
        expect(result).toEqual({ok: true, done: "conflict"});
        expect(await readFile(file, "utf8")).toBe("旧的");
        expect(existsSync(stage)).toBe(true);
    });

    it("要求不存在、但读目标之后被别人建了：不覆盖，重做后按现状得到冲突", async () => {
        const {file, stage, lockPath} = await place();
        const result = await commitStaged(file, options(stage, lockPath, {decide: (current) => {
            if (current !== null) return {done: "conflict"};
            writeFileSync(file, "别人刚建的");
            return {proceed: true};
        }}));
        expect(result).toEqual({ok: true, done: "conflict"});
        expect(await readFile(file, "utf8")).toBe("别人刚建的");
        expect(existsSync(stage)).toBe(true);
    });

    it("读目标之后目标被改了一次：从新内容重做，暂存没丢", async () => {
        const {file, stage, lockPath} = await place("我的");
        await writeFile(file, "第一版");
        const hashes: string[] = [];
        const result = await commitStaged(file, options(stage, lockPath, {decide: (current) => {
            hashes.push(current?.hash ?? "");
            if (hashes.length === 1) writeFileSync(file, "第二版，长度不同");
            return {proceed: true};
        }}));
        expect(result.ok).toBe(true);
        expect(hashes).toEqual([hash("第一版"), hash("第二版，长度不同")]);
        expect(await readFile(file, "utf8")).toBe("我的");
    });

    it("旧内容超过 keepBytes：只给哈希，不留字节", async () => {
        const {file, stage, lockPath} = await place();
        const big = "字".repeat(1000);
        await writeFile(file, big);
        const seen: StagedCurrent[] = [];
        await commitStaged(file, options(stage, lockPath, {keepBytes: 100, decide: (current) => {
            seen.push(current);
            return {proceed: true};
        }}));
        expect(seen[0]).toMatchObject({hash: hash(big), bytes: null});
    });

    it("committed 在锁里调用，拿到的是放到位之后的状态；它出错不撤回落盘", async () => {
        const {file, stage, lockPath} = await place("内容");
        const reports: string[] = [];
        let lockedDuring = false as boolean;
        let inode = -1;
        const result = await commitStaged(file, options(stage, lockPath, {
            report: (event) => reports.push(event),
            committed: async (after) => {
                inode = after.ino;
                const other = await holdLock(lockPath, () => undefined, {wait: false});
                lockedDuring = !other.ok;
                if (other.ok) await other.lock.release();
                throw new Error("记账失败");
            },
        }));
        expect(result.ok).toBe(true);
        expect(lockedDuring).toBe(true);
        expect(inode).toBe(statSync(file).ino);
        expect(reports).toContain("committed.failed");
        expect(await readFile(file, "utf8")).toBe("内容");
    });

    // 暂存与目标在两个文件系统上：/dev/shm 是 tmpfs，测试临时根通常不是。
    const shm = existsSync("/dev/shm") ? statSync("/dev/shm").dev : null;
    it.if(shm !== null && shm !== statSync(join(import.meta.dir)).dev)("跨文件系统：拷进目标目录再放到位，暂存与临时文件都不留", async () => {
        const {dir, file, lockPath} = await place();
        const stage = join("/dev/shm", `nbook-test-${randomUUID()}.stage`);
        await writeFile(stage, "跨盘的内容", {mode: 0o600});
        await writeFile(file, "旧的");
        try {
            const result = await commitStaged(file, options(stage, lockPath, {temporaryPath: (target) => `${target}.${randomUUID()}.tmp`}));
            expect(result.ok).toBe(true);
            expect(await readFile(file, "utf8")).toBe("跨盘的内容");
            expect(existsSync(stage)).toBe(false);
            expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
        } finally {
            await rm(stage, {force: true});
        }
    });

    it.if(shm !== null && shm !== statSync(join(import.meta.dir)).dev)("跨文件系统新建：拷进目标目录再链接到位，不覆盖、不留临时文件", async () => {
        const {dir, file, lockPath} = await place();
        const stage = join("/dev/shm", `nbook-test-${randomUUID()}.stage`);
        await writeFile(stage, "新的", {mode: 0o600});
        try {
            const result = await commitStaged(file, options(stage, lockPath, {decide: (current) => (current === null ? {proceed: true} : {done: "conflict"})}));
            expect(result).toMatchObject({ok: true, before: null});
            expect(await readFile(file, "utf8")).toBe("新的");
            expect(existsSync(stage)).toBe(false);
            expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
        } finally {
            await rm(stage, {force: true});
        }
    });
});
