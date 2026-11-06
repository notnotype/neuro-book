/**
 * 输入框的 `@` 引用（docs/specs/agent/conversation.md 输出 28）：按名字或标题找项目里的文件，选中后插进 `[名字](project://路径)`。
 * 菜单函数要同步交回（nb-agent-ui 的 `resolveTriggerMenu` 约定）：没取到的查询先显示加载中，数据到了调 `onChange`，宿主换一个新函数，
 * 编辑器按当前查询重取。
 */

import {writeInlineLink} from "@notnotype/nb-markdown";
import type {TriggerMenu, TriggerMenuContext} from "@notnotype/nb-agent-ui";

import type {FindResult} from "nbook/plugins/files/shared/contracts";
import {encodeFileTarget} from "nbook/plugins/markdown/shared/targets";

const LIMIT = 20;
/** 只记最近几个查询：输入时一个字一个查询，留着回删时不用再问。 */
const CACHE_SIZE = 30;

export interface FileMentionTexts {
    readonly title: string;
    readonly empty: string;
    readonly noProject: string;
    readonly failed: string;
}

export interface FileMentions {
    resolve(context: TriggerMenuContext): TriggerMenu;
}

export function createFileMentions(options: {
    /** 没有打开作品时为 null。 */
    readonly find: ((query: string, limit: number) => Promise<{readonly ok: true; readonly value: FindResult} | {readonly ok: false}>) | null;
    readonly texts: () => FileMentionTexts;
    readonly onChange: () => void;
}): FileMentions {
    const cache = new Map<string, FindResult | "failed">();
    const asking = new Set<string>();

    const ask = (query: string): void => {
        const {find} = options;
        if (find === null || asking.has(query)) return;
        asking.add(query);
        void find(query, LIMIT).then((result) => {
            if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
            cache.set(query, result.ok ? result.value : "failed");
        }, () => {
            cache.set(query, "failed");
        }).finally(() => {
            asking.delete(query);
            options.onChange();
        });
    };

    return {
        resolve(context) {
            const texts = options.texts();
            if (context.trigger !== "@") return {items: []};
            if (options.find === null) return {title: texts.title, items: [], emptyText: texts.noProject};
            const query = context.query.trim();
            const found = cache.get(query);
            if (found === undefined) {
                ask(query);
                return {title: texts.title, items: [], loading: true};
            }
            if (found === "failed") {
                // 下一次再问：失败多半是暂时的，别把这个查询一直记成失败。
                cache.delete(query);
                return {title: texts.title, items: [], emptyText: texts.failed};
            }
            return {
                title: texts.title,
                emptyText: texts.empty,
                items: found.items.map((item) => {
                    const label = item.title ?? item.name;
                    return {
                        id: item.path,
                        label,
                        description: item.path,
                        iconClass: "i-lucide-file-text",
                        insertText: writeInlineLink(label, encodeFileTarget(`project://${item.path}`)),
                    };
                }),
            };
        },
    };
}
