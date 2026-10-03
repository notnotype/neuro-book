/**
 * World Engine 典型示范数据种子脚本。
 *
 * 目的：
 *   1. 为指定 Project Workspace 写入一套干净、连贯、可复现的 World Engine 示范数据，
 *      覆盖全部 5 个 subject type（world/faction/location/character/item）、4 种 op
 *      （replace/increment/remove/append）、ref 引用、首写自动创建、backstory 溯源与当前事件。
 *   2. 全程**通过 agent 暴露的 World 工具**（execute_world）写入、精确编辑与校验，
 *      因此本脚本同时是读写合一 CodeAct 工具的端到端冒烟验证入口。
 *
 * 用法（bun 命令需在沙盒外提权执行）：
 *   bun run seed:world-engine-demo -- [projectRoot] [--verify-only] [--keep]
 *     projectRoot    默认 ming-ding-zhi-shi-2
 *     --verify-only  跳过清空与写入，仅运行只读查询断言
 *     --keep         跳过清空（在已有数据上追加，可能与现有 id 冲突）
 *
 * 退出码：成功 0；写入抛错 / 出现 E 类 issue（dangling-ref/broken-relative）/ 断言失败 非零。
 */

import {Database} from "bun:sqlite";
import {createWorldEngineTools} from "nbook/server/agent/tools/world-engine-tools";
import type {NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {initProjectDatabase, resolveProjectDatabasePath} from "nbook/server/workspace-files/project-workspace";
import {closeProject, openProject} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {startProductRuntime} from "nbook/server/runtime/product-startup";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

// ========== 参数解析 ==========

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const projectRoot = argv.find((a) => !a.startsWith("--")) ?? "ming-ding-zhi-shi-2";
const projectRef = projectWorkspaceRef(projectRoot);
const verifyOnly = flags.has("--verify-only");
const keepExisting = flags.has("--keep");
if (!process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || !process.env.NEURO_BOOK_STATE_ROOT?.trim()) {
    throw new Error("Seed脚本要求显式NEURO_BOOK_APPLICATION_ROOT与NEURO_BOOK_STATE_ROOT");
}
const workspaceRoot = resolveRuntimeWorkspaceRoot();
const runtime = startProductRuntime();
await runtime.ready;
let currentProject: ReadyProjectSessionRef;
try {
    currentProject = await openProject(projectRef, {kind: "job", source: "seed-world-engine-demo"}, workspaceRoot);

// ========== Agent 工具装配（忠实复现 world-engine-tools.test.ts 的最小上下文）==========

const tools = createWorldEngineTools();
const executeWorldTool = mustTool("execute_world");

// execute_world 失败时会读取 workspaceRoot 写入调试 temp。
const context: ToolExecutionContext = {
    harness: {} as ToolExecutionContext["harness"],
    sessionId: 1,
    profileKey: "scripts.seed-world-engine-demo",
    workspaceRoot,
    currentProject,
    invocationId: "seed-world-engine-demo",
};

function mustTool(key: string): NeuroAgentTool {
    const tool = tools.find((t) => t.key === key);
    if (!tool?.executeWithContext) throw new Error(`缺少 World Engine 工具：${key}`);
    return tool;
}

// ========== 类型 ==========

/** 一条 patch；字段对齐 world.slice.write 的 patches 入参。 */
type Patch = {
    subjectId: string;
    path: string;
    op: "replace" | "increment" | "remove" | "append";
    value?: unknown;
    summary?: string;
    type?: string; // 仅首写新 subject
    name?: string; // 仅首写新 subject
};

/** 一个切面：一个日历时间 + 一组原子 patches。 */
type Slice = {time: string; title: string; kind: string; patches: Patch[]};

/** execute_world 工具 details 结构。 */
type ExecuteWorldResult<TData> = {data: TData; issues: WorldIssue[]};
type WriteResult = {sliceId: string; issues: WorldIssue[]};
type WorldIssue = {code: string; subjectId?: string; attr?: string; message: string};

// E 类（数据错误，必须修）；其余（base-shifted/masked）是补过去时的一次性提醒。
const ERROR_ISSUE_CODES = new Set(["dangling-ref", "broken-relative"]);

// ========== 示范数据集 ==========
//
// 世界观：阿斯塔利亚（《命定之诗2》）。复兴纪元历，12 月/年、30 天/月、24h/天，
// 时间串格式 `复兴纪元{year}年{month}月{day}日 HH:MM`（见 world-engine/calendar.ts）。
// 字段以 world-engine/schema/index.ts 为准。

const SLICES: Slice[] = [
    {
        // #1 纪元锚点 + 帝国立国：首写 world 与 faction（type 触发自动创建）。
        time: "复兴纪元1年1月1日 00:00",
        title: "世界起源与帝国立国",
        kind: "backstory",
        patches: [
            {subjectId: "astaria-world", type: "world", name: "阿斯塔利亚", path: "/events", op: "append", value: {text: "诸神黄昏落幕，复兴纪元元年开启"}, summary: "纪元锚点"},
            {subjectId: "faction-empire", type: "faction", name: "奥古斯提姆帝国", path: "/factionType", op: "replace", value: "empire"},
            {subjectId: "faction-empire", path: "/events", op: "append", value: {text: "奥古斯提姆帝国于复兴纪元元年立国，定都晨曦城"}},
        ],
    },
    {
        // #2 地点初立：首写两个 location；学院 control 引用帝国（ref 写入）。
        time: "复兴纪元1年6月1日 00:00",
        title: "学院与遗迹",
        kind: "backstory",
        patches: [
            {subjectId: "location-academy", type: "location", name: "艾瑟嘉德学院", path: "/control", op: "replace", value: "subject://faction-empire", summary: "学院归帝国管辖"},
            {subjectId: "location-academy", path: "/events", op: "append", value: {text: "艾瑟嘉德学院落成，成为大陆魔法研究中心"}},
            {subjectId: "location-ruins-meteor", type: "location", name: "星陨遗迹", path: "/events", op: "append", value: {text: "星陨遗迹被发现，深处埋藏古代造物"}},
        ],
    },
    {
        // #3 铸剑：首写 item，嵌套对象 replace（equipmentStats）、集合 append（enchants）。owner 留到角色出场后再设。
        time: "复兴纪元100年1月1日 00:00",
        title: "晨曦之剑铸成",
        kind: "backstory",
        patches: [
            {subjectId: "item-dawn-sword", type: "item", name: "晨曦之剑", path: "/itemType", op: "replace", value: "weapon"},
            {subjectId: "item-dawn-sword", path: "/rarity", op: "replace", value: "epic"},
            {subjectId: "item-dawn-sword", path: "/equipmentStats", op: "replace", value: {strBonus: 3, attack: 25}},
            {subjectId: "item-dawn-sword", path: "/enchants", op: "append", value: "破晓光刃"},
            {subjectId: "item-dawn-sword", path: "/events", op: "append", value: {text: "晨曦之剑由帝国铸剑师锻成"}},
        ],
    },
    {
        // #4 角色登场：首写两名 character，五维属性、tier、ref（location/faction）、集合（skills/inventory）、字典（equipment）。
        //    剑认主：erina 在本切面已注册，故可安全设置 item owner ref。
        time: "复兴纪元312年3月1日 08:00",
        title: "晨曦学子入学",
        kind: "backstory",
        patches: [
            {subjectId: "erina", type: "character", name: "艾莉娜·晨曦", path: "/race", op: "replace", value: "人类"},
            {subjectId: "erina", path: "/age", op: "replace", value: 17},
            {subjectId: "erina", path: "/str", op: "replace", value: 11},
            {subjectId: "erina", path: "/dex", op: "replace", value: 13},
            {subjectId: "erina", path: "/con", op: "replace", value: 12},
            {subjectId: "erina", path: "/intelligence", op: "replace", value: 14},
            {subjectId: "erina", path: "/spi", op: "replace", value: 13},
            {subjectId: "erina", path: "/tier", op: "replace", value: 2},
            {subjectId: "erina", path: "/maxMp", op: "replace", value: 80},
            {subjectId: "erina", path: "/mp", op: "replace", value: 80},
            {subjectId: "erina", path: "/location", op: "replace", value: "subject://location-academy"},
            {subjectId: "erina", path: "/faction", op: "replace", value: "subject://faction-empire"},
            {subjectId: "erina", path: "/skills", op: "append", value: "光刃术"},
            {subjectId: "erina", path: "/skills", op: "append", value: "晨曦祝福"},
            {subjectId: "erina", path: "/equipment/weapon", op: "replace", value: "晨曦之剑"},
            {subjectId: "erina", path: "/inventory", op: "append", value: "初级治疗药水"},
            {subjectId: "erina", path: "/inventory", op: "append", value: "学院通行证"},
            {subjectId: "erina", path: "/events", op: "append", value: {text: "艾莉娜·晨曦进入艾瑟嘉德学院学习"}},

            {subjectId: "moran", type: "character", name: "莫然", path: "/race", op: "replace", value: "人类"},
            {subjectId: "moran", path: "/age", op: "replace", value: 18},
            {subjectId: "moran", path: "/str", op: "replace", value: 14},
            {subjectId: "moran", path: "/dex", op: "replace", value: 12},
            {subjectId: "moran", path: "/tier", op: "replace", value: 2},
            {subjectId: "moran", path: "/location", op: "replace", value: "subject://location-academy"},
            {subjectId: "moran", path: "/faction", op: "replace", value: "subject://faction-empire"},
            {subjectId: "moran", path: "/skills", op: "append", value: "剑术精通"},
            {subjectId: "moran", path: "/events", op: "append", value: {text: "莫然作为交换生进入学院"}},

            {subjectId: "item-dawn-sword", path: "/owner", op: "replace", value: "subject://erina", summary: "晨曦之剑认主艾莉娜"},
        ],
    },
    {
        // #5 当前事件：星陨遗迹遭遇战。四种 op 全覆盖 —— replace(位置/mp) + increment(hp) + append(技能/经历) + collection remove+value(用掉药水)。
        time: "复兴纪元312年5月15日 14:00",
        title: "星陨遗迹遭遇战",
        kind: "event",
        patches: [
            {subjectId: "erina", path: "/location", op: "replace", value: "subject://location-ruins-meteor", summary: "前往星陨遗迹"},
            {subjectId: "erina", path: "/hp", op: "increment", value: -30, summary: "遭遇遗迹守卫受伤"},
            {subjectId: "erina", path: "/mp", op: "replace", value: 50, summary: "施法消耗魔力"},
            {subjectId: "erina", path: "/skills", op: "append", value: "破晓斩", summary: "实战领悟新技能"},
            {subjectId: "erina", path: "/inventory", op: "remove", value: "初级治疗药水", summary: "战斗中用掉初级治疗药水"},
            {subjectId: "erina", path: "/events", op: "append", value: {text: "艾莉娜在星陨遗迹遭遇守卫，负伤后领悟破晓斩"}},
            {subjectId: "astaria-world", path: "/events", op: "append", value: {text: "复兴纪元312年，星陨遗迹异动引发关注"}},
        ],
    },
    {
        // #6 列强格局（溯源到立国初期）：首写另外两个 faction，leader 留到对应人物登场后再设。
        time: "复兴纪元1年1月15日 00:00",
        title: "三强鼎立",
        kind: "backstory",
        patches: [
            {subjectId: "faction-kingdom", type: "faction", name: "索伦蒂斯王国", path: "/factionType", op: "replace", value: "kingdom"},
            {subjectId: "faction-kingdom", path: "/events", op: "append", value: {text: "索伦蒂斯王国于复兴纪元元年建国，立宪而治"}},
            {subjectId: "faction-beast", type: "faction", name: "兽族联盟", path: "/factionType", op: "replace", value: "tribe"},
            {subjectId: "faction-beast", path: "/events", op: "append", value: {text: "北境诸部歃血结盟，成立兽族联盟"}},
            {subjectId: "astaria-world", path: "/events", op: "append", value: {text: "帝国、王国、兽族联盟三强鼎立的格局形成"}},
        ],
    },
    {
        // #7 都城与王城：首写两个 location，control 引用各自阵营。
        time: "复兴纪元1年7月1日 00:00",
        title: "两座王都",
        kind: "backstory",
        patches: [
            {subjectId: "location-capital", type: "location", name: "晨曦城", path: "/control", op: "replace", value: "subject://faction-empire", summary: "帝都"},
            {subjectId: "location-capital", path: "/events", op: "append", value: {text: "晨曦城定为奥古斯提姆帝国国都"}},
            {subjectId: "location-soren-castle", type: "location", name: "索伦蒂斯王城", path: "/control", op: "replace", value: "subject://faction-kingdom"},
            {subjectId: "location-soren-castle", path: "/events", op: "append", value: {text: "索伦蒂斯王城落成，成为王国权力中枢"}},
        ],
    },
    {
        // #8 魔女传说（溯源）：首写反派 character 与第二件 item（禁忌魔导书，owner 引用魔女）。
        time: "复兴纪元290年1月1日 00:00",
        title: "残响魔女",
        kind: "backstory",
        patches: [
            {subjectId: "npc-witch", type: "character", name: "莉莉丝·残响", path: "/race", op: "replace", value: "血族"},
            {subjectId: "npc-witch", path: "/tier", op: "replace", value: 5},
            {subjectId: "npc-witch", path: "/maxMp", op: "replace", value: 300},
            {subjectId: "npc-witch", path: "/mp", op: "replace", value: 300},
            {subjectId: "npc-witch", path: "/skills", op: "append", value: "暗影支配"},
            {subjectId: "npc-witch", path: "/memory/晨曦之剑", op: "replace", value: {text: "唯一能克制我暗影之力的圣兵，必须夺取或毁去"}},
            {subjectId: "npc-witch", path: "/events", op: "append", value: {text: "残响魔女莉莉丝被封印于星陨遗迹深处"}},
            {subjectId: "item-grimoire", type: "item", name: "禁忌魔导书", path: "/itemType", op: "replace", value: "document"},
            {subjectId: "item-grimoire", path: "/rarity", op: "replace", value: "legendary"},
            {subjectId: "item-grimoire", path: "/owner", op: "replace", value: "subject://npc-witch", summary: "魔导书随魔女一同封印"},
            {subjectId: "item-grimoire", path: "/enchants", op: "append", value: "暗蚀"},
            {subjectId: "item-grimoire", path: "/events", op: "append", value: {text: "禁忌魔导书记载着远古暗影仪式"}},
        ],
    },
    {
        // #9 导师与王：首写两名 character；为王国设置 leader 引用（npc-king 本切面已登记）。
        time: "复兴纪元312年2月1日 00:00",
        title: "师长与君王",
        kind: "backstory",
        patches: [
            {subjectId: "npc-mentor", type: "character", name: "塞拉斯导师", path: "/race", op: "replace", value: "人类"},
            {subjectId: "npc-mentor", path: "/tier", op: "replace", value: 4},
            {subjectId: "npc-mentor", path: "/faction", op: "replace", value: "subject://faction-empire"},
            {subjectId: "npc-mentor", path: "/location", op: "replace", value: "subject://location-academy"},
            {subjectId: "npc-mentor", path: "/skills", op: "append", value: "元素精通"},
            {subjectId: "npc-mentor", path: "/events", op: "append", value: {text: "塞拉斯出任艾瑟嘉德学院首席导师"}},
            {subjectId: "npc-king", type: "character", name: "奥兰多三世", path: "/race", op: "replace", value: "人类"},
            {subjectId: "npc-king", path: "/tier", op: "replace", value: 4},
            {subjectId: "npc-king", path: "/faction", op: "replace", value: "subject://faction-kingdom"},
            {subjectId: "npc-king", path: "/location", op: "replace", value: "subject://location-soren-castle"},
            {subjectId: "npc-king", path: "/events", op: "append", value: {text: "奥兰多三世继承索伦蒂斯王位"}},
            {subjectId: "faction-kingdom", path: "/leader", op: "replace", value: "subject://npc-king", summary: "现任国王"},
        ],
    },
    {
        // #10 学院试炼（成长）：increment(exp/gold/str) + replace(level/personality/appearance) + append(skills) + record(memory)。
        time: "复兴纪元312年4月1日 10:00",
        title: "学院晋级试炼",
        kind: "event",
        patches: [
            {subjectId: "erina", path: "/exp", op: "increment", value: 500, summary: "试炼获得经验"},
            {subjectId: "erina", path: "/level", op: "replace", value: 3},
            {subjectId: "erina", path: "/gold", op: "increment", value: 200, summary: "试炼奖励"},
            {subjectId: "erina", path: "/str", op: "increment", value: 1},
            {subjectId: "erina", path: "/skills", op: "append", value: "防护盾"},
            {subjectId: "erina", path: "/personality", op: "replace", value: "wOaGz(A)"},
            {subjectId: "erina", path: "/appearance", op: "replace", value: {hairColor: "晨曦金", eyeColor: "琥珀", height: 165, build: "匀称"}},
            {subjectId: "erina", path: "/memory/莫然", op: "replace", value: {text: "可靠的同窗剑士，剑术比我更扎实"}},
            {subjectId: "moran", path: "/exp", op: "increment", value: 400},
            {subjectId: "moran", path: "/level", op: "replace", value: 3},
            {subjectId: "moran", path: "/gold", op: "increment", value: 150},
            {subjectId: "moran", path: "/equipment/armor", op: "replace", value: "学院制式护甲"},
            {subjectId: "moran", path: "/skills", op: "append", value: "盾击"},
        ],
    },
    {
        // #11 遗迹余波（当前最新）：故意把 /hp 写成 /HP，随后用 editPatches 精确修正。
        //     其余 patches 覆盖 replace(位置/元素亲和/饰品) + append(战利品/经历) + record(memory)。
        time: "复兴纪元312年5月20日 09:00",
        title: "遗迹余波：撤返学院",
        kind: "event",
        patches: [
            {subjectId: "erina", path: "/location", op: "replace", value: "subject://location-academy", summary: "撤回学院疗伤"},
            {subjectId: "erina", path: "/HP", op: "replace", value: 90, summary: "故意写错 path，稍后用 editPatches 修正为 /hp"},
            {subjectId: "erina", path: "/elementalAffinity", op: "replace", value: {fire: 0, water: 2, wind: 3, earth: 0, light: 12, dark: 1}},
            {subjectId: "erina", path: "/equipment/accessory", op: "replace", value: "晨曦徽记"},
            {subjectId: "erina", path: "/inventory", op: "append", value: "古代徽记"},
            {subjectId: "erina", path: "/memory/星陨遗迹", op: "replace", value: {text: "遗迹深处守卫森严，似乎封印着某种古老存在"}},
            {subjectId: "erina", path: "/events", op: "append", value: {text: "艾莉娜带着古代徽记撤回学院，向导师汇报遗迹异动"}},
            {subjectId: "npc-witch", path: "/events", op: "append", value: {text: "封印出现裂痕，残响魔女的意识开始苏醒"}},
            {subjectId: "astaria-world", path: "/events", op: "append", value: {text: "星陨遗迹封印松动，大陆暗流涌动"}},
        ],
    },
];

// ========== 步骤实现 ==========

/** 清空该项目 db 的三张 World 表（不碰 Story* 等其它表）。 */
async function reset(): Promise<void> {
    await initProjectDatabase(workspaceRoot, projectRef);
    const dbPath = resolveProjectDatabasePath(workspaceRoot, projectRef);
    const db = new Database(dbPath);
    try {
        // 删除顺序无外键约束依赖，直接逐表清空。
        db.run("DROP TABLE IF EXISTS WorldMutation");
        db.run("DELETE FROM WorldPatch");
        db.run("DELETE FROM WorldSlice");
        db.run("DELETE FROM WorldSubject");
    } finally {
        db.close();
    }
    console.log(`🧹 已清空 World 表：${dbPath}`);
}

/** 逐切面通过 execute_world 工具写入，收集并分类 issues。 */
async function seed(): Promise<{written: number; errorIssues: WorldIssue[]; noteIssues: WorldIssue[]}> {
    const errorIssues: WorldIssue[] = [];
    const noteIssues: WorldIssue[] = [];
    let written = 0;

    for (const slice of SLICES) {
        const result = await callWrite(slice);
        written += 1;
        for (const issue of result.issues) {
            if (ERROR_ISSUE_CODES.has(issue.code)) errorIssues.push(issue);
            else noteIssues.push(issue);
        }
        const tag = result.issues.length ? `（${result.issues.length} issues）` : "";
        console.log(`  ✍️  [${slice.kind}] ${slice.time} ${slice.title} -> slice ${result.sliceId}${tag}`);
        if (slice.title === "遗迹余波：撤返学院") {
            const editResult = await repairHpTypo(result.sliceId);
            for (const issue of editResult.issues) {
                if (ERROR_ISSUE_CODES.has(issue.code)) errorIssues.push(issue);
                else noteIssues.push(issue);
            }
            const editTag = editResult.issues.length ? `（${editResult.issues.length} issues）` : "";
            console.log(`  🛠️  editPatches 修正 /HP -> ${editResult.path}，erina.hp=${editResult.hp}${editTag}`);
        }
    }
    return {written, errorIssues, noteIssues};
}

/** 调用 execute_world 中的 world.slice.write。 */
async function callWrite(slice: Slice): Promise<WriteResult> {
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
    return {sliceId: result.data.sliceId, issues: result.issues};
}

/** 演示通过 patchId 精确修复已有 patch。 */
async function repairHpTypo(sliceId: string): Promise<{path: string; hp: number; issues: WorldIssue[]}> {
    const result = await executeWorld<{path: string; hp: number}>(`
        const sliceId = ${JSON.stringify(sliceId)};
        const before = await world.slice.get(sliceId);
        const wrong = before.patches.find((patch) => patch.path === "/HP");
        if (!wrong) {
            throw new Error("seed demo 预期存在 /HP 误写 patch");
        }
        await world.slice.editPatches(sliceId, [
            {patchId: wrong.patchId, set: {path: "/hp", summary: "修正 seed demo 中故意写错的 HP 路径"}},
        ]);
        const after = await world.slice.get(sliceId);
        const fixed = after.patches.find((patch) => patch.path === "/hp" && patch.summary === "修正 seed demo 中故意写错的 HP 路径");
        if (!fixed) {
            throw new Error("seed demo 未找到修正后的 /hp patch");
        }
        const erina = await world.subject.get("erina");
        return {path: fixed.path, hp: erina.hp};
    `);
    return {path: result.data.path, hp: result.data.hp, issues: result.issues};
}

/** 调用 execute_world 工具，返回统一 details。 */
async function executeWorld<TData>(code: string): Promise<ExecuteWorldResult<TData>> {
    const res = await executeWorldTool.executeWithContext!(context, "execute_world-call", {projectRoot, code});
    return res.details as unknown as ExecuteWorldResult<TData>;
}

/** 调用 execute_world 工具，返回查询代码的 data。 */
async function query<TData>(code: string): Promise<TData> {
    return (await executeWorld<TData>(code)).data;
}

/** 只读查询 + 断言。任一断言失败抛错。 */
async function verify(): Promise<void> {
    // 一次性取回所有需要校验的快照（注意：execute_world 结果上限 10KB，故只取关键字段）。
    const snapshot = await query<{
        counts: Record<string, number>;
        worldList: string[];
        erina: {hp: number; HP?: number; mp: number; level: number; gold: number; location: unknown; faction: unknown; skills: string[]; inventory: string[]; eventsCount: number};
        kingdomLeader: unknown;
        empireRefSubjects: string[];
        sliceInstants: number[];
        typoPatchPaths: string[];
    }>(`
        const types = ["world", "faction", "location", "item", "character"];
        const counts = {};
        for (const t of types) counts[t] = (await world.subject.list(t)).length;
        const worldList = (await world.subject.list("world")).map(s => s.id);
        const erina = await world.subject.get("erina");
        const empireRefs = await world.subject.findRefs("faction-empire");
        const kingdom = await world.subject.get("faction-kingdom");
        const slices = await world.slice.list({ limit: 50, withPatches: true });
        const sliceInstants = slices.map(s => Number(s.instant));
        const typoPatchPaths = slices
            .flatMap((slice) => slice.patches ?? [])
            .filter((patch) => patch.summary === "修正 seed demo 中故意写错的 HP 路径")
            .map((patch) => patch.path);
        return {
            counts,
            worldList,
            erina: {
                hp: erina.hp,
                HP: erina.HP,
                mp: erina.mp,
                level: erina.level,
                gold: erina.gold,
                location: erina.location,
                faction: erina.faction,
                skills: erina.skills,
                inventory: erina.inventory,
                eventsCount: Array.isArray(erina.events) ? erina.events.length : 0,
            },
            kingdomLeader: kingdom.leader,
            empireRefSubjects: empireRefs.map(r => r.subjectId).sort(),
            sliceInstants,
            typoPatchPaths,
        };
    `);

    console.log("\n🔎 校验快照：");
    console.log(JSON.stringify(snapshot, null, 2));

    // 断言集合
    assert(snapshot.counts.world === 1, `world 主体应唯一，实际 ${snapshot.counts.world}（${snapshot.worldList.join(",")}）`);
    assert(snapshot.worldList[0] === "astaria-world", `world 主体 id 应为 astaria-world，实际 ${snapshot.worldList.join(",")}`);
    assert(snapshot.counts.faction === 3, `faction 数应为 3，实际 ${snapshot.counts.faction}`);
    assert(snapshot.counts.location === 4, `location 数应为 4，实际 ${snapshot.counts.location}`);
    assert(snapshot.counts.item === 2, `item 数应为 2，实际 ${snapshot.counts.item}`);
    assert(snapshot.counts.character === 5, `character 数应为 5，实际 ${snapshot.counts.character}`);

    // erina 状态：跨多个切面累积（含溯源、increment、replace、collection remove+value）。
    assert(snapshot.erina.hp === 90, `erina.hp 应为 90（先 -30，后由 editPatches 修正 /HP replace 为 /hp），实际 ${snapshot.erina.hp}`);
    assert(snapshot.erina.HP === undefined, `erina.HP 不应残留，实际 ${String(snapshot.erina.HP)}`);
    assert(snapshot.erina.mp === 50, `erina.mp 应为 50，实际 ${snapshot.erina.mp}`);
    assert(snapshot.erina.level === 3, `erina.level 应为 3，实际 ${snapshot.erina.level}`);
    assert(snapshot.erina.gold === 200, `erina.gold 应为 200，实际 ${snapshot.erina.gold}`);
    assert(snapshot.erina.location === "subject://location-academy", `erina.location 应为撤返后的学院，实际 ${String(snapshot.erina.location)}`);
    assert(snapshot.erina.faction === "subject://faction-empire", `erina.faction 应指向帝国，实际 ${String(snapshot.erina.faction)}`);
    assert(snapshot.erina.skills.includes("破晓斩"), `erina.skills 应包含「破晓斩」，实际 ${snapshot.erina.skills.join(",")}`);
    assert(snapshot.erina.skills.includes("防护盾"), `erina.skills 应包含「防护盾」，实际 ${snapshot.erina.skills.join(",")}`);
    assert(!snapshot.erina.inventory.includes("初级治疗药水"), `erina.inventory 应已按值 remove 掉「初级治疗药水」，实际 ${snapshot.erina.inventory.join(",")}`);
    assert(snapshot.erina.inventory.includes("学院通行证"), `erina.inventory 应保留「学院通行证」，实际 ${snapshot.erina.inventory.join(",")}`);
    assert(snapshot.erina.inventory.includes("古代徽记"), `erina.inventory 应含战利品「古代徽记」，实际 ${snapshot.erina.inventory.join(",")}`);
    assert(snapshot.erina.eventsCount >= 3, `erina.events 应至少 3 条，实际 ${snapshot.erina.eventsCount}`);

    // 王国 leader 反向/正向引用：faction.leader → npc-king。
    assert(snapshot.kingdomLeader === "subject://npc-king", `faction-kingdom.leader 应为奥兰多三世，实际 ${String(snapshot.kingdomLeader)}`);

    // 引用帝国者：erina/moran/npc-mentor 的 faction + 学院/帝都的 control。
    for (const expected of ["erina", "moran", "npc-mentor", "location-academy", "location-capital"]) {
        assert(snapshot.empireRefSubjects.includes(expected), `findRefs(faction-empire) 应包含 ${expected}，实际 ${snapshot.empireRefSubjects.join(",")}`);
    }

    assert(snapshot.sliceInstants.length === 11, `切面数应为 11，实际 ${snapshot.sliceInstants.length}`);
    const sorted = [...snapshot.sliceInstants].sort((a, b) => a - b);
    assert(JSON.stringify(sorted) === JSON.stringify(snapshot.sliceInstants), `切面应按 instant 升序，实际 ${snapshot.sliceInstants.join(",")}`);
    assert(JSON.stringify(snapshot.typoPatchPaths) === JSON.stringify(["/hp"]), `editPatches 应把 seed demo 的 /HP 修正为 /hp，实际 ${snapshot.typoPatchPaths.join(",")}`);

    console.log("\n✅ 全部断言通过。");
}

function assert(cond: boolean, message: string): void {
    if (!cond) throw new Error(`断言失败：${message}`);
}

// ========== 主流程 ==========

async function main(): Promise<void> {
    console.log(`World Engine 示范数据种子：projectRoot=${projectRoot}${verifyOnly ? " [verify-only]" : ""}${keepExisting ? " [keep]" : ""}\n`);

    if (!verifyOnly) {
        if (!keepExisting) await reset();

        console.log("\n📝 写入示范切面：");
        const {written, errorIssues, noteIssues} = await seed();

        console.log(`\n写入完成：${written} 个切面；E 类 issues ${errorIssues.length}，提示类 issues ${noteIssues.length}。`);
        if (noteIssues.length) {
            console.log("提示类 issues（base-shifted/masked 等，补过去时正常）：");
            for (const i of noteIssues) console.log(`  - [${i.code}] ${i.subjectId ?? ""}${i.attr ?? ""} ${i.message}`);
        }
        if (errorIssues.length) {
            console.error("\n❌ 出现 E 类 issues（数据错误）：");
            for (const i of errorIssues) console.error(`  - [${i.code}] ${i.subjectId ?? ""}${i.attr ?? ""} ${i.message}`);
            throw new Error("示范数据包含 E 类 issues");
        }
    }

    await verify();
    console.log("\n🎉 World Engine 示范数据就绪，execute_world 读写合一工具工作正常。");
}

    await main();
} catch (error) {
    console.error("\n❌ 失败：", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
} finally {
    try {
        await closeProject(projectRef, "shutdown");
    } finally {
        await runtime.stop();
    }
}
