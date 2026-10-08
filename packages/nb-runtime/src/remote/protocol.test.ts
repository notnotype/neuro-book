import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {defineRemoteService, failureFor, leaseHolderOf, parseFrame, reservedKeys, validationProblems, WIRE_PROTOCOL_VERSION, wireMismatch} from "./remote";
import type {RemoteCause} from "./remote";

const caller = {instanceId: "browser-1", location: "browser", client: "profile-1", plugin: "nbook.files", entry: "web", generation: 1, via: null};

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: "request",
        id: "r1",
        target: "project",
        contract: "nbook.files/files",
        version: 1,
        method: "list",
        effect: "read",
        input: {uri: "project://"},
        $nbConsumer: caller,
        $nbChain: [],
        ...overrides,
    };
}

describe("Spec plugin-channel 输出 4：请求阶段与失败码", () => {
    const causes: RemoteCause[] = ["target-gone", "timeout", "cancelled", "disconnected", "activation-cycle"];

    it("未派发：读写都得到确定失败，不出现 unknown-outcome", () => {
        for (const effect of ["read", "write"] as const) {
            expect(causes.map((cause) => failureFor("undispatched", effect, cause).code)).toEqual(["target-gone", "timeout", "cancelled", "unavailable", "unavailable"]);
        }
    });

    it("帧已发出、还没收到 ACK：读请求断开为 unavailable、其余按原因；写请求一律 unknown-outcome 并附原因", () => {
        expect(causes.map((cause) => failureFor("sent", "read", cause).code)).toEqual(["target-gone", "timeout", "cancelled", "unavailable", "unavailable"]);
        for (const cause of causes) {
            expect(failureFor("sent", "write", cause)).toEqual({ok: false, code: "unknown-outcome", cause});
        }
    });

    it("已 ACK：读请求按原因报告、断开为 target-gone；写请求一律 unknown-outcome 并附原因", () => {
        expect(causes.map((cause) => failureFor("acked", "read", cause).code)).toEqual(["target-gone", "timeout", "cancelled", "target-gone", "unavailable"]);
        for (const cause of causes) {
            expect(failureFor("acked", "write", cause)).toEqual({ok: false, code: "unknown-outcome", cause});
        }
    });
});

describe("Spec plugin-channel 输入：帧、握手与保留字段", () => {
    it("结构正确的请求帧通过；缺少调用方身份、多出字段或类型不对的帧被丢弃", () => {
        expect(parseFrame(request())).not.toBeNull();
        const {$nbConsumer: _omitted, ...withoutCaller} = request();
        expect(parseFrame(withoutCaller)).toBeNull();
        expect(parseFrame(request({extra: true}))).toBeNull();
        expect(parseFrame(request({version: 0}))).toBeNull();
        const {client: _client, ...withoutClient} = caller;
        expect(parseFrame(request({$nbConsumer: withoutClient}))).toBeNull();
        expect(parseFrame({type: "teleport"})).toBeNull();
        expect(parseFrame("request")).toBeNull();
    });

    it("握手先只看 wire 版本：另一版本的 hello 不论其余字段是什么形状都得到 wire-version 拒绝，拒绝帧是本版本的合法帧", () => {
        const instance = {id: "browser-1", kind: "browser", role: "client" as const, project: null, client: "profile-1"};
        expect(wireMismatch({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance})).toBeNull();
        const foreign = {type: "hello", wire: WIRE_PROTOCOL_VERSION + 1, instance: {id: "x"}, plugins: [{id: "nbook.files", version: "9"}]};
        expect(parseFrame(foreign)).toBeNull();
        const reject = wireMismatch(foreign);
        expect(reject).toMatchObject({type: "reject", reason: "wire-version"});
        expect(parseFrame(reject)).toEqual(reject);
        expect(wireMismatch({type: "hello", wire: "2"})).toBeNull();
        expect(wireMismatch({type: "request", wire: WIRE_PROTOCOL_VERSION + 1})).toBeNull();
        expect(wireMismatch("hello")).toBeNull();
    });

    it("hello 必须带客户端身份（服务端与项目实例为 null）、绑定请求与上次的 boot；welcome 必须带 boot 与绑定结果", () => {
        const instance = {id: "browser-1", kind: "browser", role: "client", project: null};
        const hello = {type: "hello", wire: WIRE_PROTOCOL_VERSION, bind: null, boot: null};
        expect(parseFrame({...hello, instance})).toBeNull();
        expect(parseFrame({...hello, instance: {...instance, client: "profile-1"}})).not.toBeNull();
        expect(parseFrame({...hello, instance: {...instance, client: null}})).not.toBeNull();
        expect(parseFrame({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance: {...instance, client: null}})).toBeNull();
        for (const bind of [{project: "p"}, {project: "P", generation: 1}]) {
            expect(parseFrame({...hello, instance: {...instance, client: null}, bind, boot: "boot-1"})).not.toBeNull();
        }
        expect(parseFrame({...hello, instance: {...instance, client: null}, bind: {project: "P", generation: 1, extra: true}})).toBeNull();
        expect(parseFrame({type: "welcome", wire: WIRE_PROTOCOL_VERSION, boot: "boot-1"})).toBeNull();
        expect(parseFrame({type: "welcome", wire: WIRE_PROTOCOL_VERSION, boot: "boot-1", binding: null})).not.toBeNull();
        expect(parseFrame({type: "welcome", wire: WIRE_PROTOCOL_VERSION, boot: "boot-1", binding: {id: "P", name: "p", generation: 1}})).not.toBeNull();
    });

    it("租约持有者的编码含实例、插件、入口与激活代次，不含委托代理", () => {
        const delegated = {...caller, via: {plugin: "nbook.storage", entry: "main", generation: 3}};
        expect(leaseHolderOf(delegated)).toBe(leaseHolderOf(caller));
        expect(leaseHolderOf({...caller, generation: 2})).not.toBe(leaseHolderOf(caller));
        expect(leaseHolderOf({...caller, instanceId: "browser-2"})).not.toBe(leaseHolderOf(caller));
    });

    it("业务参数里 $nb 开头的键是保留字段", () => {
        expect(reservedKeys({uri: "project://", $nbConsumer: caller})).toEqual(["$nbConsumer"]);
        expect(reservedKeys({uri: "project://"})).toEqual([]);
        expect(reservedKeys("text")).toEqual([]);
    });

    it("校验摘要只含路径与说明，不含值", () => {
        const schema = Type.Object({uri: Type.String()}, {additionalProperties: false});
        expect(validationProblems(schema, {uri: "project://"})).toBeNull();
        const problems = validationProblems(schema, {uri: 42, secret: "token-value"});
        expect(problems).not.toBeNull();
        expect(problems).not.toContain("token-value");
    });
});

