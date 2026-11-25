/**
 * 读密码（`read-password.ts`；`site.operations` 输出 5：终端里输两次、不回显，管道里读到结尾）。来源是包内的
 * `TestPasswordSource`，用例自己送字节；终端里按键在原始模式下就是这些字节（计划探针 p8），所以按字节送就是按键。
 * 真实终端上的不回显与恢复由交付报告里的手工检查（`script` 起的伪终端）覆盖。
 */

import {describe, expect, it} from "bun:test";

import {TestPasswordSource} from "../testing/password-source";
import {PIPED_PASSWORD_MAX_BYTES, readPassword, TERMINAL_REPEAT_PROMPT, TerminalLineDecoder, type PasswordOutcome} from "./read-password";

const GOOD = "correct horse";
const ok = (password: string): PasswordOutcome => ({kind: "password", password});
const invalid = (problem: "missing" | "invalid" | "mismatch"): PasswordOutcome => ({kind: "invalid", problem});
const CANCELLED: PasswordOutcome = {kind: "cancelled"};

type Chunk = string | readonly number[];

/** 送完 `chunks`（`end` 为真时再结束流）后读到的结果。 */
async function read(isTerminal: boolean, chunks: readonly Chunk[], end = !isTerminal): Promise<{outcome: PasswordOutcome; source: TestPasswordSource}> {
    const source = new TestPasswordSource(isTerminal);
    for (const chunk of chunks) source.send(chunk);
    if (end) source.end();
    const outcome = await readPassword(source, new AbortController().signal);
    return {outcome, source};
}

/** UTF-8 字节。 */
const utf8 = (text: string): number[] => [...new TextEncoder().encode(text)];

const SECRET_CJK = "密码密码密码密码";
/** U+FEFF（零宽不换行空格，也是 UTF-8 的 BOM）。 */
const BOM = "\uFEFF";
const WITH_BOM_INSIDE = `correct${BOM} horse`;

