/**
 * 勇者召唤故事线 - World Engine 切片种子脚本
 *
 * 故事背景：复兴纪元 488 年，布劳尔子爵利用位面交汇天象进行勇者召唤仪式，
 * 召唤了 4 名异界者：薇洛丝（地球转生）、月涟（泰拉）、格鲁什（兽人位面）、艾莉娜（本地误入）。
 */

import {Database} from "bun:sqlite";
import {createWorldEngineTools} from "nbook/server/agent/tools/world-engine-tools";
import type {NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {resolveProjectDatabasePath} from "nbook/server/workspace-files/project-workspace";
import {closeProject, openProject} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {startProductRuntime} from "nbook/server/runtime/product-startup";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

const argv = process.argv.slice(2);
const projectRoot = argv.find((a) => !a.startsWith("--")) ?? "ming-ding-zhi-shi-2";
const projectRef = projectWorkspaceRef(projectRoot);
if (!process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || !process.env.NEURO_BOOK_STATE_ROOT?.trim()) {
    throw new Error("Seed脚本要求显式NEURO_BOOK_APPLICATION_ROOT与NEURO_BOOK_STATE_ROOT");
}
const workspaceRoot = resolveRuntimeWorkspaceRoot();
const runtime = startProductRuntime();
await runtime.ready;
let currentProject: ReadyProjectSessionRef;
try {
    currentProject = await openProject(projectRef, {kind: "job", source: "seed-heroes-story"}, workspaceRoot);

const tools = createWorldEngineTools();
const executeWorldTool = mustTool("execute_world");

const context: ToolExecutionContext = {
    harness: {} as ToolExecutionContext["harness"],
    sessionId: 1,
    profileKey: "scripts.seed-heroes-story",
    workspaceRoot,
    currentProject,
    invocationId: "seed-heroes-story",
};

type ExecutableWorldTool = NeuroAgentTool & {
    executeWithContext: NonNullable<NeuroAgentTool["executeWithContext"]>;
};

function mustTool(key: string): ExecutableWorldTool {
    const tool = tools.find((candidate) => candidate.key === key);
    if (!tool?.executeWithContext) throw new Error(`缺少 World Engine 工具：${key}`);
    return tool as ExecutableWorldTool;
}

type WorldIssue = {code: string; subjectId?: string; attr?: string; message: string};
type ExecuteWorldResult<TData> = {data: TData; issues: WorldIssue[]};

const ERROR_ISSUE_CODES = new Set(["dangling-ref", "broken-relative"]);

async function executeWorld<TData>(code: string): Promise<ExecuteWorldResult<TData>> {
    const result = await executeWorldTool.executeWithContext(context, `execute_world-${Date.now()}`, {
        projectRoot,
        code,
    });
    return result.details as unknown as ExecuteWorldResult<TData>;
}

function reset() {
    const dbPath = resolveProjectDatabasePath(workspaceRoot, projectRef);
    const db = new Database(dbPath);
    db.exec("DELETE FROM WorldPatch");
    db.exec("DELETE FROM WorldSlice");
    db.exec("DELETE FROM WorldSubject");
    db.close();
    console.log(`🧹 已清空 World 表：${dbPath}\n`);
}

async function seed() {
    console.log("📝 写入勇者召唤故事线切面：\n");

    const slices: Array<{time: string; title: string; kind?: string; patches: any[]}> = [
        // ========== Step 1: 纪元锚点 ==========
        {
            time: "复兴纪元1年1月1日 00:00",
            title: "阿斯塔利亚纪元起始",
            kind: "backstory",
            patches: [
                {subjectId: "astaria-world", type: "world", name: "阿斯塔利亚", path: "/events", op: "append", value: {text: "复兴纪元元年：第二次位面入侵通道封印，诸族进入和平重建期。"}, summary: "纪元锚点"},
            ],
        },

        // ========== Step 2: 帝国与子爵领 ==========
        {
            time: "复兴纪元1年2月1日 00:00",
            title: "奥古斯提姆帝国立国",
            kind: "backstory",
            patches: [
                {subjectId: "faction-augustim-empire", type: "faction", name: "奥古斯提姆帝国", path: "/factionType", op: "replace", value: "empire", summary: "政体类型"},
                {subjectId: "faction-augustim-empire", path: "/events", op: "append", value: {text: "复兴纪元元年：帝国正式立国，统一东部平原人类诸邦。"}, summary: "建国事件"},
            ],
        },
        {
            time: "复兴纪元380年1月1日 00:00",
            title: "布劳尔家族封地",
            kind: "backstory",
            patches: [
                {subjectId: "location-brauer-territory", type: "location", name: "布劳尔子爵领", path: "/control", op: "replace", value: "subject://faction-augustim-empire", summary: "归属帝国"},
                {subjectId: "location-brauer-territory", path: "/events", op: "append", value: {text: "复兴纪元380年：布劳尔家族受封西北边境子爵领，承担边境防御职责。"}, summary: "封地历史"},
            ],
        },

        // ========== Step 3: 布劳尔子爵的历史 ==========
        {
            time: "复兴纪元453年3月15日 08:00",
            title: "维克托·布劳尔出生",
            kind: "backstory",
            patches: [
                {subjectId: "viktor-brauer", type: "character", name: "维克托·布劳尔", path: "/race", op: "replace", value: "人类", summary: "种族"},
                {subjectId: "viktor-brauer", path: "/age", op: "replace", value: 35, summary: "当前年龄"},
                {subjectId: "viktor-brauer", path: "/level", op: "replace", value: 10, summary: "等级"},
                {subjectId: "viktor-brauer", path: "/tier", op: "replace", value: 3, summary: "第三层级精英"},
                {subjectId: "viktor-brauer", path: "/location", op: "replace", value: "subject://location-brauer-territory", summary: "出生地"},
                {subjectId: "viktor-brauer", path: "/events", op: "append", value: {text: "复兴纪元453年：出生于布劳尔家族，父亲是当时的子爵。"}, summary: "出生"},
            ],
        },
        {
            time: "复兴纪元478年6月1日 00:00",
            title: "父亲去世，维克托继承爵位",
            kind: "backstory",
            patches: [
                {subjectId: "viktor-brauer", path: "/events", op: "append", value: {text: "复兴纪元478年：父亲去世，我继承子爵爵位。领地已负债累累，边境压力与日俱增。"}, summary: "继承爵位"},
            ],
        },
        {
            time: "复兴纪元487年12月20日 00:00",
            title: "维克托决定进行召唤仪式",
            kind: "backstory",
            patches: [
                {subjectId: "viktor-brauer", path: "/events", op: "append", value: {text: "复兴纪元487年冬：在家族古籍中找到'勇者召唤仪式'记载。观测到即将到来的位面交汇天象，决定赌一把。"}, summary: "决定召唤"},
            ],
        },

        // ========== Step 4: 四名勇者的 backstory（召唤前） ==========
        {
            time: "复兴纪元488年5月9日 18:00",
            title: "薇洛丝：地球生命的终结",
            kind: "backstory",
            patches: [
                {subjectId: "veiluosi", type: "character", name: "薇洛丝", path: "/race", op: "replace", value: "人类", summary: "种族"},
                {subjectId: "veiluosi", path: "/age", op: "replace", value: 20, summary: "外貌年龄"},
                {subjectId: "veiluosi", path: "/level", op: "replace", value: 1, summary: "等级"},
                {subjectId: "veiluosi", path: "/tier", op: "replace", value: 1, summary: "第一层级"},
                {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "地球，某日黄昏：我在回家路上被天降陨石击中。视野变黑前，我只记得那块石头散发着诡异的光。然后...就没有然后了。"}, summary: "死亡"},
            ],
        },
        {
            time: "复兴纪元488年5月9日 20:00",
            title: "月涟：泰拉城市的消失",
            kind: "backstory",
            patches: [
                {subjectId: "yuelian", type: "character", name: "月涟", path: "/race", op: "replace", value: "人类", summary: "种族"},
                {subjectId: "yuelian", path: "/age", op: "replace", value: 22, summary: "年龄"},
                {subjectId: "yuelian", path: "/level", op: "replace", value: 1, summary: "等级"},
                {subjectId: "yuelian", path: "/tier", op: "replace", value: 1, summary: "第一层级"},
                {subjectId: "yuelian", path: "/intelligence", op: "replace", value: 14, summary: "高智力"},
                {subjectId: "yuelian", path: "/events", op: "append", value: {text: "泰拉位面，某日夜晚：我所在的城市突然被巨大的能量波包裹。所有人都感到天旋地转，然后失去意识。醒来时，星空变了。"}, summary: "位面传送"},
            ],
        },
        {
            time: "复兴纪元488年5月9日 22:00",
            title: "格鲁什：血牙部落的狩猎夜",
            kind: "backstory",
            patches: [
                {subjectId: "grush", type: "character", name: "格鲁什", path: "/race", op: "replace", value: "兽人", summary: "种族"},
                {subjectId: "grush", path: "/age", op: "replace", value: 25, summary: "年龄"},
                {subjectId: "grush", path: "/level", op: "replace", value: 2, summary: "等级"},
                {subjectId: "grush", path: "/tier", op: "replace", value: 1, summary: "第一层级"},
                {subjectId: "grush", path: "/str", op: "replace", value: 14, summary: "高力量"},
                {subjectId: "grush", path: "/con", op: "replace", value: 13, summary: "高体质"},
                {subjectId: "grush", path: "/events", op: "append", value: {text: "血牙部落，狩猎之夜：我在追踪猎物时，突然被一道光柱笼罩。身体被撕裂般的痛苦，然后坠入黑暗。"}, summary: "被拉入通道"},
            ],
        },
        {
            time: "复兴纪元488年5月9日 23:30",
            title: "艾莉娜：野外调研的意外",
            kind: "backstory",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜·晨曦", path: "/race", op: "replace", value: "人类", summary: "种族"},
                {subjectId: "erina", path: "/age", op: "replace", value: 19, summary: "年龄"},
                {subjectId: "erina", path: "/level", op: "replace", value: 5, summary: "等级"},
                {subjectId: "erina", path: "/tier", op: "replace", value: 2, summary: "第二层级中坚"},
                {subjectId: "erina", path: "/intelligence", op: "replace", value: 15, summary: "高智力"},
                {subjectId: "erina", path: "/spi", op: "replace", value: 13, summary: "高精神"},
                {subjectId: "erina", path: "/skills", op: "append", value: "光系魔法(Lv2)", summary: "技能"},
                {subjectId: "erina", path: "/skills", op: "append", value: "风系魔法(Lv1)", summary: "技能"},
                {subjectId: "erina", path: "/events", op: "append", value: {text: "时钟塔城外围，深夜：我在测量位面屏障波动数据时，仪器突然失控。一股巨大的吸力把我拉向未知方向。"}, summary: "误入召唤"},
            ],
        },

        // ========== Step 5: 召唤仪式成功 ==========
        {
            time: "复兴纪元488年5月10日 00:00",
            title: "勇者召唤仪式成功",
            kind: "event",
            patches: [
                {subjectId: "viktor-brauer", path: "/events", op: "append", value: {text: "复兴纪元488年5月10日凌晨：召唤仪式成功。四名异界者出现在祭坛上，昏迷不醒。我不知道他们会怎样反应，但箭在弦上，不得不发。"}, summary: "仪式成功"},
                {subjectId: "veiluosi", path: "/location", op: "replace", value: "subject://location-brauer-territory", summary: "苏醒地"},
                {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "我在一个陌生的石质祭坛上醒来。周围有三个同样困惑的人，以及一个穿着贵族礼服的中年男人。他说我们是'被召唤的勇者'。"}, summary: "苏醒"},
                {subjectId: "yuelian", path: "/location", op: "replace", value: "subject://location-brauer-territory", summary: "苏醒地"},
                {subjectId: "yuelian", path: "/events", op: "append", value: {text: "醒来时发现自己躺在一个充满魔法波动的房间里。那个自称'子爵'的人解释说这是'召唤仪式'——但这和泰拉的任何科学理论都不符。"}, summary: "苏醒"},
                {subjectId: "grush", path: "/location", op: "replace", value: "subject://location-brauer-territory", summary: "苏醒地"},
                {subjectId: "grush", path: "/events", op: "append", value: {text: "我在冰冷的石头上醒来。周围有三个陌生的人，一个瘦弱的人类男性在说话。我听不太懂，但能感觉到他很紧张。"}, summary: "苏醒"},
                {subjectId: "erina", path: "/location", op: "replace", value: "subject://location-brauer-territory", summary: "苏醒地"},
                {subjectId: "erina", path: "/events", op: "append", value: {text: "醒来时发现自己躺在一个改良版召唤阵中央。阵法结构很复杂，但有几处明显的偏差...这就是为什么我被误认为'异界者'吗？"}, summary: "苏醒"},
            ],
        },

        // ========== Step 6: 当前时刻（5月15日，勇者们初步探索）==========
        {
            time: "复兴纪元488年5月15日 10:00",
            title: "勇者们的初步对话",
            kind: "event",
            patches: [
                {subjectId: "viktor-brauer", path: "/events", op: "append", value: {text: "今天是召唤后第五天。四名勇者逐渐恢复，开始探索城堡和领地。我必须尽快让他们理解我的处境，建立合作关系。"}, summary: "当前状态"},
                {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "过去五天我一直在观察：子爵很焦虑，领地很穷，其他三个'勇者'各有来历。我需要更多信息才能决定下一步。"}, summary: "当前状态"},
                {subjectId: "yuelian", path: "/events", op: "append", value: {text: "我花了五天时间尝试理解这个世界的'魔法'。艾莉娜的解释很有帮助，但仍有太多不符合物理定律的现象。"}, summary: "当前状态"},
                {subjectId: "grush", path: "/events", op: "append", value: {text: "五天了，我已经摸清了这座城堡的布局。这个'子爵'很弱，但他召唤我们的目的还不清楚。"}, summary: "当前状态"},
                {subjectId: "erina", path: "/events", op: "append", value: {text: "五天的观察让我确认：召唤阵确实有问题，我不该被拉进来。但既然已经发生了，我要弄清楚整个事件的真相。"}, summary: "当前状态"},
            ],
        },
    ];

    const results: any[] = [];
    for (const slice of slices) {
        const result = await executeWorld<{sliceId: string}>(`
            const slice = ${JSON.stringify(slice)};
            const written = await world.slice.write({
                time: world.time.parse(slice.time),
                title: slice.title,
                kind: slice.kind,
                patches: slice.patches,
            });
            return {sliceId: written.sliceId};
        `);
        console.log(`  ✍️  [${slice.kind || "event"}] ${slice.time} ${slice.title} -> slice ${result.data.sliceId}`);
        results.push(result);
    }

    const totalIssues = results.flatMap((r) => r.issues || []);
    const eIssues = totalIssues.filter((issue) => ERROR_ISSUE_CODES.has(issue.code)).length;
    const aIssues = totalIssues.length - eIssues;

    console.log(`\n写入完成：${slices.length} 个切面；E 类 issues ${eIssues}，提示类 issues ${aIssues}。`);

    if (eIssues > 0) {
        console.error("\n❌ 存在 E 类 issues，必须修复：");
        totalIssues.filter((issue) => ERROR_ISSUE_CODES.has(issue.code)).forEach((issue) => console.error(JSON.stringify(issue, null, 2)));
        throw new Error("种子写入出现必须修复的E类issues");
    }
}

