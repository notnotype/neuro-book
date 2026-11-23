/**
 * 插件 SDK 转出的 nb-layout 名字的签名快照（w00026 t48；口径见 docs/specs/runtime/plugin-code-loading.md 的“共享入口即兼容承诺”）。
 *
 * nb-layout 的名字在它那边标 `@experimental`，0.x 期间会变；SDK 照样用兼容起点保护它们：签名发生不兼容改动就要提
 * `PLUGIN_API_SINCE`。nb-layout 的 API 报告看不出哪些改动落在 SDK 转出的子集里，这份快照专门看这个子集：从 SDK 转出的名字
 * 出发，沿 nb-layout 报告里每段的“引用”行取闭包，把这些段按名字排序拼起来。`sdk.test.ts` 比它与入库的
 * `src/sdk/nb-layout-surface.txt`；不同时判断是不是不兼容，再 `bun scripts/nb-layout-surface.ts --write` 重写。
 *
 * 读的是 nb-layout 入库的报告（按仓库路径读文本），不导入它的脚本。闭包也走进“由公开名字引到、没有导出的声明”：SDK 转出的
 * 名字经签名引到它们，它们变了同样是 SDK 看得见的改动。
 */

import {readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const API_DIR = join(packageRoot, "../nb-layout/api");
export const SNAPSHOT = join(packageRoot, "src/sdk/nb-layout-surface.txt");

/** `components.ts` 里从 nb-layout 两个入口转出的名字。 */
export function sdkLayoutNames(componentsSource: string): string[] {
    const names = new Set<string>();
    for (const match of componentsSource.matchAll(/export (?:type )?\{([^}]*)\} from "@notnotype\/nb-layout(?:\/vue)?";/gu)) {
        for (const item of match[1]!.split(",")) {
            const name = item.trim().split(/\s+as\s+/u)[0];
            if (name) names.add(name);
        }
    }
    return [...names].sort();
}

/** 报告里按名字的段与它的“引用”。 */
function segments(report: string): Map<string, {readonly text: string; readonly references: readonly string[]}> {
    const result = new Map<string, {text: string; references: string[]}>();
    let current: {name: string; lines: string[]} | null = null;
    const flush = () => {
        if (current === null) return;
        const list = (prefix: string) => current!.lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).split(", ") ?? [];
        const references = [...list("引用："), ...list("引用（没导出）：")];
        result.set(current.name, {text: current.lines.join("\n").trimEnd(), references});
    };
    for (const line of report.split("\n")) {
        if (line.startsWith("// tool ")) continue;
        // 公开名字的段是 `### <标注> <种类> <名字>`，没导出的是 `### <种类> <名字>`：都取最后一个词作名字。
        const head = line.startsWith("### ") ? line.replace(/ @deprecated$/u, "").split(" ").at(-1) : undefined;
        if (head !== undefined) {
            flush();
            current = {name: head, lines: [line]};
        } else if (line.startsWith("## ")) {
            flush();
            current = null;
        } else if (current !== null) {
            current.lines.push(line);
        }
    }
    flush();
    return result;
}

export async function nbLayoutSurface(): Promise<string> {
    const apiDir = API_DIR;
    const all = new Map<string, {readonly text: string; readonly references: readonly string[]}>();
    for (const file of (await readdir(apiDir)).filter((name) => name.endsWith(".api.txt")).sort()) {
        for (const [name, segment] of segments(await readFile(join(apiDir, file), "utf8"))) if (!all.has(name)) all.set(name, segment);
    }
    const roots = sdkLayoutNames(await readFile(join(packageRoot, "src/sdk/components.ts"), "utf8"));
    const missing = roots.filter((name) => !all.has(name));
    if (missing.length > 0) throw new Error(`SDK re-exports names that the nb-layout API reports do not have: ${missing.join(", ")}`);
    const reached = new Set<string>();
    const pending = [...roots];
    while (pending.length > 0) {
        const name = pending.pop()!;
        if (reached.has(name)) continue;
        reached.add(name);
        pending.push(...(all.get(name)?.references ?? []));
    }
    const names = [...reached].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `${["// 插件 SDK 转出的 nb-layout 名字与它们引到的名字，取自 nb-layout 的 api/*.api.txt（bun scripts/nb-layout-surface.ts --write 生成，不手改）", "", ...names.map((name) => `${all.get(name)!.text}\n`)].join("\n").trimEnd()}\n`;
}

/** 两份快照之间变了的名字（段的文字不同、或只在一边有）。 */
export function changedNames(before: string, after: string): string[] {
    const old = segments(before);
    const next = segments(after);
    return [...new Set([...old.keys(), ...next.keys()])].filter((name) => old.get(name)?.text !== next.get(name)?.text).sort();
}

if (import.meta.main) {
    const text = await nbLayoutSurface();
    if (process.argv.includes("--write")) {
        await writeFile(SNAPSHOT, text);
        console.log(`wrote ${SNAPSHOT}`);
    } else {
        process.stdout.write(text);
    }
}
