/**
 * 星瑕样本项目（canon-sample.ts）：生成出来的目录是一部能打开的作品；用产品打开世界的那段代码（`createWorldHost`）重新打开，
 * 条目、马甲关系、内置类型的字段都在，三章都在章表里，星瑕的主文字渲染出来没有坏块、马甲的外貌不是占位；换到内置的人物与形象
 * 两组以后，每个读取位置上的值与原型算出来的逐项相同。
 * 带剧情数据的那份（`--plot`）由真实的项目子进程（canon 与剧情的项目入口）打开，窗口经 `nbook.plot/author` 读出样本里的剧情。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {cp, readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {RemoteUse} from "@notnotype/nb-runtime/remote";
import type {AuthorBlock, AuthorValue, ReadPosition} from "@notnotype/nb-canon";
import {loadXingxiaSample} from "@notnotype/nb-canon/sample";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createWorldHost} from "../src/plugins/canon/backend/world-host";
import {BUILTIN_COMPONENTS} from "../src/plugins/canon/shared/components";
import {serverPlugins, until, windowOf} from "../src/plugins/canon/testing/harness";
import {plotAuthorContract} from "../src/plugins/plot/shared/author";
import {killSpawnedProjects, leaseOf, projectHarness} from "../src/server/testing/projects";
import type {ProjectHarness} from "../src/server/testing/projects";
import {writeCanonSample} from "./canon-sample";
import type {CanonSampleResult} from "./canon-sample";

let tmp = "";
let result: CanonSampleResult;
const project = (): string => join(tmp, "星瑕");

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "sample-project");
    result = await writeCanonSample(project());
});

afterAll(async () => {
    await rm(tmp, {recursive: true, force: true});
});

describe("星瑕样本项目", () => {
    it("是一部作品：作品清单、活页夹三章、世界日志都在；重新打开世界读得到样本里的条目与修订", async () => {
        expect(JSON.parse(await readFile(join(project(), ".nbook", "project.json"), "utf8"))).toMatchObject({schema: 1, id: result.projectId});
        expect(result.revisions).toBe(12);

        const host = createWorldHost(project(), () => undefined);
        host.setComponents(BUILTIN_COMPONENTS);
        try {
            const service = await host.ready();
            if ("code" in service) throw new Error(service.code);
            expect(service.status().version).toBe(result.revisions);
            expect(service.chapters().items.map((chapter) => [chapter.id, chapter.title])).toEqual([["1", "好哥哥真难当"], ["2", "用钱说话"], ["3", null]]);

            const roots = service.tree(null, undefined, 500);
            if (roots === "cursor-stale") throw new Error(roots);
            const star = roots.items.find((item) => item.name === "星瑕")!;
            expect(star).toMatchObject({folder: "人物", hasChildren: true});
            const below = service.tree(star.id, undefined, 500);
            if (below === "cursor-stale") throw new Error(below);
            expect(below.items.map((item) => item.name)).toContain("哥哥");

            const end = {kind: "chapter" as const, chapter: "2", edge: "end" as const};
            const read = service.entry(star.id, end, "actual");
            if (typeof read === "string" || read.view === null) throw new Error(JSON.stringify(read));
            expect(read.view.namespaces.character?.type).toBe("nbook.canon.person");
            // 这本书专有的“身体”“现在的样子”是星瑕自己声明的字段；“现在的态度”在星瑾身上，不在她身上。
            expect(Object.keys(read.view.namespaces.character?.fields ?? {})).toEqual(expect.arrayContaining(["性格", "现在的状态", "身体", "样子"]));
            expect(Object.keys(read.view.namespaces.character?.fields ?? {})).not.toContain("态度");
            expect("declarations" in read ? read.declarations.character?.filter((field) => ["身体", "样子"].includes(field.id)).map((field) => [field.label, field.kind]) : []).toEqual([["身体", "enum"], ["现在的样子", "enum"]]);
            expect(read.view.namespaces.look).toMatchObject({type: "nbook.canon.look", fields: {外貌: {value: "淡金色长发及腰，浅灰蓝的眼睛，个子娇小"}}});
            const sister = service.entry(roots.items.find((item) => item.name === "星瑾")!.id, end, "actual");
            if (typeof sister === "string" || sister.view === null) throw new Error(JSON.stringify(sister));
            expect(Object.keys(sister.view.namespaces.character?.fields ?? {})).toContain("态度");
            expect(read.view.namespaces.panel?.type).toBe("nbook.canon.panel");
            expect(typeof read.view.namespaces.panel?.fields.存款?.value).toBe("number");
            expect(read.view.namespaces.identity).toBeUndefined();

            const rendered = service.render(star.id, end, "actual", "author");
            if (rendered === null || typeof rendered === "string") throw new Error(String(rendered));
            const blocks = rendered.blocks as readonly AuthorBlock[];
            expect(blocks.filter((block) => "error" in block)).toEqual([]);
            const values: AuthorValue[] = blocks.flatMap((block) => ("values" in block ? [...block.values] : []));
            // 马甲的外观原来在身份块里，现在是它自己的形象的外貌：文字里引用它的地方读得到值，不是读不到。
            expect(values.filter((value) => "unavailable" in value && value.unavailable !== undefined)).toEqual([]);
            expect(values.some((value) => value.tag === "V" && "path" in value && value.path === "look.外貌" && value.entry !== null && value.entry !== undefined)).toBe(true);
        } finally {
            await host.stop();
        }
    });

    it("换到人物与形象两组以后，每个读取位置上的外貌、性格、身体、样子与面板的数都和原型算出来的相同", async () => {
        const prototype = await loadXingxiaSample();
        const host = createWorldHost(project(), () => undefined);
        host.setComponents(BUILTIN_COMPONENTS);
        try {
            const service = await host.ready();
            if ("code" in service) throw new Error(service.code);
            const ids = new Map<string, string>();
            const walk = (parent: string | null): void => {
                const page = service.tree(parent, undefined, 500);
                if (page === "cursor-stale") throw new Error(page);
                for (const item of page.items) {
                    ids.set(item.name, item.id);
                    if (item.hasChildren) walk(item.id);
                }
            };
            walk(null);
            /** 原型里一个条目在一个位置上要比的值：地址换成内置类型的；没有值的不列。 */
            const expectedOf = (data: Readonly<Record<string, {readonly fields: Readonly<Record<string, unknown>>}>>): Record<string, unknown> => {
                const person = data.character?.fields ?? {};
                const all: Record<string, unknown> = {
                    "look.外貌": person.外观 ?? data.identity?.fields.外观,
                    "character.性格": person.性格,
                    "character.身体": person.身体,
                    "character.样子": person.样子,
                    ...Object.fromEntries(["存款", "魔力", "魔力上限", "回溯"].map((field) => [`panel.${field}`, data.panel?.fields[field]])),
                };
                return Object.fromEntries(Object.entries(all).filter(([, value]) => value !== null && value !== undefined));
            };
            let compared = 0;
            for (const result of prototype.results) {
                const at = result.position as {kind: string; chapter?: string};
                const position = (at.chapter === undefined ? at : {...at, chapter: at.chapter.replace(/^ch/u, "")}) as ReadPosition;
                for (const entry of Object.values(result.entries)) {
                    const expected = expectedOf(entry.state.data);
                    if (!entry.appeared || Object.keys(expected).length === 0) continue;
                    const read = service.entry(ids.get(entry.state.name)!, position, "actual");
                    if (typeof read === "string" || read.view === null) throw new Error(`${entry.state.name}: ${JSON.stringify(read)}`);
                    const namespaces = read.view.namespaces;
                    const actual = Object.fromEntries(Object.keys(expected).map((address) => {
                        const [namespace, field] = address.split(".") as [string, string];
                        return [address, namespaces[namespace]?.fields[field]?.value];
                    }));
                    expect({entry: entry.state.name, position, values: actual}).toEqual({entry: entry.state.name, position, values: expected});
                    compared += Object.keys(expected).length;
                }
            }
            // 确实比到了东西：七个位置上至少有星瑕的外貌、性格、身体、样子与存款。
            expect(compared).toBeGreaterThan(30);
        } finally {
            await host.stop();
        }
    });
});

