/**
 * 后端文件的监视：本包的 `src/` 与后端运行依赖的 workspace 包源码（例如 nb-runtime）。前端文件由 Vite 热更新，
 * 不触发后端重启；监督进程自己的代码（`server/dev/`）改了要手动重启开发命令。
 */

import {existsSync, readFileSync, realpathSync, watch} from "node:fs";
import {dirname, join, sep} from "node:path";

/** `path` 相对监视根；只有 `.ts`、`.json`，排除前端（`web/` 与共享前端组件 `ui/`）、测试、测试支持与监督进程自身。 */
export function isBackendFile(path: string): boolean {
    const normalized = path.split(sep).join("/");
    if (!/\.(ts|json)$/u.test(normalized) || normalized.endsWith(".test.ts")) return false;
    const segments = normalized.split("/");
    if (segments.includes("web") || segments.includes("testing")) return false;
    return !normalized.startsWith("server/dev/") && !normalized.startsWith("ui/");
}

/**
 * 监视根：`<包>/src`，以及 `package.json` 里每个 `workspace:` 运行依赖的 `src`（经 node_modules 的链接找到真实目录）。
 * 新增 workspace 运行依赖时自动纳入，不用改这里。
 */
export function backendWatchRoots(packageRoot: string): string[] {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {dependencies?: Record<string, string>};
    const roots = [join(packageRoot, "src")];
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
        if (!version.startsWith("workspace:")) continue;
        const linked = findLinkedPackage(packageRoot, name);
        if (linked === null) throw new Error(`找不到 workspace 依赖 ${name} 的目录；先运行 bun install`);
        roots.push(existsSync(join(linked, "src")) ? join(linked, "src") : linked);
    }
    return roots;
}

function findLinkedPackage(from: string, name: string): string | null {
    let directory = from;
    for (;;) {
        const candidate = join(directory, "node_modules", name);
        if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
        const parent = dirname(directory);
        if (parent === directory) return null;
        directory = parent;
    }
}

export interface BackendWatcher {
    close(): void;
}

export function watchBackendFiles(roots: ReadonlyArray<string>, onChange: (path: string) => void): BackendWatcher {
    const watchers = roots.map((root) => watch(root, {recursive: true}, (_event, file) => {
        if (file !== null && isBackendFile(file)) onChange(join(root, file));
    }));
    return {
        close() {
            for (const watcher of watchers) watcher.close();
        },
    };
}
