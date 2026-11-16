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
 * 就应答（`starting`），已认领、还没监听 HTTP 的窗口里第二次启动也能找到这个实例。认领者可以另登记别的请求类型
 * （`ClaimOptions.requests`，例如桌面壳的开窗转交）：处理器同步交回应答，副作用在同一个同步段里做完，不存在“应答超时
 * 之后处理器才做完”的情形。连上之后 3 秒内收不完一行请求就断开（绝对截止，收到数据不重置）。
 *
 * 哪个应用、哪一种认领由认领档案（`defineClaimProfile`）给出：套接字名前缀（Windows 命名管道）、套接字文件名（Unix，
 * 缺省 `server`，即 `server.sock` 与 `server.claim.lock`）、版本、应答里应用自己的字段、一条消息的字节上限。同一个状态根上
 * 可以有几种认领（服务端与桌面壳），各用自己的套接字名；两个应用共用同一个状态根不受支持（README 的已知限制）。
 */

import {createHash} from "node:crypto";
import {chmod, mkdir, realpath, stat, unlink} from "node:fs/promises";
import {connect, createServer} from "node:net";
import type {Server, Socket} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {Type} from "typebox";
import type {Static, TObject, TProperties} from "typebox";
import {Value} from "typebox/value";

import {holdLock} from "@notnotype/nb-file-lock";

const InstanceKindSchema = Type.Union([Type.Literal("product"), Type.Literal("development"), Type.Literal("fixture")]);
/** 谁在运行：产品入口、开发会话的后端、测试的子进程入口。 */
export type InstanceKind = Static<typeof InstanceKindSchema>;

/** 应答的基础字段，两个应用一样。 */
const BASE_FIELDS = {
    schema: Type.Literal(1),
    pid: Type.Integer(),
    version: Type.String(),
    kind: InstanceKindSchema,
    status: Type.Union([Type.Literal("starting"), Type.Literal("ready"), Type.Literal("stopping")]),
    /** 可在浏览器打开的页面地址；还没监听，或开发会话的后端（页面在 Vite 那边）为 null。 */
    url: Type.Union([Type.String(), Type.Null()]),
    rpcUrl: Type.Union([Type.String(), Type.Null()]),
};
type BaseInfo = Static<TObject<typeof BASE_FIELDS>>;
export type InstanceStatus = BaseInfo["status"];

/** `hello` 的应答：基础字段加应用的字段，应用的字段还没就绪为 null。读者按档案完整校验：对端可能是旧版本、损坏的进程或同一用户的别的程序。 */
export type InstanceInfo<E extends TProperties> = BaseInfo & {readonly [K in keyof E]: Static<E[K]> | null};

/** 认领档案：哪个应用在认领。经 `defineClaimProfile` 建出，不直接写字面量。 */
export interface ClaimProfile<E extends TProperties> {
    /** 运行时目录里的套接字与 Windows 命名管道的名字前缀。 */
    readonly socketPrefix: string;
    /** 状态根里的套接字文件名（不带 `.sock`）与认领锁的名字（`<名>.claim.lock`）。 */
    readonly socketName: string;
    /** 一条请求或应答的字节上限（UTF-8）。 */
    readonly messageLimit: number;
    readonly version: string;
    /** 应答里应用自己的字段。 */
    readonly fields: E;
    /** 整个应答的 schema（应用字段可为 null），读者据此校验。 */
    readonly answer: TObject;
    /** 发布时核对应用字段用的 schema。 */
    readonly extra: TObject<E>;
}

/** 建认领档案。应用字段的键与基础字段重名时抛错：重名会让应答的形状随合并顺序变。 */
export function defineClaimProfile<E extends TProperties>(profile: {readonly socketPrefix: string; readonly socketName?: string; readonly messageLimit?: number; readonly version: string; readonly fields: E}): ClaimProfile<E> {
    const clashing = Object.keys(profile.fields).filter((key) => Object.hasOwn(BASE_FIELDS, key));
    if (clashing.length > 0) throw new Error(`claim profile fields clash with the base answer fields: ${clashing.join(", ")}`);
    const socketName = profile.socketName ?? "server";
    if (!/^[a-z][a-z0-9-]*$/u.test(socketName)) throw new Error(`claim profile socketName must be a lowercase file name: ${socketName}`);
    const messageLimit = profile.messageLimit ?? MESSAGE_LIMIT;
    if (!Number.isInteger(messageLimit) || messageLimit < 1024) throw new Error(`claim profile messageLimit must be an integer of at least 1024 bytes: ${String(messageLimit)}`);
    const nullable = Object.fromEntries(Object.entries(profile.fields).map(([key, schema]) => [key, Type.Union([schema, Type.Null()])]));
    return {socketPrefix: profile.socketPrefix, socketName, messageLimit, version: profile.version, fields: profile.fields, answer: Type.Object({...BASE_FIELDS, ...nullable}), extra: Type.Object(profile.fields)};
}

