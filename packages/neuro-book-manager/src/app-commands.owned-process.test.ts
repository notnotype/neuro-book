import {readFile, rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";

import {runPortableForeground} from "#manager/app-commands";

const statePaths: string[] = [];

afterEach(async () => {
    await Promise.all(statePaths.splice(0).map((path) => rm(path, {force: true})));
});

describe("Windows Portable Owned Process", () => {
    it.runIf(process.platform === "win32")("健康检查前以0退出会被判定为启动失败", async () => {
        const entry = fileURLToPath(new URL("./fixtures/portable-owned-exit.ts", import.meta.url));

        await expect(runPortableForeground(process.execPath, entry, import.meta.dir, {
            ...process.env,
            NEURO_BOOK_OWNED_EXIT_CODE: "0",
        }, 1, {startupTimeoutMs: 3_000})).rejects.toThrow("通过健康检查前以退出码0结束");
    });

    it.runIf(process.platform === "win32")("健康检查前非零退出会保留真实退出码", async () => {
        const entry = fileURLToPath(new URL("./fixtures/portable-owned-exit.ts", import.meta.url));

        await expect(runPortableForeground(process.execPath, entry, import.meta.dir, {
            ...process.env,
            NEURO_BOOK_OWNED_EXIT_CODE: "17",
        }, 1, {startupTimeoutMs: 3_000})).rejects.toThrow("NeuroBook 服务退出：17");
    });

    it.runIf(process.platform === "win32")("Session Store lease compromised退出会给出可操作提示", async () => {
        const entry = fileURLToPath(new URL("./fixtures/portable-owned-exit.ts", import.meta.url));

        await expect(runPortableForeground(process.execPath, entry, import.meta.dir, {
            ...process.env,
            NEURO_BOOK_OWNED_EXIT_CODE: "75",
        }, 1, {startupTimeoutMs: 3_000})).rejects.toThrow("不要手动删除 runtime.lease.lock");
    });

    it.runIf(process.platform === "win32")("健康检查失败会清理完整Product进程树并释放端口", async () => {
        const statePath = join(tmpdir(), `nbook-portable-owned-${crypto.randomUUID()}.json`);
        statePaths.push(statePath);
        const entry = fileURLToPath(new URL("./fixtures/portable-owned-root.ts", import.meta.url));
        const execution = runPortableForeground(process.execPath, entry, import.meta.dir, {
            ...process.env,
            NEURO_BOOK_OWNED_STATE: statePath,
        }, 1, {startupTimeoutMs: 3_000});
        const state = await Promise.race([
            waitForState(statePath),
            execution.then(
                () => Promise.reject(new Error("Portable fixture就绪前意外完成。")),
                (error) => Promise.reject(error),
            ),
        ]);

        await expect(execution).rejects.toThrow("启动后 3 秒内未通过健康检查");
        await expect(waitForPidExit(state.pid)).resolves.toBeUndefined();
        await expect(bindPort(state.port)).resolves.toBeUndefined();
    });
});

/** 等待Product孙进程写出PID与监听端口。 */
async function waitForState(path: string): Promise<{pid: number; port: number}> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        try {
            return JSON.parse(await readFile(path, "utf8")) as {pid: number; port: number};
        } catch {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        }
    }
    throw new Error("等待Portable Product fixture超时。");
}

/** 等待Product孙进程退出。 */
async function waitForPidExit(pid: number): Promise<void> {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        try {
            process.kill(pid, 0);
        } catch {
            return;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
    throw new Error(`Portable Product孙进程仍存活：${pid}`);
}

/** 证明Product树退出后原监听端口可以立即复用。 */
async function bindPort(port: number): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const server = createServer();
        server.once("error", rejectPromise);
        server.listen(port, "127.0.0.1", () => server.close(() => resolvePromise()));
    });
}
