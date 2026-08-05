import {describe, expect, it} from "vitest";

import {runBun, runCapture, runCaptureResult} from "#manager/process";

describe("Bun子进程适配器", () => {
    it("完整转发包含空格的参数", async () => {
        await runBun(process.execPath, [
            "-e",
            "if (process.argv[1] !== 'value with spaces') process.exit(2)",
            "--",
            "value with spaces",
        ], {stdio: "ignore"});
    });

    it("保留子进程非零退出语义", async () => {
        await expect(runBun(process.execPath, ["-e", "process.exit(7)"], {stdio: "ignore"})).rejects.toThrow("退出码 7");
    });

    it("等待短命令stdout完全关闭后再返回", async () => {
        await expect(runCapture(process.execPath, [
            "-e",
            "process.stdout.write('1.3.14')",
        ])).resolves.toBe("1.3.14");
    });

    it("保留查询命令的非零退出结果，供注册表缺失和值错误分流", async () => {
        await expect(runCaptureResult(process.execPath, ["-e", "process.stdout.write('missing'); process.exit(1)"]))
            .resolves.toMatchObject({stdout: "missing", exitCode: 1, signal: null});
    });
});
