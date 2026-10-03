/**
 * 浏览器引导协议：窗口在挂载界面前向后端取有效插件集合（runtime.browser-host 启动序列第 2 步）。
 *
 * 前后端宿主共用这里的路径、协议版本与 schema；本目录只放合同，不引用任何一侧的实现。
 * 读取方容忍多出来的字段，只有破坏性变更才升协议版本；版本不同时窗口提示刷新，而不是尝试解析。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

export const BROWSER_BOOTSTRAP_PATH = "/api/runtime/browser-bootstrap";
export const BROWSER_PROTOCOL_VERSION = 1;

export const BrowserBootstrapSchema = Type.Object({
    protocolVersion: Type.Integer(),
    /** 有效插件集合的修订号：集合与版本不变时不变，供以后的事件流核对集合是否变化。 */
    revision: Type.String({minLength: 1}),
    /** 有浏览器入口的插件。只有 id 与版本：内置插件的浏览器定义随前端构建，后端不另存一份。 */
    plugins: Type.Array(Type.Object({id: Type.String({minLength: 1}), version: Type.String({minLength: 1})})),
});

export type BrowserBootstrap = Static<typeof BrowserBootstrapSchema>;
