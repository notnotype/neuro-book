import {execFile} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {promisify} from "node:util";

import {afterEach, describe, expect, it} from "vitest";

import {
    WINDOWS_PRODUCT_HTTP_PROFILE_SOURCE,
    WINDOWS_PRODUCT_RELEASE_CHECKS,
} from "nbook/scripts/release/verify-windows-product";
import {PRODUCT_RUNTIME_CHECK_IDS} from "nbook/shared/product-runtime-contract";

const roots: string[] = [];
const executeFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const verifierUrl = pathToFileURL(join(repositoryRoot, "scripts", "release", "verify-windows-product.ts")).href;

afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => await rm(root, {recursive: true, force: true})));
});

describe("Windows Product release command secret transport", () => {
    it("覆盖Runtime Contract v5的全部 release check", () => {
        expect(WINDOWS_PRODUCT_RELEASE_CHECKS).toEqual(PRODUCT_RUNTIME_CHECK_IDS);
        expect(WINDOWS_PRODUCT_RELEASE_CHECKS).toContain("world-engine-config");
        expect(WINDOWS_PRODUCT_HTTP_PROFILE_SOURCE).toContain("tools: toolset()");
    });

    it("只通过stdin传递原始UTF-8密码字节", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-product-command-secret-"));
        roots.push(root);
        const bootstrap = join(root, "capture.mjs");
        await writeFile(bootstrap, [
            "const stdin = new Uint8Array(await Bun.stdin.arrayBuffer());",
            "console.log(JSON.stringify({",
            "    args: process.argv.slice(2),",
            "    environmentPassword: process.env.AUTH_ADMIN_PASSWORD ?? null,",
            "    stdin: Array.from(stdin),",
            "}));",
        ].join("\n"), "utf8");
        const password = "密码-password\n";
        const input = new TextEncoder().encode(password);
        const harness = join(root, "success-harness.ts");
        await writeFile(harness, [
            `import {runProductCommand} from ${JSON.stringify(verifierUrl)};`,
            `const password = ${JSON.stringify(password)};`,
            `const output = await runProductCommand(process.execPath, ${JSON.stringify(bootstrap)}, ${JSON.stringify(root)}, {AUTH_ADMIN_PASSWORD: password}, ["command", "create-admin", "admin", "--password-stdin"], new TextEncoder().encode(password));`,
            "console.log(JSON.stringify({output}));",
        ].join("\n"), "utf8");

        const execution = await executeFile(process.env.BUN || "bun", ["--no-install", harness], {
            cwd: repositoryRoot,
            env: {...process.env, AUTH_ADMIN_PASSWORD: undefined},
        });
        const result = JSON.parse(execution.stdout) as {output: string};
        const capture = JSON.parse(result.output) as {
            args: string[];
            environmentPassword: string | null;
            stdin: number[];
        };

        expect(capture.args).toEqual(["command", "create-admin", "admin", "--password-stdin"]);
        expect(capture.args.join(" ")).not.toContain(password);
        expect(capture.environmentPassword).toBeNull();
        expect(capture.stdin).toEqual(Array.from(input));
        expect(execution.stdout).not.toContain(password);
        expect(execution.stderr).not.toContain(password);
    });

    it("命令失败时错误日志不包含stdin secret", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-product-command-secret-error-"));
        roots.push(root);
        const bootstrap = join(root, "fail.mjs");
        await writeFile(bootstrap, [
            "await Bun.stdin.arrayBuffer();",
            "console.error('expected failure');",
            "process.exit(7);",
        ].join("\n"), "utf8");
        const password = "不应出现-password\n";
        const harness = join(root, "failure-harness.ts");
        await writeFile(harness, [
            `import {runProductCommand} from ${JSON.stringify(verifierUrl)};`,
            `const password = ${JSON.stringify(password)};`,
            "try {",
            `    await runProductCommand(process.execPath, ${JSON.stringify(bootstrap)}, ${JSON.stringify(root)}, {AUTH_ADMIN_PASSWORD: password}, ["command", "create-admin", "admin", "--password-stdin"], new TextEncoder().encode(password));`,
            "    throw new Error('command unexpectedly succeeded');",
            "} catch (error) {",
            "    console.log(JSON.stringify({message: error instanceof Error ? error.message : String(error)}));",
            "}",
        ].join("\n"), "utf8");

        const execution = await executeFile(process.env.BUN || "bun", ["--no-install", harness], {
            cwd: repositoryRoot,
            env: {...process.env, AUTH_ADMIN_PASSWORD: undefined},
        });
        const result = JSON.parse(execution.stdout) as {message: string};

        expect(result.message).toContain("expected failure");
        expect(execution.stdout).not.toContain(password);
        expect(execution.stderr).not.toContain(password);
    });
});
