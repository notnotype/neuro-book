import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    BashOutputReclaimedError,
    BashOutputStore,
    type BashOutputPolicy,
    type BashOutputReservation,
} from "nbook/server/agent/tools/bash-output-store";
import {OutputAccumulator} from "nbook/server/agent/tools/output-accumulator";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe("BashOutputStore", () => {
    it("使用逻辑locator读取owner lease且不暴露物理Cache Root", async () => {
        const root = await temporaryRoot();
        const store = new BashOutputStore(absoluteFsPath(root), policy());
        const reservation = await requiredReservation(store);
        await fs.writeFile(reservation.physicalPath, "retained output", "utf8");
        await reservation.complete(15, false);

        expect(reservation.reference.locator).toMatch(/^bash-output:\/\//u);
        expect(reservation.reference.locator).not.toContain(root);
        expect((await store.read(reservation.reference.locator)).toString("utf8")).toBe("retained output");

        const marker = JSON.parse(await fs.readFile(path.join(path.dirname(reservation.physicalPath), ".owner.json"), "utf8")) as {owner: string; state: string};
        expect(marker).toMatchObject({owner: "neuro-book.agent-bash-output", state: "complete"});
    });

    it("按文件数回收最旧完成项", async () => {
        const root = await temporaryRoot();
        const store = new BashOutputStore(absoluteFsPath(root), policy({maxFiles: 2, maxBytes: 2048, maxOutputBytes: 1024}));
        const first = await writeOutput(store, "first");
        await writeOutput(store, "second");
        const active = await requiredReservation(store);

        await expect(store.read(first)).rejects.toBeInstanceOf(BashOutputReclaimedError);
        await active.discard();
    });

    it("硬预算不驱逐当前进程仍在写的lease", async () => {
        const root = await temporaryRoot();
        const store = new BashOutputStore(absoluteFsPath(root), policy({maxFiles: 1, maxBytes: 1024, maxOutputBytes: 1024}));
        const active = await requiredReservation(store);

        await expect(store.reserve()).resolves.toBeNull();
        await expect(fs.stat(path.dirname(active.physicalPath))).resolves.toMatchObject({});
        await active.discard();
    });

    it("TTL到期明确返回输出已回收且不删除未知目录", async () => {
        const root = await temporaryRoot();
        let now = Date.parse("2026-07-28T00:00:00.000Z");
        const store = new BashOutputStore(absoluteFsPath(root), policy({ttlMs: 100}), () => now);
        const locator = await writeOutput(store, "expires");
        const foreign = path.join(root, "foreign");
        await fs.mkdir(foreign);
        await fs.writeFile(path.join(foreign, "keep.txt"), "not owned", "utf8");

        now += 101;
        await store.collect();

        await expect(store.read(locator)).rejects.toThrow(`Bash完整输出已回收：${locator}`);
        await expect(fs.readFile(path.join(foreign, "keep.txt"), "utf8")).resolves.toBe("not owned");
    });
});

describe("OutputAccumulator Bash cache", () => {
    it("单文件达到硬上限时保留locator并明确标记partial", async () => {
        const root = await temporaryRoot();
        const store = new BashOutputStore(absoluteFsPath(root), policy({maxBytes: 4096, maxOutputBytes: 1024}));
        const reservation = await requiredReservation(store);
        const output = new OutputAccumulator(reservation);
        output.append(Buffer.alloc(60 * 1024, 97));
        output.finish();
        const snapshot = output.snapshot(true);
        await output.closeOutput();

        expect(snapshot.truncation.truncated).toBe(true);
        expect(snapshot.fullOutput).toEqual({locator: reservation.reference.locator, state: "partial"});
        expect((await store.read(reservation.reference.locator)).byteLength).toBe(1024);
    });

    it("短输出不留下lease目录", async () => {
        const root = await temporaryRoot();
        const store = new BashOutputStore(absoluteFsPath(root), policy());
        const output = new OutputAccumulator(await requiredReservation(store));
        output.append(Buffer.from("short"));
        output.finish();
        expect(output.snapshot(true).fullOutput).toBeUndefined();
        await output.closeOutput();

        expect(await fs.readdir(root)).toEqual([]);
    });
});

/** 创建隔离Cache Root。 */
async function temporaryRoot(): Promise<string> {
    const root = await fs.mkdtemp(testHostPath("nbook-bash-output-"));
    roots.push(root);
    return root;
}

/** 使用小预算构造可快速验收的测试策略。 */
function policy(overrides: Partial<BashOutputPolicy> = {}): BashOutputPolicy {
    return {
        ttlMs: 1000,
        maxFiles: 4,
        maxBytes: 8192,
        maxOutputBytes: 1024,
        ...overrides,
    };
}

/** 测试场景要求成功预留时收窄null分支。 */
async function requiredReservation(store: BashOutputStore): Promise<BashOutputReservation> {
    const reservation = await store.reserve();
    if (!reservation) throw new Error("测试未取得Bash输出lease");
    return reservation;
}

/** 写入并完成一条Store输出。 */
async function writeOutput(store: BashOutputStore, content: string): Promise<string> {
    const reservation = await requiredReservation(store);
    await fs.writeFile(reservation.physicalPath, content, "utf8");
    await reservation.complete(Buffer.byteLength(content), false);
    return reservation.reference.locator;
}
