import {spawn} from "node:child_process";

export type RunOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "ignore" | "pipe";
};

export type RunCaptureResult = {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
};

/** 执行外部命令，非零退出码抛出异常。 */
export async function run(command: string, args: string[], options: RunOptions = {}): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: options.stdio ?? "inherit",
            windowsHide: true,
        });
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`${command} 被信号中断：${signal}`));
                return;
            }
            if (code !== 0) {
                const location = options.cwd ? `，工作目录 ${options.cwd}` : "";
                rejectPromise(new Error(`${command} 执行失败，退出码 ${code ?? "unknown"}${location}`));
                return;
            }
            resolvePromise();
        });
    });
}

/**
 * 通过stdin向子进程发送原始bytes并立即关闭pipe。
 *
 * secret调用方不得把同一内容放进argv、env或错误消息；本Module也不记录input。
 */
export async function runWithInput(
    command: string,
    args: string[],
    input: Uint8Array,
    options: Omit<RunOptions, "stdio"> = {},
): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: ["pipe", "inherit", "inherit"],
            windowsHide: true,
        });
        child.on("error", rejectPromise);
        child.stdin.on("error", rejectPromise);
        child.stdin.end(input);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`${command} 被信号中断：${signal}`));
                return;
            }
            if (code !== 0) {
                const location = options.cwd ? `，工作目录 ${options.cwd}` : "";
                rejectPromise(new Error(`${command} 执行失败，退出码 ${code ?? "unknown"}${location}`));
                return;
            }
            resolvePromise();
        });
    });
}

/**
 * 从Manager Host Runtime启动Bun子进程。
 *
 * Bun 1.3.14在Windows由Bun进程直接spawn另一个`bun install`时会错误报告
 * frozen lockfile变化；经PowerShell宿主启动则使用正常CLI语义。参数通过JSON环境变量
 * 传递，避免路径空格和PowerShell字符串转义改变命令内容。
 */
export async function runBun(command: string, args: string[], options: RunOptions = {}): Promise<void> {
    if (process.platform !== "win32") {
        await run(command, args, options);
        return;
    }
    const env = {
        ...(options.env ?? process.env),
        NEURO_BOOK_CHILD_BUN: command,
        NEURO_BOOK_CHILD_BUN_ARGS: JSON.stringify(args),
    };
    const script = "$command = $env:NEURO_BOOK_CHILD_BUN; $arguments = ConvertFrom-Json $env:NEURO_BOOK_CHILD_BUN_ARGS; & $command @arguments; exit $LASTEXITCODE";
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {...options, env});
}

/** 执行外部命令并读取 stdout。 */
export async function runCapture(command: string, args: string[], options: Omit<RunOptions, "stdio"> = {}): Promise<string> {
    const result = await runCaptureResult(command, args, options);
    if (result.signal || result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `${command} 执行失败，退出码 ${result.exitCode ?? result.signal ?? "unknown"}`);
    }
    return result.stdout;
}

/** 执行外部命令并保留退出结果；调用方自行判断允许的非零退出码。 */
export async function runCaptureResult(command: string, args: string[], options: Omit<RunOptions, "stdio"> = {}): Promise<RunCaptureResult> {
    return new Promise<RunCaptureResult>((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => stdout += chunk);
        child.stderr.on("data", (chunk: string) => stderr += chunk);
        child.on("error", rejectPromise);
        // `exit`早于stdio关闭；短命令在macOS上可能先退出、后派发最后一段stdout。
        // 只有`close`能够保证stdout/stderr已完整消费，版本检查才能稳定读取输出。
        child.on("close", (code, signal) => {
            resolvePromise({stdout, stderr, exitCode: code, signal});
        });
    });
}

/** 检查命令是否可执行。 */
export async function commandAvailable(command: string, args = ["--version"]): Promise<boolean> {
    try {
        await run(command, args, {stdio: "ignore"});
        return true;
    } catch {
        return false;
    }
}