describe("终端：输两次", () => {
    const cases: readonly {readonly name: string; readonly chunks: readonly Chunk[]; readonly end?: boolean; readonly expected: PasswordOutcome}[] = [
        {name: "两次一致", chunks: [`${GOOD}\r`, `${GOOD}\r`], expected: ok(GOOD)},
        {name: "两次在同一块里送来（粘贴），\\r\\n 不算多出一行", chunks: [`${GOOD}\r\n${GOOD}\r\n`], expected: ok(GOOD)},
        {name: "换行也结束一行", chunks: [`${GOOD}\n${GOOD}\n`], expected: ok(GOOD)},
        {name: "退格（0x7f）删掉最后一个字符", chunks: [`${GOOD}x\u007f\r`, `${GOOD}\r`], expected: ok(GOOD)},
        {name: "退格（0x08）同样删", chunks: [`${GOOD}xy\b\b\r`, `${GOOD}\r`], expected: ok(GOOD)},
        {name: "退格删掉一整个多字节字符，不是半个", chunks: [`${SECRET_CJK}码\u007f\r`, `${SECRET_CJK}\r`], expected: ok(SECRET_CJK)},
        {name: "Ctrl-U 清空这一行，重新输", chunks: [`wrong\u0015${GOOD}\r`, `${GOOD}\r`], expected: ok(GOOD)},
        {name: "Ctrl-U 连不收的输入一起清掉", chunks: [`\u001b[A\u0015${GOOD}\r`, `${GOOD}\r`], expected: ok(GOOD)},
        {name: "一个字符被切在两块之间", chunks: [utf8(SECRET_CJK).slice(0, 4), [...utf8(SECRET_CJK).slice(4), 0x0d], `${SECRET_CJK}\r`], expected: ok(SECRET_CJK)},
        {name: "四字节字符", chunks: [`😀${GOOD}\r`, `😀${GOOD}\r`], expected: ok(`😀${GOOD}`)},
        {name: "正好 128 个字符", chunks: [`${"a".repeat(128)}\r`, `${"a".repeat(128)}\r`], expected: ok("a".repeat(128))},
        {name: "空输入时 Ctrl-D 是取消", chunks: ["\u0004"], expected: CANCELLED},
        {name: "第二次空输入时 Ctrl-D 也是取消", chunks: [`${GOOD}\r`, "\u0004"], expected: CANCELLED},
        {name: "有内容时 Ctrl-D 什么也不做", chunks: [`correct\u0004 horse\r`, `${GOOD}\r`], expected: ok(GOOD)},
        {name: "Ctrl-C 是取消", chunks: ["corr\u0003"], expected: CANCELLED},
        {name: "第二次输入时 Ctrl-C 也是取消", chunks: [`${GOOD}\r`, "corr\u0003"], expected: CANCELLED},
        {name: "终端被关掉（流结束）算取消", chunks: ["corr"], end: true, expected: CANCELLED},
        {name: "空的一行", chunks: ["\r"], expected: invalid("missing")},
        {name: "不到 8 个字符", chunks: ["short\r"], expected: invalid("invalid")},
        {name: "超过 128 个字符", chunks: [`${"a".repeat(129)}\r`], expected: invalid("invalid")},
        {name: "超过上限后删回 128 个也不收：多出来的没存，内容已经不是输入的", chunks: [`${"a".repeat(129)}\u007f\r`], expected: invalid("invalid")},
        {name: "Tab 这类控制字符不收", chunks: [`correct\thorse\r`], expected: invalid("invalid")},
        {name: "方向键（Esc [ A）不收，不是只丢掉 Esc", chunks: [`${GOOD}\u001b[A\r`], expected: invalid("invalid")},
        {name: "C1 控制字符（U+0085）不收", chunks: [`${GOOD}\u0085\r`], expected: invalid("invalid")},
        {name: "坏的 UTF-8 不收", chunks: [[0xff, ...utf8(`${GOOD}\r`)]], expected: invalid("invalid")},
        {name: "没拼完的多字节字符被回车打断", chunks: [[...utf8(GOOD), 0xe5, 0x0d]], expected: invalid("invalid")},
        {name: "超长编码不收", chunks: [[0xe0, 0x80, 0xaf, ...utf8(`${GOOD}\r`)]], expected: invalid("invalid")},
        {name: "两次不一致", chunks: [`${GOOD}\r`, `${GOOD}!\r`], expected: invalid("mismatch")},
        {name: "第二次含不收的输入算不一致", chunks: [`${GOOD}\r`, `${GOOD}\t\r`], expected: invalid("mismatch")},
        // U+FEFF 不是控制字符，原样进密码；解码不能把它当 BOM 去掉（omp 实现审查第 5 条）。
        {name: "开头的 U+FEFF 原样留下", chunks: [`${BOM}${GOOD}\r`, `${BOM}${GOOD}\r`], expected: ok(`${BOM}${GOOD}`)},
        {name: "中间的 U+FEFF 原样留下", chunks: [`${WITH_BOM_INSIDE}\r`, `${WITH_BOM_INSIDE}\r`], expected: ok(WITH_BOM_INSIDE)},
        {name: "两次只差中间一个 U+FEFF 算不一致", chunks: [`${GOOD}\r`, `${WITH_BOM_INSIDE}\r`], expected: invalid("mismatch")},
        {name: "两次只差开头一个 U+FEFF 算不一致", chunks: [`${BOM}${GOOD}\r`, `${GOOD}\r`], expected: invalid("mismatch")},
    ];
    for (const testCase of cases) {
        it(testCase.name, async () => {
            const {outcome} = await read(true, testCase.chunks, testCase.end ?? false);
            expect(outcome).toEqual(testCase.expected);
        });
    }

    it("读完以后终端回到普通模式、不再订阅；只开关一次原始模式", async () => {
        for (const chunks of [[`${GOOD}\r`, `${GOOD}\r`], ["\u0003"], ["short\r"], [`${GOOD}\r`, "x\r"]]) {
            const {source} = await read(true, chunks);
            expect(source.rawModes).toEqual([true, false]);
            expect(source.subscribed).toBe(false);
        }
    });
});

