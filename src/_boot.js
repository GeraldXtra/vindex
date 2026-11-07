const signale = require("signale");
const {app, BrowserWindow, dialog, shell} = require("electron");

process.on("uncaughtException", e => {
    signale.fatal(e);
    dialog.showErrorBox("eDEX-UI crashed", e.message || "Cannot retrieve error message.");
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

signale.start(`Starting eDEX-UI v${app.getVersion()}`);
signale.info(`With Node ${process.versions.node} and Electron ${process.versions.electron}`);
signale.info(`Renderer is Chrome ${process.versions.chrome}`);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    signale.fatal("Error: Another instance of eDEX is already running. Cannot proceed.");
    app.exit(1);
}

signale.time("Startup");

const electron = require("electron");
const ipc = electron.ipcMain;
const path = require("path");
const url = require("url");
const fs = require("fs");
const which = require("which");
const Terminal = require("./classes/terminal.class.js").Terminal;

const logLevels = ["error", "debug", "note", "info"];
onWindowMessage("log", args => args.length === 2 && logLevels.includes(args[0]) && typeof args[1] === "string", (e, type, content) => {
    signale[type](content);
});

var win, tty, extraTtys;
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
handleWindowRequest("screen-display-count", hasNoArgs, () => electron.screen.getAllDisplays().length, 0);
onWindowMessage("shell-open-path", args => args.length === 1 && typeof args[0] === "string", (e, target) => {
    openFile(target);
});
onWindowMessage("shell-open-config", args => args.length === 1 && typeof args[0] === "string" && Object.prototype.hasOwnProperty.call(configFiles, args[0]), (e, name) => {
    openFile(configFiles[name]);
});
onWindowMessage("shell-open-external", args => args.length === 1 && isHttpsURL(args[0]), (e, link) => {
    shell.openExternal(link).catch(err => {
        signale.error("Could not open an external link:", err);
    });
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
        title: "eDEX-UI",
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
            contextIsolation: false,
            backgroundThrottling: false,
            webSecurity: true,
            nodeIntegration: true,
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

    win.loadURL(url.format({
        pathname: path.join(__dirname, 'ui.html'),
        protocol: 'file:',
        slashes: true
    }));

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
    signale.pending(`Resolving shell path...`);
    settings.shell = await which(settings.shell).catch(e => { throw(e) });
    signale.info(`Shell found at ${settings.shell}`);
    signale.success(`Settings loaded!`);

    if (!require("fs").existsSync(settings.cwd)) throw new Error("Configured cwd path does not exist.");

    // See #366
    let cleanEnv = await require("shell-env")(settings.shell).catch(e => { throw e; });

    Object.assign(cleanEnv, {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "eDEX-UI",
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
    require("./_multithread.js")(isMainWindowPage);

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

app.on('web-contents-created', (e, contents) => {
    // Prevent creating more than one window
    contents.on('new-window', (e, url) => {
        try {
            e.preventDefault();
            if (isHttpsURL(url)) {
                shell.openExternal(url).catch(err => {
                    signale.error("Could not open an external link:", err);
                });
            } else {
                signale.warn("Blocked opening a link that is not https");
            }
        } catch(err) {
            signale.error("Could not handle a new window request:", err);
        }
    });

    // Prevent loading something else than the UI
    contents.on('will-navigate', (e, url) => {
        if (url !== contents.getURL()) e.preventDefault();
    });
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
