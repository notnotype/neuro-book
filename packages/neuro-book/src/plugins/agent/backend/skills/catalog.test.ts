/**
 * Skill 目录（docs/specs/agent/skills.md 输出 1–5、7 与场景 1）：真实文件系统与真实的文件监视。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {SkillCatalog, sourceRoot} from "./catalog";
import {currentPlatform, installInputs, MARKER_FILE, MARKER_SCHEMA} from "./readiness";

let tmp = "";
let counter = 0;
const opened: SkillCatalog[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-agent", "skills-catalog");
});
afterEach(async () => {
    for (const catalog of opened.splice(0)) await catalog.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const skillMd = (name: string, description = `${name} 的说明`, extra = ""): string => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n\n正文。\n`;

async function put(root: string, folder: string, files: Readonly<Record<string, string>>): Promise<string> {
    const directory = join(root, folder);
    for (const [path, content] of Object.entries(files)) {
        await mkdir(join(directory, path, ".."), {recursive: true});
        await writeFile(join(directory, path), content);
    }
    return directory;
}

async function open(options: {readonly which?: (command: string) => string | null; readonly installing?: (id: string) => boolean} = {}) {
    counter += 1;
    const user = join(tmp, `c${String(counter)}`, "user", "skills");
    const builtin = join(tmp, `c${String(counter)}`, "builtin");
    await mkdir(builtin, {recursive: true});
    const reports: Array<{code: string; data?: Readonly<Record<string, unknown>>}> = [];
    const make = () => SkillCatalog.open({
        roots: [sourceRoot("user", user, true), sourceRoot("builtin", builtin, false)],
        clock: systemClock,
        report: (code, _message, data) => reports.push({code, ...(data === undefined ? {} : {data})}),
        which: options.which ?? (() => "/usr/bin/uv"),
        ...(options.installing === undefined ? {} : {installing: options.installing}),
    });
    return {user, builtin, reports, make};
}

describe("目录", () => {
    test("场景 1：一个合法的、一个 name 与目录名不同的、一个多套了一层的：一个可用、两个无效各带原因与诊断；改好之后不重启就可用", async () => {
        const {user, reports, make} = await open();
        await mkdir(user, {recursive: true});
        await put(user, "style-guide", {"SKILL.md": skillMd("style-guide")});
        await put(user, "outline", {"SKILL.md": skillMd("outline-helper")});
        await put(user, "wrapped", {"wrapped/SKILL.md": skillMd("wrapped")});
        const catalog = await make();
        opened.push(catalog);
        expect(catalog.list().map((entry) => [entry.id, entry.status, entry.problem])).toEqual([
            ["user.outline", "invalid", {code: "name-mismatch", name: "outline-helper"}],
            ["user.style-guide", "ready", undefined],
            ["user.wrapped", "invalid", {code: "nested", directory: "wrapped"}],
        ]);
        expect(reports.filter((report) => report.code === "skill-invalid").map((report) => report.data?.id)).toEqual(["user.outline", "user.wrapped"]);
        expect(catalog.item("user.style-guide")?.entry).toMatchObject({name: "style-guide", description: "style-guide 的说明", source: "user", location: "skills://user.style-guide/SKILL.md"});

        let changes = 0;
        catalog.onChanged(() => (changes += 1));
        await writeFile(join(user, "outline", "SKILL.md"), skillMd("outline"));
        await waitUntil("改好后变成可用", () => catalog.item("user.outline")?.entry.status === "ready" || undefined, {timeoutMs: 10_000});
        expect(changes).toBeGreaterThan(0);
        await put(user, "fresh", {"SKILL.md": skillMd("fresh")});
        await waitUntil("新放进来的 Skill 出现", () => catalog.item("user.fresh"), {timeoutMs: 10_000});
        await rm(join(user, "fresh"), {recursive: true});
        await waitUntil("删掉的 Skill 消失", () => catalog.item("user.fresh") === undefined || undefined, {timeoutMs: 10_000});

        // 整个文件夹换掉（删掉再建，解压覆盖常这样做）之后，再改它的 SKILL.md 照样看得到。
        await rm(join(user, "style-guide"), {recursive: true});
        await put(user, "style-guide", {"SKILL.md": skillMd("style-guide", "第二版")});
        await waitUntil("换掉的文件夹读到新的", () => catalog.item("user.style-guide")?.entry.description === "第二版" || undefined, {timeoutMs: 10_000});
        await writeFile(join(user, "style-guide", "SKILL.md"), skillMd("style-guide", "第三版"));
        await waitUntil("换掉之后再改也看得到", () => catalog.item("user.style-guide")?.entry.description === "第三版" || undefined, {timeoutMs: 10_000});
    }, 30_000);

    test("无效的原因：没有 SKILL.md、frontmatter 读不懂、必填字段缺或不合规、目录是链接；可选字段不合规只忽略那个字段", async () => {
        const {user, reports, make} = await open();
        await mkdir(user, {recursive: true});
        await put(user, "empty", {"README.md": "x"});
        await put(user, "no-front", {"SKILL.md": "# 没有 frontmatter\n"});
        await put(user, "bad-yaml", {"SKILL.md": "---\nname: [\n---\n"});
        await put(user, "no-desc", {"SKILL.md": "---\nname: no-desc\n---\n"});
        await put(user, "Bad_Name", {"SKILL.md": skillMd("Bad_Name")});
        await put(user, "loose", {"SKILL.md": skillMd("loose", "说明", "license: MIT\ncompatibility: 3\nmetadata:\n  author: 林默\nwhen_to_use: 改文风时\n")});
        await symlink(join(user, "loose"), join(user, "linked"));
        const catalog = await make();
        opened.push(catalog);
        const problem = (id: string) => catalog.item(id)?.entry.problem?.code;
        expect([problem("user.empty"), problem("user.no-front"), problem("user.bad-yaml"), problem("user.no-desc"), problem("user.Bad_Name"), problem("user.linked")]).toEqual(["skill-md-missing", "frontmatter-unreadable", "frontmatter-unreadable", "field-missing", "field-invalid", "symlink"]);
        expect(catalog.item("user.loose")?.entry).toMatchObject({status: "ready", license: "MIT", metadata: {author: "林默"}, whenToUse: "改文风时"});
        expect(catalog.item("user.loose")?.entry.external).toBeUndefined();
        expect(reports.find((report) => report.code === "skill-field-ignored")?.data).toEqual({id: "user.loose", fields: ["compatibility"]});
    });

    test("依赖：有 package.json 没有标记是未初始化；标记与现状一致才可用；改了 bun.lock 回到未初始化；失败的标记带原因；在装时是正在初始化", async () => {
        let installing = false;
        const {user, make} = await open({installing: () => installing});
        await mkdir(user, {recursive: true});
        const directory = await put(user, "epub-export", {"SKILL.md": skillMd("epub-export"), "package.json": JSON.stringify({name: "x", dependencies: {a: "1.0.0"}}), "bun.lock": "{\"lockfileVersion\": 1,}\n"});
        await put(user, "plain", {"SKILL.md": skillMd("plain")});
        const catalog = await make();
        opened.push(catalog);
        expect(catalog.item("user.epub-export")?.entry.status).toBe("needs-init");
        expect(catalog.item("user.plain")?.entry.status).toBe("ready");

        const marker = async (extra: object = {}) => {
            await mkdir(join(directory, "node_modules"), {recursive: true});
            await writeFile(join(directory, MARKER_FILE), JSON.stringify({schema: MARKER_SCHEMA, runtime: "bun", inputs: await installInputs(directory), platform: currentPlatform(), bun: Bun.version, installedAt: new Date(0).toISOString(), ...extra}));
        };
        await marker();
        await waitUntil("写下标记后可用", () => catalog.item("user.epub-export")?.entry.status === "ready" || undefined, {timeoutMs: 10_000});
        await writeFile(join(directory, "bun.lock"), "{\"lockfileVersion\": 1, \"packages\": {}}\n");
        await waitUntil("锁文件改了回到未初始化", () => catalog.item("user.epub-export")?.entry.status === "needs-init" || undefined, {timeoutMs: 10_000});
        await marker({error: {code: "install-failed", detail: "ETIMEDOUT"}});
        await waitUntil("失败的标记带原因", () => catalog.item("user.epub-export")?.entry.problem?.code === "install-failed" || undefined, {timeoutMs: 10_000});
        installing = true;
        await catalog.refresh("user.epub-export");
        expect(catalog.item("user.epub-export")?.entry).toMatchObject({status: "initializing"});
        expect(catalog.item("user.epub-export")?.entry.problem).toBeUndefined();
    }, 40_000);

    test("外部依赖只报告：Python 的标记文件或两层内带内联依赖的脚本；PATH 上没有 uv 时标出；compatibility 原样带上", async () => {
        const {user, make} = await open({which: () => null});
        await mkdir(user, {recursive: true});
        await put(user, "py-project", {"SKILL.md": skillMd("py-project"), "pyproject.toml": "[project]\n"});
        await put(user, "py-inline", {"SKILL.md": skillMd("py-inline", "说明", "compatibility: 要自己装 espeak-ng\n"), "scripts/run.py": "# /// script\n# dependencies = [\"requests\"]\n# ///\n"});
        await put(user, "py-deep", {"SKILL.md": skillMd("py-deep"), "a/b/run.py": "# /// script\n# ///\n"});
        const catalog = await make();
        opened.push(catalog);
        expect(catalog.item("user.py-project")?.entry).toMatchObject({status: "ready", external: {python: true, uvMissing: true}});
        expect(catalog.item("user.py-inline")?.entry.external).toEqual({python: true, uvMissing: true, compatibility: "要自己装 espeak-ng"});
        expect(catalog.item("user.py-deep")?.entry.external).toBeUndefined();
    });
});

describe("插件来源", () => {
    test("插件的根随贡献增删：id 是插件 id 加文件夹名，不用初始化就可用，带 package.json 的无效；同一插件两个根里的同名只留 key 在前的；排在我的与内置之间", async () => {
        const {user, builtin, reports, make} = await open();
        await mkdir(user, {recursive: true});
        await put(user, "notes", {"SKILL.md": skillMd("notes")});
        await put(builtin, "summary", {"SKILL.md": skillMd("summary")});
        const catalog = await make();
        opened.push(catalog);
        const pack = join(tmp, `c${String(counter)}`, "plugin");
        await put(pack, "a/pdf", {"SKILL.md": skillMd("pdf"), "scripts/run.ts": "console.log(1);\n"});
        await put(pack, "a/unbuilt", {"SKILL.md": skillMd("unbuilt"), "package.json": "{}"});
        await put(pack, "b/pdf", {"SKILL.md": skillMd("pdf", "另一份")});
        let changes = 0;
        catalog.onChanged(() => (changes += 1));
        const plugin = {id: "acme.docs", title: "文档工具"};
        // 后加的根 key 在前：留下的按 key 排，不按加的先后。
        await catalog.addRoot({key: "acme.docs.b", source: "plugin", prefix: plugin.id, root: join(pack, "b"), watch: false, plugin});
        await catalog.addRoot({key: "acme.docs.a", source: "plugin", prefix: plugin.id, root: join(pack, "a"), watch: false, plugin});
        expect(catalog.list().map((entry) => [entry.id, entry.source, entry.status, entry.problem])).toEqual([
            ["user.notes", "user", "ready", undefined],
            ["acme.docs.pdf", "plugin", "ready", undefined],
            ["acme.docs.unbuilt", "plugin", "invalid", {code: "plugin-skill-unbuilt"}],
            ["builtin.summary", "builtin", "ready", undefined],
        ]);
        expect(catalog.item("acme.docs.pdf")).toMatchObject({directory: join(pack, "a", "pdf"), entry: {plugin, location: "skills://acme.docs.pdf/SKILL.md", description: "pdf 的说明"}});
        expect(reports.filter((report) => report.code === "skill-duplicate").map((report) => report.data)).toEqual([{id: "acme.docs.pdf", kept: "acme.docs.a", skipped: "acme.docs.b"}]);
        expect(changes).toBe(2);

        // 拿掉 key 在前的根，另一份顶上；都拿掉后只剩我的与内置的。
        await catalog.removeRoot("acme.docs.a");
        expect(catalog.item("acme.docs.pdf")?.entry.description).toBe("另一份");
        expect(catalog.item("acme.docs.unbuilt")).toBeUndefined();
        await catalog.removeRoot("acme.docs.b");
        expect(catalog.list().map((entry) => entry.id)).toEqual(["user.notes", "builtin.summary"]);
        expect(changes).toBe(4);

        // 同一个 key 的根换到另一份目录（插件换了版本目录），条目一样也通知：`skills://` 指向的路径变了。
        await put(pack, "c/pdf", {"SKILL.md": skillMd("pdf")});
        await put(pack, "d/pdf", {"SKILL.md": skillMd("pdf")});
        await catalog.addRoot({key: "acme.docs.a", source: "plugin", prefix: plugin.id, root: join(pack, "c"), watch: false, plugin});
        await catalog.addRoot({key: "acme.docs.a", source: "plugin", prefix: plugin.id, root: join(pack, "d"), watch: false, plugin});
        expect([catalog.item("acme.docs.pdf")?.directory, changes]).toEqual([join(pack, "d", "pdf"), 6]);
    });
});

describe("认标签", () => {
    test("先按 id，再按名字：白名单里恰好一个就是它；不止一个是 ambiguous；都不在是 not-allowed；没有同名是 not-found；无效的是 invalid", async () => {
        const {user, builtin, make} = await open();
        await mkdir(user, {recursive: true});
        await put(user, "review", {"SKILL.md": skillMd("review")});
        await put(builtin, "review", {"SKILL.md": skillMd("review")});
        await put(user, "outline", {"SKILL.md": skillMd("outline-helper")});
        const catalog = await make();
        opened.push(catalog);
        const resolve = (token: string, allowed: readonly string[]) => {
            const result = catalog.resolveToken(token, new Set(allowed));
            return result.ok ? result.item.entry.id : result.reason;
        };
        expect(resolve("review", ["user.review"])).toBe("user.review");
        expect(resolve("review", ["user.review", "builtin.review"])).toBe("ambiguous");
        expect(resolve("builtin.review", ["user.review", "builtin.review"])).toBe("builtin.review");
        expect(resolve("builtin.review", ["user.review"])).toBe("not-allowed");
        expect(resolve("review", [])).toBe("not-allowed");
        expect(resolve("nothing", ["user.review"])).toBe("not-found");
        expect(resolve("outline", ["user.outline"])).toBe("invalid");
        expect(catalog.list().map((entry) => entry.id)).toEqual(["user.outline", "user.review", "builtin.review"]);
    });
});
