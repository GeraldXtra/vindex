class Terminal {
    constructor(opts) {
        if (opts.role === "client") {
            if (!opts.parentId) throw "Missing options";

            this.xTerm = window.Terminal;
            const FitAddon = window.FitAddon.FitAddon;
            const WebglAddon = window.WebglAddon.WebglAddon;

            this.port = opts.port || 3000;
            this.cwd = "";
            this.oncwdchange = () => {};

            this._sendSizeToServer = () => {
                let cols = this.term.cols.toString();
                let rows = this.term.rows.toString();
                while (cols.length < 3) {
                    cols = "0"+cols;
                }
                while (rows.length < 3) {
                    rows = "0"+rows;
                }
                window.vindex.terminalResize(this.port, cols, rows);
            };

            let palette = window.terminalPalette || {};

            this.term = new this.xTerm({
                cols: 80,
                rows: 24,
                cursorBlink: window.theme.terminal.cursorBlink || true,
                cursorStyle: window.theme.terminal.cursorStyle || "block",
                allowTransparency: window.theme.terminal.allowTransparency || false,
                fontFamily: window.theme.terminal.fontFamily || "Fira Mono",
                fontSize: window.theme.terminal.fontSize || window.settings.termFontSize || 15,
                fontWeight: window.theme.terminal.fontWeight || "normal",
                fontWeightBold: window.theme.terminal.fontWeightBold || "bold",
                letterSpacing: window.theme.terminal.letterSpacing || 0,
                lineHeight: window.theme.terminal.lineHeight || 1,
                scrollback: 1500,
                bellStyle: "none",
                theme: {
                    foreground: window.theme.terminal.foreground,
                    background: window.theme.terminal.background,
                    cursor: window.theme.terminal.cursor,
                    cursorAccent: window.theme.terminal.cursorAccent,
                    selection: window.theme.terminal.selection,
                    black: window.theme.colors.black || palette.black,
                    red: window.theme.colors.red || palette.red,
                    green: window.theme.colors.green || palette.green,
                    yellow: window.theme.colors.yellow || palette.yellow,
                    blue: window.theme.colors.blue || palette.blue,
                    magenta: window.theme.colors.magenta || palette.magenta,
                    cyan: window.theme.colors.cyan || palette.cyan,
                    white: window.theme.colors.white || palette.white,
                    brightBlack: window.theme.colors.brightBlack || palette.brightBlack,
                    brightRed: window.theme.colors.brightRed || palette.brightRed,
                    brightGreen: window.theme.colors.brightGreen || palette.brightGreen,
                    brightYellow: window.theme.colors.brightYellow || palette.brightYellow,
                    brightBlue: window.theme.colors.brightBlue || palette.brightBlue,
                    brightMagenta: window.theme.colors.brightMagenta || palette.brightMagenta,
                    brightCyan: window.theme.colors.brightCyan || palette.brightCyan,
                    brightWhite: window.theme.colors.brightWhite || palette.brightWhite
                }
            });
            let fitAddon = new FitAddon();
            this.term.loadAddon(fitAddon);
            this.term.open(document.getElementById(opts.parentId));
            this.term.loadAddon(new WebglAddon());
            this.term.attachCustomKeyEventHandler(e => {
                window.keyboard.keydownHandler(e);
                return true;
            });
            // Prevent soft-keyboard on touch devices #733
            document.querySelectorAll('.xterm-helper-textarea').forEach(textarea => textarea.setAttribute('readonly', 'readonly'))
            this.term.focus();

            window.vindex.terminalStartup(this.port);
            this._ipcListener = (...args) => {
                switch(args[0]) {
                    case "Output":
                        this.term.write(args[1]);

                        let d = Date.now();

                        if (d - this.lastSoundFX > 30) {
                            if(window.passwordMode == "false")
                                window.audioManager.stdout.play();
                            this.lastSoundFX = d;
                        }
                        if (d - this.lastRefit > 10000) {
                            this.fit();
                        }

                        // See #397
                        if (!window.settings.experimentalGlobeFeatures) return;
                        let ips = args[1].match(/((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
                        if (ips !== null && ips.length >= 1) {
                            ips = ips.filter((val, index, self) => { return self.indexOf(val) === index; });
                            ips.forEach(ip => {
                                window.mods.globe.addTemporaryConnectedMarker(ip);
                            });
                        }
                        break;
                    case "Exit":
                        this._removeIpcListener();
                        if (this.onclose) {
                            this.onclose();
                        }
                        break;
                    case "New cwd":
                        this.cwd = args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "Fallback cwd":
                        this.cwd = "FALLBACK |-- "+args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "New process":
                        if (this.onprocesschange) {
                            this.onprocesschange(args[1]);
                        }
                        break;
                    default:
                        return;
                }
            };
            this._removeIpcListener = window.vindex.onTerminalMessage(this.port, this._ipcListener);
            this.resendCWD = () => {
                this.oncwdchange(this.cwd || null);
            };

            this.term.onData(data => {
                window.vindex.terminalWrite(this.port, data);
            });
            this.term.onBinary(data => {
                let buffer = new Uint8Array(data.length);
                for (let i = 0; i < data.length; i++) {
                    buffer[i] = data.charCodeAt(i) & 255;
                }
                window.vindex.terminalWriteBinary(this.port, buffer);
            });

            this.lastSoundFX = Date.now();

            let parent = document.getElementById(opts.parentId);
            parent.addEventListener("wheel", e => {
                this.term.scrollLines(Math.round(e.deltaY/10));
            });
            this._lastTouchY = null;
            parent.addEventListener("touchstart", e => {
                this._lastTouchY = e.targetTouches[0].screenY;
            });
            parent.addEventListener("touchmove", e => {
                if (this._lastTouchY) {
                    let y = e.changedTouches[0].screenY;
                    let deltaY = y - this._lastTouchY;
                    this._lastTouchY = y;
                    this.term.scrollLines(-Math.round(deltaY/10));
                }
            });
            parent.addEventListener("touchend", e => {
                this._lastTouch = null;
            });
            parent.addEventListener("touchcancel", e => {
                this._lastTouch = null;
            });

            document.querySelector(".xterm-helper-textarea").addEventListener("keydown", e => {
                if (e.key === "F11" && window.settings.allowWindowed) {
                    e.preventDefault();
                    window.toggleFullScreen();
                }
            });

            this.fit = () => {
                this.lastRefit = Date.now();
                let {cols, rows} = fitAddon.proposeDimensions();

                // Apply custom fixes based on screen ratio, see #302
                let w = screen.width;
                let h = screen.height;
                let x = 1;
                let y = 0;

                function gcd(a, b) {
                    return (b == 0) ? a : gcd(b, a%b);
                }
                let d = gcd(w, h);

                if (d === 100) { y = 1; x = 3;}
                // if (d === 120) y = 1;
                if (d === 256) x = 2;

                if (window.settings.termFontSize < 15) y = y - 1;

                cols = cols+x;
                rows = rows+y;

                if (this.term.cols !== cols || this.term.rows !== rows) {
                    this.resize(cols, rows);
                }
            };

            this.resize = (cols, rows) => {
                this.term.resize(cols, rows);
                this._sendSizeToServer();
            };

            this.write = cmd => {
                window.vindex.terminalWrite(this.port, cmd);
            };

            this.writelr = cmd => {
                window.vindex.terminalWrite(this.port, cmd+"\r");
            };

            this.clipboard = {
                copy: () => {
                    if (!this.term.hasSelection()) return false;
                    window.vindex.writeClipboardText(this.term.getSelection());
                    this.term.clearSelection();
                    this.clipboard.didCopy = true;
                },
                paste: () => {
                    window.vindex.readClipboardText().then(text => this.write(text));
                    this.clipboard.didCopy = false;
                },
                didCopy: false
            };

            this.fit();

        } else if (opts.role === "server") {

            this.Pty = require("node-pty");
            this.Ipc = require("electron").ipcMain;
            const signale = require("signale");

            this.renderer = null;
            this.port = opts.port || 3000;

            this._closed = false;
            this.onclosed = () => {};
            this.onopened = () => {};
            this.onresize = () => {};
            this.ondisconnected = () => {};

            this._disableCWDtracking = false;
            this._getTtyCWD = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty.pid;
                    switch(require("os").type()) {
                        case "Linux":
                            require("fs").readlink(`/proc/${pid}/cwd`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd);
                                }
                            });
                            break;
                        case "Darwin":
                            require("child_process").exec(`lsof -a -d cwd -p ${pid} | tail -1 | awk '{ for (i=9; i<=NF; i++) printf "%s ", $i }'`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._getTtyProcess = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty.pid;
                    switch(require("os").type()) {
                        case "Linux":
                        case "Darwin":
                            require("child_process").exec(`ps -o comm --no-headers --sort=+pid -g ${pid} | tail -1`, (e, proc) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(proc.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._nextTickUpdateTtyCWD = false;
            this._nextTickUpdateProcess = false;
            this._tick = setInterval(() => {
                if (this._nextTickUpdateTtyCWD && this._disableCWDtracking === false) {
                    this._nextTickUpdateTtyCWD = false;
                    this._getTtyCWD(this.tty).then(cwd => {
                        if (this.tty._cwd === cwd) return;
                        this.tty._cwd = cwd;
                        if (this.renderer && !this.renderer.isDestroyed()) {
                            this.renderer.send("terminal_channel-"+this.port, "New cwd", cwd);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while tracking TTY working directory: ", e);
                            this._disableCWDtracking = true;
                            try {
                                this.renderer.send("terminal_channel-"+this.port, "Fallback cwd", opts.cwd || process.env.PWD);
                            } catch(e) {
                                // renderer closed
                            }
                        }
                    });
                }

                if (this.renderer && this._nextTickUpdateProcess) {
                    this._nextTickUpdateProcess = false;
                    this._getTtyProcess(this.tty).then(process => {
                        if (this.tty._process === process) return;
                        this.tty._process = process;
                        if (this.renderer && !this.renderer.isDestroyed()) {
                            this.renderer.send("terminal_channel-"+this.port, "New process", process);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while retrieving TTY subprocess: ", e);
                            try {
                                this.renderer.send("terminal_channel-"+this.port, "New process", "");
                            } catch(e) {
                                // renderer closed
                            }
                        }
                    });
                }
            }, 1000);

            this.tty = this.Pty.spawn(opts.shell || "bash", (opts.params.length > 0 ? opts.params : (process.platform === "win32" ? [] : ["--login"])), {
                name: opts.env.TERM || "xterm-256color",
                cols: 80,
                rows: 24,
                cwd: opts.cwd || process.env.PWD,
                env: opts.env || process.env
            });

            this.tty.onExit(({exitCode, signal}) => {
                this._closed = true;
                this._sendToRenderer("Exit");
                this._detach();
                this.onclosed(exitCode, signal);
            });

            this._rendererId = null;
            this._outputBuffer = [];
            this._watchedSenders = new Map();

            this._sendToRenderer = (...args) => {
                if (this.renderer !== null && !this.renderer.isDestroyed()) {
                    this.renderer.send("terminal_channel-"+this.port, ...args);
                }
            };

            this._disconnect = id => {
                if (this.renderer === null || this._rendererId !== id) return;
                this.renderer = null;
                this._rendererId = null;
                this.ondisconnected();
            };

            this._watchSender = sender => {
                let id = sender.id;
                if (this._watchedSenders.has(id)) return;
                let listeners = {
                    "did-start-navigation": e => {
                        if (e.isMainFrame && !e.isSameDocument && e.url === sender.getURL()) {
                            this._disconnect(id);
                        }
                    },
                    "render-process-gone": () => {
                        this._disconnect(id);
                    },
                    "destroyed": () => {
                        this._watchedSenders.delete(id);
                        this._disconnect(id);
                    }
                };
                Object.keys(listeners).forEach(event => {
                    sender.on(event, listeners[event]);
                });
                this._watchedSenders.set(id, {sender, listeners});
            };

            this._detach = () => {
                this.renderer = null;
                this._rendererId = null;
                this.Ipc.removeListener("terminal_channel-"+this.port, this._ipcGuard);
                this._watchedSenders.forEach(({sender, listeners}) => {
                    if (sender.isDestroyed()) return;
                    Object.keys(listeners).forEach(event => {
                        sender.removeListener(event, listeners[event]);
                    });
                });
                this._watchedSenders.clear();
            };

            this.tty.onData(data => {
                this._nextTickUpdateTtyCWD = true;
                this._nextTickUpdateProcess = true;
                if (this.renderer !== null) {
                    this._sendToRenderer("Output", data);
                } else {
                    this._outputBuffer.push(data);
                }
            });

            this._ipcListener = (e, ...args) => {
                switch(args[0]) {
                    case "Renderer startup":
                        this.renderer = e.sender;
                        this._rendererId = e.sender.id;
                        this._watchSender(e.sender);
                        if (!this._disableCWDtracking && this.tty._cwd) {
                            this._sendToRenderer("New cwd", this.tty._cwd);
                        }
                        if (this._disableCWDtracking) {
                            this._sendToRenderer("Fallback cwd", opts.cwd || process.env.PWD);
                        }
                        if (this._outputBuffer.length > 0) {
                            this._sendToRenderer("Output", this._outputBuffer.join(""));
                            this._outputBuffer = [];
                        }
                        this.onopened(this.tty.pid);
                        break;
                    case "Data":
                        if (this.renderer !== null && e.sender.id === this._rendererId) {
                            this.tty.write(args[1]);
                        }
                        break;
                    case "Binary":
                        if (this.renderer !== null && e.sender.id === this._rendererId) {
                            this.tty.write(Buffer.from(args[1]));
                        }
                        break;
                    case "Resize":
                        let cols = args[1];
                        let rows = args[2];
                        try {
                            this.tty.resize(Number(cols), Number(rows));
                        } catch (error) {
                            //Keep going, it'll work anyways.
                        }
                        this.onresized(cols, rows);
                        break;
                    default:
                        return;
                }
            };
            this._isValidMessage = args => {
                switch(args[0]) {
                    case "Renderer startup":
                        return args.length === 1;
                    case "Data":
                        return args.length === 2 && typeof args[1] === "string";
                    case "Binary":
                        return args.length === 2 && args[1] instanceof Uint8Array;
                    case "Resize":
                        return args.length === 3 && typeof args[1] === "string" && typeof args[2] === "string" && /^[0-9]+$/.test(args[1]) && /^[0-9]+$/.test(args[2]);
                    default:
                        return false;
                }
            };
            this._ipcGuard = (e, ...args) => {
                try {
                    if (typeof opts.isAllowedSender !== "function" || !opts.isAllowedSender(e) || !this._isValidMessage(args)) {
                        signale.warn(`Rejected terminal_channel-${this.port} message from the window`);
                        return;
                    }
                    this._ipcListener(e, ...args);
                } catch(err) {
                    signale.error(`Could not handle terminal_channel-${this.port} message:`, err);
                }
            };
            this.Ipc.on("terminal_channel-"+this.port, this._ipcGuard);

            this.close = () => {
                this._detach();
                this.tty.kill();
                this._closed = true;
            };
        } else {
            throw "Unknown purpose";
        }
    }
}

if (typeof module !== "undefined") {
    module.exports = {
        Terminal
    };
}
