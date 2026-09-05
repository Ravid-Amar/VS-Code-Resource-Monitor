'use strict';
import { window, commands, ExtensionContext, StatusBarAlignment, StatusBarItem, workspace, WorkspaceConfiguration } from 'vscode';
import { Units, DiskSpaceFormat, DiskSpaceFormatMappings, FreqMappings, MemMappings } from './constants';
import { CpuUsageSample, GpuMetrics, NetworkCounters, calculateNetworkRate, formatGpuDisplay, formatGpuTooltip, formatNetworkDisplay, formatNetworkRate, normalizeCpuLoad, normalizeGpuControllers, parseWindowsGpuCounters, parseWindowsProcessorUtility, readCpuCurrentSpeed } from './metrics';

var si = require('systeminformation');

interface ResourceDisplay {
    text: string;
    tooltip: string;
}

export function activate(context: ExtensionContext) {
    context.subscriptions.push(commands.registerCommand('resmon.openSettings', () => {
        return commands.executeCommand('workbench.action.openSettings', '@ext:RavidAmar.resources-monitor');
    }));
    var resourceMonitor: ResMon = new ResMon();
    resourceMonitor.StartUpdating();
    context.subscriptions.push(resourceMonitor);
}

abstract class Resource {
    protected _config: WorkspaceConfiguration;
    protected _isShownByDefault: boolean;
    protected _configKey: string;
    protected _maxWidth: number;

    constructor(config: WorkspaceConfiguration, isShownByDefault: boolean, configKey: string) {
        this._config = config;
        this._isShownByDefault = isShownByDefault;
        this._configKey = configKey;
        this._maxWidth = 0;
    }

    public async getResourceDisplay(): Promise<ResourceDisplay | null> {
        try {
            if (await this.isShown())
            {
                let display: string = await this.getDisplay();
                if (!display) {
                    return null;
                }
                this._maxWidth = Math.max(this._maxWidth, display.length);

                // Pad out to the correct length such that the length doesn't change
                return {
                    text: display.padEnd(this._maxWidth, ' '),
                    tooltip: await this.getTooltip()
                };
            }
        } catch (error) {
            // A missing sensor or transient platform command must only hide the
            // affected resource; it must not stop every status item from updating.
        }

        return null;
    }

    protected async abstract getDisplay(): Promise<string>;

    protected async getTooltip(): Promise<string> {
        return "System Metrics Lens";
    }

    protected async isShown(): Promise<boolean> {
        return Promise.resolve(this._config.get(`show.${this._configKey}`, false));
    }

    public getPrecision(): number {
        return this._config.get("show.precision", 2);
    }

    protected convertBytesToLargestUnit(bytes: number, precision: number = 2): string {
        let unit: Units = Units.None;
        while (bytes/unit >= 1024 && unit < Units.G) {
            unit *= 1024;
        }
        return `${(bytes/unit).toFixed(this.getPrecision())} ${Units[unit]}`;
    }
}

