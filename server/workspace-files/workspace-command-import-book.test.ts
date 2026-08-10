import {spawn} from "node:child_process";
import {mkdtemp, mkdir, readFile, rm, writeFile, readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

const workspaceCommand = resolve("server", "workspace-files", "workspace-command.ts");
const applicationRoot = resolve(".");
const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

const LONG_BODY = "她站在校门口，深吸一口气。九月的风带着桂花的香气，吹起她的发梢，她想起那个约定，然后她笑了。";

function buildBook(chapters: string[]): string {
    return chapters
        .map((heading) => `${heading}\n${Array(20).fill(LONG_BODY).join("\n")}`)
        .join("\n\n");
}

describe("Workspace CLI import-book", {timeout: 120_000}, () => {
    it("dry-run 输出统计 JSON，不写文件", async () => {
        const fixture = await createFixture();
        await writeFile(join(fixture.workspaceRoot, "book.txt"), buildBook(["第一章 重生", "第二章 入学", "第三章 试探"]), "utf8");

        const result = await runWorkspace(fixture, ["node", "import-book", "book.txt", "--json"]);
        expect(result.code, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
        const payload = parseJson(result.stdout);
        expect(payload).toMatchObject({
            schemaVersion: "nbook.import-book/v1",
            ok: true,
            applied: false,
            encoding: "utf-8",
            mode: "pattern",
            patternKey: "chinese-chapter",
            confidence: "high",
            total: 3,
        });
        expect(payload.previews.map((item: {heading: string}) => item.heading)).toEqual(["第一章 重生", "第二章 入学", "第三章 试探"]);
        await expect(readdir(join(fixture.workspaceRoot, "manuscript"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("--apply 落盘内容节点，frontmatter 标记导入来源", async () => {
        const fixture = await createFixture();
        await writeFile(join(fixture.workspaceRoot, "book.txt"), buildBook(["第一章 重生", "第二章 入学"]), "utf8");

        const result = await runWorkspace(fixture, ["node", "import-book", "book.txt", "--apply"]);
        expect(result.code).toBe(0);
        const indexContent = await readFile(join(fixture.workspaceRoot, "manuscript", "001-volume", "001-chapter", "index.md"), "utf8");
        expect(indexContent).toContain("title: 第一章 重生");
        expect(indexContent).toContain("type: chapter");
        expect(indexContent).toContain("status: draft");
        expect(indexContent).toContain("summary: \"\"");
        expect(indexContent).toContain("source: imported");
        expect(indexContent).toContain("review: proposed");
        expect(indexContent).toContain("第一章 重生");
    });

    it("幂等：重复 --apply 不覆盖已存在章节", async () => {
        const fixture = await createFixture();
        const bookPath = join(fixture.workspaceRoot, "book.txt");
        await writeFile(bookPath, buildBook(["第一章 重生", "第二章 入学"]), "utf8");
        await runWorkspace(fixture, ["node", "import-book", "book.txt", "--apply"]);

        const first = await readFile(join(fixture.workspaceRoot, "manuscript", "001-volume", "001-chapter", "index.md"), "utf8");
        const second = await runWorkspace(fixture, ["node", "import-book", "book.txt", "--apply"]);
        expect(second.stdout).toContain("已导入 0 章");
        await expect(readFile(join(fixture.workspaceRoot, "manuscript", "001-volume", "001-chapter", "index.md"), "utf8")).resolves.toBe(first);
    });

    it("--force 覆盖已存在章节", async () => {
        const fixture = await createFixture();
        const bookPath = join(fixture.workspaceRoot, "book.txt");
        await writeFile(bookPath, buildBook(["第一章 重生"]), "utf8");
        await runWorkspace(fixture, ["node", "import-book", "book.txt", "--apply"]);
        await writeFile(bookPath, buildBook(["第一章 重生（修订版）"]), "utf8");

        const result = await runWorkspace(fixture, ["node", "import-book", "book.txt", "--apply", "--force"]);
        expect(result.stdout).toContain("已导入 1 章");
        const content = await readFile(join(fixture.workspaceRoot, "manuscript", "001-volume", "001-chapter", "index.md"), "utf8");
        expect(content).toContain("第一章 重生（修订版）");
    });

    it("--chapters-per-volume 分卷", async () => {
        const fixture = await createFixture();
        const chapters = Array.from({length: 5}, (_, index) => `第${index + 1}章 标题${index + 1}`);
        await writeFile(join(fixture.workspaceRoot, "book.txt"), buildBook(chapters), "utf8");

        const result = await runWorkspace(fixture, ["node", "import-book", "book.txt", "--chapters-per-volume", "2", "--apply"]);
        expect(result.code).toBe(0);
        await expect(readdir(join(fixture.workspaceRoot, "manuscript", "001-volume"))).resolves.toHaveLength(2);
        await expect(readdir(join(fixture.workspaceRoot, "manuscript", "002-volume"))).resolves.toHaveLength(2);
        await expect(readdir(join(fixture.workspaceRoot, "manuscript", "003-volume"))).resolves.toHaveLength(1);
    });

    it("GBK 编码书稿可导入", async () => {
        const fixture = await createFixture();
        // 「第一章 重生」「第二章 入学」的 GBK 字节 + ASCII 正文（GBK 兼容 ASCII）
        const heading1 = Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xd6, 0xd8, 0xc9, 0xfa]);
        const heading2 = Buffer.from([0xb5, 0xda, 0xb6, 0xfe, 0xd5, 0xc2, 0x20, 0xc8, 0xeb, 0xd1, 0xa7]);
        const body = Buffer.from(`\n${Array(20).fill("This is a sufficiently long body text for a chapter.").join("\n")}`, "utf8");
        const gbk = Buffer.concat([heading1, body, Buffer.from("\n\n"), heading2, body]);
        await writeFile(join(fixture.workspaceRoot, "book-gbk.txt"), gbk);

        const result = await runWorkspace(fixture, ["node", "import-book", "book-gbk.txt", "--json"]);
        expect(result.code, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
        expect(parseJson(result.stdout)).toMatchObject({ok: true, encoding: "gbk", total: 2});
    });

    it("--split-pattern 逃生口正则生效", async () => {
        const fixture = await createFixture();
        const book = ["第1回 风起", "第2回 云涌", "第3回 雨落"]
            .map((heading) => `${heading}\n${Array(20).fill(LONG_BODY).join("\n")}`)
            .join("\n\n");
        await writeFile(join(fixture.workspaceRoot, "book.txt"), book, "utf8");

        const result = await runWorkspace(fixture, ["node", "import-book", "book.txt", "--split-pattern", "^第\\d+回", "--json"]);
        expect(result.code).toBe(0);
        expect(parseJson(result.stdout)).toMatchObject({ok: true, mode: "regex", total: 3});
    });

    it("--pattern-json AI 描述切章", async () => {
        const fixture = await createFixture();
        const book = ["第1回 风起", "第2回 云涌"]
            .map((heading) => `${heading}\n${Array(20).fill(LONG_BODY).join("\n")}`)
            .join("\n\n");
        await writeFile(join(fixture.workspaceRoot, "book.txt"), book, "utf8");
        const pattern = JSON.stringify({lineStart: true, prefix: "第", numbering: "arabic", suffix: "回", separator: " ", titleOptional: false});

        const result = await runWorkspace(fixture, ["node", "import-book", "book.txt", "--pattern-json", pattern, "--json"]);
        expect(result.code).toBe(0);
        expect(parseJson(result.stdout)).toMatchObject({ok: true, mode: "ai-description", total: 2});
    });

    it("--split-points AI 行号切章", async () => {
        const fixture = await createFixture();
        const book = ["第一章 重生", "第二章 入学", "第三章 试探"]
            .map((heading) => `${heading}\n${Array(20).fill(LONG_BODY).join("\n")}`)
            .join("\n\n");
        await writeFile(join(fixture.workspaceRoot, "book.txt"), book, "utf8");

        const result = await runWorkspace(fixture, ["node", "import-book", "book.txt", "--split-points", "{\"startLines\":[0,2,4]}", "--json"]);
        expect(result.code).toBe(0);
        expect(parseJson(result.stdout)).toMatchObject({ok: true, mode: "split-points", total: 3});
    });

    it("目录输入：优先读 full.md", async () => {
        const fixture = await createFixture();
        const bookDir = join(fixture.workspaceRoot, "reference", "tomato", "test-book");
        await mkdir(bookDir, {recursive: true});
        await writeFile(join(bookDir, "full.md"), buildBook(["第一章 重生", "第二章 入学"]), "utf8");
        await writeFile(join(bookDir, "metadata.json"), JSON.stringify({book_name: "测试书"}), "utf8");

        const result = await runWorkspace(fixture, ["node", "import-book", "reference/tomato/test-book", "--json"]);
        expect(result.code).toBe(0);
        expect(parseJson(result.stdout)).toMatchObject({ok: true, total: 2});
    });
});

type Fixture = {
    workspaceRoot: string;
    env: NodeJS.ProcessEnv;
};

type CliResult = {
    code: number;
    stdout: string;
    stderr: string;
};

async function createFixture(): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), "nbook-import-book-"));
    roots.push(root);
    const stateRoot = join(root, "state");
    const workspaceRoot = join(stateRoot, "workspace");
    await mkdir(workspaceRoot, {recursive: true});
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        NEURO_BOOK_APPLICATION_ROOT: applicationRoot,
        NEURO_BOOK_STATE_ROOT: stateRoot,
        NEURO_BOOK_CACHE_ROOT: join(stateRoot, "cache"),
        NODE_PATH: "",
    };
    delete env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
    return {workspaceRoot, env};
}

async function runWorkspace(fixture: Fixture, args: string[], cwd = fixture.workspaceRoot): Promise<CliResult> {
    return await new Promise((resolveResult, rejectResult) => {
        const bunExecutable = process.versions.bun ? process.execPath : (process.env.BUN || "bun");
        const child = spawn(bunExecutable, ["run", "--no-install", workspaceCommand, ...args], {
            cwd,
            env: fixture.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.once("error", rejectResult);
        child.once("exit", (code, signal) => {
            if (signal) {
                rejectResult(new Error(`workspace CLI 被信号中断：${signal}`));
                return;
            }
            resolveResult({
                code: code ?? 1,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            });
        });
    });
}

function parseJson(stdout: string): unknown {
    return JSON.parse(stdout) as unknown;
}
