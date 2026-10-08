/**
 * 场景 1：共享服务与依赖（`clock`、`greeter`）。读法：先读 `plugins/clock/`、`plugins/greeter/`，再读这里。
 * 行为合同：docs/specs/runtime/services.md、plugins.md、application.md。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";

import {clockKey} from "../plugins/clock/shared/contracts";
import {createClockServerPlugin} from "../plugins/clock/server/plugin";
import {greeterKey} from "../plugins/greeter/shared/contracts";
import {createGreeterServerPlugin} from "../plugins/greeter/server/plugin";
import {Stage} from "./hosts";
import {serviceProbe} from "./probes";

const HOUR = 60 * 60 * 1000;
const stage = new Stage();

afterEach(async () => {
    for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
});

/** 装配：宿主把 clock 的服务键交给 greeter 的工厂（键按对象身份比较）。 */
function plugins(clock: ManualClock) {
    return [createClockServerPlugin({clock}), createGreeterServerPlugin({clock: clockKey})];
}

describe("场景 1：共享服务与依赖", () => {
    it("没有入口依赖时，两个插件都只登记、不激活", async () => {
        const app = await stage.local({plugins: plugins(new ManualClock()), keys: [clockKey, greeterKey]});

        expect(app.plugins.entryState({plugin: "example.clock", entry: "server"})?.status).toBe("registered");
        expect(app.plugins.entryState({plugin: "example.greeter", entry: "server"})?.status).toBe("registered");
    });

    it("有插件依赖问候服务时：内核按依赖先激活 clock、再激活 greeter；问候用宿主注入的时钟", async () => {
        const clock = new ManualClock();
        const user = serviceProbe("example.user", "server", [greeterKey]);
        const app = await stage.local({plugins: [...plugins(clock), user.definition], keys: [clockKey, greeterKey]});
        const greeter = user.get(greeterKey);

        expect(app.plugins.entryState({plugin: "example.clock", entry: "server"})?.status).toBe("available");
        expect(greeter.greet("Ada")).toBe("上午好，Ada");
        clock.advance(13 * HOUR);
        expect(greeter.greet("Ada")).toBe("下午好，Ada");
    });
});
