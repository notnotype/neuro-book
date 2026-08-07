import {execFile} from "node:child_process";
import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("workspace CLI wrapper", () => {
    it("两个平台的交互式CLI包装器都禁止自动安装并保留调用cwd", async () => {
        for (const command of ["profile", "variable", "workspace"] as const) {
            const shell = await readFile(join(repoRoot, "assets", "workspace", ".nbook", "agent", "bin", command), "utf8");
            const cmd = await readFile(join(repoRoot, "assets", "workspace", ".nbook", "agent", "bin", `${command}.cmd`), "utf8");

            expect(shell).toContain(`exec "$BUN_RUNTIME" --no-install --no-env-file "$PRODUCT_COMMAND" command ${command} "$@"`);
            expect(shell).toContain('exec "$BUN_RUNTIME" --no-install "$SOURCE_SCRIPT" "$@"');
            expect(cmd).toContain(`"%BUN_RUNTIME%" --no-install --no-env-file "%PRODUCT_COMMAND%" command ${command} %*`);
            expect(cmd).toContain('"%BUN_RUNTIME%" --no-install "%SOURCE_SCRIPT%" %*');
            expect(shell).not.toContain('cd "$APPLICATION_ROOT"');
            expect(cmd).not.toContain('pushd "%APPLICATION_ROOT%"');
        }
    });

    it.skipIf(process.platform !== "win32")("Windows包装器从显式Application Root执行bundle并保持调用cwd", async () => {
        const fixture = await wrapperFixture("workspace.cmd", true);

        const result = await runWrapper(fixture, ["node", "chapter one"]);

        await expectProductInvocation(result, fixture, ["command", "workspace", "node", "chapter one"]);
    });

    it.skipIf(process.platform !== "win32")("Windows包装器在bundle缺失时回退Source入口", async () => {
        const fixture = await wrapperFixture("workspace.cmd", false);

        const result = await runWrapper(fixture, ["node", "schema", "--json"]);

        expect(result.label).toBe("source");
        expect(result.args).toEqual(["node", "schema", "--json"]);
        expect(normalizePath(await realpath(result.cwd))).toBe(normalizePath(await realpath(fixture.invocationRoot)));
    });

    it.skipIf(process.platform === "win32")("POSIX包装器从显式Application Root执行bundle并保持调用cwd", async () => {
        const fixture = await wrapperFixture("workspace", true);

        const result = await runWrapper(fixture, ["node", "chapter one"]);

        await expectProductInvocation(result, fixture, ["command", "workspace", "node", "chapter one"]);
    });

    it.skipIf(process.platform === "win32")("POSIX包装器在bundle缺失时回退Source入口", async () => {
        const fixture = await wrapperFixture("workspace", false);

        const result = await runWrapper(fixture, ["node", "schema", "--json"]);

        expect(result.label).toBe("source");
        expect(result.args).toEqual(["node", "schema", "--json"]);
        expect(normalizePath(await realpath(result.cwd))).toBe(normalizePath(await realpath(fixture.invocationRoot)));
    });
});

type WrapperFixture = {
    wrapper: string;
    applicationRoot: string;
    stateRoot: string;
    invocationRoot: string;
};

type WrapperResult = {
    label: "product" | "source";
    cwd: string;
    args: string[];
    applicationRoot: string;
    stateRoot: string;
};

/** 建立Application Root、外置State Root与调用目录彼此分离的包装器fixture。 */
async function wrapperFixture(name: "workspace" | "workspace.cmd", withProductBundle: boolean): Promise<WrapperFixture> {
    const root = await mkdtemp(join(tmpdir(), "nbook-workspace-wrapper-"));
    roots.push(root);
    const applicationRoot = join(root, "application root");
    const stateRoot = join(root, "state root");
    const invocationRoot = join(root, "project cwd");
    const binRoot = join(stateRoot, "assets", "workspace", ".nbook", "agent", "bin");
    const wrapper = join(binRoot, name);
    await Promise.all([
        mkdir(applicationRoot, {recursive: true}),
        mkdir(join(applicationRoot, "node_modules"), {recursive: true}),
        mkdir(invocationRoot, {recursive: true}),
        mkdir(binRoot, {recursive: true}),
    ]);
    await writeFile(join(applicationRoot, "package.json"), '{"name":"wrapper-fixture"}\n', "utf8");
    await writeFile(
        wrapper,
        await readFile(join(repoRoot, "assets", "workspace", ".nbook", "agent", "bin", name), "utf8"),
        "utf8",
    );
    await writeProbe(join(applicationRoot, "server", "workspace-files", "workspace-command.ts"), "source");
    if (withProductBundle) {
        await writeProbe(join(applicationRoot, ".output", "server", "commands", "product-command.mjs"), "product");
    }
    return {wrapper, applicationRoot, stateRoot, invocationRoot};
}

/** 执行平台原生包装器并解析bundle或Source入口输出。 */
async function runWrapper(fixture: WrapperFixture, args: string[]): Promise<WrapperResult> {
    const env = {
        ...process.env,
        BUN: process.versions.bun ? process.execPath : "bun",
        NEURO_BOOK_APPLICATION_ROOT: fixture.applicationRoot,
        NEURO_BOOK_STATE_ROOT: fixture.stateRoot,
    };
    const execution = process.platform === "win32"
        ? await execFileAsync("cmd.exe", [
            "/d",
            "/c",
            `call ${quoteCmd(fixture.wrapper)} ${args.map(quoteCmd).join(" ")}`,
        ], {
            cwd: fixture.invocationRoot,
            env,
            windowsHide: true,
            windowsVerbatimArguments: true,
        })
        : await execFileAsync("sh", [fixture.wrapper, ...args], {
            cwd: fixture.invocationRoot,
            env,
            windowsHide: true,
        });
    const line = execution.stdout.trim().split(/\r?\n/u).at(-1);
    if (!line) throw new Error(`workspace包装器没有输出：${execution.stderr}`);
    return JSON.parse(line) as WrapperResult;
}

/** 写入记录真实入口、参数、cwd和根环境的最小Bun命令。 */
async function writeProbe(path: string, label: WrapperResult["label"]): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, [
        "console.log(JSON.stringify({",
        `    label: ${JSON.stringify(label)},`,
        "    cwd: process.cwd(),",
        "    args: process.argv.slice(2),",
        "    applicationRoot: process.env.NEURO_BOOK_APPLICATION_ROOT,",
        "    stateRoot: process.env.NEURO_BOOK_STATE_ROOT,",
        "}));",
    ].join("\n"), "utf8");
}

/** 验证外置State Root不会把命令入口或cwd错误地重定向到自身。 */
async function expectProductInvocation(
    result: WrapperResult,
    fixture: WrapperFixture,
    args: string[],
): Promise<void> {
    expect(result.label).toBe("product");
    expect(result.args).toEqual(args);
    expect(normalizePath(await realpath(result.cwd))).toBe(normalizePath(await realpath(fixture.invocationRoot)));
    expect(normalizePath(await realpath(result.applicationRoot))).toBe(normalizePath(await realpath(fixture.applicationRoot)));
    expect(normalizePath(await realpath(result.stateRoot))).toBe(normalizePath(await realpath(fixture.stateRoot)));
}

/** 为cmd.exe的单条/c命令引用测试fixture路径和参数。 */
function quoteCmd(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
}

/** 统一Windows盘符和路径分隔符，避免realpath大小写差异干扰断言。 */
function normalizePath(path: string): string {
    const normalized = resolve(path).replaceAll("\\", "/");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