describe("管道：读到结尾", () => {
    const cases: readonly {readonly name: string; readonly chunks: readonly Chunk[]; readonly expected: PasswordOutcome}[] = [
        {name: "末尾的换行去掉", chunks: [`${GOOD}\n`], expected: ok(GOOD)},
        {name: "末尾的 \\r\\n 去掉", chunks: [`${GOOD}\r\n`], expected: ok(GOOD)},
        {name: "没有换行也行", chunks: [GOOD], expected: ok(GOOD)},
        {name: "读到结尾才算：分几块送来的拼起来", chunks: ["correct", " horse\n"], expected: ok(GOOD)},
        {name: "一个字符被切在两块之间", chunks: [utf8(SECRET_CJK).slice(0, 2), utf8(SECRET_CJK).slice(2)], expected: ok(SECRET_CJK)},
        // 去掉末尾一个换行以后仍含控制字符的不收，与终端里同一条规则。
        {name: "只去掉一个换行：末尾多出来的空行不收", chunks: [`${GOOD}\n\n`], expected: invalid("invalid")},
        {name: "中间的换行不收：第一个换行不结束读，两行也不当成一个密码", chunks: ["line1pass\n", "line2pass\n"], expected: invalid("invalid")},
        {name: "中间的 \\r\\n 不收", chunks: [`${GOOD}\r\n${GOOD}\r\n`], expected: invalid("invalid")},
        {name: "只有 \\r 的结尾不收", chunks: [`${GOOD}\r`], expected: invalid("invalid")},
        {name: "Tab 不收", chunks: [`correct\thorse\n`], expected: invalid("invalid")},
        {name: "Esc 序列不收", chunks: [`${GOOD}\u001b[A\n`], expected: invalid("invalid")},
        {name: "NUL 不收", chunks: [`${GOOD}\u0000\n`], expected: invalid("invalid")},
        {name: "U+007F 不当退格解释，也不收", chunks: [`${GOOD}\u007f`], expected: invalid("invalid")},
        {name: "C1 控制字符（U+0085）不收", chunks: [`${GOOD}\u0085\n`], expected: invalid("invalid")},
        {name: "C1 之后的字符照收（U+00A0）", chunks: [`${GOOD} \n`], expected: ok(`${GOOD} `)},
        {name: "什么也没送", chunks: [], expected: invalid("missing")},
        {name: "只有一个换行", chunks: ["\n"], expected: invalid("missing")},
        {name: "不到 8 个字符", chunks: ["short\n"], expected: invalid("invalid")},
        {name: "正好 128 个字符", chunks: [`${"a".repeat(128)}\n`], expected: ok("a".repeat(128))},
        {name: "超过 128 个字符", chunks: [`${"a".repeat(129)}\n`], expected: invalid("invalid")},
        {name: "坏的 UTF-8", chunks: [[...utf8(GOOD), 0xff]], expected: invalid("invalid")},
        {name: "开头的 U+FEFF 原样留下", chunks: [`${BOM}${GOOD}\n`], expected: ok(`${BOM}${GOOD}`)},
        {name: "中间的 U+FEFF 原样留下", chunks: [`${WITH_BOM_INSIDE}\n`], expected: ok(WITH_BOM_INSIDE)},
    ];
    for (const testCase of cases) {
        it(testCase.name, async () => {
            const {outcome, source} = await read(false, testCase.chunks);
            expect(outcome).toEqual(testCase.expected);
            expect(source.rawModes).toEqual([]);
        });
    }

    it("超过字节上限就不再读：不等流结束", async () => {
        const source = new TestPasswordSource(false);
        source.send("a".repeat(PIPED_PASSWORD_MAX_BYTES + 1));
        expect(await readPassword(source, new AbortController().signal)).toEqual(invalid("invalid"));
        expect(source.subscribed).toBe(false);
    });
});

