import {open} from "node:fs/promises";

/** Windows PowerShell 5.1 把无 BOM 的 UTF-8 脚本按 ANSI 读取，中文注释会破坏
 * 语法导致整个安装引导失败；发行 .ps1 必须带 UTF-8 BOM（EF BB BF），否则 fail closed。 */
export async function assertPowerShellBom(path: string): Promise<void> {
    if (!path.toLowerCase().endsWith(".ps1")) return;
    const handle = await open(path, "r");
    try {
        const head = Buffer.alloc(3);
        const {bytesRead} = await handle.read(head, 0, 3, 0);
        if (bytesRead < 3 || head[0] !== 0xef || head[1] !== 0xbb || head[2] !== 0xbf) {
            throw new Error(`发行 PowerShell 脚本必须带 UTF-8 BOM（EF BB BF）：${path}`);
        }
    } finally {
        await handle.close();
    }
}
