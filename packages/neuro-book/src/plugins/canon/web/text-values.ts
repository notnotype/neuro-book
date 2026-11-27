/**
 * 富文本里小块的值（docs/specs/canon/author-ui.md 输出 48）：把输入框里此刻的整篇交给世界服务渲染（canon.rendering 输出 16），留着最近
 * 一次读得出来的那一篇与它的值表。值表对回小块按它自己那一篇的原文（`entry-values.ts`），所以这里交出的是“哪一篇、哪些值”成对的。
 *
 * 不走窗口的读取层（`world.ts`）：那一层按输入合并读取，并留着最近不用的几十个。这里作者每停顿一次就是一份新的整篇，留下来
 * 的全是再也用不到的整篇与值表。所以直接调用，只认最后发出的那一次。
 */

import {onScopeDispose, shallowRef, watch} from "vue";
import type {ShallowRef} from "vue";

import type {ReadPosition} from "@notnotype/nb-canon/schema";

import {RENDER_SOURCE_MAX} from "../shared/contracts";
import type {CanonClient} from "../shared/contracts";
import type {EntryTextBlock, EntryTextValue} from "./components/entry-text";

/** 作者停下输入多久以后重读（毫秒）。 */
export const VALUES_DELAY = 250;

export interface ValuesInput {
    readonly entry: string;
    readonly source: string;
    readonly position: ReadPosition;
    readonly mode: "actual" | "planned";
}

/** 一篇整篇与世界服务按它算出的值表。 */
export interface TextValueTable {
    readonly source: string;
    readonly values: readonly EntryTextValue[];
}

export interface TextValuesOptions {
    readonly call: CanonClient["call"];
    /** 要算什么；null 是不算（不在编辑、不在富文本里）。 */
    readonly input: () => ValuesInput | null;
    /** 变了就马上重读的东西：世界的版本、连接的状态（别处改了字段的值或条目的名字、重新连上）。 */
    readonly stamp: () => string | number;
    /** 排一次延后的执行，返回取消它的函数；缺省用定时器，测试换成手动的。 */
    readonly schedule?: (run: () => void, ms: number) => () => void;
}

export interface TextValues {
    /** 最近一次读得出来的那一篇与值表；还没读到过、条目读不到时为 null。此刻的整篇写得不对时（读不出来）留着上一次的。 */
    readonly table: Readonly<ShallowRef<TextValueTable | null>>;
    /** 读取本身失败的原因码（连接断着、整篇太长 `too-large`）；读到了为 null。失败时小块是“没有算”。 */
    readonly failure: Readonly<ShallowRef<string | null>>;
}

export function useTextValues(options: TextValuesOptions): TextValues {
    const schedule = options.schedule ?? ((run: () => void, ms: number) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    });
    const table = shallowRef<TextValueTable | null>(null);
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
        // 条目读不到了（刚被删）：没有值。写得不对（源文字里写到一半）：留着上一次的，小块按原文对不上的照旧。
        if (first === undefined) table.value = null;
        else if (!("error" in first)) table.value = {source: first.source, values: first.values};
    };

    /** 除了源文字以外决定读什么的东西；null 是不读。 */
    const target = (): string | null => {
        const input = options.input();
        return input === null ? null : JSON.stringify([input.entry, input.position, input.mode]);
    };
    // 开始算、换了位置或模式、世界变了：马上读。停下：在途的作废，留着的也丢掉（再开始时世界可能已经变了）。
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
        table.value = null;
        failure.value = null;
    }, {immediate: true});
    // 只是源文字变了：等作者停下再读，期间又变了就重新等。
    watch(() => options.input()?.source, (now, before) => {
        if (now === undefined || before === undefined) return;
        cancel?.();
        cancel = schedule(() => void read(), VALUES_DELAY);
    });
    onScopeDispose(() => {
        sent += 1;
        cancel?.();
        cancel = null;
    });

    return {table, failure};
}
