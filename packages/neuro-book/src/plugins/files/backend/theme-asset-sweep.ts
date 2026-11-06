/**
 * 清理没人引用的主题素材（docs/specs/theme/editor.md 的“清理未使用素材”）：`POST /theme-assets/sweep`。
 *
 * 引用关系在工作台的 Storage 记录里，Files 不认识它，所以由调用方交 `keep`（仍被引用的素材名）。误删没有回收站，防线是：
 * 只认摘要命名的普通文件（别的名字、子目录、符号链接一律不碰）；保护期内（文件修改时间或上传路由最近交出过它，`SWEEP_PROTECTION_MS`）
 * 的不删；统计与真删分两步，真删只在用户确认过的 `names` 里删，每一个在互斥内重新核对仍是候选才删。`expected` 令牌只是目录项
 * 身份（设备号、inode、创建时间、类型），原地改写与改修改时间它都不变，所以“改过就不删”靠这里的重新核对，不靠令牌。
 */

import {lstat, readdir} from "node:fs/promises";
import type {Stats} from "node:fs";
import {join} from "node:path";

import type {Hono} from "hono";
import {bodyLimit} from "hono/body-limit";

import type {HttpRouteEnv} from "nbook/plugins/http/shared/contracts";

import {THEME_ASSET_DIRECTORY_ADDRESS, THEME_ASSET_FILE_NAME, THEME_ASSET_SWEEP_MAX_BYTES, THEME_ASSET_SWEEP_MAX_NAMES} from "../shared/contracts";
import type {ThemeAssetSweepResult, ThemeAssetSweepSkipReason, ThemeAssetSweepStats} from "../shared/contracts";
import {entryToken} from "./rooted";
import {failure, SWEEP_PROTECTION_MS, THEME_ASSET_DIRECTORY} from "./theme-asset-common";
import type {ThemeAssetGuard, ThemeAssetRouteSources} from "./theme-asset-common";

/** 请求体里的名字数组：必须是合格素材文件名的数组、不超过上限；返回 null 表示不合格。 */
function nameList(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length > THEME_ASSET_SWEEP_MAX_NAMES) return null;
    return value.every((name) => typeof name === "string" && THEME_ASSET_FILE_NAME.test(name)) ? (value as string[]) : null;
}

type Candidate = {readonly ok: true; readonly stats: Stats} | {readonly ok: false; readonly reason: ThemeAssetSweepSkipReason; readonly code?: string};

/** `lstat`：只有“不存在”（ENOENT、ENOTDIR）是 null；权限、I/O 等别的失败照实抛出，不能伪装成“没有这个文件”。 */
async function statOrNull(path: string): Promise<Stats | null> {
    try {
        return await lstat(path);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return null;
        throw error;
    }
}

const errnoOf = (error: unknown): string => (error as NodeJS.ErrnoException | undefined)?.code ?? "unknown";

export function addThemeAssetSweepRoute(app: Hono<{Bindings: HttpRouteEnv}>, sources: ThemeAssetRouteSources, guard: ThemeAssetGuard): void {
    const limit = bodyLimit({
        maxSize: THEME_ASSET_SWEEP_MAX_BYTES,
        onError: () => failure(413, "too-large", `清理请求至多 ${String(THEME_ASSET_SWEEP_MAX_BYTES)} 字节`),
    });

    app.post("/theme-assets/sweep", limit, async (c) => {
        const body = await c.req.json().catch(() => null) as {keep?: unknown; names?: unknown} | null;
        if (body === null || typeof body !== "object") return failure(400, "bad-request", "请求体要是 JSON 对象");
        const keep = nameList(body.keep);
        if (keep === null) return failure(400, "bad-request", `keep 要是素材文件名的数组，至多 ${String(THEME_ASSET_SWEEP_MAX_NAMES)} 项`);
        const names = body.names === undefined ? undefined : nameList(body.names);
        if (names === null) return failure(400, "bad-request", `names 要是素材文件名的数组，至多 ${String(THEME_ASSET_SWEEP_MAX_NAMES)} 项`);
        // 读目录或查文件失败（权限、I/O）：给带码的失败，不让它变成通用的内部错误，更不能当成“目录是空的”。
        return guard.run(() => sweep(sources, guard, new Set(keep), names).catch((error: unknown) => failure(500, "io-error", `读取素材目录失败：${errnoOf(error)}`)));
    });
}

