/**
 * 夹具页：把一段 HTML 放进空白页、注入打好的引擎包，再在页面里建一个引擎。断言都经 `page.evaluate` 读引擎的返回值。
 */

import path from "node:path";

import type {Page} from "@playwright/test";

import type {Locator, PageFailure, SnapshotArgs, SnapshotResult} from "../src/api";
import type {PageAgent, PageAgentOptions} from "../src/index";
import type {capturePage} from "../src/capture";
import type {LocateOptions} from "../src/locate";

declare global {
    interface Window {
        nbPageAgent: {createPageAgent(options?: PageAgentOptions): PageAgent; capturePage: typeof capturePage};
        agent: PageAgent;
    }
}

const BUNDLE = path.join(import.meta.dirname, "..", "dist", "e2e", "page-agent.js");

export interface FixtureOptions {
    readonly head?: string;
    readonly prefix?: string;
}

export async function openFixture(page: Page, body: string, options: FixtureOptions = {}): Promise<void> {
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>夹具</title>
<style>body{margin:0;font:14px/1.4 sans-serif}</style>${options.head ?? ""}</head><body>${body}</body></html>`);
    await page.addScriptTag({path: BUNDLE});
    await page.evaluate((prefix) => {
        window.agent = window.nbPageAgent.createPageAgent({refPrefix: prefix});
    }, options.prefix ?? "t1");
}

export function snapshot(page: Page, args: SnapshotArgs = {}): Promise<SnapshotResult | PageFailure> {
    return page.evaluate((input) => window.agent.snapshot(input), args);
}

/** 快照必须成功；失败时让用例带着失败内容挂掉。 */
export async function snapshotOk(page: Page, args: SnapshotArgs = {}): Promise<SnapshotResult> {
    const result = await snapshot(page, args);
    if ("ok" in result) throw new Error(`快照失败：${JSON.stringify(result)}`);
    return result;
}

/** 定位的结果：命中的元素用它的 id 表示（夹具里要被定位的元素都写 id）。 */
export type LocateOutcome = {readonly ok: true; readonly id: string; readonly warnings: readonly string[]} | PageFailure;

export function locate(page: Page, locator: Locator, options: Partial<LocateOptions> = {}): Promise<LocateOutcome> {
    return page.evaluate(([input, settings]) => {
        const result = window.agent.locate(input, settings);
        return result.ok ? {ok: true as const, id: result.element.id, warnings: result.warnings} : result;
    }, [locator, options] as const);
}

/** 快照文本里写着 `name` 的那一行的引用。 */
export function refOf(result: SnapshotResult, role: string, name: string): string {
    const element = result.elements.find((entry) => entry.role === role && entry.name === name);
    if (element === undefined) throw new Error(`快照里没有 ${role} "${name}"：\n${result.text}`);
    return element.ref;
}