/** 已认领的状态根。认领者对它负责到进程结束：就绪时 `publish`，开始停止时 `stopping`，停止结算后 `release`。 */
export interface StateRootClaim<E extends TProperties> {
    readonly stateRoot: string;
    readonly kind: InstanceKind;
    /**
     * 运行实例可用：应答带上地址与应用字段。应用字段不合档案时抛错、应答不变：不合的应答会让后来的启动者把本实例
     * 判成“没有应答”，而不是“已在运行”。
     */
    publish(ready: {readonly url: string | null; readonly rpcUrl: string | null; readonly extra: Static<TObject<E>>}): void;
    stopping(): void;
    /** 关掉监听、删掉自己的套接字文件。幂等，多次调用得到同一个 Promise。 */
    release(): Promise<void>;
}

export type ClaimResult<E extends TProperties> =
    | {readonly ok: true; readonly claim: StateRootClaim<E>}
    | {readonly ok: false; readonly reason: "running"; readonly instance: InstanceInfo<E>}
    | {readonly ok: false; readonly reason: "unresponsive"; readonly detail: string}
    | {readonly ok: false; readonly reason: "unwritable" | "failed"; readonly detail: string};

export type InstanceQuery<E extends TProperties> =
    | {readonly state: "none"}
    | {readonly state: "running"; readonly instance: InstanceInfo<E>}
    | {readonly state: "unresponsive"; readonly detail: string};

export interface ClaimOptions<E extends TProperties> {
    readonly stateRoot: string;
    readonly kind: InstanceKind;
    readonly profile: ClaimProfile<E>;
    /** 收尾时的次要错误（锁、连接写入、删除套接字文件）记诊断；事件名由本模块给出。 */
    readonly report: (event: string, error: unknown) => void;
    /**
     * `hello` 之外的请求：类型 → 处理器。处理器同步交回应答（会被 JSON 编码后写回），要做的副作用在里面同步做完；抛错时
     * 记诊断、不回应答直接断开（对方看到的是没有应答）。
     */
    readonly requests?: Readonly<Record<string, (request: unknown) => unknown>>;
    /** 不认识的请求类型的应答，缺省 `{error: "unknown-request"}`。 */
    readonly unknownReply?: unknown;
}

/** 连上之后等应答的上限：超过就认为实例被暂停或卡死。 */
export const HELLO_TIMEOUT_MS = 3_000;
/** 一次请求或应答的缺省字节上限：服务端的应答带插件列表，几百个插件也远在这之内。超过就断开，不让对端把缓冲撑大。 */
const MESSAGE_LIMIT = 1 << 20;
/** Unix 套接字路径的上限是 104（macOS）到 108（Linux）字节，含结尾的 0；留些余量。 */
const SOCKET_PATH_LIMIT = 100;

/**
 * 实例的套接字地址：状态根里的 `<socketName>.sock`；路径太长时改放运行时目录，用状态根真实路径的哈希命名（两个路径指向
 * 同一个状态根时地址相同）。Windows 是同一哈希的命名管道。状态根必须已存在。
 */
export async function instanceAddress(stateRoot: string, socketPrefix: string, socketName: string = "server"): Promise<string> {
    const root = await realpath(stateRoot);
    const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
    if (process.platform === "win32") return `\\\\.\\pipe\\${socketPrefix}-${hash}`;
    const inRoot = join(root, `${socketName}.sock`);
    if (Buffer.byteLength(inRoot) <= SOCKET_PATH_LIMIT) return inRoot;
    return join(process.env.XDG_RUNTIME_DIR || tmpdir(), `${socketPrefix}-${hash}.sock`);
}

