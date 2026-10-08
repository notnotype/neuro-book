/**
 * 场景 1：共享服务与依赖（`clock`、`greeter`）。读法：先读 `plugins/clock/`、`plugins/greeter/`，再读这里。
 * 行为合同：docs/specs/runtime/services.md、plugins.md、application.md。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";

import {createClockServerPlugin} from "../plugins/clock/backend/plugin";
import {greeterKey} from "../plugins/greeter/shared/contracts";
import {createGreeterServerPlugin} from "../plugins/greeter/backend/plugin";
import {Stage} from "./hosts";
import {serviceProbe} from "./probes";

const HOUR = 60 * 60 * 1000;
const stage = new Stage();

afterEach(async () => {
    for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
});

/** 装配：宿主只给 clock 它需要的配置（时钟）；greeter 对 clock 的依赖写在它自己的入口里。 */
function plugins(clock: ManualClock) {
    return [createClockServerPlugin({clock}), createGreeterServerPlugin()];
}

describe("场景 1：共享服务与依赖", () => {
    it("没有入口依赖时，两个插件都只登记、不激活", async () => {
        const app = await stage.local({plugins: plugins(new ManualClock())});

        expect(app.plugins.entryState({plugin: "example.clock", entry: "server"})?.status).toBe("registered");
        expect(app.plugins.entryState({plugin: "example.greeter", entry: "server"})?.status).toBe("registered");
    });

    it("有插件依赖问候服务时：内核按依赖先激活 clock、再激活 greeter；问候用宿主注入的时钟", async () => {
        const clock = new ManualClock();
        const user = serviceProbe("example.user", "server", [greeterKey]);
        const app = await stage.local({plugins: [...plugins(clock), user.definition]});
        const greeter = user.get(greeterKey);

        expect(app.plugins.entryState({plugin: "example.clock", entry: "server"})?.status).toBe("available");
        expect(greeter.greet("Ada")).toBe("上午好，Ada");
        clock.advance(13 * HOUR);
        expect(greeter.greet("Ada")).toBe("下午好，Ada");
    });
});
