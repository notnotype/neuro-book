/**
 * 本包与应用无关：非测试源码（含注释）不写任何应用的名字，不导入应用包。用到锁的应用各自传锁目录与诊断回调。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

const SRC = import.meta.dir;
/** 现有的应用名：NeuroBook 与 NeuroBot。 */
const APP_NAMES = /nbook|neurobook|nbot|neurobot/iu;
const APP_PACKAGES = /from\s+["'](?:nbook\/|@notnotype\/neuro-book|@notnotype\/neuro-bot)/u;

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
        expect(APP_PACKAGES.test('import {commitStaged} from "nbook/backend/staged-commit";')).toBe(true);
        expect(APP_PACKAGES.test('import {x} from "@notnotype/neuro-bot/server";')).toBe(true);
    });
});
