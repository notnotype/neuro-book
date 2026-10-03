import {mkdtempSync} from "node:fs";
import {rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll} from "vitest";

/** Agent测试进程的日志必须隔离，不能通过默认cwd写入仓库Workspace Root。 */
const testLogRoot = mkdtempSync(join(tmpdir(), "neuro-book-vitest-logs-"));
const previousLogRoot = process.env.NEURO_BOOK_LOG_DIR;
process.env.NEURO_BOOK_LOG_DIR = testLogRoot;
// 在测试文件注册局部 mock 前绑定真实实例，teardown 不能再次经过 mocked module graph。
const {appLogger: testAppLogger} = await import("nbook/server/app-logs/logger");

afterAll(async () => {
    await testAppLogger.flush();
    await rm(testLogRoot, {recursive: true, force: true});
    if (previousLogRoot === undefined) {
        delete process.env.NEURO_BOOK_LOG_DIR;
    } else {
        process.env.NEURO_BOOK_LOG_DIR = previousLogRoot;
    }
});
