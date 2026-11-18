/**
 * 设置窗口的数据来源：分区目录与 page 的交付状态（`sections.ts`），以及用户编辑的写入路径（docs/specs/settings/
 * configuration.md 输出 19）。由配置核心入口提供给 `nbook.settings` 自己的其它浏览器入口，不是公开接口：
 *
 * - 设置窗口要工作台的通知与浮层，挂窗口的入口因此不能是配置核心入口（工作台依赖配置核心，静态环把可选依赖也算在内），
 *   只能经服务拿到核心入口里的配置实例与分区注册表。
 * - 用户编辑以核心入口自己的身份发出，拥有者据此放行，写的是任何已声明项。门面只发给 `nbook.settings` 自己、没有经过
 *   代理的调用方；别的插件解析这个键，门面工厂抛错，解析以初始化失败结束。
 */

import type {FormOptionSources} from "@notnotype/nb-form/vue";
import {provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {ProvidedService} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {WindowPluginRetry} from "nbook/shared/host";
import {SETTINGS_POINT} from "nbook/shared/settings";
import type {SettingDeclaration, SettingDefinition, SettingLayer, SettingWriteResult} from "nbook/shared/settings";

import type {InstanceLayerState, SettingsInstance} from "../shared/instance";
import {userEditProblem} from "../shared/layers";
import type {AcceptedSetting, LayerEdit} from "../shared/layers";
import type {LayerEditor, LayerFile} from "../shared/remote-link";
import type {ChoiceSourceRegistry} from "./choices";
import type {SettingsPageDelivery, SettingsPageLoad, SettingsSectionEntry, SettingsSectionRegistry} from "./sections";

/** 一条已接受的配置项声明：声明者与可交给配置服务读写的定义；声明是登记时补全过的，标题总有值。 */
export interface WindowSetting {
    readonly plugin: string;
    readonly definition: SettingDefinition<unknown> & {readonly declaration: SettingDeclaration};
}

export interface SettingsWindowSource {
    /** 窗口所在的宿主：分区声明的 `host` 按它决定列不列；缺省不在桌面壳里。 */
    readonly environment?: {readonly desktop: boolean};
    /** 已接受的分区声明，按分区 id 的码元顺序。 */
    sections(): ReadonlyArray<SettingsSectionEntry>;
    /** 本窗口已接受的全部配置项声明，按键的码元顺序；插件集合不变，结果也不变。 */
    settings(): ReadonlyArray<WindowSetting>;
    /** 一层此刻的情况（设置窗口顶部的层说明）；在 computed 里读会随层更新重算。 */
    layer(layer: SettingLayer): InstanceLayerState;
    /** 分区的交付状态；在 computed 里读会随交付变化重算。 */
    delivery(sectionId: string): SettingsPageDelivery;
    load(sectionId: string): Promise<SettingsPageLoad>;
    retry(sectionId: string): Promise<WindowPluginRetry>;
    /** 窗口显示一个 page 分区时调用：所属入口还没激活就按需激活它（`sections.ts`）。 */
    activate(sectionId: string): void;
    /** 选项提供者的选项源（`choices.ts`）：对象本身不变，读其中一项时按需激活它的提供者。 */
    options(): FormOptionSources;
    /** 把任何已声明项的这一层设为 `value`；成功返回时本窗口已应用写后的层快照。 */
    edit(key: string, layer: SettingLayer, value: unknown): Promise<SettingWriteResult>;
    /** 从这一层删掉这个键（恢复默认、移除本作品的设置）。 */
    unset(key: string, layer: SettingLayer): Promise<SettingWriteResult>;
    /**
     * 整份读写这一层的设置文件（设置文件视图）；窗口没有绑定作品时没有项目层，为 undefined。整份写成功返回时本窗口已应用
     * 写后的层快照。
     */
    file(layer: SettingLayer): LayerFile | undefined;
}

export const settingsWindowSourceKey: ServiceKey<SettingsWindowSource> = defineServiceKey<SettingsWindowSource>("nbook.settings/window-source");

export interface SettingsWindowSourceOptions {
    readonly environment?: {readonly desktop: boolean};
    readonly sections: SettingsSectionRegistry;
    readonly choices: ChoiceSourceRegistry;
    readonly declarations: ReadonlyMap<string, AcceptedSetting>;
    /** 窗口没有绑定作品时没有项目层。 */
    readonly editors: {readonly user: LayerEditor; readonly project?: LayerEditor};
    readonly files: {readonly user: LayerFile; readonly project?: LayerFile};
    readonly instance: SettingsInstance;
}

export function createSettingsWindowSource(options: SettingsWindowSourceOptions): SettingsWindowSource {
    // 定义由已接受的声明写出：与插件自己 `defineSetting` 的结果同形，配置服务按键读写，读到的是同一份声明。
    const settings: ReadonlyArray<WindowSetting> = Object.freeze([...options.declarations]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, declared]) => Object.freeze({
            plugin: declared.plugin,
            definition: Object.freeze({key, declaration: declared.declaration, contribution: Object.freeze({capability: SETTINGS_POINT, id: key, declaration: declared.declaration})}),
        })));
    const write = async (key: string, layer: SettingLayer, edit: LayerEdit): Promise<SettingWriteResult> => {
        // 核对顺序同声明者的写入（输出 11），只是不看声明者；调用方身份由拥有者核对。
        const problem = userEditProblem(key, options.declarations.get(key), edit, layer);
        if (problem !== null) return {ok: false, ...problem};
        const editor = options.editors[layer];
        if (editor === undefined) return {ok: false, code: "no-project", detail: "这个窗口没有绑定作品，没有项目层"};
        // 先复制一份：排队与传输期间调用方再改原对象不影响这次写入。
        const result = await editor.edit(key, edit.kind === "set" ? {kind: "set", value: structuredClone(edit.value)} : edit);
        if (!result.ok) return result;
        options.instance.accept(layer, result.snapshot);
        return {ok: true};
    };
    return {
        environment: Object.freeze({desktop: options.environment?.desktop === true}),
        sections: () => options.sections.catalog,
        settings: () => settings,
        layer: (layer) => options.instance.layer(layer),
        delivery: (sectionId) => options.sections.delivery(sectionId),
        load: (sectionId) => options.sections.load(sectionId),
        retry: (sectionId) => options.sections.retry(sectionId),
        activate: (sectionId) => options.sections.activate(sectionId),
        options: () => options.choices.sources,
        edit: (key, layer, value) => write(key, layer, {kind: "set", value}),
        unset: (key, layer) => write(key, layer, {kind: "delete"}),
        file: (layer) => {
            const file = options.files[layer];
            if (file === undefined) return undefined;
            return {
                read: () => file.read(),
                write: async (text, revision) => {
                    const result = await file.write(text, revision);
                    if (result.ok) options.instance.accept(layer, result.snapshot);
                    return result;
                },
                watch: (onRevision) => file.watch(onRevision),
            };
        },
    };
}

/** 配置项声明里 `choices: {from}` 引用的提供者 id：没有人提供的也要在选项源里，显示为不可用。 */
export function choiceReferences(declarations: ReadonlyMap<string, AcceptedSetting>): ReadonlyArray<string> {
    return [...declarations.values()].flatMap(({declaration}) => {
        const choices = declaration.choices;
        return choices !== undefined && "from" in choices ? [choices.from] : [];
    });
}

/** 只发给 `owner` 插件自己、没有经过代理的调用方（见模块头）。 */
export function provideSettingsWindowSource(source: SettingsWindowSource, owner: string): ProvidedService<SettingsWindowSource> {
    return provideServicePerConsumer(settingsWindowSourceKey, (consumer) => {
        if (consumer.plugin !== owner || consumer.via !== null) throw new TypeError(`${settingsWindowSourceKey.name} is only provided to entries of ${owner} itself; the caller is ${consumer.plugin ?? "the host"}`);
        return {...source};
    });
}
