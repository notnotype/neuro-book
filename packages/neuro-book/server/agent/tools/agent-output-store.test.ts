import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    AgentOutputReclaimedError,
    AgentOutputStore,
    agentOutputStoreForLocator,
    BASH_OUTPUT_SPEC,
    isAgentOutputLocator,
    TOOL_OUTPUT_SPEC,
    type AgentOutputPolicy,
    type AgentOutputReservation,
} from "nbook/server/agent/tools/agent-output-store";
import {OutputAccumulator} from "nbook/server/agent/tools/output-accumulator";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe("AgentOutputStore", () => {
    it("使用逻辑locator读取owner lease且不暴露物理Cache Root", async () => {
        const root = await temporaryRoot();
        const store = new AgentOutputStore(absoluteFsPath(root), BASH_OUTPUT_SPEC, policy());
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
        const store = new AgentOutputStore(absoluteFsPath(root), BASH_OUTPUT_SPEC, policy({maxFiles: 2, maxBytes: 2048, maxOutputBytes: 1024}));
        const first = await writeOutput(store, "first");
        await writeOutput(store, "second");
        const active = await requiredReservation(store);

        await expect(store.read(first)).rejects.toBeInstanceOf(AgentOutputReclaimedError);
        await active.discard();
    });

    it("硬预算不驱逐当前进程仍在写的lease", async () => {
        const root = await temporaryRoot();
        const store = new AgentOutputStore(absoluteFsPath(root), BASH_OUTPUT_SPEC, policy({maxFiles: 1, maxBytes: 1024, maxOutputBytes: 1024}));
        const active = await requiredReservation(store);

        await expect(store.reserve()).resolves.toBeNull();
        await expect(fs.stat(path.dirname(active.physicalPath))).resolves.toMatchObject({});
        await active.discard();
    });

    it("TTL到期明确返回输出已回收且不删除未知目录", async () => {
        const root = await temporaryRoot();
        let now = Date.parse("2026-07-28T00:00:00.000Z");
        const store = new AgentOutputStore(absoluteFsPath(root), BASH_OUTPUT_SPEC, policy({ttlMs: 100}), () => now);
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
        const store = new AgentOutputStore(absoluteFsPath(root), BASH_OUTPUT_SPEC, policy({maxBytes: 4096, maxOutputBytes: 1024}));
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
        const store = new AgentOutputStore(absoluteFsPath(root), BASH_OUTPUT_SPEC, policy());
        const output = new OutputAccumulator(await requiredReservation(store));
        output.append(Buffer.from("short"));
        output.finish();
        expect(output.snapshot(true).fullOutput).toBeUndefined();
        await output.closeOutput();

        expect(await fs.readdir(root)).toEqual([]);
    });
});

describe("AgentOutputStore 工具结果cache", () => {
    it("tool spec的locator按前缀定位store并可读回", async () => {
        const root = await temporaryRoot();
        const paths = createRuntimePaths({applicationRoot: absoluteFsPath(root), stateRoot: absoluteFsPath(root)});
        const store = new AgentOutputStore(paths.toolOutputRoot, TOOL_OUTPUT_SPEC, policy());
        const locator = await writeOutput(store, "tool payload");

        expect(locator).toMatch(/^tool-output:\/\//u);
        expect(isAgentOutputLocator(locator)).toBe(true);
        expect(isAgentOutputLocator("bash-output://00000000-0000-4000-8000-000000000000/output.log")).toBe(true);
        expect(isAgentOutputLocator(path.join(root, "notes.txt"))).toBe(false);

        const located = await agentOutputStoreForLocator(locator, paths);
        expect(located).not.toBeNull();
        await expect(located!.read(locator)).resolves.toEqual(Buffer.from("tool payload"));
    });

    it("spill写入完整文本并返回available locator", async () => {
        const root = await temporaryRoot();
        const store = new AgentOutputStore(absoluteFsPath(root), TOOL_OUTPUT_SPEC, policy());

        const spilled = await store.spill("full tool payload");

        expect(spilled?.state).toBe("available");
        expect(spilled?.locator).toMatch(/^tool-output:\/\//u);
        await expect(store.read(spilled!.locator)).resolves.toEqual(Buffer.from("full tool payload"));
    });

    it("spill按单文件上限截断并标记partial", async () => {
        const root = await temporaryRoot();
        const store = new AgentOutputStore(absoluteFsPath(root), TOOL_OUTPUT_SPEC, policy({maxBytes: 4096, maxOutputBytes: 1024}));

        const spilled = await store.spill("z".repeat(2048));

        expect(spilled?.state).toBe("partial");
        expect((await store.read(spilled!.locator)).byteLength).toBe(1024);
    });

    it("预留失败时spill返回null而不抛出", async () => {
        const root = await temporaryRoot();
        const store = new AgentOutputStore(absoluteFsPath(root), TOOL_OUTPUT_SPEC, policy({maxFiles: 1, maxBytes: 1024, maxOutputBytes: 1024}));
        const active = await requiredReservation(store);

        await expect(store.spill("payload")).resolves.toBeNull();
        await active.discard();
    });
});

/** 创建隔离Cache Root。 */
async function temporaryRoot(): Promise<string> {
    const root = await fs.mkdtemp(testHostPath("nbook-bash-output-"));
    roots.push(root);
    return root;
}

/** 使用小预算构造可快速验收的测试策略。 */
function policy(overrides: Partial<AgentOutputPolicy> = {}): AgentOutputPolicy {
    return {
        ttlMs: 1000,
        maxFiles: 4,
        maxBytes: 8192,
        maxOutputBytes: 1024,
        ...overrides,
    };
}

/** 测试场景要求成功预留时收窄null分支。 */
async function requiredReservation(store: AgentOutputStore): Promise<AgentOutputReservation> {
    const reservation = await store.reserve();
    if (!reservation) throw new Error("测试未取得Bash输出lease");
    return reservation;
}

/** 写入并完成一条Store输出。 */
async function writeOutput(store: AgentOutputStore, content: string): Promise<string> {
    const reservation = await requiredReservation(store);
    await fs.writeFile(reservation.physicalPath, content, "utf8");
    await reservation.complete(Buffer.byteLength(content), false);
    return reservation.reference.locator;
}