class CpuUsage extends Resource {
    private _sample: CpuUsageSample | null = null;
    private _windowsSample: CpuUsageSample | null = null;
    private _windowsSampleTime: number = 0;
    private _nextWindowsSampleAttempt: number = 0;

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "cpuusage");
    }

    private getWindowsProcessorUtility(): Promise<CpuUsageSample | null> {
        if (process.platform !== "win32") {
            return Promise.resolve(null);
        }

        let now = Date.now();
        // Windows performance counters are intended for sampling no more than
        // once per second. Reuse the latest value when a faster refresh rate is
        // configured, and avoid repeatedly launching PowerShell after a failure.
        if (this._windowsSample && now - this._windowsSampleTime < 1000) {
            return Promise.resolve(this._windowsSample);
        }
        if (now < this._nextWindowsSampleAttempt) {
            return Promise.resolve(null);
        }

        let childProcess = require("child_process");
        let command = "$ErrorActionPreference='Stop'; " +
            "Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ProcessorInformation " +
            "| Select-Object Name,PercentProcessorUtility | ConvertTo-Json -Compress";

        return new Promise<CpuUsageSample | null>((resolve) => {
            childProcess.execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
                { timeout: 3000 }, (error: any, stdout: string) => {
                    if (error || !stdout.trim()) {
                        this._nextWindowsSampleAttempt = Date.now() + 60000;
                        resolve(null);
                        return;
                    }

                    try {
                        let sample = parseWindowsProcessorUtility(stdout);
                        this._windowsSample = sample;
                        this._windowsSampleTime = Date.now();
                        this._nextWindowsSampleAttempt = 0;
                        resolve(sample);
                    } catch (parseError) {
                        this._nextWindowsSampleAttempt = Date.now() + 60000;
                        resolve(null);
                    }
                });
        });
    }

    private async sampleCpuUsage(): Promise<CpuUsageSample> {
        let windowsSample = await this.getWindowsProcessorUtility();
        if (windowsSample) {
            return windowsSample;
        }

        let currentLoad = await si.currentLoad();
        return {
            total: normalizeCpuLoad(Number(currentLoad.currentLoad !== undefined ? currentLoad.currentLoad : currentLoad.currentload)),
            cores: (currentLoad.cpus || []).map((cpu: any, index: number) => ({
                name: `Core ${index + 1}`,
                load: normalizeCpuLoad(Number(cpu.load))
            })),
            source: process.platform === "win32" ? "Processor time fallback" : "Processor time"
        };
    }

    async getDisplay(): Promise<string> {
        this._sample = await this.sampleCpuUsage();
        return `$(pulse) ${this._sample.total.toFixed(this.getPrecision())}%`;
    }

    protected async getTooltip(): Promise<string> {
        if (!this._sample) {
            this._sample = await this.sampleCpuUsage();
        }
        let coreLoads = this._sample.cores.map(core => `${core.name}: ${core.load.toFixed(this.getPrecision())}%`);
        let perCore = coreLoads.length > 0 ? `\n\nPer core:\n${coreLoads.join("\n")}` : "";
        return `CPU usage\nTotal: ${this._sample.total.toFixed(this.getPrecision())}%\nSource: ${this._sample.source}${perCore}`;
    }

}

class CpuTemp extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "cputemp");
    }

    protected async isShown(): Promise<boolean> {
        // If the CPU temp sensor cannot retrieve a valid temperature, disallow its reporting.
        var cpuTemp = (await si.cpuTemperature()).main;
        let hasCpuTemp = cpuTemp !== null && cpuTemp !== undefined && isFinite(Number(cpuTemp)) && Number(cpuTemp) >= 0;
        return Promise.resolve(hasCpuTemp && this._config.get("show.cputemp", true));
    }

    async getDisplay(): Promise<string> {
        let currentTemps = await si.cpuTemperature();
        return `$(flame) ${(currentTemps.main).toFixed(this.getPrecision())} C`;
    }

    protected async getTooltip(): Promise<string> {
        let currentTemps = await si.cpuTemperature();
        let coreTemps = (currentTemps.cores || []).map((temperature: number, index: number) => `Core ${index + 1}: ${temperature.toFixed(this.getPrecision())} C`);
        return `CPU temperature\nPackage: ${currentTemps.main.toFixed(this.getPrecision())} C${coreTemps.length > 0 ? `\n\nPer core:\n${coreTemps.join("\n")}` : ""}`;
    }
}

class CpuFreq extends Resource {
    constructor(config: WorkspaceConfiguration) {
        super(config, true, "cpufreq");
    }

