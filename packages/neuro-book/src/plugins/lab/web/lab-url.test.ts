import {describe, expect, it} from "bun:test";
import {parseLabUrl, parseLabViewport, queryFromSession, sessionFromQuery} from "./lab-url";

const colorways = {"nbook-light": {appearance: "light" as const}, "nbook-dark": {appearance: "dark" as const}};

describe("lab-url", () => {
    it("尺寸接受预设名与 宽x高，越界或写错时忽略", () => {
        expect(parseLabViewport("phone")).toEqual({width: 390, height: 844});
        expect(parseLabViewport("free")).toEqual({width: 0, height: 0});
        expect(parseLabViewport("1400x900")).toEqual({width: 1400, height: 900});
        expect(parseLabViewport("99999x1")).toBeUndefined();
        expect(parseLabViewport("wide")).toBeUndefined();
        expect(parseLabViewport(null)).toBeUndefined();
    });

    it("配色可写 light / dark，也可写配色 id", () => {
        expect(parseLabUrl("?cw=light", colorways).colorwayId).toBe("nbook-light");
        expect(parseLabUrl("?cw=nbook-dark", colorways).colorwayId).toBe("nbook-dark");
    });

    it("主题与尺寸", () => {
        expect(parseLabUrl("?theme=macos&vp=tablet", colorways)).toEqual({themeId: "macos", colorwayId: undefined, canvasSize: {width: 768, height: 1024}});
    });
});

const catalog = {componentNames: ["Button", "AgentCard"], zooms: [0.5, 1, 2], defaults: {component: "Button", zoom: 1, tab: "doc"}};

describe("会话与地址栏", () => {
    it("读：旧参数名照认，不认识或越界的参数回到缺省，其余照常生效", () => {
        expect(sessionFromQuery({component: "AgentCard", scene: "error", vp: "tablet", zoom: "2", tab: "data"}, catalog))
            .toEqual({component: "AgentCard", scene: "error", canvas: {width: 768, height: 1024}, zoom: 2, tab: "data"});
        expect(sessionFromQuery({c: "Gone", s: "坏 场景", vp: "wide", zoom: "3", tab: "commands"}, catalog))
            .toEqual({component: "Button", scene: "", canvas: {width: 0, height: 0}, zoom: 1, tab: "doc"});
        expect(sessionFromQuery({c: ["AgentCard", "Button"], s: null}, catalog).component).toBe("AgentCard");
    });

    it("写：保留不认识的参数与地址里的主题配色，旧参数名换掉，缺省值不写，画布写预设名或宽x高；look 为 null 时去掉主题配色", () => {
        const session = {component: "AgentCard", scene: "error", canvas: {width: 390, height: 844}, zoom: 1, tab: "doc"};
        expect(queryFromSession(session, {component: "Button", scene: "x", cw: "light", theme: "macos", debug: "1"}, catalog))
            .toEqual({cw: "light", theme: "macos", debug: "1", c: "AgentCard", s: "error", vp: "phone"});
        expect(queryFromSession(session, {cw: "light", theme: "macos", debug: "1"}, catalog, null))
            .toEqual({debug: "1", c: "AgentCard", s: "error", vp: "phone"});
        expect(queryFromSession({...session, canvas: {width: 1400, height: 900}, zoom: 2, tab: "data"}, {}, catalog))
            .toEqual({c: "AgentCard", s: "error", vp: "1400x900", zoom: "2", tab: "data"});
        expect(queryFromSession({...session, canvas: {width: 0, height: 0}}, {}, catalog)).toEqual({c: "AgentCard", s: "error"});
    });

    it("复制链接带上主题与配色", () => {
        const session = {component: "Button", scene: "default", canvas: {width: 0, height: 0}, zoom: 1, tab: "doc"};
        expect(queryFromSession(session, {}, catalog, {themeId: "macos", colorwayId: "nbook-light"}))
            .toEqual({c: "Button", s: "default", theme: "macos", cw: "nbook-light"});
    });

    it("写出的地址读回来是同一个会话", () => {
        const session = {component: "AgentCard", scene: "error", canvas: {width: 768, height: 1024}, zoom: 0.5, tab: "element"};
        const query = queryFromSession(session, {}, catalog);
        expect(sessionFromQuery(query, catalog)).toEqual(session);
    });
});
