/**
 * 页面一侧的引擎：一个页面加载一个，宿主在窗口启动时建好（docs/specs/agent/page-agent.md 输出 15）。
 * 引用表随引擎活着；每次调用另建一个只在这次调用里用的查询缓存，页面在两次调用之间怎么变都不受影响。
 */

import type {Candidate, Locator, PageFailure, SnapshotArgs, SnapshotResult} from "./api";
import {Inspector} from "./inspect";
import {candidateOf, locate} from "./locate";
import type {Located, LocateOptions} from "./locate";
import {RefRegistry, randomRefPrefix} from "./refs";
import {takeSnapshot} from "./snapshot";

export interface PageAgentOptions {
    /** 缺省是全局的 `document`。 */
    readonly document?: Document;
    /** 这次页面加载的引用前缀；缺省随机生成（`randomRefPrefix`）。 */
    readonly refPrefix?: string;
}

export interface PageAgent {
    readonly refPrefix: string;
    snapshot(args?: SnapshotArgs): SnapshotResult | PageFailure;
    /** `mutating` 缺省 false，`settle` 缺省 false（只有高亮的 `at` 要落到唯一的可交互后代）。 */
    locate(locator: Locator, options?: Partial<LocateOptions>): Located | PageFailure;
    /** 给一个元素发引用并描述它，例如交回用户点到的那个元素。 */
    describe(element: Element): Candidate;
}

export function createPageAgent(options: PageAgentOptions = {}): PageAgent {
    const document = options.document ?? globalThis.document;
    const refs = new RefRegistry(options.refPrefix ?? randomRefPrefix());
    const environment = () => ({inspector: new Inspector(document), refs});
    return {
        refPrefix: refs.prefix,
        snapshot: (args = {}) => takeSnapshot(environment(), args),
        locate: (locator, locateOptions = {}) => locate(environment(), locator, {mutating: locateOptions.mutating ?? false, settle: locateOptions.settle ?? false}),
        describe: (element) => candidateOf(environment(), element),
    };
}