    private readTextFile(path: string): Promise<string> {
        let fs = require("fs");
        return new Promise<string>((resolve, reject) => {
            fs.readFile(path, "utf8", (error: any, data: string) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(data);
            });
        });
    }

    private async getLinuxCurrentSpeedHz(): Promise<number | null> {
        if (process.platform !== "linux") {
            return null;
        }

        try {
            // cpufreq exposes the current speed in kHz when the driver makes
            // it available. It is the most direct source for Linux systems.
            let scalingFrequency = parseFloat(await this.readTextFile("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq"));
            if (!isNaN(scalingFrequency) && scalingFrequency > 0) {
                return scalingFrequency * Units.K;
            }
        } catch (error) {
            // This file is not provided by every CPU driver or virtual machine.
        }

        try {
            // /proc/cpuinfo remains available on many systems where cpufreq is
            // unavailable, including the environment that returns zero from
            // systeminformation's cpuCurrentspeed API.
            let cpuInfo = await this.readTextFile("/proc/cpuinfo");
            let cpuFrequency = /^cpu MHz\s*:\s*([0-9.]+)/m.exec(cpuInfo);
            if (cpuFrequency) {
                let frequencyMHz = parseFloat(cpuFrequency[1]);
                if (!isNaN(frequencyMHz) && frequencyMHz > 0) {
                    return frequencyMHz * Units.M;
                }
            }
        } catch (error) {
            // Keep the cross-platform value below when no Linux fallback works.
        }

        return null;
    }

    private async getCurrentSpeedHz(): Promise<number> {
        let cpuCurrentSpeed = await readCpuCurrentSpeed(si);
        // systeminformation returns frequency in terms of GHz by default.
        let speedHz = parseFloat(cpuCurrentSpeed.avg) * Units.G;
        if (isNaN(speedHz) || speedHz <= 0) {
            let linuxSpeedHz = await this.getLinuxCurrentSpeedHz();
            if (linuxSpeedHz !== null) {
                return linuxSpeedHz;
            }
        }
        return speedHz;
    }

    async getDisplay(): Promise<string> {
        let speedHz = await this.getCurrentSpeedHz();
        let formattedWithUnits = this.getFormattedWithUnits(speedHz);
        return `$(dashboard) ${(formattedWithUnits)}`;
    }

    protected async getTooltip(): Promise<string> {
        let cpuCurrentSpeed = await readCpuCurrentSpeed(si);
        let unit = this._config.get('freq.unit', "GHz");
        let divisor: number = FreqMappings[unit];
        let currentSpeed = await this.getCurrentSpeedHz();
        // Older systeminformation versions can expose zero for every core on
        // Linux. Reuse the verified Linux fallback so the drilldown remains
        // useful even when per-core values are unavailable from the library.
        let cores = (cpuCurrentSpeed.cores || []).map((speed: number, index: number) => {
            let speedHz = speed > 0 ? speed * Units.G : currentSpeed;
            return `Core ${index + 1}: ${(speedHz / divisor).toFixed(this.getPrecision())} ${unit}`;
        });
        return `CPU frequency\nAverage: ${this.getFormattedWithUnits(currentSpeed)}${cores.length > 0 ? `\n\nPer core:\n${cores.join("\n")}` : ""}`;
    }

    getFormattedWithUnits(speedHz: number): string {
        var unit = this._config.get('freq.unit', "GHz");
        var freqDivisor: number = FreqMappings[unit];
        return `${(speedHz / freqDivisor).toFixed(this.getPrecision())} ${unit}`;
    }
}

class Battery extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, false, "battery");
    }

    protected async isShown(): Promise<boolean> {
        let battery = await si.battery();
        let hasBattery = battery.hasBattery !== undefined ? battery.hasBattery : battery.hasbattery;
        return Promise.resolve(hasBattery && this._config.get("show.battery", false));
    }

    async getDisplay(): Promise<string> {
        let rawBattery = await si.battery();
        var percentRemaining = Math.min(Math.max(rawBattery.percent, 0), 100);
        return `$(plug) ${percentRemaining}%`;
    }

    protected async getTooltip(): Promise<string> {
        let battery = await si.battery();
        let lines = [
            "Battery",
            `Charge: ${Math.min(Math.max(battery.percent, 0), 100)}%`,
            `Status: ${(battery.isCharging !== undefined ? battery.isCharging : battery.ischarging) ? "Charging" : "Discharging"}`
        ];
        let timeRemaining = battery.timeRemaining !== undefined ? battery.timeRemaining : battery.timeremaining;
        if (timeRemaining !== null && timeRemaining !== undefined && timeRemaining >= 0) {
            lines.push(`Estimated time remaining: ${timeRemaining} minutes`);
        }
        return lines.join("\n");
    }
}

