/**
 * 写入图片（docs/specs/workspace/files.md 的“写入图片”）：`PUT /api/nbook.files/raw/project/<项目 id>/<代次>/<路径…>`，请求体是
 * 原始字节，与按地址读取字节同一个地址。
 *
 * 写入经服务端的 `ownWorkspaceFiles.write("projects://<项目 id>/<路径>")`：服务端从项目登记找到项目、取租约、在项目目录的暂存区
 * 建暂存、交项目实例在提交链里提交（排他创建、记账、变更事件）；服务端的 `ownFiles` 不认 `project://`（保留名，只有项目实例里才
 * 有），所以不能直接写 `project://`。路径包含、符号链接与控制目录的规则由那条链执行，这里不再写一份。
 *
 * 代次只在请求到达时按登记核对一次（不为写入打开项目根，也不为一次上传启动项目）：核对之后、取租约之前项目换代的窄竞争里，
 * 写入落在新一代的同一个目录，Spec 写成已知限制。
 *
 * 字节整份读进内存（上限内有界），同一时刻至多处理 `CONCURRENT_UPLOADS` 个上传，其余排队：每个上传在路由里峰值约两份字节。
 */

import type {Context} from "hono";
import type {Hono} from "hono";

import type {HttpRouteEnv} from "@notnotype/nb-host/http/contracts";

import {sniffImageType} from "nbook/shared/image-type";
import type {ProjectsService} from "nbook/shared/projects";

import {isUploadServerFailure, UPLOAD_EXTENSIONS, UPLOAD_FAILURE_STATUS, UPLOAD_MAX_BYTES, UPLOAD_RENAME_LIMIT} from "../shared/upload";
import type {UploadServerFailure} from "../shared/upload";
import type {ServerFilesResult, WorkspaceFiles} from "../shared/workspace-files";
import {decodePath} from "./raw-route";

/** 同一时刻处理的上传数；其余排队（Spec：服务端同时处理至多 2 个上传）。 */
export const CONCURRENT_UPLOADS = 2;

/** 一个文件名至多这么多字节（常见文件系统的单段上限）；加了序号之后超过的为 `invalid-address`。 */
const NAME_MAX_BYTES = 255;

export interface UploadRouteSources {
    /** 项目登记；实例里没有它（只装了文件服务的测试场地）时为 null，一律 503。 */
    readonly projects: Pick<ProjectsService, "list"> | null;
    /** 服务端的文件服务：写入与列目录（挑 `exists=rename` 的名字）。 */
    readonly files: Pick<WorkspaceFiles, "write" | "list">;
}

const failure = (code: UploadServerFailure, message: string): Response => Response.json({error: {code, message}}, {status: UPLOAD_FAILURE_STATUS[code]});

/**
 * 写入链交回的失败换成路由的码。目标处已有东西（普通文件之外的目录、链接，包括指向不存在目标的链接）写入链回 `not-a-file`、
 * `not-found`，对上传都是“目标被占用”；不认识的码一律 `io-failed`，原码写进说明。
 */
function failureOf(result: Extract<ServerFilesResult<unknown>, {ok: false}>): {readonly code: UploadServerFailure; readonly occupied: boolean} {
    switch (result.code) {
        case "conflict":
        case "not-a-file":
            return {code: "conflict", occupied: true};
        case "not-found":
            // 指向不存在目标的链接：换个名字多半也不行（父目录里的链接同理），不当成“被占用”去试下一个。
            return {code: "conflict", occupied: false};
        default:
            return {code: isUploadServerFailure(result.code) ? result.code : "io-failed", occupied: false};
    }
}

/** 只放行本源发出的请求：写入没有“用户自己打开”这一种，所以 `none` 也不行；不带这个头的（本机进程）交给 `Origin` 核对。 */
function crossSite(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    return site !== null && site !== "same-origin";
}

/** 排队：同一时刻至多 `limit` 个任务在跑。 */
export class Gate {
    readonly #limit: number;
    #active = 0;
    readonly #waiting: Array<() => void> = [];

    constructor(limit: number) {
        this.#limit = limit;
    }

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.#active >= this.#limit) await new Promise<void>((resolve) => this.#waiting.push(resolve));
        else this.#active += 1;
        try {
            return await task();
        } finally {
            const next = this.#waiting.shift();
            if (next === undefined) this.#active -= 1;
            else next();
        }
    }
}

