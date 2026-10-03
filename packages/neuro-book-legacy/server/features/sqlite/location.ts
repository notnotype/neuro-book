/**
 * 已解析定位的形态校验与文件身份。
 *
 * 机制只消费宿主交付的定位：`path` 形态由宿主解析（含优先级裁决）；`url` 形态按宿主
 * `server/runtime/app-sqlite-location.ts` 同一套规则校验（拒绝 UNC、非 `file:` URL、`:memory:`、
 * query/fragment 与越过 State Root 的相对 URL），不实现第二套优先级解析。
 *
 * 身份用于“同一物理文件在同一服务实例内只有一个存活登记”：父目录实路径 + 文件名（win32 折叠大小写），
 * 目标已存在时再核对文件自身实路径，从而让等价拼写与大小写别名落到同一身份。本机制不创建目录或文件。
 */

import {existsSync, realpathSync, statSync} from "node:fs";
import path from "node:path";

import {resolveAppSqliteLocation} from "nbook/server/runtime/app-sqlite-location";

import {SqliteError} from "./contracts";
import type {DatabaseFileIdentity, DatabaseLocation} from "./contracts";

/** 宿主已解析的绝对目标。 */
export interface ResolvedDatabaseLocation {
    readonly absolutePath: string;
}

/** 校验已解析定位的形态并返回绝对目标；只读门禁在任何情况下都不创建目录或文件。 */
export function resolveDatabaseLocation(location: DatabaseLocation): ResolvedDatabaseLocation {
    if ("path" in location) {
        const value = location.path.trim();
        if (!path.isAbsolute(value) || value.replaceAll("\\", "/").startsWith("//")) {
            throw new SqliteError({code: "invalid-location", detail: `需要支持平台上的本地绝对路径：${value || "<empty>"}`});
        }
        return {absolutePath: path.resolve(value)};
    }
    const value = location.url.trim();
    try {
        // 复用宿主解析器的形态与越界校验：相对 URL 不得越过 State Root，绝对路径可作为外部数据库。
        return {absolutePath: resolveAppSqliteLocation(value, location.stateRoot).hostPath};
    } catch (error) {
        throw new SqliteError({code: "invalid-location", detail: error instanceof Error ? error.message : value, cause: error});
    }
}

/**
 * 计算可判等的文件身份。
 *
 * 目标已存在时用文件自身实路径（识别链接与大小写别名）；不存在时以已确认存在的父目录实路径 + 目标名预留。
 * 机制不创建目录：父目录缺失即 `not-found`，父路径不是目录或不可确认即 `invalid-location`，不默默视为新库。
 */
export function databaseFileIdentity(absolutePath: string): DatabaseFileIdentity {
    const absolute = path.resolve(absolutePath);
    const parent = path.dirname(absolute);
    const name = path.basename(absolute);
    if (name === "" || name === "." || name === "..") {
        throw new SqliteError({code: "invalid-location", detail: `缺少数据库文件名：${absolute}`});
    }
    const parentReal = realDirectoryPath(parent);
    if (existsSync(absolute)) {
        let physicalFile: string;
        let isDirectory: boolean;
        try {
            isDirectory = statSync(absolute).isDirectory();
            physicalFile = realpathSync.native(absolute);
        } catch (error) {
            throw new SqliteError({code: "invalid-location", detail: `无法确认数据库文件身份：${absolute}`, cause: error});
        }
        if (isDirectory) {
            throw new SqliteError({code: "invalid-location", detail: `数据库定位指向目录：${absolute}`});
        }
        return {absolutePath: absolute, identity: process.platform === "win32" ? physicalFile.toLowerCase() : physicalFile};
    }
    const reserved = path.join(parentReal, name);
    return {absolutePath: absolute, identity: process.platform === "win32" ? reserved.toLowerCase() : reserved};
}

/** 父目录必须存在且是目录，返回其实路径。 */
function realDirectoryPath(directory: string): string {
    let real: string;
    let isDirectory: boolean;
    try {
        isDirectory = statSync(directory).isDirectory();
        real = realpathSync.native(directory);
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            throw new SqliteError({code: "not-found", detail: `数据库父目录不存在（机制不创建目录）：${directory}`, cause: error});
        }
        throw new SqliteError({code: "invalid-location", detail: `无法确认父目录实路径：${directory}`, cause: error});
    }
    if (!isDirectory) {
        throw new SqliteError({code: "invalid-location", detail: `父路径不是目录：${directory}`});
    }
    return real;
}
