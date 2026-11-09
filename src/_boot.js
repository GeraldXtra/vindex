const signale = require("signale");
const {app, BrowserWindow, dialog, shell} = require("electron");

process.on("uncaughtException", e => {
    signale.fatal(e);
    dialog.showErrorBox("Vindex crashed", e.message || "Cannot retrieve error message.");
    if (tty) {
        tty.close();
    }
    if (extraTtys) {
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] !== null) {
                extraTtys[key].close();
            }
        });
    }
    process.exit(1);
});

signale.start(`Starting Vindex v${app.getVersion()}`);
signale.info(`With Node ${process.versions.node} and Electron ${process.versions.electron}`);
signale.info(`Renderer is Chrome ${process.versions.chrome}`);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    signale.fatal("Error: Another instance of Vindex is already running. Cannot proceed.");
    app.exit(1);
}

signale.time("Startup");

const electron = require("electron");
const ipc = electron.ipcMain;
const path = require("path");
const url = require("url");
const fs = require("fs");
const os = require("os");
const net = require("net");
const https = require("https");
const which = require("which");
const Terminal = require("./classes/terminal.class.js").Terminal;

const logLevels = ["error", "debug", "note", "info"];
onWindowMessage("log", args => args.length === 2 && logLevels.includes(args[0]) && typeof args[1] === "string", (e, type, content) => {
    signale[type](content);
});

var win, tty, extraTtys;
const bootEvents = [];
const bootStatuses = ["ok", "info", "warn", "fail"];
let lastBootSeq = 0;

function bootEvent(tag, message, status) {
    try {
        let event = {
            seq: ++lastBootSeq,
            t: Math.round(process.uptime() * 1000),
            tag: String(tag),
            message: String(message).slice(0, 200),
            status: bootStatuses.includes(status) ? status : "ok"
        };
        bootEvents.push(event);
        if (bootEvents.length > 300) bootEvents.shift();
        sendToWindow("boot-event", event);
    } catch(err) {
        signale.error("Could not record a boot event:", err);
    }
}

function osLabel() {
    if (process.platform === "win32") {
        let build = Number(os.release().split(".")[2]);
        return `${(build >= 22000) ? "Windows 11" : "Windows 10"} build ${build}`;
    }
    if (process.platform === "darwin") return `macOS (Darwin ${os.release()})`;
    return `${os.type()} ${os.release()}`;
}

bootEvent("MAIN", `Starting Vindex ${app.getVersion()}`);
bootEvent("MAIN", `Electron ${process.versions.electron} · Node ${process.versions.node} · Chromium ${process.versions.chrome.split(".")[0]}`);
bootEvent("MAIN", `${osLabel()} · ${process.arch}`);
bootEvent("MAIN", "Single instance lock acquired");

const settingsFile = path.join(electron.app.getPath("userData"), "settings.json");
const shortcutsFile = path.join(electron.app.getPath("userData"), "shortcuts.json");
const lastWindowStateFile = path.join(electron.app.getPath("userData"), "lastWindowState.json");
const themesDir = path.join(electron.app.getPath("userData"), "themes");
const innerThemesDir = path.join(__dirname, "assets/themes");
const kblayoutsDir = path.join(electron.app.getPath("userData"), "keyboards");
const innerKblayoutsDir = path.join(__dirname, "assets/kb_layouts");
const fontsDir = path.join(electron.app.getPath("userData"), "fonts");
const innerFontsDir = path.join(__dirname, "assets/fonts");
const configFiles = {
    "settings.json": settingsFile,
    "shortcuts.json": shortcutsFile
};

function isMainWindowPage(e) {
    try {
        if (!win || win.isDestroyed() || !e || !e.sender || e.sender.id !== win.webContents.id) return false;
        let frame = win.webContents.mainFrame;
        if (e.frameId !== frame.routingId || e.processId !== frame.processId) return false;
        let page = url.fileURLToPath(frame.url);
        let ui = path.join(__dirname, "ui.html");
        if (process.platform === "win32") return page.toLowerCase() === ui.toLowerCase();
        return page === ui;
    } catch(err) {
        signale.warn("Could not check the sender of an IPC message:", err);
        return false;
    }
}

function hasNoArgs(args) {
    return args.length === 0;
}

