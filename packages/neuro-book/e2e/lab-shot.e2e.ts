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

import {failedShots} from "../scripts/lab-shot";
import type {ShotResult} from "../scripts/lab-shot";

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

test("measure 报出聚焦光晕会被裁的元素：按样式表的焦点规则找，环画在外框上的按外框算；不可聚焦元素上直接写的 :focus-visible 与离边够远的不算", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=SkillChip&s=skill`);
    await expect.poll(() => page.evaluate(() => (window as unknown as {__nbLab?: LabDebugApi}).__nbLab?.state().ready ?? false)).toBe(true);
    const clipped = await page.evaluate(() => {
        const style = document.head.appendChild(document.createElement("style"));
        style.textContent = [
            ".probe-ring:focus-visible { box-shadow: 0 0 0 4px red; }",
            ".probe-shell:has(> .probe-inner:focus-visible) { box-shadow: 0 0 0 4px red; }",
            "button.probe-plain:hover, .probe-frame:focus-visible { box-shadow: 0 0 0 4px red; }",
        ].join("\n");
        const element = (tag: string, props: Record<string, unknown>, ...children: HTMLElement[]): HTMLElement => {
            const node = Object.assign(document.createElement(tag), props);
            node.append(...children);
            return node;
        };
        // 每个探针贴着一个 overflow hidden 的盒子的边，逐个放进舞台各测一次；roomy 留了 12px 内距作对照。
        const tight = (child: HTMLElement) => element("div", {style: "overflow: hidden"}, child);
        const probes: Record<string, () => HTMLElement> = {
            base: () => element("div", {}),
            own: () => tight(element("button", {className: "probe-ring", textContent: "own"})),
            shell: () => tight(element("div", {className: "probe-shell"}, element("div", {className: "probe-inner", tabIndex: 0, textContent: "shell"}))),
            frame: () => tight(element("div", {className: "probe-frame"}, element("button", {className: "probe-plain", textContent: "frame"}))),
            roomy: () => element("div", {style: "overflow: hidden; padding: 12px"}, element("button", {className: "probe-ring", textContent: "roomy"})),
            // 离边 5px：主题焦点环的实色部分（3.5px）不被裁，只有外圈的模糊光被切掉一截，看不出来，不报。
            near: () => element("div", {style: "overflow: hidden; padding: 5px"}, element("button", {className: "probe-ring", textContent: "near"})),
        };
        const stage = document.querySelector("[data-lab-stage]") as HTMLElement;
        const counts: Record<string, number> = {};
        for (const [name, make] of Object.entries(probes)) {
            const probe = make();
            stage.append(probe);
            counts[name] = (window as unknown as {__nbLab: LabDebugApi}).__nbLab.measure()?.clippedFocus.length ?? -1;
            probe.remove();
        }
        return counts;
    });
    expect(clipped).toEqual({base: 0, own: 1, shell: 1, frame: 0, roomy: 0, near: 0});
});

test("焦点规则只画内阴影（内嵌焦点线）的贴边按钮不算光晕被裁；画外阴影的、内阴影混着 var() 外阴影的、outline 简写用 var() 的照报（验收 29、30）", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=SkillChip&s=skill`);
    await expect.poll(() => page.evaluate(() => (window as unknown as {__nbLab?: LabDebugApi}).__nbLab?.state().ready ?? false)).toBe(true);
    const clipped = await page.evaluate(() => {
        const style = document.head.appendChild(document.createElement("style"));
        style.textContent = [
            ".probe-inset:focus-visible { box-shadow: inset 0 0 0 1.5px red; }",
            ".probe-outer:focus-visible { box-shadow: 0 0 0 3.5px red; }",
            ".probe-mixed { --probe-outer: 0 0 0 3.5px red; } .probe-mixed:focus-visible { box-shadow: inset 0 0 0 1.5px blue, var(--probe-outer); }",
            ".probe-outline { --probe-outline: 3px solid red; } .probe-outline:focus-visible { outline: var(--probe-outline); }",
        ].join("\n");
        const stage = document.querySelector("[data-lab-stage]") as HTMLElement;
        const counts: Record<string, number> = {};
        for (const name of ["probe-inset", "probe-outer", "probe-mixed", "probe-outline"]) {
            const box = Object.assign(document.createElement("div"), {style: "overflow: hidden"});
            box.append(Object.assign(document.createElement("button"), {className: name, textContent: name}));
            stage.append(box);
            counts[name] = (window as unknown as {__nbLab: LabDebugApi}).__nbLab.measure()?.clippedFocus.length ?? -1;
            box.remove();
        }
        return counts;
    });
    expect(clipped).toEqual({"probe-inset": 0, "probe-outer": 1, "probe-mixed": 1, "probe-outline": 1});
});

