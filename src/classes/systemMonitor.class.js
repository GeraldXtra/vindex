class SystemMonitor {
    constructor() {
        this.failed = new Set();
        this.loadTick = 0;
        this.loadAnswered = 0;
        this.loadHistory = new Array(60).fill(null);
        this.threadCount = 0;
        this.threadHistory = [];
        this.threadRows = [];
        this.stripBars = null;
        this.cpuState = "waiting";
        this.cpuDetails = null;
        this.cpuAsking = false;
        this.systemRead = false;
        this.systemAsking = false;
        this.diskAsking = false;
        this.battery = {answered: false, present: null, percent: null, source: null, live: false};
        this.processCalls = 0;
        this.processSamples = 0;
        this.processBusy = false;
        this.processLive = false;
        this.processStartedAt = 0;
        this.processTimer = null;
        this.processFailed = false;
        this.processCount = null;
        this.processList = null;
        this.processNames = new Map();
        this.processRows = [];
        this.buildSystem();
        this.buildCpu();
        this.buildThreads(SystemMonitor.threadGuess());
        this.buildProcesses();
        this.renderCpuDetails();
    }

    static threadGuess() {
        let count = Math.round(Number(navigator.hardwareConcurrency));
        return (Number.isFinite(count) && count > 0) ? count : 1;
    }

    static element(tag, className, text) {
        let node = document.createElement(tag);
        if (className) node.className = className;
        if (typeof text === "string") node.textContent = text;
        return node;
    }

    static shape(tag, attributes) {
        let node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.keys(attributes).forEach(name => {
            node.setAttribute(name, attributes[name]);
        });
        return node;
    }

    static line(y, className) {
        return SystemMonitor.shape("line", {class: className, x1: "0", y1: String(y), x2: "328", y2: String(y), "vector-effect": "non-scaling-stroke"});
    }

    static ringTicks() {
        let path = "";
        for (let i = 0; i < 40; i++) {
            let angle = (i * 9 - 90) * Math.PI / 180;
            let inner = (i % 10 === 0) ? 25 : 27;
            path += "M" + (32 + inner * Math.cos(angle)).toFixed(2) + " " + (32 + inner * Math.sin(angle)).toFixed(2) + "L" + (32 + 29.5 * Math.cos(angle)).toFixed(2) + " " + (32 + 29.5 * Math.sin(angle)).toFixed(2);
        }
        return path;
    }

    static bars(values, width, height, top, gap) {
        let slot = width / values.length;
        let path = "";
        values.forEach((value, i) => {
            if (value === null) return;
            let size = Math.max(1, Math.min(value, top) / top * (height - 1));
            path += "M" + (i * slot + gap / 2).toFixed(2) + " " + (height - size).toFixed(2) + "h" + (slot - gap).toFixed(2) + "v" + size.toFixed(2) + "h" + (gap - slot).toFixed(2) + "z";
        });
        return path;
    }

    static scaleTop(values) {
        return values.every(value => value === null || value <= 50) ? 50 : 100;
    }

    static percent(value) {
        return (typeof value === "number" && Number.isFinite(value)) ? Math.max(0, Math.min(100, value)) : null;
    }

    static count(value) {
        return (Number.isInteger(value) && value > 0) ? value : null;
    }

    static threadsText(count) {
        return (count === 1) ? "1 thread" : count + " threads";
    }

    static shortCpuName(brand) {
        let name = brand.replace(/®|™|©|\((R|TM|C)\)/gi, " ")
            .replace(/@.*$/, " ")
            .replace(/\s+with\s+.*$/i, " ")
            .replace(/\b\d+-Core\s+Processor\b/gi, " ")
            .replace(/\b(Processor|CPU)\b/gi, " ")
            .replace(/^\s*(\d+(st|nd|rd|th)\s+)?Gen\b/i, " ")
            .replace(/\b(Intel|AMD)\b/gi, " ")
            .replace(/\bCore\s+(?=(i\d|Ultra)\b)/i, " ")
            .replace(/\s+/g, " ")
            .trim();
        return (name !== "") ? name : brand.replace(/\s+/g, " ").trim();
    }

    static isPlaceholder(text) {
        return /^(|-+|0+|n\/?a|none|null|undefined|unknown|computer|default string|system product name|system manufacturer|not applicable|not specified|invalid|o\.?e\.?m\.?|to be filled by o\.?e\.?m\.?|type1productconfigid|x\.x)$/i.test(text);
    }

    static cacheSize(bytes) {
        if (bytes < 1048576) return Math.round(bytes / 1024) + " KB";
        let text = (bytes / 1048576).toFixed(1);
        return (text.endsWith(".0") ? text.slice(0, -2) : text) + " MB";
    }

    static diskSize(bytes) {
        let gigabytes = Math.round(bytes / 1073741824);
        return (gigabytes >= 1024) ? (bytes / 1099511627776).toFixed(1) + " TB" : gigabytes + " GB";
    }

    static memorySize(kilobytes) {
        let megabytes = kilobytes / 1024;
        return (megabytes >= 999.5) ? (megabytes / 1024).toFixed(1) + " GB" : Math.round(megabytes) + " MB";
    }

    static processName(name) {
        let text = (typeof name === "string") ? name.trim().replace(/\.exe$/i, "") : "";
        return (text !== "") ? text : "?";
    }

    static setMeta(node, text) {
        node.textContent = text;
        node.hidden = text === "";
    }

    static ask(name) {
        try {
            return Promise.resolve(window.vindex.systeminformation(name)).then(result => result, () => null);
        } catch(err) {
            return Promise.resolve(null);
        }
    }

    static askMemory() {
        try {
            return Promise.resolve(window.vindex.getMemory()).then(result => result, () => null);
        } catch(err) {
            return Promise.resolve(null);
        }
    }

    guard(name, task) {
        try {
            task();
        } catch(err) {
            if (this.failed.has(name)) return;
            this.failed.add(name);
            window.vindex.log("error", "Could not update the " + name + ": " + String((err && err.message) || err));
        }
    }

    buildSystem() {
        let body = document.getElementById("vx-sys-body");
        let ticks = SystemMonitor.ringTicks();
        this.modelMeta = document.getElementById("vx-sys-model");
        this.rings = {};
        [["cpu", "CPU"], ["memory", "MEMORY"], ["disk", "DISK"], ["battery", "BATTERY"]].forEach(([key, label]) => {
            let cell = SystemMonitor.element("div", "vx-ring");
            let dial = SystemMonitor.element("div", "vx-ring-dial");
            let svg = SystemMonitor.shape("svg", {width: "64", height: "64", viewBox: "0 0 64 64", "aria-hidden": "true"});
            let arc = SystemMonitor.shape("circle", {class: "vx-ring-arc", cx: "32", cy: "32", r: "22", "stroke-dasharray": "0.00 138.23", transform: "rotate(-90 32 32)"});
            svg.append(SystemMonitor.shape("path", {class: "vx-ring-ticks", d: ticks}), SystemMonitor.shape("circle", {class: "vx-ring-track", cx: "32", cy: "32", r: "22"}), arc);
            let value = SystemMonitor.element("span", "vx-ring-value");
            let reading = SystemMonitor.element("span", "vx-ring-reading");
            let number = SystemMonitor.element("span", "vx-ring-number", "—");
            let unit = SystemMonitor.element("span", "vx-ring-unit", "%");
            unit.hidden = true;
            reading.append(number, unit);
            value.appendChild(reading);
            dial.append(svg, value);
            let name = SystemMonitor.element("span", "vx-ring-label", label);
            let sub = SystemMonitor.element("span", "vx-ring-sub", "");
            cell.append(dial, name, sub);
            body.appendChild(cell);
            this.rings[key] = {cell, arc, number, unit, name, sub};
        });
    }

    setRing(key, value, sub) {
        let ring = this.rings[key];
        let known = typeof value === "number" && Number.isFinite(value);
        let percent = known ? Math.max(0, Math.min(100, Math.round(value))) : 0;
        ring.number.textContent = known ? String(percent) : "—";
        ring.unit.hidden = !known;
        ring.arc.setAttribute("stroke-dasharray", (138.23 * percent / 100).toFixed(2) + " 138.23");
        ring.sub.textContent = sub;
    }

    buildCpu() {
        let body = document.getElementById("vx-cpu-body");
        this.cpuMeta = document.getElementById("vx-cpu-meta");
        let chart = SystemMonitor.element("div", "vx-cpu-chart");
        let svg = SystemMonitor.shape("svg", {viewBox: "0 0 328 34", preserveAspectRatio: "none", "aria-hidden": "true"});
        this.loadBars = SystemMonitor.shape("path", {class: "vx-chart-bars"});
        svg.append(SystemMonitor.line(0.5, "vx-chart-guide"), SystemMonitor.line(17, "vx-chart-guide"), this.loadBars, SystemMonitor.line(33.5, "vx-chart-base"));
        this.loadScale = SystemMonitor.element("span", "vx-cpu-scale", "50%");
        chart.append(svg, this.loadScale);
        let axis = SystemMonitor.element("div", "vx-cpu-axis");
        let now = SystemMonitor.element("span", null, "now · ");
        this.loadNow = SystemMonitor.element("span", "vx-cpu-now", "—");
        now.appendChild(this.loadNow);
        axis.append(SystemMonitor.element("span", null, "−60 s"), SystemMonitor.element("span", null, "−30 s"), now);
        this.threadBox = SystemMonitor.element("div", "vx-cpu-threads");
        this.cpuFoot = SystemMonitor.element("div", "vx-cpu-foot");
        body.append(chart, axis, this.threadBox, this.cpuFoot);
    }

    buildThreads(count) {
        this.threadCount = count;
        this.threadHistory = [];
        for (let i = 0; i < count; i++) {
            this.threadHistory.push(new Array(24).fill(null));
        }
        this.threadRows = [];
        this.stripBars = null;
        this.threadBox.textContent = "";
        if (count > 8) {
            this.threadBox.className = "vx-cpu-threads vx-cpu-strip";
            let svg = SystemMonitor.shape("svg", {viewBox: "0 0 328 43", preserveAspectRatio: "none", "aria-hidden": "true"});
            this.stripBars = SystemMonitor.shape("path", {class: "vx-chart-bars"});
            svg.append(SystemMonitor.line(0.5, "vx-chart-guide"), SystemMonitor.line(21.5, "vx-chart-guide"), this.stripBars, SystemMonitor.line(42.5, "vx-chart-base"));
            let axis = SystemMonitor.element("div", "vx-cpu-axis");
            axis.append(SystemMonitor.element("span", null, "T0"), SystemMonitor.element("span", null, count + " threads · now"), SystemMonitor.element("span", null, "T" + (count - 1)));
            this.threadBox.append(svg, axis);
            return;
        }
        this.threadBox.className = "vx-cpu-threads " + ((count > 4) ? "vx-cpu-grid" : "vx-cpu-rows");
        for (let i = 0; i < count; i++) {
            let row = SystemMonitor.element("div", "vx-cpu-thread");
            let svg = SystemMonitor.shape("svg", {viewBox: "0 0 100 12", preserveAspectRatio: "none", "aria-hidden": "true"});
            let bars = SystemMonitor.shape("path", {class: "vx-chart-bars"});
            svg.appendChild(bars);
            let value = SystemMonitor.element("span", "vx-cpu-thread-value", "—");
            row.append(SystemMonitor.element("span", "vx-cpu-thread-name", "T" + i), svg, value);
            this.threadBox.appendChild(row);
            this.threadRows.push({bars, value});
        }
    }

    buildProcesses() {
        this.processBody = document.getElementById("vx-proc-body");
        this.processMeta = document.getElementById("vx-proc-meta");
        this.processHead = SystemMonitor.element("div", "vx-proc-head");
        [["vx-proc-pid", "PID"], ["vx-proc-name", "NAME"], ["vx-proc-load", "LOAD"], ["vx-proc-cpu", "CPU"], ["vx-proc-mem", "MEM"]].forEach(([className, text]) => {
            this.processHead.appendChild(SystemMonitor.element("span", className, text));
        });
        this.processBox = SystemMonitor.element("div", "vx-proc-rows");
        this.processNote = SystemMonitor.element("div", "vx-proc-note", "READING PROCESSES");
        this.processBox.appendChild(this.processNote);
        this.processBody.append(this.processHead, this.processBox);
        new ResizeObserver(() => {
            this.guard("process list", () => this.renderProcesses());
        }).observe(this.processBody);
    }

    start() {
        this.sampleLoad();
        setInterval(() => this.sampleLoad(), 1000);
        this.readCpu();
        this.readSystem();
        this.readDisk();
        this.readBattery();
        this.watchBattery();
        setInterval(() => {
            this.readCpu();
            this.readSystem();
            this.readDisk();
            if (!this.battery.live || this.battery.present === null) this.readBattery();
        }, 60000);
        this.pollProcesses();
    }

    startProcesses() {
        if (this.processLive) return;
        this.processLive = true;
        if (!this.processBusy) this.scheduleProcesses(Math.max(500, this.processStartedAt + 5000 - performance.now()));
    }

    sampleLoad() {
        if (this.loadAnswered < this.loadTick) this.guard("CPU panel", () => this.renderLoad());
        let tick = ++this.loadTick;
        this.loadHistory.shift();
        this.loadHistory.push(null);
        this.threadHistory.forEach(list => {
            list.shift();
            list.push(null);
        });
        SystemMonitor.ask("currentLoad").then(data => {
            if (tick !== this.loadTick) return;
            this.loadAnswered = tick;
            this.guard("CPU panel", () => this.takeLoad(data));
        });
        SystemMonitor.askMemory().then(data => {
            this.guard("system panel", () => this.takeMemory(data));
        });
    }

    takeLoad(data) {
        let cpus = (data && Array.isArray(data.cpus) && data.cpus.length > 0) ? data.cpus : null;
        if (cpus && cpus.length !== this.threadCount) {
            this.buildThreads(cpus.length);
            this.renderCpuDetails();
        }
        this.loadHistory[59] = data ? SystemMonitor.percent(data.currentLoad) : null;
        if (cpus) {
            cpus.forEach((item, i) => {
                this.threadHistory[i][23] = SystemMonitor.percent(item && item.load);
            });
        }
        this.renderLoad();
    }

    renderLoad() {
        let top = SystemMonitor.scaleTop(this.loadHistory);
        this.loadBars.setAttribute("d", SystemMonitor.bars(this.loadHistory, 328, 34, top, 1.6));
        this.loadScale.textContent = top + "%";
        let now = this.loadHistory[59];
        this.loadNow.textContent = (now === null) ? "—" : Math.round(now) + "%";
        this.setRing("cpu", now, this.cpuSpeedText());
        let threadTop = SystemMonitor.scaleTop([].concat(...this.threadHistory));
        if (this.stripBars) {
            let latest = this.threadHistory.map(list => list[23]);
            this.stripBars.setAttribute("d", SystemMonitor.bars(latest, 328, 43, threadTop, Math.min(4, 328 / latest.length * 0.3)));
            return;
        }
        this.threadRows.forEach((row, i) => {
            let list = this.threadHistory[i];
            row.bars.setAttribute("d", SystemMonitor.bars(list, 100, 12, threadTop, 1.4));
            row.value.textContent = (list[23] === null) ? "—" : Math.round(list[23]) + "%";
        });
    }

    takeMemory(data) {
        let total = data ? Number(data.total) : NaN;
        let free = data ? Number(data.free) : NaN;
        if (!(total > 0) || !(free >= 0) || free > total) return;
        let used = total - free;
        let size = 1073741824;
        let ring = this.rings.memory;
        this.setRing("memory", used / total * 100, (used / size).toFixed(1) + " / " + (total / size).toFixed(1) + " GB");
        if (ring.sub.offsetWidth > ring.cell.clientWidth + 8) ring.sub.textContent = (used / size).toFixed(1) + "/" + (total / size).toFixed(1) + " GB";
    }

    readCpu() {
        if (this.cpuState === "ready" || this.cpuAsking) return;
        this.cpuAsking = true;
        SystemMonitor.ask("cpu").then(data => {
            this.cpuAsking = false;
            this.guard("CPU panel", () => this.takeCpu(data));
        });
    }

    takeCpu(data) {
        let brand = (data && typeof data.brand === "string") ? data.brand.trim() : "";
        if (brand === "" || brand.toLowerCase() === "unknown") {
            if (this.cpuState === "waiting") this.cpuState = "failed";
        } else {
            this.cpuState = "ready";
            this.cpuDetails = {
                name: SystemMonitor.shortCpuName(brand),
                cores: SystemMonitor.count(data.physicalCores),
                threads: SystemMonitor.count(data.cores),
                speed: (typeof data.speed === "number" && Number.isFinite(data.speed) && data.speed > 0) ? data.speed : null,
                cache: (data.cache && typeof data.cache.l3 === "number" && Number.isFinite(data.cache.l3) && data.cache.l3 > 0) ? data.cache.l3 : null
            };
        }
        this.renderCpuDetails();
    }

    cpuSpeedText() {
        if (this.cpuState === "waiting") return "";
        if (this.cpuState === "ready" && this.cpuDetails.speed !== null) return this.cpuDetails.speed.toFixed(2) + " GHz";
        return SystemMonitor.threadsText(this.threadCount);
    }

    renderCpuDetails() {
        let meta = "";
        if (this.cpuState === "ready") {
            let details = this.cpuDetails;
            let threads = details.threads || this.threadCount;
            let layout = (details.cores ? details.cores + "C/" : "") + threads + "T";
            meta = details.name + " · " + layout;
        } else if (this.cpuState === "failed") {
            meta = SystemMonitor.threadsText(this.threadCount);
        }
        SystemMonitor.setMeta(this.cpuMeta, meta);
        this.rings.cpu.sub.textContent = this.cpuSpeedText();
        this.renderFoot();
    }

    renderFoot() {
        let items = [];
        if (this.cpuState === "ready" && this.cpuDetails.speed !== null) items.push(["BASE " + this.cpuDetails.speed.toFixed(2) + " GHz", null]);
        if (this.cpuState === "ready" && this.cpuDetails.cache !== null) items.push(["L3 " + SystemMonitor.cacheSize(this.cpuDetails.cache), null]);
        if (this.processCount !== null) items.push([this.processCount + " PROC", "vx-cpu-procs"]);
        this.cpuFoot.textContent = "";
        items.forEach(([text, className]) => {
            this.cpuFoot.appendChild(SystemMonitor.element("span", className, text));
        });
    }

    readSystem() {
        if (this.systemRead || this.systemAsking) return;
        this.systemAsking = true;
        SystemMonitor.ask("system").then(data => {
            this.systemAsking = false;
            this.guard("system panel", () => {
                if (!data) return;
                this.systemRead = true;
                let model = (typeof data.model === "string") ? data.model.replace(/\s+/g, " ").trim() : "";
                SystemMonitor.setMeta(this.modelMeta, SystemMonitor.isPlaceholder(model) ? "" : model);
            });
        });
    }

    readDisk() {
        if (this.diskAsking) return;
        this.diskAsking = true;
        SystemMonitor.ask("fsSize").then(list => {
            this.diskAsking = false;
            this.guard("system panel", () => this.takeDisk(list));
        });
    }

    takeDisk(list) {
        if (!Array.isArray(list)) return;
        let disks = list.filter(item => item && typeof item.mount === "string" && item.mount !== "" && typeof item.size === "number" && item.size > 0 && typeof item.used === "number" && item.used >= 0);
        if (disks.length === 0) return;
        let wanted = (window.vindex.platform === "win32") ? "C:" : "/";
        let disk = disks.find(item => item.mount.toUpperCase() === wanted) || disks[0];
        let type = (typeof disk.type === "string") ? disk.type.trim() : "";
        this.rings.disk.name.textContent = "DISK " + disk.mount;
        this.setRing("disk", disk.used / disk.size * 100, (type !== "") ? type : SystemMonitor.diskSize(disk.size));
    }

    readBattery() {
        SystemMonitor.ask("battery").then(data => {
            this.guard("system panel", () => {
                this.battery.answered = true;
                if (data && typeof data.hasBattery === "boolean") {
                    this.battery.present = data.hasBattery;
                    if (data.hasBattery && !this.battery.live) {
                        this.battery.percent = (typeof data.percent === "number" && Number.isFinite(data.percent)) ? data.percent : null;
                        this.battery.source = (data.isCharging === true) ? "charging" : ((data.acConnected === true) ? "ac" : "battery");
                    }
                }
                this.renderBattery();
            });
        });
    }

    watchBattery() {
        if (typeof navigator.getBattery !== "function") return;
        let reading;
        try {
            reading = Promise.resolve(navigator.getBattery()).catch(() => null);
        } catch(err) {
            return;
        }
        reading.then(manager => {
            if (!manager || typeof manager.addEventListener !== "function") return;
            let update = () => {
                this.guard("system panel", () => {
                    let level = manager.level;
                    if (typeof level !== "number" || !(level >= 0 && level <= 1)) return;
                    this.battery.live = true;
                    this.battery.percent = level * 100;
                    this.battery.source = (manager.charging === true) ? ((level < 1) ? "charging" : "ac") : "battery";
                    this.renderBattery();
                });
            };
            update();
            manager.addEventListener("levelchange", update);
            manager.addEventListener("chargingchange", update);
        });
    }

    renderBattery() {
        if (!this.battery.answered) return;
        if (this.battery.present === false) {
            this.setRing("battery", null, "No battery");
            return;
        }
        let sub = {charging: "Charging", ac: "AC power", battery: "On battery"}[this.battery.source] || "";
        this.setRing("battery", this.battery.percent, (this.battery.percent === null) ? "" : sub);
    }

    pollProcesses() {
        if (this.processBusy || (!this.processLive && this.processCalls > 0)) return;
        this.processBusy = true;
        this.processCalls += 1;
        this.processStartedAt = performance.now();
        SystemMonitor.ask("processes").then(data => {
            this.processBusy = false;
            this.guard("process list", () => this.takeProcesses(data));
            if (this.processLive) this.scheduleProcesses(Math.max(1000, this.processStartedAt + 5000 - performance.now()));
        });
    }

    scheduleProcesses(delay) {
        clearTimeout(this.processTimer);
        this.processTimer = setTimeout(() => this.pollProcesses(), delay);
    }

    takeProcesses(data) {
        if (!data || !Array.isArray(data.list)) {
            this.processFailed = true;
            this.renderProcesses();
            return;
        }
        this.processFailed = false;
        this.processSamples += 1;
        let list = data.list.filter(item => item && Number.isInteger(item.pid) && item.pid > 0);
        this.processNames = new Map(list.map(item => [item.pid, SystemMonitor.processName(item.name)]));
        this.processCount = list.length;
        SystemMonitor.setMeta(this.processMeta, list.length + " · sort CPU");
        this.renderFoot();
        if (this.processSamples >= 2) {
            this.processList = list.map(item => ({
                pid: item.pid,
                name: SystemMonitor.processName(item.name),
                cpu: (typeof item.cpu === "number" && Number.isFinite(item.cpu)) ? Math.max(0, item.cpu) : 0,
                memory: (typeof item.memRss === "number" && Number.isFinite(item.memRss)) ? Math.max(0, item.memRss) : 0
            })).sort((a, b) => (b.cpu - a.cpu) || (b.memory - a.memory) || (a.pid - b.pid));
        }
        this.renderProcesses();
    }

    renderProcesses() {
        if (this.processList === null) {
            this.setProcessRows(0);
            this.processNote.textContent = this.processFailed ? "PROCESS LIST UNAVAILABLE" : "READING PROCESSES";
            this.processNote.hidden = false;
            return;
        }
        this.processNote.hidden = true;
        let shown = this.processList.slice(0, Math.max(0, Math.floor((this.processBody.clientHeight - this.processHead.offsetHeight) / 17)));
        let top = shown.reduce((max, item) => Math.max(max, item.cpu), 0);
        this.setProcessRows(shown.length);
        shown.forEach((item, i) => {
            let row = this.processRows[i];
            row.pid.textContent = String(item.pid);
            row.name.textContent = item.name;
            row.fill.style.width = ((top > 0) ? item.cpu / top * 100 : 0).toFixed(1) + "%";
            row.cpu.textContent = (item.cpu >= 99.95) ? "100%" : item.cpu.toFixed(1) + "%";
            row.memory.textContent = SystemMonitor.memorySize(item.memory);
        });
    }

    setProcessRows(count) {
        while (this.processRows.length < count) {
            let row = SystemMonitor.element("div", "vx-proc-row");
            let pid = SystemMonitor.element("span", "vx-proc-pid");
            let name = SystemMonitor.element("span", "vx-proc-name");
            let load = SystemMonitor.element("span", "vx-proc-load");
            let fill = SystemMonitor.element("span", "vx-proc-fill");
            load.appendChild(fill);
            let cpu = SystemMonitor.element("span", "vx-proc-cpu");
            let memory = SystemMonitor.element("span", "vx-proc-mem");
            row.append(pid, name, load, cpu, memory);
            this.processBox.appendChild(row);
            this.processRows.push({row, pid, name, fill, cpu, memory});
        }
        while (this.processRows.length > count) {
            this.processRows.pop().row.remove();
        }
    }
}
