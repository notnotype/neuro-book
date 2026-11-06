/**
 * 封面的 HTTP 路由（docs/specs/runtime/projects.md 输出第 21 条），挂在 `/api/nbook.projects/`：
 * `GET /cover/<id>` 返回文件，`PUT /cover/<id>`（multipart 的 `file`）写到作品目录根下的 `cover.<扩展名>` 并记进身份文件，
 * `DELETE /cover/<id>` 删文件并清字段。二进制走 HTTP 而不是 RPC：浏览器能直接用 `<img src>` 缓存。
 * 格式按文件开头的字节判，不信客户端给的类型；写入先落临时文件再改名，半个文件不会成为封面。
 */

import {mkdir, rename, stat, unlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {Hono} from "hono";
import {bodyLimit} from "hono/body-limit";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";

import type {HttpRouteEnv} from "nbook/plugins/http/shared/contracts";
import {rethrowRouteError} from "nbook/plugins/http/shared/contracts";
import type {ProjectsService} from "nbook/shared/projects";

import {coverContentType, coverFileName, PROJECT_COVER_MAX_BYTES, sniffCoverType} from "../shared/cover";

export interface CoverRouteSources {
    readonly projects: Pick<ProjectsService, "list" | "readMetadata" | "updateMetadata">;
    readonly record: (input: Omit<DiagnosticInput, "source">) => void;
}

type Located = {readonly ok: true; readonly path: string; readonly cover: string | null} | {readonly ok: false; readonly status: number; readonly code: string; readonly detail: string};

function code(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException | null)?.code;
}

async function locate(sources: CoverRouteSources, id: string): Promise<Located> {
    const listed = await sources.projects.list();
    if (!listed.ok) return {ok: false, status: 500, code: "registry-invalid", detail: listed.detail};
    const project = listed.value.find((item) => item.id === id);
    if (project === undefined) return {ok: false, status: 404, code: "unknown-project", detail: `没有登记 id 为 ${id} 的作品`};
    const read = await sources.projects.readMetadata(id);
    if (!read.ok) return {ok: false, status: 409, code: read.reason, detail: read.detail};
    return {ok: true, path: project.path, cover: read.metadata.cover};
}

const failure = (located: Exclude<Located, {ok: true}>): Response => Response.json({code: located.code, detail: located.detail}, {status: located.status});

/** 封面文件的修改时间，作 ETag 与书架条目的 `version`；文件不在为 null。 */
export async function coverVersion(projectPath: string, cover: string): Promise<string | null> {
    try {
        return String(Math.round((await stat(join(projectPath, cover))).mtimeMs));
    } catch (error) {
        if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return null;
        throw error;
    }
}

