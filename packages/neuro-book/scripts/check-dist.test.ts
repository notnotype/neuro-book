/**
 * 生产产物检查：用临时目录里的合成产物验证判定，真实产物由 `bun run build` 的最后一步检查。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {scanDist} from "./check-dist";

let tmp = "";
let sequence = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-dist", "check-dist");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function dist(files: Record<string, string>): Promise<string> {
    sequence += 1;
    const root = join(tmp, `dist-${String(sequence)}`);
    for (const [path, text] of Object.entries(files)) {
        await mkdir(join(root, path, ".."), {recursive: true});
        await writeFile(join(root, path), text);
    }
    return root;
}

const product = {
    "web/index.html": "<div id=app></div>",
    "web/assets/index-abc.js": "const a = \"nbook.workbench\"; h(\"main\", {\"data-workbench-root\": \"\"});",
    "server/main.js": "const id = \"nbook.http\"; console.log(`Listening on ${url}`);",
};

describe("生产产物检查", () => {
    it("只有产品代码时通过", async () => {
        expect(await scanDist(await dist(product), ["/home/someone/repo"])).toEqual({forbidden: [], missing: []});
    });

    it("查出开发插件的代码与本机路径，报出所在文件", async () => {
        const root = await dist({...product, "web/assets/lab-xyz.js": "export default {id: \"nbook.lab\"};", "server/main.js": `${product["server/main.js"]} "/home/someone/repo/src"`});
        expect((await scanDist(root, ["/home/someone/repo"])).forbidden).toEqual(["web/assets/lab-xyz.js: nbook.lab", "server/main.js: /home/someone/repo"]);
    });

    it("缺少产品标记时报告，扫描空目录或别处的输出不会误判通过", async () => {
        const root = await dist({"web/index.html": "", "server/main.js": "Listening on"});
        expect((await scanDist(root, [])).missing).toEqual(["web: nbook.workbench", "web: data-workbench-root", "server: nbook.http"]);
    });
});
