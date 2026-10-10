/**
 * 项目实例里的作品统计（docs/specs/runtime/projects.md 输出第 16 条，验收 16）：统计接在真实的 Files 场地上（服务端、项目
 * 实例与窗口都是真实内核实例，文件在真实临时目录，变更来自真实的递归监视与文件服务），经项目实例里的本地远程调用订阅
 * `nbook.files/project`。外部修改的一批要推进场地的手动时钟才发出；统计自己的时间（今天、最近编辑的时刻）用另一个手动
 * 时钟，跨午夜由测试推进。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, rename, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BATCH_DELAY_MS, MAX_BATCH_PATHS} from "nbook/plugins/files/backend/changes";
import {projectFilesContract, TEXT_BUDGET_BYTES} from "nbook/plugins/files/shared/contracts";
import type {WatchMessage} from "nbook/plugins/files/shared/contracts";
import {files, filesScene, remote} from "nbook/plugins/files/testing/scene";
import type {Layout, Scene} from "nbook/plugins/files/testing/scene";

import {localDate} from "./backend/shelf";
import {createStatsTracker, lastParagraphExcerpt} from "./project/stats-tracker";
import type {StatsTracker} from "./project/stats-tracker";
import {SHELF_EXCERPT_MAX_LENGTH} from "./shared/contracts";
import type {ProjectStatsSnapshot} from "./shared/contracts";

let tmp = "";
let counter = 0;
const closers: Array<() => Promise<void>> = [];
/** root 读得了任何文件：权限那一例只在普通用户下跑。 */
const privileged = process.getuid?.() === 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "stats-tracker");
});

afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function scene(project: Layout = {}): Promise<Scene> {
    counter += 1;
    const created = await filesScene(join(tmp, `case-${String(counter)}`), {project});
    closers.push(async () => {
        const results = await created.world.close();
        await rm(created.root, {recursive: true, force: true});
        for (const result of results) expect(result).toMatchObject({status: "closed"});
    });
    return created;
}

interface Tracked {
    readonly tracker: StatsTracker;
    readonly clock: ManualClock;
    readonly records: Array<Omit<DiagnosticInput, "source">>;
    /** 统计报告快照变化的次数。 */
    changes(): number;
}

/** 本地时间的毫秒数（月份从 1 起）。 */
const at = (year: number, month: number, day: number, hour = 0, minute = 0): number => new Date(year, month - 1, day, hour, minute).getTime();

/** 在项目实例里起统计：订阅走测试插件 `x.project` 的远程门面，与产品入口同一条本地路径。 */
function track(created: Scene, options: {readonly initial?: ProjectStatsSnapshot | null; readonly now?: number} = {}): Tracked {
    const clock = new ManualClock();
    clock.advance(options.now ?? at(2026, 10, 10, 10));
    const records: Array<Omit<DiagnosticInput, "source">> = [];
    let changes = 0;
    const client = remote(created.inProject).use(projectFilesContract);
    const tracker = createStatsTracker({
        root: created.project,
        clock,
        initial: options.initial ?? null,
        subscribe: (listener, subscribeOptions) => client.events.changes.subscribe({}, listener, subscribeOptions),
        record: (input) => records.push(input),
        changed: () => {
            changes += 1;
        },
    });
    closers.push(async () => {
        await tracker.stop();
    });
    tracker.start();
    return {tracker, clock, records, changes: () => changes};
}

async function completed(tracker: StatsTracker): Promise<ProjectStatsSnapshot> {
    return waitUntil("首次统计完成", () => {
        const state = tracker.current();
        return state.status === "complete" ? state.snapshot : null;
    });
}

/** 推进场地的时钟（外部修改合并一批后才发出），直到统计的快照满足条件。 */
function settled(created: Scene, tracker: StatsTracker, description: string, check: (snapshot: ProjectStatsSnapshot) => boolean): Promise<ProjectStatsSnapshot> {
    return waitUntil(description, () => {
        created.world.clock.advance(BATCH_DELAY_MS);
        const snapshot = tracker.snapshot();
        return snapshot !== null && check(snapshot) ? snapshot : null;
    });
}

/** 经文件服务保存（窗口里的写作者）。 */
async function save(created: Scene, path: string, text: string): Promise<void> {
    const client = files(created.window);
    const read = await client.read(`project://${path}`);
    if (!read.ok) throw new Error(`读 ${path} 失败：${read.code}`);
    expect(await client.write(`project://${path}`, text, read.value.baseline)).toMatchObject({ok: true});
}