describe("停止信号", () => {
    it("等输入时 abort：reject 为 signal.reason，终端回到普通模式，不再订阅，提示后补一个换行", async () => {
        const source = new TestPasswordSource(true);
        const controller = new AbortController();
        const reason = new DOMException("stopping", "AbortError");
        const reading = readPassword(source, controller.signal);
        source.send("corr");
        expect(source.rawMode).toBe(true);
        controller.abort(reason);
        expect(await reading.then(() => "resolved", (error: unknown) => error)).toBe(reason);
        expect(source.rawModes).toEqual([true, false]);
        expect(source.subscribed).toBe(false);
        expect(source.prompts.at(-1)).toBe("\n");
        // abort 之后送来的回车不再被读走：订阅已停。
        source.send(`${GOOD}\r`);
        expect(source.subscriptions).toBe(1);
    });

    it("第二次输入时 abort 同样恢复终端", async () => {
        const source = new TestPasswordSource(true);
        const controller = new AbortController();
        const reading = readPassword(source, controller.signal);
        source.send(`${GOOD}\r`);
        await waitForSecondPrompt(source);
        controller.abort(new Error("stop"));
        await expect(reading).rejects.toThrow("stop");
        expect(source.rawModes).toEqual([true, false]);
        expect(source.subscribed).toBe(false);
    });

    it("管道上等结尾时 abort", async () => {
        const source = new TestPasswordSource(false);
        const controller = new AbortController();
        const reading = readPassword(source, controller.signal);
        source.send(GOOD);
        controller.abort(new Error("stop"));
        await expect(reading).rejects.toThrow("stop");
        expect(source.subscribed).toBe(false);
    });

    it("已经 abort 时不碰终端、不读", async () => {
        const source = new TestPasswordSource(true);
        const controller = new AbortController();
        controller.abort(new Error("stop"));
        await expect(readPassword(source, controller.signal)).rejects.toThrow("stop");
        expect(source.rawModes).toEqual([]);
        expect(source.subscriptions).toBe(0);
    });

    it("流出错：reject 为那个错误，终端照样恢复", async () => {
        const source = new TestPasswordSource(true);
        const failure = new Error("EIO");
        const reading = readPassword(source, new AbortController().signal);
        source.send("corr").fail(failure);
        expect(await reading.then(() => "resolved", (error: unknown) => error)).toBe(failure);
        expect(source.rawModes).toEqual([true, false]);
    });
});

/** 第一次读完、第二次开始订阅之间隔着几轮微任务；让出微任务直到第二次的提示写出来。 */
async function waitForSecondPrompt(source: TestPasswordSource): Promise<void> {
    for (let turn = 0; turn < 100; turn += 1) {
        if (source.prompts.includes(TERMINAL_REPEAT_PROMPT)) return;
        await Promise.resolve();
    }
    throw new Error("the second password prompt was never written");
}

describe("TerminalLineDecoder", () => {
    it("一块里的几行按先后切出", () => {
        const decoder = new TerminalLineDecoder();
        expect(decoder.push(new TextEncoder().encode("one\rtwo\r\nthree\n\u0003"))).toEqual([
            {kind: "line", text: "one"},
            {kind: "line", text: "two"},
            {kind: "line", text: "three"},
            {kind: "interrupt"},
        ]);
    });

    it("Ctrl-C 之后从空行重新开始", () => {
        const decoder = new TerminalLineDecoder();
        expect(decoder.push(new TextEncoder().encode("abc\u0003\u0004"))).toEqual([{kind: "interrupt"}, {kind: "eof"}]);
    });
});
