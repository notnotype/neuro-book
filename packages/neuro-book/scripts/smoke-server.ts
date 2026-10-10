/**
 * 后端生产构建 smoke：先用 Bun 打包 `src/server/main.ts`，再对打包产物运行真实进程场景。
 *
 *   bun run smoke:server
 *
 * 场景：S1 启动后 health 为 200，标准输入 stop 以 0 退出且日志落盘；S2 SIGTERM 以 0 退出；
 * S3 缺少状态根以 1 退出；S4 端口已被占用时启动失败、写出致命诊断并以 1 退出；
 * S5 设置 `NBOOK_WEB_ROOT` 时提供外壳、页面路径回退到外壳，引导接口返回协议版本；S6 引导接口给出的内核 RPC 端口上，
 * 本服务页面来源的 WebSocket 握手得到 welcome，别的来源连不上；S7 登记一个临时项目目录，握手请求绑定它：打包产物里的
 * `project.js` 起项目子进程（它在自己的日志位置建目录），welcome 带项目代次，停止时子进程随服务端收口、以 0 退出；
 * S8 以客户端身份经 `nbook.storage/user` 保存并读回一条记录：打包产物里的 SQLite 分区落在 `<状态根>/storage/user.sqlite`，
 * 停止时关库（WAL 文件收回），重启后读到同一个值；S9 状态根里先放一份带注释的 `settings.json`，以客户端身份经
 * `nbook.settings/user` 写一个键，注释与其余内容保留；文件改坏后服务端照常启动，日志里有“配置文件当前无效”的诊断。
 * 任一场景失败或未执行都以非零退出；状态根放在测试临时根下，结束时删除。
 */

import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {WIRE_PROTOCOL_VERSION} from "@notnotype/nb-runtime/remote";

import {createProjectRegistry} from "nbook/server/projects/registry";
import {BROWSER_PROTOCOL_VERSION} from "nbook/shared/browser-bootstrap";

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
    const child = Bun.spawn(["bun", bundle, "--stop-stdin"], {env: {...process.env, NBOOK_RPC_PORT: "0", ...env}, stdin: "pipe", stdout: "pipe", stderr: "pipe"});
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

/** S8 用的记录描述：与 `defineRecord({key: "smoke-notes", scope: "user", locality: "shared", ...})` 的描述相同。 */
const SMOKE_RECORD = {
    key: "smoke-notes",
    scope: "user",
    locality: "shared",
    version: 1,
    keyed: false,
    maxBytes: 1024,
    schema: {type: "object", required: ["text"], properties: {text: {type: "string"}}, additionalProperties: false},
};

/**
 * 握手后按顺序调用 `nbook.storage/user` 的方法（前一个有结果才发下一个），返回各次的结果；握手被拒或连接断开时
 * 返回已收到的。调用方身份是插件 `smoke.notes`，路由按握手登记的描述填写客户端身份。
 */
function storageCalls(rpcPort: number, origin: string, calls: ReadonlyArray<{readonly method: string; readonly effect: "read" | "write"; readonly input: Record<string, unknown>}>): Promise<unknown[]> {
    const {promise, resolve} = Promise.withResolvers<unknown[]>();
    const outcomes: unknown[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${String(rpcPort)}/`, {headers: {Origin: origin}});
    const send = (index: number): void => {
        const call = calls[index]!;
        socket.send(JSON.stringify({
            type: "request",
            id: `call-${String(index)}`,
            target: "server",
            contract: "nbook.storage/user",
            version: 1,
            method: call.method,
            effect: call.effect,
            input: {record: SMOKE_RECORD, resource: "", ...call.input},
            $nbConsumer: {instanceId: "smoke-storage", location: "browser", client: "smoke", plugin: "smoke.notes", entry: "main", generation: 1, via: null},
            $nbChain: [],
        }));
    };
    socket.addEventListener("open", () => {
        socket.send(JSON.stringify({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "smoke-storage", kind: "browser", role: "client", project: null, client: "smoke"}, bind: null, boot: null}));
    });
    socket.addEventListener("message", (event) => {
        const frame = JSON.parse(String(event.data)) as {type?: unknown; outcome?: unknown};
        if (frame.type === "welcome") send(0);
        if (frame.type !== "result") return;
        outcomes.push(frame.outcome);
        if (outcomes.length < calls.length) send(outcomes.length);
        else socket.close();
    });
    socket.addEventListener("close", () => resolve(outcomes));
    return promise;
}

/** S9：握手后以插件 `nbook.workbench` 的身份调用一次 `nbook.settings/user` 的 `set`，返回结果；握手失败时为 null。 */
function settingsSet(rpcPort: number, origin: string, key: string, value: unknown): Promise<unknown> {
    const {promise, resolve} = Promise.withResolvers<unknown>();
    const socket = new WebSocket(`ws://127.0.0.1:${String(rpcPort)}/`, {headers: {Origin: origin}});
    socket.addEventListener("open", () => {
        socket.send(JSON.stringify({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "smoke-settings", kind: "browser", role: "client", project: null, client: "smoke"}, bind: null, boot: null}));
    });
    socket.addEventListener("message", (event) => {
        const frame = JSON.parse(String(event.data)) as {type?: unknown; outcome?: unknown};
        if (frame.type === "welcome") {
            socket.send(JSON.stringify({
                type: "request", id: "set", target: "server", contract: "nbook.settings/user", version: 1, method: "set", effect: "write", input: {key, value},
                $nbConsumer: {instanceId: "smoke-settings", location: "browser", client: "smoke", plugin: "nbook.workbench", entry: "browser", generation: 1, via: null},
                $nbChain: [],
            }));
        }
        if (frame.type !== "result") return;
        resolve(frame.outcome);
        socket.close();
    });
    socket.addEventListener("close", () => resolve(null));
    return promise;
}

