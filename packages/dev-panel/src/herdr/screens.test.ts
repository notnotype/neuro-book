import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import type {HerdrExplain} from "./client.js";
import {judgeDeliverable} from "./screens.js";

/** L1：投递的正向判据，样本来自 S0（真实 claude 2.1.296 与 omp，没有模型调用）与设计审查的假 TUI。 */
type Sample = {name: string; source: string; agent: string; expect: boolean; explain: HerdrExplain; visibleAnsi: string};
const {samples} = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../tests/fixtures/screens.json"), "utf8")) as {samples: Sample[]};

describe("能不能往输入框里投", () => {
    for (const sample of samples) {
        test(`${sample.name}（${sample.source}）：${sample.expect ? "可投" : "不可投"}`, () => {
            const verdict = judgeDeliverable({agent: sample.agent, explain: sample.explain, visibleAnsi: sample.visibleAnsi});
            expect([sample.name, verdict.ok]).toEqual([sample.name, sample.expect]);
        });
    }

    test("没取样过的 Agent 一律不可投", () => {
        expect(judgeDeliverable({agent: "codex", explain: null, visibleAnsi: "❯ \n"})).toMatchObject({ok: false, reason: "agent_unsupported"});
    });

    test("颜色值里的 2 不是暗色：RGB、256 色、背景色、冒号写法的输入都算有字；暗色之后跟着正常字、两段暗色也算有字（t11 实现审查第 1 条）", () => {
        const sample = samples.find((entry) => entry.name === "claude-placeholder")!;
        const promptLine = sample.visibleAnsi.split("\n").find((line) => line.includes("❯"))!;
        const rainbow = ["235;95;87", "245;139;87", "250;195;95", "145;200;130", "130;170;220", "155;130;200", "200;130;180"];
        const ultrathink = [..."ultrathink"].map((char, index) => `\u001b[38;2;${rainbow[index % rainbow.length]}m${char}`).join("") + "\u001b[39m";
        const cases: Array<[string, string, boolean]> = [
            ["RGB 前景色的半截字", "❯ \u001b[38;2;255;255;255m我正在打的半截字\u001b[0m", false],
            ["Claude 给 ultrathink 上的彩虹色", `❯ ${ultrathink}`, false],
            ["256 色 2 号的粘贴块", "❯ \u001b[38;5;2m[Pasted text #1 +40 lines]\u001b[0m", false],
            ["RGB 背景色", "❯ \u001b[48;2;40;40;40mhello\u001b[0m", false],
            ["冒号写法的 RGB", "❯ \u001b[38:2::255:0:0mhi\u001b[0m", false],
            ["暗色之后跟着正常字", "❯ \u001b[2mTry \"x\"\u001b[0m abc", false],
            ["正常字之后跟着暗色", "❯ abc \u001b[2mTry \"x\"\u001b[0m", false],
            ["两段暗色", "❯ \u001b[2mTry\u001b[0m \u001b[2m\"x\"\u001b[0m", false],
            ["暗色加 RGB 颜色的占位", "❯ \u001b[2;38;2;120;120;120mTry \"x\"\u001b[0m   ", true],
            ["暗色占位，之后只有空白", "❯ \u001b[2mTry \"x\"\u001b[22m   ", true],
        ];
        for (const [name, line, ok] of cases) {
            const visibleAnsi = sample.visibleAnsi.replace(promptLine, line);
            const text = line.replace(/\u001b\[[0-9;:]*m/gu, "");
            const explain = {...sample.explain, livePromptBoxPreview: `${text}\n`};
            expect([name, judgeDeliverable({agent: "claude", explain, visibleAnsi}).ok]).toEqual([name, ok]);
        }
    });

    test("上沿横线里写着会话名时照样认输入框：框里有字仍不可投；横线前面有字、名字后面没有横线的不算横线（t19）", () => {
        const sample = samples.find((entry) => entry.name === "claude-named-session")!;
        const lines = sample.visibleAnsi.split("\n");
        const promptIndex = lines.findIndex((line) => line.startsWith("❯"));
        const typed = [...lines];
        typed[promptIndex] = "❯ 我正在打的半截字";
        expect(judgeDeliverable({agent: "claude", explain: {...sample.explain, livePromptBoxPreview: "❯ 我正在打的半截字\n"}, visibleAnsi: typed.join("\n")})).toMatchObject({ok: false, reason: "input_not_empty"});
        const rule = lines[promptIndex - 1]!;
        for (const broken of [rule.replace(/─ w00099/u, "x w00099"), rule.replace(/ ─(\u001b\[0m)?\r?$/u, "$1")]) {
            expect(broken).not.toBe(rule);
            const screen = [...lines];
            screen[promptIndex - 1] = broken;
            expect(judgeDeliverable({agent: "claude", explain: sample.explain, visibleAnsi: screen.join("\n")})).toMatchObject({ok: false, reason: "unknown_screen"});
        }
    });

    test("占位文字只在暗色时算空：同样的文字不暗就是开发者打的字", () => {
        const sample = samples.find((entry) => entry.name === "claude-placeholder")!;
        const undimmed = sample.visibleAnsi.replace("\u001b[2m", "");
        expect(judgeDeliverable({agent: "claude", explain: sample.explain, visibleAnsi: undimmed})).toMatchObject({ok: false, reason: "input_not_empty"});
    });
});
