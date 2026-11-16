/**
 * 场景 9：插件带 Skill（`skill-pack`）。
 *
 * 要说明的事：
 * - 插件经顶层贡献 `agent.skills` 声明一个目录，里面每个子文件夹是一个 Skill；不用入口，也不用激活。
 * - `nbooke build` 把这个目录搬进产物，脚本连同它用到的 npm 包（这里是 `yaml`）各打成一个单文件，写回同一个路径；
 *   `package.json`、锁文件与 `node_modules` 不带。所以装好之后，在没有 `node_modules` 的安装目录里脚本照样能跑，
 *   Skill 不用初始化。
 * - 打不进单文件的写法（原生模块、按自己的位置读文件的包、入口里的 `__dirname`）让构建失败，见 `build-plugin.test.ts`
 *   的 “Skill（agent.skills）”。
 *
 * 阅读顺序：`plugins/skill-pack/plugin.ts` → `skills/word-count/SKILL.md` → `skills/word-count/scripts/count.ts` → 这里。
 *
 * 行为合同：docs/specs/agent/skills.md（输出 30–32）、docs/specs/runtime/plugin-api.md 的“作者工具”。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {cp, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {buildExample} from "../../build-examples";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例场景 9：插件带 Skill");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("场景 9：插件带 Skill", () => {
    it("构建后清单只有一条 agent.skills 贡献；Skill 的脚本打成单文件，在没有 node_modules 的地方照样能跑", async () => {
        const out = join(tmp, "dist");
        const result = await buildExample("skill-pack", out);
        expect(result.manifest.contributes).toEqual([{capability: "agent.skills", id: "example.skill-pack.skills", declaration: {directory: "skills"}}]);
        expect(result.files.filter((file) => file.startsWith("skills/"))).toEqual(["skills/word-count/SKILL.md", "skills/word-count/scripts/count.ts"]);

        // 像装好之后那样：只有这个 Skill 的文件，旁边没有 node_modules。
        const installed = join(tmp, "installed", "word-count");
        await cp(join(out, "skills", "word-count"), installed, {recursive: true});
        expect((await readdir(installed)).sort()).toEqual(["SKILL.md", "scripts"]);
        await writeFile(join(tmp, "第一章.md"), "---\ntitle: 雾港\n---\n\n雾很大。码头上没有人。\n");
        const run = Bun.spawn(["bun", "scripts/count.ts", join(tmp, "第一章.md")], {cwd: installed, stdout: "pipe", stderr: "pipe"});
        expect([await run.exited, JSON.parse(await new Response(run.stdout).text())]).toEqual([0, {title: "雾港", characters: 9}]);
    }, 60_000);
});
