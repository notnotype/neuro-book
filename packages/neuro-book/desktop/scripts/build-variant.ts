/**
 * 在 Windows 上构建一个桌面变体（w00046 t11 计划的“构建分工”）：把这个 `desktop/` 工程复制到 `--out`，放进别处做好的
 * `bundle/` 与 `payload/`（`scripts/build.ts` 的输出，发布流水线由 ubuntu 作业做好、作为产物传过来），再 `hutch install`、
 * `hutch electrobun build --env=stable`。每个变体一份工程目录：Hutch 每次构建都清空 `artifacts/`，文件名里也没有标识与版本，
 * 在同一目录里先后构建会互相覆盖。
 *
 * 用法（Windows，Hutch 已在 PATH 上）：
 *   bun desktop/scripts/build-variant.ts --inputs <有 bundle/ 与 payload/ 的目录> --out <新目录> --version <预期版本>
 *     [--identifier <测试标识> --base-url <测试更新源> [--previous-feed <上一个测试变体的产物目录>]]
 *
 * 正式变体不给后两个参数，标识与更新源用 `electrobun.config.ts` 的缺省；更新冒烟的 A′、B′ 两个都给（测试包装进另一个目录、
 * 从本机更新源取更新）。B′ 另给 `--previous-feed`：构建期间在测试更新源的端口上放 A′ 的产物，Hutch 从那里取上一版做补丁
 * （`electrobun.config.ts` 的 `generatePatch`）；请求记录在 `<out>/previous-feed.log`。
 * 构建前核对壳与载荷的版本，构建后核对 `stable-win-x64-update-v2.json` 的版本与标识。
 * Hutch 的输出原样转到 stdout，另存一份 `<out>/hutch-build.log`（没有补丁时原因在这里）。
 * 退出码：0 成功；1 失败；2 用法错误。
 */

import {existsSync} from "node:fs";
import {cp, mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {parseArgs} from "node:util";

import {feedServer} from "./smoke/feed";

const DESKTOP = join(import.meta.dir, "..");
/** 工程里 Hutch 要的源文件；`bundle/`、`payload/` 来自 `--inputs`，`build/`、`artifacts/`、`node_modules/` 是输出。 */
const PROJECT_FILES = ["electrobun.config.ts", "hutch.config.ts", "package.json", "src"];
const OFFICIAL_IDENTIFIER = "io.github.notnotype.neurobook";
const REQUIRED_ARTIFACTS = ["win-x64-NeuroBook-Setup.zip", "stable-win-x64-NeuroBook.tar.zst", "stable-win-x64-update.json", "stable-win-x64-update-v2.json"];

class UsageError extends Error {}
class BuildFailure extends Error {}

type Options = {inputs: string; out: string; version: string; test?: {identifier: string; baseUrl: string; previousFeed?: string}};

function parseOptions(argv: readonly string[]): Options {
    let values: Record<string, string | undefined>;
    try {
        ({values} = parseArgs({args: [...argv], options: {inputs: {type: "string"}, out: {type: "string"}, version: {type: "string"}, identifier: {type: "string"}, "base-url": {type: "string"}, "previous-feed": {type: "string"}}}));
    } catch (error) {
        throw new UsageError((error as Error).message);
    }
    const {inputs, out, version, identifier, "base-url": baseUrl, "previous-feed": previousFeed} = values;
    if (inputs === undefined || out === undefined || version === undefined || (identifier === undefined) !== (baseUrl === undefined)) {
        throw new UsageError("用法：bun desktop/scripts/build-variant.ts --inputs <目录> --out <目录> --version <版本> [--identifier <测试标识> --base-url <测试更新源> [--previous-feed <目录>]]");
    }
    if (previousFeed !== undefined && identifier === undefined) throw new UsageError("--previous-feed 只给测试变体：正式变体的上一版由 Hutch 从 GitHub 取");
    if (identifier === OFFICIAL_IDENTIFIER) throw new UsageError("测试变体不能用正式标识：测试包的更新源是本机地址，装上会占掉正式安装的位置");
    return {inputs, out, version, ...(identifier === undefined || baseUrl === undefined ? {} : {test: {identifier, baseUrl, ...(previousFeed === undefined ? {} : {previousFeed})}})};
}

async function versionIn(path: string): Promise<unknown> {
    return (JSON.parse(await readFile(path, "utf8")) as {version?: unknown}).version;
}

/** 跑一条 Hutch 命令：输出边转到 stdout 边记下，非零退出就失败。 */
async function hutch(args: readonly string[], cwd: string, env: Record<string, string | undefined>, log: string[]): Promise<void> {
    const child = Bun.spawn(["hutch", ...args], {cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe"});
    const relay = async (stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream) => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) {
            const text = decoder.decode(chunk, {stream: true});
            log.push(text);
            sink.write(text);
        }
    };
    const [, , code] = await Promise.all([relay(child.stdout, process.stdout), relay(child.stderr, process.stderr), child.exited]);
    if (code !== 0) throw new BuildFailure(`hutch ${args.join(" ")} 退出码 ${String(code)}`);
}

/** 在测试更新源的本机端口上放上一个变体的产物；更新源必须是 `http://127.0.0.1:<端口>`。 */
function previousFeed(baseUrl: string, dir: string, log: string): {stop(): void} {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port === "" || url.pathname !== "/") throw new UsageError(`--previous-feed 要求更新源是 http://127.0.0.1:<端口>，现在是 ${baseUrl}`);
    const feed = feedServer(Number(url.port), log);
    feed.serve(dir);
    return feed;
}

