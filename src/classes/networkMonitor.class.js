class NetworkMonitor {
    constructor() {
        this.failed = new Set();
        this.points = [];
        this.sample = null;
        this.link = null;
        this.trafficState = "waiting";
        this.trafficCalls = 0;
        this.trafficStartedAt = 0;
        this.trafficFailures = 0;
        this.connectionsLive = false;
        this.connectionsBusy = false;
        this.connectionsCalls = 0;
        this.connectionsFailures = 0;
        this.connectionsStartedAt = 0;
        this.connectionsTimer = null;
        this.connectionsState = "waiting";
        this.groups = [];
        this.established = 0;
        this.listening = 0;
        this.firstSeen = new Map();
        this.names = new Map();
        this.nameTried = new Set();
        this.namesBusy = false;
        this.namesAskedAt = null;
        this.namesCalls = 0;
        this.places = new Map();
        this.placesBusy = false;
        this.placesCalls = 0;
        this.home = null;
        this.view = {lat: 25, lon: -20};
        this.latencyOn = Boolean(window.settings && window.settings.latencyCheck === true);
        this.latencyBusy = false;
        this.latencyTimer = null;
        this.latencyCalls = 0;
        this.latencyResults = [];
        this.buildPanel();
        this.renderTraffic();
        this.renderLatency();
        this.renderConnections();
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
        return NetworkMonitor.shape("line", {class: className, x1: "0", y1: String(y), x2: "328", y2: String(y), "vector-effect": "non-scaling-stroke"});
    }

    static f2(value) {
        return value.toFixed(2);
    }

    static call(task) {
        try {
            return Promise.resolve(task()).then(result => result, () => null);
        } catch(err) {
            return Promise.resolve(null);
        }
    }

    static ask(name) {
        return NetworkMonitor.call(() => window.vindex.systeminformation(name));
    }

    static scaleFor(peak) {
        let units = [1e3, 1e6, 1e9];
        for (let u = 0; u < units.length; u++) {
            for (let step = 1; step <= 512; step *= 2) {
                let scale = step * units[u];
                if (scale >= 16000 && scale >= peak) return scale;
            }
        }
        return 512e9;
    }

    static rateUnit(scale) {
        if (scale >= 1e9) return {size: 1e9, name: "GB/s"};
        if (scale >= 1e6) return {size: 1e6, name: "MB/s"};
        return {size: 1e3, name: "KB/s"};
    }

    static rateNumber(value) {
        if (value >= 99.95) return String(Math.round(value));
        if (value >= 9.995) return value.toFixed(1);
        return value.toFixed(2);
    }

    static speedText(bits) {
        if (typeof bits !== "number" || !Number.isFinite(bits) || bits <= 0) return "";
        if (bits >= 1e9) {
            let value = bits / 1e9;
            return ((Math.abs(value - Math.round(value)) < 0.05) ? String(Math.round(value)) : value.toFixed(1)) + " Gbps";
        }
        if (bits >= 1e6) return Math.round(bits / 1e6) + " Mbps";
        if (bits >= 1e3) return Math.round(bits / 1e3) + " Kbps";
        return Math.round(bits) + " bps";
    }

    static linkKind(link) {
        if ([6, 26, 62, 69, 117].includes(link.type)) return "Ethernet";
        if (link.type === 71) return "Wi-Fi";
        if (link.type === 243 || link.type === 244) return "Mobile";
        return link.name;
    }

    static isPublic(address) {
        if (typeof address !== "string") return false;
        let v4 = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (v4) {
            let a = Number(v4[1]);
            let b = Number(v4[2]);
            let c = Number(v4[3]);
            if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
            if (a === 100 && b >= 64 && b <= 127) return false;
            if (a === 169 && b === 254) return false;
            if (a === 172 && b >= 16 && b <= 31) return false;
            if (a === 192 && b === 168) return false;
            if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
            if (a === 198 && (b === 18 || b === 19)) return false;
            if (a === 198 && b === 51 && c === 100) return false;
            if (a === 203 && b === 0 && c === 113) return false;
            return true;
        }
        let text = address.toLowerCase();
        if (!/^[0-9a-f:.]+$/.test(text) || !text.includes(":")) return false;
        let mapped = text.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (mapped) {
            let high = parseInt(mapped[1], 16);
            let low = parseInt(mapped[2], 16);
            return NetworkMonitor.isPublic([high >> 8, high & 255, low >> 8, low & 255].join("."));
        }
        let dotted = text.match(/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/);
        if (dotted) return NetworkMonitor.isPublic(dotted[1]);
        let groups = text.split(":");
        if (groups[0] === "64" && groups[1] === "ff9b") return true;
        let first = (groups[0] === "") ? 0 : parseInt(groups[0], 16);
        let second = (groups[1] === "" || groups[1] === undefined) ? 0 : parseInt(groups[1], 16);
        if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return false;
        if (first === 0x2001 && second === 0xdb8) return false;
        if (first === 0x3fff && second < 0x1000) return false;
        return true;
    }

    static processName(pid) {
        let monitor = window.systemMonitor;
        let names = (monitor && monitor.processNames instanceof Map) ? monitor.processNames : null;
        return (names !== null && names.has(pid)) ? names.get(pid) : "?";
    }

    static place(value) {
        if (!value || typeof value !== "object" || typeof value.country !== "string" || !/^[A-Z]{2}$/.test(value.country)) return null;
        let point = typeof value.latitude === "number" && typeof value.longitude === "number" && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180;
        return {country: value.country, latitude: point ? value.latitude : null, longitude: point ? value.longitude : null};
    }

    static viewFor(home) {
        let lat = Math.max(-40, Math.min(40, home.lat + 15));
        let lon = home.lon - 25;
        if (lon < -180) lon += 360;
        return {lat, lon};
    }

    static project(view, lat, lon) {
        let deg = Math.PI / 180;
        let lat0 = view.lat * deg;
        let lon0 = view.lon * deg;
        let la = lat * deg;
        let lo = lon * deg - lon0;
        let x = Math.cos(la) * Math.sin(lo);
        let y = Math.cos(lat0) * Math.sin(la) - Math.sin(lat0) * Math.cos(la) * Math.cos(lo);
        let z = Math.sin(lat0) * Math.sin(la) + Math.cos(lat0) * Math.cos(la) * Math.cos(lo);
        return {x: 60 + 44 * x, y: 60 - 44 * y, z};
    }

    static globeTicks() {
        let deg = Math.PI / 180;
        let f2 = NetworkMonitor.f2;
        let path = "";
        for (let i = 0; i < 72; i++) {
            let angle = i * 5 * deg;
            let inner = (i % 18 === 0) ? 48.5 : ((i % 2 === 0) ? 51.5 : 53);
            path += "M" + f2(60 + inner * Math.cos(angle)) + " " + f2(60 + inner * Math.sin(angle)) + "L" + f2(60 + 55 * Math.cos(angle)) + " " + f2(60 + 55 * Math.sin(angle));
        }
        return path;
    }

    static setValue(stat, number, unit, off) {
        stat.num.textContent = number;
        stat.unit.textContent = unit;
        stat.value.classList.toggle("vx-net-off", off === true);
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

    buildPanel() {
        this.meta = document.getElementById("vx-net-meta");
        this.metaDot = NetworkMonitor.element("span", "vx-net-dot");
        this.metaDot.setAttribute("aria-hidden", "true");
        this.metaText = NetworkMonitor.element("span", "vx-net-link");
        this.meta.append(this.metaDot, this.metaText);

        let body = document.getElementById("vx-net-body");
        let chart = NetworkMonitor.element("div", "vx-net-chart");
        let graph = NetworkMonitor.shape("svg", {"aria-hidden": "true", viewBox: "0 0 328 36", preserveAspectRatio: "none"});
        this.area = NetworkMonitor.shape("path", {class: "vx-net-area", d: ""});
        this.txLine = NetworkMonitor.shape("polyline", {class: "vx-net-tx", points: "", "vector-effect": "non-scaling-stroke"});
        this.rxLine = NetworkMonitor.shape("polyline", {class: "vx-net-rx", points: "", "vector-effect": "non-scaling-stroke"});
        graph.append(NetworkMonitor.line(0.5, "vx-chart-guide"), NetworkMonitor.line(18, "vx-chart-guide"), this.area, this.txLine, this.rxLine, NetworkMonitor.line(35.5, "vx-chart-base"));
        this.scaleLabel = NetworkMonitor.element("span", "vx-net-scale");
        chart.append(graph, this.scaleLabel);

        let stats = NetworkMonitor.element("div", "vx-net-stats");
        this.down = this.buildStat(stats, "DOWN", "vx-net-key vx-net-key-rx");
        this.up = this.buildStat(stats, "UP", "vx-net-key vx-net-key-tx");
        this.delay = this.buildStat(stats, "LATENCY", null);
        this.jitter = this.buildStat(stats, "JITTER · LOSS", null);

        let row = NetworkMonitor.element("div", "vx-net-globe-row");
        this.globe = NetworkMonitor.shape("svg", {class: "vx-globe", role: "img", "aria-label": "Globe showing 0 active connections", viewBox: "0 0 120 120"});
        this.gridFar = NetworkMonitor.shape("path", {class: "vx-globe-far", d: ""});
        this.gridMid = NetworkMonitor.shape("path", {class: "vx-globe-mid", d: ""});
        this.gridNear = NetworkMonitor.shape("path", {class: "vx-globe-near", d: ""});
        this.arcs = NetworkMonitor.shape("path", {class: "vx-globe-arcs", d: ""});
        this.ends = NetworkMonitor.shape("path", {class: "vx-globe-ends", d: ""});
        this.homeRing = NetworkMonitor.shape("circle", {class: "vx-globe-home-ring", cx: "60", cy: "60", r: "4.5", hidden: ""});
        this.homeDot = NetworkMonitor.shape("circle", {class: "vx-globe-home", cx: "60", cy: "60", r: "2", hidden: ""});
        let sweep = -35 * Math.PI / 180;
        this.globe.append(
            NetworkMonitor.shape("circle", {class: "vx-globe-rim", cx: "60", cy: "60", r: "57"}),
            NetworkMonitor.shape("path", {class: "vx-globe-ticks", d: NetworkMonitor.globeTicks()}),
            NetworkMonitor.shape("circle", {class: "vx-globe-disc", cx: "60", cy: "60", r: "44"}),
            this.gridFar,
            this.gridMid,
            this.gridNear,
            NetworkMonitor.shape("path", {class: "vx-globe-sweep", d: "M60 60L" + NetworkMonitor.f2(60 + 44 * Math.cos(sweep)) + " " + NetworkMonitor.f2(60 + 44 * Math.sin(sweep))}),
            this.arcs,
            this.ends,
            this.homeRing,
            this.homeDot
        );

        let column = NetworkMonitor.element("div", "vx-net-conns");
        let head = NetworkMonitor.element("div", "vx-net-conns-head");
        this.count = NetworkMonitor.element("span", "vx-net-count");
        head.append(NetworkMonitor.element("span", "vx-net-conns-title", "CONNECTIONS"), this.count);
        this.note = NetworkMonitor.element("div", "vx-net-note");
        this.list = NetworkMonitor.element("div", "vx-net-list");
        this.connectionRows = [];
        column.append(head, this.note, this.list);
        row.append(this.globe, column);

        body.append(chart, stats, row);
        this.drawGrid();
    }

    buildStat(parent, label, keyClass) {
        let cell = NetworkMonitor.element("div", "vx-net-stat");
        let title = NetworkMonitor.element("span", "vx-net-label");
        if (keyClass) {
            let key = NetworkMonitor.element("span", keyClass);
            key.setAttribute("aria-hidden", "true");
            title.appendChild(key);
        }
        title.appendChild(document.createTextNode(label));
        let value = NetworkMonitor.element("span", "vx-net-value");
        let num = NetworkMonitor.element("span", "vx-net-num");
        let unit = NetworkMonitor.element("span", "vx-net-unit");
        value.append(num, unit);
        cell.append(title, value);
        parent.appendChild(cell);
        return {value, num, unit};
    }

    start() {
        this.pollTraffic();
        this.askHome();
    }

    startConnections() {
        if (this.connectionsLive) return;
        this.connectionsLive = true;
        clearTimeout(this.connectionsTimer);
        this.connectionsTimer = setTimeout(() => this.pollConnections(), 1500);
        this.startLatency();
    }

    static inIntro() {
        let app = document.getElementById("vx-app");
        return app !== null && app.classList.contains("vx-intro");
    }

    pollTraffic() {
        if (NetworkMonitor.inIntro()) {
            setTimeout(() => this.pollTraffic(), 250);
            return;
        }
        let started = performance.now();
        this.trafficCalls += 1;
        this.trafficStartedAt = started;
        NetworkMonitor.ask("netTraffic").then(data => {
            this.guard("network traffic", () => this.takeTraffic(data));
            setTimeout(() => this.pollTraffic(), Math.max(250, started + 1000 - performance.now()));
        });
    }

    chooseLink(data) {
        let list = data.list.filter(item => item && typeof item.name === "string" && Array.isArray(item.ipv4) && typeof item.rx === "number" && typeof item.tx === "number");
        let wanted = (window.settings && typeof window.settings.iface === "string") ? window.settings.iface : "";
        if (wanted !== "") {
            let named = list.find(item => item.name === wanted);
            if (named) return named;
        }
        if (typeof data.route === "string" && data.route !== "") {
            let routed = list.find(item => item.ipv4.includes(data.route));
            if (routed) return routed;
        }
        let gateways = list.filter(item => item.gateway === true);
        if (gateways.length === 0) return null;
        return gateways.sort((a, b) => (Number(b.ipv4.length > 0) - Number(a.ipv4.length > 0)) || ((Number(b.speed) || 0) - (Number(a.speed) || 0)) || (b.rx - a.rx))[0];
    }

    takeTraffic(data) {
        if (!data || typeof data.at !== "number" || !Number.isFinite(data.at) || !Array.isArray(data.list)) {
            this.trafficFailures += 1;
            if (this.trafficState !== "live" || this.trafficFailures >= 3) {
                this.trafficState = "failed";
                this.link = null;
                this.sample = null;
                this.points = [];
            }
            this.renderTraffic();
            return;
        }
        this.trafficFailures = 0;
        let link = this.chooseLink(data);
        if (link === null) {
            this.trafficState = "offline";
            this.link = null;
            this.sample = null;
            this.points = [];
            this.renderTraffic();
            return;
        }
        this.trafficState = "live";
        let previous = this.sample;
        this.link = link;
        this.sample = {name: link.name, at: data.at, rx: link.rx, tx: link.tx};
        if (previous !== null && previous.name === link.name) {
            let seconds = data.at - previous.at;
            let received = link.rx - previous.rx;
            let sent = link.tx - previous.tx;
            if (seconds >= 0.2 && seconds <= 30 && received >= 0 && sent >= 0) {
                let count = Math.max(1, Math.min(48, Math.round(seconds)));
                for (let i = 0; i < count; i++) this.points.push({rx: received / seconds, tx: sent / seconds});
                if (this.points.length > 48) this.points.splice(0, this.points.length - 48);
            }
        } else if (previous !== null) {
            this.points = [];
        }
        this.renderTraffic();
    }

    renderTraffic() {
        this.renderMeta();
        let peak = this.points.reduce((max, point) => Math.max(max, point.rx, point.tx), 0);
        let scale = NetworkMonitor.scaleFor(peak);
        let unit = NetworkMonitor.rateUnit(scale);
        this.scaleLabel.textContent = (scale / unit.size) + " " + unit.name;
        this.drawChart(scale);
        let latest = (this.trafficState === "live" && this.points.length > 0) ? this.points[this.points.length - 1] : null;
        if (latest === null) {
            NetworkMonitor.setValue(this.down, "—", "", false);
            NetworkMonitor.setValue(this.up, "—", "", false);
            return;
        }
        NetworkMonitor.setValue(this.down, NetworkMonitor.rateNumber(latest.rx / unit.size), " " + unit.name, false);
        NetworkMonitor.setValue(this.up, NetworkMonitor.rateNumber(latest.tx / unit.size), " " + unit.name, false);
    }

    renderMeta() {
        let text = "";
        let down = false;
        if (this.trafficState === "live" && this.link !== null) {
            let speed = NetworkMonitor.speedText(this.link.speed);
            text = NetworkMonitor.linkKind(this.link) + ((speed === "") ? "" : " · " + speed);
        } else if (this.trafficState === "offline") {
            text = "Offline";
            down = true;
        } else if (this.trafficState === "failed") {
            text = "Unavailable";
            down = true;
        }
        this.metaText.textContent = text;
        this.meta.classList.toggle("vx-net-down", down);
        this.meta.hidden = text === "";
    }

    drawChart(scale) {
        let count = this.points.length;
        if (count === 0) {
            this.area.setAttribute("d", "");
            this.rxLine.setAttribute("points", "");
            this.txLine.setAttribute("points", "");
            return;
        }
        let f2 = NetworkMonitor.f2;
        let spot = (value, i) => [(i + 48 - count) * 328 / 47, 35 - Math.min(value, scale) / scale * 33];
        let rx = this.points.map((point, i) => spot(point.rx, i));
        let tx = this.points.map((point, i) => spot(point.tx, i));
        this.area.setAttribute("d", "M" + f2(rx[0][0]) + " 36" + rx.map(p => "L" + f2(p[0]) + " " + f2(p[1])).join("") + "L328 36Z");
        this.rxLine.setAttribute("points", rx.map(p => f2(p[0]) + "," + f2(p[1])).join(" "));
        this.txLine.setAttribute("points", tx.map(p => f2(p[0]) + "," + f2(p[1])).join(" "));
    }

    startLatency() {
        if (!this.latencyOn || this.latencyTimer !== null) return;
        this.probeLatency();
        this.latencyTimer = setInterval(() => this.probeLatency(), 2000);
    }

    probeLatency() {
        if (this.latencyBusy) return;
        let address = (this.link !== null && this.link.ipv4.length > 0) ? this.link.ipv4[0] : "";
        if (address === "") {
            this.guard("network latency", () => this.renderLatency());
            return;
        }
        let setting = (window.settings && typeof window.settings.pingAddr === "string") ? window.settings.pingAddr.trim() : "";
        let target = (setting !== "") ? setting : "1.1.1.1";
        this.latencyBusy = true;
        this.latencyCalls += 1;
        NetworkMonitor.call(() => window.vindex.ping(target, address)).then(time => {
            this.latencyBusy = false;
            this.latencyResults.push((typeof time === "number" && Number.isFinite(time) && time >= 0) ? time : null);
            if (this.latencyResults.length > 30) this.latencyResults.shift();
            this.guard("network latency", () => this.renderLatency());
        });
    }

    renderLatency() {
        if (!this.latencyOn) {
            NetworkMonitor.setValue(this.delay, "off", "", true);
            NetworkMonitor.setValue(this.jitter, "off", "", true);
            return;
        }
        let results = this.latencyResults;
        if (this.link === null || results.length === 0) {
            NetworkMonitor.setValue(this.delay, "—", "", false);
            NetworkMonitor.setValue(this.jitter, "—", "", false);
            return;
        }
        let good = results.filter(time => time !== null);
        let last = (good.length > 0) ? good[good.length - 1] : null;
        let loss = Math.round((results.length - good.length) / results.length * 100);
        let swings = [];
        for (let i = 1; i < good.length; i++) swings.push(Math.abs(good[i] - good[i - 1]));
        let jitter = (swings.length > 0) ? Math.round(swings.reduce((sum, value) => sum + value, 0) / swings.length) : null;
        NetworkMonitor.setValue(this.delay, (last === null) ? "—" : String(Math.round(last)), (last === null) ? "" : " ms", false);
        NetworkMonitor.setValue(this.jitter, (jitter === null) ? "—" : String(jitter), ((jitter === null) ? " · " : " ms · ") + loss + "%", false);
    }

    pollConnections() {
        if (this.connectionsBusy) return;
        this.connectionsBusy = true;
        this.connectionsCalls += 1;
        this.connectionsStartedAt = performance.now();
        NetworkMonitor.ask("netConnections").then(data => {
            this.connectionsBusy = false;
            this.guard("connection list", () => this.takeConnections(data));
            clearTimeout(this.connectionsTimer);
            this.connectionsTimer = setTimeout(() => this.pollConnections(), Math.max(1000, this.connectionsStartedAt + 5000 - performance.now()));
        });
    }

    takeConnections(data) {
        if (!data || !Array.isArray(data.established) || !Number.isInteger(data.listen) || data.listen < 0) {
            this.connectionsFailures += 1;
            if (this.connectionsState !== "live" || this.connectionsFailures >= 3) {
                this.connectionsState = "failed";
                this.groups = [];
                this.established = 0;
                this.listening = 0;
            }
            this.renderConnections();
            return;
        }
        this.connectionsFailures = 0;
        this.connectionsState = "live";
        let now = performance.now();
        let groups = new Map();
        let total = 0;
        data.established.forEach(item => {
            if (!item || typeof item.remote !== "string" || !NetworkMonitor.isPublic(item.remote)) return;
            total += 1;
            let pid = (Number.isInteger(item.pid) && item.pid > 0) ? item.pid : 0;
            let key = pid + "|" + item.remote;
            if (!groups.has(key)) groups.set(key, {key, pid, address: item.remote, count: 0});
            groups.get(key).count += 1;
        });
        groups.forEach((group, key) => {
            if (!this.firstSeen.has(key)) this.firstSeen.set(key, now);
        });
        Array.from(this.firstSeen.keys()).forEach(key => {
            if (!groups.has(key)) this.firstSeen.delete(key);
        });
        this.groups = Array.from(groups.values());
        this.established = total;
        this.listening = data.listen;
        let present = new Set(this.groups.map(group => group.address));
        Array.from(this.nameTried).forEach(address => {
            if (!present.has(address)) this.nameTried.delete(address);
        });
        this.askNames();
        this.askPlaces();
        this.renderConnections();
    }

    askNames() {
        if (this.namesBusy) return;
        let now = performance.now();
        let unknown = this.groups.filter(group => !this.names.has(group.address) && !this.nameTried.has(group.address));
        if (this.namesAskedAt !== null && (unknown.length === 0 || now - this.namesAskedAt < 30000)) return;
        this.namesBusy = true;
        this.namesAskedAt = now;
        this.namesCalls += 1;
        unknown.forEach(group => {
            this.nameTried.add(group.address);
        });
        NetworkMonitor.ask("netNames").then(data => {
            this.namesBusy = false;
            this.guard("connection names", () => {
                if (!Array.isArray(data)) return;
                data.forEach(entry => {
                    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1])) return;
                    let names = entry[1].filter(name => typeof name === "string" && name !== "");
                    if (names.length === 0) return;
                    let current = this.names.get(entry[0]);
                    if (current !== undefined && names.includes(current)) return;
                    this.names.delete(entry[0]);
                    this.names.set(entry[0], names[0]);
                });
                while (this.names.size > 4096) this.names.delete(this.names.keys().next().value);
                this.renderConnections();
            });
        });
    }

    askPlaces() {
        if (this.placesBusy) return;
        let missing = Array.from(new Set(this.groups.map(group => group.address).filter(address => !this.places.has(address)))).slice(0, 64);
        if (missing.length === 0) return;
        this.placesBusy = true;
        this.placesCalls += 1;
        NetworkMonitor.call(() => window.vindex.netPlaces(missing)).then(result => {
            this.placesBusy = false;
            this.guard("connection places", () => {
                if (!Array.isArray(result) || result.length !== missing.length) return;
                missing.forEach((address, i) => {
                    this.places.set(address, NetworkMonitor.place(result[i]));
                });
                while (this.places.size > 4096) this.places.delete(this.places.keys().next().value);
                this.renderConnections();
            });
        });
    }

    askHome() {
        NetworkMonitor.call(() => window.vindex.netHome()).then(home => {
            this.guard("globe", () => {
                if (home && typeof home.latitude === "number" && typeof home.longitude === "number" && Math.abs(home.latitude) <= 90 && Math.abs(home.longitude) <= 180) {
                    this.home = {lat: home.latitude, lon: home.longitude};
                    this.view = NetworkMonitor.viewFor(this.home);
                    this.drawGrid();
                }
                this.renderConnections();
            });
        });
    }

    rows() {
        if (this.connectionsState !== "live") return [];
        return this.groups.map(group => {
            let place = this.places.get(group.address) || null;
            return {
                group,
                since: this.firstSeen.get(group.key) || 0,
                proc: NetworkMonitor.processName(group.pid),
                host: this.names.get(group.address) || group.address,
                country: (place !== null) ? place.country : "",
                place
            };
        }).sort((a, b) => (b.since - a.since) || ((a.proc === "?") - (b.proc === "?")) || a.proc.localeCompare(b.proc, "en", {sensitivity: "base"}) || a.host.localeCompare(b.host, "en") || (a.group.pid - b.group.pid));
    }

    static pick(rows, limit) {
        let used = new Map();
        let first = [];
        let rest = [];
        rows.forEach(row => {
            let count = used.get(row.proc) || 0;
            if (count < 2) {
                used.set(row.proc, count + 1);
                first.push(row);
            } else {
                rest.push(row);
            }
        });
        let chosen = new Set(first.slice(0, limit).concat(rest.slice(0, Math.max(0, limit - first.length))));
        return rows.filter(row => chosen.has(row));
    }

    renderConnections() {
        let rows = this.rows();
        this.count.textContent = (this.connectionsState === "live") ? this.established + " est · " + this.listening + " listen" : "";
        let shown = NetworkMonitor.pick(rows, 6);
        this.setRows(shown.length);
        shown.forEach((row, i) => {
            let item = this.connectionRows[i];
            item.proc.textContent = row.proc;
            item.host.textContent = row.host;
            item.country.textContent = row.country;
        });
        let note = "";
        if (this.connectionsState === "waiting") note = "READING CONNECTIONS";
        if (this.connectionsState === "failed") note = "CONNECTIONS UNAVAILABLE";
        if (this.connectionsState === "live" && rows.length === 0) note = "NO CONNECTIONS";
        this.note.textContent = note;
        this.note.hidden = note === "";
        this.renderGlobe(rows);
    }

    setRows(count) {
        while (this.connectionRows.length < count) {
            let row = NetworkMonitor.element("div", "vx-net-conn");
            let led = NetworkMonitor.element("span", "vx-net-led");
            led.setAttribute("aria-hidden", "true");
            let proc = NetworkMonitor.element("span", "vx-net-proc");
            let host = NetworkMonitor.element("span", "vx-net-host");
            let country = NetworkMonitor.element("span", "vx-net-cc");
            row.append(led, proc, host, country);
            this.list.appendChild(row);
            this.connectionRows.push({row, proc, host, country});
        }
        while (this.connectionRows.length > count) {
            this.connectionRows.pop().row.remove();
        }
    }

    drawGrid() {
        let f2 = NetworkMonitor.f2;
        let far = "";
        let mid = "";
        let near = "";
        for (let lat = -80; lat <= 80; lat += 10) {
            for (let lon = -180; lon < 180; lon += 10) {
                let point = NetworkMonitor.project(this.view, lat, lon);
                if (point.z <= 0.02) continue;
                let dot = "M" + f2(point.x) + " " + f2(point.y) + "h0.01";
                if (point.z < 0.35) {
                    far += dot;
                } else if (point.z < 0.7) {
                    mid += dot;
                } else {
                    near += dot;
                }
            }
        }
        this.gridFar.setAttribute("d", far);
        this.gridMid.setAttribute("d", mid);
        this.gridNear.setAttribute("d", near);
    }

    renderGlobe(rows) {
        let countries = new Map();
        rows.forEach(row => {
            let place = row.place;
            if (place === null || place.latitude === null || place.longitude === null) return;
            if (!countries.has(place.country)) countries.set(place.country, {country: place.country, lat: place.latitude, lon: place.longitude, count: 0});
            countries.get(place.country).count += row.group.count;
        });
        let ends = Array.from(countries.values()).sort((a, b) => (b.count - a.count) || a.country.localeCompare(b.country, "en")).slice(0, 12).map(entry => [entry.lat, entry.lon]);
        this.drawEnds(ends);
        let total = (this.connectionsState === "live") ? this.established : 0;
        this.globe.setAttribute("aria-label", "Globe showing " + total + ((total === 1) ? " active connection" : " active connections"));
    }

    drawEnds(ends) {
        let f2 = NetworkMonitor.f2;
        let home = (this.home === null) ? null : NetworkMonitor.project(this.view, this.home.lat, this.home.lon);
        let seen = home !== null && home.z > 0.02;
        let arcs = "";
        let dots = "";
        ends.forEach(([lat, lon]) => {
            let point = NetworkMonitor.project(this.view, lat, lon);
            let behind = point.z <= 0.02;
            if (behind) {
                let dx = point.x - 60;
                let dy = point.y - 60;
                let reach = Math.hypot(dx, dy);
                if (!seen || reach < 1) return;
                point = {x: 60 + dx / reach * 44, y: 60 + dy / reach * 44};
            } else {
                dots += "M" + f2(point.x) + " " + f2(point.y) + "h0.01";
            }
            if (!seen) return;
            let mx = (home.x + point.x) / 2;
            let my = (home.y + point.y) / 2;
            let vx = mx - 60;
            let vy = my - 60;
            let length = Math.hypot(vx, vy) || 1;
            let qx = mx + vx / length * 12;
            let qy = my + vy / length * 12;
            let out = Math.hypot(qx - 60, qy - 60);
            if (behind && out > 44) {
                qx = 60 + (qx - 60) / out * 44;
                qy = 60 + (qy - 60) / out * 44;
            }
            arcs += "M" + f2(home.x) + " " + f2(home.y) + "Q" + f2(qx) + " " + f2(qy) + " " + f2(point.x) + " " + f2(point.y);
        });
        this.arcs.setAttribute("d", arcs);
        this.ends.setAttribute("d", dots);
        if (seen) {
            [this.homeRing, this.homeDot].forEach(circle => {
                circle.setAttribute("cx", f2(home.x));
                circle.setAttribute("cy", f2(home.y));
                circle.removeAttribute("hidden");
            });
        } else {
            this.homeRing.setAttribute("hidden", "");
            this.homeDot.setAttribute("hidden", "");
        }
    }
}