/** 记录里的一份快照。 */
function recorded(fields: {readonly words: number; readonly date: string; readonly baseline: number; readonly last?: ProjectStatsSnapshot["last"]}): ProjectStatsSnapshot {
    return {computedAt: "2026-10-09T08:30:00.000Z", words: fields.words, files: 2, unreadable: 0, today: {date: fields.date, baseline: fields.baseline}, last: fields.last ?? null};
}

const hanzi = (count: number): string => "字".repeat(count);

describe("Spec projects 输出 16、验收 16：口径", () => {
    it("非隐藏的 .md 都计入（内容文件夹的 index.md、活页夹章节、大写扩展名），frontmatter 不计；隐藏目录与文件、非 .md、符号链接不计；读不出的文件计入 unreadable", async () => {
        const created = await scene({
            "第一章.md": "---\ntitle: 不计\n---\n天地玄黄",
            "设定.content/content.xml": "<content><item name=\"人物\"/></content>",
            "设定.content/index.md": "宇宙洪荒",
            "设定.content/人物/index.md": "日月",
            "正文.binder/001.md": "rain falls",
            "附录.MD": "一",
            ".hidden/秘密.md": hanzi(100),
            ".草稿.md": hanzi(100),
            ".nbook/记录.md": hanzi(100),
            "正文.binder/.trash/旧.md": hanzi(100),
            "notes.txt": hanzi(100),
            "坏.md": new Uint8Array([0xe5, 0xad]),
            "零.md": new Uint8Array([0x41, 0x00, 0x42]),
            "大.md": "a".repeat(TEXT_BUDGET_BYTES + 1),
        });
        await symlink(join(created.project, "第一章.md"), join(created.project, "链接.md"));
        const {tracker} = track(created);
        expect(tracker.current()).toEqual({status: "counting", snapshot: null});

        const snapshot = await completed(tracker);
        expect(snapshot).toEqual({
            computedAt: new Date(at(2026, 10, 10, 10)).toISOString(),
            words: 13,
            files: 5,
            unreadable: 3,
            // 从没统计过：第一次扫完的总字数就是基线。
            today: {date: "2026-10-10", baseline: 13},
            last: null,
        });
    });

    it.skipIf(privileged)("没有读权限的文件计入 unreadable，不按 0 字计", async () => {
        const created = await scene({"a.md": "天地", "锁.md": hanzi(10)});
        await chmod(join(created.project, "锁.md"), 0o000);
        const {tracker} = track(created);
        expect(await completed(tracker)).toMatchObject({words: 2, files: 1, unreadable: 1});
        await chmod(join(created.project, "锁.md"), 0o644);
    });

    it("最近编辑的片段：最后一个非空段落去掉行首标记，frontmatter 不算段落，至多 120 个字符", () => {
        expect(lastParagraphExcerpt("---\ntitle: x\n---\n# 第一章\n\n风停了。\n\n> - 雨还在下，\n> 夜很长。\n\n")).toBe("雨还在下， 夜很长。");
        expect(lastParagraphExcerpt("正文\n\n## 第二节\n")).toBe("第二节");
        expect(lastParagraphExcerpt("1. 第一\n2) 第二\n\n***\n")).toBe("第一 第二");
        expect(lastParagraphExcerpt("-不是列表\n#话题")).toBe("-不是列表 #话题");
        expect(lastParagraphExcerpt("---\ntitle: 只有 frontmatter\n---\n")).toBe("");
        expect(lastParagraphExcerpt(`${hanzi(200)}😀`)).toBe(hanzi(SHELF_EXCERPT_MAX_LENGTH));
    });
});

