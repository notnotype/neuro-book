/**
 * 后端文件监视：哪些改动触发后端重启、监视根从哪里来，以及真实 fs.watch 的递归监视（含新建子目录与改名保存）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rename, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {backendWatchRoots, isBackendFile, watchBackendFiles} from "./watch";

const PACKAGE_ROOT = resolve(import.meta.dir, "../../..");
let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-dev", "dev-watch");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("后端文件监视", () => {
    it("后端代码、共用合同与插件描述触发重启；前端、测试、测试支持、监督进程自身与非代码文件不触发", () => {
        for (const path of ["server/start.ts", "plugins/http/backend/dispatch.ts", "plugins/workbench/plugin.ts", "shared/browser-bootstrap.ts", "manifest.ts", "lifecycle/scope.ts", "data/table.json"]) {
            expect(isBackendFile(path)).toBe(true);
        }
        for (const path of ["web/App.vue", "web/host/window.ts", "plugins/workbench/web/plugin.ts", "server/start.test.ts", "server/testing/fixture-entry.ts", "server/dev/run.ts", "ui/theme/install-theme-packs.ts", "README.md", "server/.start.ts.swp"]) {
            expect(isBackendFile(path)).toBe(false);
        }
    });

    it("监视本包 src 与后端用到的 workspace 包源码", () => {
        expect(backendWatchRoots(PACKAGE_ROOT)).toEqual([join(PACKAGE_ROOT, "src"), resolve(PACKAGE_ROOT, "../nb-runtime/src")]);
    });

    it("递归监视：嵌套目录、新建的子目录与改名保存都报出后端文件，前端文件不报", async () => {
        const root = join(tmp, "src");
        await mkdir(join(root, "server"), {recursive: true});
        const changes: string[] = [];
        const watcher = watchBackendFiles([root], (path) => changes.push(path));
        try {
            await writeFile(join(root, "server", "start.ts"), "1");
            await waitUntil("嵌套文件的改动", () => changes.includes(join(root, "server", "start.ts")));

            await mkdir(join(root, "web"), {recursive: true});
            await writeFile(join(root, "web", "main.ts"), "1");
            await mkdir(join(root, "plugins", "files", "server"), {recursive: true});
            await writeFile(join(root, "plugins", "files", "server", "plugin.ts"), "1");
            await waitUntil("新建子目录里的文件", () => changes.includes(join(root, "plugins", "files", "server", "plugin.ts")));

            await writeFile(join(root, "server", ".start.ts.tmp"), "2");
            await rename(join(root, "server", ".start.ts.tmp"), join(root, "server", "start.ts"));
            await waitUntil("改名保存", () => changes.filter((path) => path === join(root, "server", "start.ts")).length >= 2);
            expect(changes.some((path) => path.includes(`${join(root, "web")}`) || path.endsWith(".tmp"))).toBe(false);
        } finally {
            watcher.close();
        }
    });
});
