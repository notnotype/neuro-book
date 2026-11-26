import {afterEach, describe, expect, test} from "bun:test";
import {rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {EvalEnvError, defaultEnvFile, parseEnv, readEnvFile, requireEnv} from "./env";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("评测的 .env", () => {
    test("CRLF 的行、成对的引号、注释与 export 前缀都按值读出", () => {
        const values = parseEnv("# 注释\r\nA=1\r\nB=\"two words\"\r\nexport C='three'\r\n\r\nD = 4 \r\nE=\"unbalanced\r\n");
        expect([...values]).toEqual([["A", "1"], ["B", "two words"], ["C", "three"], ["D", "4"], ["E", "\"unbalanced"]]);
    });

    test("缺键时报 env-key-missing 并列出键名，不带取值", () => {
        const values = parseEnv("PRESENT=secret-value\nEMPTY=\n");
        let caught: unknown;
        try {
            requireEnv(values, ["PRESENT", "EMPTY", "ABSENT"], "test.env");
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(EvalEnvError);
        expect((caught as EvalEnvError).code).toBe("env-key-missing");
        expect((caught as EvalEnvError).message).toContain("EMPTY, ABSENT");
        expect((caught as EvalEnvError).message).not.toContain("secret-value");
        expect(requireEnv(values, ["PRESENT"], "test.env")).toEqual({PRESENT: "secret-value"});
    });

    test("文件不在时报 env-file-missing", async () => {
        const root = await createTestTmpRoot("neuro-book-browser-eval", "env 文件");
        roots.push(root);
        await expect(readEnvFile(join(root, "absent.env"))).rejects.toMatchObject({code: "env-file-missing"});
        await writeFile(join(root, "present.env"), "K=v\r\n");
        expect((await readEnvFile(join(root, "present.env"))).get("K")).toBe("v");
    });

    test("缺省路径是主工作区根的 .env，在 worktree 里也一样", async () => {
        const path = await defaultEnvFile(import.meta.dir);
        expect(path.endsWith("/.env")).toBe(true);
        expect(path).not.toContain("/.worktree/");
    });
});
