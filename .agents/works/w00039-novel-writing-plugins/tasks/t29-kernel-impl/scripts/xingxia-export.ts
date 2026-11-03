/**
 * 导出 t16 原型里星瑕样本的写入与原型算出的结果（docs/specs/canon/project.md 场景 1），给 nb-canon 的样本对照测试用。
 *
 * 用法：bun xingxia-export.ts <原型目录> <输出 JSON>
 *   原型目录：t16 草稿 worktree 里的 `packages/neuro-book/src/plugins/drafts/web/components/world-engine`（草稿从不提交，
 *   所以导出结果要存下来）。
 *
 * 样本按原型的顺序重放：六步（开局、填数、两章的计划与记账），再加作者的动作：把蛋糕改成 −2,000（改设定）、按正文改
 * 发色并由 Agent 给建议、还原“改蛋糕”那次修订、记一笔工资（补记）。原型的“记工资”动作只写文字、不给数，是给语义档
 * 准备的；存款按精确档时 Spec 不接受只有文字的一笔（canon.model 的补丁种类），所以这里按 3,000 记。每一项记下当时原型给出的写入草稿（id 是原型的 id）
 * 与要同步的章节文件；最后在每个读取位置（初值、每章开头与末尾）记下每个条目的样子，以及待处理、每次修订的回执。
 * 存款按精确档。
 */

import {writeFile} from "node:fs/promises";
import {join} from "node:path";

const [dir, output] = process.argv.slice(2);
if (dir === undefined || output === undefined) throw new Error("用法：bun xingxia-export.ts <原型目录> <输出 JSON>");

const engine = await import(join(dir, "engine.ts"));
const story = await import(join(dir, "story.ts"));
const store = await import(join(dir, "store.ts"));

type World = {version: number; chapters: Array<{id: string; title: string; outline: string; text: string}>; entries: Record<string, {init: unknown}>; revisions: Array<{id: string; impact: unknown}>; reductions: Record<string, {text: string; inputs: string[]}>};
type Item = {label: string; files?: Record<string, unknown>; draft: (world: World) => unknown};
// 原型的 NAMED_ACTIONS 在 store.ts 里，它引用 vue；样本只用其中的两项。

const MODE = "exact";
const steps = (story.buildSteps(MODE) as Item[]).map((step) => ({label: step.label, ...(step.files === undefined ? {} : {files: step.files}), draft: step.draft}));
const named = (name: string): Item[] => store.NAMED_ACTIONS[name] as Item[];

let world = engine.emptyWorld(story.componentTypes(MODE), structuredClone(story.CHAPTERS)) as World;
const items: Array<{label: string; files?: Record<string, unknown>; draft: unknown}> = [];
const run = (item: Item) => {
    for (const [id, patch] of Object.entries(item.files ?? {})) Object.assign(world.chapters.find((chapter) => chapter.id === id)!, patch);
    const draft = item.draft(world);
    items.push({label: item.label, ...(item.files === undefined ? {} : {files: item.files}), draft: structuredClone(draft)});
    world = engine.publish(world, draft, story.fakeSmallModel) as World;
};

for (const step of steps) run(step);
for (const item of named("fixCake")) run(item);
const fixCake = world.revisions.at(-1)!.id;
for (const item of named("hairFollowText")) run(item);
const blocking = engine.dependents(world, fixCake) as string[];
if (blocking.length > 0) throw new Error(`改蛋糕的修订 ${fixCake} 有依赖：${blocking.join("、")}，样本要换一个还原目标`);
run({label: "你：还原“把蛋糕改成 −2,000”", draft: (current) => engine.revertDraft(current, fixCake)});
run({label: "你：记一笔“工资到账，三千左右”（按 3,000 记）", draft: (current) => story.recordOne(current, "ch2", "panel.存款", "工资到账，三千左右", 3000)});

const positions = [{kind: "initial"}, ...world.chapters.flatMap((chapter) => (["start", "end"] as const).map((edge) => ({kind: "chapter", chapter: chapter.id, edge})))];
const results = positions.map((position) => {
    const folded = engine.fold(world, position, "actual") as {entries: Record<string, {state: unknown; appeared: boolean; origins: Record<string, Array<{result: unknown}>>}>; diagnostics: unknown[]};
    return {
        position,
        entries: Object.fromEntries(Object.entries(folded.entries).map(([id, entry]) => [id, {appeared: entry.appeared, state: entry.state}])),
        diagnostics: folded.diagnostics,
    };
});

await writeFile(
    output,
    `${JSON.stringify(
        {
            source: "w00039 t16 草稿 worktree 的世界引擎原型（packages/neuro-book/src/plugins/drafts/web/components/world-engine）",
            moneyMode: MODE,
            componentTypes: story.componentTypes(MODE),
            chapters: story.CHAPTERS,
            items,
            reductions: Object.values(world.reductions),
            results,
            pending: engine.pendingItems(world),
            receipts: world.revisions.map((revision) => ({id: revision.id, impact: revision.impact})),
        },
        null,
        1,
    )}\n`,
);
console.log(`导出 ${String(items.length)} 项写入、${String(positions.length)} 个读取位置到 ${output}`);
