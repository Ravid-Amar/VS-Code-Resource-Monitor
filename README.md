# Resource Monitor

This fork is maintained at [Ravid-Amar/VS-Code-Resource-Monitor](https://github.com/Ravid-Amar/VS-Code-Resource-Monitor). It is based on [Njanderson/resmon](https://github.com/Njanderson/resmon); credit and thanks go to Nick Anderson and the original contributors.

## Features

Display CPU frequency, usage, memory consumption, disk usage, network inbound/outbound rates, and battery percentage remaining within the VSCode status bar. Disk usage is enabled by default and is shown in a compact, MobaXterm-style status-bar indicator for the partition that contains the current workspace.

Hover any status-bar indicator for a detailed drilldown. CPU usage and frequency show every core, and disk usage lists every detected disk and partition.

## Screenshots

![Resource Monitor status-bar preview showing CPU, memory, disk, and network statistics](images/status-bar-preview.png)

## Requirements

There are no external runtime dependencies to install. Windows CPU readings use built-in PowerShell and CIM when available.

## Extension Settings

- `resmon.show.cpuusage`: Show CPU usage. On Windows, the extension uses the Processor Utility counter so the value follows Task Manager's CPU calculation; if that counter is unavailable, it falls back to processor time.
- `resmon.show.cpufreq`: Show CPU Frequency. This may just display a static frequency on Windows.
- `resmon.show.mem`: Show consumed and total memory as a fraction.
- `resmon.show.battery`: Show battery percentage remaining.
- `resmon.show.disk`: Show disk usage information.
- `resmon.show.net`: Show network inbound and outbound rates.
- `resmon.net.interface`: Network interface to monitor. Leave empty to aggregate all interfaces.
- `resmon.show.cputemp`: Show CPU temperature. May not work without the lm-sensors module on Linux. May require running VS Code as admin on Windows.
- `resmon.disk.format`: Configures how disk usage is displayed (percentage used/free, absolute free, or used out of total). Defaults to `PercentUsed`.
- `resmon.disk.drives`: Drives or mount points to show. Leave empty to monitor the partition containing the current workspace. For example, `C:` on Windows and `/` on Linux.
- `resmon.updatefrequencyms`: How frequently to query systeminformation. The minimum is 200 ms as to prevent accidentally updating so fast as to freeze up your machine.
- `resmon.freq.unit`: Unit used for the CPU frequency (GHz-Hz).
- `resmon.mem.unit`: Unit used for the RAM consumption (GB-B).
- `resmon.alignLeft`: Toggles the alignment of the status bar.
- `resmon.color`: Color of the status bar text in hex code (for example, #FFFFFF is white). The color must be in the format #RRGGBB, using hex digits.
- `Resource Monitor: Open Settings`: Open Resource Monitor settings from the Command Palette.

Open the Command Palette with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> (or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on macOS), then run **Resource Monitor: Open Settings**.

## Development

```bash
npm ci
npm test
npm run verify:data
```

`npm test` runs deterministic unit and manifest tests. `npm run verify:data` performs a live sanity check against the current machine's CPU, memory, filesystem, and network data sources.

See [CHANGELOG.md](CHANGELOG.md) for release history.