test("聚焦光晕按当前主题焦点环的实色扩散量算：editorial 3px、nbook 3.5px、aurora 4px（验收 28）", async ({page}) => {
    const measured: Record<string, Record<string, number>> = {};
    for (const theme of ["editorial", "nbook", "aurora"]) {
        await page.goto(`${dev.pageUrl}lab?c=SkillChip&s=skill&theme=${theme}`);
        await expect.poll(() => page.evaluate(() => (window as unknown as {__nbLab?: LabDebugApi}).__nbLab?.state().ready ?? false)).toBe(true);
        measured[theme] = await page.evaluate(() => {
            const style = document.head.appendChild(document.createElement("style"));
            style.textContent = ".probe-ring:focus-visible { box-shadow: var(--focus-ring); }";
            const stage = document.querySelector("[data-lab-stage]") as HTMLElement;
            const counts: Record<string, number> = {};
            // 主题 token 原样写着无单位的 0 与 `color-mix(…, transparent)`：读不懂时会退回 3.5px，三套主题就分不出来。
            for (const padding of ["3.25px", "3.75px"]) {
                const box = Object.assign(document.createElement("div"), {style: `overflow: hidden; padding: ${padding}`});
                box.append(Object.assign(document.createElement("button"), {className: "probe-ring", textContent: padding}));
                stage.append(box);
                counts[padding] = (window as unknown as {__nbLab: LabDebugApi}).__nbLab.measure()?.clippedFocus.length ?? -1;
                box.remove();
            }
            return counts;
        });
    }
    expect(measured).toEqual({
        "editorial": {"3.25px": 0, "3.75px": 0},
        "nbook": {"3.25px": 1, "3.75px": 0},
        "aurora": {"3.25px": 1, "3.75px": 1},
    });
});

