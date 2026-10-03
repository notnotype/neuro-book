/**
 * 后端生产构建 smoke：先用 Bun 打包 `src/server/main.ts`，再对打包产物运行真实进程场景。
 *
 *   bun run smoke:server
 *
 * 场景：S1 启动后 health 为 200，标准输入 stop 以 0 退出且日志落盘；S2 SIGTERM 以 0 退出；
 * S3 缺少状态根以 1 退出；S4 端口已被占用时启动失败、写出致命诊断并以 1 退出；
 * S5 设置 `NBOOK_WEB_ROOT` 时提供外壳、页面路径回退到外壳，引导接口返回协议版本。
 * 任一场景失败或未执行都以非零退出；状态根放在测试临时根下，结束时删除。
 */

import {existsSync} from "node:fs";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const packageRoot = resolve(import.meta.dir, "..");
const bundle = join(packageRoot, "dist", "server", "main.js");

type Result = {readonly id: string; readonly ok: boolean; readonly evidence: string};

interface Running {
    readonly url: Promise<string>;
    readonly exit: Promise<number | null>;
    readonly stderr: () => string;
    stop(how: "stdin" | "SIGTERM"): void;
}

function run(env: Record<string, string>): Running {
    const child = Bun.spawn(["bun", bundle, "--stop-stdin"], {env: {...process.env, ...env}, stdin: "pipe", stdout: "pipe", stderr: "pipe"});
    const listening = Promise.withResolvers<string>();
    // 预期启动失败的场景不读地址；不让这条拒绝变成未处理的 Promise 拒绝。
    listening.promise.catch(() => undefined);
    let stderr = "";
    void (async () => {
        let stdout = "";
        for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
            stdout += chunk;
            const match = /Listening on (\S+)/u.exec(stdout);
            if (match) listening.resolve(match[1] as string);
        }
        listening.reject(new Error("进程没有开始监听"));
    })();
    void (async () => {
        for await (const chunk of child.stderr.pipeThrough(new TextDecoderStream())) stderr += chunk;
    })();
    return {
        url: listening.promise,
        exit: child.exited.then(() => child.exitCode),
        stderr: () => stderr,
        stop: (how) => {
            if (how === "SIGTERM") {
                child.kill("SIGTERM");
                return;
            }
            child.stdin.write("stop\n");
            child.stdin.flush();
        },
    };
}

async function main(): Promise<number> {
    const build = Bun.spawnSync(["bun", "run", "build:server"], {cwd: packageRoot, stdout: "inherit", stderr: "inherit"});
    if (build.exitCode !== 0 || !existsSync(bundle)) {
        console.error(`后端打包失败（退出码 ${String(build.exitCode)}），smoke 未执行`);
        return 1;
    }
    const root = await createTestTmpRoot("neuro-book-smoke-server", "smoke-server");
    const results: Result[] = [];
    try {
        for (const how of ["stdin", "SIGTERM"] as const) {
            const id = how === "stdin" ? "S1" : "S2";
            const stateRoot = join(root, id);
            const server = run({NBOOK_STATE_ROOT: stateRoot, NBOOK_PORT: "0"});
            const url = await server.url;
            const health = await fetch(`${url}api/runtime/health`);
            server.stop(how);
            const code = await server.exit;
            const logged = existsSync(join(stateRoot, "logs", "server-current.jsonl"));
            results.push({id, ok: health.status === 200 && code === 0 && logged, evidence: `health=${String(health.status)} exit=${String(code)} log=${String(logged)}`});
        }

        const missing = run({NBOOK_STATE_ROOT: "", NBOOK_PORT: "0"});
        const missingCode = await missing.exit;
        results.push({id: "S3", ok: missingCode === 1 && missing.stderr().includes("missing-state-root"), evidence: `exit=${String(missingCode)}`});

        const holder = run({NBOOK_STATE_ROOT: join(root, "S4-holder"), NBOOK_PORT: "0"});
        const port = new URL(await holder.url).port;
        const conflict = run({NBOOK_STATE_ROOT: join(root, "S4"), NBOOK_PORT: port});
        const conflictCode = await conflict.exit;
        holder.stop("stdin");
        const holderCode = await holder.exit;
        results.push({
            id: "S4",
            ok: conflictCode === 1 && conflict.stderr().includes("runtime.startup.failed") && holderCode === 0,
            evidence: `conflict-exit=${String(conflictCode)} holder-exit=${String(holderCode)}`,
        });

        const webRoot = join(root, "S5-web");
        await mkdir(join(webRoot, "assets"), {recursive: true});
        await writeFile(join(webRoot, "index.html"), "<!doctype html><title>smoke-shell</title>");
        const web = run({NBOOK_STATE_ROOT: join(root, "S5"), NBOOK_PORT: "0", NBOOK_WEB_ROOT: webRoot});
        const webUrl = await web.url;
        const shell = await (await fetch(webUrl)).text();
        const fallback = await (await fetch(`${webUrl}some/page`)).text();
        const bootstrap = (await (await fetch(`${webUrl}api/runtime/browser-bootstrap`)).json()) as {protocolVersion?: unknown};
        web.stop("stdin");
        const webCode = await web.exit;
        results.push({
            id: "S5",
            ok: shell.includes("smoke-shell") && fallback === shell && bootstrap.protocolVersion === 1 && webCode === 0,
            evidence: `shell=${String(shell.includes("smoke-shell"))} fallback=${String(fallback === shell)} protocol=${String(bootstrap.protocolVersion)} exit=${String(webCode)}`,
        });
    } finally {
        await rm(root, {recursive: true, force: true});
    }
    console.log(JSON.stringify({schema: "nbook.smoke/server/v1", results}, null, 2));
    const expected = ["S1", "S2", "S3", "S4", "S5"];
    const complete = expected.every((id) => results.some((result) => result.id === id));
    return complete && results.every((result) => result.ok) ? 0 : 1;
}

process.exit(await main());