class Memory extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "mem");
    }
    
    async getDisplay() : Promise<string> {
        let unit = this._config.get('mem.unit', "GB");
        var memDivisor = MemMappings[unit];
        let memoryData = await si.mem();
        let memoryUsedWithUnits = memoryData.active / memDivisor;
        let memoryTotalWithUnits = memoryData.total / memDivisor;
        return `$(ellipsis) ${(memoryUsedWithUnits).toFixed(this.getPrecision())}/${(memoryTotalWithUnits).toFixed(this.getPrecision())} ${unit}`;
    }

    protected async getTooltip(): Promise<string> {
        let memoryData = await si.mem();
        return [
            "Memory",
            `Active: ${this.convertBytesToLargestUnit(memoryData.active)}`,
            `Used: ${this.convertBytesToLargestUnit(memoryData.used)}`,
            `Free: ${this.convertBytesToLargestUnit(memoryData.free)}`,
            `Total: ${this.convertBytesToLargestUnit(memoryData.total)}`,
            `Swap: ${this.convertBytesToLargestUnit(memoryData.swapused)}/${this.convertBytesToLargestUnit(memoryData.swaptotal)} used`
        ].join("\n");
    }
}

class Gpu extends Resource {
    private _gpus: GpuMetrics[] = [];
    private _nextWindowsSampleAttempt: number = 0;

    constructor(config: WorkspaceConfiguration) {
        super(config, false, "gpu");
    }

    private getWindowsGpuMetrics(controllers: any[]): Promise<GpuMetrics[] | null> {
        if (process.platform !== "win32" || Date.now() < this._nextWindowsSampleAttempt) {
            return Promise.resolve(null);
        }

        let childProcess = require("child_process");
        let command = "$ErrorActionPreference='Stop'; $engines=@(); $memory=@(); $systemMemory=$null; " +
            "try { $engines=@(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Select-Object Name,UtilizationPercentage) } catch {}; " +
            "try { $memory=@(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Select-Object Name,DedicatedUsage,SharedUsage) } catch {}; " +
            "try { $systemMemory=(Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory } catch {}; " +
            "[pscustomobject]@{Engines=$engines;Memory=$memory;SystemMemoryTotal=$systemMemory} | ConvertTo-Json -Depth 4 -Compress";

        return new Promise<GpuMetrics[] | null>((resolve) => {
            childProcess.execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
                { timeout: 3000 }, (error: any, stdout: string) => {
                    if (error || !stdout.trim()) {
                        this._nextWindowsSampleAttempt = Date.now() + 60000;
                        resolve(null);
                        return;
                    }
                    try {
                        let metrics = parseWindowsGpuCounters(stdout, controllers);
                        if (metrics.length === 0) {
                            this._nextWindowsSampleAttempt = Date.now() + 60000;
                        } else {
                            this._nextWindowsSampleAttempt = 0;
                        }
                        resolve(metrics);
                    } catch (parseError) {
                        this._nextWindowsSampleAttempt = Date.now() + 60000;
                        resolve(null);
                    }
                });
        });
    }

    async getDisplay(): Promise<string> {
        try {
            let graphics = await si.graphics();
            let controllers = graphics.controllers || [];
            let windowsMetrics = await this.getWindowsGpuMetrics(controllers);
            this._gpus = windowsMetrics === null ? normalizeGpuControllers(controllers) : windowsMetrics;
        } catch (error) {
            this._gpus = [];
        }
        return formatGpuDisplay(this._gpus, this.getPrecision());
    }

    protected async getTooltip(): Promise<string> {
        return formatGpuTooltip(this._gpus, this.getPrecision());
    }
}

