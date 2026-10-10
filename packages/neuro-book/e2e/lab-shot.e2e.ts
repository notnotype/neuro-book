/**
 * ui.component-lab 场景 14 在真实浏览器中的验收：舞台测量 `__nbLab.measure()` 与截图命令 `bun run lab:shot`
 * （Node 运行），对着真实的 `bun run dev`。越界判定依赖真实布局，只能在浏览器里测。
 */

import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugApi, LabStageMeasure} from "nbook/plugins/lab/shared/debug-api";

import {PACKAGE_ROOT, startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-shot");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function labShot(args: string[]): Promise<{code: number | null; output: string}> {
    const child = spawn("node", [join("scripts", "lab-shot.ts"), "--url", dev.pageUrl, ...args], {cwd: PACKAGE_ROOT});
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
    });
    return new Promise((resolve) => child.on("exit", (code) => resolve({code, output})));
}

interface ReportEntry {
    readonly file: string;
    readonly measure: LabStageMeasure | null;
    readonly problems: string[];
}

test("measure 报出越出舞台、没有被滚动容器挡住的元素；看不见的元素（透明、隐藏、视觉隐藏）不算", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=SkillChip&s=skill`);
    await expect.poll(() => page.evaluate(() => (window as unknown as {__nbLab?: LabDebugApi}).__nbLab?.state().ready ?? false)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as {__nbLab: LabDebugApi}).__nbLab.measure()?.offenders)).toEqual([]);
    const measure = await page.evaluate(() => {
        const stage = document.querySelector("[data-lab-stage]") as HTMLElement;
        const wide = () => Object.assign(document.createElement("div"), {style: "width: 4000px; height: 4px"});
        const scroller = Object.assign(document.createElement("div"), {style: "overflow-x: auto"});
        scroller.append(wide());
        const hidden = ["opacity: 0", "visibility: hidden", "position: absolute; clip: rect(0 0 0 0)", "position: absolute; clip-path: inset(50%)"]
            .map((style) => Object.assign(document.createElement("div"), {style: `${style}; width: 4000px; height: 4px`}));
        stage.append(wide(), scroller, ...hidden);
        return (window as unknown as {__nbLab: LabDebugApi}).__nbLab.measure();
    });
    expect(measure?.overflowX).toBeGreaterThan(0);
    expect(measure?.offenders).toHaveLength(1);
});

test("lab:shot：正常的场景截图并写报告，以 0 退出；舞台有越界元素时在报告里列出并以 1 退出", async () => {
    const okDir = join(tmp, "shot-ok");
    const ok = await labShot(["-c", "SkillChip", "-s", "skill", "--vp", "phone", "--out", okDir]);
    expect(ok.code, ok.output).toBe(0);
    const okReport = JSON.parse(await readFile(join(okDir, "report.json"), "utf8")) as ReportEntry[];
    expect(okReport).toHaveLength(1);
    expect(okReport[0]).toMatchObject({problems: [], measure: {overflowX: 0, offenders: []}});
    expect(existsSync(okReport[0]?.file ?? "")).toBe(true);

    // 120 px 宽的画布放不下 FixtureExample 的卡片。
    const badDir = join(tmp, "shot-overflow");
    const bad = await labShot(["-c", "FixtureExample", "-s", "disabled", "--vp", "120x400", "--out", badDir]);
    expect(bad.code, bad.output).toBe(1);
    const badReport = JSON.parse(await readFile(join(badDir, "report.json"), "utf8")) as ReportEntry[];
    expect(badReport[0]?.measure?.offenders.length).toBeGreaterThan(0);
});