describe("带剧情数据的星瑕样本（--plot）", () => {
    /** 用例起的场地：结束时停服务端实例（连同项目子进程）并核对正常关闭；强杀只兜底（测试起的资源要收口）。 */
    const harnesses: ProjectHarness[] = [];
    afterEach(async () => {
        try {
            for (const harness of harnesses.splice(0)) expect(await harness.parent.stop()).toMatchObject({status: "closed"});
        } finally {
            killSpawnedProjects();
        }
    });

    it("项目子进程打开它：秘密、读者从哪一段起、伏笔各阶段、目标的受挫与冲突、待定决策都读得出来；换到回溯线上星瑾的知情不同", async () => {
        // 生成在别处，再把活页夹与世界日志拷进场地登记好的作品目录（身份文件用场地的）。
        const generated = join(tmp, "星瑕-剧情");
        const sample = await writeCanonSample(generated, {plot: true});
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: async (paths) => {
            await cp(join(generated, "manuscripts.binder"), join(paths.project.path, "manuscripts.binder"), {recursive: true});
            await cp(join(generated, ".nbook", "world"), join(paths.project.path, ".nbook", "world"), {recursive: true});
        }});
        harnesses.push(h);
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        let use: RemoteUse<typeof plotAuthorContract> | null = null;
        const caller = {id: "test.plot-author", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
            use = context.remote.use(plotAuthorContract);
            return {};
        }})]};
        const window = await windowOf(h, "browser-1", "profile-1", [caller]);
        try {
            await until(async () => {
                const status = await window.canon.call("status", {});
                return status.ok && status.value.version >= sample.revisions;
            });
            const author = use!;
            const ok = <T>(result: {readonly ok: boolean; readonly value?: unknown}): T => {
                expect(result.ok).toBe(true);
                return result.value as T;
            };
            type Named = {readonly names: Readonly<Record<string, {readonly name: string}>>};
            const idOf = (value: Named, name: string): string => Object.entries(value.names).find(([, named]) => named.name === name)![0];

            // 保密表：主体按条目树的顺序（星瑕的四个、父母的一个）；缺省点名三个主要角色；读者从哪一段起是正文算的；“没打算怎么揭”
            // 只有读者还不知道、没有计划与决策的那一个。
            type Secrets = Named & {readonly people: readonly string[]; readonly counts: Record<string, number>; readonly items: readonly {readonly point: string; readonly secrecy: string; readonly people: Readonly<Record<string, {readonly degree: string; readonly belief: string | null}>>; readonly reader: {readonly degree: string; readonly suspects: {readonly chapter: string; readonly paragraph: number} | null; readonly knows: {readonly chapter: string; readonly paragraph: number} | null}}[]};
            const secrets = ok<Secrets>(await author.secrets({}));
            const name = (id: string): string => secrets.names[id]!.name;
            expect(secrets.items.map((row) => name(row.point))).toEqual(["哥哥就是星瑕", "星瑕做过魔法少女", "软禁处留着的是魔偶", "那几年哥哥是被软禁", "父母没有死"]);
            expect(secrets.counts).toEqual({all: 5, readerOnly: 0, readerUnaware: 2, noPlan: 1});
            expect(secrets.people.map(name).sort()).toEqual(["彗", "星瑕", "星瑾"].sort());
            const jin = idOf(secrets, "星瑾");
            const [brother, magical, , prisoned, parents] = secrets.items;
            expect(brother).toMatchObject({secrecy: "secret", people: {[jin]: {degree: "none"}}, reader: {degree: "knows", knows: {chapter: "1", paragraph: 8}}});
            expect(magical).toMatchObject({people: {[jin]: {degree: "forgot"}}, reader: {degree: "knows", knows: {chapter: "1", paragraph: 13}}});
            expect(prisoned).toMatchObject({people: {[jin]: {degree: "misbelieves", belief: "哥哥那几年不想回家，也不想管她"}}, reader: {degree: "suspects", suspects: {chapter: "2", paragraph: 10}, knows: null}});
            expect(parents).toMatchObject({secrecy: "topSecret", reader: {degree: "unaware"}});

            // 谁知道：彗在前史的逃脱里在场推出；挂着一条第 3 章到期的待定决策；星瑾的态度起因是它。
            type Point = Named & {readonly people: readonly {readonly person: string; readonly degree: string; readonly origin: {readonly kind: string} | null}[]; readonly related: {readonly decisions: readonly {readonly id: string; readonly text: string; readonly status: string; readonly conclusion: string | null; readonly due: string | null}[]; readonly attitudes: readonly {readonly holder: string}[]}};
            const point = ok<Point>(await author.point({point: prisoned!.point}));
            expect(point.people.find((row) => row.person === idOf(point, "彗"))).toMatchObject({degree: "knows", origin: {kind: "event"}});
            expect(point.related.decisions).toEqual([{id: expect.any(String), text: "什么时候让星瑾知道那几年的事", status: "pending", conclusion: null, due: "3"}]);
            expect(point.related.attitudes.map((attitude) => attitude.holder)).toEqual([jin]);

            // 伏笔账本：第 2 章末尾看，六个伏笔各在一个阶段，“接下来”是第 3 章的计划；第 3 章末尾“星瑾不吃煎蛋”久没提。
            type Ledger = Named & {readonly counts: Record<string, number>; readonly items: readonly {readonly id: string; readonly stage: string; readonly dropped: boolean; readonly silence: {readonly long: boolean} | null; readonly next: {readonly role: string; readonly chapter: string} | null}[]};
            const ledger = ok<Ledger>(await author.ledger({segment: "all", position: {kind: "chapter", chapter: "2", edge: "end"}}));
            const thread = (label: string) => ledger.items.find((row) => ledger.names[row.id]!.name === label)!;
            expect(thread("那张卡")).toMatchObject({stage: "echoing", next: {role: "payoff", chapter: "3"}});
            expect(thread("彗做的魔偶")).toMatchObject({stage: "unplanted", next: {role: "plant", chapter: "3"}});
            expect(thread("彗的五条建议")).toMatchObject({stage: "paidOff"});
            expect(thread("被划掉的第五条")).toMatchObject({dropped: true});
            expect(thread("淡金色的头发")).toMatchObject({stage: "planted"});
            const later = ok<Ledger>(await author.ledger({segment: "silent"}));
            expect(later.items.map((row) => later.names[row.id]!.name)).toEqual(["星瑾不吃煎蛋"]);

            // 目标表：星瑾的目标第 2 章受挫（动过），和星瑕瞒着她的那个目标打架；也列达成的。
            type Goals = Named & {readonly items: readonly {readonly holder: string; readonly goals: readonly {readonly id: string; readonly 状态: string; readonly last: {readonly chapter: string} | null; readonly conflicts: readonly unknown[]}[]}[]};
            const goals = ok<Goals>(await author.goals({finished: true}));
            const ofJin = goals.items.find((group) => group.holder === jin)!.goals;
            expect(ofJin).toMatchObject([{状态: "blocked", last: {chapter: "2"}, conflicts: [{writtenOn: "this", holder: idOf(goals, "星瑕")}]}]);
            expect(goals.items.flatMap((group) => group.goals).map((goal) => goals.names[goal.id]!.name)).toContain("把星瑾接回家");

            // 换线：主线上星瑾信错了，回溯线上第 3 章星瑕先说了，她知道（听星瑕说）；回溯线上星瑕的经历记得原线上那句话。
            const lines = await window.canon.call("lines", {});
            if (!lines.ok) throw new Error(JSON.stringify(lines));
            const rollback = lines.value.lines.find((line) => line.name === "重来的那个晚上")!.id;
            type Person = Named & {readonly secrets: readonly {readonly point: string; readonly degree: string; readonly how: string | null}[]};
            const onMain = ok<Person>(await author.person({person: jin}));
            const onLine = ok<Person & {readonly line: string}>(await author.person({person: jin, position: {kind: "chapter", chapter: "3", edge: "end", line: rollback}}));
            expect(onMain.secrets.find((row) => row.point === prisoned!.point)).toMatchObject({degree: "misbelieves"});
            expect(onLine).toMatchObject({line: rollback});
            expect(onLine.secrets.find((row) => row.point === prisoned!.point)).toMatchObject({degree: "knows", how: "told"});
            type Experience = {readonly items: readonly {readonly text: string; readonly remembered: boolean}[]};
            const remembered = ok<Experience>(await author.experience({person: idOf(secrets, "星瑕"), position: {kind: "chapter", chapter: "3", edge: "end", line: rollback}}));
            expect(remembered.items.filter((item) => item.remembered).map((item) => item.text)).toEqual(["星瑾没碰那张卡，说“你走的那几年，一个电话都没有”，回了房间"]);
        } finally {
            keep.release();
            await window.close();
        }
    }, 60_000);
});
