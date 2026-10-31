/**
 * 网页包（`dist/web`）的构建记录与新旧检查（docs/specs/story/cli-skill.md 输出 5，issue 267）。
 *
 * 从源码运行 `nbstory serve` 时，网页用的是事先打好的包，源码更新后没有重打就是旧的，页面上没有任何迹象。构建时
 * （`vite.config.ts` 里的插件）把打进包的源码文件各记一个内容摘要，写成 `dist/web/build-stamp.json`；`serve` 启动时
 * 按同一份清单重算，对不上就在标准错误提示。
 *
 * 记录的是实际进了包的模块，不是 `src/web` 一个目录：包里还有 `src/contract` 和工作区里其它包（nb-ui、nb-agent-ui……）
 * 的源码，它们改了网页同样是旧的。路径相对 nb-story 的包目录，所以对得上的前提是工作区的目录结构没变。
 * 只记内容摘要不比修改时间：拉代码、切分支会改修改时间而内容不变。
 *
 * 只在从源码运行时检查（调用方判断，见 `serve.ts`）：npm 发的包里没有 `src/web`，打包用的工作区文件也不在了。
 */

import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {join, relative, sep} from "node:path";

export const STAMP_FILE = "build-stamp.json";

interface WebStamp {
    version: 1;
    /** 打包的时刻（ISO），提示里写给人看。 */
    builtAt: string;
    /** 源文件（相对包目录，用 `/` 分隔）→ 内容的 SHA-1。 */
    files: Record<string, string>;
}

export type WebFreshness =
    | {state: "unbuilt"}
    | {state: "no-stamp"}
    | {state: "fresh"}
    | {state: "stale"; builtAt: string; changed: string[]};

async function digest(path: string): Promise<string | null> {
    try {
        return createHash("sha1").update(await readFile(path)).digest("hex");
    } catch (error) {
        // 文件没了（改名、删除）算和记录不一致；其它读不了的原因（权限等）也只能当作不一致，提示里会列出这个文件。
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn({path, error}, "读源文件算摘要失败");
        return null;
    }
}

/**
 * 构建结束时写记录。`ids` 是打包过程中见到的模块 id：去掉查询串（Vue 单文件组件的子模块带 `?vue&type=…`）、虚拟模块
 * （`\0` 开头）和 node_modules 里的依赖（它们随版本号变，不随源码变）。
 */
export async function writeWebStamp(webRoot: string, packageRoot: string, ids: Iterable<string>): Promise<void> {
    const paths = new Set<string>();
    for (const id of ids) {
        const path = id.split("?")[0]!;
        if (path.startsWith("\0") || path.includes("/node_modules/") || path.includes("\\node_modules\\")) continue;
        paths.add(path);
    }
    const files: Record<string, string> = {};
    for (const path of [...paths].sort()) {
        const hash = await digest(path);
        if (hash !== null) files[relative(packageRoot, path).split(sep).join("/")] = hash;
    }
    const stamp: WebStamp = {version: 1, builtAt: new Date().toISOString(), files};
    await writeFile(join(webRoot, STAMP_FILE), JSON.stringify(stamp, null, 1));
}

/** 对照记录检查网页包：记录里的源文件内容变了或不见了，就是比源码旧。 */
export async function checkWebFreshness(webRoot: string, packageRoot: string): Promise<WebFreshness> {
    let raw: string;
    try {
        raw = await readFile(join(webRoot, STAMP_FILE), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // 有包没记录是早先版本打的包；连 index.html 都没有就是还没打过包（页面上另有提示）。
        return (await digest(join(webRoot, "index.html"))) === null ? {state: "unbuilt"} : {state: "no-stamp"};
    }
    const stamp = JSON.parse(raw) as WebStamp;
    const changed: string[] = [];
    for (const [file, hash] of Object.entries(stamp.files)) {
        if ((await digest(join(packageRoot, file))) !== hash) changed.push(file);
    }
    return changed.length === 0 ? {state: "fresh"} : {state: "stale", builtAt: stamp.builtAt, changed};
}
