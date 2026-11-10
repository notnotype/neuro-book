/**
 * 状态根的实例认领：一个状态根同一时间只跑一个服务端（docs/specs/runtime/server-host.md 的“实例认领”）。
 *
 * 认领就是在状态根派生的地址上监听一个本地套接字（Unix 域套接字；Windows 是命名管道），做法同 VS Code 桌面端的
 * `claimInstance`。套接字由内核持有：进程活着（包括被暂停）就一直占着，进程死了立即释放，没有过期时间。曾经的
 * 锁目录方案靠心跳判活，进程暂停超过心跳期限就会被接管，同一状态根跑起两个实例。
 *
 * 认领步骤：建状态根 → 取认领锁 → 连套接字：有应答是已有实例；连上但没有应答是实例被暂停或卡死，不接管；连不上
 * （`ECONNREFUSED`、`ENOENT`）说明是崩溃留下的套接字文件，删掉后监听。认领锁只持有到监听成功：两个启动者同时
 * 看到残留文件时，没有它会出现一方删掉另一方刚建的套接字、两方都以为认领成功。
 *
 * 套接字上的协议是一行一个 JSON：客户端发 `{"type":"hello"}`，实例回一行 `InstanceInfo` 后关闭连接。认领一成功
 * 就应答（`starting`），已认领、还没监听 HTTP 的窗口里第二次启动也能找到这个实例。
 */

import {createHash} from "node:crypto";
import {chmod, mkdir, realpath, stat, unlink} from "node:fs/promises";
import {connect, createServer} from "node:net";
import type {Server, Socket} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import {holdLock} from "@notnotype/nb-file-lock";

import {NotLoadedSchema} from "nbook/plugin-platform/shared/types";

const InstanceKindSchema = Type.Union([Type.Literal("product"), Type.Literal("development"), Type.Literal("fixture")]);
/** 谁在运行：产品（`main.ts` 与 `nbook start`）、开发会话的后端、测试的子进程入口。 */
export type InstanceKind = Static<typeof InstanceKindSchema>;

const InstancePluginSchema = Type.Object({
    id: Type.String(),
    version: Type.String(),
    state: Type.Union([Type.Literal("enabled"), Type.Literal("disabled"), Type.Literal("uninstalling")]),
    /** 本次启动没有登记的原因；登记了为 null。 */
    notLoaded: Type.Union([NotLoadedSchema, Type.Null()]),
});
/** 运行中实例的一个第三方插件（本次启动的集合，`nbook plugin list` 拿它算待生效的变化）。 */
export type InstancePlugin = Static<typeof InstancePluginSchema>;

/** `hello` 的应答。读者按它完整校验：对端可能是旧版本、损坏的进程或同一用户的别的程序。 */
const InstanceInfoSchema = Type.Object({
    schema: Type.Literal(1),
    pid: Type.Integer(),
    version: Type.String(),
    kind: InstanceKindSchema,
    status: Type.Union([Type.Literal("starting"), Type.Literal("ready"), Type.Literal("stopping")]),
    /** 可在浏览器打开的页面地址；还没监听，或开发会话的后端（页面在 Vite 那边）为 null。 */
    url: Type.Union([Type.String(), Type.Null()]),
    rpcUrl: Type.Union([Type.String(), Type.Null()]),
    /** 本次启动的第三方插件；还没就绪为 null。 */
    plugins: Type.Union([Type.Object({safeMode: Type.Boolean(), items: Type.Array(InstancePluginSchema)}), Type.Null()]),
});
export type InstanceInfo = Static<typeof InstanceInfoSchema>;
export type InstanceStatus = InstanceInfo["status"];

/** 已认领的状态根。认领者对它负责到进程结束：就绪时 `publish`，开始停止时 `stopping`，停止结算后 `release`。 */
export interface StateRootClaim {
    readonly stateRoot: string;
    readonly kind: InstanceKind;
    /** 运行实例可用：应答带上地址与插件集合。 */
    publish(ready: {readonly url: string | null; readonly rpcUrl: string; readonly plugins: NonNullable<InstanceInfo["plugins"]>}): void;
    stopping(): void;
    /** 关掉监听、删掉自己的套接字文件。幂等，多次调用得到同一个 Promise。 */
    release(): Promise<void>;
}

export type ClaimResult =
    | {readonly ok: true; readonly claim: StateRootClaim}
    | {readonly ok: false; readonly reason: "running"; readonly instance: InstanceInfo}
    | {readonly ok: false; readonly reason: "unresponsive"; readonly detail: string}
    | {readonly ok: false; readonly reason: "unwritable" | "failed"; readonly detail: string};