/** 读请求体，边收边数：超过 `max` 就停（分块传输没有 `Content-Length`，所以不能只看头）。 */
async function readBody(request: Request, max: number): Promise<Uint8Array | "too-large"> {
    const reader = request.body?.getReader();
    if (reader === undefined) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
            await reader.cancel();
            return "too-large";
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

/** `名字.扩展名` 的第 `n` 个候选：第 1 个是原名，之后 `名字 2.扩展名`。 */
function candidate(stem: string, extension: string, n: number): string {
    return n === 1 ? `${stem}.${extension}` : `${stem} ${String(n)}.${extension}`;
}

export function addUploadRoutes(app: Hono<{Bindings: HttpRouteEnv}>, sources: UploadRouteSources): void {
    const gate = new Gate(CONCURRENT_UPLOADS);

    app.put("/raw/project/:id/:generation/*", async (c: Context) => {
        const request = c.req.raw;
        if (crossSite(request)) return failure("cross-site", "不接受别的网页写入文件。");
        const id = c.req.param("id") ?? "";
        const generation = Number(c.req.param("generation"));
        // 路径是 /raw/project/<id>/<代次>/<路径…>：前五段（含开头的空段）之后才是文件路径。
        const path = decodePath(new URL(request.url).pathname.split("/").slice(5).join("/"));
        if (!Number.isSafeInteger(generation) || generation < 1 || path === null || path === "") return failure("invalid-address", "地址不合法");
        if (sources.projects === null) return failure("project-unavailable", "这个实例没有项目登记。");

        // 代次：只服务正在运行的那一代；宽限期里的项目仍是同一代。
        const listed = await sources.projects.list();
        if (!listed.ok) return failure("project-unavailable", `项目登记表不可用：${listed.detail}`);
        const project = listed.value.find((item) => item.id === id);
        const running = project !== undefined && (project.state === "running" || project.state === "idle-grace") ? project.generation : null;
        if (running !== generation) return failure("generation-gone", `作品 ${id} 的第 ${String(generation)} 代不在运行`);

        // 名字：主名不空、扩展名在允许的集合里。
        const slash = path.lastIndexOf("/");
        const directory = slash < 0 ? "" : path.slice(0, slash);
        const name = path.slice(slash + 1);
        const dot = name.lastIndexOf(".");
        const stem = dot < 0 ? name : name.slice(0, dot);
        const extension = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
        if (stem === "") return failure("invalid-address", "名字的主名不能为空");
        const expected = UPLOAD_EXTENSIONS[extension];
        if (expected === undefined) return failure("unsupported-type", "只收 PNG、JPEG、GIF 或 WebP 图片，名字的扩展名要是 png、jpg、jpeg、gif 或 webp");
        const exists = new URL(request.url).searchParams.get("exists") === "rename" ? "rename" : "fail";

        // 提前判：声明的长度已经超过上限就不读了（分块传输没有这个头，下面还会边收边数）。
        const declared = Number(request.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > UPLOAD_MAX_BYTES) return failure("too-large", `图片至多 ${String(UPLOAD_MAX_BYTES)} 字节`);

        return gate.run(async () => {
            if (request.signal.aborted) return failure("io-failed", "请求已取消");
            const bytes = await readBody(request, UPLOAD_MAX_BYTES);
            if (bytes === "too-large") return failure("too-large", `图片至多 ${String(UPLOAD_MAX_BYTES)} 字节`);
            const type = sniffImageType(bytes);
            if (type === null) return failure("unsupported-type", "不是 PNG、JPEG、GIF 或 WebP 图片");
            if (type !== expected) return failure("extension-mismatch", `文件内容是 ${type}，扩展名对不上`);

            const parent = `projects://${id}/${directory}`;
            const addressOf = (fileName: string): string => `projects://${id}/${directory === "" ? "" : `${directory}/`}${fileName}`;
            const options = {expect: "absent", createParents: true, signal: request.signal} as const;
            const done = (fileName: string, renamed: boolean): Response => Response.json({address: `project://${directory === "" ? "" : `${directory}/`}${fileName}`, renamed}, {status: 201});

            if (exists === "fail") {
                const written = await sources.files.write(addressOf(name), bytes, options);
                if (written.ok) return done(name, false);
                return failure(failureOf(written).code, written.detail);
            }

            // `rename`：先看父目录里已有哪些名字（不存在算空，不区分大小写：大小写不敏感的文件系统上 `A.png` 与 `a.png` 是同一个），
            // 挑第一个空着的候选只写一次；写时仍被占用（并发）就接着试下一个，别的失败立即结束。
            const taken = new Set<string>();
            const existing = await sources.files.list(parent, {signal: request.signal});
            if (existing.ok && !("kind" in existing.value)) for (const entry of existing.value.entries) taken.add(entry.name.toLowerCase());
            for (let n = 1; n <= UPLOAD_RENAME_LIMIT; n += 1) {
                const fileName = candidate(stem, extension, n);
                if (taken.has(fileName.toLowerCase())) continue;
                if (byteLength(fileName) > NAME_MAX_BYTES) return failure("invalid-address", "加了序号的名字太长");
                const written = await sources.files.write(addressOf(fileName), bytes, options);
                if (written.ok) return done(fileName, n > 1);
                const failed = failureOf(written);
                if (!failed.occupied) return failure(failed.code, written.detail);
                taken.add(fileName.toLowerCase());
            }
            return failure("conflict", `${name} 与它的序号名字 ${String(UPLOAD_RENAME_LIMIT)} 个以内都被占用`);
        });
    });
}