/** 以 `origin` 连 RPC 端口并握手（可带绑定请求）：打开后发 hello，返回第一帧；没能打开时返回 null。 */
function handshake(rpcPort: number, origin: string, bind: {readonly project: string} | null = null): Promise<Record<string, unknown> | null> {
    const {promise, resolve} = Promise.withResolvers<Record<string, unknown> | null>();
    const socket = new WebSocket(`ws://127.0.0.1:${String(rpcPort)}/`, {headers: {Origin: origin}});
    socket.addEventListener("open", () => {
        socket.send(JSON.stringify({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {id: "smoke-client", kind: "browser", role: "client", project: null, client: "smoke"}, bind, boot: null}));
    });
    socket.addEventListener("message", (event) => {
        resolve(JSON.parse(String(event.data)) as Record<string, unknown>);
        socket.close();
    });
    socket.addEventListener("close", () => resolve(null));
    return promise;
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
            ok: shell.includes("smoke-shell") && fallback === shell && bootstrap.protocolVersion === BROWSER_PROTOCOL_VERSION && webCode === 0,
            evidence: `shell=${String(shell.includes("smoke-shell"))} fallback=${String(fallback === shell)} protocol=${String(bootstrap.protocolVersion)} exit=${String(webCode)}`,
        });

        const rpc = run({NBOOK_STATE_ROOT: join(root, "S6"), NBOOK_PORT: "0"});
        const rpcPageUrl = await rpc.url;
        const announced = (await (await fetch(`${rpcPageUrl}api/runtime/browser-bootstrap`)).json()) as {rpc?: {port?: unknown}};
        const rpcPort = Number(announced.rpc?.port);
        const welcome = await handshake(rpcPort, new URL(rpcPageUrl).origin);
        const foreign = await handshake(rpcPort, "http://evil.example");
        rpc.stop("stdin");
        const rpcCode = await rpc.exit;
        results.push({
            id: "S6",
            ok: welcome?.type === "welcome" && typeof welcome.boot === "string" && foreign === null && rpcCode === 0,
            evidence: `rpc-port=${String(rpcPort)} welcome=${String(welcome?.type)} foreign=${foreign === null ? "refused" : "accepted"} exit=${String(rpcCode)}`,
        });

        const s7State = join(root, "S7");
        const s7Project = join(root, "S7-Book");
        await mkdir(s7Project, {recursive: true});
        const registered = await createProjectRegistry({stateRoot: s7State, cwd: root}).register(s7Project);
        const bound = run({NBOOK_STATE_ROOT: s7State, NBOOK_PORT: "0"});
        const boundUrl = await bound.url;
        const boundPort = Number(((await (await fetch(`${boundUrl}api/runtime/browser-bootstrap`)).json()) as {rpc?: {port?: unknown}}).rpc?.port);
        const binding = (await handshake(boundPort, new URL(boundUrl).origin, {project: "s7-book"}))?.binding as {name?: unknown; generation?: unknown} | undefined;
        const projectLogs = existsSync(join(s7State, "logs", "projects", "s7-book"));
        bound.stop("stdin");
        const boundCode = await bound.exit;
        results.push({
            id: "S7",
            ok: registered.ok && binding?.name === "s7-book" && binding.generation === 1 && projectLogs && boundCode === 0,
            evidence: `registered=${String(registered.ok)} binding=${JSON.stringify(binding ?? null)} project-logs=${String(projectLogs)} exit=${String(boundCode)}`,
        });

        const s8State = join(root, "S8");
        const library = join(s8State, "storage", "user.sqlite");
        const rpcOf = async (server: Running): Promise<{readonly port: number; readonly origin: string}> => {
            const pageUrl = await server.url;
            const port = Number(((await (await fetch(`${pageUrl}api/runtime/browser-bootstrap`)).json()) as {rpc?: {port?: unknown}}).rpc?.port);
            return {port, origin: new URL(pageUrl).origin};
        };
        const writer = run({NBOOK_STATE_ROOT: s8State, NBOOK_PORT: "0"});
        const writerRpc = await rpcOf(writer);
        const written = await storageCalls(writerRpc.port, writerRpc.origin, [
            {method: "open", effect: "read", input: {}},
            {method: "save", effect: "write", input: {value: {text: "smoke"}, expect: null}},
            {method: "read", effect: "read", input: {}},
        ]);
        writer.stop("stdin");
        const writerCode = await writer.exit;
        const stored = existsSync(library);
        const walGone = !existsSync(`${library}-wal`);
        const reader = run({NBOOK_STATE_ROOT: s8State, NBOOK_PORT: "0"});
        const readerRpc = await rpcOf(reader);
        const [reread] = await storageCalls(readerRpc.port, readerRpc.origin, [{method: "read", effect: "read", input: {}}]);
        reader.stop("stdin");
        const readerCode = await reader.exit;
        const readBack = (outcome: unknown): string => {
            const value = (outcome as {ok?: unknown; value?: {status?: unknown; value?: {text?: unknown}}} | undefined)?.value;
            return value?.status === "ok" ? String(value.value?.text) : JSON.stringify(outcome ?? null);
        };
        results.push({
            id: "S8",
            ok: (written[1] as {ok?: unknown} | undefined)?.ok === true && readBack(written[2]) === "smoke" && stored && walGone && readBack(reread) === "smoke" && writerCode === 0 && readerCode === 0,
            evidence: `save=${JSON.stringify(written[1] ?? null)} read=${readBack(written[2])} library=${String(stored)} wal-gone=${String(walGone)} after-restart=${readBack(reread)} exit=${String(writerCode)}/${String(readerCode)}`,
        });

        const s9State = join(root, "S9");
        const settingsFile = join(s9State, "settings.json");
        await mkdir(s9State, {recursive: true});
        const original = "// 我的设置\n{\n    // 主题\n    \"nbook.workbench/theme\": \"nbook\",\n    \"other.plugin/kept\": 1\n}\n";
        await writeFile(settingsFile, original);
        const editor = run({NBOOK_STATE_ROOT: s9State, NBOOK_PORT: "0"});
        const editorRpc = await rpcOf(editor);
        const setOutcome = await settingsSet(editorRpc.port, editorRpc.origin, "nbook.workbench/theme", "macos");
        const edited = await readFile(settingsFile, "utf8");
        editor.stop("stdin");
        const editorCode = await editor.exit;
        await writeFile(settingsFile, "{\"nbook.workbench/theme\": ");
        const broken = run({NBOOK_STATE_ROOT: s9State, NBOOK_PORT: "0"});
        const brokenHealth = (await fetch(`${await broken.url}api/runtime/health`)).status;
        broken.stop("stdin");
        const brokenCode = await broken.exit;
        const logDir = join(s9State, "logs");
        const logs = (await Promise.all((await readdir(logDir)).filter((name) => name.endsWith(".jsonl")).map((name) => readFile(join(logDir, name), "utf8")))).join("\n");
        const keptComments = edited === original.replace("\"nbook\"", "\"macos\"");
        results.push({
            id: "S9",
            ok: (setOutcome as {ok?: unknown} | null)?.ok === true && keptComments && editorCode === 0 && brokenHealth === 200 && brokenCode === 0 && logs.includes("settings.layer.invalid"),
            evidence: `set=${JSON.stringify((setOutcome as {ok?: unknown} | null)?.ok ?? null)} comments-kept=${String(keptComments)} broken-health=${String(brokenHealth)} invalid-logged=${String(logs.includes("settings.layer.invalid"))} exit=${String(editorCode)}/${String(brokenCode)}`,
        });
    } finally {
        await rm(root, {recursive: true, force: true});
    }
    console.log(JSON.stringify({schema: "nbook.smoke/server/v1", results}, null, 2));
    const expected = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"];
    const complete = expected.every((id) => results.some((result) => result.id === id));
    return complete && results.every((result) => result.ok) ? 0 : 1;
}

process.exit(await main());