describe("Spec plugin-channel 术语：远程服务合同", () => {
    const Input = Type.Object({uri: Type.String()}, {additionalProperties: false});

    it("合法合同被冻结并保留方法与事件", () => {
        const contract = defineRemoteService({
            id: "nbook.files/files",
            version: 1,
            provider: "project",
            callers: ["browser", "tui", "server"],
            methods: {list: {input: Input, output: Type.Array(Type.String()), effect: "read"}, create: {input: Input, output: Type.Null(), effect: "write", errors: {"already-exists": Type.Object({})}}},
            events: {changes: {filter: Input, payload: Type.Object({uri: Type.String()})}},
        });
        expect(Object.isFrozen(contract)).toBe(true);
        expect(contract.provider).toBe("project");
        expect(Object.keys(contract.methods)).toEqual(["list", "create"]);
        expect(Object.keys(contract.events)).toEqual(["changes"]);
    });

    it("结构不合法的合同在定义时抛 TypeError；runtime/ 开头的 id 留给内核", () => {
        const method = {input: Input, output: Type.Null(), effect: "read" as const};
        const bad: ReadonlyArray<Parameters<typeof defineRemoteService>[0]> = [
            {id: "files", version: 1, provider: "any", callers: ["browser"], methods: {list: method}},
            {id: "nbook.files/files", version: 0, provider: "any", callers: ["browser"], methods: {list: method}},
            {id: "nbook.files/files", version: 1, provider: "any", callers: [], methods: {list: method}},
            {id: "nbook.files/files", version: 1, provider: "any", callers: ["browser"], methods: {list: {...method, input: Type.Object({uri: Type.String()})}}},
            {id: "nbook.files/files", version: 1, provider: "any", callers: ["browser"], methods: {list: {...method, errors: {timeout: Type.Object({})}}}},
            {id: "nbook.files/files", version: 1, provider: "any", callers: ["browser"], methods: {events: method}},
            {id: "nbook.files/files", version: 1, provider: "any", callers: ["browser"], methods: {list: method}, events: {list: {filter: Input, payload: Type.Null()}}},
            {id: "nbook.files/files", version: 1, provider: "everywhere" as never, callers: ["browser"], methods: {list: method}},
            {id: "nbook.files/files", version: 1, provider: "any", callers: ["browser"], methods: {at: method}},
            {id: "nbook.files/files", version: 1, provider: "any", callers: ["browser"], methods: {list: {...method, errors: {"not-provided": Type.Object({})}}}},
            {id: "runtime/catalog", version: 1, provider: "any", callers: ["browser"], methods: {list: method}},
            {id: "runtime/files", version: 1, provider: "any", callers: ["browser"], methods: {list: method}},
        ];
        for (const spec of bad) {
            expect(() => defineRemoteService(spec), spec.id).toThrow(TypeError);
        }
    });
});
