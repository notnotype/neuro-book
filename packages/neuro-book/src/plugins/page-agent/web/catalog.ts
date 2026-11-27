/**
 * 界面目录（docs/specs/agent/page-agent.md 输出 7）：由设置窗口、工作台与命令表三处现拼，搜索用命令面板的同一份打分。
 *
 * 每条的路径是一串“点哪里（`at`）、点完出现什么（`appears`）”。已经走到中途的（例如设置窗口已经开着），从第一个还没完成的
 * 步骤给起：一步完成与否看它的 `appears` 此刻在不在页面上。
 */

import type {Locator} from "@notnotype/nb-page-agent/api";

import {OPEN_SETTINGS_COMMAND, TOGGLE_SETTINGS_COMMAND} from "nbook/plugins/settings/shared/contracts";
import type {SettingsCatalogView} from "nbook/plugins/settings/shared/contracts";
import type {SettingLayer} from "nbook/shared/settings";
import {matchCommandText} from "nbook/plugins/workbench/shared/contracts";
import type {WorkbenchCatalogView} from "nbook/plugins/workbench/shared/contracts";

import {COMMAND_TARGET} from "../shared/contracts";
import type {FindEntry, FindKind, PathStep} from "../shared/contracts";

/** 命令表里出现在活动栏或视图标题栏上的命令，文字已按界面语言翻好。 */
export interface CatalogCommand {
    readonly id: string;
    readonly title: string;
    readonly keybinding: string | null;
    /** 用户能运行、没有必填参数、此刻可用：能从命令面板运行。 */
    readonly palette: boolean;
}

export interface CatalogSources {
    readonly settings: SettingsCatalogView | null;
    readonly workbench: WorkbenchCatalogView | null;
    /** 按 id 取命令；不在命令表里的为 null。 */
    readonly command: (id: string) => CatalogCommand | null;
    /** 这个定位此刻能不能在页面上找到（不计较唯一）。 */
    readonly present: (locator: Locator) => boolean;
}

type Step = PathStep;

interface Candidate {
    readonly entry: Omit<FindEntry, "path">;
    readonly steps: readonly Step[];
    readonly texts: readonly string[];
}

const KIND_ORDER: Readonly<Record<FindKind, number>> = {setting: 0, section: 1, view: 2, command: 3};

const target = (name: string, key?: string): Locator => (key === undefined ? {target: name} : {target: name, key});

/** 从第一个还没完成的步骤给起：最后一个已完成的步骤之后的都留下；终点那一步总留着。 */
function remaining(steps: readonly Step[], present: (locator: Locator) => boolean): PathStep[] {
    let start = 0;
    steps.forEach((step, index) => {
        if (index < steps.length - 1 && step.appears !== null && present(step.appears)) start = index + 1;
    });
    return steps.slice(start).map((step) => ({at: step.at, appears: step.appears}));
}

/** 设置窗口里的路径：活动栏的设置项 → 层（当前层不支持时）→ 节 → 行（`row` 为 null 时止于节）。 */
function settingsSteps(sources: CatalogSources, settings: SettingsCatalogView, section: string, layers: ReadonlyArray<SettingLayer>, row: string | null): Step[] {
    const steps: Step[] = [];
    const entry = sources.workbench?.activityItems.find((item) => item.command === TOGGLE_SETTINGS_COMMAND || item.command === OPEN_SETTINGS_COMMAND);
    if (entry !== undefined) steps.push({at: target("workbench.activity", entry.id), appears: target("settings.section", section)});
    // 层沿用设置窗口当前的层，当前层不支持这一项时走另一层；没打开作品的窗口只有用户层，没有层切换。
    if (settings.bound && !layers.includes(settings.layer)) {
        steps.push({at: {role: "radio", name: settings.layerTitles[layers[0]!], exact: true, within: target("settings.layers")}, appears: null});
    }
    steps.push({at: target("settings.section", section), appears: row === null ? null : target("settings.row", row)});
    if (row !== null) steps.push({at: target("settings.row", row), appears: null});
    return steps;
}

