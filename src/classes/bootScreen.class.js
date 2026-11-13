class BootScreen {
    constructor(opts) {
        this.container = opts.container;
        this.settings = opts.settings || {};
        this.timers = [];
        this.finished = false;
        this.replied = false;
        this.early = [];
        this.queue = [];
        this.seen = new Set();
        this.offset = 0;
        this.rows = [];
        this.newest = null;
        this.shown = 0;
        this.problems = 0;
        this.lastShownAt = -Infinity;
        this.lastSoundAt = -Infinity;
        this.pumpTimer = null;
        this.readyTimer = null;
        this.checksLeft = 0;
        this.checksDone = false;
        this.expirers = [];
        this.forced = false;
        this.building = null;
        this.ready = false;
        this.actTwo = false;
        this.rainSize = "";
        this.unsubscribe = null;
        this.statusParts = {
            ok: ["[  ", "OK", "  ]"],
            info: ["[ ", "INFO", " ]"],
            warn: ["[ ", "WARN", " ]"],
            fail: ["[ ", "FAIL", " ]"],
            pending: ["[ ", "....", " ]"]
        };
        this.onResize = this.guard(() => this.layout());
    }

    run() {
        return new Promise(resolve => {
            this.resolveRun = resolve;
            try {
                this.start();
            } catch(err) {
                this.fail(err);
            }
        });
    }

    start() {
        this.startedAt = performance.now();
        this.build();
        this.layout();
        window.addEventListener("resize", this.onResize);
        this.unsubscribe = window.vindex.onBootEvent(this.guard(event => this.receive(event)));
        window.vindex.getBootEvents().then(this.guard(reply => this.receiveAll(reply)), this.guard(() => this.receiveAll(null)));
        this.startChecks();
        this.at(8000, () => this.expire());
        this.at(15000, () => this.finish());
    }

    guard(fn) {
        return (...args) => {
            if (this.finished) return;
            try {
                fn(...args);
            } catch(err) {
                this.fail(err);
            }
        };
    }

    later(fn, ms) {
        let timer = setTimeout(this.guard(fn), ms);
        this.timers.push(timer);
        return timer;
    }

    at(ms, fn) {
        return this.later(fn, Math.max(0, this.startedAt + ms - performance.now()));
    }

    log(level, message) {
        try {
            window.vindex.log(level, message);
        } catch(err) {
            console.error(message, err);
        }
    }

    fail(err) {
        this.log("error", "Boot screen stopped: " + String((err && (err.stack || err.message)) || err));
        this.finish();
    }

    finish() {
        if (this.finished) return;
        this.finished = true;
        this.timers.forEach(timer => clearTimeout(timer));
        window.removeEventListener("resize", this.onResize);
        try {
            if (this.unsubscribe) this.unsubscribe();
        } catch(err) {
            this.log("error", "Boot screen could not stop listening to boot events: " + String((err && err.message) || err));
        }
        if (this.container) this.container.remove();
        this.resolveRun();
    }

    el(tag, className, text) {
        let node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    }

    hidden(node) {
        node.setAttribute("aria-hidden", "true");
        return node;
    }

    svg(size, shapes) {
        let ns = "http://www.w3.org/2000/svg";
        let svg = document.createElementNS(ns, "svg");
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        shapes.forEach(([name, attributes]) => {
            let shape = document.createElementNS(ns, name);
            Object.keys(attributes).forEach(key => shape.setAttribute(key, attributes[key]));
            svg.appendChild(shape);
        });
        return svg;
    }

    randomInt(min, max) {
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    play(name) {
        let audio = window.audioManager;
        if (audio && audio[name] && typeof audio[name].play === "function") audio[name].play();
    }

    sound(name) {
        let now = performance.now();
        if (now - this.lastSoundAt < 30) return;
        this.lastSoundAt = now;
        this.play(name);
    }

    build() {
        let screen = this.container;
        screen.textContent = "";
        screen.setAttribute("aria-label", "Vindex startup");
        this.rain = this.hidden(this.el("div", "vx-rain"));
        this.dimLeft = this.hidden(this.el("div", "vx-dim-left"));
        this.stage = this.el("div", "vx-stage");
        this.act1 = this.el("div", "vx-act1");

        let head = this.el("div", "vx-head-left");
        head.append(
            this.svg(10, [
                ["rect", {x: "1", y: "1", width: "22", height: "22", fill: "none", stroke: "#3FD5C3", "stroke-width": "2.4"}],
                ["path", {d: "M5.5 7.5L10 12L5.5 16.5", fill: "none", stroke: "#3FD5C3", "stroke-width": "3"}],
                ["path", {d: "M12 16.5H18.5", fill: "none", stroke: "#3FD5C3", "stroke-width": "3"}]
            ]),
            this.el("span", "vx-brand", "VINDEX"),
            this.el("span", "vx-label", "BOOT SEQUENCE"),
            this.el("span", "vx-version", "v" + (window.vindex.appVersion || ""))
        );

        let counters = this.el("div", "vx-head-right");
        this.linesCounter = this.el("span", "vx-counter vx-counter-lines", "00");
        this.timeCounter = this.el("span", "vx-counter vx-counter-ms", "0 ms");
        counters.append(
            this.el("span", "vx-counter-label", "LINES"),
            this.linesCounter,
            this.el("span", "vx-counter-gap"),
            this.el("span", "vx-counter-label", "TIME"),
            this.timeCounter
        );

        let log = this.el("div", "vx-log");
        log.setAttribute("role", "log");
        this.list = this.el("div", "vx-log-list");
        log.appendChild(this.list);

        this.act1.append(head, counters, this.hidden(this.el("div", "vx-hairline")), log);
        this.stage.appendChild(this.act1);
        screen.append(this.rain, this.dimLeft, this.stage);
    }

    layout() {
        let width = window.innerWidth;
        let height = window.innerHeight;
        let scale = Math.min(width / 1366, height / 768);
        if (!(scale > 0)) return;
        let style = this.container.style;
        style.setProperty("--vx-s", String(scale));
        style.setProperty("--vx-x", ((width - 1366 * scale) / 2) + "px");
        style.setProperty("--vx-y", ((height - 768 * scale) / 2) + "px");
        let rainWidth = width / scale;
        let rainHeight = height / scale;
        this.rain.style.width = rainWidth + "px";
        this.rain.style.height = rainHeight + "px";
        let size = Math.ceil(rainWidth / 24) + ":" + Math.round(rainHeight);
        if (size === this.rainSize) return;
        this.rainSize = size;
        this.fillRain(rainWidth, rainHeight);
    }

    fillRain(width, height) {
        let count = Math.ceil(width / 24);
        let fragment = document.createDocumentFragment();
        for (let i = 0; i < count; i++) fragment.appendChild(this.rainColumn(i, count, height));
        for (let i = 0; i < 8; i++) fragment.appendChild(this.rainStreak(width, height));
        this.rain.textContent = "";
        this.rain.appendChild(fragment);
    }

    rainColumn(i, count, height) {
        let roll = Math.random();
        let [size, alpha, minFall, maxFall] = (roll < 0.4) ? [12, 0.22, 7600, 10800] : (roll < 0.8) ? [15, 0.36, 5200, 7200] : [19, 0.52, 3600, 5000];
        let digits = this.randomInt(18, 34);
        let length = digits * size * 1.12;
        let fall = this.randomInt(minFall, maxFall);
        let flick = this.randomInt(380, 900);
        let column = this.el("div", "vx-col");
        column.style.left = (24 * i + 12 - size * 0.31) + "px";
        column.style.top = (-length) + "px";
        column.style.height = length + "px";
        column.style.fontSize = size + "px";
        column.style.setProperty("--hue", String(165 + 150 * ((count > 1) ? i / (count - 1) : 0)));
        column.style.setProperty("--alpha", String(alpha));
        column.style.setProperty("--d", (height + length) + "px");
        column.style.setProperty("--fall", fall + "ms");
        column.style.setProperty("--fall-delay", (-this.randomInt(0, fall)) + "ms");
        column.style.setProperty("--flick", flick + "ms");
        column.style.setProperty("--flick-delay", (-this.randomInt(0, flick)) + "ms");
        let first = Array.from({length: digits}, () => this.randomInt(0, 9));
        let second = first.map(digit => (Math.random() < 0.62) ? digit : (digit + this.randomInt(1, 9)) % 10);
        column.append(this.rainDigits("vx-flick-a", first), this.rainDigits("vx-flick-b", second));
        return column;
    }

    rainDigits(className, digits) {
        let layer = this.el("span", className, digits.slice(0, -1).join(""));
        layer.appendChild(this.el("span", "vx-head", digits[digits.length - 1]));
        return layer;
    }

    rainStreak(width, height) {
        let x = Math.random() * width;
        let fall = this.randomInt(2600, 4600);
        let streak = this.el("span", "vx-streak");
        streak.style.left = x.toFixed(1) + "px";
        streak.style.setProperty("--hue", String(165 + 150 * x / width));
        streak.style.setProperty("--d", (height + 232) + "px");
        streak.style.setProperty("--fall", fall + "ms");
        streak.style.setProperty("--fall-delay", (-this.randomInt(0, fall)) + "ms");
        return streak;
    }

    isEvent(event) {
        return event !== null && typeof event === "object" && Number.isFinite(event.seq) && Number.isFinite(event.t) && typeof event.tag === "string" && typeof event.message === "string";
    }

    enqueueEvent(event) {
        if (this.seen.has(event.seq)) return;
        this.seen.add(event.seq);
        this.queue.push({t: event.t, tag: event.tag, message: event.message, status: event.status});
    }

    receive(event) {
        if (!this.isEvent(event)) return;
        if (!this.replied) {
            this.early.push({event});
            return;
        }
        this.enqueueEvent(event);
        this.pump();
    }

    receiveAll(reply) {
        if (this.replied) return;
        this.replied = true;
        let valid = reply !== null && typeof reply === "object" && Number.isFinite(reply.now) && reply.now > 0 && Array.isArray(reply.events);
        this.offset = valid ? reply.now - performance.now() : 0;
        if (valid) {
            reply.events.filter(event => this.isEvent(event)).sort((a, b) => a.seq - b.seq).forEach(event => this.enqueueEvent(event));
        } else {
            this.queue.push({pt: performance.now(), tag: "MAIN", message: "no answer from getBootEvents", status: "fail"});
        }
        this.early.forEach(item => {
            if (item.event) {
                this.enqueueEvent(item.event);
            } else {
                this.queue.push(item.line);
            }
        });
        this.early = [];
        this.pump();
    }

    addLine(tag, message, status, onShown) {
        let line = {pt: performance.now(), tag, message: String(message), status, onShown};
        if (!this.replied) {
            this.early.push({line});
            return line;
        }
        this.queue.push(line);
        this.pump();
        return line;
    }

    pump() {
        if (this.actTwo || this.pumpTimer !== null) return;
        if (this.queue.length === 0) {
            this.checkReady();
            return;
        }
        let now = performance.now();
        let wait = this.forced ? 0 : Math.max(this.lastShownAt + 80 - now, this.startedAt + 320 - now);
        if (wait > 0) {
            this.pumpTimer = this.later(() => {
                this.pumpTimer = null;
                this.pump();
            }, wait);
            return;
        }
        this.show(this.queue.shift());
        this.pump();
    }

    setStatus(state, status) {
        let parts = this.statusParts[status];
        state.textContent = "";
        state.append(document.createTextNode(parts[0]), this.el("span", "vx-status-" + status, parts[1]), document.createTextNode(parts[2]));
    }

    show(line) {
        let status = this.statusParts[line.status] ? line.status : "ok";
        let t = Math.max(0, (typeof line.t === "number") ? line.t : Math.round(line.pt + this.offset));
        let row = this.el("div", (status === "fail") ? "vx-line vx-newest vx-fail" : "vx-line vx-newest");
        row.style.top = (this.shown * 16) + "px";
        line.state = this.el("span", "vx-line-status");
        this.setStatus(line.state, status);
        row.append(
            this.el("span", "vx-line-time", "[ " + (t / 1000).toFixed(3) + " ]"),
            this.el("span", "vx-line-tag", line.tag),
            this.el("span", "vx-line-msg", line.message),
            line.state
        );
        if (this.newest) this.newest.classList.remove("vx-newest");
        this.newest = row;
        this.list.appendChild(row);
        this.rows.push(row);
        if (this.rows.length > 61) this.rows.shift().remove();
        this.list.style.transform = "translateY(" + (-16 * this.shown) + "px)";
        this.shown++;
        if (status === "fail") this.problems++;
        this.linesCounter.textContent = String(this.shown).padStart(2, "0");
        this.timeCounter.textContent = t + " ms";
        this.lastShownAt = performance.now();
        line.shownAt = this.lastShownAt;
        this.sound((status === "fail") ? "error" : "stdout");
        if (line.onShown) line.onShown();
    }

    startChecks() {
        let settings = this.settings;
        let checks = [
            ["UI", "window.vindex", () => (typeof window.vindex.getBootEvents === "function") ? [["Preload bridge ready", "ok"]] : null],
            ["SECURITY", "document.querySelector", () => [document.querySelector("meta[http-equiv='Content-Security-Policy' i]") ? ["Content Security Policy present", "ok"] : ["Content Security Policy missing", "fail"]]],
            ["CONFIG", "settings.theme", () => [["Theme " + window.theme.name + " loaded", "ok"]]],
            ["CONFIG", "readKeyboardLayout", () => this.checkKeyboard()],
            ["AUDIO", "settings.audio", () => this.checkAudio()],
            ["GPU", "getContext", () => this.checkGPU()],
            ["FONTS", "document.fonts", () => this.checkFonts()],
            ["SENSORS", "navigator.getBattery", () => this.checkBattery()]
        ];
        this.checksLeft = checks.length;
        checks.forEach(([tag, name, task]) => this.check(tag, name, task));
    }

    check(tag, name, task) {
        let settled = false;
        let settle = lines => {
            if (settled) return;
            settled = true;
            if (!Array.isArray(lines)) lines = [["no answer from " + name, "fail"]];
            lines.forEach(([message, status]) => this.addLine(tag, message, status));
            this.checksLeft--;
            if (this.checksLeft > 0) return;
            this.building = this.addLine("UI", "Building interface", "pending");
            this.checksDone = true;
            this.checkReady();
        };
        this.expirers.push(() => settle(null));
        new Promise(resolve => resolve(task())).then(this.guard(settle), this.guard(() => settle(null)));
    }

    expire() {
        if (this.ready) return;
        this.forced = true;
        if (!this.replied) this.receiveAll(null);
        this.expirers.forEach(expire => expire());
        this.pump();
    }

    checkReady() {
        if (this.ready || !this.checksDone || !this.replied || this.queue.length > 0 || this.pumpTimer !== null || !this.building.state) return;
        let now = performance.now();
        let wait = this.forced ? 0 : Math.max(this.startedAt + 1800 - now, this.building.shownAt + 240 - now);
        if (wait > 0) {
            if (this.readyTimer === null) {
                this.readyTimer = this.later(() => {
                    this.readyTimer = null;
                    this.checkReady();
                }, wait);
            }
            return;
        }
        this.ready = true;
        this.setStatus(this.building.state, "ok");
        let onShown = () => this.onReady();
        if (this.problems === 0) {
            this.addLine("READY", "All systems online", "ok", onShown);
        } else {
            this.addLine("READY", "Started with " + this.problems + ((this.problems === 1) ? " problem" : " problems"), "warn", onShown);
        }
    }

    onReady() {
        this.play("granted");
        this.log("info", "Boot screen: " + this.shown + " lines, " + this.problems + " problems, ready at " + Math.round(performance.now() - this.startedAt) + " ms");
        this.later(() => this.startActTwo(), 260);
    }

    async checkKeyboard() {
        let name = this.settings.keyboard;
        let layout = null;
        if (typeof name === "string") {
            try {
                layout = await window.vindex.readKeyboardLayout(name);
            } catch(err) {
                layout = null;
            }
        }
        if (layout) return [["Keyboard layout " + name + " ready", "ok"]];
        return [["Keyboard layout " + String(name) + " could not be read", "fail"]];
    }

    checkAudio() {
        let settings = this.settings;
        if (settings.audio !== true) return [["Sound effects off", "info"]];
        let volume = Number.isFinite(settings.audioVolume) ? " · volume " + Math.round(settings.audioVolume * 100) + "%" : "";
        return [["Sound effects on" + volume, "info"]];
    }

    checkGPU() {
        let gl = document.createElement("canvas").getContext("webgl2");
        if (!gl) return [["WebGL 2 not available", "warn"]];
        let lines = [];
        let info = gl.getExtension("WEBGL_debug_renderer_info");
        let renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        if (typeof renderer === "string" && renderer !== "") lines.push([this.gpuName(renderer), "ok"]);
        lines.push(["WebGL 2 ready", "ok"]);
        let context = gl.getExtension("WEBGL_lose_context");
        if (context) context.loseContext();
        return lines;
    }

    gpuName(renderer) {
        let name = renderer;
        if (name.startsWith("ANGLE (") && name.endsWith(")")) {
            let parts = name.slice(7, -1).split(", ");
            name = (parts.length >= 2) ? parts[1] : parts[0];
        }
        name = name.replace(/ \(0x[0-9A-Fa-f]+\).*$/, "").replace(/ Direct3D.*$/, "").replace(/^ANGLE \w+ Renderer: /, "").replace(/\(R\)|\(TM\)|\(tm\)/g, "").replace(/\s+/g, " ").trim();
        if (name === "") name = renderer;
        return name.slice(0, 80);
    }

    async checkFonts() {
        let fonts = [
            ["Doto", "900 84px Doto"],
            ["Barlow Semi Condensed", "600 12px 'Barlow Semi Condensed'"],
            ["JetBrains Mono", "400 11px 'JetBrains Mono'"]
        ];
        await Promise.all(fonts.map(([name, font]) => document.fonts.load(font)));
        await document.fonts.ready;
        let missing = fonts.filter(([name, font]) => !document.fonts.check(font)).map(([name]) => name);
        if (missing.length === 0) return [["Doto · Barlow Semi Condensed · JetBrains Mono loaded", "ok"]];
        return [[missing.join(" · ") + " not loaded", "warn"]];
    }

    readBattery() {
        return new Promise(resolve => {
            let timer = setTimeout(() => resolve(null), 1000);
            let done = battery => {
                clearTimeout(timer);
                resolve(battery);
            };
            try {
                Promise.resolve(navigator.getBattery()).then(done, () => done(null));
            } catch(err) {
                done(null);
            }
        });
    }

    async checkBattery() {
        if (typeof navigator.getBattery !== "function") return [];
        let battery = await this.readBattery();
        if (!battery) return [];
        let level = battery.level;
        if (typeof level !== "number" || !(level >= 0 && level <= 1)) return [];
        let percent = Math.round(level * 100);
        if (battery.charging === false) return [["Battery " + percent + "% · on battery", "ok"]];
        if (battery.charging === true && level < 1) return [["Battery " + percent + "% · on AC power", "ok"]];
        return [];
    }

    startActTwo() {
        this.actTwo = true;
        this.act1.classList.add("vx-collapse");
        this.dimLeft.classList.add("vx-out");
        this.buildTitle();
        this.play("theme");
        this.later(() => this.play("scan"), 630);
        this.later(() => this.play("expand"), 1780);
        this.later(() => this.container.classList.add("vx-leaving"), 3400);
        this.later(() => this.finish(), 3900);
    }

    buildTitle() {
        this.stage.insertBefore(this.hidden(this.el("div", "vx-dim-title")), this.act1);
        let fragment = document.createDocumentFragment();

        let box = this.hidden(this.el("div", "vx-layer"));
        box.append(this.el("span", "vx-bar vx-bar-bottom"), this.el("span", "vx-bar vx-bar-top"));
        ["vx-bar-side vx-bar-left", "vx-bar-side vx-bar-right"].forEach(className => {
            let side = this.el("span", className);
            side.appendChild(this.el("span"));
            box.appendChild(side);
        });
        [[419, 280, 16, 2], [419, 280, 2, 16], [931, 280, 16, 2], [945, 280, 2, 16], [419, 422, 16, 2], [419, 408, 2, 16], [931, 422, 16, 2], [945, 408, 2, 16]].forEach(([left, top, width, height]) => {
            let arm = this.el("span", "vx-corner");
            arm.style.left = left + "px";
            arm.style.top = top + "px";
            arm.style.width = width + "px";
            arm.style.height = height + "px";
            box.appendChild(arm);
        });
        box.append(
            this.el("div", "vx-subtitle", "A FULLSCREEN TERMINAL WITH LIVE SYSTEM MONITORS"),
            this.el("div", "vx-title-version", "v" + (window.vindex.appVersion || "") + " · Electron " + window.vindex.electronVersion)
        );

        let logo = this.hidden(this.el("div", "vx-logo"));
        logo.appendChild(this.svg(72, [
            ["path", {class: "vx-logo-frame", d: "M1 1H23V23H1Z", fill: "none", stroke: "#3FD5C3", "stroke-width": "1.4", "stroke-linecap": "square", pathLength: "1"}],
            ["path", {class: "vx-logo-chevron", d: "M5.5 7.5L10 12L5.5 16.5", fill: "none", stroke: "#3FD5C3", "stroke-width": "2.2", pathLength: "1"}],
            ["path", {class: "vx-logo-cursor", d: "M12 16.5H18.5", fill: "none", stroke: "#3FD5C3", "stroke-width": "2.2"}]
        ]));

        let flash = this.hidden(this.el("div", "vx-flash"));
        flash.append(
            this.svg(72, [
                ["rect", {x: "1", y: "1", width: "22", height: "22", fill: "none", stroke: "#06110F", "stroke-width": "1.4"}],
                ["path", {d: "M5.5 7.5L10 12L5.5 16.5", fill: "none", stroke: "#06110F", "stroke-width": "2.2"}],
                ["path", {d: "M12 16.5H18.5", fill: "none", stroke: "#06110F", "stroke-width": "2.2"}]
            ]),
            this.el("span", "vx-wordmark", "VINDEX")
        );

        fragment.append(
            this.hidden(this.el("div", "vx-crt-line")),
            this.hidden(this.el("div", "vx-glow")),
            box,
            logo,
            this.buildDots(),
            this.el("h1", "vx-wordmark", "VINDEX"),
            flash
        );
        ["vx-tear-a", "vx-tear-b", "vx-tear-c", "vx-ghost-r", "vx-ghost-a"].forEach(className => {
            fragment.appendChild(this.hidden(this.el("span", "vx-wordmark " + className, "VINDEX")));
        });
        this.stage.appendChild(fragment);
    }

    buildDots() {
        let layer = this.hidden(this.el("div", "vx-layer"));
        let letters = [
            "#...# #...# #...# .#.#. .#.#. .#.#. ..#..",
            ".###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.",
            "#...# #...# ##..# #.#.# #..## #...# #...#",
            "####. .#..# .#..# .#..# .#..# .#..# ####.",
            "##### #.... #.... ####. #.... #.... #####",
            "#...# #...# .#.#. ..#.. .#.#. #...# #...#"
        ];
        letters.forEach((bitmap, k) => bitmap.split(" ").forEach((row, r) => row.split("").forEach((cell, c) => {
            if (cell !== "#") return;
            let left = 571.42 + 55.44 * k + 8.4 * c;
            let dot = this.el("span", "vx-dot");
            dot.style.left = left.toFixed(2) + "px";
            dot.style.top = (323.02 + 8.4 * r).toFixed(2) + "px";
            dot.style.setProperty("--h", (-this.randomInt(260, 560)) + "px");
            dot.style.setProperty("--delay", (630 + 10 * Math.round((left - 571) / 8.4) + this.randomInt(0, 90)) + "ms");
            dot.appendChild(this.el("span", "vx-dot-trail"));
            layer.appendChild(dot);
        })));
        return layer;
    }
}