async function sweep(sources: ThemeAssetRouteSources, guard: ThemeAssetGuard, keep: ReadonlySet<string>, names: ReadonlyArray<string> | undefined): Promise<Response> {
    const directory = join(sources.userRoot, THEME_ASSET_DIRECTORY);
    const info = await statOrNull(directory);
    if (info === null) return Response.json(names === undefined ? {removable: []} satisfies ThemeAssetSweepStats : {removed: [], skipped: []} satisfies ThemeAssetSweepResult);
    if (!info.isDirectory()) return failure(409, "invalid-target", `${THEME_ASSET_DIRECTORY} 不是目录`);

    const line = guard.now() - SWEEP_PROTECTION_MS;
    /**
     * 现在这一刻，这个名字还是不是可以清理的：普通文件、没被引用、过了保护期。每次都重新读磁盘；真删前（`strict`）连素材目录本身也再核对
     * 一次仍是真实目录：通用入口可以在两步之间把它换成指向根内别处的链接，而删除会跟随根内的祖先链接。窗口缩到两次读盘之间，不能为零
     * （`entryToken` 只认最终文件，不认父目录），换成链接的是用户自己的另一种明确操作，且删掉的只会是摘要命名的素材文件。
     */
    const examine = async (name: string, strict: boolean): Promise<Candidate> => {
        try {
            if (strict) {
                const current = await statOrNull(directory);
                if (current === null || !current.isDirectory()) return {ok: false, reason: "not-file"};
            }
            const stats = await statOrNull(join(directory, name));
            if (stats === null || !stats.isFile()) return {ok: false, reason: "not-file"};
            if (keep.has(name)) return {ok: false, reason: "kept"};
            if (Math.max(stats.mtimeMs, guard.returnedAt(name)) > line) return {ok: false, reason: "recent"};
            return {ok: true, stats};
        } catch (error) {
            return {ok: false, reason: "failed", code: errnoOf(error)};
        }
    };

    if (names === undefined) {
        // 统计也有上限：目录里的匹配文件数不受请求体限制（别的入口可以往里放任意多个），不能让一次统计无界地扫描、占着互斥、拼出巨大的响应。
        // 超出的下次再统计（清理掉这一批之后）；`truncated` 告诉调用方还有更多。
        const removable: Array<{name: string; bytes: number}> = [];
        let truncated = false;
        for (const name of (await readdir(directory)).filter((entry) => THEME_ASSET_FILE_NAME.test(entry)).sort()) {
            const candidate = await examine(name, false);
            if (!candidate.ok) continue;
            if (removable.length >= THEME_ASSET_SWEEP_MAX_NAMES) {
                truncated = true;
                break;
            }
            removable.push({name, bytes: candidate.stats.size});
        }
        return Response.json((truncated ? {removable, truncated: true} : {removable}) satisfies ThemeAssetSweepStats);
    }

    const removed: string[] = [];
    const skipped: Array<{name: string; reason: ThemeAssetSweepSkipReason; code?: string}> = [];
    for (const name of new Set(names)) {
        const candidate = await examine(name, true);
        if (!candidate.ok) {
            skipped.push(candidate.code === undefined ? {name, reason: candidate.reason} : {name, reason: candidate.reason, code: candidate.code});
            continue;
        }
        const deleted = await sources.delete([{address: `${THEME_ASSET_DIRECTORY_ADDRESS}/${name}`, expected: entryToken(candidate.stats)}]);
        // 整次调用失败（例如根不在了）或这一项没运行：后面的也不会成功，停下，已删的照实交回。
        const item = deleted.ok ? deleted.value.items[0] : undefined;
        if (item === undefined || item.status === "not-run" || item.status === "cancelled") {
            return Response.json({code: deleted.ok ? "not-run" : deleted.code, detail: deleted.ok ? "删除没有运行" : deleted.detail, removed, skipped}, {status: 500});
        }
        if (item.status === "done") removed.push(name);
        else if (item.status === "failed") skipped.push({name, reason: "failed", code: item.code});
        else skipped.push({name, reason: "failed", code: item.reason});
    }
    return Response.json({removed, skipped} satisfies ThemeAssetSweepResult);
}
