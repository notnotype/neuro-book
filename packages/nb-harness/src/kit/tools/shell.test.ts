/**
 * `shell` 自身的行为（docs/specs/agent/builtin-tools.md 输出 18–22；测试名里的编号是它的输出条目）：工作目录与环境变量取自布局、
 * 命令里的地址换成本机路径、输出窗口与全文、保存失败与超时中止。文件访问用本机参考实现；宿主的地址方案（虚拟根、不露出的位置）
 * 用包一层的文件访问模拟，宿主专有的方案留在宿主的测试里。
 */

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {openSync, renameSync, rmSync, writeSync} from "node:fs";
import {mkdir, readdir, readFile, realpath, rm, symlink, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {ToolContext, ToolResult, ToolSessionContext} from "../../kernel/contracts.js";
import {createDialects} from "../commands/index.js";
import type {ArtifactStore, SessionFiles} from "../files/index.js";
import {localFiles} from "../files/local.js";
import {readTool} from "./read.js";
import {shellTool} from "./shell.js";
import {SessionEditStores} from "./snapshot.js";

let root = "";
let work = "";
let home = "";
let files: SessionFiles;
let artifacts: ArtifactStore;
const GLOBAL = "work://home";
const context = {sessionId: "s-1", profile: "p"} as ToolSessionContext;

beforeEach(async () => {
    root = await createTestTmpRoot("nb-harness-kit", "tools-shell");
    work = join(root, "work");
    home = join(work, "home");
    await mkdir(home, {recursive: true});
    ({files, artifacts} = localFiles({
        roots: {work},
        aliases: {home: GLOBAL},
        layout: {working: "home://", scratch: [], localWrites: [], shellEnv: {KIT_HOME: "home://", KIT_MISSING: "work://没有"}, searchExcludes: () => []},
        classify: () => "allowed",
        artifacts: "work://artifacts",
    }));
});
afterEach(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

type Result = ToolResult & {readonly details?: {readonly artifact?: string; readonly bytes?: number; readonly exitCode?: number | null}};

async function shell(args: Readonly<Record<string, unknown>>, options: {readonly using?: SessionFiles; readonly signal?: AbortSignal} = {}): Promise<Result> {
    const tool = shellTool(createDialects(() => [])).create(context, {files: options.using ?? files, artifacts});
    const result = await tool.execute(args, {callId: "c-1", signal: options.signal ?? new AbortController().signal} as unknown as ToolContext);
    return (typeof result === "string" ? {text: result} : result) as Result;
}
const firstLine = async (command: string): Promise<string | undefined> => (await shell({command})).text.split("\n")[0];
const savedPath = (address: string): string => join(work, "artifacts", address.split("/").at(-1)!);

describe("shell", () => {
    test("输出 18、20：工作目录是布局的工作目录；布局给的环境变量是本机路径，定位不到的不设；退出码", async () => {
        const real = await realpath(home);
        const ran = await shell({command: 'pwd; echo "[$KIT_HOME]"; echo "[${KIT_MISSING-没有}]"'});
        expect(ran.status).toBeUndefined();
        expect(ran.text.split("\n").slice(0, 3)).toEqual([real, `[${real}]`, "[没有]"]);
        expect(ran.text).toContain("[退出码 0]");
        expect(await shell({command: "exit 3"})).toMatchObject({status: "error", code: "exit-nonzero", details: {exitCode: 3, code: "exit-nonzero"}});
    });

    test("输出 19：地址换成本机路径：引号与分隔符、路径含空格、$、反引号、单引号；新文件目标；不认识的方案与注释不动", async () => {
        const weird = "a b$c`d'e";
        await mkdir(join(home, weird));
        await writeFile(join(home, weird, "f.md"), "内容");
        await writeFile(join(home, "x.md"), "左");
        await writeFile(join(home, "y.md"), "右");
        expect(await firstLine("cat home://a\\ b\\$c\\`d\\'e/f.md")).toBe("内容");
        expect((await shell({command: "cat 'home://a b$c`d'\\''e/f.md'"})).status).toBeUndefined();
        expect(await firstLine('cat "home://a b\\$c\\`d\'e/f.md"')).toBe("内容");

        // 地址本身写不进单引号；真实路径里的单引号要靠链接带进来：三种引号上下文都要按真实路径编码。
        const quoted = join(work, "带'引$号`");
        await mkdir(quoted);
        await writeFile(join(quoted, "h.md"), "链接内容");
        await symlink(join(quoted, "h.md"), join(home, "q.md"));
        for (const command of ["cat home://q.md", "cat 'home://q.md'", 'cat "home://q.md"']) expect(await firstLine(command)).toBe("链接内容");

        expect(await firstLine("cat home://x.md;cat home://y.md")).toBe("左右");
        expect((await firstLine("cat home://x.md|wc -c"))?.trim()).toBe("3");
        expect((await shell({command: "cat home://x.md>home://新/../z.md"})).code).toBe("invalid-address");
        expect((await shell({command: "cat home://x.md>home://z.md"})).status).toBeUndefined();
        expect(await readFile(join(home, "z.md"), "utf8")).toBe("左");
        expect(await firstLine("cat home://x.md home://y.md")).toBe("左右");
        expect(await firstLine("f() { echo \"$1\"; }; f --file=home://x.md")).toBe(`--file=${await realpath(join(home, "x.md"))}`);
        expect(await firstLine(`cat ${GLOBAL}/x.md`)).toBe("左");

        // 祖先一直问到方案根：`work://根下新文件.txt` 的段走完了问 `work://`。
        expect((await shell({command: "echo 根 > work://根下新文件.txt"})).status).toBeUndefined();
        expect(await readFile(join(work, "根下新文件.txt"), "utf8")).toBe("根\n");
        // 末尾的斜杠：换成真实路径后补回。
        await mkdir(join(home, "带斜杠"));
        await writeFile(join(home, "带斜杠/里面.md"), "x");
        expect(await firstLine("ls home://带斜杠/")).toBe("里面.md");
        expect((await shell({command: "mkdir -p home://新/目录 && echo 写 > home://新/目录/g.md"})).status).toBeUndefined();
        expect(await readFile(join(home, "新/目录/g.md"), "utf8")).toBe("写\n");
        expect(await firstLine("echo https://example.com/a git://x/y xhome://z")).toBe("https://example.com/a git://x/y xhome://z");
        expect(await firstLine("echo hello # 注释里 home://../坏")).toBe("hello");
        expect(await firstLine("echo hello;#home://../坏")).toBe("hello");
        expect(await firstLine("#home://../坏\necho hello")).toBe("hello");
        // `a#b` 不是注释：后面的地址要换。
        expect(await firstLine("echo a#home://x.md")).toBe(`a#${await realpath(join(home, "x.md"))}`);
    });

    test("输出 19：取不到本机路径（虚拟根）、不露出的位置、不合法的地址在执行前报错，命令不执行", async () => {
        const guarded: SessionFiles = {...files, readPath: async (address, options) => {
            if (address === "things://") return {ok: false, code: "unsupported-capability", detail: "虚拟根"};
            if (address === "work://secret") return {ok: false, code: "protected-path", detail: "不露出"};
            return files.readPath(address, options);
        }};
        for (const [address, code] of [["things://", "unsupported-capability"], ["work://secret", "protected-path"], ["home://../x", "invalid-address"]] as const) {
            expect(await shell({command: `touch ran.txt; cat ${address}`}, {using: guarded})).toMatchObject({status: "error", code});
        }
        expect(await readFile(join(home, "ran.txt"), "utf8").catch(() => null)).toBeNull();
    });

    test("输出 21：短输出不留全文；放不下时只交回头尾，全文完整落盘，能分页读回；单行与总量的上限", async () => {
        expect((await shell({command: "echo 短"})).text).not.toContain("全文");
        const long = await shell({command: 'for i in $(seq 1 60000); do echo "第 $i 行 xxxxxxxxxxxxxxxxxxxx"; done'});
        expect(long.status).toBeUndefined();
        expect(long.text).toContain("第 60000 行");
        expect(long.text).toContain("第 1 行 ");
        expect(long.text).toContain("中间省略");
        expect(long.text).not.toContain("第 30000 行");
        expect(Buffer.byteLength(long.text, "utf8")).toBeLessThan(55 * 1024);
        // 没有全文地址时把结果末尾带出来：工具会在那里写明全文为什么没能保存（推送 CI 上出现过一次，本机压满 CPU、整份跑、整个包跑都没复现）。
        if (long.details?.artifact === undefined) throw new Error(`长输出没有全文地址；结果末尾：${long.text.slice(-400)}；details=${JSON.stringify(long.details)}`);
        const artifact = long.details.artifact;
        expect(artifact.startsWith("work://artifacts/shell-")).toBe(true);
        expect(long.text).toContain(artifact);
        expect((await readFile(savedPath(artifact), "utf8")).split("\n")).toHaveLength(60_001);
        const page = await readTool(new SessionEditStores()).create(context, {files, artifacts}).execute({path: artifact, offset: 30_000, limit: 1}, {callId: "c-2", signal: new AbortController().signal} as unknown as ToolContext);
        expect(typeof page === "string" ? page : page.text).toContain("第 30000 行");

        const many = await shell({command: "seq 1 3000"});
        expect(many.text).toContain("全文");
        expect(many.text).toContain("\n3000\n");
        expect(many.text).toContain("\n500\n");
        expect(many.text).not.toContain("\n1000\n");
        // 没超行数与字节、也没有长行：全部交回，不留全文。
        const fits = await shell({command: "seq 1 2000"});
        expect(fits.text).toContain("\n1000\n");
        expect(fits.text).not.toContain("全文");
        // 没有尾部换行时最后一段也算一行：2000 行放得下，2001 行放不下。
        expect((await shell({command: "seq 1 2000 | head -c -1"})).text).not.toContain("中间省略");
        expect((await shell({command: "seq 1 2001 | head -c -1"})).text).toContain("中间省略");
        // 一次回调就交出超过 50 KB（cat 常这样）：同样只留头尾。
        await writeFile(join(home, "一块.txt"), `${"第一行\n"}${`${"x".repeat(640)}\n`.repeat(90)}最后一行\n`);
        const oneChunk = await shell({command: "cat home://一块.txt"});
        expect(oneChunk.text).toContain("中间省略");
        expect(oneChunk.text).toContain("第一行");
        expect(oneChunk.text).toContain("最后一行");
        expect(Buffer.byteLength(oneChunk.text, "utf8")).toBeLessThan(45 * 1024);
        // 一行超过上限：窗口里截断，全文完整。
        const line = await shell({command: "printf 'A%.0s' $(seq 1 3000); echo; echo 结尾"});
        expect(line.text).toContain("本行共 3000 字节，已截断");
        expect(line.text.length).toBeLessThan(1_500);
        expect((await readFile(savedPath(line.details!.artifact!), "utf8")).startsWith("A".repeat(3000))).toBe(true);
        // 全文至多存 64 MiB，末尾注明。
        const huge = await shell({command: "head -c 70000000 /dev/zero | tr '\\0' x"});
        expect(huge.details!.bytes).toBe(70_000_000);
        expect(huge.text).toContain("只存了前 64 MiB");
        const stored = await readFile(savedPath(huge.details!.artifact!));
        expect(stored.length).toBeGreaterThan(64 * 1024 * 1024);
        expect(stored.length).toBeLessThan(64 * 1024 * 1024 + 200);
        expect(stored.subarray(-120).toString("utf8")).toContain("输出超过 64 MiB");
    }, 60_000);

    test("输出 22：临时文件写不了、全文提交失败：命令恰好执行一次，结果注明全文没能保存", async () => {
        const big = (marker: string) => `echo x >> ${marker}.count; seq 1 20000`;
        const times = async (marker: string) => (await readFile(join(home, `${marker}.count`), "utf8")).split("\n").length - 1;
        const original = process.env.TMPDIR;
        process.env.TMPDIR = join(root, "没有这个目录");
        try {
            const noTemp = await shell({command: big("temp")});
            expect(noTemp.status).toBeUndefined();
            expect(noTemp.text).toContain("全文没能保存");
            expect(noTemp.text).toContain("20000");
            expect(await times("temp")).toBe(1);
        } finally {
            if (original === undefined) delete process.env.TMPDIR;
            else process.env.TMPDIR = original;
        }
        await writeFile(join(work, "artifacts"), "占位");
        const noCommit = await shell({command: big("commit")});
        expect(noCommit.status).toBeUndefined();
        expect(noCommit.text).toContain("全文没能保存");
        expect(await times("commit")).toBe(1);
    }, 30_000);

    test("输出 22：超时与中止时已输出的部分保存", async () => {
        const timedOut = await shell({command: "seq 1 20000; sleep 30", timeout: 1});
        expect(timedOut).toMatchObject({status: "error", code: "timeout"});
        expect(timedOut.text).toContain("超时");
        expect(await readFile(savedPath(timedOut.details!.artifact!), "utf8")).toContain("20000");

        const controller = new AbortController();
        const running = shell({command: "seq 1 20000; touch started; sleep 30"}, {signal: controller.signal});
        await waitUntil("命令开始", async () => (await readFile(join(home, "started")).catch(() => null)) !== null);
        controller.abort();
        const cancelled = await running;
        expect(cancelled).toMatchObject({status: "error", code: "cancelled"});
        expect(await readFile(savedPath(cancelled.details!.artifact!), "utf8")).toContain("20000");
    }, 30_000);
});

describe("自动转后台（host-kit.md 的自动转后台）", () => {
    /**
     * 宿主一侧照接口实现：门槛由测试放行；接手时把到此刻的输出接成任务的输出文件（内存里的文字写进新文件，暂存改名接过），之后的输出
     * 追加到同一个文件。暂存所在的系统临时目录在测试里指到 `spools`，用来看移交前后暂存有没有留下。
     */
    function host(options: {readonly prepare?: "null" | "reject" | "throw"} = {}) {
        let reach!: () => void;
        const reached = new Promise<void>((resolve) => {
            reach = resolve;
        });
        const output = join(root, "job-output.log");
        const calls = {prepared: 0, discarded: 0};
        let handover: import("./shell.js").ShellHandover | null = null;
        const auto: import("./shell.js").ShellAutoBackground = {
            threshold: () => reached,
            prepare: async () => {
                calls.prepared += 1;
                if (options.prepare === "null") return null;
                if (options.prepare === "reject") throw new Error("名额坏了");
                return {
                    take: (given) => {
                        if (options.prepare === "throw") throw new Error("接不了");
                        handover = given;
                        let fd: number;
                        if (given.output.spool === null) {
                            fd = openSync(output, "wx");
                            writeSync(fd, given.output.text ?? "");
                        } else {
                            renameSync(given.output.spool.path, output);
                            rmSync(dirname(given.output.spool.path), {recursive: true, force: true});
                            fd = given.output.spool.fd;
                        }
                        return {sink: (_error, chunk) => void writeSync(fd, chunk), result: {text: "已转到后台"}};
                    },
                    discard: () => void (calls.discarded += 1),
                };
            },
        };
        return {auto, reach, output, calls, handover: () => handover};
    }

    let spools = "";
    let savedTmp: string | undefined;
    beforeEach(async () => {
        spools = join(root, "spools");
        await mkdir(spools);
        savedTmp = process.env.TMPDIR;
        process.env.TMPDIR = spools;
    });
    afterEach(() => {
        if (savedTmp === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = savedTmp;
    });

    async function run(args: Readonly<Record<string, unknown>>, auto: import("./shell.js").ShellAutoBackground, signal = new AbortController().signal): Promise<Result> {
        const tool = shellTool(createDialects(() => []), undefined, auto).create(context, {files, artifacts});
        const result = await tool.execute(args, {callId: "c-1", signal} as unknown as ToolContext);
        return (typeof result === "string" ? {text: result} : result) as Result;
    }

    /** 暂存（同步写入）已经以 `end` 结尾。 */
    const spooled = async (end: string): Promise<boolean> => {
        const [directory] = await readdir(spools);
        if (directory === undefined) return false;
        return (await readFile(join(spools, directory, "output.log"), "utf8").catch(() => "")).endsWith(end);
    };

    /** 先输出 `before`，等测试放行再输出“二”。 */
    const gated = (before = "echo 一") => {
        const go = join(root, "go");
        return {command: `${before}; while [ ! -f ${go} ]; do sleep 0.05; done; echo 二`, release: () => writeFile(go, "")};
    };

    test("跑过门槛：移交给宿主，交回宿主的结果；命令断开这次调用的信号接着跑，输出一行不丢地进了宿主的文件", async () => {
        const h = host();
        const cmd = gated();
        const call = new AbortController();
        const running = run({command: cmd.command}, h.auto, call.signal);
        h.reach();
        expect(await running).toEqual({text: "已转到后台"});
        const given = h.handover()!;
        // 门槛先于第一块输出还是后于它不确定：两种情形下内存里的与之后追加的合起来都是全部输出。
        expect(given.output.spool).toBeNull();
        // 移交之后中止这次调用（父会话的运行被中止）不停命令。
        call.abort();
        await cmd.release();
        expect(await given.done).toMatchObject({exitCode: 0, timedOut: false, cancelled: false});
        expect(await readFile(h.output, "utf8")).toBe("一\n二\n");
        expect(h.calls).toEqual({prepared: 1, discarded: 0});
        expect(await readdir(spools)).toEqual([]);
    });

    test("移交前已超出窗口：交出暂存与它的统计，接过之后全文完整", async () => {
        const h = host();
        const cmd = gated("seq 1 20000; echo 一");
        const running = run({command: cmd.command}, h.auto);
        await waitUntil("门槛之前的输出都进了暂存", () => spooled("20000\n一\n"));
        h.reach();
        expect(await running).toEqual({text: "已转到后台"});
        const given = h.handover()!;
        expect(given.output.text).toBeNull();
        expect(given.output.lines).toBe(20001);
        expect(given.output.tail.endsWith("20000\n一\n")).toBe(true);
        await cmd.release();
        await given.done;
        const lines = (await readFile(h.output, "utf8")).split("\n");
        expect(lines.length).toBe(20003);
        expect(lines.slice(0, 2)).toEqual(["1", "2"]);
        expect(lines.slice(-3)).toEqual(["一", "二", ""]);
        expect(await readdir(spools)).toEqual([]);
    });

    test("代码里调的不转：门槛到了也不问宿主，跑完照前台交回", async () => {
        const h = host();
        h.reach();
        const cmd = gated();
        const tool = shellTool(createDialects(() => []), undefined, h.auto).create(context, {files, artifacts});
        const running = tool.execute({command: cmd.command}, {callId: "c-1", signal: new AbortController().signal, within: {invocation: "eval-1"}} as unknown as ToolContext);
        await cmd.release();
        const ran = await running;
        expect(typeof ran === "string" ? ran : ran.text).toContain("一\n二");
        expect(h.calls.prepared).toBe(0);
    });

    test("门槛之前就结束：照前台交回，不移交", async () => {
        const h = host();
        const ran = await run({command: "echo 很快"}, h.auto);
        expect(ran.text).toContain("很快");
        expect(ran.text).toContain("[退出码 0]");
        expect(h.calls.prepared).toBe(0);
        expect(await Bun.file(h.output).exists()).toBe(false);
    });

    test("宿主接不了（prepare 交回 null、失败，take 抛错）：命令留在前台跑完；失败的原因写进结果，暂存不留下、全文照常保存", async () => {
        for (const mode of ["null", "reject", "throw"] as const) {
            const h = host({prepare: mode});
            const cmd = gated("seq 1 20000; echo 一");
            const running = run({command: cmd.command}, h.auto);
            await waitUntil("已超出窗口", async () => (await readdir(spools)).length === 1);
            h.reach();
            await waitUntil("宿主看过了", () => h.calls.prepared === 1);
            await cmd.release();
            const ran = await running;
            expect(ran.text).toContain("一\n二");
            expect(ran.text.includes("没转成")).toBe(mode !== "null");
            if (mode === "reject") expect(ran.text).toContain("名额坏了");
            if (mode === "throw") expect(ran.text).toContain("接不了");
            const saved = await readFile(savedPath((ran.details as {artifact: string}).artifact), "utf8");
            expect(saved.startsWith("1\n2\n")).toBe(true);
            expect(saved.endsWith("20000\n一\n二\n")).toBe(true);
            expect(h.calls.discarded).toBe(mode === "throw" ? 1 : 0);
            expect(await readdir(spools)).toEqual([]);
            await rm(join(root, "go"), {force: true});
        }
    });
});
