/**
 * 开发命令在真实浏览器中的验收（runtime.server-host 场景 7、8）：真实的 `src/server/dev/main.ts`、Vite 与后端。
 * 后端改动用后端入口文件的 mtime 触发（内容不变），结束后恢复原 mtime；恢复本身也是一次改动，会再重启一次。
 */

import {statSync, utimesSync} from "node:fs";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PACKAGE_ROOT, startDevSession} from "./fixtures";

/** `[dev]` 行里后端启动与退出的先后：每次启动之前，上一个后端都已退出。 */
function backendSequence(output: string): string[] {
    return output.split("\n").flatMap((line) => {
        const match = /^\[dev\] (backend-starting|backend-exited)/u.exec(line);
        return match ? [match[1] as string] : [];
    });
}

test("开发命令：页面是空工作台、直连后端 RPC 端口，/lab 是 Lab；改后端文件后有序重启，已打开的页面显示服务端已重启、刷新后重新引导成功；SIGTERM 先停后端再关页面，以 0 退出", async ({page}) => {
    const tmp = await createTestTmpRoot("neuro-book-e2e", "dev-session");
    const dev = await startDevSession(join(tmp, "state"));
    const entry = join(PACKAGE_ROOT, "src", "server", "main.ts");
    const original = statSync(entry);
    try {
        await page.goto(`${dev.pageUrl}lab`);
        await expect(page.locator("[data-lab-page]")).toHaveAttribute("data-window-state", "ready");
        await page.goto(dev.pageUrl);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        // 页面经引导接口得知后端的 RPC 端口并直连，不经 Vite 代理。
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");

        const now = new Date();
        utimesSync(entry, now, now);
        await dev.waitFor(/(?:\[dev\] backend-ready[\s\S]*){2}/u);
        // 后端重启对已打开的页面就是服务端重启：页面不自动刷新，显示服务端已重启页。
        await expect(page.locator("[data-browser-host-status]")).toHaveAttribute("data-browser-host-status", "server-restarted");
        utimesSync(entry, original.atime, original.mtime);
        await dev.waitFor(/(?:\[dev\] backend-ready[\s\S]*){3}/u);
        await page.reload();
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");

        dev.child.kill("SIGTERM");
        expect(await dev.exit).toBe(0);
        const output = dev.output();
        expect(backendSequence(output)).toEqual(["backend-starting", "backend-exited", "backend-starting", "backend-exited", "backend-starting", "backend-exited"]);
        const stopping = output.indexOf("[dev] stopping");
        expect(stopping).toBeGreaterThan(-1);
        expect(output.indexOf("[dev] backend-stopped", stopping)).toBeLessThan(output.indexOf("[dev] page-closed", stopping));
    } finally {
        utimesSync(entry, original.atime, original.mtime);
        if (dev.child.exitCode === null) dev.child.kill("SIGKILL");
        await rm(tmp, {recursive: true, force: true});
    }
});
