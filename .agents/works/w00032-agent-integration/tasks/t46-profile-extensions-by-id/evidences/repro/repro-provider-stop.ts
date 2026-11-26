import assert from "node:assert/strict";
import {createRuntimeInstance} from "./source/packages/nb-runtime/src/lifecycle/lifecycle.ts";
import {createServiceAssembly} from "./source/packages/nb-runtime/src/services/services.ts";
import {createPluginHost} from "./source/packages/nb-runtime/src/plugins/plugins.ts";
import type {PluginDefinition} from "./source/packages/nb-runtime/src/plugins/plugins.ts";
import {extensionReceiver} from "./source/packages/neuro-book/src/plugins/agent/backend/extensions.ts";
import {createAgentHost} from "./source/packages/nb-harness/src/kernel/session/agent-host.ts";
import {defineExtension} from "./source/packages/nb-harness/src/kernel/extension/define.ts";
import {defineProfile} from "./source/packages/nb-harness/src/kernel/extension/profile.ts";
import {createMemoryStore} from "./source/packages/nb-harness/src/kernel/log/memory-store.ts";
import {createTestClock} from "./source/packages/nb-harness/src/kernel/testing/clock.ts";
import {createTestModel} from "./source/packages/nb-harness/src/kernel/testing/model.ts";

const instance = createRuntimeInstance({location: "server", instanceId: "review-provider-stop"});
instance.root.open();
const plugins = createPluginHost(instance, createServiceAssembly(instance), {});
const scope = instance.root.createChild("test provider");
scope.open();
const lifecycle: string[] = [];
const profile = defineProfile({id: "review.profile", version: "1", name: "Review", description: "Review", system: "Review"});
const agent = createAgentHost({
    store: createMemoryStore(),
    profiles: {resolve: (key) => key === profile.id ? profile : undefined},
    models: createTestModel().port,
    tools: {declarations: () => [], create: () => { throw Error("unexpected tool"); }},
    resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
    sessions: {get: async () => { throw Error("unexpected session"); }},
    clock: createTestClock(),
    approve: async () => ({verdict: "allow", by: "test"}),
});
const capability = "agent.extensions";
const owner: PluginDefinition = {
    id: "test.agent",
    contributionPoints: [{id: capability, implementation: "required", idPrefix: "plugin"}],
    entries: [{id: "server", location: "server", receives: [capability], activate: () => ({
        receivers: {[capability]: extensionReceiver(agent, (message, cause) => { throw Error(message, {cause}); })},
    })}],
};
const ids = ["test.provider.a", "test.provider.b"];
const provider: PluginDefinition = {
    id: "test.provider",
    entries: [{id: "server", location: "server", contributions: ids.map((id) => ({capability, id, declaration: {}})), activate: () => ({
        contributions: {[capability]: Object.fromEntries(ids.map((id) => [id, defineExtension({id, version: "1", mount: () => {
            lifecycle.push(`mount:${id}`);
            return () => { lifecycle.push(`cleanup:${id}`); };
        }})]))},
    })}],
};
const ownerEntry = {plugin: owner.id, entry: "server"};
const providerEntry = {plugin: provider.id, entry: "server"};
try {
    assert.equal(plugins.register(owner, {scope: instance.root}).status, "accepted");
    assert.equal((await plugins.activate(ownerEntry)).status, "activated");
    assert.equal(plugins.register(provider, {scope}).status, "accepted");
    assert.equal((await plugins.activate(providerEntry)).status, "activated");
    const created = await agent.create({profile: profile.id});
    assert.equal(created.ok, true);
    const session = created.value;
    try {
        assert.deepEqual((await session.snapshot()).extensions.map((item) => item.id), ids);
        const stopped = await scope.close();
        const after = await session.snapshot();
        const failure = (await session.diagnostics()).find((item) => item.code === "reassembly-failed");
        console.log(JSON.stringify({scenario: "one-plugin-entry-with-two-extensions-stops", stopped: stopped.status, readOnly: after.readOnly, extensions: after.extensions.map((item) => item.id), lifecycle, failure}));
        assert.deepEqual(after.readOnly, {code: "reassembly-failed"});
        assert.equal(failure?.code, "reassembly-failed");
    } finally {
        await agent.close(session.id);
    }
} finally {
    await instance.root.close();
}