class Network extends Resource {
    private _previousSamples: { [interfaceName: string]: NetworkCounters } = {};
    private _rates: { [interfaceName: string]: { rx: number; tx: number } } = {};
    private _sampleAvailable: boolean = false;

    constructor(config: WorkspaceConfiguration) {
        super(config, true, "net");
    }

    private formatRate(bytesPerSecond: number): string {
        return formatNetworkRate(bytesPerSecond, this.getPrecision());
    }

    private getConfiguredInterface(): string {
        return this._config.get('net.interface', "");
    }

    private async getInterfaceStats(): Promise<any[]> {
        this._sampleAvailable = false;
        let networkInterfaces: any;
        try {
            networkInterfaces = await si.networkInterfaces();
        } catch (error) {
            return [];
        }

        let interfaceNames: string[] = Array.isArray(networkInterfaces) ?
            networkInterfaces.map((networkInterface: any) => networkInterface.iface).filter((name: string) => !!name) :
            Object.keys(networkInterfaces);
        let configuredInterface = this.getConfiguredInterface();
        if (configuredInterface) {
            interfaceNames = interfaceNames.filter(name => name === configuredInterface);
        }

        let now = Date.now();
        let stats: any[] = [];
        for (let interfaceName of interfaceNames) {
            try {
                let rawStats = await si.networkStats(interfaceName);
                let networkStats = Array.isArray(rawStats) ? rawStats[0] : rawStats;
                if (!networkStats) {
                    continue;
                }
                let rx = Number(networkStats.rx_bytes) || 0;
                let tx = Number(networkStats.tx_bytes) || 0;
                let current = { rx: rx, tx: tx, time: now };
                let rate = calculateNetworkRate(this._previousSamples[interfaceName], current);
                this._previousSamples[interfaceName] = current;
                this._rates[interfaceName] = rate;
                stats.push({ name: interfaceName, rx: rate.rx, tx: rate.tx });
            } catch (error) {
                // A single unavailable interface must not stop other resources.
            }
        }
        this._sampleAvailable = stats.length > 0;
        return stats;
    }

    async getDisplay(): Promise<string> {
        let stats = await this.getInterfaceStats();
        // Keep the item present if an individual poll fails. Returning an empty
        // string causes the status-bar manager to hide it until a later update.
        return formatNetworkDisplay(stats, this.getPrecision());
    }

    protected async getTooltip(): Promise<string> {
        let interfaceNames = Object.keys(this._rates);
        if (interfaceNames.length === 0) {
            return "Network I/O\nInbound: 0 B/s\nOutbound: 0 B/s\n\nInterface statistics unavailable";
        }
        let lines = interfaceNames.map(interfaceName => {
            let rate = this._rates[interfaceName];
            return `${interfaceName}\n  Inbound ↑: ${this.formatRate(rate.rx)}\n  Outbound ↓: ${this.formatRate(rate.tx)}`;
        });
        let availability = this._sampleAvailable ? "" : "\n\nLatest interface sample unavailable";
        return `Network I/O\n${lines.join("\n\n")}${availability}`;
    }
}

class DiskSpace extends Resource {

    constructor(config: WorkspaceConfiguration) {
        super(config, false, "disk");
    }

    getFormat(): DiskSpaceFormat {
        let format: string | undefined = this._config.get<string>("disk.format");
        if (format) {
            return DiskSpaceFormatMappings[format];
        } else {
            return DiskSpaceFormat.PercentRemaining;
        }
    }

    getDrives(): string[] {
        let drives: string[] | undefined = this._config.get<string[]>("disk.drives");
        if (drives) {
            return drives;
        } else {
            return [];
        }
    }