describe("Spec projects 输出 16、验收 16：顺序与事件", () => {
    it("扫描期间的修改、目录移入与删除都在扫完后按顺序结算；变更先于扫描订阅，不漏", async () => {
        const layout: Record<string, string> = {"卷二/甲.md": "甲甲", "卷二/乙.md": "乙乙"};
        // 足够多的文件让首扫跨过下面的几步，“扫描期间”由每步之后的断言确认。
        for (let index = 1; index <= 800; index += 1) layout[`卷一/第${String(index)}章.md`] = hanzi(500);
        const created = await scene(layout);
        await mkdir(join(created.root, "外", "深"), {recursive: true});
        await writeFile(join(created.root, "外", "深", "丙.md"), "丙丁");
        const seen: WatchMessage[] = [];
        const probe = await remote(created.inProject).use(projectFilesContract).events.changes.subscribe({}, (message) => seen.push(message));
        if (!probe.ok) throw new Error(probe.code);
        closers.push(async () => probe.value.release());
        const events = (): string[] => seen.flatMap((message) => (message.kind === "batch" ? message.events.map((event) => `${event.type} ${event.path}`) : []));

        const {tracker} = track(created);
        await save(created, "卷一/第1章.md", "改过了");
        expect(events()).toContain("changed 卷一/第1章.md");
        expect(tracker.current().status).toBe("counting");
        await rename(join(created.root, "外"), join(created.project, "外来"));
        await rm(join(created.project, "卷二"), {recursive: true});
        await waitUntil("目录移入与删除的外部事件", () => {
            created.world.clock.advance(BATCH_DELAY_MS);
            return events().includes("changed 外来") && events().includes("deleted 卷二");
        });
        expect(tracker.current().status).toBe("counting");

        const snapshot = await settled(created, tracker, "结算完扫描期间的变化", (current) => current.files === 801);
        expect(snapshot).toMatchObject({words: 799 * 500 + 3 + 2, files: 801, unreadable: 0});
        expect(snapshot.last).toMatchObject({address: "project://卷一/第1章.md", label: "第1章", excerpt: "改过了"});
    });

    it("resync（一批变化太多）标记重扫：重扫后的数字含这批文件", async () => {
        const created = await scene({"a.md": "天地"});
        const {tracker} = track(created);
        await completed(tracker);
        await mkdir(join(created.project, "批"));
        for (let index = 0; index <= MAX_BATCH_PATHS; index += 1) await writeFile(join(created.project, "批", `${String(index)}.md`), "字");
        const snapshot = await settled(created, tracker, "重扫完成", (current) => current.files === MAX_BATCH_PATHS + 2);
        expect(snapshot.words).toBe(2 + MAX_BATCH_PATHS + 1);
    });

    it("新建空文件只计数、不算最近编辑；新建目录与复制进来的目录触发重扫", async () => {
        const created = await scene({"a.md": "天地"});
        const {tracker} = track(created);
        await completed(tracker);
        const client = files(created.window);
        expect(await client.create("project://新.md", "file")).toMatchObject({ok: true});
        expect(await settled(created, tracker, "新文件计入", (current) => current.files === 2)).toMatchObject({words: 2, last: null});

        expect(await client.create("project://卷", "directory")).toMatchObject({ok: true});
        await writeFile(join(created.project, "卷", "c.md"), "辰");
        const copied = await client.copy([{source: "project://卷", target: "project://卷副本"}]).result;
        expect(copied).toMatchObject({ok: true});
        expect(await settled(created, tracker, "目录与复制计入", (current) => current.files === 4)).toMatchObject({words: 4});
    });
});

describe("Spec projects 输出 16、验收 16：最近编辑", () => {
    it("只由观察到的修改设置（经文件服务保存或外部修改）；改名跟到新地址，目录改名也跟随；删除清空", async () => {
        const created = await scene({"卷一/第一章.md": "# 第一章\n\n风停了。", "b.md": "乙"});
        const tracked = track(created);
        const {tracker, clock} = tracked;
        expect((await completed(tracker)).last).toBeNull();

        clock.advance(60_000);
        await save(created, "卷一/第一章.md", "# 第一章\n\n风停了。\n\n> - 雨还在下，\n> 夜很长。\n");
        const edited = {address: "project://卷一/第一章.md", label: "第一章", at: new Date(clock.now()).toISOString(), excerpt: "雨还在下， 夜很长。"};
        expect((await settled(created, tracker, "保存后", (current) => current.last !== null)).last).toEqual(edited);

        const client = files(created.window);
        expect(await client.rename("project://卷一/第一章.md", "序章.md")).toMatchObject({ok: true});
        expect((await settled(created, tracker, "改名后", (current) => current.last?.label === "序章")).last).toEqual({...edited, address: "project://卷一/序章.md", label: "序章"});

        expect(await client.rename("project://卷一", "第一卷")).toMatchObject({ok: true});
        expect((await settled(created, tracker, "目录改名后", (current) => current.last?.address === "project://第一卷/序章.md")).last).toEqual({...edited, address: "project://第一卷/序章.md", label: "序章"});

        expect(await client.delete([{address: "project://第一卷/序章.md"}]).result).toMatchObject({ok: true});
        expect(await settled(created, tracker, "删除后", (current) => current.files === 1)).toMatchObject({words: 1, last: null});

        clock.advance(60_000);
        await writeFile(join(created.project, "b.md"), "外面改的\n\n第二段");
        const external = await settled(created, tracker, "外部修改后", (current) => current.last !== null);
        expect(external).toMatchObject({words: 7, last: {address: "project://b.md", label: "b", at: new Date(clock.now()).toISOString(), excerpt: "第二段"}});
    });

    it("重开后沿用记录里的最近编辑；首扫时它指的文件不在了就清空", async () => {
        const kept = {address: "project://b.md", label: "b", at: "2026-10-09T08:29:00.000Z", excerpt: "乙"};
        const created = await scene({"a.md": "甲", "b.md": "乙"});
        const first = track(created, {initial: recorded({words: 2, date: "2026-10-10", baseline: 2, last: kept})});
        expect(first.tracker.current()).toMatchObject({status: "counting", snapshot: {last: kept}});
        expect((await completed(first.tracker)).last).toEqual(kept);

        const gone = await scene({"a.md": "甲"});
        const second = track(gone, {initial: recorded({words: 2, date: "2026-10-10", baseline: 2, last: kept})});
        expect((await completed(second.tracker)).last).toBeNull();
    });
});

