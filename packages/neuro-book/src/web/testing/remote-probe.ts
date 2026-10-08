/**
 * e2e 用的浏览器测试插件 `test.remote-probe`：启动时订阅服务端探针的 `ticks`，并把调用入口与观察结果挂到
 * `window.__nbRemoteProbe` 上供 Playwright 读取。窗口绑定了项目时，另订阅项目探针的 `ticks` 并挂上 `project`。
 * `storage` 以本插件的身份经 `nbook.storage` 读写三条示例记录（`src/shared/testing/probe-storage.ts`）。
 * `state` 是插件状态 store 的探针：声明公开键 `test.remote-probe/armed` 并贡献一条 `when` 要求它的命令，持久化字段绑
 * `probe-pair` 记录（docs/specs/state/public-state.md、state/store.md 的 e2e）。
 * 服务端一侧见 `src/server/testing/test-plugins.ts`，项目一侧见 `src/project/testing/probe-plugin.ts`。
 * 只由测试外壳（`testing/e2e-main.ts`）装配，产品清单与产品构建不含它。
 */

import {ref} from "@vue/reactivity";
import {Type} from "typebox";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteResult, RemoteUse} from "@notnotype/nb-runtime/remote";

import {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {definePublicState, defineStore} from "nbook/shared/store/store";
import type {CommitResult} from "nbook/shared/store/store";
import {windowProjectKey} from "nbook/shared/projects";
import type {StorageService} from "nbook/shared/storage";
import {probePairRecord, probeRecords, probeStorage} from "nbook/shared/testing/probe-storage";
import type {ProbeRecordName, ProbeSnapshot, ProbeStorage} from "nbook/shared/testing/probe-storage";
import {projectProbeContract, remoteProbeContract, remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";

export type {ProbeRecordName} from "nbook/shared/testing/probe-storage";

/** 窗口绑定的项目里的探针：经 `project` 目标调用。 */
export interface ProjectProbeDebug {
    echo(): Promise<RemoteResult<unknown>>;
    tick(): Promise<RemoteResult<unknown>>;
    /** 让项目子进程以给定退出码立即退出；不等结果（进程没了，结果只会是 unknown-outcome）。 */
    crash(code: number): void;
    readonly ticks: number[];
    readonly ends: string[];
    resyncs: number;
}

export interface StorageProbeDebug extends ProbeStorage {
    /** 订阅；之后收到的快照依次记进 `seen[name]`。 */
    watch(name: ProbeRecordName): Promise<boolean>;
    readonly seen: Record<ProbeRecordName, ProbeSnapshot[]>;
}

interface PairValue {
    readonly left: string;
    readonly right: string;
}

/** 插件状态 store 的探针。 */
export interface StateProbeDebug {
    setArmed(value: boolean): void;
    setLeft(value: string): Promise<CommitResult>;
    setRight(value: string): Promise<CommitResult>;
    adopt(): void;
    /** 字段此刻的数据（可序列化的副本）。 */
    pair(): {readonly ready: boolean; readonly base: unknown; readonly display: PairValue; readonly queue: number; readonly save: unknown};
    /** 每次 `change` 拿到的值：重放时拿到的是最新快照，里面有另一个标签页的修改。 */
    readonly seen: PairValue[];
}

/** `window.__nbRemoteProbe` 的形状。 */
export interface RemoteProbeDebug {
    readonly storage: StorageProbeDebug;
    readonly state: StateProbeDebug;
    /** 窗口没有绑定项目时为 null。 */
    readonly project: ProjectProbeDebug | null;
    echo(): Promise<RemoteResult<unknown>>;
    /** 发出一个 `hold`，不等结果；结果到达后记进 `holds`。 */
    hold(name: string): void;
    readonly holds: Record<string, RemoteResult<unknown>>;
    readonly ticks: number[];
    readonly ends: string[];
    resyncs: number;
}

declare global {
    interface Window {
        __nbRemoteProbe?: RemoteProbeDebug;
    }
}

const ARMED_REASON = {"zh-CN": "探针开关没打开", "en-US": "The probe switch is off"};
export const PROBE_GO_COMMAND = "test.remote-probe.go";
const probePublic = definePublicState(remoteProbeDescriptor.id, {armed: {type: "boolean", unready: false, reason: ARMED_REASON}});
const GO_DECLARATION: CommandDeclaration = {
    title: {"zh-CN": "探针动作", "en-US": "Probe Go"},
    description: "probe command that needs the probe switch on",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "read",
    when: {requires: [probePublic.key("armed")]},
    expose: {agent: "auto"},
};

function probeStore(seen: PairValue[]) {
    return defineStore("probe", ({persist, publish}) => {
        const armed = ref(false);
        const pair = persist(probePairRecord, {initial: {left: "", right: ""}});
        publish(probePublic, {armed});
        const narrow = (patch: Partial<PairValue>) => pair.commit((current) => {
            seen.push(current);
            return {...current, ...patch};
        });
        return {
            state: {armed, pair},
            actions: {
                setArmed: (value: boolean) => {
                    armed.value = value;
                },
                setLeft: (value: string) => narrow({left: value}),
                setRight: (value: string) => narrow({right: value}),
                adopt: () => pair.adopt(),
            },
        };
    });
}

export function createRemoteProbeBrowserPlugin(): PluginDefinition {
    return {
        id: remoteProbeDescriptor.id,
        entries: [defineEntry({
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: windowProjectKey}, {key: storageKey}],
            contributions: [...probePublic.contributions, {capability: COMMANDS_POINT, id: PROBE_GO_COMMAND, declaration: GO_DECLARATION}],
            activate: async (context) => {
                const atServer = context.remote.use(remoteProbeContract);
                const bound = context.services.require(windowProjectKey).project;
                const seen: PairValue[] = [];
                const store = probeStore(seen).create(context, {storage: context.services.require(storageKey), diagnostics: context.services.require(diagnosticsKey)});
                const debug: RemoteProbeDebug = {
                    storage: storageProbe(context.services.require(storageKey)),
                    state: {
                        setArmed: (value) => store.actions.setArmed(value),
                        setLeft: (value) => store.actions.setLeft(value),
                        setRight: (value) => store.actions.setRight(value),
                        adopt: () => store.actions.adopt(),
                        pair: () => JSON.parse(JSON.stringify(store.state.pair)) as ReturnType<StateProbeDebug["pair"]>,
                        seen,
                    },
                    project: bound === null ? null : await projectProbe(context.remote.use(projectProbeContract)),
                    echo: () => atServer.echo({}),
                    hold: (name) => {
                        void atServer.hold({name}).then((outcome) => {
                            debug.holds[name] = outcome;
                        });
                    },
                    holds: {},
                    ticks: [],
                    ends: [],
                    resyncs: 0,
                };
                const subscribed = await atServer.events.ticks.subscribe({}, (payload) => debug.ticks.push(payload.n), {
                    onResync: () => {
                        debug.resyncs += 1;
                    },
                    onEnd: (reason) => debug.ends.push(reason),
                });
                if (!subscribed.ok) throw new Error(`订阅 ticks 失败：${subscribed.code}`);
                window.__nbRemoteProbe = debug;
                return {contributions: {...store.contributions, [COMMANDS_POINT]: {[PROBE_GO_COMMAND]: {run: () => ({ok: true, value: "went"})}}}};
            },
        })],
    };
}

function storageProbe(storage: StorageService): StorageProbeDebug {
    const seen: StorageProbeDebug["seen"] = {shared: [], local: [], project: []};
    return {
        ...probeStorage(storage),
        watch: async (name) => {
            const opened = await storage.open(probeRecords[name]);
            if (!opened.ok) return false;
            const subscribed = await opened.handle.subscribe((snapshot) => seen[name].push(snapshot));
            return subscribed.ok;
        },
        seen,
    };
}

async function projectProbe(atProject: RemoteUse<typeof projectProbeContract>): Promise<ProjectProbeDebug> {
    const debug: ProjectProbeDebug = {
        echo: () => atProject.echo({}),
        tick: () => atProject.tick({}),
        crash: (code) => {
            void atProject.crash({code});
        },
        ticks: [],
        ends: [],
        resyncs: 0,
    };
    const subscribed = await atProject.events.ticks.subscribe({}, (payload) => debug.ticks.push(payload.n), {
        onResync: () => {
            debug.resyncs += 1;
        },
        onEnd: (reason) => debug.ends.push(reason),
    });
    if (!subscribed.ok) throw new Error(`订阅项目探针的 ticks 失败：${subscribed.code}`);
    return debug;
}