    getFormattedDiskSpace(fsSize: any): string {
        // `mount` is friendlier on Unix (for example, "/") while `fs` is
        // normally the drive letter on Windows. Older systeminformation
        // versions do not always provide mount, so retain fs as a fallback.
        let driveName = fsSize.mount || fsSize.fs;
        switch (this.getFormat()) {
            case DiskSpaceFormat.PercentRemaining:
                return `${driveName} ${(100 - fsSize.use).toFixed(this.getPrecision())}% free`;
            case DiskSpaceFormat.PercentUsed:
                return `${driveName} ${fsSize.use.toFixed(this.getPrecision())}% used`;
            case DiskSpaceFormat.Remaining:
                return `${driveName} ${this.convertBytesToLargestUnit(fsSize.size - fsSize.used)} free`;
            case DiskSpaceFormat.UsedOutOfTotal:
                return `${driveName} ${this.convertBytesToLargestUnit(fsSize.used)}/${this.convertBytesToLargestUnit(fsSize.size)} used`;
            default:
                return "";
        }
    }

    private isSelectedDrive(fsSize: any, drives: string[]): boolean {
        // systeminformation identifies a volume by fs on Windows and by
        // mount on many Unix platforms. Accept either to keep the setting
        // portable and compatible with older systeminformation releases.
        return drives.indexOf(fsSize.fs) !== -1 || drives.indexOf(fsSize.mount) !== -1;
    }

    private getCurrentDirectory(): string {
        // A workspace folder represents the directory the user is currently
        // working in. Fall back to the extension host's working directory
        // when VS Code has no folder open.
        if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
            return workspace.workspaceFolders[0].uri.fsPath;
        }
        return process.cwd();
    }

    private isDirectoryOnMount(directory: string, mount: string): boolean {
        let normalizedDirectory = directory.replace(/\\/g, "/");
        let normalizedMount = mount.replace(/\\/g, "/");
        if (process.platform === "win32") {
            normalizedDirectory = normalizedDirectory.toLowerCase();
            normalizedMount = normalizedMount.toLowerCase();
        }

        if (normalizedMount === "/") {
            return normalizedDirectory.indexOf("/") === 0;
        }

        if (normalizedMount.charAt(normalizedMount.length - 1) !== "/") {
            normalizedMount += "/";
        }
        return normalizedDirectory === normalizedMount.slice(0, -1) || normalizedDirectory.indexOf(normalizedMount) === 0;
    }

    private getCurrentDirectoryVolume(fsSizes: any[]): any | null {
        let directory = this.getCurrentDirectory();
        let matchingVolumes = fsSizes.filter((fsSize: any) => fsSize.mount && this.isDirectoryOnMount(directory, fsSize.mount));
        // Nested mount points must win: /home/user on /home, not on /.
        matchingVolumes.sort((left, right) => right.mount.length - left.mount.length);
        return matchingVolumes.length > 0 ? matchingVolumes[0] : null;
    }

    async getDisplay(): Promise<string> {
        let fsSizes = await si.fsSize();
        let drives = this.getDrives();
        let selectedDrives: any[];
        if (drives.length > 0) {
            selectedDrives = fsSizes.filter((fsSize: any) => fsSize.size > 0 && this.isSelectedDrive(fsSize, drives));
        } else {
            let currentDirectoryVolume = this.getCurrentDirectoryVolume(fsSizes);
            selectedDrives = currentDirectoryVolume && currentDirectoryVolume.size > 0 ? [currentDirectoryVolume] : [];
        }

        let formattedDrives = selectedDrives.map((fsSize: any) => this.getFormattedDiskSpace(fsSize));
        return formattedDrives.length > 0 ? `$(database) ${formattedDrives.join(", ")}` : "";
    }

    protected async getTooltip(): Promise<string> {
        let fsSizes = await si.fsSize();
        let volumes = fsSizes.filter((fsSize: any) => fsSize.size > 0).map((fsSize: any) => {
            let volumeName = fsSize.mount || fsSize.fs;
            return `${volumeName} (${fsSize.fs})\n  ${fsSize.use.toFixed(this.getPrecision())}% used — ${this.convertBytesToLargestUnit(fsSize.used)} of ${this.convertBytesToLargestUnit(fsSize.size)}\n  ${this.convertBytesToLargestUnit(fsSize.size - fsSize.used)} free`;
        });
        return `Disks and partitions\n${volumes.join("\n\n")}`;
    }
}


