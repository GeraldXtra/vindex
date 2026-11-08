const {contextBridge, ipcRenderer, webFrame} = require("electron");

const logLevels = ["error", "debug", "note", "info"];

function readArgument(name) {
    let prefix = `--vindex-${name}=`;
    let matches = process.argv.filter(arg => typeof arg === "string" && arg.startsWith(prefix));
    if (matches.length === 0) return null;
    try {
        return decodeURIComponent(matches[matches.length - 1].slice(prefix.length));
    } catch(e) {
        return null;
    }
}

function requireValid(condition, message) {
    if (!condition) throw new TypeError(message);
}

function isDigits(value) {
    return typeof value === "string" && /^[0-9]+$/.test(value);
}

function isWindowSize(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function terminalChannel(port) {
    requireValid(Number.isSafeInteger(port) && port >= 0, "Terminal port must be a whole number");
    return "terminal_channel-"+port;
}

function listen(channel, callback) {
    requireValid(typeof callback === "function", "Callback must be a function");
    let listener = (e, ...args) => {
        callback(...args);
    };
    ipcRenderer.on(channel, listener);
    return () => {
        ipcRenderer.removeListener(channel, listener);
    };
}

const vindex = Object.freeze({
    userDataPath: readArgument("userdata"),
    appVersion: readArgument("version"),
    nointro: readArgument("nointro") === "true",
    nocursor: readArgument("nocursor") === "true",
    platform: process.platform,
    electronVersion: process.versions.electron,
    log: (level, message) => {
        requireValid(logLevels.includes(level), "Unknown log level");
        requireValid(typeof message === "string", "Log message must be a string");
        ipcRenderer.send("log", level, message);
    },
    systeminformation: (name, ...args) => {
        requireValid(typeof name === "string", "systeminformation function name must be a string");
        return ipcRenderer.invoke("systeminformation-call", name, ...args);
    },
    getThemeOverride: () => {
        return ipcRenderer.invoke("getThemeOverride");
    },
    setThemeOverride: theme => {
        requireValid(typeof theme === "string", "Theme name must be a string");
        ipcRenderer.send("setThemeOverride", theme);
    },
    getKbOverride: () => {
        return ipcRenderer.invoke("getKbOverride");
    },
    setKbOverride: layout => {
        requireValid(typeof layout === "string", "Keyboard layout name must be a string");
        ipcRenderer.send("setKbOverride", layout);
    },
    ttySpawn: () => {
        return ipcRenderer.invoke("ttyspawn", "true");
    },
    terminalStartup: port => {
        ipcRenderer.send(terminalChannel(port), "Renderer startup");
    },
    terminalWrite: (port, data) => {
        let channel = terminalChannel(port);
        requireValid(typeof data === "string", "Terminal data must be a string");
        ipcRenderer.send(channel, "Data", data);
    },
    terminalWriteBinary: (port, data) => {
        let channel = terminalChannel(port);
        requireValid(data instanceof Uint8Array, "Terminal binary data must be a Uint8Array");
        ipcRenderer.send(channel, "Binary", data);
    },
    terminalResize: (port, cols, rows) => {
        let channel = terminalChannel(port);
        requireValid(isDigits(cols) && isDigits(rows), "Terminal size must be made of digits");
        ipcRenderer.send(channel, "Resize", cols, rows);
    },
    onTerminalMessage: (port, callback) => {
        return listen(terminalChannel(port), callback);
    },
    readClipboardText: () => {
        return ipcRenderer.invoke("clipboard-read-text");
    },
    getDisplayCount: () => {
        return ipcRenderer.invoke("screen-display-count");
    },
    focusApp: () => {
        ipcRenderer.send("app-focus");
    },
    relaunchApp: () => {
        ipcRenderer.send("app-relaunch");
    },
    quitApp: () => {
        ipcRenderer.send("app-quit");
    },
    openPath: target => {
        requireValid(typeof target === "string", "Path must be a string");
        ipcRenderer.send("shell-open-path", target);
    },
    openSettingsFile: () => {
        ipcRenderer.send("shell-open-config", "settings.json");
    },
    openShortcutsFile: () => {
        ipcRenderer.send("shell-open-config", "shortcuts.json");
    },
    minimize: () => {
        ipcRenderer.send("window-minimize");
    },
    isFullScreen: () => {
        return ipcRenderer.invoke("window-is-fullscreen");
    },
    setFullScreen: flag => {
        requireValid(typeof flag === "boolean", "Fullscreen flag must be a boolean");
        ipcRenderer.send("window-set-fullscreen", flag);
    },
    isMaximized: () => {
        return ipcRenderer.invoke("window-is-maximized");
    },
    unmaximize: () => {
        ipcRenderer.send("window-unmaximize");
    },
    getSize: () => {
        return ipcRenderer.invoke("window-get-size");
    },
    setSize: (width, height) => {
        requireValid(isWindowSize(width) && isWindowSize(height), "Window size must be made of positive whole numbers");
        ipcRenderer.send("window-set-size", width, height);
    },
    toggleDevTools: () => {
        ipcRenderer.send("window-toggle-devtools");
    },
    onResize: callback => {
        return listen("window-resize", callback);
    },
    onLeaveFullScreen: callback => {
        return listen("window-leave-full-screen", callback);
    },
    onAppShortcut: callback => {
        return listen("shortcut-app", callback);
    },
    onShellShortcut: callback => {
        return listen("shortcut-shell", callback);
    },
    readConfig: () => {
        return ipcRenderer.invoke("config-read");
    },
    writeSettings: settings => {
        requireValid(isPlainObject(settings), "Settings must be a plain object");
        return ipcRenderer.invoke("config-write-settings", settings);
    },
    saveFullscreenState: flag => {
        requireValid(typeof flag === "boolean", "Fullscreen flag must be a boolean");
        return ipcRenderer.invoke("config-write-window-state", flag);
    },
    readTheme: name => {
        requireValid(typeof name === "string", "Theme name must be a string");
        return ipcRenderer.invoke("theme-read", name);
    },
    listThemes: () => {
        return ipcRenderer.invoke("theme-list");
    },
    readKeyboardLayout: name => {
        requireValid(typeof name === "string", "Keyboard layout name must be a string");
        return ipcRenderer.invoke("keyboard-read", name);
    },
    listKeyboardLayouts: () => {
        return ipcRenderer.invoke("keyboard-list");
    },
    readBootLog: () => {
        return ipcRenderer.invoke("boot-log-read");
    },
    isArchLinux: () => {
        return ipcRenderer.invoke("os-is-arch");
    },
    getSystemUptime: () => {
        return ipcRenderer.invoke("os-uptime");
    },
    getUsername: () => {
        return ipcRenderer.invoke("os-username");
    },
    getFileIcons: () => {
        return ipcRenderer.invoke("assets-file-icons");
    },
    getGlobeGrid: () => {
        return ipcRenderer.invoke("assets-globe-grid");
    },
    getTerminalPalette: (baseColor, colorFilter) => {
        requireValid(typeof baseColor === "string", "Base color must be a string");
        requireValid(Array.isArray(colorFilter) && colorFilter.every(step => typeof step === "string"), "Color filter must be a list of strings");
        return ipcRenderer.invoke("terminal-palette", baseColor, colorFilter);
    },
    readDir: dir => {
        requireValid(typeof dir === "string", "Folder path must be a string");
        return ipcRenderer.invoke("fs-read-dir", dir);
    },
    pathExists: target => {
        requireValid(typeof target === "string", "Path must be a string");
        return ipcRenderer.invoke("fs-exists", target);
    },
    readTextFile: file => {
        requireValid(typeof file === "string", "File path must be a string");
        return ipcRenderer.invoke("fs-read-text", file);
    },
    writeTextFile: (file, content) => {
        requireValid(typeof file === "string", "File path must be a string");
        requireValid(typeof content === "string", "File content must be a string");
        return ipcRenderer.invoke("fs-write-text", file, content);
    },
    getFileType: name => {
        requireValid(typeof name === "string", "File name must be a string");
        return ipcRenderer.invoke("fs-file-type", name);
    },
    watchDir: dir => {
        requireValid(typeof dir === "string", "Folder path must be a string");
        ipcRenderer.send("fs-watch-start", dir);
    },
    unwatchDir: () => {
        ipcRenderer.send("fs-watch-stop");
    },
    onDirChange: callback => {
        return listen("fs-watch-event", callback);
    },
    startGeoIP: () => {
        return ipcRenderer.invoke("geoip-start");
    },
    geoLookup: ip => {
        requireValid(typeof ip === "string", "IP address must be a string");
        return ipcRenderer.invoke("geoip-lookup", ip);
    },
    lookupPublicIP: localAddress => {
        requireValid(typeof localAddress === "string", "Local address must be a string");
        return ipcRenderer.invoke("netstat-public-ip", localAddress);
    },
    ping: (target, localAddress) => {
        requireValid(typeof target === "string", "Ping target must be a string");
        requireValid(typeof localAddress === "string", "Local address must be a string");
        return ipcRenderer.invoke("netstat-ping", target, localAddress);
    }
});

contextBridge.exposeInMainWorld("vindex", vindex);

webFrame.setVisualZoomLevelLimits(1, 1);