function isWindowSize(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function isHttpsURL(link) {
    try {
        return typeof link === "string" && new URL(link).protocol === "https:";
    } catch(err) {
        return false;
    }
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function isSafePath(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 32767 && !value.includes("\0");
}

function isSafeFileName(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 255 && !value.includes("\0") && value !== "." && value !== ".." && path.basename(value) === value;
}

function isPingTarget(value) {
    return typeof value === "string" && (net.isIPv4(value) || /^[A-Za-z0-9.-]{1,253}$/.test(value));
}

function isColorFilter(value) {
    return Array.isArray(value) && value.length <= 32 && value.every(step => typeof step === "string" && step.length <= 100);
}

function onWindowMessage(channel, isValid, listener) {
    ipc.on(channel, (e, ...args) => {
        try {
            if (!isMainWindowPage(e) || !isValid(args)) {
                signale.warn(`Rejected ${channel} message from the window`);
                return;
            }
            listener(e, ...args);
        } catch(err) {
            signale.error(`Could not handle ${channel} message:`, err);
        }
    });
}

function handleWindowRequest(channel, isValid, handler, fallback) {
    ipc.handle(channel, async (e, ...args) => {
        try {
            if (!isMainWindowPage(e) || !isValid(args)) {
                signale.warn(`Rejected ${channel} request from the window`);
                return fallback;
            }
            return await handler(e, ...args);
        } catch(err) {
            signale.error(`Could not handle ${channel} request:`, err);
            return fallback;
        }
    });
}

function sendToWindow(channel, ...args) {
    try {
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send(channel, ...args);
        }
    } catch(err) {
        signale.error(`Could not send ${channel} to the window:`, err);
    }
}

function guardListener(message, listener, onError) {
    return (...args) => {
        try {
            listener(...args);
        } catch(err) {
            signale.error(message, err);
            if (onError) onError(err);
        }
    };
}

function openFile(file) {
    shell.openPath(file).then(error => {
        if (error) signale.warn(`Could not open ${file}: ${error}`);
    }).catch(err => {
        signale.error(`Could not open ${file}:`, err);
    });
}

function readShortcuts() {
    try {
        let content = fs.readFileSync(shortcutsFile, {encoding: "utf-8"});
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
        let shortcuts = JSON.parse(content);
        if (Array.isArray(shortcuts)) return shortcuts;
        signale.warn(`${shortcutsFile} does not contain a list of shortcuts`);
    } catch(err) {
        signale.error(`Could not read ${shortcutsFile}:`, err);
    }
    return [];
}

async function readJSONFile(file) {
    let content = await fs.promises.readFile(file, {encoding: "utf-8"});
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    return JSON.parse(content);
}

function writeJSONFile(file, value) {
    return fs.promises.writeFile(file, JSON.stringify(value, "", 4));
}

async function listJSONNames(dir) {
    let files = await fs.promises.readdir(dir);
    return files.filter(file => file.endsWith(".json")).map(file => file.slice(0, -5));
}

function registerShortcut(trigger, channel, ...args) {
    try {
        electron.globalShortcut.register(trigger, () => {
            sendToWindow(channel, ...args);
        });
    } catch(err) {
        signale.error("Could not register shortcut", trigger, err);
    }
}

function registerShortcuts(shortcuts) {
    shortcuts.forEach(cut => {
        try {
            if (!cut.enabled) return;

            if (cut.type === "app") {
                if (cut.action === "TAB_X") {
                    for (let i = 1; i <= 5; i++) {
                        registerShortcut(cut.trigger.replace("X", i), "shortcut-app", `TAB_${i}`);
                    }
                } else {
                    registerShortcut(cut.trigger, "shortcut-app", cut.action);
                }
            } else if (cut.type === "shell") {
                registerShortcut(cut.trigger, "shortcut-shell", cut.action, (cut.linebreak) ? true : false);
            } else {
                signale.warn("Shortcut has unknown type:", cut.trigger);
            }
        } catch(err) {
            signale.error("Could not register a shortcut:", err);
        }
    });
}

function unregisterShortcuts() {
    try {
        electron.globalShortcut.unregisterAll();
    } catch(err) {
        signale.error("Could not unregister global shortcuts:", err);
    }
}

let dirWatcher = null;

function closeWatcher(watcher) {
    try {
        watcher.close();
    } catch(err) {
        signale.error("Could not close a folder watcher:", err);
    }
}

function closeDirWatcher() {
    if (dirWatcher === null) return;
    let watcher = dirWatcher;
    dirWatcher = null;
    closeWatcher(watcher);
}

function watchDir(dir) {
    closeDirWatcher();
    let watcher = fs.watch(dir, guardListener("Could not forward a folder change:", eventType => {
        sendToWindow("fs-watch-event", eventType);
    }));
    watcher.on("error", guardListener("Could not handle a folder watcher error:", err => {
        signale.error(`Stopped watching ${dir}:`, err);
        if (dirWatcher === watcher) dirWatcher = null;
        closeWatcher(watcher);
    }));
    dirWatcher = watcher;
}

const terminalBaseColors = {
    black: "#2e3436",
    red: "#cc0000",
    green: "#4e9a06",
    yellow: "#c4a000",
    blue: "#3465a4",
    magenta: "#75507b",
    cyan: "#06989a",
    white: "#d3d7cf",
    brightBlack: "#555753",
    brightRed: "#ef2929",
    brightGreen: "#8ae234",
    brightYellow: "#fce94f",
    brightBlue: "#729fcf",
    brightMagenta: "#ad7fa8",
    brightCyan: "#34e2e2",
    brightWhite: "#eeeeec"
};

function parseColorFilter(colorFilter) {
    if (colorFilter.length === 0) return null;
    let steps = [];
    let isValid = colorFilter.every(step => {
        let func = step.slice(0, step.indexOf("("));

        switch(func) {
            case "negate":
            case "grayscale":
                steps.push({
                    func,
                    arg: []
                });
                return true;
            case "lighten":
            case "darken":
            case "saturate":
            case "desaturate":
            case "whiten":
            case "blacken":
            case "fade":
            case "opaquer":
            case "rotate":
            case "mix":
                break;
            default:
                return false;
        }

        let arg = step.slice(step.indexOf("(")+1, step.indexOf(")"));

        if (typeof Number(arg) === "number") {
            steps.push({
                func,
                arg: [Number(arg)]
            });
            return true;
        }

        return false;
    });
    return isValid ? steps : null;
}

let geoIPReader = null;
let geoIPLoading = null;

function geoLocation(ip) {
    if (geoIPReader === null) return null;
    let data = geoIPReader.get(ip);
    if (!data || !data.location || typeof data.location.latitude !== "number" || typeof data.location.longitude !== "number") return null;
    return {
        latitude: data.location.latitude,
        longitude: data.location.longitude
    };
}

const publicIPAgent = new https.Agent({
    keepAlive: false,
    maxSockets: 10
});
const publicIPFailures = new Map();

function fetchPublicIPReply(localAddress) {
    return new Promise(resolve => {
        let finished = false;
        let request = null;
        let timer = null;
        let finish = body => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (body === null && request !== null) request.destroy();
            resolve(body);
        };
        let fail = () => {
            finish(null);
        };
        let guard = listener => guardListener("Could not read the reply from myexternalip.com:", listener, fail);
        request = https.get({host: "myexternalip.com", port: 443, path: "/json", localAddress, agent: publicIPAgent}, guard(res => {
            let chunks = [];
            let size = 0;
            res.on("data", guard(chunk => {
                size += chunk.length;
                if (size > 65536) {
                    fail();
                } else {
                    chunks.push(chunk);
                }
            }));
            res.on("end", guard(() => {
                finish(Buffer.concat(chunks).toString());
            }));
            res.on("aborted", guard(fail));
            res.on("error", guard(fail));
        }));
        request.on("error", guard(fail));
        timer = setTimeout(guard(fail), 10000);
    });
}

