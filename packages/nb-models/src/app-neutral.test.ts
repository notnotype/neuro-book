/**
 * 本包与应用无关：非测试源码（含注释）不写任何应用的名字，不导入应用包。合同 id、服务键、设置项与文字由应用给。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

const SRC = import.meta.dir;
/** 现有的应用名：NeuroBook 与 NeuroBot。 */
/** `nbot` 前后不能是字母：`drainBoth` 这类单词内部的“nBot”不算。 */
const APP_NAMES = /nbook|neurobook|neurobot|(?<![a-z])nbot(?![a-z])/iu;
/** 应用包本身；`@notnotype/neuro-book-test-support` 不是应用包。 */
const APP_PACKAGES = /from\s+["'](?:nbook\/|@notnotype\/neuro-book(?:\/|["'])|@notnotype\/neuro-bot(?:\/|["']))/u;

function sources(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sources(path);
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

const hits = (pattern: RegExp): string[] => sources(SRC).flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, index) => (pattern.test(line) ? [`${relative(SRC, file)}:${String(index + 1)}：${line.trim()}`] : [])));

describe("与应用无关", () => {
    it("非测试源码（含注释）不出现应用名、不导入应用包", () => {
        expect(hits(APP_NAMES)).toEqual([]);
        expect(hits(APP_PACKAGES)).toEqual([]);
        for (const name of ["NeuroBook", "nbook", "NeuroBot", "nbot"]) expect(APP_NAMES.test(`const id = "${name}";`)).toBe(true);
        for (const name of ["nbot.memory", "NBOT_HOME"]) expect(APP_NAMES.test(name)).toBe(true);
        expect(APP_NAMES.test("const drained = drainBoth();")).toBe(false);
        expect(APP_PACKAGES.test('import {commitStaged} from "nbook/backend/staged-commit";')).toBe(true);
        expect(APP_PACKAGES.test('import {x} from "@notnotype/neuro-bot/server";')).toBe(true);
        expect(APP_PACKAGES.test('import {x} from "@notnotype/neuro-book-test-support/tmp";')).toBe(false);
    });
});
