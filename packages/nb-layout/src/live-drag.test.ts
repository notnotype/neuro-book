/** 实时布局的编排（Spec `ui/layout-drag` 的“实时布局的编排”）：什么时候换预览、收起展开来源、换几何、要卡片。帧由测试推进。 */

import {describe, expect, it} from "bun:test";

import type {GridDropPoint, GridDropRect} from "./grid-drop";
import type {GridRect} from "./grid-rects";
import {createLiveDrag} from "./live-drag";
import type {LiveDragHost, LiveDragState, LiveDragWiring, LiveDropFacts, LiveShowTarget} from "./live-drag";

/** 测试里的落点：描述直接写在落点上。 */
interface Drop {
    readonly key: string;
    readonly inPlace?: boolean;
    readonly home?: boolean;
    readonly container?: string | null;
    readonly slot?: GridDropRect | null;
}
/** 几何：拿起时量的那份，或收起之后的。 */
interface Geometry {
    readonly name: string;
}

const SOURCE = "view:a";
const strip = (container: string, index = 0, inPlace = false): Drop => ({key: `strip:${container}:${String(index)}`, container, home: container === "home", inPlace});
const CENTER: Drop = {key: "center:other"};
/** 来源那块里不是原位的落点：拆开它自己那块。 */
const HOME_SPLIT: Drop = {key: "split:home:left"};
const IN_PLACE: Drop = {key: "in-place", inPlace: true};
const RECTS: Readonly<Record<string, GridDropRect>> = {home: {left: 0, top: 0, right: 600, bottom: 800}, other: {left: 600, top: 0, right: 1400, bottom: 800}};

type Host = LiveDragHost<string, Drop, Geometry>;

interface Options {
    readonly laid?: (drop: Drop) => boolean;
    readonly stays?: () => boolean;
    readonly collapsed?: Host["collapsed"];
    readonly keepSize?: () => boolean;
    readonly refreshMs?: () => number;
    readonly pointer?: () => GridDropPoint | null;
    readonly judge?: () => void;
    readonly follow?: boolean;
}

function setup(options: Options = {}) {
    let scheduled: ((now: number) => void) | null = null;
    let now = 1000;
    /** 引擎让宿主摆的：候选的键、来源收起（`removed`）、已提交（null）。 */
    const shown: Array<string | null> = [];
    const placed: GridRect[] = [];
    const collapses: string[] = [];
    const followed: Array<string | null> = [];
    const states: LiveDragState[] = [];
    const calls: string[] = [];
    let measures = 0;
    let staysAsked = 0;
    const record = (target: LiveShowTarget<Drop>, collapsed: boolean): boolean => {
        if (target === null) {
            shown.push(null);
            return false;
        }
        if (target.kind === "source-removed") {
            shown.push("removed");
            return false;
        }
        if (options.laid?.(target.drop) ?? true) {
            shown.push(target.drop.key);
            return true;
        }
        // 摆不出来：宿主自己摆兜底。
        shown.push(collapsed ? "removed" : null);
        return false;
    };
    const host: Host = {
        facts: (_source, drop): LiveDropFacts => ({key: drop.key, inPlace: drop.inPlace ?? false, home: drop.home ?? false, slotOnScreen: drop.slot ?? null, container: drop.container ?? null}),
        show: (target, context) => {
            calls.push("show");
            return record(target, context.collapsed);
        },
        measure: () => {
            measures += 1;
            return {name: "lifted"};
        },
        collapsed: options.collapsed ?? ((source) => {
            calls.push("collapsed");
            collapses.push(source);
            return {name: "collapsed"};
        }),
        ...(options.stays === undefined
            ? {}
            : {
                staysWithoutSource: () => {
                    staysAsked += 1;
                    return options.stays!();
                },
            }),
        card: {
            key: (source) => source,
            rect: (_source, container) => RECTS[container ?? "home"] ?? null,
            ...(options.keepSize === undefined ? {} : {keepSizeInsideHome: options.keepSize}),
            ...(options.refreshMs === undefined ? {} : {refreshMs: options.refreshMs}),
        },
        ...(options.follow === false
            ? {}
            : {
                follow: {
                    read: (at) => () => followed.push(at === null ? null : at.container),
                    afterRender: () => undefined,
                },
            }),
    };
    const wiring: LiveDragWiring = {
        judge: () => options.judge?.(),
        pointer: options.pointer ?? (() => null),
        origin: () => ({x: 0, y: 0}),
        place: (rect) => placed.push(rect),
        changed: (state) => states.push(state),
        requestFrame: (run) => {
            scheduled = run;
            return 1;
        },
        cancelFrame: () => {
            scheduled = null;
        },
    };
    const live = createLiveDrag(host, wiring);
    const frame = (advance = 16): void => {
        now += advance;
        const run = scheduled;
        scheduled = null;
        run?.(now);
    };
    /** 帧循环停着：没有排着的帧。 */
    const idle = (): boolean => scheduled === null;
    /** 几何此刻是哪份。 */
    const geometry = (): string | null => live.geometry()?.name ?? null;
    return {live, frame, idle, shown, placed, collapses, followed, states, calls, geometry, measures: () => measures, staysAsked: () => staysAsked};
}

