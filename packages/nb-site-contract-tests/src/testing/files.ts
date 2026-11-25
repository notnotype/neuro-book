/**
 * 在数据目录的文件里找一个串：给“某样东西不留在库里”的断言用（来源地址、Cookie 不进库，`site.telemetry-ingest` 输出 8）。
 * 只依赖 `site.operations` 写明的数据目录布局（库文件与它的 `-wal`、`-shm`、锁文件、备份目录），按字节找，不打开库、
 * 不读被测模块的表：换一种实现或换一种存储时，这里照样能用。不含断言。
 */

import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

/** `dataDir` 下（含子目录）字节里含有 `needle`（按 UTF-8 编码）的文件，写成相对 `dataDir` 的路径，按名字排序。 */
export function dataFilesContaining(dataDir: string, needle: string): string[] {
    const bytes = Buffer.from(needle, "utf8");
    return readdirSync(dataDir, {withFileTypes: true, recursive: true})
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .filter((file) => readFileSync(file).includes(bytes))
        .map((file) => relative(dataDir, file))
        .sort();
}