async function verify() {
    console.log("\n🔎 校验快照：");

    const snapshotResult = await executeWorld<{
        counts: Record<string, number>;
        worldList: string[];
        viktorEvents: string[];
        veiluosiLocation: string;
        sliceCount: number;
    }>(`
        const counts = {
            world: (await world.subject.list("world")).length,
            faction: (await world.subject.list("faction")).length,
            location: (await world.subject.list("location")).length,
            character: (await world.subject.list("character")).length,
        };

        const worldList = (await world.subject.list("world")).map(s => s.id);
        const viktorEvents = (await world.subject.get("viktor-brauer")).events || [];
        const veiluosiLocation = (await world.subject.get("veiluosi")).location;
        const sliceCount = (await world.slice.list()).length;

        return {counts, worldList, viktorEvents, veiluosiLocation, sliceCount};
    `);
    const snapshot = snapshotResult.data;

    console.log(JSON.stringify(snapshot, null, 2));

    const {counts, worldList, viktorEvents, veiluosiLocation, sliceCount} = snapshot;

    console.log("\n✅ 断言检查：");
    function assert(condition: boolean, message: string) {
        if (!condition) {
            throw new Error(message);
        }
        console.log(`  ✓ ${message}`);
    }

    assert(counts.world === 1, "world subject 数量 = 1");
    assert(counts.faction === 1, "faction subject 数量 = 1");
    assert(counts.location === 1, "location subject 数量 = 1");
    assert(counts.character === 5, "character subject 数量 = 5（4勇者+子爵）");
    assert(worldList.includes("astaria-world"), "world 包含 astaria-world");
    assert(viktorEvents.length >= 4, "维克托至少有 4 条 events");
    assert(veiluosiLocation === "subject://location-brauer-territory", "薇洛丝当前位置在布劳尔领地");
    assert(sliceCount === 12, "总共 12 个切面");

    console.log("\n🎉 勇者召唤故事线数据就绪！");
}

async function main() {
    console.log(`勇者召唤故事线种子：projectRoot=${projectRoot}\n`);

    reset();
    await seed();
    await verify();
}

    await main();
} catch (error) {
    console.error("❌ 脚本执行失败：", error);
    process.exitCode = 1;
} finally {
    try {
        await closeProject(projectRef, "shutdown");
    } finally {
        await runtime.stop();
    }
}