describe("createLiveDrag", () => {
    it("来源落到别处时收起：自己的容器、放回原处不收；收起着时没有落点再回来，不重复收起", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(strip("home", 1));
        t.frame();
        t.live.offer(IN_PLACE);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([]);
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE]);
        t.live.offer(null);
        t.frame();
        t.frame(200);
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE]);
        t.live.end();
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE, SOURCE]);
    });

    it("自己的容器马上换预览，不要卡片", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(strip("home", 1));
        t.frame();
        expect(t.shown).toEqual(["strip:home:1"]);
        expect(t.live.state().lifted).toBeNull();
    });

    it("来源收起之后回到原处：展开、判定的几何换回拿起时的那份，预览是已提交的样子；再落到别处又收起", () => {
        const t = setup({laid: (drop) => !(drop.inPlace ?? false)});
        t.live.begin(SOURCE, {x: 700, y: 400});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE]);
        expect(t.geometry()).toBe("collapsed");
        t.live.offer(IN_PLACE);
        t.frame();
        t.frame(200);
        expect(t.geometry()).toBe("lifted");
        expect(t.live.state().collapsed).toBe(false);
        expect(t.shown.at(-1)).toBeNull();
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE, SOURCE]);
        // 自己容器里的原位同样是展开。
        t.live.offer(strip("home", 0, true));
        t.frame();
        expect(t.geometry()).toBe("lifted");
        expect(t.shown.at(-1)).toBeNull();
    });

    it("来源收起之后，摆不出来的别处仍是来源收起的样子，不展开", () => {
        const t = setup({laid: (drop) => drop === CENTER});
        t.live.begin(SOURCE, {x: 700, y: 400});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        t.live.offer({key: "split:other:left"});
        t.frame();
        t.frame(200);
        expect(t.geometry()).toBe("collapsed");
        expect(t.shown.at(-1)).toBe("removed");
        expect(t.live.state().previewed).toBe(false);
    });

    it("卡片收回、指针在容器上时，来源在吸收它的那个里跟手；离开要卡片时放回", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(strip("home", 1));
        t.frame();
        t.frame();
        expect(t.followed.at(-1)).toBe("home");
        t.live.offer(CENTER);
        t.frame();
        t.frame();
        expect(t.followed.at(-1)).toBeNull();
        t.live.end();
        expect(t.followed.at(-1)).toBeNull();
    });

    it("在容器里跟手时帧循环不停：每帧都放一次", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(strip("home", 1));
        for (let index = 0; index < 30; index += 1) t.frame();
        expect(t.idle()).toBe(false);
        const placed = t.followed.length;
        t.frame();
        expect(t.followed.length).toBe(placed + 1);
        expect(t.followed.at(-1)).toBe("home");
    });

    it("放回自己容器的原位：没有预览，也不要卡片", () => {
        const t = setup({laid: () => false});
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(strip("home", 0, true));
        t.frame();
        expect(t.live.state().lifted).toBeNull();
    });

    it("放回原处（不在容器里）照样拿着卡片：来源展开回原位，卡片不收回", () => {
        const t = setup({laid: (drop) => !(drop.inPlace ?? false)});
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(HOME_SPLIT);
        t.frame();
        expect(t.live.state().lifted).toEqual({key: SOURCE});
        t.live.offer(IN_PLACE);
        t.frame();
        t.frame(200);
        expect(t.live.state().lifted).toEqual({key: SOURCE});
        expect(t.shown.at(-1)).toBeNull();
    });

    it("撕下：来源那块摘掉它还在时，拿起卡片的那一帧就收起来源，预览是来源收起的样子；回到自己容器里的原位展开、收回卡片；一场只问一次还在不在", () => {
        const t = setup({stays: () => true, laid: (drop) => !(drop.inPlace ?? false)});
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(strip("home", 0, true));
        t.frame();
        expect(t.collapses).toEqual([]);
        expect(t.live.state().lifted).toBeNull();
        // 拖出容器到自己的正文：不等落点稳定。
        const centerHome: Drop = {key: "center:home"};
        t.live.offer(centerHome);
        t.frame();
        expect(t.collapses).toEqual([SOURCE]);
        expect(t.shown.at(-1)).toBe("removed");
        expect(t.live.state().preview).toEqual({kind: "source-removed"});
        expect(t.live.state().lifted).toEqual({key: SOURCE});
        // 稳定之后是并入自己那块。
        t.frame(200);
        expect(t.live.previewedDrop()).toBe(centerHome);
        expect(t.collapses).toEqual([SOURCE]);
        t.live.offer(strip("home", 0, true));
        t.frame();
        expect(t.geometry()).toBe("lifted");
        expect(t.shown.at(-1)).toBeNull();
        expect(t.live.state().lifted).toBeNull();
        // 再拖出去又撕下来。
        t.live.offer(centerHome);
        t.frame();
        expect(t.collapses).toEqual([SOURCE, SOURCE]);
        expect(t.staysAsked()).toBe(1);
    });

    it("摘掉它那块就没了：拿起卡片不收起来源，等第一个落点稳定；没给 staysWithoutSource 也一样", () => {
        for (const stays of [() => false, undefined]) {
            const t = setup(stays === undefined ? {} : {stays});
            t.live.begin(SOURCE, {x: 300, y: 400});
            t.live.offer(HOME_SPLIT);
            t.frame();
            expect(t.live.state().lifted).toEqual({key: SOURCE});
            expect(t.collapses).toEqual([]);
            t.frame(200);
            expect(t.collapses).toEqual([SOURCE]);
        }
    });

    it("离开吸收它的容器时指针已在那块外面：卡片从那块的位置追到指针下，不跳", () => {
        let pointer = {x: 900, y: 10};
        const t = setup({pointer: () => pointer});
        t.live.begin(SOURCE, pointer);
        t.live.offer(strip("other"));
        t.frame();
        t.frame(200);
        expect(t.live.state().lifted).toBeNull();
        // 从容器往上拖出了网格：那块（other，从 y=0 起）在指针下面 40px。
        pointer = {x: 900, y: -40};
        t.live.offer(null);
        t.frame();
        expect(t.placed.at(-1)?.y).toBe(0);
        t.frame();
        expect(t.placed.at(-1)?.y).toBeLessThan(0);
        for (let index = 0; index < 120; index += 1) t.frame();
        expect(t.placed.at(-1)?.y).toBeCloseTo(-40, 5);
    });

    it("第一次进别的容器等够稳定才吸收：这之前卡片留着，路过不换预览", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 700, y: 400});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.shown).toEqual(["center:other"]);
        t.live.offer(strip("other"));
        t.frame();
        expect(t.live.state().lifted).toEqual({key: SOURCE});
        expect(t.shown.length).toBe(1);
        t.frame(200);
        expect(t.shown.length).toBe(2);
        expect(t.live.state().lifted).toBeNull();
    });

    it("吸收之后在这个容器里换位不等；离开就要卡片，不等预览换", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 700, y: 10});
        t.live.offer(strip("other", 0));
        t.frame();
        t.frame(200);
        expect(t.live.state().lifted).toBeNull();
        const shownBefore = t.shown.length;
        t.live.offer(strip("other", 1));
        t.frame();
        expect(t.shown.length).toBe(shownBefore + 1);
        t.live.offer(CENTER);
        t.frame();
        expect(t.live.state().lifted).toEqual({key: SOURCE});
        expect(t.shown.length).toBe(shownBefore + 1);
    });

    it("摆不出来（show 返回假）时不算吸收：卡片留着", () => {
        const t = setup({laid: () => false});
        t.live.begin(SOURCE, {x: 700, y: 10});
        t.live.offer(strip("other"));
        t.frame();
        t.frame(200);
        expect(t.live.state().lifted).toEqual({key: SOURCE});
        expect(t.live.previewedDrop()).toBeNull();
    });

    it("卡片缩小：缺省一拿起就缩到紧凑，从来源那块的大小开始；紧凑的大小可以换", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(HOME_SPLIT);
        t.frame();
        expect(t.placed[0]?.width).toBe(600);
        for (let index = 0; index < 60; index += 1) t.frame();
        expect(t.placed.at(-1)?.width).toBe(380);
        expect(t.placed.at(-1)?.height).toBe(260);
    });

    it("指针在来源那块里保持大小（keepSizeInsideHome）：离开才缩；吸收之后“来源那块”不变", () => {
        let pointer = {x: 300, y: 400};
        const t = setup({keepSize: () => true, pointer: () => pointer});
        t.live.begin(SOURCE, pointer);
        t.live.offer(HOME_SPLIT);
        t.frame();
        for (let index = 0; index < 30; index += 1) t.frame();
        expect(t.placed.at(-1)?.width).toBe(600);
        pointer = {x: 900, y: 400};
        t.live.offer(strip("other"));
        t.frame();
        t.frame(200);
        expect(t.live.state().lifted).toBeNull();
        // 从吸收它的那块拿起（800 宽），指针不在来源那块里：缩。
        t.live.offer(CENTER);
        t.frame();
        expect(t.placed.at(-1)?.width).toBeGreaterThan(700);
        for (let index = 0; index < 60; index += 1) t.frame();
        expect(t.placed.at(-1)?.width).toBe(380);
    });

    it("尺寸至多每 refreshMs 写一次、按整像素写，位置每帧都跟手；每帧写时取整后变了就写", () => {
        const run = (refreshMs: number) => {
            let pointer = {x: 300, y: 400};
            const t = setup({refreshMs: () => refreshMs, pointer: () => pointer});
            t.live.begin(SOURCE, pointer);
            t.live.offer(HOME_SPLIT);
            t.frame();
            for (let index = 0; index < 30; index += 1) {
                pointer = {x: pointer.x + 1, y: 400};
                t.frame();
            }
            const sizes = t.placed.filter((rect, index, all) => index === 0 || rect.width !== all[index - 1]?.width).length;
            return {t, sizes};
        };
        const limited = run(1000 / 30);
        expect(limited.t.placed.length).toBe(31);
        expect(limited.sizes).toBeLessThanOrEqual(16);
        expect(limited.sizes).toBeGreaterThan(8);
        expect(limited.t.placed.every((rect) => Number.isInteger(rect.width) && Number.isInteger(rect.height))).toBe(true);
        limited.t.placed.forEach((rect, index) => expect((300 + index - rect.x) / rect.width).toBeCloseTo(0.5, 5));
        expect(run(0).sizes).toBeGreaterThan(limited.sizes + 8);
    });

    it("指针不动、缩放结束之后不再写", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(HOME_SPLIT);
        for (let index = 0; index < 120; index += 1) t.frame();
        const writes = t.placed.length;
        for (let index = 0; index < 30; index += 1) t.frame();
        expect(t.placed.length).toBe(writes);
    });

    it("按住不动不空转：候选稳定、卡片到位之后不再排帧；来了落点或新的指针样本再排，卡片在那一帧跟上", () => {
        let pointer = {x: 900, y: 400};
        const t = setup({pointer: () => pointer});
        t.live.begin(SOURCE, pointer);
        t.live.offer(CENTER);
        for (let index = 0; index < 90; index += 1) t.frame();
        expect(t.live.state().preview.kind).not.toBe("none");
        expect(t.idle()).toBe(true);
        t.live.offer(CENTER);
        expect(t.idle()).toBe(false);
        t.frame();
        expect(t.idle()).toBe(true);
        const writes = t.placed.length;
        const before = t.placed.at(-1)!;
        pointer = {x: 950, y: 420};
        t.live.wake();
        expect(t.idle()).toBe(false);
        t.frame();
        expect(t.placed.length).toBe(writes + 1);
        expect(t.placed.at(-1)).toMatchObject({x: before.x + 50, y: before.y + 20, width: before.width, height: before.height});
    });

    it("停了两秒再动：第一帧按一帧的时长缓动，卡片的尺寸不一步到终点", () => {
        let pointer = {x: 300, y: 400};
        const t = setup({keepSize: () => true, pointer: () => pointer});
        t.live.begin(SOURCE, pointer);
        t.live.offer(HOME_SPLIT);
        for (let index = 0; index < 60; index += 1) t.frame();
        expect(t.idle()).toBe(true);
        expect(t.placed.at(-1)?.width).toBe(600);
        t.frame(2000);
        pointer = {x: 900, y: 400};
        t.live.wake();
        t.frame();
        expect(t.placed.at(-1)?.width).toBeLessThan(600);
        expect(t.placed.at(-1)?.width).toBeGreaterThan(540);
    });

    it("别的容器第一次进去等稳定，吸收之后卡片收回、来源在里面跟手；容器之外、不是自己的落点照常要卡片", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 20, y: 100});
        t.live.offer(strip("bar"));
        t.frame();
        expect(t.shown.length).toBe(0);
        t.frame(200);
        expect(t.shown).toEqual(["strip:bar:0"]);
        expect(t.live.state().lifted).toBeNull();
        expect(t.collapses).toEqual([SOURCE]);
        t.frame();
        expect(t.followed.at(-1)).toBe("bar");
        const join: Drop = {key: "join:view:b"};
        t.live.offer(join);
        t.frame();
        t.frame(200);
        expect(t.live.state().lifted).toEqual({key: SOURCE});
        expect(t.live.previewedDrop()).toBe(join);
    });

    it("算自己的位置但不在容器里（工作台入口上的并入）：等稳定、不收起来源、要卡片", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 20, y: 100});
        const join: Drop = {key: "join:view:b", home: true, container: null};
        t.live.offer(join);
        t.frame();
        expect(t.shown).toEqual([]);
        t.frame(200);
        expect(t.shown).toEqual(["join:view:b"]);
        expect(t.collapses).toEqual([]);
        expect(t.live.state().lifted).toEqual({key: SOURCE});
    });

    it("自己的容器之外也算自己的（home 为真的容器）：马上跟手，不收起来源", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 20, y: 100});
        t.live.offer({key: "move-entry:b", container: "bar", home: true});
        t.frame();
        expect(t.shown).toEqual(["move-entry:b"]);
        expect(t.live.state().lifted).toBeNull();
        expect(t.collapses).toEqual([]);
    });

    it("判定时结束这一场：这一帧不再往下做", () => {
        const holder: {end?: () => void} = {};
        const t = setup({judge: () => holder.end?.()});
        holder.end = () => t.live.end();
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(strip("home"));
        t.frame();
        expect(t.live.state().active).toBe(false);
        expect(t.shown).toEqual([null]);
    });

    it("判定的几何：拿起后第一帧开头量一次，之前为 null；收起、展开每次换一份", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 300, y: 400});
        expect(t.live.geometry()).toBeNull();
        t.frame();
        const lifted = t.live.geometry();
        expect(lifted?.name).toBe("lifted");
        t.frame();
        expect(t.live.geometry()).toBe(lifted);
        expect(t.measures()).toBe(1);
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        const collapsed = t.live.geometry();
        expect(collapsed).not.toBe(lifted);
        t.live.offer(IN_PLACE);
        t.frame();
        t.frame(200);
        expect(t.live.geometry()).toBe(lifted);
    });

    it("先收起来源、再摆预览：摆的时候宿主读到的已经是收起后的几何", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.calls).toEqual(["collapsed", "show"]);
    });

    it("收起、展开那一刻起指针没动 unmoved 为真；第一次不等就清掉，回到同一像素也不再为真", () => {
        let pointer = {x: 700, y: 400};
        const t = setup({pointer: () => pointer});
        t.live.begin(SOURCE, pointer);
        t.live.offer(CENTER);
        t.frame();
        expect(t.live.unmoved(pointer)).toBe(false);
        t.frame(200);
        expect(t.live.unmoved({x: 700, y: 400})).toBe(true);
        expect(t.live.unmoved({x: 700, y: 400})).toBe(true);
        expect(t.live.unmoved({x: 701, y: 400})).toBe(false);
        expect(t.live.unmoved({x: 700, y: 400})).toBe(false);
        // 展开同样开始一次。
        pointer = {x: 300, y: 400};
        t.live.offer(IN_PLACE);
        t.frame();
        t.frame(200);
        expect(t.live.unmoved({x: 300, y: 400})).toBe(true);
    });

    it("收起不改几何（collapsed 返回 null）：几何照旧，不开始 unmoved，展开也不开始", () => {
        const pointer = {x: 700, y: 400};
        const t = setup({pointer: () => pointer, collapsed: () => null});
        t.live.begin(SOURCE, pointer);
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.live.state().collapsed).toBe(true);
        expect(t.geometry()).toBe("lifted");
        expect(t.live.unmoved(pointer)).toBe(false);
        t.live.offer(IN_PLACE);
        t.frame();
        t.frame(200);
        expect(t.live.state().collapsed).toBe(false);
        expect(t.live.unmoved(pointer)).toBe(false);
    });

    it("空位粘住：指针在已显示的空位里（含 8px 边距）返回那一刻的候选；空位外、原位没有空位时为 null", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 700, y: 400});
        const grow: Drop = {key: "edge:other:right", slot: {left: 1000, top: 0, right: 1400, bottom: 800}};
        t.live.offer(grow);
        t.frame();
        t.frame(200);
        expect(t.live.sticky({x: 995, y: 400})).toBe(grow);
        expect(t.live.sticky({x: 990, y: 400})).toBeNull();
        expect(t.live.state().slotInGrid).toEqual({x: 1000, y: 0, width: 400, height: 800});
        t.live.offer({key: "in-place-slot", inPlace: true, slot: {left: 0, top: 0, right: 600, bottom: 800}});
        t.frame();
        t.frame(200);
        expect(t.live.state().slotInGrid).toBeNull();
    });

    it("begin 之前、end 之后的 offer 与 wake 不排帧；状态的变化经 changed 交出，没变不交", () => {
        const t = setup();
        t.live.offer(CENTER);
        t.live.wake();
        expect(t.idle()).toBe(true);
        expect(t.states).toEqual([]);
        t.live.begin(SOURCE, {x: 300, y: 400});
        expect(t.states.at(-1)?.active).toBe(true);
        t.live.offer(HOME_SPLIT);
        t.frame();
        const count = t.states.length;
        t.frame();
        t.frame();
        expect(t.states.length).toBe(count);
        t.live.end();
        expect(t.states.at(-1)?.active).toBe(false);
        t.live.offer(CENTER);
        t.live.wake();
        expect(t.idle()).toBe(true);
        expect(t.live.sticky({x: 0, y: 0})).toBeNull();
        expect(t.live.unmoved({x: 0, y: 0})).toBe(false);
    });

    it("没有容器的宿主（不给 follow、落点都不带 container）：卡片一直拿着，没有跟手", () => {
        const t = setup({follow: false});
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        t.live.offer(IN_PLACE);
        t.frame();
        t.frame(200);
        expect(t.live.state().lifted).toEqual({key: SOURCE});
        expect(t.followed).toEqual([]);
    });
});
