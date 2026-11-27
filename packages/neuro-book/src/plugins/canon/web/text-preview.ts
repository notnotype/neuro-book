/**
 * 主文字编辑时的预览（docs/specs/canon/author-ui.md 输出 48）：把输入框里此刻的整篇交给世界服务渲染（canon.rendering 输出 16），
 * 留着最近一次读得出来的样子。
 *
 * 不走窗口的读取层（`world.ts`）：那一层按输入合并读取，并留着最近不用的几十个。这里作者每停顿一次就是一份新的整篇，留下来
 * 的全是再也用不到的整篇与值表。所以直接调用，只认最后发出的那一次。
 */

import {onScopeDispose, shallowRef, watch} from "vue";
import type {ShallowRef} from "vue";

import type {ReadPosition} from "@notnotype/nb-canon/schema";

import {RENDER_SOURCE_MAX} from "../shared/contracts";
import type {CanonClient} from "../shared/contracts";
import type {EntryTextBlock} from "./components/entry-text";

/** 作者停下输入多久以后重读（毫秒）。 */
export const PREVIEW_DELAY = 250;

export interface PreviewInput {
    readonly entry: string;
    readonly source: string;
    readonly position: ReadPosition;
    readonly mode: "actual" | "planned";
}

/** 源文字过不了写入时的检查：在哪一行、哪一列，原因是内核给的说明。 */
export interface PreviewProblem {
    readonly line: number;
    readonly column: number;
    readonly message: string;
}

export interface TextPreviewOptions {
    readonly call: CanonClient["call"];
    /** 要渲染什么；null 是不渲染（预览关着、不在编辑）。 */
    readonly input: () => PreviewInput | null;
    /** 变了就马上重读的东西：世界的版本、连接的状态（别处改了字段的值或条目的名字、重新连上）。 */
    readonly stamp: () => string | number;
    /** 排一次延后的执行，返回取消它的函数；缺省用定时器，测试换成手动的。 */
    readonly schedule?: (run: () => void, ms: number) => () => void;
}

export interface TextPreview {
    /** 最近一次读得出来的那一块；还没读到过、条目读不到时为 null。 */
    readonly block: Readonly<ShallowRef<Extract<EntryTextBlock, {values: unknown}> | null>>;
    /** 此刻的源文字写得不对（这时 `block` 是上一次的）；读得出来为 null。 */
    readonly problem: Readonly<ShallowRef<PreviewProblem | null>>;
    /** 读取本身失败的原因码（连接断着、结果超过一次读取的预算）；读到了为 null。 */
    readonly failure: Readonly<ShallowRef<string | null>>;
}

type Rendered = Extract<EntryTextBlock, {values: unknown}>;

export function useTextPreview(options: TextPreviewOptions): TextPreview {
    const schedule = options.schedule ?? ((run: () => void, ms: number) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    });
    const block = shallowRef<Rendered | null>(null);
    const problem = shallowRef<PreviewProblem | null>(null);
    const failure = shallowRef<string | null>(null);
    /** 发出的次数：回来的不是最后发出的那一次就不换上（先发的可能晚回来）。 */
    let sent = 0;
    let cancel: (() => void) | null = null;

    const read = async (): Promise<void> => {
        cancel?.();
        cancel = null;
        const input = options.input();
        if (input === null) return;
        const mine = ++sent;
        // 太长的不发（世界服务也会拒）：解析的时间随长度涨，项目进程在这期间做不了别的。
        if (input.source.length > RENDER_SOURCE_MAX) {
            failure.value = "too-large";
            return;
        }
        const result = await options.call("renderSource", input);
        if (mine !== sent) return;
        if (!result.ok) {
            failure.value = result.failure.code;
            return;
        }
        failure.value = null;
        const first = result.value?.blocks[0] as EntryTextBlock | undefined;
        if (first === undefined) {
            // 条目读不到了（刚被删）：没有可看的。
            block.value = null;
            problem.value = null;
        } else if ("error" in first) {
            problem.value = {line: first.error.line ?? 1, column: first.error.column ?? 1, message: first.error.message};
        } else {
            block.value = first;
            problem.value = null;
        }
    };

    /** 除了源文字以外决定读什么的东西；null 是不读。 */
    const target = (): string | null => {
        const input = options.input();
        return input === null ? null : JSON.stringify([input.entry, input.position, input.mode]);
    };
    // 开始预览、换了位置或模式、世界变了：马上读。停下预览：在途的作废，留着的也丢掉（再打开时世界可能已经变了）。
    // 交给 `watch` 的是一个字符串：交数组的话每次求值都是新的一个，Vue 当它变了；而 `target()` 经 `input()` 也读到源文字，
    // 于是源文字每变一次这里就马上读一次，下面那条的停顿白等。
    watch(() => {
        const now = target();
        return now === null ? null : `${now}\u0000${String(options.stamp())}`;
    }, (now) => {
        if (now !== null) {
            void read();
            return;
        }
        sent += 1;
        cancel?.();
        cancel = null;
        block.value = null;
        problem.value = null;
        failure.value = null;
    }, {immediate: true});
    // 只是源文字变了：等作者停下再读，期间又变了就重新等。
    watch(() => options.input()?.source, (now, before) => {
        if (now === undefined || before === undefined) return;
        cancel?.();
        cancel = schedule(() => void read(), PREVIEW_DELAY);
    });
    onScopeDispose(() => {
        sent += 1;
        cancel?.();
        cancel = null;
    });

    return {block, problem, failure};
}