/** 问状态根上有没有实例。状态根不存在时没有实例（不建目录）。 */
export async function queryInstance<E extends TProperties>(stateRoot: string, profile: ClaimProfile<E>, timeoutMs: number = HELLO_TIMEOUT_MS): Promise<InstanceQuery<E>> {
    let address: string;
    try {
        address = await instanceAddress(stateRoot, profile.socketPrefix, profile.socketName);
    } catch (error) {
        if (errno(error) === "ENOENT") return {state: "none"};
        throw error;
    }
    return hello(address, profile, timeoutMs);
}

/** `sendRequest` 的结果：没有实例、交回的应答（原样，由调用方校验）、连上了却没有应答。 */
export type RequestResult = {readonly state: "none"} | {readonly state: "answered"; readonly reply: unknown} | {readonly state: "unresponsive"; readonly detail: string};

/** 向状态根上的认领者发一个 `hello` 之外的请求（`ClaimOptions.requests` 登记的类型），等一行应答。 */
export async function sendRequest(stateRoot: string, profile: ClaimProfile<TProperties>, request: {readonly type: string} & Record<string, unknown>, timeoutMs: number = HELLO_TIMEOUT_MS): Promise<RequestResult> {
    let address: string;
    try {
        address = await instanceAddress(stateRoot, profile.socketPrefix, profile.socketName);
    } catch (error) {
        if (errno(error) === "ENOENT") return {state: "none"};
        throw error;
    }
    const answered = await exchange(address, request, profile.messageLimit, timeoutMs);
    if (answered.state !== "line") return answered;
    try {
        return {state: "answered", reply: JSON.parse(answered.line)};
    } catch {
        return {state: "unresponsive", detail: `${address} 上的应答不是 JSON`};
    }
}

