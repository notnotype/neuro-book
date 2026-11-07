/**
 * 编辑器标签的记录（docs/specs/ui/workbench-layout.md“副作用与数据”）：绑定项目的窗口把 `tabId` → 地址、编辑器、preview、固定、上次的光标与语言存进 project/local 记录 `editor.tabs`，不存正文。
 * 标签在哪块面板、活动的是谁在工作台的 `workbench.layout` 里。外部改坏的记录由 Storage 判为损坏并保护。
 *
 * 几个窗口共用这一条记录，而布局文档是后写胜出：所以按键合并，只写自己有的、只删自己确实关掉的，别的窗口的标签留着，布局文档最后指向谁都找得到它。
 */

import {effect} from "@vue/reactivity";
import {Type} from "typebox";

import {RESOURCE_PATH_PATTERN} from "nbook/plugins/files/shared/contracts";
import {defineRecord, MAX_RECORD_MAX_BYTES} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";

import {LANGUAGE_ID_PATTERN} from "../shared/contracts";
import type {TabsSnapshot} from "./groups/groups";

const ADDRESS_PATTERN = `^(?:project|user)://${RESOURCE_PATH_PATTERN.slice(1)}`;

const TabsSchema = Type.Object({
    tabs: Type.Record(Type.String({minLength: 1, maxLength: 64}), Type.Union([
        Type.Object({page: Type.Literal(true)}, {additionalProperties: false}),
        Type.Object({
            address: Type.String({pattern: ADDRESS_PATTERN}),
            editor: Type.String({pattern: "^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+$"}),
            preview: Type.Boolean(),
            // 固定（docs/specs/workbench/editor.md 输出 50）。
            pinned: Type.Optional(Type.Literal(true)),
            // 上次的光标（输出 30）。
            cursor: Type.Optional(Type.Union([
                Type.Object({offset: Type.Integer({minimum: 0})}, {additionalProperties: false}),
                Type.Object({line: Type.Integer({minimum: 1}), column: Type.Integer({minimum: 1})}, {additionalProperties: false}),
            ])),
            // 选定的语言（输出 45）。
            language: Type.Optional(Type.String({pattern: LANGUAGE_ID_PATTERN})),
        }, {additionalProperties: false}),
    ])),
}, {additionalProperties: false});

export const EDITOR_TABS_RECORD = defineRecord({key: "editor.tabs", scope: "project", locality: "local", version: 1, schema: TabsSchema, maxBytes: MAX_RECORD_MAX_BYTES});

const EMPTY: TabsSnapshot = {tabs: {}};

export const editorTabsStore = defineStore("editor", ({persist}) => {
    const record = persist(EDITOR_TABS_RECORD, {initial: EMPTY});
    /**
     * 本窗口知道的键：打开时读到的（没恢复的就是没主的，布局第一次存盘时删掉）加上写过的。不在这里的键是别的窗口的，不动。记录读完那一刻定下：之后 `base` 跟着别的窗口的写入变，
     * 那些键不算本窗口读到的。
     */
    let known: ReadonlySet<string> | null = null;
    effect(() => {
        if (known !== null || !record.ready) return;
        known = new Set(record.base?.status === "ok" ? Object.keys(record.base.value.tabs) : []);
    });

    const paused = (): boolean => record.save.state === "failed" || record.save.state === "unknown";
    /**
     * `removals`：连删除一起写。删除只在布局存盘前写（关卡）：标签关掉时布局要等合并计时，这时就把它从记录里删了的话，其间刷新，布局还列着它、记录已经没有，已经关掉的标签就成了“记录丢了”的占位。
     * 布局被保护（损坏、读不了）时关卡不走，也就不会把读到的标签当成没主的删掉。
     */
    const write = async (snapshot: TabsSnapshot, removals: boolean): Promise<boolean> => {
        const removed = removals ? [...(known ?? [])].filter((id) => !(id in snapshot.tabs)) : [];
        known = new Set([...(removals ? [] : (known ?? [])), ...Object.keys(snapshot.tabs)]);
        const mine = JSON.parse(JSON.stringify(snapshot.tabs)) as TabsSnapshot["tabs"];
        const result = await record.commit((current) => ({tabs: {...Object.fromEntries(Object.entries(current.tabs).filter(([id]) => !removed.includes(id))), ...mine}}));
        // 记录损坏时 Storage 保护原件，不写：标签恢复时显示占位，布局照常存，不让一条坏记录把布局也卡住。
        return result === "saved" || result === "unchanged" || result === "protected";
    };

    return {
        state: {record},
        actions: {
            /** 属性变了。暂停期间不排队：恢复时（`recover`）写的是那一刻的全部。 */
            save: (snapshot: TabsSnapshot): void => {
                if (!paused()) void write(snapshot, false);
            },
            /** 布局存盘前的关卡（`EditorSaveGate.pass`）：这一份写下去了才返回真。暂停着直接返回假，不在这里重试。 */
            saveBeforeLayout: async (snapshot: TabsSnapshot): Promise<boolean> => (paused() ? false : write(snapshot, true)),
            /** 用户点了重试（`EditorSaveGate.recover`）：记录读不了的先重新打开，排着的重发，通了再写这一刻的全部。 */
            recover: async (snapshot: TabsSnapshot): Promise<boolean> => {
                if (record.failure !== null) await record.reopen();
                await record.retry();
                return paused() ? false : write(snapshot, true);
            },
        },
    };
});

export type EditorTabsStore = ReturnType<typeof editorTabsStore.create>;
