import path from "node:path";
import {existsSync, realpathSync} from "node:fs";

/** App SQLite在宿主机与容器中的统一位置描述。 */
export type AppSqliteLocation = {
    /** 配置文件中保留的可迁移逻辑值。 */
    configuredUrl: string;
    /** 可直接交给libsql或Prisma的宿主机绝对file URL。 */
    connectionUrl: string;
    /** 宿主机上的绝对物理路径。 */
    hostPath: string;
    /** 数据库位于State Root内，或由用户明确配置为外部绝对文件。 */
    scope: "state-root" | "external";
    /** Docker Profile使用的容器绝对file URL；外部数据库没有该值。 */
    containerUrl?: string;
};

/** App SQLite默认逻辑URL。 */
export const DEFAULT_APP_SQLITE_URL = "file:./workspace/.nbook/neuro-book.sqlite";

/** 按进程/`.env`、Boot Config、默认值的优先级选择App SQLite配置。 */
export function selectAppSqliteUrl(environmentUrl: string | undefined, bootUrl: string | undefined): string {
    return environmentUrl?.trim() || bootUrl?.trim() || DEFAULT_APP_SQLITE_URL;
}

/**
 * 将配置中的SQLite file URL规范化为宿主机绝对位置。
 *
 * 相对路径只能落在State Root内；明确绝对路径可作为原生Profile的外部数据库。
 */
export function resolveAppSqliteLocation(configuredUrl: string, stateRoot: string): AppSqliteLocation {
    const value = configuredUrl.trim();
    if (!value.startsWith("file:")) {
        throw new Error(`SQLite DATABASE_URL 必须以 file: 开头，当前为：${value || "<empty>"}`);
    }

    const configuredPath = value.slice("file:".length);
    if (!configuredPath || configuredPath === ":memory:") {
        throw new Error("SQLite DATABASE_URL 必须指向文件路径，不能使用空路径或内存库。");
    }
    if (configuredPath.includes("?") || configuredPath.includes("#")) {
        throw new Error("SQLite DATABASE_URL 不支持query或fragment。" );
    }

    const windowsDrivePath = parseWindowsDrivePath(configuredPath);
    const localPath = process.platform !== "win32" && configuredPath.startsWith("///")
        ? configuredPath.slice(2)
        : configuredPath;
    if (isUncPath(localPath) && !windowsDrivePath) {
        throw new Error("SQLite DATABASE_URL 不支持Windows UNC路径。" );
    }

    const statePath = path.resolve(stateRoot);
    let hostPath: string;
    let explicitAbsolute = false;
    if (windowsDrivePath) {
        if (process.platform !== "win32") {
            throw new Error(`当前平台不能使用Windows SQLite绝对路径：${configuredUrl}`);
        }
        hostPath = path.win32.resolve(windowsDrivePath);
        explicitAbsolute = true;
    } else if (path.isAbsolute(localPath)) {
        hostPath = path.resolve(localPath);
        explicitAbsolute = true;
    } else {
        hostPath = path.resolve(statePath, localPath);
        if (!isInside(statePath, hostPath)) {
            throw new Error(`相对SQLite DATABASE_URL越过State Root：${configuredUrl}`);
        }
    }

    const scope = isInside(statePath, hostPath) && isPhysicallyInside(statePath, hostPath) ? "state-root" : "external";
    if (!explicitAbsolute && scope !== "state-root") {
        throw new Error(`相对SQLite DATABASE_URL越过State Root：${configuredUrl}`);
    }
    const containerUrl = scope === "state-root"
        ? fileUrl(path.posix.join("/app", path.relative(statePath, hostPath).replaceAll("\\", "/")))
        : undefined;
    return {
        configuredUrl: value,
        connectionUrl: fileUrl(hostPath),
        hostPath,
        scope,
        ...(containerUrl ? {containerUrl} : {}),
    };
}

/**
 * 以最近存在的父目录解析真实路径，阻止相对SQLite通过symlink/junction逃出State Root。
 * State Root本身可以是用户选择的链接；它的真实目标作为本次信任锚。
 */
function isPhysicallyInside(root: string, target: string): boolean {
    const existingRoot = nearestExistingPath(root);
    const existingTarget = nearestExistingPath(target);
    if (!existingRoot || !existingTarget) {
        return true;
    }
    const realRoot = realpathSync.native(existingRoot);
    const rootSuffix = path.relative(existingRoot, root);
    const physicalRoot = path.resolve(realRoot, rootSuffix);
    const realTarget = realpathSync.native(existingTarget);
    const targetSuffix = path.relative(existingTarget, target);
    const physicalTarget = path.resolve(realTarget, targetSuffix);
    return isInside(physicalRoot, physicalTarget);
}

/** 返回自身或最近存在的父目录；跨到文件系统根仍不存在时返回null。 */
function nearestExistingPath(input: string): string | null {
    let current = path.resolve(input);
    while (!existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
    return current;
}

/** 将绝对物理路径转换为libsql已验证的file URL格式。 */
function fileUrl(absolutePath: string): string {
    return `file:${absolutePath.replaceAll("\\", "/")}`;
}

/** 识别Windows支持的三种绝对file URL路径形态。 */
function parseWindowsDrivePath(input: string): string | null {
    const normalized = input.replaceAll("\\", "/");
    const match = /^(?:\/{0,3})([A-Za-z]:\/.*)$/u.exec(normalized);
    return match?.[1] ?? null;
}

/** UNC与file://host均不属于本轮支持的本地SQLite位置。 */
function isUncPath(input: string): boolean {
    const normalized = input.replaceAll("\\", "/");
    return normalized.startsWith("//");
}

/** 比较规范化绝对路径，避免字符串前缀把相邻目录误判为子目录。 */
function isInside(root: string, target: string): boolean {
    const relativePath = path.relative(root, target);
    return relativePath === "" || relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath);
}