export async function claimStateRoot<E extends TProperties>(options: ClaimOptions<E>): Promise<ClaimResult<E>> {
    try {
        await mkdir(options.stateRoot, {recursive: true});
    } catch (error) {
        return {ok: false, reason: "unwritable", detail: `无法建立状态根 ${options.stateRoot}：${describe(error)}`};
    }
    const held = await holdLock(join(options.stateRoot, `${options.profile.socketName}.claim.lock`), (event, error) => options.report(`instance.claim.${event}`, error));
    if (!held.ok) {
        // 认领锁只在认领的几毫秒里持有：一直等不到，是另一个启动者卡在了认领中。
        return {ok: false, reason: held.reason === "failed" && isUnwritable(held.code) ? "unwritable" : "failed", detail: held.detail};
    }
    try {
        const address = await instanceAddress(options.stateRoot, options.profile.socketPrefix, options.profile.socketName);
        const found = await hello(address, options.profile, HELLO_TIMEOUT_MS);
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

async function listen<E extends TProperties>(address: string, options: ClaimOptions<E>): Promise<ClaimResult<E>> {
    if (process.platform !== "win32") {
        // 连不上才走到这里：文件是崩溃留下的，或者根本没有。
        try {
            await unlink(address);
        } catch (error) {
            const code = errno(error);
            if (code !== "ENOENT") return {ok: false, reason: isUnwritable(code) ? "unwritable" : "failed", detail: `无法删除残留的 ${address}：${describe(error)}`};
        }
    }
    const profile = options.profile;
    const unset = Object.fromEntries(Object.keys(profile.fields).map((key) => [key, null]));
    let info = {schema: 1, pid: process.pid, version: profile.version, kind: options.kind, status: "starting", url: null, rpcUrl: null, ...unset} as InstanceInfo<E>;
    // 连着的客户端：放下认领时一并断开，`server.close` 才不会等一个不发请求的连接。
    const connections = new Set<Socket>();
    const server = createServer((socket) => {
        connections.add(socket);
        socket.on("close", () => connections.delete(socket));
        answer(socket, (type, request) => {
            if (type === "hello") return info;
            // 只认登记表自己的键：`toString`、`constructor`、`__proto__` 这类继承属性不是处理器。
            const requests = options.requests;
            const handler = type === null || requests === undefined || !Object.hasOwn(requests, type) ? undefined : requests[type];
            return handler === undefined ? (options.unknownReply ?? {error: "unknown-request"}) : handler(request);
        }, profile.messageLimit, options.report);
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
    const claim: StateRootClaim<E> = {
        stateRoot: options.stateRoot,
        kind: options.kind,
        publish: (ready) => {
            if (!Value.Check(profile.extra, ready.extra)) throw new Error("claim publish: the app fields do not match the claim profile");
            info = {...info, status: "ready", url: options.kind === "development" ? null : ready.url, rpcUrl: ready.rpcUrl, ...ready.extra};
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

async function closeAndUnlink(server: Server, address: string, identity: {readonly dev: number; readonly ino: number} | null, report: ClaimOptions<TProperties>["report"]): Promise<void> {
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
 * 读第一行请求、回一行应答后关闭。连上之后 `HELLO_TIMEOUT_MS` 内收不完一行（按绝对时间，收到数据不重置）、或首行超过
 * 字节上限的连接直接断开。对方已断开时写入会出错（被暂停后恢复的实例常见），只记诊断，不能拖垮进程。`reply` 抛错时记诊断、
 * 不回应答直接断开；应答编码后超过上限同样断开并记诊断。
 */
function answer(socket: Socket, reply: (type: string | null, request: unknown) => unknown, limit: number, report: ClaimOptions<TProperties>["report"]): void {
    socket.on("error", (error) => report("instance.socket.client-error", error));
    const deadline = setTimeout(() => socket.destroy(), HELLO_TIMEOUT_MS);
    socket.once("close", () => clearTimeout(deadline));
    const chunks: Buffer[] = [];
    let received = 0;
    let answered = false;
    socket.on("data", (chunk: Buffer) => {
        if (answered) return;
        chunks.push(chunk);
        received += chunk.length;
        const buffer = Buffer.concat(chunks, received);
        const newline = buffer.indexOf(0x0a);
        if (newline < 0 ? received > limit : newline > limit) {
            socket.destroy();
            return;
        }
        if (newline < 0) return;
        answered = true;
        clearTimeout(deadline);
        const line = buffer.subarray(0, newline).toString("utf8");
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(line);
        } catch {
            parsed = null;
        }
        const type = typeof parsed === "object" && parsed !== null && "type" in parsed && typeof parsed.type === "string" ? parsed.type : null;
        let encoded: string;
        try {
            encoded = `${JSON.stringify(reply(type, parsed))}\n`;
        } catch (error) {
            report("instance.socket.request-failed", error);
            socket.destroy();
            return;
        }
        if (Buffer.byteLength(encoded) > limit + 1) {
            report("instance.socket.reply-too-large", new Error(`reply to ${type ?? "an unknown request"} exceeds ${String(limit)} bytes`));
            socket.destroy();
            return;
        }
        socket.end(encoded);
    });
}

/** 连上地址、写一行请求、读一行应答（字节上限与超时同 `answer`）。连不上时没有实例。 */
function exchange(address: string, request: unknown, limit: number, timeoutMs: number): Promise<{state: "none"} | {state: "line"; line: string} | {state: "unresponsive"; detail: string}> {
    return new Promise((resolve) => {
        const socket = connect(address);
        const chunks: Buffer[] = [];
        let received = 0;
        let settled = false;
        const settle = (result: {state: "none"} | {state: "line"; line: string} | {state: "unresponsive"; detail: string}): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => settle({state: "unresponsive", detail: `${address} 上的实例 ${String(timeoutMs)}ms 内没有应答`}), timeoutMs);
        socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
        socket.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            received += chunk.length;
            const buffer = Buffer.concat(chunks, received);
            const newline = buffer.indexOf(0x0a);
            if (newline < 0 ? received > limit : newline > limit) {
                settle({state: "unresponsive", detail: `${address} 上的应答超过 ${String(limit)} 字节`});
                return;
            }
            if (newline >= 0) settle({state: "line", line: buffer.subarray(0, newline).toString("utf8")});
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

async function hello<E extends TProperties>(address: string, profile: ClaimProfile<E>, timeoutMs: number): Promise<InstanceQuery<E>> {
    const answered = await exchange(address, {type: "hello"}, profile.messageLimit, timeoutMs);
    if (answered.state !== "line") return answered;
    const instance = parseInfo(answered.line, profile);
    return instance === null ? {state: "unresponsive", detail: `${address} 上的应答无法识别`} : {state: "running", instance};
}

function parseInfo<E extends TProperties>(line: string, profile: ClaimProfile<E>): InstanceInfo<E> | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        return null;
    }
    // 档案的 schema 就是这个类型：基础字段加可为 null 的应用字段（defineClaimProfile）。
    return Value.Check(profile.answer, parsed) ? (parsed as InstanceInfo<E>) : null;
}

function errno(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
