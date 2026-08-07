import path from "node:path";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/**
 * 为不触碰真实用户目录的测试建立宿主原生绝对路径。
 *
 * Windows runner 得到盘符路径，POSIX runner 得到 `/...` 路径；测试不得再把
 * `C:/...` 当成跨平台绝对路径。需要验证 Windows 字符串语义时应显式使用
 * `path.win32`，而不是调用本辅助函数。
 */
export function testHostPath(...segments: string[]): string {
    return path.resolve(process.cwd(), ".agent", "tmp", "test-paths", ...segments);
}

export function testAbsoluteFsPath(...segments: string[]): AbsoluteFsPath {
    return absoluteFsPath(testHostPath(...segments));
}
