import assert from "node:assert/strict";
import type {AgentHost, ExtensionHandle, SessionApi} from "./source/packages/nb-harness/src/kernel/api/index.ts";
import {createAgentHost} from "./source/packages/nb-harness/src/kernel/session/agent-host.ts";
import {defineExtension} from "./source/packages/nb-harness/src/kernel/extension/define.ts";
import {defineProfile} from "./source/packages/nb-harness/src/kernel/extension/profile.ts";
import {createMemoryStore} from "./source/packages/nb-harness/src/kernel/log/memory-store.ts";
import {createTestClock} from "./source/packages/nb-harness/src/kernel/testing/clock.ts";
import {createTestModel, type TestModel} from "./source/packages/nb-harness/src/kernel/testing/model.ts";

const lifecycle: string[] = [];
const provider = (generation: string) => {
    const extension = defineExtension({
        id: "review.required",
        version: "1",
        contribute: {review: {value: () => generation}},
        mount: () => {
            lifecycle.push(`mount:${generation}`);
            return () => { lifecycle.push(`cleanup:${generation}`); };
        },
    });
    return {id: extension.id, plugin: "review", declaration: {}, implementation: () => extension};
};
const profile = defineProfile({id: "review.profile", version: "1", name: "Review", description: "Review", system: "real-profile-marker", dependsOn: [provider("contract").implementation()]});
function fixture() {
    const model = createTestModel();
    const host = createAgentHost({
        store: createMemoryStore(),
        profiles: {resolve: (key: string) => key === profile.id ? profile : undefined},
        models: model.port,
        tools: {declarations: () => [], create: () => { throw Error("unexpected tool"); }},
        resources: () => ({read: async () => undefined, resolve: (uri: string) => uri}),
        sessions: {get: async () => { throw Error("unexpected session"); }},
        clock: createTestClock(),
        approve: async () => ({verdict: "allow", by: "test"}),
    });
    return {host, model};
}
function publish(host: AgentHost, handle: ExtensionHandle) {
    host.extensions.prepare(handle);
    host.extensions.published(handle);
}
async function send(session: SessionApi, model: TestModel) {
    model.script("答复");
    const result = await session.send({commandId: "send", input: {text: "请求"}});
    assert.equal(result.ok, true);
    assert.equal(typeof result.value.runId, "string");
    await session.waitRun(result.value.runId);
    return JSON.stringify(model.requests.at(-1)!.system);
}

{
    const {host, model} = fixture();
    const first = provider("before-close");
    publish(host, first);
    const created = await host.create({profile: profile.id});
    assert.equal(created.ok, true);
    const id = created.value.id;
    const originalHash = (await created.value.snapshot()).profile.hash;
    await host.close(id);
    await host.extensions.revoke(first, "uninstalled");
    const opened = await host.open(id);
    assert.equal(opened.ok, true);
    try {
        assert.deepEqual((await opened.value.snapshot()).readOnly, {code: "dependency-missing"});
        publish(host, provider("late"));
        const system = await send(opened.value, model);
        const recovered = await opened.value.snapshot();
        assert.equal(recovered.readOnly, null);
        assert.notEqual(recovered.profile.hash, originalHash);
        assert.equal(system.includes("real-profile-marker"), false);
        console.log(JSON.stringify({scenario: "open-missing-then-publish", readOnly: recovered.readOnly, realHashRestored: recovered.profile.hash === originalHash, realSystemUsed: system.includes("real-profile-marker")}));
    } finally {
        await host.close(id);
    }
}
{
    lifecycle.length = 0;
    const {host, model} = fixture();
    const first = provider("generation-one");
    publish(host, first);
    const created = await host.create({profile: profile.id});
    assert.equal(created.ok, true);
    const session = created.value;
    try {
        await host.extensions.revoke(first, "deactivated");
        const missing = await session.snapshot();
        assert.deepEqual(missing.readOnly, {code: "dependency-missing"});
        assert.deepEqual(lifecycle, ["mount:generation-one"]);
        assert.equal(missing.extensions[0]?.status, "active");
        publish(host, provider("generation-two"));
        const system = await send(session, model);
        assert.equal((await session.snapshot()).readOnly, null);
        assert.equal(system.includes("generation-one"), true);
        assert.equal(system.includes("generation-two"), false);
        console.log(JSON.stringify({scenario: "revoke-and-republish-same-version", lifecycle, statusAfterRevoke: missing.extensions[0].status, oldImplementationUsed: system.includes("generation-one"), newImplementationUsed: system.includes("generation-two")}));
    } finally {
        await host.close(session.id);
    }
}
