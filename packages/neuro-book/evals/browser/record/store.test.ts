import {afterEach, describe, expect, test} from "bun:test";
import {mkdir, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {RunRecordSchema, SCORE_FORMAT, ScoreSchema} from "./schema";
import type {OutcomeKind, ScoreRecord} from "./schema";
import {MAX_TRIES, attemptDir, attemptState, readJson, tryDir, tryLayout, writeJsonAtomic} from "./store";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

async function out(): Promise<string> {
    const root = await createTestTmpRoot("neuro-book-browser-eval", "运行目录");
    roots.push(root);
    return root;
}

function score(outcome: OutcomeKind): ScoreRecord {
    return {format: SCORE_FORMAT, score: null, rawScore: null, items: [], zeroedBy: null, outcome};
}

describe("运行目录与续跑", () => {
    test("没跑过的 attempt 从第 1 回开始；有计分结局的算完成", async () => {
        const attempt = attemptDir(await out(), {taskId: "author-publish", model: "luna", arm: "browser-use", attempt: 1});
        expect(await attemptState(attempt)).toEqual({kind: "run", nextTry: 1});
        await writeJsonAtomic(tryLayout(tryDir(attempt, 1)).score, score("timeout"));
        expect(await attemptState(attempt)).toEqual({kind: "settled", try: 1});
    });

    test("不计分的结局与中途被打断的一回都再跑一回，最多跑满上限", async () => {
        const attempt = attemptDir(await out(), {taskId: "reader-rank", model: "neon", arm: "browser-use", attempt: 2});
        await writeJsonAtomic(tryLayout(tryDir(attempt, 1)).score, score("infra-error"));
        expect(await attemptState(attempt)).toEqual({kind: "run", nextTry: 2});
        await mkdir(tryDir(attempt, 2), {recursive: true});
        expect(await attemptState(attempt)).toEqual({kind: "run", nextTry: 3});
        for (let n = 3; n <= MAX_TRIES; n++) await writeJsonAtomic(tryLayout(tryDir(attempt, n)).score, score("harness-error"));
        expect(await attemptState(attempt)).toEqual({kind: "exhausted", tries: MAX_TRIES});
    });

    test("只看最后一回：前面计过分、后面又重跑过时以最后一回为准", async () => {
        const attempt = attemptDir(await out(), {taskId: "forum-vote", model: "hydrogen", arm: "browser-use", attempt: 1});
        await writeJsonAtomic(tryLayout(tryDir(attempt, 1)).score, score("completed"));
        await mkdir(tryDir(attempt, 2), {recursive: true});
        expect(await attemptState(attempt)).toEqual({kind: "run", nextTry: 3});
    });

    test("路径段不安全时拒绝", async () => {
        const root = await out();
        expect(() => attemptDir(root, {taskId: "../x", model: "luna", arm: "browser-use", attempt: 1})).toThrow("not a safe path segment");
        expect(() => attemptDir(root, {taskId: "a", model: "luna", arm: "browser-use", attempt: 0})).toThrow("positive integer");
    });

    test("原子写不留临时文件；读到形状不对的文件时报错而不是当成没有", async () => {
        const root = await out();
        const path = join(root, "x", "score.json");
        await writeJsonAtomic(path, score("completed"));
        expect(await readdir(join(root, "x"))).toEqual(["score.json"]);
        expect(await readJson(path, ScoreSchema)).toEqual(score("completed"));
        expect(await readJson(join(root, "absent.json"), ScoreSchema)).toBeNull();
        await writeFile(join(root, "bad.json"), JSON.stringify({format: "nbook.browser-eval.run/v1"}));
        await expect(readJson(join(root, "bad.json"), RunRecordSchema)).rejects.toThrow("does not match its schema");
    });
});