function notePublicIPFailure(err) {
    let key = String(err);
    let count = (publicIPFailures.get(key) || 0) + 1;
    publicIPFailures.set(key, count);
    if (count > 2) return;
    signale.note("NetStat: Error parsing data from myexternalip.com");
    signale.debug(`Error: ${err}`);
}

function ping(target, localAddress) {
    return new Promise(resolve => {
        let socket = new net.Socket();
        let start = process.hrtime();
        let finished = false;
        let finish = time => {
            if (finished) return;
            finished = true;
            socket.destroy();
            resolve(time);
        };
        let fail = () => {
            finish(null);
        };
        let guard = listener => guardListener("Could not handle a ping:", listener, fail);
        socket.on("error", guard(fail));
        socket.connect({
            port: 80,
            host: target,
            localAddress,
            family: 4
        }, guard(() => {
            let time = process.hrtime(start);
            finish((time[0] * 1e9 + time[1]) / 1e6);
        }));
        socket.setTimeout(1900, guard(fail));
    });
}

onWindowMessage("app-focus", hasNoArgs, () => {
    app.focus();
});
onWindowMessage("app-relaunch", hasNoArgs, () => {
    app.relaunch();
});
onWindowMessage("app-quit", hasNoArgs, () => {
    app.quit();
});
handleWindowRequest("clipboard-read-text", hasNoArgs, () => electron.clipboard.readText(), "");
handleWindowRequest("clipboard-write-text", args => args.length === 1 && typeof args[0] === "string" && args[0].length <= 10485760, async (e, text) => {
    await electron.clipboard.writeText(text);
    return true;
}, false);
bootEvent("SECURITY", "Clipboard writes limited to 10 MB");
handleWindowRequest("screen-display-count", hasNoArgs, () => electron.screen.getAllDisplays().length, 0);
onWindowMessage("shell-open-path", args => args.length === 1 && typeof args[0] === "string", (e, target) => {
    openFile(target);
});
onWindowMessage("shell-open-config", args => args.length === 1 && typeof args[0] === "string" && Object.prototype.hasOwnProperty.call(configFiles, args[0]), (e, name) => {
    openFile(configFiles[name]);
});
onWindowMessage("window-minimize", hasNoArgs, () => {
    win.minimize();
});
onWindowMessage("window-unmaximize", hasNoArgs, () => {
    win.unmaximize();
});
onWindowMessage("window-set-fullscreen", args => args.length === 1 && typeof args[0] === "boolean", (e, flag) => {
    win.setFullScreen(flag);
});
onWindowMessage("window-set-size", args => args.length === 2 && isWindowSize(args[0]) && isWindowSize(args[1]), (e, width, height) => {
    win.setSize(width, height);
});
onWindowMessage("window-toggle-devtools", hasNoArgs, () => {
    win.webContents.toggleDevTools();
});
handleWindowRequest("window-is-fullscreen", hasNoArgs, () => win.isFullScreen(), false);
handleWindowRequest("window-is-maximized", hasNoArgs, () => win.isMaximized(), false);
handleWindowRequest("window-get-size", hasNoArgs, () => win.getSize(), [0, 0]);
handleWindowRequest("config-read", hasNoArgs, async () => {
    return {
        settings: await readJSONFile(settingsFile),
        shortcuts: await readJSONFile(shortcutsFile),
        lastWindowState: await readJSONFile(lastWindowStateFile)
    };
}, null);
handleWindowRequest("config-write-settings", args => args.length === 1 && isPlainObject(args[0]), async (e, settings) => {
    await writeJSONFile(settingsFile, settings);
    return true;
}, false);
handleWindowRequest("config-write-window-state", args => args.length === 1 && typeof args[0] === "boolean", async (e, flag) => {
    let state = {};
    try {
        let saved = await readJSONFile(lastWindowStateFile);
        if (isPlainObject(saved)) state = saved;
    } catch(err) {
        signale.warn(`Could not read ${lastWindowStateFile}, starting from an empty state:`, err);
    }
    state.useFullscreen = flag;
    await writeJSONFile(lastWindowStateFile, state);
    return true;
}, false);
handleWindowRequest("theme-read", args => args.length === 1 && isSafeFileName(args[0]), (e, name) => readJSONFile(path.join(themesDir, name+".json")), null);
handleWindowRequest("theme-list", hasNoArgs, () => listJSONNames(themesDir), []);
handleWindowRequest("keyboard-read", args => args.length === 1 && isSafeFileName(args[0]), (e, name) => readJSONFile(path.join(kblayoutsDir, name+".json")), null);
handleWindowRequest("keyboard-list", hasNoArgs, () => listJSONNames(kblayoutsDir), []);
handleWindowRequest("boot-events-read", hasNoArgs, () => ({now: Math.round(process.uptime() * 1000), events: bootEvents.slice()}), {now: 0, events: []});
handleWindowRequest("os-uptime", hasNoArgs, () => os.uptime(), 0);
handleWindowRequest("os-username", hasNoArgs, async () => (await require("username")()) || null, null);
handleWindowRequest("assets-file-icons", hasNoArgs, () => require("./assets/icons/file-icons.json"), null);
handleWindowRequest("assets-globe-grid", hasNoArgs, () => require("./assets/misc/grid.json"), null);
handleWindowRequest("terminal-palette", args => args.length === 2 && typeof args[0] === "string" && args[0].length <= 100 && isColorFilter(args[1]), (e, baseColor, colorFilter) => {
    let color = require("color");
    let steps = parseColorFilter(colorFilter);
    let colorify;
    if (steps !== null) {
        colorify = (base, target) => {
            let newColor = color(base);
            target = color(target);

            for (let i = 0; i < steps.length; i++) {
                if (steps[i].func === "mix") {
                    newColor = newColor[steps[i].func](target, ...steps[i].arg);
                } else {
                    newColor = newColor[steps[i].func](...steps[i].arg);
                }
            }

            return newColor.hex();
        };
    } else {
        colorify = (base, target) => {
            return color(base).grayscale().mix(color(target), 0.3).hex();
        };
    }
    let palette = {};
    Object.keys(terminalBaseColors).forEach(key => {
        palette[key] = colorify(terminalBaseColors[key], baseColor);
    });
    return palette;
}, null);
handleWindowRequest("fs-read-dir", args => args.length === 1 && isSafePath(args[0]), async (e, dir) => {
    let names;
    try {
        names = await fs.promises.readdir(dir);
    } catch(err) {
        return null;
    }
    let entries = await Promise.all(names.map(async name => {
        let entryPath = path.resolve(dir, name);
        try {
            let stat = await fs.promises.lstat(path.join(dir, name));
            return {
                name,
                path: entryPath,
                isDirectory: stat.isDirectory(),
                isFile: stat.isFile(),
                isSymbolicLink: stat.isSymbolicLink(),
                size: stat.size,
                mtime: stat.mtime.getTime()
            };
        } catch(err) {
            return {
                name,
                path: entryPath,
                lstatError: String((err && (err.code || err.message)) || err)
            };
        }
    }));
    return {
        parent: path.resolve(dir, ".."),
        entries
    };
}, null);
handleWindowRequest("fs-exists", args => args.length === 1 && isSafePath(args[0]), (e, target) => fs.existsSync(target), false);
handleWindowRequest("fs-read-text", args => args.length === 1 && isSafePath(args[0]), async (e, file) => {
    try {
        let stat = await fs.promises.stat(file);
        if (stat.size > 10485760) return {error: "This file is over 10 MB, too large to open here."};
        return {data: await fs.promises.readFile(file, {encoding: "utf-8"})};
    } catch(err) {
        return {error: String((err && err.message) || err)};
    }
}, {error: "Could not read the file."});
handleWindowRequest("fs-write-text", args => args.length === 2 && isSafePath(args[0]) && typeof args[1] === "string", async (e, file, content) => {
    await fs.promises.writeFile(file, content, "utf-8");
    return true;
}, false);
handleWindowRequest("fs-file-type", args => args.length === 1 && typeof args[0] === "string" && args[0].length <= 4096, (e, name) => {
    let mime = require("mime-types");
    let parts = name.split(".");
    let type = mime.lookup(parts[parts.length - 1]);
    return {type, charset: mime.charset(type)};
}, {type: false, charset: false});
onWindowMessage("fs-watch-start", args => args.length === 1 && isSafePath(args[0]), (e, dir) => {
    watchDir(dir);
});
onWindowMessage("fs-watch-stop", hasNoArgs, () => {
    closeDirWatcher();
});
handleWindowRequest("geoip-start", hasNoArgs, () => {
    if (geoIPLoading === null) {
        let geolite2 = require("geolite2-redist");
        let maxmind = require("maxmind");
        geoIPLoading = geolite2.downloadDbs(path.join(app.getPath("userData"), "geoIPcache")).then(() => {
            return geolite2.open("GeoLite2-City", dbPath => maxmind.open(dbPath));
        }).then(reader => {
            geoIPReader = reader;
            return true;
        }).catch(err => {
            signale.error("Could not load the GeoIP database:", err);
            geoIPLoading = null;
            return false;
        });
    }
    return geoIPLoading;
}, false);
handleWindowRequest("geoip-lookup", args => args.length === 1 && typeof args[0] === "string" && net.isIP(args[0]) !== 0, (e, ip) => geoLocation(ip), null);
handleWindowRequest("netstat-public-ip", args => args.length === 1 && typeof args[0] === "string" && net.isIPv4(args[0]), async (e, localAddress) => {
    if (geoIPReader === null) return null;
    let body = await fetchPublicIPReply(localAddress);
    if (body === null) return null;
    try {
        let data = JSON.parse(body);
        if (typeof data.ip !== "string" || net.isIP(data.ip) === 0) throw new Error("The reply has no valid IP address");
        let location = geoLocation(data.ip);
        if (location === null) throw new Error("No location was found for this IP address");
        return {ip: data.ip, location};
    } catch(err) {
        notePublicIPFailure(err);
        return null;
    }
}, null);
handleWindowRequest("netstat-ping", args => args.length === 2 && isPingTarget(args[0]) && typeof args[1] === "string" && net.isIPv4(args[1]), (e, target, localAddress) => ping(target, localAddress), null);

