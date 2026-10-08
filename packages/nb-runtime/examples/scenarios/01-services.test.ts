/**
 * 场景 1：共享服务与依赖（`clock`、`greeter`）。读法：先读 `plugins/clock/`、`plugins/greeter/`，再读这里。
 * 行为合同：docs/specs/runtime/services.md、plugins.md、application.md。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";

import {clockBackendPlugin} from "../plugins/clock/backend/plugin";
import {greeterKey} from "../plugins/greeter/shared/contracts";
import {greeterBackendPlugin} from "../plugins/greeter/backend/plugin";
import {hostClockKey} from "../shared/host";
import {Stage} from "./hosts";
import {serviceProbe} from "./probes";

const HOUR = 60 * 60 * 1000;
const stage = new Stage();

afterEach(async () => {
    for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
});

const plugins = [clockBackendPlugin, greeterBackendPlugin];

/** 宿主把时钟作为本地能力给出（这里是手动时钟）；clock 依赖它，greeter 依赖 clock，依赖都写在各自的入口里。 */
function capabilities(clock: ManualClock) {
    return [{id: "host.clock", key: hostClockKey, create: () => clock}];
}

describe("场景 1：共享服务与依赖", () => {
    it("没有入口依赖时，两个插件都只登记、不激活", async () => {
        const app = await stage.local({capabilities: capabilities(new ManualClock()), plugins});

        expect(app.plugins.entryState({plugin: "example.clock", entry: "server"})?.status).toBe("registered");
        expect(app.plugins.entryState({plugin: "example.greeter", entry: "server"})?.status).toBe("registered");
    });

    it("有插件依赖问候服务时：内核按依赖先激活 clock、再激活 greeter；问候用宿主能力里的时钟", async () => {
        const clock = new ManualClock();
        const user = serviceProbe("example.user", "server", [greeterKey]);
        const app = await stage.local({capabilities: capabilities(clock), plugins: [...plugins, user.definition]});
        const greeter = user.get(greeterKey);

        expect(app.plugins.entryState({plugin: "example.clock", entry: "server"})?.status).toBe("available");
        expect(greeter.greet("Ada")).toBe("上午好，Ada");
        clock.advance(13 * HOUR);
        expect(greeter.greet("Ada")).toBe("下午好，Ada");
    });

    it("宿主没有给时钟：clock 按 missing-service 受阻，依赖它的 greeter 随之受阻，原因可查", async () => {
        const app = await stage.local({plugins});

        expect(app.plugins.entryState({plugin: "example.clock", entry: "server"})).toMatchObject({status: "blocked", blocked: {reason: "missing-service", key: "example/clock"}});
        expect(app.plugins.entryState({plugin: "example.greeter", entry: "server"})).toMatchObject({status: "blocked", blocked: {reason: "provider-blocked", key: "example.clock/clock"}});
    });
});
