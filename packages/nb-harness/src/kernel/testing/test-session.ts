/**
 * 扩展与 Profile 的测试工具（提案第 15 节）：内核是真的（日志、归约、视图、单写者），假的只有模型、工具、时钟、资源。
 * 存储缺省是内存存储（与 JSONL 同一份编码与校验），也可以给一个临时根用 JSONL。
 *
 * 这一版是最小形状：`say`、请求的 `outline`、事件与状态、重开。工具、手动模式、严格模式随后续切片加入。
 */

import type {AnyExtension, AnyProfile, ContributedExtension, JsonValue, LogEvent, LogStore, ModelRequest, RunResult, SessionApi, SessionEnv, StateOfExtension} from "../api/index.js";
import {defineProfile} from "../extension/profile.js";
import {createJsonlStore} from "../log/jsonl-store.js";
import {createMemoryStore} from "../log/memory-store.js";
import {closeSession, createSession, extensionState, openSession} from "../session/session.js";
import {outline} from "../view/outline.js";
import {createTestClock, type TestClock} from "./clock.js";
import {createTestModel, type TestModel} from "./model.js";

export interface TestSessionOptions {
    /** 缺省一个最小的 Profile：缺省布局、没有工具。 */
    readonly profile?: AnyProfile;
    /** 要测的扩展；直接给扩展时所属插件为 null，要测插件 id 前缀时给 `{extension, plugin}`。 */
    readonly extensions?: readonly (AnyExtension | ContributedExtension)[];
    readonly initial?: JsonValue;
    /** 缺省内存存储；给 `{root}` 用会话目录上的 JSONL。 */
    readonly store?: {readonly root: string};
    readonly startAt?: number;
    /** 测试自己拿着的时钟（例如新建会话时就要推进时间，测 `mount` 超时）。 */
    readonly clock?: TestClock;
}

export interface RequestView {
    readonly raw: ModelRequest;
    /** 一行一条消息，块以来源标出：`user: event:input | slot:clock@x`（harness/profile.md 输出 20）。 */
    outline(): string[];
}

export interface RunReport {
    readonly result: RunResult;
    /** 这次运行写进日志的事件。 */
    readonly events: readonly LogEvent[];
    readonly requests: readonly RequestView[];
}

export interface TestSession extends AsyncDisposable {
    readonly id: string;
    readonly model: TestModel;
    readonly clock: TestClock;
    readonly raw: SessionApi;
    readonly requests: readonly RequestView[];
    /** 当前叶子路径上的事件。 */
    events(): Promise<readonly LogEvent[]>;
    eventsOf(type: string): Promise<readonly LogEvent[]>;
    say(text: string): Promise<RunReport>;
    state<X extends AnyExtension>(extension: X): Promise<StateOfExtension<X>>;
    /** 像重启一样：关掉会话，从同一份日志重新打开（归约、恢复，不跑反应）。 */
    reopen(): Promise<void>;
    close(): Promise<void>;
}

export const defaultTestProfile = defineProfile({id: "test.profile", version: "1", name: "测试", description: "测试用的最小 Profile", system: "你是测试 Profile。"});

export function viewOf(request: ModelRequest): RequestView {
    return {raw: request, outline: () => outline(request)};
}

let sessionCounter = 0;

export async function createTestSession(options: TestSessionOptions = {}): Promise<TestSession> {
    const model = createTestModel();
    const clock = options.clock ?? createTestClock(options.startAt);
    const profile = options.profile ?? defaultTestProfile;
    const store: LogStore = options.store === undefined ? createMemoryStore() : createJsonlStore({root: options.store.root, now: clock.now});
    const contributed: ContributedExtension[] = (options.extensions ?? []).map((item) => ("extension" in item && "plugin" in item ? item : {extension: item as AnyExtension, plugin: null}));
    const env: SessionEnv = {
        store,
        profiles: {resolve: (key) => (key === profile.id ? profile : undefined)},
        extensions: () => contributed,
        models: model.port,
        tools: {declarations: () => [], create: (id) => Promise.reject(new Error(`the test session has no tool ${id}`))},
        resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
        sessions: {get: (id) => Promise.reject(new Error(`the test session cannot open session ${id}`))},
        clock,
        // “全部放行”只是测试的一种显式策略，不是产品缺省。
        approve: async () => ({verdict: "allow", by: "test-policy"}),
    };
    sessionCounter += 1;
    const created = await createSession(env, {profile: profile.id, id: `test-${sessionCounter}`, ...(options.initial === undefined ? {} : {initial: options.initial})});
    if (!created.ok) throw new Error(`createTestSession failed: ${created.code} ${JSON.stringify("detail" in created ? created.detail : null)}`);
    let api = created.value;
    let commands = 0;
    const commandId = () => `cmd-${(commands += 1)}`;
    const session: TestSession = {
        id: api.id,
        model,
        clock,
        get raw() {
            return api;
        },
        get requests() {
            return model.requests.map(viewOf);
        },
        events: () => api.path(),
        eventsOf: async (type) => (await api.path()).filter((event) => event.type === type),
        async say(text) {
            const before = (await api.snapshot()).head;
            const requestsBefore = model.requests.length;
            const sent = await api.send({commandId: commandId(), input: {text}});
            if (!sent.ok) throw new Error(`send failed: ${sent.code}`);
            if (sent.value.runId === null) throw new Error("send did not start a run (a run is already in progress)");
            const result = await api.waitRun(sent.value.runId);
            const {events} = await api.log({afterSeq: before, limit: 100_000});
            return {result, events, requests: model.requests.slice(requestsBefore).map(viewOf)};
        },
        async state(extension) {
            return extensionState(api, extension.id) as StateOfExtension<typeof extension>;
        },
        async reopen() {
            await closeSession(api);
            const opened = await openSession(env, session.id);
            if (!opened.ok) throw new Error(`reopen failed: ${opened.code}`);
            api = opened.value;
        },
        close: () => closeSession(api),
        [Symbol.asyncDispose]: () => closeSession(api),
    };
    return session;
}