describe("Spec projects 输出 16、验收 16：今天", () => {
    it("23:59 写的字算当天；跨过午夜先把基线换成当时的总数，00:05 写的字算次日的首笔", async () => {
        const created = await scene({"a.md": "一二三"});
        const {tracker, clock} = track(created, {now: at(2026, 10, 10, 23, 50)});
        expect((await completed(tracker)).today).toEqual({date: "2026-10-10", baseline: 3});

        clock.advance(at(2026, 10, 10, 23, 59) - clock.now());
        await save(created, "a.md", "一二三四五");
        expect(await settled(created, tracker, "23:59 的修改", (current) => current.words === 5)).toMatchObject({today: {date: "2026-10-10", baseline: 3}});

        // 没有任何修改也在午夜换基线。
        clock.advance(at(2026, 10, 11, 0, 5) - clock.now());
        expect(tracker.snapshot()).toMatchObject({words: 5, today: {date: "2026-10-11", baseline: 5}});
        await save(created, "a.md", "一二三四五六");
        expect(await settled(created, tracker, "00:05 的修改", (current) => current.words === 6)).toMatchObject({today: {date: "2026-10-11", baseline: 5}});
    });

    it("当天重开沿用记录的基线；离线跨日后以记录的总字数作基线（离线期间的外部修改算进打开当天）", async () => {
        const created = await scene({"a.md": hanzi(80), "b.md": hanzi(80)});
        const sameDay = track(created, {initial: recorded({words: 150, date: "2026-10-10", baseline: 100})});
        expect(await completed(sameDay.tracker)).toMatchObject({words: 160, today: {date: "2026-10-10", baseline: 100}});

        const nextDay = track(created, {initial: recorded({words: 150, date: "2026-10-09", baseline: 100})});
        expect(nextDay.tracker.current()).toEqual({status: "counting", snapshot: recorded({words: 150, date: "2026-10-09", baseline: 100})});
        expect(await completed(nextDay.tracker)).toMatchObject({words: 160, today: {date: localDate(nextDay.clock.now()), baseline: 150}});
    });
});

describe("Spec projects 输出 16：结束与停止", () => {
    it("订阅结束（项目目录被移走）后状态为 ended，不再更新", async () => {
        const created = await scene({"a.md": "天地"});
        const {tracker, records} = track(created);
        await completed(tracker);
        await rename(created.project, `${created.project}-moved`);
        await waitUntil("订阅结束", () => {
            created.world.clock.advance(BATCH_DELAY_MS);
            return tracker.current().status === "ended";
        });
        expect(tracker.current()).toMatchObject({status: "ended", snapshot: {words: 2}});
        expect(records.map((record) => record.event)).toContain("projects.stats.ended");
        await rename(`${created.project}-moved`, created.project);
    });

    it("首扫没完成就停止：不给快照（调用方不写）；首扫完成后停止：等在途的重读结算完再给快照", async () => {
        const created = await scene({"a.md": "天地"});
        const early = track(created);
        expect(await early.tracker.stop()).toBeNull();

        const later = track(created);
        await completed(later.tracker);
        // 保存的事件在保存返回之前就已发出：停止时这次重读正在途中。
        await save(created, "a.md", "天地玄黄");
        expect(await later.tracker.stop()).toMatchObject({words: 4, last: {address: "project://a.md"}});
        expect(later.tracker.current()).toMatchObject({status: "complete", snapshot: {words: 4}});
    });

    it("快照变化时通知写入方；停止开始后不再通知", async () => {
        const created = await scene({"a.md": "天地"});
        const tracked = track(created);
        await completed(tracked.tracker);
        expect(tracked.changes()).toBe(1);
        await save(created, "a.md", "天地玄");
        await settled(created, tracked.tracker, "保存后", (current) => current.words === 3);
        expect(tracked.changes()).toBe(2);
        await tracked.tracker.stop();
        tracked.clock.advance(24 * 60 * 60 * 1000);
        expect(tracked.changes()).toBe(2);
    });
});