test("measure 报出现在画着的外扩环会被裁的元素：不偏移的外阴影与 outline 算，偏移投影与离边够远的不算；画布上的对话框也量（验收 26）", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=SkillChip&s=skill`);
    await expect.poll(() => page.evaluate(() => (window as unknown as {__nbLab?: LabDebugApi}).__nbLab?.state().ready ?? false)).toBe(true);
    const rings = await page.evaluate(() => {
        const ringed = (style: string, padding = "0"): HTMLElement => {
            const box = Object.assign(document.createElement("div"), {style: `overflow: hidden; padding: ${padding}`});
            box.append(Object.assign(document.createElement("div"), {style: `${style}; height: 20px`}));
            return box;
        };
        const probes: Record<string, () => HTMLElement> = {
            ring: () => ringed("box-shadow: 0 0 0 2px white, 0 0 0 3.5px black"),
            outline: () => ringed("outline: 2px solid red; outline-offset: 1px"),
            lifted: () => ringed("box-shadow: 0 8px 24px -4px rgb(0 0 0 / 0.3)"),
            roomy: () => ringed("box-shadow: 0 0 0 3.5px black", "12px"),
        };
        const stage = document.querySelector("[data-lab-stage]") as HTMLElement;
        const counts: Record<string, number> = {};
        for (const [name, make] of Object.entries(probes)) {
            const probe = make();
            stage.append(probe);
            counts[name] = (window as unknown as {__nbLab: LabDebugApi}).__nbLab.measure()?.clippedRings.length ?? -1;
            probe.remove();
        }
        return counts;
    });
    expect(rings).toEqual({ring: 1, outline: 1, lifted: 0, roomy: 0});

    // 无限旋转的元素：外框随角度变，转到斜着时比舞台宽，不算越界；同样宽、静止的算。
    const looping = await page.evaluate(() => {
        const api = (window as unknown as {__nbLab: LabDebugApi}).__nbLab;
        const stage = document.querySelector("[data-lab-stage]") as HTMLElement;
        const size = `width: ${String(stage.clientWidth - 2)}px; height: ${String(stage.clientWidth - 2)}px`;
        const spinner = Object.assign(document.createElement("div"), {style: size});
        stage.append(spinner);
        spinner.animate([{transform: "rotate(45deg)"}, {transform: "rotate(405deg)"}], {duration: 1000, iterations: Infinity});
        const spinning = api.measure()?.offenders.length;
        spinner.getAnimations().forEach((animation) => animation.cancel());
        spinner.style.transform = "rotate(45deg)";
        const still = api.measure()?.offenders.length;
        spinner.remove();
        return {spinning, still};
    });
    expect(looping).toEqual({spinning: 0, still: 1});

    // 对话框传送到画布的浮层落点，不在舞台里：同样要量到。
    await page.goto(`${dev.pageUrl}lab?c=Dialog&s=default`);
    await expect.poll(() => page.evaluate(() => (window as unknown as {__nbLab?: LabDebugApi}).__nbLab?.state().ready ?? false)).toBe(true);
    await expect(page.locator("[data-lab-overlay-root] [data-dialog-surface]")).toBeVisible();
    const dialog = await page.evaluate(() => {
        const api = (window as unknown as {__nbLab: LabDebugApi}).__nbLab;
        const before = api.measure();
        const tight = Object.assign(document.createElement("div"), {style: "overflow: hidden"});
        tight.append(Object.assign(document.createElement("div"), {style: "box-shadow: 0 0 0 3.5px black; height: 20px"}));
        document.querySelector("[data-dialog-surface] .nb-dialog__body")!.append(tight);
        const wide = Object.assign(document.createElement("div"), {style: "position: absolute; left: 0; top: 0; width: 4000px; height: 4px"});
        document.querySelector("[data-lab-overlay-root]")!.append(wide);
        const after = api.measure();
        return {before: [before?.clippedRings.length, before?.offenders.length], after: [after?.clippedRings.length, after?.offenders.length]};
    });
    expect(dialog).toEqual({before: [0, 0], after: [1, 1]});
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

test("measure 报出可点区域小于 24×24 又挤着别的目标的元素：够大的、离得够远的、label 补够的、句子里的链接不算（只报告）", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=SkillChip&s=skill`);
    await expect.poll(() => page.evaluate(() => (window as unknown as {__nbLab?: LabDebugApi}).__nbLab?.state().ready ?? false)).toBe(true);
    const reported = await page.evaluate(() => {
        const stage = document.querySelector("[data-lab-stage]") as HTMLElement;
        const box = Object.assign(document.createElement("div"), {style: "position: relative; height: 200px"});
        const at = (left: number, top: number, size: number, name: string) => {
            // 选择器路径按 id 取，测量结果里认得出是哪一个；场景自己原有的目标不带这个前缀。
            const button = Object.assign(document.createElement("button"), {id: `probe-${name}`, style: `position: absolute; left: ${left}px; top: ${top}px; width: ${size}px; height: ${size}px; padding: 0; border: 0`});
            box.append(button);
        };
        at(0, 0, 14, "crowded-a");
        at(16, 0, 14, "crowded-b");
        at(100, 0, 14, "alone");
        at(0, 100, 24, "big");
        at(26, 100, 24, "big-neighbour");
        // 14×14 的复选框，label 把可点区域补到 24 以上。
        const label = Object.assign(document.createElement("label"), {style: "position: absolute; left: 0; top: 150px; display: inline-flex; gap: 4px; height: 28px; align-items: center"});
        label.append(Object.assign(document.createElement("input"), {id: "probe-labelled", type: "checkbox", style: "width: 14px; height: 14px; margin: 0"}), "收进书架");
        box.append(label);
        const sentence = Object.assign(document.createElement("p"), {style: "position: absolute; left: 160px; top: 0"});
        sentence.append("详见", Object.assign(document.createElement("a"), {id: "probe-inline", href: "#", textContent: "说明"}), "一节");
        box.append(sentence);
        stage.append(box);
        const measure = (window as unknown as {__nbLab: LabDebugApi}).__nbLab.measure();
        box.remove();
        return measure?.smallTargets.map((target) => /#probe-[\w-]+/u.exec(target.selector)?.[0]).filter((id) => id !== undefined).sort() ?? null;
    });
    expect(reported).toEqual(["#probe-crowded-a", "#probe-crowded-b"]);
});

test("lab:shot --media、--text-spacing：按偏好各截一组，报告写上偏好与加大文字间距后的量法；只报告的几项不改退出码", async () => {
    const dir = join(tmp, "shot-media");
    const run = await labShot(["-c", "SkillChip", "-s", "skill", "--vp", "phone", "--media", "reduced-motion,reduced-transparency", "--text-spacing", "--out", dir]);
    expect(run.code, run.output).toBe(0);
    const report = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as Array<ReportEntry & {media: string | null; mediaMatched: boolean | null; textSpacing: {clippedText: unknown[]} | null}>;
    expect(report.map((entry) => entry.media)).toEqual(["reduced-motion", "reduced-transparency"]);
    // 偏好在页面里真的生效，不只是写进了报告。
    expect(report.map((entry) => entry.mediaMatched)).toEqual([true, true]);
    for (const entry of report) {
        expect(existsSync(entry.file)).toBe(true);
        expect(entry.file).toContain(entry.media ?? "");
        expect(Array.isArray(entry.textSpacing?.clippedText)).toBe(true);
        expect(Array.isArray(entry.measure?.smallTargets)).toBe(true);
    }
});