function candidates(sources: CatalogSources): Candidate[] {
    const out: Candidate[] = [];
    const {settings, workbench} = sources;
    if (settings !== null) {
        for (const setting of settings.settings) {
            // 只在另一层的设置，在没打开作品的窗口里画不出来（输出 7 的“窗口没打开作品时只有用户层”）。
            if (!settings.bound && !setting.layers.includes("user")) continue;
            out.push({
                entry: {kind: "setting", title: setting.title, ...(setting.description === null ? {} : {description: setting.description}), id: setting.key},
                steps: settingsSteps(sources, settings, setting.section, setting.layers, setting.key),
                texts: [setting.title, setting.key],
            });
        }
        for (const section of settings.sections) {
            if (!settings.bound && !section.layers.includes("user")) continue;
            out.push({
                entry: {kind: "section", title: section.title, id: section.id},
                steps: settingsSteps(sources, settings, section.id, section.layers, null),
                texts: [section.title, ...section.keywords],
            });
        }
    }
    if (workbench !== null) {
        const containerOf = new Map(workbench.containers.map((container) => [container.id, container]));
        const viewSteps = (container: string | null, last: Step): Step[] => (container === null
            ? [last]
            : [{at: target("workbench.container", container), appears: last.at}, last]);
        // 不在布局里的视图页面上没有它的标签，点不到：不收它与它标题栏上的命令。
        const placed = workbench.views.filter((view) => view.placed);
        for (const view of placed) {
            const container = view.container === null ? undefined : containerOf.get(view.container);
            out.push({
                entry: {kind: "view", title: view.title, id: view.id},
                steps: viewSteps(container?.id ?? null, {at: target("workbench.view", view.id), appears: null}),
                texts: [view.title, ...(container === undefined ? [] : [container.title])],
            });
        }
        // 命令：只收活动栏与视图标题栏上画成按钮的（界面目录不收菜单）。同一命令在几处都有时取第一处。
        const seen = new Set<string>();
        const addCommand = (id: string, steps: Step[]): void => {
            if (seen.has(id)) return;
            const command = sources.command(id);
            if (command === null) return;
            seen.add(id);
            out.push({
                entry: {kind: "command", title: command.title, id, ...(command.keybinding === null ? {} : {keybinding: command.keybinding}), palette: command.palette},
                steps,
                texts: [command.title, id],
            });
        };
        for (const item of workbench.activityItems) {
            if (item.command !== null) addCommand(item.command, [{at: target("workbench.activity", item.id), appears: null}]);
        }
        for (const view of placed) {
            for (const action of view.actions) {
                const button: Step = {at: target(COMMAND_TARGET, action), appears: null};
                addCommand(action, viewSteps(view.container, button));
            }
        }
    }
    return out;
}

/** 按命令面板的打分排序（分数小的在前），同分按种类、再按标题；`kind` 限定种类。 */
export function findInCatalog(sources: CatalogSources, query: string, kind: FindKind | undefined, limit: number): FindEntry[] {
    const scored: Array<{readonly candidate: Candidate; readonly score: number}> = [];
    for (const candidate of candidates(sources)) {
        if (kind !== undefined && candidate.entry.kind !== kind) continue;
        let best: number | null = null;
        for (const text of candidate.texts) {
            const match = matchCommandText(text, query);
            if (match !== null && (best === null || match.score < best)) best = match.score;
        }
        if (best !== null) scored.push({candidate, score: best});
    }
    scored.sort((a, b) => a.score - b.score || KIND_ORDER[a.candidate.entry.kind] - KIND_ORDER[b.candidate.entry.kind] || a.candidate.entry.title.localeCompare(b.candidate.entry.title));
    return scored.slice(0, limit).map(({candidate}) => ({...candidate.entry, path: remaining(candidate.steps, sources.present)}));
}
