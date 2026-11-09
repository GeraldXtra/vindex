# Vindex

Vindex is a fullscreen terminal with live system monitors, a network globe, a file browser and an on screen keyboard.

It started as a fork of eDEX-UI by Gabriel Saillard, which was archived in October 2021. I'm rebuilding it on a current version of Electron with a locked down window, and a brand new interface is on the way.

Vindex is in early development. There's no installer yet, and so far I've only tested it on Windows 11.

## Run it from source

You need Node.js 22.12 or newer and Git.

    git clone https://github.com/GeraldXtra/vindex.git
    cd vindex
    npm run install-windows
    npm start

On Linux or macOS, run `npm run install-linux` instead of `npm run install-windows`. On Linux you also need Python 3, make and a C++ compiler, because `node-pty` gets built there.

If PowerShell blocks `npm`, type `npm.cmd` instead.

## Privacy

Vindex has no telemetry. For now, the network panel still talks to a few outside services. Every time Vindex starts, it checks GitHub for a free GeoIP database and downloads it when needed. While it runs, it looks up your public IP address at myexternalip.com and connects to 1.1.1.1 to measure your ping. A later update will keep all of this off until you turn it on.

## Security

If you find a security problem, please report it privately. See [SECURITY.md](SECURITY.md).

## Credits

Vindex is based on [eDEX-UI](https://github.com/GitSquared/edex-ui), made by Gabriel "Squared" Saillard and its contributors.

The sound effects were composed by [IceWolf](https://soundcloud.com/iamicewolf) for eDEX-UI.

The globe is [ENCOM Globe](https://github.com/arscan/encom-globe) by Rob "Arscan" Scanlon.

The fonts are [Doto](https://fonts.google.com/specimen/Doto), [Barlow Semi Condensed](https://fonts.google.com/specimen/Barlow+Semi+Condensed) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/), all under the SIL Open Font License 1.1.

Thanks to the people behind [xterm.js](https://github.com/xtermjs/xterm.js), [systeminformation](https://github.com/sebhildebrandt/systeminformation) and [SmoothieCharts](https://github.com/joewalnes/smoothie).

## License

Vindex is licensed under the GNU General Public License version 3, the same license as eDEX-UI. See [LICENSE](LICENSE). Vindex is a modified version of eDEX-UI, and my changes started in November 2026.
