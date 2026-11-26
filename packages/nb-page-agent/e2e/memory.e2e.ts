/** 引用记录不拉住关掉的弹层（docs/specs/agent/page-agent.md 输出 4 的引用寿命）：要 `gc()`，单独一个文件、单独起浏览器。 */

import {expect, test} from "@playwright/test";

import {openFixture} from "./page";

test.use({launchOptions: {args: ["--js-flags=--expose-gc"]}});

test("快照取过引用的对话框关掉后可以被回收", async ({page}) => {
    await openFixture(page, "");
    const alive = await page.evaluate(async () => {
        const refs: Array<WeakRef<Element>> = [];
        for (let round = 0; round < 20; round += 1) {
            const dialog = document.createElement("div");
            dialog.setAttribute("role", "dialog");
            dialog.setAttribute("aria-label", `对话框 ${String(round)}`);
            dialog.innerHTML = `<button>关闭</button>${"<p>正文</p>".repeat(50)}`;
            document.body.append(dialog);
            window.agent.snapshot();
            dialog.remove();
            refs.push(new WeakRef(dialog));
        }
        const gc = (globalThis as {gc?: () => void}).gc!;
        for (let round = 0; round < 3; round += 1) {
            gc();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return refs.filter((ref) => ref.deref() !== undefined).length;
    });
    expect(alive).toBeLessThanOrEqual(1);
});
