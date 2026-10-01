/**
 * 第一章：召唤后的第一个夜晚 - World Engine 切片
 *
 * 基于剧情设计讨论，记录召唤仪式成功后到黎明前的关键事件。
 */

import {createWorldEngineTools} from "nbook/server/agent/tools/world-engine-tools";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {closeProject, openProject} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {startProductRuntime} from "nbook/server/runtime/product-startup";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

const tools = createWorldEngineTools();
const executeWorldTool = tools.find((t) => t.key === "execute_world");
const projectRoot = "ming-ding-zhi-shi-2";
const projectRef = projectWorkspaceRef(projectRoot);
if (!process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || !process.env.NEURO_BOOK_STATE_ROOT?.trim()) {
    throw new Error("Seed脚本要求显式NEURO_BOOK_APPLICATION_ROOT与NEURO_BOOK_STATE_ROOT");
}
const workspaceRoot = resolveRuntimeWorkspaceRoot();
const runtime = startProductRuntime();
await runtime.ready;
let currentProject: ReadyProjectSessionRef;
try {
    currentProject = await openProject(projectRef, {kind: "job", source: "chapter-01-slices"}, workspaceRoot);

const context: ToolExecutionContext = {
    harness: {} as ToolExecutionContext["harness"],
    sessionId: 1,
    profileKey: "scripts.chapter-01-slices",
    workspaceRoot,
    currentProject,
    invocationId: "chapter-01-slices",
};

async function writeSlice(slice: {time: string; title: string; kind?: string; patches: any[]}) {
    if (!executeWorldTool?.executeWithContext) {
        throw new Error("缺少 World Engine 工具：execute_world");
    }
    const result = await executeWorldTool.executeWithContext(context, `execute-world-${Date.now()}`, {
        projectRoot,
        code: `
            const slice = ${JSON.stringify(slice)};
            const written = await world.slice.write({
                time: world.time.parse(slice.time),
                title: slice.title,
                kind: slice.kind,
                patches: slice.patches,
            });
            return {sliceId: written.sliceId};
        `,
    });
    const details = result.details as {data: {sliceId: string}; issues: unknown[]};
    console.log(`  ✍️  [${slice.kind || "event"}] ${slice.time} ${slice.title} -> slice ${details.data.sliceId}`);
    return details;
}

async function main() {
    console.log("📝 第一章切片写入：召唤后的第一个夜晚\n");

    // ========== 场景 1：初次对话与身份确认 ==========
    await writeSlice({
        time: "复兴纪元488年5月10日 00:05",
        title: "初次对话：身份与来历",
        kind: "event",
        patches: [
            // 维克托开口解释
            {subjectId: "viktor-brauer", path: "/events", op: "append", value: {text: "凌晨5分钟后，我强撑着疲惫向四名勇者解释：'你们被召唤到阿斯塔利亚，我需要你们的帮助。'语言魔法生效了，至少大部分人能听懂。"}, summary: "首次解释"},

            // 薇洛丝回应
            {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "子爵说我们被'召唤'到这里。月涟问我来自哪里，我简短回答：'地球，已经死了一次。'全场沉默了几秒。"}, summary: "自我介绍"},

            // 月涟试探
            {subjectId: "yuelian", path: "/events", op: "append", value: {text: "我主动问其他人来自哪里。薇洛丝的回答让我震惊——她说自己'死了一次'。这不符合任何已知的物理或生物学原理。"}, summary: "试探交流"},

            // 格鲁什警惕
            {subjectId: "grush", path: "/events", op: "append", value: {text: "瘦弱的人类男性说了很多话，我只听懂一半。那个说话很多的女人问我来历，我警告她：'血牙部落，被强行拉来。'我的手一直按在腰间——但武器不在。"}, summary: "警惕回应"},

            // 艾莉娜暴露身份
            {subjectId: "erina", path: "/events", op: "append", value: {text: "子爵解释召唤仪式时用错了一个术语，我忍不住纠正了他。其他三人看向我——我意识到自己暴露了：'我是时钟塔城学院的学生，这是个意外。'"}, summary: "暴露身份"},

            // 维克托坦诚
            {subjectId: "viktor-brauer", path: "/events", op: "append", value: {text: "艾莉娜纠正我的术语时，我意识到瞒不住了。我坦诚仪式有偏差，她不该被拉进来。我解释领地困境，恳求他们'至少听我说完'。"}, summary: "坦诚困境"},
        ],
    });

    // ========== 场景 2：安排休息，前往客房 ==========
    await writeSlice({
        time: "复兴纪元488年5月10日 00:30",
        title: "前往客房：初步探索",
        kind: "event",
        patches: [
            // 维克托安排休息
            {subjectId: "viktor-brauer", path: "/events", op: "append", value: {text: "对话陷入僵局后，我让老管家带他们去客房休息。必须给他们时间消化，强求只会适得其反。"}, summary: "安排休息"},

            // 薇洛丝观察
            {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "跟着老管家走过走廊时，我注意到墙壁有裂缝，壁画褪色。这个城堡很旧，或者说——很穷。"}, summary: "观察衰败"},
            {subjectId: "veiluosi", path: "/location", op: "replace", value: "subject://location-brauer-territory", summary: "移动到客房"},

            // 月涟研究魔法
            {subjectId: "yuelian", path: "/events", op: "append", value: {text: "走廊的照明不是电灯，而是悬浮的发光球体。我试图靠近观察，但老管家催促我们快走。这些'魔法'的能量来源是什么？"}, summary: "观察魔法"},
            {subjectId: "yuelian", path: "/location", op: "replace", value: "subject://location-brauer-territory", summary: "移动到客房"},

            // 格鲁什感知
            {subjectId: "grush", path: "/events", op: "append", value: {text: "走廊尽头传来食物的香味。我的胃在叫。老管家把我安排在单独的房间——他们怕我。"}, summary: "嗅到食物"},
            {subjectId: "grush", path: "/location", op: "replace", value: "subject://location-brauer-territory", summary: "移动到客房"},

            // 艾莉娜认出纹章
            {subjectId: "erina", path: "/events", op: "append", value: {text: "墙上挂着布劳尔家族的纹章——边境贵族的标志。学院的贵族政治课讲过，边境领地常年承受防御压力。子爵没有撒谎。"}, summary: "认出纹章"},
            {subjectId: "erina", path: "/location", op: "replace", value: "subject://location-brauer-territory", summary: "移动到客房"},
        ],
    });

    // ========== 场景 3：深夜对话，走廊偶遇 ==========
    await writeSlice({
        time: "复兴纪元488年5月10日 03:00",
        title: "深夜对话：建立初步信任",
        kind: "event",
        patches: [
            // 薇洛丝与月涟
            {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "睡不着。出门透气时在走廊遇到月涟。她问我'死了一次是什么感觉'——我回答：'像是被关机，然后重启在另一台设备上。'她似乎理解了这个比喻。"}, summary: "深夜交流"},

            // 月涟分享
            {subjectId: "yuelian", path: "/events", op: "append", value: {text: "薇洛丝的比喻让我想起泰拉的计算机理论。我告诉她，我所在的整个城市都被传送过来了——我担心其他泰拉公民的安危。"}, summary: "分享担忧"},

            // 艾莉娜加入
            {subjectId: "erina", path: "/events", op: "append", value: {text: "研究召唤阵到半夜，出来透气时遇到薇洛丝和月涟。我向她们解释召唤仪式的原理：借位面交汇打开临时通道。月涟的'科学视角'和我的魔法理论有相似之处。"}, summary: "解释原理"},

            // 格鲁什出现
            {subjectId: "grush", path: "/events", op: "append", value: {text: "她们在走廊说话的声音吵到我了。我探出头问'你们不睡？'——其实我也睡不着。部落的夜晚从来不这么安静。"}, summary: "加入对话"},

            // 四人共识
            {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "四人在走廊窗边站成一排，看着黎明前的天空。月涟说那颗星的光谱不对，格鲁什说天亮该找食物了，艾莉娜提到边境冲突。我问：'所以我们是被召唤来打仗的？'没人回答。"}, summary: "共同疑问"},
            {subjectId: "yuelian", path: "/events", op: "append", value: {text: "薇洛丝问我们是不是被召唤来打仗。我没有答案，但我知道——我需要找到其他泰拉公民，他们可能也在这个世界的某处。"}, summary: "确认目标"},
            {subjectId: "erina", path: "/events", op: "append", value: {text: "薇洛丝的问题让气氛沉重。我告诉他们，如果能研究清楚召唤仪式，也许能找到回去的路——或者至少理解为什么我们会被选中。"}, summary: "提出研究"},
            {subjectId: "grush", path: "/events", op: "append", value: {text: "她们讨论'回去'的可能性。我不关心这些。我只知道：我需要武器和食物。如果这里有强者，我会找到他们。"}, summary: "确认需求"},
        ],
    });

    // ========== 场景 4：黎明的决定 ==========
    await writeSlice({
        time: "复兴纪元488年5月10日 05:00",
        title: "黎明决定：临时共识",
        kind: "event",
        patches: [
            // 薇洛丝提议
            {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "天快亮了。我提议：'至少先听完子爵的完整解释，再决定去留。'其他三人沉默了一会儿，算是默认了。"}, summary: "提议观望"},

            // 四人各自目标
            {subjectId: "yuelian", path: "/events", op: "append", value: {text: "我们约定明早一起去找子爵正式谈判。我的目标很明确：找到其他泰拉公民，理解这个世界的'魔法'。"}, summary: "确认目标"},
            {subjectId: "grush", path: "/events", op: "append", value: {text: "她们约定明早去找那个瘦弱的领主。我跟着她们——但我的目的是拿到武器和食物。"}, summary: "跟随计划"},
            {subjectId: "erina", path: "/events", op: "append", value: {text: "我们约定明早正式谈判。对我来说，这次意外召唤是千载难逢的研究机会——只要能活着回学院汇报。"}, summary: "学术动机"},
            {subjectId: "viktor-brauer", path: "/events", op: "append", value: {text: "天快亮时，老管家告诉我四名勇者在走廊交谈到深夜。这是好兆头——至少他们开始沟通了。明天我必须拿出更具体的计划。"}, summary: "得知动向"},

            // 准备休息
            {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "回到房间。这次我真的躺下了。疲惫战胜了焦虑——至少暂时如此。"}, summary: "入睡"},
            {subjectId: "yuelian", path: "/events", op: "append", value: {text: "回房间前我再看了一眼窗外的星空。那不是泰拉的星空，但至少现在不是一个人面对了。"}, summary: "入睡"},
            {subjectId: "grush", path: "/events", op: "append", value: {text: "回到房间，我把床垫拖到门边——部落的习惯，睡觉要守住入口。"}, summary: "警惕入睡"},
            {subjectId: "erina", path: "/events", op: "append", value: {text: "回房间后我继续记录笔记，但眼皮越来越重。明天要面对的事情太多了。"}, summary: "入睡"},
        ],
    });

    console.log("\n✅ 第一章切片写入完成！");
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