// Unset proxy env variables to avoid connection problems on the internal websockets
// See #222
if (process.env.http_proxy) delete process.env.http_proxy;
if (process.env.https_proxy) delete process.env.https_proxy;

// Bypass GPU acceleration blocklist, trading a bit of stability for a great deal of performance, mostly on Linux
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-video-decode");

// Fix userData folder not setup on Windows
try {
    fs.mkdirSync(electron.app.getPath("userData"));
    signale.info(`Created config dir at ${electron.app.getPath("userData")}`);
} catch(e) {
    signale.info(`Base config dir is ${electron.app.getPath("userData")}`);
}
bootEvent("CONFIG", `Config folder ${electron.app.getPath("userData")}`);
function readOldJSONFile(file) {
    let content = fs.readFileSync(file, {encoding: "utf-8"});
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    return JSON.parse(content);
}
function isSameFolder(a, b) {
    a = path.resolve(a);
    b = path.resolve(b);
    if (process.platform === "win32") return a.toLowerCase() === b.toLowerCase();
    return a === b;
}
function copyOldUserData(oldDir) {
    let newDir = electron.app.getPath("userData");
    let copied = [];
    let skipped = [];
    [
        {name: "settings.json", isValid: isPlainObject, kind: "a JSON object"},
        {name: "shortcuts.json", isValid: Array.isArray, kind: "a JSON array"},
        {name: "lastWindowState.json", isValid: isPlainObject, kind: "a JSON object"}
    ].forEach(({name, isValid, kind}) => {
        let from = path.join(oldDir, name);
        let to = path.join(newDir, name);
        try {
            if (fs.existsSync(to)) return skipped.push(`${name} (already exists)`);
            if (!fs.existsSync(from)) return skipped.push(`${name} (not found)`);
            let value;
            try {
                value = readOldJSONFile(from);
            } catch(e) {
                return skipped.push(`${name} (not valid JSON)`);
            }
            if (!isValid(value)) return skipped.push(`${name} (not ${kind})`);
            let note = "";
            if (name === "settings.json" && typeof value.cwd === "string" && path.isAbsolute(value.cwd) && isSameFolder(value.cwd, oldDir)) {
                value.cwd = newDir;
                note = " (cwd set to the Vindex folder)";
            }
            fs.writeFileSync(to, JSON.stringify(value, "", 4), {flag: "wx"});
            copied.push(name+note);
        } catch(e) {
            skipped.push(`${name} (failed: ${(e && e.message) || e})`);
        }
    });
    ["themes", "keyboards", "fonts", "geoIPcache"].forEach(name => {
        let from = path.join(oldDir, name);
        let to = path.join(newDir, name);
        try {
            if (fs.existsSync(to)) return skipped.push(`${name} (already exists)`);
            if (!fs.existsSync(from)) return skipped.push(`${name} (not found)`);
            if (!fs.statSync(from).isDirectory()) return skipped.push(`${name} (not a folder)`);
            fs.cpSync(from, to, {recursive: true, force: false, errorOnExist: true});
            copied.push(name);
        } catch(e) {
            skipped.push(`${name} (failed: ${(e && e.message) || e})`);
        }
    });
    signale.info(`Imported eDEX-UI settings from ${oldDir}: copied ${copied.join(", ") || "nothing"}; skipped ${skipped.join(", ") || "nothing"}`);
    if (copied.length > 0) bootEvent("CONFIG", `Imported eDEX-UI settings · ${copied.length} items`, "info");
}
try {
    let oldUserDataDir = path.join(app.getPath("appData"), "eDEX-UI");
    if (!fs.existsSync(settingsFile) && fs.existsSync(oldUserDataDir)) copyOldUserData(oldUserDataDir);
} catch(e) {
    signale.error("Could not import the old eDEX-UI settings:", e);
}
// Create default settings file
if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
        shell: (process.platform === "win32") ? "powershell.exe" : "bash",
        shellArgs: '',
        cwd: electron.app.getPath("userData"),
        keyboard: "en-US",
        theme: "tron",
        termFontSize: 15,
        audio: true,
        audioVolume: 1.0,
        disableFeedbackAudio: false,
        clockHours: 24,
        pingAddr: "1.1.1.1",
        port: 3000,
        nointro: false,
        nocursor: false,
        forceFullscreen: true,
        allowWindowed: false,
        excludeThreadsFromToplist: true,
        hideDotfiles: false,
        fsListView: false,
        experimentalGlobeFeatures: false,
        experimentalFeatures: false
    }, "", 4));
    signale.info(`Default settings written to ${settingsFile}`);
}
// Create default shortcuts file
if (!fs.existsSync(shortcutsFile)) {
    fs.writeFileSync(shortcutsFile, JSON.stringify([
        { type: "app", trigger: "Ctrl+Shift+C", action: "COPY", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+V", action: "PASTE", enabled: true },
        { type: "app", trigger: "Ctrl+Tab", action: "NEXT_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+Tab", action: "PREVIOUS_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+X", action: "TAB_X", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+S", action: "SETTINGS", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+K", action: "SHORTCUTS", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+F", action: "FUZZY_SEARCH", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+L", action: "FS_LIST_VIEW", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+H", action: "FS_DOTFILES", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+P", action: "KB_PASSMODE", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+I", action: "DEV_DEBUG", enabled: false },
        { type: "app", trigger: "Ctrl+Shift+F5", action: "DEV_RELOAD", enabled: true },
        { type: "shell", trigger: "Ctrl+Shift+Alt+Space", action: "neofetch", linebreak: true, enabled: false }
    ], "", 4));
    signale.info(`Default keymap written to ${shortcutsFile}`);
}
//Create default window state file
if(!fs.existsSync(lastWindowStateFile)) {
    fs.writeFileSync(lastWindowStateFile, JSON.stringify({
        useFullscreen: true
    }, "", 4));
    signale.info(`Default last window state written to ${lastWindowStateFile}`);
}

// Copy default themes & keyboard layouts & fonts
signale.pending("Mirroring internal assets...");
try {
    fs.mkdirSync(themesDir);
} catch(e) {
    // Folder already exists
}
fs.readdirSync(innerThemesDir).forEach(e => {
    fs.writeFileSync(path.join(themesDir, e), fs.readFileSync(path.join(innerThemesDir, e), {encoding:"utf-8"}));
});
try {
    fs.mkdirSync(kblayoutsDir);
} catch(e) {
    // Folder already exists
}
fs.readdirSync(innerKblayoutsDir).forEach(e => {
    fs.writeFileSync(path.join(kblayoutsDir, e), fs.readFileSync(path.join(innerKblayoutsDir, e), {encoding:"utf-8"}));
});
try {
    fs.mkdirSync(fontsDir);
} catch(e) {
    // Folder already exists
}
fs.readdirSync(innerFontsDir).forEach(e => {
    fs.writeFileSync(path.join(fontsDir, e), fs.readFileSync(path.join(innerFontsDir, e)));
});

// Version history logging
const versionHistoryPath = path.join(electron.app.getPath("userData"), "versions_log.json");
var versionHistory = fs.existsSync(versionHistoryPath) ? require(versionHistoryPath) : {};
var version = app.getVersion();
if (typeof versionHistory[version] === "undefined") {
	versionHistory[version] = {
		firstSeen: Date.now(),
		lastSeen: Date.now()
	};
} else {
	versionHistory[version].lastSeen = Date.now();
}
fs.writeFileSync(versionHistoryPath, JSON.stringify(versionHistory, 0, 2), {encoding:"utf-8"});

function reportWindow(display) {
    try {
        let rate = display.displayFrequency;
        let hz = (typeof rate === "number" && rate > 0) ? ` · ${Math.round(rate)} Hz` : "";
        bootEvent("WINDOW", `Window ${display.bounds.width} × ${display.bounds.height}${hz}`);
        let prefs = win.webContents.getLastWebPreferences() || {};
        bootEvent("SECURITY", prefs.sandbox ? "Renderer sandbox on" : "Renderer sandbox off", prefs.sandbox ? "ok" : "fail");
        bootEvent("SECURITY", prefs.contextIsolation ? "Context isolation on" : "Context isolation off", prefs.contextIsolation ? "ok" : "fail");
        bootEvent("SECURITY", prefs.nodeIntegration ? "Node integration on" : "Node integration off", prefs.nodeIntegration ? "fail" : "ok");
        reportGPU();
    } catch(err) {
        signale.error("Could not report the window setup:", err);
    }
}

function isGPUCompositing() {
    let compositing = app.getGPUFeatureStatus().gpu_compositing;
    return typeof compositing === "string" && compositing.startsWith("enabled");
}

function reportGPU() {
    let reported = false;
    let report = () => {
        if (reported) return;
        reported = true;
        try {
            let accelerated = isGPUCompositing();
            bootEvent("GPU", accelerated ? "Hardware acceleration on" : "Hardware acceleration off", accelerated ? "ok" : "warn");
        } catch(err) {
            signale.error("Could not read the GPU status:", err);
        }
    };
    if (isGPUCompositing()) return report();
    app.once("gpu-info-update", report);
    setTimeout(report, 5000);
}

function createWindow(settings) {
    signale.info("Creating window...");

    let display;
    if (!isNaN(settings.monitor)) {
        display = electron.screen.getAllDisplays()[settings.monitor] || electron.screen.getPrimaryDisplay();
    } else {
        display = electron.screen.getPrimaryDisplay();
    }
    let {x, y, width, height} = display.bounds;
    width++; height++;
    win = new BrowserWindow({
        title: "Vindex",
        x,
        y,
        width,
        height,
        show: false,
        resizable: true,
        movable: settings.allowWindowed || false,
        fullscreen: settings.forceFullscreen || false,
        autoHideMenuBar: true,
        frame: settings.allowWindowed || false,
        backgroundColor: '#000000',
        webPreferences: {
            devTools: true,
            contextIsolation: true,
            backgroundThrottling: false,
            webSecurity: true,
            nodeIntegration: false,
            sandbox: true,
            nodeIntegrationInSubFrames: false,
            allowRunningInsecureContent: false,
            experimentalFeatures: settings.experimentalFeatures || false,
            preload: path.join(__dirname, "_preload.js"),
            additionalArguments: [
                "--vindex-userdata="+encodeURIComponent(app.getPath("userData")),
                "--vindex-version="+encodeURIComponent(app.getVersion()),
                "--vindex-nointro="+process.argv.includes("--nointro"),
                "--vindex-nocursor="+process.argv.includes("--nocursor")
            ]
        }
    });
    reportWindow(display);

    let shortcuts = [];
    win.webContents.on("dom-ready", () => {
        unregisterShortcuts();
        shortcuts = readShortcuts();
        registerShortcuts(shortcuts);
    });
    win.on("focus", () => {
        registerShortcuts(shortcuts);
    });
    win.on("blur", () => {
        unregisterShortcuts();
    });
    win.on("resize", () => {
        sendToWindow("window-resize");
    });
    win.on("leave-full-screen", () => {
        sendToWindow("window-leave-full-screen");
    });
    win.webContents.on("did-start-navigation", guardListener("Could not handle a window navigation:", e => {
        if (e.isMainFrame && !e.isSameDocument) closeDirWatcher();
    }));
    win.webContents.on("render-process-gone", guardListener("Could not handle the lost window process:", () => {
        closeDirWatcher();
    }));
    win.on("closed", guardListener("Could not handle the closed window:", () => {
        closeDirWatcher();
    }));

    win.webContents.once("did-finish-load", () => {
        bootEvent("WINDOW", "Page loaded");
    });
    bootEvent("WINDOW", "Loading ui.html");
    win.loadFile(path.join(__dirname, "ui.html")).catch(err => {
        signale.error("Could not load the window page:", err);
    });

    signale.complete("Frontend window created!");
    win.show();
    if (!settings.allowWindowed) {
        win.setResizable(false);
    } else if (!require(lastWindowStateFile)["useFullscreen"]) {
        win.setFullScreen(false);
    }

    signale.watch("Waiting for frontend connection...");
}

app.on('ready', async () => {
    signale.pending(`Loading settings file...`);
    let settings = require(settingsFile);
    bootEvent("CONFIG", "settings.json loaded");
    signale.pending(`Resolving shell path...`);
    settings.shell = await which(settings.shell).catch(e => { throw(e) });
    signale.info(`Shell found at ${settings.shell}`);
    bootEvent("PTY", `Shell ${path.basename(settings.shell)} found`);
    signale.success(`Settings loaded!`);

    if (!require("fs").existsSync(settings.cwd)) throw new Error("Configured cwd path does not exist.");

    // See #366
    let cleanEnv = await require("shell-env")(settings.shell).catch(e => { throw e; });

    Object.assign(cleanEnv, {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "Vindex",
        TERM_PROGRAM_VERSION: app.getVersion()
    }, settings.env);

    signale.pending(`Creating new terminal process on port ${settings.port || '3000'}`);
    tty = new Terminal({
        role: "server",
        shell: settings.shell,
        params: settings.shellArgs || '',
        cwd: settings.cwd,
        env: cleanEnv,
        port: settings.port || 3000,
        isAllowedSender: isMainWindowPage
    });
    if (tty.tty && tty.tty.pid) bootEvent("PTY", `Shell started · PID ${tty.tty.pid}`);
    signale.success(`Terminal back-end initialized!`);
    tty.onclosed = (code, signal) => {
        tty.ondisconnected = () => {};
        signale.complete("Terminal exited", code, signal);
        app.quit();
    };
    tty.onopened = () => {
        signale.success("Connected to frontend!");
        signale.timeEnd("Startup");
    };
    tty.onresized = (cols, rows) => {
        signale.info("Resized TTY to ", cols, rows);
    };
    tty.ondisconnected = () => {
        signale.error("Lost connection to frontend");
        signale.watch("Waiting for frontend connection...");
    };

    // Support for multithreaded systeminformation calls
    signale.pending("Starting multithreaded calls controller...");
    bootEvent("WORKER", "Starting 3 system workers");
    require("./_multithread.js")(isMainWindowPage, (job, pid) => {
        bootEvent("WORKER", `${job} worker up · PID ${pid}`);
    });

    createWindow(settings);

    // Support for more terminals, used for creating tabs (currently limited to 4 extra terms)
    extraTtys = {};
    let basePort = settings.port || 3000;
    basePort = Number(basePort) + 2;

    for (let i = 0; i < 4; i++) {
        extraTtys[basePort+i] = null;
    }

    handleWindowRequest("ttyspawn", args => args.length === 1 && args[0] === "true", () => {
        let port = null;
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] === null && port === null) {
                extraTtys[key] = {};
                port = key;
            }
        });

        if (port === null) {
            signale.error("TTY spawn denied (Reason: exceeded max TTYs number)");
            return "ERROR: max number of ttys reached";
        } else {
            signale.pending(`Creating new TTY process on port ${port}`);
            let term;
            try {
                term = new Terminal({
                    role: "server",
                    shell: settings.shell,
                    params: settings.shellArgs || '',
                    cwd: tty.tty._cwd || settings.cwd,
                    env: cleanEnv,
                    port: port,
                    isAllowedSender: isMainWindowPage
                });
            } catch(err) {
                extraTtys[port] = null;
                signale.error(`Could not create TTY process on port ${port}:`, err);
                return "ERROR: could not create tty";
            }
            signale.success(`New terminal back-end initialized at ${port}`);
            term.onclosed = (code, signal) => {
                term.ondisconnected = () => {};
                signale.complete(`TTY exited at ${port}`, code, signal);
                extraTtys[term.port] = null;
                term = null;
            };
            term.onopened = pid => {
                signale.success(`TTY ${port} connected to frontend (process PID ${pid})`);
            };
            term.onresized = () => {};
            term.ondisconnected = () => {
                term.onclosed = () => {};
                term.close();
                extraTtys[term.port] = null;
                term = null;
            };

            extraTtys[port] = term;
            return "SUCCESS: "+port;
        }
    }, "ERROR: could not spawn tty");

    // Backend support for theme and keyboard hotswitch
    let themeOverride = null;
    let kbOverride = null;
    handleWindowRequest("getThemeOverride", hasNoArgs, () => themeOverride, null);
    handleWindowRequest("getKbOverride", hasNoArgs, () => kbOverride, null);
    onWindowMessage("setThemeOverride", args => args.length === 1 && typeof args[0] === "string", (e, arg) => {
        themeOverride = arg;
    });
    onWindowMessage("setKbOverride", args => args.length === 1 && typeof args[0] === "string", (e, arg) => {
        kbOverride = arg;
    });
});

let reportedContentsRules = false;
app.on('web-contents-created', (e, contents) => {
    // Prevent creating more than one window
    contents.setWindowOpenHandler(details => {
        try {
            if (isHttpsURL(details.url)) {
                shell.openExternal(details.url).catch(err => {
                    signale.error("Could not open an external link:", err);
                });
            } else {
                signale.warn("Blocked opening a link that is not https");
            }
        } catch(err) {
            signale.error("Could not handle a new window request:", err);
        }
        return {action: "deny"};
    });

    // Prevent loading something else than the UI
    contents.on("will-navigate", e => {
        if (e.url !== contents.getURL()) e.preventDefault();
    });

    if (!reportedContentsRules) {
        reportedContentsRules = true;
        bootEvent("SECURITY", "New windows blocked · navigation locked");
        bootEvent("SECURITY", "Only https links open in your browser");
    }
});

app.on('window-all-closed', () => {
    signale.info("All windows closed");
    app.quit();
});

app.on('before-quit', () => {
    tty.close();
    Object.keys(extraTtys).forEach(key => {
        if (extraTtys[key] !== null) {
            extraTtys[key].close();
        }
    });
    signale.complete("Shutting down...");
});

app.on('will-quit', () => {
    unregisterShortcuts();
});
