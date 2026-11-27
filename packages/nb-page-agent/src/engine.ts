/**
 * 页面一侧的引擎：一个页面加载一个，宿主在窗口启动时建好（docs/specs/agent/page-agent.md 输出 15）。
 * 引用表随引擎活着；每次调用另建一个只在这次调用里用的查询缓存，页面在两次调用之间怎么变都不受影响。
 */

import type {Candidate, HighlightArgs, Locator, PageFailure, SnapshotArgs, SnapshotResult} from "./api";
import {HighlightSession} from "./guide";
import type {GuideEnvironment, GuideOptions, HighlightHandle} from "./guide";
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
    /** 高亮的文字、主题与悬停显示钩子。 */
    readonly guide?: GuideOptions;
}

export interface PageAgent {
    readonly refPrefix: string;
    snapshot(args?: SnapshotArgs): SnapshotResult | PageFailure;
    /** `mutating` 缺省 false，`settle` 缺省 false（只有高亮的 `at` 要落到唯一的可交互后代）。 */
    locate(locator: Locator, options?: Partial<LocateOptions>): Located | PageFailure;
    /** 给一个元素发引用并描述它，例如交回用户点到的那个元素。 */
    describe(element: Element): Candidate;
    /**
     * 高亮一个控件并等用户（docs/specs/agent/page-agent.md 输出 9、10）。一个页面同时只有一个高亮：开始新的一次时，上一次以
     * `replaced` 结束，不等新的装上。写错的定位抛 `TypeError`，这时上一次不受影响。
     */
    highlight(args: HighlightArgs): HighlightHandle;
}

export function createPageAgent(options: PageAgentOptions = {}): PageAgent {
    const document = options.document ?? globalThis.document;
    const refs = new RefRegistry(options.refPrefix ?? randomRefPrefix());
    const environment = () => ({inspector: new Inspector(document), refs});
    const guide: GuideEnvironment = {
        document,
        locate: (locator) => locate(environment(), locator, {mutating: false, settle: true}),
        describe: (element) => candidateOf(environment(), element),
        inspector: () => new Inspector(document),
    };
    let current: HighlightSession | null = null;
    return {
        refPrefix: refs.prefix,
        snapshot: (args = {}) => takeSnapshot(environment(), args),
        locate: (locator, locateOptions = {}) => locate(environment(), locator, {mutating: locateOptions.mutating ?? false, settle: locateOptions.settle ?? false}),
        describe: (element) => candidateOf(environment(), element),
        highlight: (args) => {
            const previous = current;
            const session = new HighlightSession(guide, options.guide ?? {}, args);
            current = session;
            previous?.end({outcome: "replaced"});
            void session.handle.outcome.then(() => {
                if (current === session) current = null;
            });
            return session.handle;
        },
    };
}
