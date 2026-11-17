class Keyboard {
    constructor(opts) {
        if (!opts.layout || !opts.container) throw "Missing options";

        this.name = (typeof opts.name === "string") ? opts.name : "";
        this.container = document.getElementById(opts.container);
        this.rows = Keyboard.arrange(opts.layout, this.name);
        this.family = Keyboard.family(this.name, this.rows);

        this.linkedToTerm = true;
        this.detach = () => {
            this.linkedToTerm = false;
        };
        this.attach = () => {
            this.linkedToTerm = true;
        };

        this.container.dataset.passwordMode = false;

        let carry = (opts.carry && typeof opts.carry === "object") ? opts.carry : null;
        this.counts = new Map(carry ? carry.counts : []);
        this.maxCount = 0;
        this.counts.forEach(count => {
            if (count > this.maxCount) this.maxCount = count;
        });
        this.lastCode = carry ? carry.lastCode : null;
        this.lastText = carry ? carry.lastText : "—";
        this.echoSamples = carry ? carry.echoSamples.slice() : [];
        this.echoStart = null;
        this.waiting = [];
        this.latched = {ctrl: false, alt: false, shift: false, caps: false};
        this.held = {ctrl: false, alt: false, shift: false, caps: false};
        this.dead = null;
        this.pointers = new Map();
        this.elements = new Map();
        this.specs = new Map();
        this._shortcuts = Keyboard.shortcutTable();

        this.build();
        this.renderHeat();
        this.renderHead();
        Keyboard.listen();
    }

    static listen() {
        if (Keyboard.listening === true) return;
        Keyboard.listening = true;
        document.addEventListener("keydown", e => {
            if (window.keyboard instanceof Keyboard) window.keyboard.keyDown(e);
        }, true);
        document.addEventListener("keyup", e => {
            if (window.keyboard instanceof Keyboard) window.keyboard.keyUp(e);
        }, true);
        window.addEventListener("blur", () => {
            if (window.keyboard instanceof Keyboard) window.keyboard.release();
        });
    }

    static codes() {
        let letters = text => text.split("").map(letter => "Key" + letter);
        return {
            numbers: ["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal"],
            top: letters("QWERTYUIOP").concat(["BracketLeft", "BracketRight"]),
            home: letters("ASDFGHJKL").concat(["Semicolon", "Quote"]),
            bottom: letters("ZXCVBNM").concat(["Comma", "Period", "Slash"])
        };
    }

    static keyCode(code) {
        let table = {Backquote: 192, Minus: 189, Equal: 187, Backspace: 8, Tab: 9, BracketLeft: 219, BracketRight: 221, Backslash: 220, CapsLock: 20, Semicolon: 186, Quote: 222, Enter: 13, ShiftLeft: 16, ShiftRight: 16, IntlBackslash: 226, Comma: 188, Period: 190, Slash: 191, IntlRo: 193, ControlLeft: 17, MetaLeft: 91, AltLeft: 18, AltRight: 18, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40};
        if (Object.prototype.hasOwnProperty.call(table, code)) return table[code];
        let match = /^(Key|Digit)(.)$/.exec(code);
        return match ? match[2].charCodeAt(0) : 0;
    }

    static physicalCode(code) {
        let table = {ControlRight: "ControlLeft", MetaRight: "MetaLeft", NumpadEnter: "Enter"};
        return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : code;
    }

    static heatId(code) {
        let table = {ShiftLeft: "Shift", ShiftRight: "Shift", AltLeft: "Alt", AltRight: "Alt", ControlLeft: "Control", ControlRight: "Control", MetaLeft: "Meta", MetaRight: "Meta", NumpadEnter: "Enter"};
        return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : code;
    }

    static charKey(raw, code, grow) {
        let fix = value => (typeof value === "string") ? value.split("~~~CTRLSEQ1~~~").join("\x1b") : null;
        let base = fix(raw.cmd);
        let label = raw.name;
        if (base.length === 2 && base.charAt(0) === "\\") base = base.charAt(1);
        if (label.length === 2 && label.charAt(0) === "\\") label = label.charAt(1);
        let shifted = fix(raw.shift_cmd);
        let top = (typeof raw.shift_name === "string" && raw.shift_name.toLowerCase() !== label.toLowerCase()) ? raw.shift_name : "";
        return {
            code,
            label,
            top,
            grow: grow || 1,
            aria: label,
            name: label,
            keyCode: Keyboard.keyCode(code),
            base,
            shifted,
            alt: fix(raw.alt_cmd),
            altshift: fix(raw.altshift_cmd),
            capslock: fix(raw.capslck_cmd),
            letter: base.length === 1 && base.toLowerCase() !== base.toUpperCase() && shifted === base.toUpperCase(),
            mod: null,
            action: null,
            look: "char",
            short: ""
        };
    }

    static special(code, label, grow, aria, name, extra) {
        return Object.assign({
            code,
            label,
            top: "",
            grow,
            aria,
            name,
            keyCode: Keyboard.keyCode(code),
            base: null,
            shifted: null,
            alt: null,
            altshift: null,
            capslock: null,
            letter: false,
            mod: null,
            action: code,
            look: "mod",
            short: ""
        }, extra || {});
    }

    static arrange(layout, name) {
        ["row_numbers", "row_1", "row_2", "row_3", "row_space"].forEach(row => {
            if (!Array.isArray(layout[row]) || !layout[row].every(key => key !== null && typeof key === "object" && typeof key.name === "string" && typeof key.cmd === "string")) {
                throw new Error("The keyboard layout has no usable " + row);
            }
        });
        let numbers = layout.row_numbers;
        let top = layout.row_1;
        let home = layout.row_2;
        let bottom = layout.row_3;
        if (numbers.length !== 15 || top.length !== 14 || home.length !== 14) throw new Error("The keyboard layout's rows have an unknown size");
        let rightShift = bottom.findIndex((key, i) => i > 0 && key.cmd === "ESCAPED|-- SHIFT: RIGHT");
        let middle = (rightShift > 0) ? bottom.slice(1, rightShift) : [];
        let codes = Keyboard.codes();
        let bottomCodes;
        if (middle.length === 11) {
            bottomCodes = ["IntlBackslash"].concat(codes.bottom);
        } else if (middle.length === 12) {
            bottomCodes = ["IntlBackslash"].concat(codes.bottom, ["IntlRo"]);
        } else {
            throw new Error("The keyboard layout's bottom row has an unknown size");
        }
        let ansi = /^en-/.test(name) && name !== "en-GB" && middle.length === 11;
        if (ansi) {
            middle = middle.slice(1);
            bottomCodes = bottomCodes.slice(1);
        }

        let first = numbers.slice(1, 14).map((key, i) => Keyboard.charKey(key, codes.numbers[i]));
        first.push(Keyboard.special("Backspace", "BACKSPACE", 2, "Backspace", "Backspace", {short: "BACK"}));

        let second = [Keyboard.special("Tab", "TAB", 1.5, "Tab", "Tab")];
        top.slice(1, 13).forEach((key, i) => second.push(Keyboard.charKey(key, codes.top[i])));
        let slash = Keyboard.charKey(home[12], "Backslash", 1.5);
        if (slash.label === "\\") slash.aria = "Backslash";
        second.push(slash);

        let third;
        if (home[0].cmd.startsWith("ESCAPED|-- CAPSLCK")) {
            third = [Keyboard.special("CapsLock", "CAPS", 1.75, "Caps lock", "Caps", {mod: "caps", action: null})];
        } else if (home[0].cmd === "\b") {
            third = [Keyboard.special("CapsLock", "BACK", 1.75, "Backspace", "Backspace", {action: "Backspace", keyCode: 8})];
        } else {
            third = [Keyboard.charKey(home[0], "CapsLock", 1.75)];
        }
        home.slice(1, 12).forEach((key, i) => third.push(Keyboard.charKey(key, codes.home[i])));
        third.push(Keyboard.special("Enter", "ENTER", 2.25, "Enter", "Enter"));

        let leftGrow = ansi ? 2.25 : 1.25;
        let fourth = [Keyboard.special("ShiftLeft", "SHIFT", leftGrow, "Shift", "Shift", {mod: "shift", action: null})];
        middle.forEach((key, i) => fourth.push(Keyboard.charKey(key, bottomCodes[i])));
        fourth.push(Keyboard.special("ShiftRight", "SHIFT", 15 - leftGrow - middle.length, "Shift", "Shift", {mod: "shift", action: null}));

        let arrow = (code, label, aria, name) => Keyboard.special(code, label, 1, aria, name, {look: "char"});
        let fifth = [
            Keyboard.special("ControlLeft", "CTRL", 1.25, "Control", "Ctrl", {mod: "ctrl", action: null}),
            Keyboard.special("MetaLeft", "WIN", 1.25, "Windows", "Win", {mod: "win", action: null}),
            Keyboard.special("AltLeft", "ALT", 1.25, "Alt", "Alt", {mod: "alt", action: null}),
            Keyboard.special("Space", "", 6, "Space", "Space"),
            Keyboard.special("AltRight", ansi ? "ALT" : "ALT GR", 1.25, ansi ? "Alt" : "Alt Gr", ansi ? "Alt" : "AltGr", {mod: "alt", action: null, short: ansi ? "" : "ALTGR"}),
            arrow("ArrowLeft", "←", "Left arrow", "Left"),
            arrow("ArrowUp", "↑", "Up arrow", "Up"),
            arrow("ArrowDown", "↓", "Down arrow", "Down"),
            arrow("ArrowRight", "→", "Right arrow", "Right")
        ];
        return [first, second, third, fourth, fifth];
    }

    static family(name, rows) {
        let known = {"en-COLEMAK": "COLEMAK", "en-DVORAK": "DVORAK", "en-NORMAN": "NORMAN", "en-WORKMAN": "WORKMAN", "fr-BEPO": "BÉPO"};
        if (Object.prototype.hasOwnProperty.call(known, name)) return known[name];
        let letters = rows[1].filter(key => key.look === "char" && key.mod === null).slice(0, 6).map(key => key.label).join("");
        return /^\p{Lu}{6}$/u.test(letters) ? letters : "";
    }

    static shortcutTable() {
        let table = {};
        let order = ["Ctrl", "Alt", "Shift"];
        (Array.isArray(window.shortcuts) ? window.shortcuts : []).forEach(scut => {
            if (!scut || typeof scut.trigger !== "string") return;
            let cut = Object.assign({}, scut);
            let parts = cut.trigger.split("+");
            let last = parts.pop();
            parts.sort((a, b) => order.indexOf(a) - order.indexOf(b));
            let group = parts.join("");
            if (!table[group]) table[group] = [];
            if (cut.type === "app" && cut.action === "TAB_X" && last === "X") {
                for (let i = 1; i <= 5; i++) {
                    table[group].push(Object.assign({}, cut, {trigger: String(i), action: "TAB_" + i}));
                }
            } else {
                cut.trigger = last;
                table[group].push(cut);
            }
        });
        return table;
    }

    static control(text) {
        if (text.length !== 1) return text;
        let code = text.charCodeAt(0);
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return String.fromCharCode(code & 31);
        let table = {" ": "\x00", "@": "\x00", "2": "\x00", "3": "\x1b", "[": "\x1b", "4": "\x1c", "\\": "\x1c", "5": "\x1d", "]": "\x1d", "6": "\x1e", "^": "\x1e", "7": "\x1f", "_": "\x1f", "-": "\x1f", "8": "\x7f", "?": "\x7f"};
        return Object.prototype.hasOwnProperty.call(table, text) ? table[text] : text;
    }

    static plainText(data) {
        return data.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, "").replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "").replace(/\x1b[^\[\]]/g, "");
    }

    static isTyped(text) {
        return typeof text === "string" && text.length === 1 && text !== " " && !/[\x00-\x1f\x7f]/.test(text);
    }

    static eventName(e) {
        let key = e.key;
        if (typeof key !== "string" || key === "" || key === "Unidentified") return (typeof e.code === "string" && e.code !== "") ? e.code : "Key";
        if (key === " ") return "Space";
        if (key.length === 1) return key.toUpperCase();
        let names = {Control: "Ctrl", Meta: "Win", OS: "Win", CapsLock: "Caps", ArrowLeft: "Left", ArrowUp: "Up", ArrowRight: "Right", ArrowDown: "Down", Escape: "Esc", AltGraph: "AltGr"};
        return Object.prototype.hasOwnProperty.call(names, key) ? names[key] : key;
    }

    build() {
        this.container.textContent = "";
        this.container.dataset.layout = this.name;
        this.rows.forEach(row => {
            let line = document.createElement("div");
            line.className = "vx-kb-row";
            row.forEach(key => {
                let button = document.createElement("button");
                button.type = "button";
                button.tabIndex = -1;
                button.className = "vx-key " + ((key.look === "mod") ? "vx-key-mod" : "vx-key-char");
                button.dataset.code = key.code;
                button.dataset.heat = Keyboard.heatId(key.code);
                button.style.setProperty("--vx-grow", String(key.grow));
                button.setAttribute("aria-label", key.aria);
                if (key.top !== "") {
                    let small = document.createElement("span");
                    small.className = "vx-key-top";
                    small.setAttribute("aria-hidden", "true");
                    small.textContent = key.top;
                    button.appendChild(small);
                }
                let label = document.createElement("span");
                label.className = "vx-key-label";
                label.textContent = key.label;
                button.appendChild(label);
                if (key.short !== "") {
                    let short = document.createElement("span");
                    short.className = "vx-key-short-label";
                    short.textContent = key.short;
                    button.appendChild(short);
                }
                line.appendChild(button);
                this.elements.set(key.code, button);
                this.specs.set(key.code, key);
            });
            this.container.appendChild(line);
        });

        this.container.onpointerdown = e => {
            let button = e.target.closest(".vx-key");
            if (!button || !this.container.contains(button)) return;
            e.preventDefault();
            if (e.button !== 0) return;
            try {
                button.setPointerCapture(e.pointerId);
            } catch(err) {
            }
            this.pointerDown(button, e.pointerId);
        };
        let up = e => this.pointerUp(e.pointerId);
        this.container.onpointerup = up;
        this.container.onpointercancel = up;
        this.container.onlostpointercapture = up;

        if (Keyboard.observer) Keyboard.observer.disconnect();
        Keyboard.observer = new ResizeObserver(() => this.fit());
        Keyboard.observer.observe(this.container);
    }

    fit() {
        this.elements.forEach((button, code) => {
            button.classList.remove("vx-key-tight", "vx-key-short");
            if (button.scrollWidth > button.clientWidth) button.classList.add("vx-key-tight");
            if (this.specs.get(code).short !== "" && button.scrollWidth > button.clientWidth) button.classList.add("vx-key-short");
        });
        let head = this.container.parentElement ? this.container.parentElement.querySelector(".vx-kb-head") : null;
        if (!head) return;
        head.classList.remove("vx-kb-fit-1", "vx-kb-fit-2", "vx-kb-fit-3");
        for (let level = 1; level <= 3 && head.scrollWidth > head.clientWidth; level++) {
            head.classList.add("vx-kb-fit-" + level);
        }
    }

    passwordMode() {
        return this.container.dataset.passwordMode === "true";
    }

    pointerDown(button, pointerId) {
        this.pointerUp(pointerId);
        let key = this.specs.get(button.dataset.code);
        if (!key) return;
        let state = {button, wait: null, again: null};
        this.pointers.set(pointerId, state);
        if (!this.passwordMode()) button.classList.add("vx-down");
        this.press(key);
        if (key.mod === null) {
            state.wait = setTimeout(() => {
                state.again = setInterval(() => this.press(key, true), 70);
            }, 400);
        }
    }

    pointerUp(pointerId) {
        let state = this.pointers.get(pointerId);
        if (!state) return;
        this.pointers.delete(pointerId);
        clearTimeout(state.wait);
        clearInterval(state.again);
        state.button.classList.remove("vx-down");
    }

    release() {
        this.pointers.forEach((state, pointerId) => this.pointerUp(pointerId));
        this.held = {ctrl: false, alt: false, shift: false, caps: this.held.caps};
        this.elements.forEach(button => button.classList.remove("vx-down"));
        this.renderMods();
    }

    syncHeld(e) {
        this.held.ctrl = e.ctrlKey === true;
        this.held.alt = e.altKey === true;
        this.held.shift = e.shiftKey === true;
        if (typeof e.getModifierState === "function") this.held.caps = e.getModifierState("CapsLock") === true;
    }

    keyDown(e) {
        this.syncHeld(e);
        this.renderMods();
        if (this.passwordMode()) return;
        let code = Keyboard.physicalCode(e.code);
        let button = this.elements.get(code);
        if (button) button.classList.add("vx-down");
        let modifier = /^(Shift|Alt|Control|Meta|Caps)/.test(e.code);
        if (!e.repeat) {
            this.mark(button ? code : null, Keyboard.eventName(e), e.keyCode);
            if (button) {
                let altGraph = typeof e.getModifierState === "function" && e.getModifierState("AltGraph");
                let typed = (Keyboard.isTyped(e.key) && !e.metaKey && ((!e.ctrlKey && !e.altKey) || altGraph)) ? e.key : null;
                this.count(code, typed);
            }
        }
        if (!e.repeat || !modifier) window.audioManager.stdin.play();
    }

    keyUp(e) {
        this.syncHeld(e);
        this.renderMods();
        let button = this.elements.get(Keyboard.physicalCode(e.code));
        if (button) button.classList.remove("vx-down");
        if (!this.passwordMode() && e.key === "Enter") window.audioManager.granted.play();
    }

    mark(code, name, keyCode) {
        this.lastCode = code;
        this.lastText = name + " · " + ((Number.isFinite(keyCode) && keyCode > 0) ? keyCode : "?");
        this.renderLast();
        this.renderHeat();
    }

    count(code, typed) {
        let id = Keyboard.heatId(code);
        if (typed !== null) {
            this.waiting.push({id, typed, at: performance.now()});
            if (this.waiting.length > 64) this.waiting.shift();
            return;
        }
        this.bump(id);
        this.renderHeat();
    }

    bump(id) {
        let count = (this.counts.get(id) || 0) + 1;
        this.counts.set(id, count);
        if (count > this.maxCount) this.maxCount = count;
    }

    noteInput(data) {
        if (typeof data !== "string" || data.length === 0 || data.length > 8) return;
        let now = performance.now();
        if (this.echoStart === null || now - this.echoStart > 1000) this.echoStart = now;
    }

    noteOutput(data) {
        let now = performance.now();
        if (this.echoStart !== null) {
            let took = now - this.echoStart;
            this.echoStart = null;
            if (took <= 1000) {
                this.echoSamples.push(took);
                if (this.echoSamples.length > 32) this.echoSamples.shift();
                this.renderEcho();
            }
        }
        if (this.waiting.length === 0) return;
        this.waiting = this.waiting.filter(entry => now - entry.at <= 1000);
        if (this.waiting.length === 0 || typeof data !== "string" || data.length > 4096) return;
        let text = Keyboard.plainText(data);
        let left = [];
        let changed = false;
        this.waiting.forEach(entry => {
            if (text.includes(entry.typed)) {
                this.bump(entry.id);
                changed = true;
            } else {
                left.push(entry);
            }
        });
        this.waiting = left;
        if (changed) this.renderHeat();
    }

    stats() {
        return {counts: Array.from(this.counts.entries()), lastCode: this.lastCode, lastText: this.lastText, echoSamples: this.echoSamples.slice()};
    }

    renderHead() {
        let layout = document.getElementById("vx-kb-layout");
        if (layout) layout.textContent = (this.family !== "") ? this.name + " · " + this.family : this.name;
        this.renderMods();
        this.renderLast();
        this.renderEcho();
    }

    renderMods() {
        ["ctrl", "alt", "shift", "caps"].forEach(mod => {
            let on = this.held[mod] || this.latched[mod];
            document.querySelectorAll(".vx-ind[data-mod=\"" + mod + "\"]").forEach(ind => ind.classList.toggle("vx-on", on));
        });
        this.specs.forEach((key, code) => {
            if (key.mod === null || key.mod === "win") return;
            let on = (key.mod === "caps") ? (this.latched.caps || this.held.caps) : this.latched[key.mod];
            this.elements.get(code).classList.toggle("vx-on", on);
        });
    }

    renderLast() {
        let last = document.getElementById("vx-kb-last");
        if (last) last.textContent = this.lastText;
    }

    renderEcho() {
        let echo = document.getElementById("vx-kb-echo");
        if (!echo) return;
        if (this.echoSamples.length === 0) {
            echo.textContent = "—";
            return;
        }
        let sorted = this.echoSamples.slice().sort((a, b) => a - b);
        let middle = Math.floor(sorted.length / 2);
        let median = (sorted.length % 2 === 1) ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        echo.textContent = median.toFixed(1) + " ms";
    }

    renderHeat() {
        let max = this.maxCount;
        this.elements.forEach((button, code) => {
            let count = this.counts.get(button.dataset.heat) || 0;
            let heat = (max > 0) ? count / max : 0;
            button.classList.toggle("vx-hot", heat > 0);
            button.classList.toggle("vx-hot-edge", heat > 0.45);
            button.classList.toggle("vx-hot-text", heat > 0.3);
            if (heat > 0) {
                button.style.setProperty("--vx-heat", heat.toFixed(4));
            } else {
                button.style.removeProperty("--vx-heat");
            }
            button.classList.toggle("vx-last", code === this.lastCode);
        });
    }

    focusTerm() {
        if (!this.linkedToTerm || !window.term) return;
        let term = window.term[window.currentTerm];
        if (term && term.term) term.term.focus();
    }

    shortcut(key) {
        let group = (this.latched.ctrl || this.held.ctrl ? "Ctrl" : "") + (this.latched.alt || this.held.alt ? "Alt" : "") + (this.latched.shift || this.held.shift ? "Shift" : "");
        if (group === "" || !Array.isArray(this._shortcuts[group])) return false;
        let names = {Space: "space", Tab: "tab", Enter: "enter", Backspace: "backspace", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down", ArrowRight: "right"};
        let name = (key.action !== null) ? names[key.action] : ((typeof key.base === "string") ? key.base.toLowerCase() : "");
        if (!name) return false;
        let used = false;
        this._shortcuts[group].forEach(cut => {
            if (used || !cut.enabled) return;
            let trigger = cut.trigger.toLowerCase().replace("plus", "+").replace("return", "enter");
            if (trigger !== name) return;
            if (cut.type === "app") {
                window.useAppShortcut(cut.action);
                used = true;
            } else if (cut.type === "shell" && window.term && window.term[window.currentTerm]) {
                window.term[window.currentTerm][cut.linebreak ? "writelr" : "write"](cut.action);
                used = true;
            }
        });
        return used;
    }

    output(key) {
        let ctrl = this.latched.ctrl || this.held.ctrl;
        let alt = this.latched.alt || this.held.alt;
        let shift = this.latched.shift || this.held.shift;
        if (key.action === "Backspace") return shift ? "\x1b[3~" : (ctrl ? "\b" : (alt ? "\x1b\x7f" : "\x7f"));
        if (key.action === "Tab") return shift ? "\x1b[Z" : (alt ? "\x1b\t" : "\t");
        if (key.action === "Enter") return alt ? "\x1b\r" : "\r";
        if (key.action === "Space") return ctrl ? "\x00" : (alt ? "\x1b " : " ");
        if (key.action !== null && key.action.startsWith("Arrow")) {
            let letter = {ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D"}[key.action];
            let mods = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
            if (mods > 1) return "\x1b[1;" + mods + letter;
            let term = (window.term && this.linkedToTerm) ? window.term[window.currentTerm] : null;
            let app = Boolean(term && term.term && term.term.modes && term.term.modes.applicationCursorKeysMode);
            return (app ? "\x1bO" : "\x1b[") + letter;
        }
        let caps = this.latched.caps || this.held.caps;
        let text;
        let meta = false;
        if (alt && shift && key.altshift) {
            text = key.altshift;
        } else if (alt && key.alt) {
            text = key.alt;
        } else {
            let upper = shift;
            if (caps && key.letter) upper = !upper;
            text = (upper && key.shifted) ? key.shifted : key.base;
            if (caps && !shift && key.capslock) text = key.capslock;
            meta = alt;
        }
        if (text.startsWith("ESCAPED|-- ")) {
            this.dead = text.slice(11);
            return null;
        }
        if (this.dead !== null) {
            text = this.accent(this.dead, text);
            this.dead = null;
        }
        if (ctrl) text = Keyboard.control(text);
        if (meta && !text.startsWith("\x1b")) text = "\x1b" + text;
        return text;
    }

    accent(dead, text) {
        let table = {CIRCUM: "addCircum", TREMA: "addTrema", ACUTE: "addAcute", GRAVE: "addGrave", CARON: "addCaron", BAR: "addBar", BREVE: "addBreve", TILDE: "addTilde", MACRON: "addMacron", CEDILLA: "addCedilla", OVERRING: "addOverring", GREEK: "toGreek", IOTASUB: "addIotasub"};
        return Object.prototype.hasOwnProperty.call(table, dead) ? this[table[dead]](text) : text;
    }

    press(key, repeat) {
        let quiet = this.passwordMode() || repeat === true;
        if (!quiet) this.mark(key.code, key.name, key.keyCode);
        if (key.mod !== null) {
            if (key.mod !== "win") this.latched[key.mod] = !this.latched[key.mod];
            if (!quiet) {
                this.count(key.code, null);
                window.audioManager.stdin.play();
            }
            this.renderMods();
            this.focusTerm();
            return;
        }
        let text = null;
        if (!this.shortcut(key)) {
            text = this.output(key);
            if (text !== null) this.send(text);
        }
        this.latched.ctrl = false;
        this.latched.alt = false;
        this.latched.shift = false;
        this.renderMods();
        if (!quiet) {
            this.count(key.code, Keyboard.isTyped(text) ? text : null);
            if (key.action === "Enter") {
                window.audioManager.granted.play();
            } else {
                window.audioManager.stdin.play();
            }
        }
        this.focusTerm();
    }

    send(text) {
        if (this.linkedToTerm) {
            let term = window.term ? window.term[window.currentTerm] : null;
            if (term) term.write(text);
            return;
        }
        let field = document.activeElement;
        if (!field) return;
        if (text === "\r") {
            field.dispatchEvent(new CustomEvent("change", {detail: "enter"}));
            return;
        }
        if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
        let isDelete = false;
        if (text === "\x7f" || text === "\b") {
            field.value = field.value.slice(0, -1);
            isDelete = true;
        } else if (text === "\x1b[D" || text === "\x1bOD") {
            let at = Math.max(0, (field.selectionStart || 0) - 1);
            field.setSelectionRange(at, at);
        } else if (text === "\x1b[C" || text === "\x1bOC") {
            let at = Math.min(field.value.length, (field.selectionEnd || 0) + 1);
            field.setSelectionRange(at, at);
        } else if (/^[^\x00-\x1f\x7f]+$/.test(text)) {
            field.value = field.value + text;
        } else {
            return;
        }
        field.dispatchEvent(new CustomEvent("input", {detail: isDelete ? "delete" : "insert"}));
        field.focus();
    }

    togglePasswordMode() {
        let d = this.container.dataset.passwordMode;
        (d === "true") ? d = "false" : d = "true";
        this.container.dataset.passwordMode = d;
        window.passwordMode = d;
        if (d === "true") {
            this.waiting = [];
            this.elements.forEach(button => button.classList.remove("vx-down"));
        }
        return d;
    }
    addCircum(char) {
        switch(char) {
            case "a":
                return "â";
            case "A":
                return "Â";
            case "z":
                return "ẑ";
            case "Z":
                return "Ẑ";
            case "e":
                return "ê";
            case "E":
                return "Ê";
            case "y":
                return "ŷ";
            case "Y":
                return "Ŷ";
            case "u":
                return "û";
            case "U":
                return "Û";
            case "i":
                return "î";
            case "I":
                return "Î";
            case "o":
                return "ô";
            case "O":
                return "Ô";
            case "s":
                return "ŝ";
            case "S":
                return "Ŝ";
            case "g":
                return "ĝ";
            case "G":
                return "Ĝ";
            case "h":
                return "ĥ";
            case "H":
                return "Ĥ";
            case "j":
                return "ĵ";
            case "J":
                return "Ĵ";
            case "w":
                return "ŵ";
            case "W":
                return "Ŵ";
            case "c":
                return "ĉ";
            case "C":
                return "Ĉ";
            // the circumflex can also be used for superscript numbers
            case "1":
                return "¹";
            case "2":
                return "²";
            case "3":
                return "³";
            case "4":
                return "⁴";
            case "5":
                return "⁵";
            case "6":
                return "⁶";
            case "7":
                return "⁷";
            case "8":
                return "⁸";
            case "9":
                return "⁹";
            case "0":
                return "⁰";
            default:
                return char;
        }
    }
    addTrema(char) {
        switch(char) {
            case "a":
                return "ä";
            case "A":
                return "Ä";
            case "e":
                return "ë";
            case "E":
                return "Ë";
            case "t":
                return "ẗ";
            // My keyboard says no uppercase ẗ
            case "y":
                return "ÿ";
            case "Y":
                return "Ÿ";
            case "u":
                return "ü";
            case "U":
                return "Ü";
            case "i":
                return "ï";
            case "I":
                return "Ï";
            case "o":
                return "ö";
            case "O":
                return "Ö";
            case "h":
                return "ḧ";
            case "H":
                return "Ḧ";
            case "w":
                return "ẅ";
            case "W":
                return "Ẅ";
            case "x":
                return "ẍ";
            case "X":
                return "Ẍ";
            default:
                return char;
        }
    }
    addAcute(char) {
        switch(char) {
            case "a":
                return "á";
            case "A":
                return "Á";
            case "c":
                return "ć";
            case "C":
                return "Ć";
            case "e":
                return "é";
            case "E":
                return "E";
            case "g":
                return "ǵ";
            case "G":
                return "Ǵ";
            case "i":
                return "í";
            case "I":
                return "Í";
            case "j":
                return "ȷ́";
            case "J":
                return "J́";
            case "k":
                return "ḱ";
            case "K":
                return "Ḱ";
            case "l":
                return "ĺ";
            case "L":
                return "Ĺ";
            case "m":
                return "ḿ";
            case "M":
                return "Ḿ";
            case "n":
                return "ń";
            case "N":
                return "Ń";
            case "o":
                return "ó";
            case "O":
                return "Ó";
            case "p":
                return "ṕ";
            case "P":
                return "Ṕ";
            case "r":
                return "ŕ";
            case "R":
                return "Ŕ";
            case "s":
                return "ś";
            case "S":
                return "Ś";
            case "u":
                return "ú";
            case "U":
                return "Ú";
            case "v":
                return "v́";
            case "V":
                return "V́";
            case "w":
                return "ẃ";
            case "W":
                return "Ẃ";
            case "y":
                return "ý";
            case "Y":
                return "Ý";
            case "z":
                return "ź";
            case "Z":
                return "Ź";
            case "ê":
                return "ế";
            case "Ê":
                return "Ế";
            case "ç":
                return "ḉ";
            case "Ç":
                return "Ḉ";
            default:
                return char;
        }
    }
    addGrave(char) {
        switch (char) {
            case "a":
                return "à";
            case "A":
                return "À";
            case "e":
                return "è";
            case "E":
                return "È";
            case "i":
                return "ì";
            case "I":
                return "Ì";
            case "m":
                return "m̀";
            case "M":
                return "M̀";
            case "n":
                return "ǹ";
            case "N":
                return "Ǹ";
            case "o":
                return "ò";
            case "O":
                return "Ò";
            case "u":
                return "ù";
            case "U":
                return "Ù";
            case "v":
                return "v̀";
            case "V":
                return "V̀";
            case "w":
                return "ẁ";
            case "W":
                return "Ẁ";
            case "y":
                return "ỳ";
            case "Y":
                return "Ỳ";
            case "ê":
                return "ề";
            case "Ê":
                return "Ề";
            default:
                return char;
        }
    }
    addCaron(char) {
        switch (char) {
            case "a":
                return "ǎ";
            case "A":
                return "Ǎ";
            case "c":
                return "č";
            case "C":
                return "Č";
            case "d":
                return "ď";
            case "D":
                return "Ď";
            case "e":
                return "ě";
            case "E":
                return "Ě";
            case "g":
                return "ǧ";
            case "G":
                return "Ǧ";
            case "h":
                return "ȟ";
            case "H":
                return "Ȟ";
            case "i":
                return "ǐ";
            case "I":
                return "Ǐ";
            case "j":
                return "ǰ";
            case "k":
                return "ǩ";
            case "K":
                return "Ǩ";
            case "l":
                return "ľ";
            case "L":
                return "Ľ";
            case "n":
                return "ň";
            case "N":
                return "Ň";
            case "o":
                return "ǒ";
            case "O":
                return "Ǒ";
            case "r":
                return "ř";
            case "R":
                return "Ř";
            case "s":
                return "š";
            case "S":
                return "Š";
            case "t":
                return "ť";
            case "T":
                return "Ť";
            case "u":
                return "ǔ";
            case "U":
                return "Ǔ";
            case "z":
                return "ž";
            case "Z":
                return "Ž";
            // caron can also be used for subscript numbers
            case "1":
                return "₁";
            case "2":
                return "₂";
            case "3":
                return "₃";
            case "4":
                return "₄";
            case "5":
                return "₅";
            case "6":
                return "₆";
            case "7":
                return "₇";
            case "8":
                return "₈";
            case "9":
                return "₉";
            case "0":
                return "₀";
            default:
                return char;
        }
    }
    addBar(char) {
        switch (char) {
            case "a":
                return "ⱥ";
            case "A":
                return "Ⱥ";
            case "b":
                return "ƀ";
            case "B":
                return "Ƀ";
            case "c":
                return "ȼ";
            case "C":
                return "Ȼ";
            case "d":
                return "đ";
            case "D":
                return "Đ";
            case "e":
                return "ɇ";
            case "E":
                return "Ɇ";
            case "g":
                return "ǥ";
            case "G":
                return "Ǥ";
            case "h":
                return "ħ";
            case "H":
                return "Ħ";
            case "i":
                return "ɨ";
            case "I":
                return "Ɨ";
            case "j":
                return "ɉ";
            case "J":
                return "Ɉ";
            case "l":
                return "ł";
            case "L":
                return "Ł";
            case "o":
                return "ø";
            case "O":
                return "Ø";
            case "p":
                return "ᵽ";
            case "P":
                return "Ᵽ";
            case "r":
                return "ɍ";
            case "R":
                return "Ɍ";
            case "t":
                return "ŧ";
            case "T":
                return "Ŧ";
            case "u":
                return "ʉ";
            case "U":
                return "Ʉ";
            case "y":
                return "ɏ";
            case "Y":
                return "Ɏ";
            case "z":
                return "ƶ";
            case "Z":
                return "Ƶ";
            default:
                return char;
        }
    }
    addBreve(char) {
        switch (char) {
            case "a":
                return "ă";
            case "A":
                return "Ă";
            case "e":
                return "ĕ";
            case "E":
                return "Ĕ";
            case "g":
                return "ğ";
            case "G":
                return "Ğ";
            case "i":
                return "ĭ";
            case "I":
                return "Ĭ";
            case "o":
                return "ŏ";
            case "O":
                return "Ŏ";
            case "u":
                return "ŭ";
            case "U":
                return "Ŭ";
            case "à":
                return "ằ";
            case "À":
                return "Ằ";
            default:
                return char;
        }
    }
    addTilde(char) {
        switch (char) {
            case "a":
                return "ã";
            case "A":
                return "Ã";
            case "e":
                return "ẽ";
            case "E":
                return "Ẽ";
            case "i":
                return "ĩ";
            case "I":
                return "Ĩ";
            case "n":
                return "ñ";
            case "N":
                return "Ñ";
            case "o":
                return "õ";
            case "O":
                return "Õ";
            case "u":
                return "ũ";
            case "U":
                return "Ũ";
            case "v":
                return "ṽ";
            case "V":
                return "Ṽ";
            case "y":
                return "ỹ";
            case "Y":
                return "Ỹ";
            case "ê":
                return "ễ";
            case "Ê":
                return "Ễ";
            default:
                return char;
        }
    }
    addMacron(char) {
        switch (char) {
            case "a":
                return "ā";
            case "A":
                return "Ā";
            case "e":
                return "ē";
            case "E":
                return "Ē";
            case "g":
                return "ḡ";
            case "G":
                return "Ḡ";
            case "i":
                return "ī";
            case "I":
                return "Ī";
            case "o":
                return "ō";
            case "O":
                return "Ō";
            case "u":
                return "ū";
            case "U":
                return "Ū";
            case "y":
                return "ȳ";
            case "Y":
                return "Ȳ";
            case "é":
                return "ḗ";
            case "É":
                return "Ḗ";
            case "è":
                return "ḕ";
            case "È":
                return "Ḕ";
            default:
                return char;
        }
    }
    addCedilla(char) {
        switch (char) {
            case "c":
                return "ç";
            case "C":
                return "Ç";
            case "d":
                return "ḑ";
            case "D":
                return "Ḑ";
            case "e":
                return "ȩ";
            case "E":
                return "Ȩ";
            case "g":
                return "ģ";
            case "G":
                return "Ģ";
            case "h":
                return "ḩ";
            case "H":
                return "Ḩ";
            case "k":
                return "ķ";
            case "K":
                return "Ķ";
            case "l":
                return "ļ";
            case "L":
                return "Ļ";
            case "n":
                return "ņ";
            case "N":
                return "Ņ";
            case "r":
                return "ŗ";
            case "R":
                return "Ŗ";
            case "s":
                return "ş";
            case "S":
                return "Ş";
            case "t":
                return "ţ";
            case "T":
                return "Ţ";
            default:
                return char;
        }
    }
    addOverring(char) {
        switch (char) {
            case "a":
                return "å";
            case "A":
                return "Å";
            case "u":
                return "ů";
            case "U":
                return "Ů";
            case "w":
                return "ẘ"; // capital w with overring not supported on bépo layout apparently
            case "y":
                return "ẙ"; // same for capital y with overring
            default:
                return char;
        }
    }
    toGreek(char) {
        switch (char) {
            case "b":
                return "β";
            case "p":
                return "π";
            case "P":
                return "Π";
            case "d":
                return "δ";
            case "D":
                return "Δ";
            case "l":
                return "λ";
            case "L":
                return "Λ";
            case "j":
                return "θ";
            case "J":
                return "Θ";
            case "z":
                return "ζ";
            case "w":
                return "ω";
            case "W":
                return "Ω";
            case "A":
                return "α";
            case "u":
                return "υ";
            case "U":
                return "Υ";
            case "i":
                return "ι";
            case "e":
                return "ε";
            case "t":
                return "τ";
            case "s":
                return "σ";
            case "S":
                return "Σ";
            case "r":
                return "ρ";
            case "R":
                return "Ρ";
            case "n":
                return "ν";
            case "m":
                return "μ";
            case "y":
                return "ψ";
            case "Y":
                return "Ψ";
            case "x":
                return "ξ";
            case "X":
                return "Ξ";
            case "k":
                return "κ";
            case "q":
                return "χ";
            case "Q":
                return "Χ";
            case "g":
                return "γ";
            case "G":
                return "Γ";
            case "h":
                return "η";
            case "f":
                return "φ";
            case "F":
                return "Φ";
            default:
                return char;
        }
    }
    addIotasub(char) {
        switch (char) {
            case "o":
                return "ǫ";
            case "O":
                return "Ǫ";
            case "a":
                return "ą";
            case "A":
                return "Ą";
            case "u":
                return "ų";
            case "U":
                return "Ų";
            case "i":
                return "į";
            case "I":
                return "Į";
            case "e":
                return "ę";
            case "E":
                return "Ę";
            default:
                return char;
        }
    }
}
