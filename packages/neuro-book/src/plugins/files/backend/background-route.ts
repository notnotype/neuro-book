/**
 * 写背景图片（docs/specs/workspace/files.md 的“写背景图片”）。文件名由服务端算：内容的 SHA-256 加按字节判定的扩展名，同一张图只存一份。
 *
 * 写入经 Files 自己的提交链（暂存、记账、变更都在里面），这里只做传输、校验与定址。整份读进内存再算哈希：上限内有界，现有暂存要先有
 * 目标地址，不支持写完再定名。
 */

import {createHash} from "node:crypto";
import {lstat} from "node:fs/promises";
import {join} from "node:path";

import type {Hono} from "hono";
import {bodyLimit} from "hono/body-limit";

import type {HttpRouteEnv} from "nbook/plugins/http/shared/contracts";
import {sniffImageType} from "nbook/shared/image-type";
import type {RasterImageType} from "nbook/shared/image-type";

import type {ServerFilesResult} from "../shared/workspace-files";

export const BACKGROUND_MAX_BYTES = 20 * 1024 * 1024;
export const BACKGROUND_DIRECTORY = "backgrounds";

const EXTENSIONS: Readonly<Record<RasterImageType, string>> = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"};

export interface BackgroundRouteSources {
    /** `user://` 根的真实路径。 */
    readonly userRoot: string;
    readonly write: (address: string, bytes: Uint8Array) => Promise<ServerFilesResult<unknown>>;
}

const failure = (status: 409 | 413 | 415 | 500, code: string, detail: string): Response => Response.json({code, detail}, {status});

export function addBackgroundRoutes(app: Hono<{Bindings: HttpRouteEnv}>, sources: BackgroundRouteSources): void {
    const limit = bodyLimit({
        maxSize: BACKGROUND_MAX_BYTES,
        onError: () => failure(413, "too-large", `背景图片至多 ${String(BACKGROUND_MAX_BYTES)} 字节`),
    });

    app.put("/backgrounds", limit, async (c) => {
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        const type = sniffImageType(bytes);
        if (type === null) return failure(415, "unsupported-type", "只收 PNG、JPEG 或 WebP");

        // 根的检查只保住整个 user 根：这里是根内的链接时，文件会写到别的目录。
        const directory = await lstat(join(sources.userRoot, BACKGROUND_DIRECTORY)).catch(() => null);
        if (directory !== null && !directory.isDirectory()) return failure(409, "invalid-target", `${BACKGROUND_DIRECTORY} 不是目录`);

        const digest = createHash("sha256").update(bytes).digest("hex");
        const name = `${digest}.${EXTENSIONS[type]}`;
        const address = `user://${BACKGROUND_DIRECTORY}/${name}`;
        const path = join(sources.userRoot, BACKGROUND_DIRECTORY, name);

        /** 已有这个名字：字节相同就是同一张图，返回同一地址，不再提交；否则是坏文件，不覆盖。 */
        const existing = async (): Promise<Response | null> => {
            const info = await lstat(path).catch(() => null);
            if (info === null) return null;
            if (!info.isFile()) return failure(409, "conflict", `${name} 不是普通文件`);
            const current = createHash("sha256").update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest("hex");
            return current === digest ? Response.json({address}) : failure(409, "conflict", `${name} 的内容与文件名不符`);
        };

        const found = await existing();
        if (found !== null) return found;
        const written = await sources.write(address, bytes);
        if (written.ok) return Response.json({address});
        // 两个窗口同时传同一张图：另一个先提交了，按已有处理。
        if (written.code === "conflict") {
            const raced = await existing();
            if (raced !== null) return raced;
        }
        return failure(500, written.code, written.detail);
    });
}
