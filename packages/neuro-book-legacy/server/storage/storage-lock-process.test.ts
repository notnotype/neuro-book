import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {mkdtemp, rm} from "node:fs/promises";
import path from "node:path";
import {createInterface} from "node:readline";
import {lock as acquireFileLock} from "proper-lockfile";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {afterEach, describe, expect, it} from "vitest";
import {defineStorageState, StorageStateRegistry} from "nbook/shared/storage/definition";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {ensureStorageIdentityDomain} from "nbook/server/storage/identity-domain";
import {StorageService} from "nbook/server/storage/storage-service";
import type {StorageLockAdapter} from "nbook/server/storage/partition-lock";

type RacerState = {
    readonly writer: string;
};

/** fixture 持有分区锁的时间；parent 的竞争请求必须落在这个窗口内。 */
const HOLD_MS = 300;

const racerDefinition = defineStorageState<RacerState>({
    owner: "test.racer",
    key: "layout",
    scope: "user",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {writer: "default"},
    validate: (value): value is RacerState => typeof value === "object" && value !== null
        && typeof (value as RacerState).writer === "string",
});

type ChildExit = {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
};

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => rm(root, {recursive: true, force: true})));
});

/** 读取下一个 child 协议行；提前退出或输出结束都转换成可解释的失败。 */
async function nextChildLine(
    lines: AsyncIterator<string>,
    childClosed: Promise<ChildExit>,
    stderr: () => string,
): Promise<string> {
    const outcome = await Promise.race([
        lines.next().then((result) => ({kind: "line" as const, result})),
        childClosed.then((exit) => ({kind: "exit" as const, exit})),
    ]);
    if (outcome.kind === "exit") {
        throw new Error(`child 在输出前退出：code=${String(outcome.exit.code)} signal=${String(outcome.exit.signal)} stderr=${stderr()}`);
    }
    if (outcome.result.done) {
        throw new Error(`child 输出结束：stderr=${stderr()}`);
    }
    return outcome.result.value;
}

async function expectChildLine(
    lines: AsyncIterator<string>,
    childClosed: Promise<ChildExit>,
    expected: string,
    stderr: () => string,
): Promise<void> {
    const line = await nextChildLine(lines, childClosed, stderr);
    if (line !== expected) {
        throw new Error(`child 协议行不匹配：期望 ${expected}，收到 ${line}；stderr=${stderr()}`);
    }
}

/** parent 侧同样包住真实分区锁，使竞争请求在锁释放前发起。 */
function holdLockAdapter(): StorageLockAdapter {
    return {
        acquire: async (file, options) => {
            const release = await acquireFileLock(file, options);
            return async () => {
                await new Promise<void>((resolve) => setTimeout(resolve, HOLD_MS));
                await release();
            };
        },
    };
}

describe("Storage 跨进程条件写", () => {
    it("两个真实进程用同一旧 revision 竞争时至多一个成功", async () => {
        const scratch = await mkdtemp(testHostPath("nbook-storage-lock-process-"));
        roots.push(scratch);
        const root = absoluteFsPath(path.join(scratch, "storage"));
        const {identityDomain} = await ensureStorageIdentityDomain(root);
        const registry = new StorageStateRegistry();
        registry.register(racerDefinition);
        const service = new StorageService({registry, lockAdapter: holdLockAdapter()});
        const parent = await service.openHandle({
            owner: "test.racer",
            context: {scope: "user", storageRoot: root, identityDomain, subject: "user-a", clientId: "client-1"},
        });

        const missing = await parent.read(racerDefinition);
        if (missing.kind !== "missing") {
            throw new Error(`初始读取需要 missing，实际 ${missing.kind}`);
        }
        const initial = await parent.save(racerDefinition, {expected: missing.credential, value: {writer: "parent-initial"}});
        if (initial.revision === null) {
            throw new Error("初始保存必须产生 revision");
        }

        const fixturePath = path.resolve(process.cwd(), "server", "storage", "fixtures", "storage-revision-racer.ts");
        const bunExecutable = "bun" in process.versions ? process.execPath : "bun";
        const child = spawn(bunExecutable, [fixturePath], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NBOOK_TEST_STORAGE_ROOT: root,
                NBOOK_TEST_STORAGE_IDENTITY_DOMAIN: identityDomain,
                NBOOK_TEST_STORAGE_EXPECTED_REVISION: initial.revision,
                NBOOK_TEST_STORAGE_WRITER: "child",
                NBOOK_TEST_STORAGE_HOLD_MS: String(HOLD_MS),
            },
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        let childStderr = "";
        child.stderr.on("data", (chunk: string) => {
            childStderr += chunk;
        });
        const output = createInterface({input: child.stdout, crlfDelay: Infinity});
        const lines = output[Symbol.asyncIterator]();
        const childClosed = new Promise<ChildExit>((resolve) => {
            child.once("close", (code, signal) => resolve({code, signal}));
        });

        try {
            await expectChildLine(lines, childClosed, "NBOOK_STORAGE_READY", () => childStderr);
            child.stdin.write("GO\n");
            await expectChildLine(lines, childClosed, "NBOOK_STORAGE_LOCK_HELD", () => childStderr);

            const startedAt = Date.now();
            const racing = await parent.save(racerDefinition, {
                expected: {revision: initial.revision, partitionGeneration: initial.partitionGeneration},
                value: {writer: "parent"},
            }).then(
                (value) => ({ok: true as const, value}),
                (error: unknown) => ({ok: false as const, error}),
            );
            const elapsed = Date.now() - startedAt;

            const childResult = await nextChildLine(lines, childClosed, () => childStderr);
            expect(childResult).toMatch(/^NBOOK_STORAGE_RESULT /u);
            const childOutcome = JSON.parse(childResult.slice("NBOOK_STORAGE_RESULT ".length)) as {
                readonly status: string;
                readonly revision?: string;
                readonly code?: string;
            };
            expect(childOutcome).toMatchObject({status: "saved"});
            if (childOutcome.revision === undefined) {
                throw new Error(`child 未报告 revision：${childResult}`);
            }

            if (racing.ok) {
                throw new Error("父进程竞争写入不应成功");
            }
            expect(racing.error).toMatchObject({
                code: "STORAGE_REVISION_CONFLICT",
                expectedRevision: initial.revision,
                observedRevision: childOutcome.revision,
            });
            expect(elapsed).toBeGreaterThanOrEqual(HOLD_MS / 2);
            expect(childOutcome.revision).not.toBe(initial.revision);

            child.stdin.end();
            await expectChildLine(lines, childClosed, "NBOOK_STORAGE_RELEASED", () => childStderr);
            await expect(childClosed).resolves.toEqual({code: 0, signal: null});

            const reopened = await service.openHandle({
                owner: "test.racer",
                context: {scope: "user", storageRoot: root, identityDomain, subject: "user-a", clientId: "client-1"},
            });
            await expect(reopened.read(racerDefinition)).resolves.toMatchObject({
                kind: "value",
                value: {writer: "child"},
                credential: {revision: childOutcome.revision},
            });
        } finally {
            output.close();
            stopChild(child);
        }
    }, 30_000);
});

/** 只终止本测试创建的 child；异常路径不允许留下无人管理的进程。 */
function stopChild(child: ChildProcessWithoutNullStreams): void {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    if (!child.stdin.destroyed) {
        child.stdin.end();
    }
    child.kill();
}
