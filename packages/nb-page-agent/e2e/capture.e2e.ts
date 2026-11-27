/** 截图（docs/specs/agent/page-agent.md 输出 8）：JPEG、长边至多上限、编码后至多上限；元素截图只有元素那么大。 */

import {expect, test} from "@playwright/test";

import {openFixture} from "./page";

test("截视口与截一个元素：JPEG，长边与字节都不超过上限", async ({page}) => {
    await openFixture(page, `<div id="card" style="width:300px;height:120px;background:linear-gradient(90deg,#c33,#33c)">卡片</div>
        <div style="height:1200px;background:repeating-linear-gradient(0deg,#eee 0 10px,#999 10px 20px)"></div>`);
    const shots = await page.evaluate(async () => {
        const describe = async (target: Element | null, maxEdge: number, maxBytes: number) => {
            const shot = await window.nbPageAgent.capturePage(document, target, {maxEdge, maxBytes});
            const head = new Uint8Array(await shot.blob.slice(0, 3).arrayBuffer());
            return {width: shot.width, height: shot.height, bytes: shot.blob.size, type: shot.blob.type, magic: [...head]};
        };
        return {
            window: await describe(null, 640, 512 * 1024),
            element: await describe(document.getElementById("card"), 1280, 512 * 1024),
            tight: await describe(null, 1280, 20 * 1024),
        };
    });
    expect(shots.window).toMatchObject({width: 640, height: 400, type: "image/jpeg", magic: [0xff, 0xd8, 0xff]});
    expect(shots.element).toMatchObject({width: 300, height: 120, type: "image/jpeg"});
    expect(shots.tight.bytes).toBeLessThanOrEqual(20 * 1024);
    expect(Math.max(shots.tight.width, shots.tight.height)).toBeLessThanOrEqual(1280);
});
