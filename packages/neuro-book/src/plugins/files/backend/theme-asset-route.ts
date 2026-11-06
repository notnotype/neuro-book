/**
 * 写主题素材（docs/specs/theme/editor.md 的“写场景素材”“写图标素材”）：场景图与工作态场景是位图，图标是 SVG，两条路由、两套检查，
 * 同一个目录。文件名由服务端算：内容的 SHA-256 加按字节判定的扩展名，同一份内容只存一份。
 *
 * 写入经 Files 自己的提交链（暂存、记账、变更都在里面），这里只做传输、校验与定址。整份读进内存再算哈希：上限内有界，现有暂存要先有
 * 目标地址，不支持写完再定名。同一目录里没人引用的素材由 `theme-asset-sweep.ts` 清理；两者经 `ThemeAssetGuard` 互斥，上传交出的地址
 * 记进“最近返回”，清理不删它。
 */

import {createHash} from "node:crypto";
import {lstat} from "node:fs/promises";
import {join} from "node:path";

import type {Hono} from "hono";
import {bodyLimit} from "hono/body-limit";

import type {HttpRouteEnv} from "nbook/plugins/http/shared/contracts";
import {sniffImageType} from "nbook/shared/image-type";
import type {RasterImageType} from "nbook/shared/image-type";

import {THEME_ASSET_MAX_BYTES, THEME_ICON_MAX_BYTES} from "../shared/contracts";
import {failure, THEME_ASSET_DIRECTORY, ThemeAssetGuard} from "./theme-asset-common";
import type {ThemeAssetRouteSources} from "./theme-asset-common";
import {addThemeAssetSweepRoute} from "./theme-asset-sweep";
import {checkSvgIcon} from "./svg-icon";

const EXTENSIONS: Readonly<Record<RasterImageType, string>> = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"};

/**
 * 两条路由共用的落盘：检查目标目录、定址、已存在判断、写入。检查的顺序与失败码是路由合同的一部分，两条路由一致。
 * 类型与体积在调用前已判定，这里只管把已经合格的字节放进 `theme-assets`。
 */
function store(sources: ThemeAssetRouteSources, guard: ThemeAssetGuard, bytes: Uint8Array, extension: string): Promise<Response> {
    return guard.run(() => storeLocked(sources, guard, bytes, extension));
}

async function storeLocked(sources: ThemeAssetRouteSources, guard: ThemeAssetGuard, bytes: Uint8Array, extension: string): Promise<Response> {
    // 根的检查只保住整个 user 根：这里是根内的链接时，文件会写到别的目录。
    const directory = await lstat(join(sources.userRoot, THEME_ASSET_DIRECTORY)).catch(() => null);
    if (directory !== null && !directory.isDirectory()) return failure(409, "invalid-target", `${THEME_ASSET_DIRECTORY} 不是目录`);

    const digest = createHash("sha256").update(bytes).digest("hex");
    const name = `${digest}.${extension}`;
    const address = `user://${THEME_ASSET_DIRECTORY}/${name}`;
    const path = join(sources.userRoot, THEME_ASSET_DIRECTORY, name);

    /** 已有这个名字：字节相同就是同一份，返回同一地址，不再提交；否则是坏文件，不覆盖。 */
    const info = await lstat(path).catch(() => null);
    if (info !== null) {
        if (!info.isFile()) return failure(409, "conflict", `${name} 不是普通文件`);
        const current = createHash("sha256").update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest("hex");
        if (current !== digest) return failure(409, "conflict", `${name} 的内容与文件名不符`);
        guard.returned(name);
        return Response.json({address});
    }
    const written = await sources.write(address, bytes);
    if (written.ok) {
        guard.returned(name);
        return Response.json({address});
    }
    // 两个窗口同时传同一份：另一个先提交了。提交的结果里带着已有文件的摘要，不用再读一遍。
    if (written.code === "conflict") {
        if (written.current?.hash !== digest) return failure(409, "conflict", written.detail);
        guard.returned(name);
        return Response.json({address});
    }
    return failure(500, written.code, written.detail);
}

export function addThemeAssetRoutes(app: Hono<{Bindings: HttpRouteEnv}>, sources: ThemeAssetRouteSources): void {
    const guard = new ThemeAssetGuard(sources.now);
    const sceneLimit = bodyLimit({
        maxSize: THEME_ASSET_MAX_BYTES,
        onError: () => failure(413, "too-large", `场景素材至多 ${String(THEME_ASSET_MAX_BYTES)} 字节`),
    });
    const iconLimit = bodyLimit({
        maxSize: THEME_ICON_MAX_BYTES,
        onError: () => failure(413, "too-large", `图标至多 ${String(THEME_ICON_MAX_BYTES)} 字节`),
    });

    app.put("/theme-assets", sceneLimit, async (c) => {
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        const type = sniffImageType(bytes);
        if (type === null) return failure(415, "unsupported-type", "只收 PNG、JPEG 或 WebP");
        return store(sources, guard, bytes, EXTENSIONS[type]);
    });

    app.put("/theme-icons", iconLimit, async (c) => {
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        const checked = checkSvgIcon(bytes);
        if (!checked.ok) return failure(415, "unsupported-type", `图标 SVG 不合格：${checked.detail}`);
        return store(sources, guard, bytes, "svg");
    });

    addThemeAssetSweepRoute(app, sources, guard);
}