async function buildVariant(options: Options): Promise<void> {
    if (existsSync(options.out)) throw new BuildFailure(`${options.out} 已经存在：每个变体用一个新目录`);
    const shellVersion = await versionIn(join(options.inputs, "bundle", "version.json"));
    const payloadVersion = await versionIn(join(options.inputs, "payload", "payload-manifest.json"));
    if (shellVersion !== options.version || payloadVersion !== options.version) {
        throw new BuildFailure(`输入的版本不是 ${options.version}：壳 ${String(shellVersion)}，载荷 ${String(payloadVersion)}`);
    }
    await mkdir(options.out, {recursive: true});
    for (const name of PROJECT_FILES) await cp(join(DESKTOP, name), join(options.out, name), {recursive: true});
    for (const name of ["bundle", "payload"]) await cp(join(options.inputs, name), join(options.out, name), {recursive: true});

    const env: Record<string, string | undefined> = {...process.env};
    // Hutch 0.29.0 设了代理时下载必失败（desktop/README.md 的“构建”）。
    for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "NBOOK_UPDATE_BASE_URL", "NBOOK_DESKTOP_IDENTIFIER"]) delete env[key];
    if (options.test !== undefined) {
        env.NBOOK_DESKTOP_IDENTIFIER = options.test.identifier;
        env.NBOOK_UPDATE_BASE_URL = options.test.baseUrl;
    }
    const log: string[] = [];
    let feed: {stop(): void} | null = null;
    try {
        if (options.test?.previousFeed !== undefined) feed = previousFeed(options.test.baseUrl, options.test.previousFeed, join(options.out, "previous-feed.log"));
        await hutch(["install"], options.out, env, log);
        await hutch(["electrobun", "build", "--env=stable"], options.out, env, log);
    } finally {
        feed?.stop();
        await writeFile(join(options.out, "hutch-build.log"), log.join(""));
    }

    const artifacts = join(options.out, "artifacts");
    const names = existsSync(artifacts) ? await readdir(artifacts) : [];
    const missing = REQUIRED_ARTIFACTS.filter((name) => !names.includes(name));
    if (missing.length > 0) throw new BuildFailure(`产物里缺 ${missing.join("、")}`);
    const manifest = JSON.parse(await readFile(join(artifacts, "stable-win-x64-update-v2.json"), "utf8")) as {version?: unknown; identifier?: unknown};
    const identifier = options.test?.identifier ?? OFFICIAL_IDENTIFIER;
    if (manifest.version !== options.version || manifest.identifier !== identifier) {
        throw new BuildFailure(`update-v2.json 是 ${String(manifest.identifier)} ${String(manifest.version)}，应当是 ${identifier} ${options.version}`);
    }
    const patches = names.filter((name) => name.endsWith(".patch"));
    console.log(`✓ ${identifier} ${options.version}：${artifacts}（${patches.length > 0 ? `补丁 ${patches.join("、")}` : "没有补丁"}）`);
}

if (import.meta.main) {
    try {
        await buildVariant(parseOptions(Bun.argv.slice(2)));
    } catch (error) {
        console.error(error instanceof BuildFailure || error instanceof UsageError ? `构建失败：${error.message}` : error);
        process.exitCode = error instanceof UsageError ? 2 : 1;
    }
}