export type InstanceQuery =
    | {readonly state: "none"}
    | {readonly state: "running"; readonly instance: InstanceInfo}
    | {readonly state: "unresponsive"; readonly detail: string};

export interface ClaimOptions {
    readonly stateRoot: string;
    readonly kind: InstanceKind;
    readonly version: string;
    /** 收尾时的次要错误（锁、连接写入、删除套接字文件）记诊断；事件名由本模块给出。 */
    readonly report: (event: string, error: unknown) => void;
}

/** 连上之后等应答的上限：超过就认为实例被暂停或卡死。 */
export const HELLO_TIMEOUT_MS = 3_000;
/** 一次请求或应答的字节上限：应答带插件列表，几百个插件也远在这之内。超过就断开，不让对端把缓冲撑大。 */
const MESSAGE_LIMIT = 1 << 20;
/** Unix 套接字路径的上限是 104（macOS）到 108（Linux）字节，含结尾的 0；留些余量。 */
const SOCKET_PATH_LIMIT = 100;

/**
 * 实例的套接字地址：状态根里的 `server.sock`；路径太长时改放运行时目录，用状态根真实路径的哈希命名（两个路径指向
 * 同一个状态根时地址相同）。Windows 是同一哈希的命名管道。状态根必须已存在。
 */
export async function instanceAddress(stateRoot: string): Promise<string> {
    const root = await realpath(stateRoot);
    const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
    if (process.platform === "win32") return `\\\\.\\pipe\\nbook-${hash}`;
    const inRoot = join(root, "server.sock");
    if (Buffer.byteLength(inRoot) <= SOCKET_PATH_LIMIT) return inRoot;
    return join(process.env.XDG_RUNTIME_DIR || tmpdir(), `nbook-${hash}.sock`);
}

/** 问状态根上有没有实例。状态根不存在时没有实例（不建目录）。 */
export async function queryInstance(stateRoot: string, timeoutMs: number = HELLO_TIMEOUT_MS): Promise<InstanceQuery> {
    let address: string;
    try {
        address = await instanceAddress(stateRoot);
    } catch (error) {
        if (errno(error) === "ENOENT") return {state: "none"};
        throw error;
    }
    return hello(address, timeoutMs);
}

export async function claimStateRoot(options: ClaimOptions): Promise<ClaimResult> {
    try {
        await mkdir(options.stateRoot, {recursive: true});
    } catch (error) {
        return {ok: false, reason: "unwritable", detail: `无法建立状态根 ${options.stateRoot}：${describe(error)}`};
    }
    const held = await holdLock(join(options.stateRoot, "server.claim.lock"), (event, error) => options.report(`instance.claim.${event}`, error));
    if (!held.ok) {
        // 认领锁只在认领的几毫秒里持有：一直等不到，是另一个启动者卡在了认领中。
        return {ok: false, reason: held.reason === "failed" && isUnwritable(held.code) ? "unwritable" : "failed", detail: held.detail};
    }
    try {
        const address = await instanceAddress(options.stateRoot);
        const found = await hello(address, HELLO_TIMEOUT_MS);
        if (found.state === "running") return {ok: false, reason: "running", instance: found.instance};
        if (found.state === "unresponsive") return {ok: false, reason: "unresponsive", detail: found.detail};
        return await listen(address, options);
    } finally {
        await held.lock.release();
    }
}

function isUnwritable(code: string | undefined): boolean {
    return code === "EACCES" || code === "EROFS" || code === "EPERM";
}

