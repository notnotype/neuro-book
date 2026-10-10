/**
 * 内置的消息、内容与有状态节点，用公开的 `NodeTypeDefinition` 写：注册接口先被自己人走过一遍，插件照着做就行。
 * 布局节点不在这里（它们不经注册表）。
 */

import {Type} from "typebox";
import {BUILTIN, createNode} from "../nodes";
import type {JsonValue, NodeTypeDefinition, ProfileChild, ProfileNode} from "../types";

const MESSAGE_PARENTS = [BUILTIN.prompt, BUILTIN.history, BUILTIN.appending];
const CONTENT_HOSTS = ["*message", BUILTIN.system, "*stateful"];

const user: NodeTypeDefinition = {id: BUILTIN.user, category: "message", role: "user", props: Type.Object({once: Type.Optional(Type.Boolean())}), parents: MESSAGE_PARENTS, children: "content"};
const developer: NodeTypeDefinition = {id: BUILTIN.developer, category: "message", role: "developer", props: Type.Object({once: Type.Optional(Type.Boolean())}), parents: MESSAGE_PARENTS, children: "content"};
const assistant: NodeTypeDefinition = {id: BUILTIN.assistant, category: "message", role: "assistant", props: Type.Object({}), parents: [BUILTIN.prompt, BUILTIN.appending], children: "content"};

const tag: NodeTypeDefinition = {
    id: BUILTIN.tag,
    category: "content",
    layout: "block",
    props: Type.Object({name: Type.String({pattern: "^[a-z][a-z0-9-]*$"})}),
    parents: CONTENT_HOSTS,
    children: "content",
    render: (node: ProfileNode): ProfileChild => {
        const name = node.props.name as string;
        return createNode(BUILTIN.fragment, {children: [`<${name}>\n`, ...node.children, `\n</${name}>`]});
    },
};

/** 图片由渲染引擎按节点类型直接产生 ImageContent；render 只是占位，返回节点本身。 */
const image: NodeTypeDefinition = {
    id: BUILTIN.image,
    category: "content",
    props: Type.Object({mimeType: Type.String(), data: Type.String()}),
    parents: [BUILTIN.user],
    children: "none",
    render: (node: ProfileNode): ProfileChild => node,
};

type ReminderState = {lastTurn: number; watch?: JsonValue};

/** Spec 输出 10：各条件同时成立才出现；状态记录最后出现的轮次与 watch 值。 */
const reminder: NodeTypeDefinition = {
    id: BUILTIN.reminder,
    category: "stateful",
    props: Type.Object({
        id: Type.String({minLength: 1}),
        when: Type.Optional(Type.Boolean()),
        every: Type.Optional(Type.Integer({minimum: 1})),
        watch: Type.Optional(Type.Unknown()),
        once: Type.Optional(Type.Boolean()),
    }),
    parents: [BUILTIN.appending],
    children: "content",
    render: (node, context) => {
        const previous = (context.state ?? null) as ReminderState | null;
        const {when, every, watch, once} = node.props as {when?: boolean; every?: number; watch?: JsonValue; once?: boolean};
        const turn = context.prompt.turn;
        const shown =
            (when === undefined || when) &&
            (every === undefined || previous === null || turn - previous.lastTurn >= every) &&
            (watch === undefined || previous === null || JSON.stringify(previous.watch ?? null) !== JSON.stringify(watch)) &&
            (once !== true || previous === null);
        if (!shown) return {content: null, state: previous};
        const state: ReminderState = {lastTurn: turn, ...(watch === undefined ? {} : {watch})};
        return {content: createNode(BUILTIN.fragment, {children: ["<system-reminder>\n", ...node.children, "\n</system-reminder>"]}), state};
    },
};

export const BUILTIN_DEFINITIONS: readonly NodeTypeDefinition[] = [user, developer, assistant, tag, image, reminder];