test("只报告的几项（太小太挤的目标、被裁的文字、加大文字间距后的问题）不算失败；越界照旧算失败", () => {
    const measure = {box: {x: 0, y: 0, width: 100, height: 100}, overflowX: 0, offenders: [], clippedFocus: [], clippedRings: [], smallTargets: [], clippedText: []};
    const base: ShotResult = {component: "SkillChip", scene: "skill", viewport: "phone", colorway: null, media: null, mediaMatched: null, file: "", measure, textSpacing: null, problems: []};
    const entry = {selector: "button#probe", componentName: "Probe", overflow: 3};
    const reportOnly: ShotResult = {
        ...base,
        measure: {...measure, smallTargets: [{selector: "button#probe", componentName: "Probe", width: 14, height: 14}], clippedText: [entry]},
        textSpacing: {offenders: [entry], clippedText: [entry]},
    };
    expect(failedShots([reportOnly])).toEqual([]);
    expect(failedShots([{...base, measure: {...measure, offenders: [entry]}}])).toHaveLength(1);
});

test("减弱动效：位移换淡入淡出——浮层入场只剩透明度，按下缩放收掉，几项时长不同的过渡里透明度照常，对话框不从来处长出来（nb-ui 设计语言“六、无障碍”）", async ({page}) => {
    await page.emulateMedia({reducedMotion: "reduce"});
    await page.goto(`${dev.pageUrl}lab?c=Dialog&s=default`);
    await expect.poll(() => page.evaluate(() => (window as unknown as {__nbLab?: LabDebugApi}).__nbLab?.state().ready ?? false)).toBe(true);
    const probe = await page.evaluate(() => {
        const stage = document.querySelector("[data-lab-stage]") as HTMLElement;
        const popover = Object.assign(document.createElement("div"), {className: "nb-ui-popover-motion"});
        popover.dataset.state = "open";
        // 按下、悬停的缩放原子类（类名里带 scale-）：减弱动效时值收成 none。用行内的 scale 造出缩放，不依赖 Tailwind 扫没扫到这个类。
        const pressed = Object.assign(document.createElement("div"), {className: "probe-scale-down", style: "scale: 0.5"});
        // 几项时长不同的过渡：位移那项归零，透明度那项照常（不能因为改了属性列表而错配）。
        const mixed = Object.assign(document.createElement("div"), {style: "transition: grid-template-rows var(--motion-move), opacity var(--motion-fast)"});
        stage.append(popover, pressed, mixed);
        const animation = popover.getAnimations()[0];
        const keyframes = animation?.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [];
        const root = getComputedStyle(document.documentElement);
        const dialog = document.querySelector(".nb-dialog");
        const result = {
            popoverAnimated: animation !== undefined,
            popoverProperties: [...new Set(keyframes.flatMap((frame) => Object.keys(frame).filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key))))],
            pressedScale: getComputedStyle(pressed).scale,
            mixedProperty: getComputedStyle(mixed).transitionProperty,
            mixedDuration: getComputedStyle(mixed).transitionDuration,
            fast: root.getPropertyValue("--motion-fast").trim(),
            move: root.getPropertyValue("--motion-move").trim(),
            dialogScale: dialog === null ? null : getComputedStyle(dialog).getPropertyValue("--nb-dialog-from-scale").trim(),
        };
        popover.remove();
        pressed.remove();
        mixed.remove();
        return result;
    });
    expect(probe.popoverAnimated).toBe(true);
    expect(probe.popoverProperties).toEqual(["opacity"]);
    expect(probe.pressedScale).toBe("none");
    expect(probe.mixedProperty).toBe("grid-template-rows, opacity");
    expect(probe.mixedDuration.split(", ")[0]).toBe("0s");
    expect(probe.mixedDuration.split(", ")[1]).not.toBe("0s");
    expect(probe.fast).not.toBe("0ms");
    expect(probe.move).toBe("0ms");
    expect(probe.dialogScale).toBe("1");
});