async function listen(address: string, options: ClaimOptions): Promise<ClaimResult> {
    if (process.platform !== "win32") {
        // 连不上才走到这里：文件是崩溃留下的，或者根本没有。
        try {
            await unlink(address);
        } catch (error) {
            const code = errno(error);
            if (code !== "ENOENT") return {ok: false, reason: isUnwritable(code) ? "unwritable" : "failed", detail: `无法删除残留的 ${address}：${describe(error)}`};
        }
    }
    let info: InstanceInfo = {schema: 1, pid: process.pid, version: options.version, kind: options.kind, status: "starting", url: null, rpcUrl: null, plugins: null};
    // 连着的客户端：放下认领时一并断开，`server.close` 才不会等一个不发请求的连接。
    const connections = new Set<Socket>();
    const server = createServer((socket) => {
        connections.add(socket);
        socket.on("close", () => connections.delete(socket));
        answer(socket, () => info, options.report);
    });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(address, () => {
                server.off("error", reject);
                resolve();
            });
        });
    } catch (error) {
        return {ok: false, reason: isUnwritable(errno(error)) ? "unwritable" : "failed", detail: `无法监听 ${address}：${describe(error)}`};
    }
    server.on("error", (error) => options.report("instance.socket.error", error));
    let identity: {readonly dev: number; readonly ino: number} | null = null;
    if (process.platform !== "win32") {
        // 只给本用户：应答里有 pid 与地址，以后还会有停止请求。
        await chmod(address, 0o600).catch((error: unknown) => options.report("instance.socket.chmod-failed", error));
        identity = await stat(address).catch(() => null);
    }
    let released: Promise<void> | null = null;
    const claim: StateRootClaim = {
        stateRoot: options.stateRoot,
        kind: options.kind,
        publish: (ready) => {
            info = {...info, status: "ready", url: options.kind === "development" ? null : ready.url, rpcUrl: ready.rpcUrl, plugins: ready.plugins};
        },
        stopping: () => {
            info = {...info, status: "stopping"};
        },
        release: () => {
            if (released === null) {
                const closed = closeAndUnlink(server, address, identity, options.report);
                for (const socket of connections) socket.destroy();
                released = closed;
            }
            return released;
        },
    };
    return {ok: true, claim};
}

async function closeAndUnlink(server: Server, address: string, identity: {readonly dev: number; readonly ino: number} | null, report: ClaimOptions["report"]): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (identity === null) return;
    // 只删自己建的那个文件：手工删掉后被别人重新认领时，路径上已是别人的套接字。
    const now = await stat(address).catch(() => null);
    if (now === null || now.dev !== identity.dev || now.ino !== identity.ino) return;
    await unlink(address).catch((error: unknown) => {
        if (errno(error) !== "ENOENT") report("instance.socket.unlink-failed", error);
    });
}

/**
 * 读第一行请求、回一行应答后关闭。对方已断开时写入会出错（被暂停后恢复的实例常见），只记诊断，不能拖垮进程。连上了却迟迟
 * 不发完一行的连接按超时断开。
 */
function answer(socket: Socket, current: () => InstanceInfo, report: ClaimOptions["report"]): void {
    socket.on("error", (error) => report("instance.socket.client-error", error));
    socket.setTimeout(HELLO_TIMEOUT_MS, () => socket.destroy());
    let buffer = "";
    let answered = false;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
        if (answered) return;
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline < 0) {
            if (buffer.length > MESSAGE_LIMIT) socket.destroy();
            return;
        }
        answered = true;
        const reply = requestType(buffer.slice(0, newline)) === "hello" ? current() : {error: "unknown-request"};
        socket.end(`${JSON.stringify(reply)}\n`);
    });
}

function requestType(line: string): string | null {
    try {
        const parsed: unknown = JSON.parse(line);
        return typeof parsed === "object" && parsed !== null && "type" in parsed && typeof parsed.type === "string" ? parsed.type : null;
    } catch {
        return null;
    }
}

function hello(address: string, timeoutMs: number): Promise<InstanceQuery> {
    return new Promise((resolve) => {
        const socket = connect(address);
        let buffer = "";
        let settled = false;
        const settle = (result: InstanceQuery): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => settle({state: "unresponsive", detail: `${address} 上的实例 ${String(timeoutMs)}ms 内没有应答`}), timeoutMs);
        socket.setEncoding("utf8");
        socket.once("connect", () => socket.write(`${JSON.stringify({type: "hello"})}\n`));
        socket.on("data", (chunk: string) => {
            buffer += chunk;
            const newline = buffer.indexOf("\n");
            if (newline < 0) {
                if (buffer.length > MESSAGE_LIMIT) settle({state: "unresponsive", detail: `${address} 上的应答超过 ${String(MESSAGE_LIMIT)} 字节`});
                return;
            }
            const instance = parseInfo(buffer.slice(0, newline));
            settle(instance === null ? {state: "unresponsive", detail: `${address} 上的应答无法识别`} : {state: "running", instance});
        });
        socket.on("error", (error) => {
            const code = errno(error);
            // 文件在而没人听（崩溃留下的）、文件不在：都没有实例。
            if (code === "ECONNREFUSED" || code === "ENOENT") settle({state: "none"});
            else settle({state: "unresponsive", detail: `连不上 ${address}：${describe(error)}`});
        });
        socket.on("close", () => settle({state: "unresponsive", detail: `${address} 上的实例没有应答就关闭了连接`}));
    });
}

function parseInfo(line: string): InstanceInfo | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return null;
    }
    return Value.Check(InstanceInfoSchema, parsed) ? parsed : null;
}

function errno(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