export function createCoverRoutes(sources: CoverRouteSources): Hono<{Bindings: HttpRouteEnv}> {
    const app = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError);

    app.get("/cover/:id", async (c) => {
        const located = await locate(sources, c.req.param("id"));
        if (!located.ok) return failure(located);
        if (located.cover === null) return Response.json({code: "no-cover", detail: "这部作品没有封面"}, {status: 404});
        const file = join(located.path, located.cover);
        const version = await coverVersion(located.path, located.cover);
        if (version === null) return Response.json({code: "no-cover", detail: `封面文件不在：${file}`}, {status: 404});
        const etag = `"${version}"`;
        if (c.req.header("if-none-match") === etag) return new Response(null, {status: 304, headers: {ETag: etag}});
        return new Response(Bun.file(file), {headers: {"Content-Type": coverContentType(located.cover) ?? "application/octet-stream", "ETag": etag, "Cache-Control": "private, max-age=0, must-revalidate"}});
    });

    // 请求体在接收时就限长：先整个解析再看 file.size，超大的请求体会整个读进内存。multipart 的边界与字段头另留 64 KiB。
    const uploadLimit = bodyLimit({
        maxSize: PROJECT_COVER_MAX_BYTES + 64 * 1024,
        onError: (c) => c.json({code: "too-large", detail: `封面至多 ${String(PROJECT_COVER_MAX_BYTES)} 字节`}, 413),
    });

    app.put("/cover/:id", uploadLimit, async (c) => {
        const located = await locate(sources, c.req.param("id"));
        if (!located.ok) return failure(located);
        let form: FormData;
        try {
            form = await c.req.formData();
        } catch (error) {
            return Response.json({code: "invalid-upload", detail: `不是 multipart 表单：${error instanceof Error ? error.message : String(error)}`}, {status: 400});
        }
        const file = form.get("file");
        if (!(file instanceof File)) return Response.json({code: "invalid-upload", detail: "表单里没有 file 字段"}, {status: 400});
        if (file.size > PROJECT_COVER_MAX_BYTES) return Response.json({code: "too-large", detail: `封面至多 ${String(PROJECT_COVER_MAX_BYTES)} 字节，收到 ${String(file.size)}`}, {status: 413});
        const bytes = new Uint8Array(await file.arrayBuffer());
        const type = sniffCoverType(bytes);
        if (type === null) return Response.json({code: "unsupported-type", detail: "只收 PNG、JPEG 或 WebP"}, {status: 415});
        const name = coverFileName(type);
        const target = join(located.path, name);
        const stamp = `${String(process.pid)}-${String(Date.now())}`;
        const temporary = join(located.path, ".nbook", `cover.tmp-${stamp}`);
        // 目标上已有的文件（同格式的旧封面）先挪进 .nbook/：身份文件写不进去时要把它还原，不能跟着新文件一起删掉。
        const backup = join(located.path, ".nbook", `cover.bak-${stamp}`);
        let backedUp = false;
        const restore = async (): Promise<void> => {
            if (!backedUp) return;
            await rename(backup, target).catch((error: unknown) => {
                sources.record({level: "warn", event: "projects.cover.restore-failed", message: "旧封面没能还原", error, data: {path: target, backup}});
            });
        };
        try {
            await mkdir(join(located.path, ".nbook"), {recursive: true});
            await writeFile(temporary, bytes);
            try {
                await rename(target, backup);
                backedUp = true;
            } catch (error) {
                if (code(error) !== "ENOENT") throw error;
            }
            await rename(temporary, target);
        } catch (error) {
            await unlink(temporary).catch(() => undefined);
            await restore();
            return Response.json({code: "write-failed", detail: `写不进 ${target}：${error instanceof Error ? error.message : String(error)}`}, {status: 500});
        }
        const updated = await sources.projects.updateMetadata(c.req.param("id"), {cover: name});
        if (!updated.ok) {
            await unlink(target).catch(() => undefined);
            await restore();
            return Response.json({code: updated.reason, detail: updated.detail}, {status: updated.reason === "read-only" ? 409 : 500});
        }
        if (backedUp) {
            await unlink(backup).catch((error: unknown) => {
                sources.record({level: "warn", event: "projects.cover.stale-file", message: "替换下来的旧封面删不掉", error, data: {path: backup}});
            });
        }
        // 换了格式时旧文件留着没用：删不掉只记诊断，封面已经生效。
        if (located.cover !== null && located.cover !== name) {
            await unlink(join(located.path, located.cover)).catch((error: unknown) => {
                if (code(error) !== "ENOENT") sources.record({level: "warn", event: "projects.cover.stale-file", message: "旧封面文件删不掉", error, data: {path: join(located.path, located.cover ?? "")}});
            });
        }
        const version = await coverVersion(located.path, name);
        return Response.json({cover: version === null ? null : {version}});
    });

    app.delete("/cover/:id", async (c) => {
        const located = await locate(sources, c.req.param("id"));
        if (!located.ok) return failure(located);
        if (located.cover === null) return Response.json({cover: null});
        const updated = await sources.projects.updateMetadata(c.req.param("id"), {cover: null});
        if (!updated.ok) return Response.json({code: updated.reason, detail: updated.detail}, {status: updated.reason === "read-only" ? 409 : 500});
        await unlink(join(located.path, located.cover)).catch((error: unknown) => {
            if (code(error) !== "ENOENT") sources.record({level: "warn", event: "projects.cover.stale-file", message: "封面文件删不掉，字段已清", error, data: {path: join(located.path, located.cover ?? "")}});
        });
        return Response.json({cover: null});
    });

    return app;
}