class ResMon {
    private _statusBarItems: StatusBarItem[];
    private _config: WorkspaceConfiguration;
    private _updating: boolean;
    private _resources: Resource[];

    constructor() {
        this._config = workspace.getConfiguration('resmon');
        this._updating = false;

        // Add all resources to monitor
        this._resources = [];
        this._resources.push(new CpuUsage(this._config));
        this._resources.push(new CpuFreq(this._config));
        this._resources.push(new Battery(this._config));
        this._resources.push(new Memory(this._config));
        this._resources.push(new Gpu(this._config));
        this._resources.push(new DiskSpace(this._config));
        this._resources.push(new CpuTemp(this._config));
        this._resources.push(new Network(this._config));
        this._statusBarItems = [];
        this._createStatusBarItems(this._config.get('alignLeft') ? StatusBarAlignment.Left : StatusBarAlignment.Right);
    }

    public StartUpdating() {
        this._updating = true;
        this.update();
    }

    public StopUpdating() {
        this._updating = false;
    }
    
    private _getColor() : string {
        const defaultColor = "#FFFFFF";

        // Enforce #RRGGBB format
        let hexColorCodeRegex = /^#[0-9A-F]{6}$/i;
        let configColor = this._config.get('color', defaultColor);
        if (!hexColorCodeRegex.test(configColor)) {
            configColor = defaultColor;
        }

        return configColor;
    }

    private _createStatusBarItems(alignment: StatusBarAlignment) {
        this._statusBarItems.forEach(statusBarItem => statusBarItem.dispose());
        this._statusBarItems = this._resources.map((resource, index) => {
            // Higher priority appears further left within an alignment group,
            // retaining the resource order used by the original single item.
            let statusBarItem = window.createStatusBarItem(alignment, this._resources.length - index);
            statusBarItem.color = this._getColor();
            return statusBarItem;
        });
    }

    private async update() {
        if (this._updating) {

            // Update the configuration in case it has changed
            this._config = workspace.getConfiguration('resmon');

            // Update the status bar item's styling
            let proposedAlignment = this._config.get('alignLeft') ? StatusBarAlignment.Left : StatusBarAlignment.Right;
            if (this._statusBarItems.length > 0 && proposedAlignment !== this._statusBarItems[0].alignment) {
                this._createStatusBarItems(proposedAlignment);
            } else {
                this._statusBarItems.forEach(statusBarItem => statusBarItem.color = this._getColor());
            }

            // Get the display of the requested resources
            let pendingUpdates: Promise<ResourceDisplay | null>[] = this._resources.map(resource => resource.getResourceDisplay());

            // Keep resources in separate items so each one has an independent
            // hover target and can expose detailed information in its tooltip.
            await Promise.all(pendingUpdates).then(finishedUpdates => {
                finishedUpdates.forEach((resourceDisplay, index) => {
                    let statusBarItem = this._statusBarItems[index];
                    if (resourceDisplay) {
                        statusBarItem.text = resourceDisplay.text;
                        statusBarItem.tooltip = resourceDisplay.tooltip;
                        statusBarItem.show();
                    } else {
                        statusBarItem.hide();
                    }
                });
            });

            setTimeout(() => this.update(), this._config.get('updatefrequencyms', 2000));
        }
    }

    dispose() {
        this.StopUpdating();
        this._statusBarItems.forEach(statusBarItem => statusBarItem.dispose());
    }
}

export function deactivate() {
}
