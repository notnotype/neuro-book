import {homedir} from "node:os";
import path from "node:path";
import {lstat, realpath} from "node:fs/promises";

/** 已规范化的文件系统绝对路径品牌；测试支持包可在不依赖应用源码的情况下构造同一合同。 */
export type AbsoluteFsPath = string & {readonly __absoluteFsPath: "absolute-fs-path"};

/**
 * 校验并规范化绝对文件系统路径。
 *
 * 领域引用和相对文件地址必须先由各自 Module 解析，不能直接伪装成绝对路径。
 */
export function absoluteFsPath(input: string): AbsoluteFsPath {
    const expanded = expandHome(input.trim());
    if (!path.isAbsolute(expanded)) {
        throw new Error(`需要绝对文件系统路径，收到：${input}`);
    }
    return path.resolve(expanded) as AbsoluteFsPath;
}

/**
 * 将普通文件路径解析到确定的物理根。
 *
 * 相对路径以 root 为基准；绝对路径保持绝对语义。本函数不识别 Workspace Root
 * Reference、Project Path 或 Agent alias，也不负责限制绝对路径访问能力。
 */
export function resolveFilePath(root: AbsoluteFsPath, input: string): AbsoluteFsPath {
    const expanded = expandHome(input.trim());
    if (!expanded) {
        throw new Error("文件路径不能为空");
    }
    return path.isAbsolute(expanded)
        ? absoluteFsPath(expanded)
        : path.resolve(root, expanded) as AbsoluteFsPath;
}

/**
 * 将输入解析到指定根内，并执行 lexical containment 检查。
 *
 * 该检查可处理 `..`，但不会穿透已存在 symlink/junction；需要真实文件系统隔离的
 * 读写操作应在调用层追加 realpath 或已存在父目录检查。
 */
export function resolveContainedFilePath(root: AbsoluteFsPath, input: string): AbsoluteFsPath {
    const resolved = resolveFilePath(root, input);
    const relativePath = path.relative(root, resolved);
    if (!isOutsideRootRelativePath(relativePath)) {
        return resolved;
    }
    throw new Error(`路径越过文件系统根：${input}`);
}

/**
 * 将绝对目标转换为指定root内唯一的正斜杠相对路径。
 *
 * 返回null表示目标不属于root；root自身返回`.`。调用方应保存该canonical结果，
 * 不能继续传播用户输入中的`.`或`..`拼写。
 */
export function relativeFilePathInside(root: AbsoluteFsPath, target: AbsoluteFsPath): string | null {
    const relativePath = path.relative(root, target);
    if (isOutsideRootRelativePath(relativePath)) {
        return null;
    }
    return relativePath === "" ? "." : relativePath.replaceAll(path.sep, "/");
}

/**
 * 校验已存在目标或其最近已存在父目录的真实路径仍位于 root 内。
 *
 * 该检查补足 lexical containment 无法识别 symlink/junction 逃逸的问题。调用方应先
 * 用 `resolveContainedFilePath()` 得到目标，再在真正读写前调用本函数。
 */
export async function assertRealPathContained(root: AbsoluteFsPath, target: AbsoluteFsPath): Promise<void> {
    if (await relativeRealPathInside(root, target) !== null) {
        return;
    }
    throw new Error(`真实路径越过文件系统根：${target}`);
}

/**
 * 将目标按真实文件系统身份转换为 root 内的相对路径。
 *
 * 目标尚不存在时，从最近的已存在父目录解析 realpath，再拼回缺失后缀；因此既能
 * 识别 Windows 8.3/大小写别名，也不会把穿过 symlink/junction 的路径误判在 root 内。
 */
export async function relativeRealPathInside(
    root: AbsoluteFsPath,
    target: AbsoluteFsPath,
): Promise<string | null> {
    const realRoot = await realpath(root);
    let existingPath = target;
    const missingSegments: string[] = [];
    while (true) {
        try {
            await lstat(existingPath);
            break;
        } catch (error) {
            if (!isMissingPathError(error)) {
                throw error;
            }
            const parent = path.dirname(existingPath);
            if (parent === existingPath) {
                throw new Error(`找不到可验证的目标父目录：${target}`);
            }
            missingSegments.unshift(path.basename(existingPath));
            existingPath = parent as AbsoluteFsPath;
        }
    }
    const realExistingPath = await realpath(existingPath);
    const realTarget = path.resolve(realExistingPath, ...missingSegments);
    const relativePath = path.relative(realRoot, realTarget);
    if (isOutsideRootRelativePath(relativePath)) {
        return null;
    }
    return relativePath === "" ? "." : relativePath.replaceAll(path.sep, "/");
}

/**
 * 校验目标目录项的真实父目录位于root内。
 *
 * rename、unlink和rm操作的是目录项本身，不应跟随目标symlink/junction；这类操作
 * 使用父目录检查。读取、写入或stat仍必须使用`assertRealPathContained()`检查目标。
 */
export async function assertRealParentContained(root: AbsoluteFsPath, target: AbsoluteFsPath): Promise<void> {
    await assertRealPathContained(root, absoluteFsPath(path.dirname(target)));
}

/** 展开当前用户 HOME；其余路径语义保持不变。 */
function expandHome(input: string): string {
    if (input === "~") {
        return homedir();
    }
    if (input.startsWith("~/") || input.startsWith("~\\")) {
        return homedir() + input.slice(1);
    }
    return input;
}

/** 判断Node文件系统错误是否表示路径不存在。 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 判断path.relative结果是否真正越过root，而不是仅以两个点开头的合法名称。 */
function isOutsideRootRelativePath(relativePath: string): boolean {
    return path.isAbsolute(relativePath)
        || relativePath === ".."
        || relativePath.startsWith(`..${path.sep}`);
}
