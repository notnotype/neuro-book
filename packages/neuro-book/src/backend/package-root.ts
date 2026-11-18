/**
 * 应用自带的资源（Agent 文档、内置表情包）按包根找：从调用方模块所在目录往上，第一个有 `package.json` 的目录就是应用的包根。
 * 打包后服务端代码在 `<包>/server/`，从源码运行时在 `<包>/src/...` 或 `<包>/dist/...`，往上都先碰到应用自己的包根，不会越过它
 * 找到外层项目的。中间目录是链接（`bun link`、全局安装）时 `import.meta.dir` 已是真实路径。
 */

import {existsSync} from "node:fs";
import {dirname, join} from "node:path";

/** `from` 往上第一个有 `package.json` 的目录；到文件系统根都没有为 null。 */
export function packageRootOf(from: string): string | null {
    for (let directory = from; ; directory = dirname(directory)) {
        if (existsSync(join(directory, "package.json"))) return directory;
        if (dirname(directory) === directory) return null;
    }
}
