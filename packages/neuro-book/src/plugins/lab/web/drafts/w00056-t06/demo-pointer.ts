/**
 * 第一幕的演示指针（w00056 t06 第 6 轮）：往工作台上发合成的指针事件，走产品真的拖动手势与窗角缩放，
 * 所以分栏、浮窗、视图搬家都是实时布局一路排过去的，和访客自己拖一模一样。
 *
 * 合成事件拿不到浏览器的指针捕获：产品的拖动会话与浮窗手柄在按下后会 `setPointerCapture`，没有这支真指针时浏览器抛
 * `NotFoundError`，会话据此当成失去捕获、取消。所以按下时在被按的元素到根这一串元素上，把三个捕获方法换成只记账的版本
 * （只认演示的这一个指针编号，访客的真指针照常走浏览器），松开或撤下时换回去。捕获着时，移动与松开发给捕获它的元素，
 * 和浏览器的重定向一样；没捕获时发给指针下面的元素。
 *
 * 合成事件的 `isTrusted` 是 false：工作台据此分得清访客与演示（访客一按，演示让开）。
 */
import type {Point} from "./desk";

/** 和真实指针的编号错开（Chrome 的鼠标是 1，触屏从 2 起递增）。 */
const DEMO_POINTER_ID = 7077;

export interface DemoPointer {
    /** 在这一点按下，返回被按的元素；指针下面不是工作台里的元素时不按，返回 null。 */
    down(at: Point): Element | null;
    move(at: Point): void;
    up(at: Point): void;
    /** 中途撤下：发 `pointercancel`，拖动会话按取消收场，布局回到按下前；没按着时什么都不做。 */
    cancel(): void;
    /** 双击：两下按下松开，再补一个 `dblclick`（产品的双击最大化听的是它）。 */
    doubleClick(at: Point): void;
    /**
     * 点一下：按下、松开，再补一个 `click`（按钮的处理挂在 click 上）。可以点在工作台外的浮层里。`ctrl`：按住 Ctrl 点，另外补发
     * `mousedown` 与 `mouseup`（编辑器认点击是按这两个，Ctrl 点链接才打开它）；不按 Ctrl 时不发，免得编辑器把一次点按当成放光标。
     */
    click(at: Point, options?: {readonly ctrl?: boolean}): void;
    readonly pressed: boolean;
}

interface CaptureMethods {
    readonly set: Element["setPointerCapture"];
    readonly has: Element["hasPointerCapture"];
    readonly release: Element["releasePointerCapture"];
}

export function createDemoPointer(root: HTMLElement): DemoPointer {
    let pressed = false;
    /** 此刻捕获着演示指针的元素。 */
    let captor: Element | null = null;
    /** 换过捕获方法的元素，松开时逐个换回。 */
    const patched = new Map<Element, CaptureMethods>();

    function patch(element: Element): void {
        if (patched.has(element)) return;
        // 先记下原型上的方法；装上的是实例自己的属性，删掉就露出原型的。
        const own: CaptureMethods = {set: element.setPointerCapture, has: element.hasPointerCapture, release: element.releasePointerCapture};
        patched.set(element, own);
        element.setPointerCapture = function setPointerCapture(this: Element, pointerId: number): void {
            if (pointerId !== DEMO_POINTER_ID) return own.set.call(this, pointerId);
            captor = this;
        };
        element.hasPointerCapture = function hasPointerCapture(this: Element, pointerId: number): boolean {
            return pointerId === DEMO_POINTER_ID ? captor === this : own.has.call(this, pointerId);
        };
        element.releasePointerCapture = function releasePointerCapture(this: Element, pointerId: number): void {
            if (pointerId !== DEMO_POINTER_ID) return own.release.call(this, pointerId);
            if (captor === this) captor = null;
        };
    }

    function unpatch(): void {
        for (const element of patched.keys()) {
            Reflect.deleteProperty(element, "setPointerCapture");
            Reflect.deleteProperty(element, "hasPointerCapture");
            Reflect.deleteProperty(element, "releasePointerCapture");
        }
        patched.clear();
        captor = null;
    }

    /** 指针下面的元素。拖动只认工作台里的；点按钮可以在外面（选区菜单、批注卡片这些浮层传送到 body 下）。 */
    const hit = (at: Point, anywhere = false): Element | null => {
        const element = document.elementFromPoint(at.x, at.y);
        return element !== null && (anywhere || root.contains(element)) ? element : null;
    };

    function fire(target: EventTarget, type: string, at: Point, button: number, buttons: number, ctrlKey = false): void {
        target.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, composed: true, view: window, pointerId: DEMO_POINTER_ID, pointerType: "mouse", isPrimary: true, button, buttons, ctrlKey, clientX: at.x, clientY: at.y}));
    }

    function down(at: Point, anywhere = false): Element | null {
        if (pressed) cancel();
        const target = hit(at, anywhere);
        if (target === null) return null;
        // 工作台外的浮层里只是点按钮，不会有人要捕获。
        if (root.contains(target)) for (let node: Element | null = target; node !== null; node = node === root ? null : node.parentElement) patch(node);
        pressed = true;
        fire(target, "pointerdown", at, 0, 1);
        return target;
    }

    function move(at: Point): void {
        if (!pressed) return;
        fire(captor ?? hit(at) ?? root, "pointermove", at, -1, 1);
    }

    function up(at: Point): void {
        if (!pressed) return;
        const target = captor ?? hit(at, true) ?? root;
        pressed = false;
        fire(target, "pointerup", at, 0, 0);
        unpatch();
    }

    function cancel(): void {
        if (!pressed) return;
        const target = captor ?? root;
        pressed = false;
        fire(target, "pointercancel", {x: 0, y: 0}, -1, 0);
        unpatch();
    }

    function mouse(type: "click" | "dblclick" | "mousedown" | "mouseup", target: Element, at: Point, detail: number, ctrlKey = false): void {
        target.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: type === "mousedown" ? 1 : 0, detail, ctrlKey, clientX: at.x, clientY: at.y}));
    }

    function click(at: Point, options: {readonly ctrl?: boolean} = {}): void {
        if (options.ctrl !== true) {
            const target = down(at, true);
            if (target === null) return;
            up(at);
            mouse("click", target, at, 1);
            return;
        }
        // Ctrl 点：不经 `down`、`up`（它们不带修饰键，也不发鼠标事件），整套事件都带上 Ctrl。
        if (pressed) cancel();
        const target = hit(at, true);
        if (target === null) return;
        fire(target, "pointerdown", at, 0, 1, true);
        mouse("mousedown", target, at, 1, true);
        fire(target, "pointerup", at, 0, 0, true);
        mouse("mouseup", target, at, 1, true);
        mouse("click", target, at, 1, true);
    }

    function doubleClick(at: Point): void {
        const target = hit(at, true);
        if (target === null) return;
        click(at);
        click(at);
        mouse("dblclick", target, at, 2);
    }

    return {
        down,
        move,
        up,
        cancel,
        click,
        doubleClick,
        get pressed() {
            return pressed;
        },
    };
}
