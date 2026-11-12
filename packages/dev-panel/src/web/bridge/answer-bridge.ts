import type {BridgeQuestion, PageMessage, ShellMessage} from "./protocol.js";

/**
 * 评审板页面里的答题控件（t23）：产物来源给每个 HTML 回应注入这段脚本（`src/server/artifact-bridge.ts`），
 * 面板的产物页经 `postMessage` 告诉它有哪些题、草稿里填了什么，它在每道题的元素末尾放一块控件。
 * 页面里填的只发给外壳当草稿，提交仍在外壳的侧栏里按（页面脚本能伪造消息，最多改动草稿）。合同见 docs/panel.md 的“页面里作答”。
 *
 * 不在面板的 iframe 里（单独打开、直接访问）时什么也不做，页面照旧是只读的稿。
 * 控件放在 Shadow DOM 里：页面是会话写的任意 HTML，它的样式影响不到控件，控件的样式也不漏到页面上。
 * 由服务端用 Bun.Transpiler 单独转译、不打包：这里不能从别的文件导入运行时的值（只能 `import type`），也不进 Vite 构建。
 */
(() => {
    const MARKER = "__nbdevAnswerBridge";
    const pageGlobal = window as unknown as Record<string, unknown>;
    // 页面自己也写了这个脚本标签，或者注入了两次：只跑一份，否则每道题下面两块控件。
    if (window.parent === window || pageGlobal[MARKER]) return;
    pageGlobal[MARKER] = true;

    /** 文字题打字时攒一会儿再发：每个键都发会让外壳每个键都写一次本机存储。离开文字框时立刻发。 */
    const TEXT_DEBOUNCE_MS = 300;
    const CONFIRM_OPTIONS = [{value: "true", label: "同意"}, {value: "false", label: "不同意"}];

    type Block = {
        host: HTMLElement;
        root: ShadowRoot;
        /** 题型、选项、状态与只读原因：这几样变了才重建控件，否则就地更新（不打断正在输入的文字框）。 */
        shape: string;
        /** 文字题还没发出去的改动。 */
        pendingText: {timer: ReturnType<typeof setTimeout>; value: string} | null;
    };
    const blocks = new Map<string, Block>();

    function post(message: PageMessage): void {
        // 父窗口是面板（另一个来源）；沙箱 iframe 自己是不透明来源，拿不到父窗口的来源，只能写 "*"。发出去的只有开发者在这里填的取值。
        window.parent.postMessage(message, "*");
    }

    /** 逐个比属性值，不拼选择器：题号来自消息，不用操心转义。 */
    function questionElement(id: string): HTMLElement | null {
        return [...document.querySelectorAll<HTMLElement>("[data-nbdev-question]")].find((node) => node.getAttribute("data-nbdev-question") === id) ?? null;
    }

    const STYLE = `
:host { all: initial; display: block; margin: 12px 0 4px; }
* { box-sizing: border-box; }
.box { margin: 0; padding: 10px 12px 12px; border: 1px solid #cfc9bd; border-left: 3px solid #0b63c5; border-radius: 8px; background: #fbfaf6; color: #1d1b17; font: 14px/1.55 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif; }
.box[disabled] { border-left-color: #8a857c; }
legend { padding: 0 4px; font-weight: 600; font-size: 13px; color: #3b3832; }
.tag { margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 12px; font-weight: 500; background: #fbe7c6; color: #6d4300; }
.opts { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.opts.row { flex-direction: row; flex-wrap: wrap; gap: 4px 16px; }
label.opt { display: flex; align-items: flex-start; gap: 8px; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
label.opt:hover { background: #f0ece3; }
label.opt input { margin: 4px 0 0; accent-color: #0b63c5; width: 16px; height: 16px; flex: none; }
.rec { margin-left: 4px; font-size: 12px; color: #0a5aa8; }
textarea { width: 100%; min-height: 4.5em; margin-top: 4px; padding: 6px 8px; border: 1px solid #b9b2a5; border-radius: 6px; background: #fff; color: inherit; font: inherit; resize: vertical; }
textarea:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid #0b63c5; outline-offset: 2px; }
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; font-size: 13px; color: #5c574e; }
.changed { color: #0a5aa8; font-weight: 500; }
button { padding: 2px 10px; border: 1px solid #b9b2a5; border-radius: 6px; background: #fff; color: #1d1b17; font: inherit; font-size: 13px; cursor: pointer; }
button:hover { background: #f0ece3; }
.answer { font-weight: 500; overflow-wrap: anywhere; }
.reason { margin: 4px 0 0; font-size: 13px; color: #5c574e; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@keyframes nbdev-flash { from { box-shadow: 0 0 0 4px rgba(11, 99, 197, 0.45); } to { box-shadow: 0 0 0 4px rgba(11, 99, 197, 0); } }
.flash { animation: nbdev-flash 1.6s ease-out; }
`;

    function element<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, text?: string): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag);
        for (const [name, value] of Object.entries(props)) if (value !== undefined) node.setAttribute(name, value);
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function blockFor(id: string, target: HTMLElement): Block {
        const existing = blocks.get(id);
        if (existing && existing.host.isConnected && existing.host.parentElement === target) return existing;
        existing?.host.remove();
        const host = element("div", {"data-nbdev-answer": id});
        const root = host.attachShadow({mode: "open"});
        target.append(host);
        const block: Block = {host, root, shape: "", pendingText: null};
        blocks.set(id, block);
        return block;
    }

    function flushText(id: string, block: Block): void {
        if (!block.pendingText) return;
        clearTimeout(block.pendingText.timer);
        const {value} = block.pendingText;
        block.pendingText = null;
        post({type: "nbdev:draft", id, value: value.trim() === "" ? null : value});
    }

    /** 重建一道题的控件。只在题型、选项、状态或只读原因变了时调用。 */
    function build(block: Block, question: BridgeQuestion, disabledReason: string | null): void {
        const {root} = block;
        root.replaceChildren(element("style", {}, STYLE));
        if (question.state === "answered") {
            const box = element("div", {class: "box", role: "group", "aria-label": `答题：${question.label}`});
            const line = element("div", {class: "foot"});
            line.append(element("span", {}, "已答："), element("span", {class: "answer"}, question.answerText ?? ""));
            box.append(line, element("p", {class: "reason"}, "要改答，在右边侧栏点“改答”。"));
            root.append(box);
            return;
        }
        const box = element("fieldset", {class: "box"});
        if (disabledReason !== null) box.disabled = true;
        const legend = element("legend", {}, "在这里答");
        legend.append(element("span", {class: "sr"}, `：${question.label}`));
        if (question.required) legend.append(element("span", {class: "tag"}, "必答"));
        box.append(legend);
        if (question.type === "text") {
            const textarea = element("textarea", {"aria-label": question.label, rows: "3"});
            textarea.addEventListener("input", () => {
                if (block.pendingText) clearTimeout(block.pendingText.timer);
                block.pendingText = {value: textarea.value, timer: setTimeout(() => flushText(question.id, block), TEXT_DEBOUNCE_MS)};
            });
            textarea.addEventListener("blur", () => flushText(question.id, block));
            box.append(textarea);
        } else {
            const multi = question.type === "multi";
            const options = question.type === "confirm" ? CONFIRM_OPTIONS : question.options;
            const list = element("div", {class: question.type === "confirm" ? "opts row" : "opts"});
            for (const option of options) {
                const label = element("label", {class: "opt"});
                const input = element("input", {type: multi ? "checkbox" : "radio", name: `nbdev-${question.id}`, value: option.value});
                input.addEventListener("change", () => post({type: "nbdev:draft", id: question.id, value: readChoice(block, question)}));
                const text = element("span", {}, option.label);
                if (question.recommend.includes(option.value)) text.append(element("span", {class: "rec"}, "推荐"));
                label.append(input, text);
                list.append(label);
            }
            box.append(list);
        }
        const foot = element("div", {class: "foot"});
        foot.append(element("span", {class: "status", role: "status"}));
        if (question.type !== "text") {
            const clear = element("button", {type: "button", class: "clear"}, "清除选择");
            clear.addEventListener("click", () => post({type: "nbdev:draft", id: question.id, value: null}));
            foot.append(clear);
        }
        box.append(foot);
        if (disabledReason !== null) box.append(element("p", {class: "reason"}, disabledReason));
        root.append(box);
    }

    /** 选择题当前选中的取值：单选、确认没选是 `null`，多选全取消也是 `null`（外壳当作清空）。 */
    function readChoice(block: Block, question: BridgeQuestion): unknown {
        const checked = [...block.root.querySelectorAll<HTMLInputElement>("input:checked")].map((input) => input.value);
        if (question.type === "multi") return checked.length === 0 ? null : checked;
        if (checked.length === 0) return null;
        return question.type === "confirm" ? checked[0] === "true" : checked[0];
    }

    /** 把草稿里的取值写回控件，不重建：文字框正在输入（有焦点或有没发出去的改动）时不动它。 */
    function sync(block: Block, question: BridgeQuestion): void {
        if (question.state === "answered") return;
        const {root} = block;
        if (question.type === "text") {
            const textarea = root.querySelector("textarea");
            const value = typeof question.value === "string" ? question.value : "";
            if (textarea && root.activeElement !== textarea && block.pendingText === null && textarea.value !== value) textarea.value = value;
        } else {
            const selected = new Set(Array.isArray(question.value) ? question.value.map(String) : question.value === null || question.value === undefined ? [] : [String(question.value)]);
            for (const input of root.querySelectorAll<HTMLInputElement>("input")) input.checked = selected.has(input.value);
            const clear = root.querySelector<HTMLButtonElement>("button.clear");
            if (clear) clear.hidden = selected.size === 0;
        }
        const status = root.querySelector(".status");
        if (status) {
            status.className = question.changed ? "status changed" : "status";
            status.textContent = question.changed ? "已填，还没提交：在右边侧栏提交" : "";
        }
    }

    function applyState(message: Extract<ShellMessage, {type: "nbdev:state"}>): void {
        const seen = new Set<string>();
        for (const question of message.questions) {
            const target = questionElement(question.id);
            if (!target) continue;
            seen.add(question.id);
            const block = blockFor(question.id, target);
            const shape = JSON.stringify([question.type, question.options, question.recommend, question.required, question.state, question.answerText, message.disabledReason]);
            if (block.shape !== shape) {
                if (block.pendingText) clearTimeout(block.pendingText.timer);
                block.pendingText = null;
                build(block, question, message.disabledReason);
                block.shape = shape;
            }
            sync(block, question);
        }
        // 不再发来的题（撤回、取代、换了版本）：控件拿掉。
        for (const [id, block] of blocks) {
            if (seen.has(id)) continue;
            if (block.pendingText) clearTimeout(block.pendingText.timer);
            block.host.remove();
            blocks.delete(id);
        }
    }

    function reveal(id: string): void {
        const target = questionElement(id);
        if (!target) return;
        target.scrollIntoView({block: "start", behavior: "smooth"});
        const box = blocks.get(id)?.root.querySelector(".box");
        if (box) {
            box.classList.remove("flash");
            // 强制一次布局，同一道题连点两次也能重新闪。
            void (box as HTMLElement).offsetWidth;
            box.classList.add("flash");
        }
    }

    window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const data = event.data as ShellMessage | null;
        if (typeof data !== "object" || data === null) return;
        if (data.type === "nbdev:state" && Array.isArray(data.questions)) applyState(data);
        else if (data.type === "nbdev:reveal" && typeof data.id === "string") reveal(data.id);
    });
    // 离开页面前把文字框里没发出去的改动发掉。
    window.addEventListener("pagehide", () => {
        for (const [id, block] of blocks) flushText(id, block);
    });
    post({type: "nbdev:ready"});
})();
