'use strict';

import { Units } from './constants';

export interface CpuUsageSample {
    total: number;
    cores: { name: string; load: number }[];
    source: string;
}

export interface NetworkCounters {
    rx: number;
    tx: number;
    time: number;
}

export interface NetworkRate {
    rx: number;
    tx: number;
}

export interface GpuMetrics {
    name: string;
    utilization: number | null;
    memoryUsedMb: number | null;
    memoryTotalMb: number | null;
    temperatureC: number | null;
}

export function readCpuCurrentSpeed(provider: any): Promise<any> {
    return typeof provider.cpuCurrentSpeed === "function" ? provider.cpuCurrentSpeed() : provider.cpuCurrentspeed();
}

function optionalNumber(value: any): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    let numberValue = Number(value);
    return isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function getGpuName(controller: any, index: number): string {
    let vendor = String(controller.vendor || "").trim();
    let model = String(controller.name || controller.model || "").trim();
    if (vendor && model.toLowerCase().indexOf(vendor.toLowerCase()) !== 0) {
        return `${vendor} ${model}`;
    }
    return model || vendor || `GPU ${index + 1}`;
}

function asArray(value: any): any[] {
    if (value === null || value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function getWindowsGpuKey(name: string): string | null {
    let match = /(luid_0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+)/i.exec(name);
    return match ? match[1].toLowerCase() : null;
}

export function parseWindowsGpuCounters(output: string, controllers: any[]): GpuMetrics[] {
    let data: any = JSON.parse(output.trim());
    let adapterEngines: { [adapter: string]: { [engine: string]: number } } = {};
    asArray(data.Engines).forEach(record => {
        let name = String(record.Name || "");
        let adapter = getWindowsGpuKey(name);
        let utilization = optionalNumber(record.UtilizationPercentage);
        if (!adapter || utilization === null) {
            return;
        }
        let engineMatch = /_eng_(\d+)_engtype_([^_]+)/i.exec(name);
        let engine = engineMatch ? `${engineMatch[1]}:${engineMatch[2].toLowerCase()}` : name.toLowerCase();
        adapterEngines[adapter] = adapterEngines[adapter] || {};
        adapterEngines[adapter][engine] = (adapterEngines[adapter][engine] || 0) + utilization;
    });

    let adapterMemory: { [adapter: string]: { dedicated: number; shared: number } } = {};
    asArray(data.Memory).forEach(record => {
        let adapter = getWindowsGpuKey(String(record.Name || ""));
        let dedicatedBytes = optionalNumber(record.DedicatedUsage);
        let sharedBytes = optionalNumber(record.SharedUsage);
        if (adapter && (dedicatedBytes !== null || sharedBytes !== null)) {
            adapterMemory[adapter] = adapterMemory[adapter] || { dedicated: 0, shared: 0 };
            adapterMemory[adapter].dedicated += dedicatedBytes || 0;
            adapterMemory[adapter].shared += sharedBytes || 0;
        }
    });

    let physicalControllers = (controllers || []).filter(controller => {
        let name = String(controller.name || controller.model || controller.vendor || "").trim();
        return !!name && !/(basic render|remote display|indirect display|virtual display)/i.test(name);
    });
    let adapterKeys = Object.keys(adapterEngines).concat(Object.keys(adapterMemory))
        .filter((key, index, keys) => keys.indexOf(key) === index);
    adapterKeys.sort((left, right) => {
        let leftEngines = Object.keys(adapterEngines[left] || {}).map(engine => adapterEngines[left][engine]);
        let rightEngines = Object.keys(adapterEngines[right] || {}).map(engine => adapterEngines[right][engine]);
        let leftLoad = leftEngines.length > 0 ? Math.max(...leftEngines) : 0;
        let rightLoad = rightEngines.length > 0 ? Math.max(...rightEngines) : 0;
        let leftMemory = adapterMemory[left] ? adapterMemory[left].dedicated + adapterMemory[left].shared : 0;
        let rightMemory = adapterMemory[right] ? adapterMemory[right].dedicated + adapterMemory[right].shared : 0;
        return rightLoad - leftLoad || rightMemory - leftMemory || left.localeCompare(right);
    });
    if (physicalControllers.length > 0) {
        adapterKeys = adapterKeys.slice(0, physicalControllers.length);
    }

    let systemMemoryBytes = optionalNumber(data.SystemMemoryTotal);
    return adapterKeys.map((adapter, index) => {
        let controller = physicalControllers[index] || {};
        let engineLoads = Object.keys(adapterEngines[adapter] || {}).map(engine => adapterEngines[adapter][engine]);
        let utilization = engineLoads.length > 0 ? Math.min(100, Math.max(...engineLoads)) : null;
        let memory = adapterMemory[adapter];
        let controllerName = `${controller.vendor || ""} ${controller.name || controller.model || ""}`;
        let usesSharedMemory = !!controller.vramDynamic || /intel/i.test(controllerName);
        let usedBytes = memory ? (usesSharedMemory ? memory.shared : memory.dedicated) : undefined;
        let memoryTotalMb = optionalNumber(controller.memoryTotal);
        if (usesSharedMemory && systemMemoryBytes !== null) {
            memoryTotalMb = systemMemoryBytes / 2 / 1024 / 1024;
        } else if (memoryTotalMb === null) {
            memoryTotalMb = optionalNumber(controller.vram);
        }
        return {
            name: getGpuName(controller, index),
            utilization: utilization,
            memoryUsedMb: usedBytes === undefined ? null : usedBytes / 1024 / 1024,
            memoryTotalMb: memoryTotalMb,
            temperatureC: optionalNumber(controller.temperatureGpu)
        };
    });
}

export function normalizeGpuControllers(controllers: any[]): GpuMetrics[] {
    return (controllers || []).map((controller, index) => {
        let utilization = optionalNumber(controller.utilizationGpu);
        if (utilization !== null) {
            utilization = Math.min(utilization, 100);
        }
        let memoryUsedMb = optionalNumber(controller.memoryUsed);
        let memoryTotalMb = optionalNumber(controller.memoryTotal);
        if (memoryTotalMb === null) {
            memoryTotalMb = optionalNumber(controller.vram);
        }
        let temperatureC = optionalNumber(controller.temperatureGpu);
        return {
            name: getGpuName(controller, index),
            utilization: utilization,
            memoryUsedMb: memoryUsedMb,
            memoryTotalMb: memoryTotalMb,
            temperatureC: temperatureC
        };
    }).filter(gpu => gpu.utilization !== null || gpu.memoryUsedMb !== null || gpu.temperatureC !== null);
}

export function formatGpuMemory(megabytes: number, precision: number): string {
    if (megabytes >= 1024) {
        return `${(megabytes / 1024).toFixed(precision)} GB`;
    }
    return `${megabytes.toFixed(precision)} MB`;
}

export function formatGpuDisplay(gpus: GpuMetrics[], precision: number): string {
    let parts: string[] = [];
    let utilizations = gpus.filter(gpu => gpu.utilization !== null).map(gpu => gpu.utilization as number);
    if (utilizations.length > 0) {
        parts.push(`${Math.max(...utilizations).toFixed(precision)}%`);
    }

    let memorySamples = gpus.filter(gpu => gpu.memoryUsedMb !== null && gpu.memoryTotalMb !== null);
    if (memorySamples.length > 0) {
        let used = memorySamples.reduce((total, gpu) => total + (gpu.memoryUsedMb as number), 0);
        let available = memorySamples.reduce((total, gpu) => total + (gpu.memoryTotalMb as number), 0);
        parts.push(`${formatGpuMemory(used, precision)}/${formatGpuMemory(available, precision)}`);
    }

    let temperatures = gpus.filter(gpu => gpu.temperatureC !== null).map(gpu => gpu.temperatureC as number);
    if (temperatures.length > 0) {
        parts.push(`${Math.max(...temperatures).toFixed(precision)} C`);
    }
    return parts.length > 0 ? `$(circuit-board) GPU ${parts.join(" ")}` : "";
}

export function formatGpuTooltip(gpus: GpuMetrics[], precision: number): string {
    let details = gpus.map(gpu => {
        let lines = [gpu.name];
        lines.push(`  Utilization: ${gpu.utilization === null ? "Unavailable" : `${gpu.utilization.toFixed(precision)}%`}`);
        if (gpu.memoryUsedMb !== null && gpu.memoryTotalMb !== null) {
            lines.push(`  Memory: ${formatGpuMemory(gpu.memoryUsedMb, precision)}/${formatGpuMemory(gpu.memoryTotalMb, precision)} used`);
        } else if (gpu.memoryTotalMb !== null) {
            lines.push(`  Memory: ${formatGpuMemory(gpu.memoryTotalMb, precision)} total (usage unavailable)`);
        } else {
            lines.push("  Memory: Unavailable");
        }
        lines.push(`  Temperature: ${gpu.temperatureC === null ? "Unavailable" : `${gpu.temperatureC.toFixed(precision)} C`}`);
        return lines.join("\n");
    });
    return `GPU metrics\n${details.join("\n\n")}`;
}

export function normalizeCpuLoad(load: number): number {
    if (!isFinite(load)) {
        return 0;
    }
    return Math.min(Math.max(load, 0), 100);
}

export function parseWindowsProcessorUtility(output: string): CpuUsageSample {
    let parsed: any = JSON.parse(output.trim());
    let records: any[] = Array.isArray(parsed) ? parsed : [parsed];
    let totalRecord = records.filter(record => String(record.Name).toLowerCase() === "_total")[0];
    let total = totalRecord ? Number(totalRecord.PercentProcessorUtility) : NaN;
    if (!isFinite(total)) {
        throw new Error("Windows Processor Utility total is unavailable");
    }

    let cores = records
        .filter(record => String(record.Name).toLowerCase().indexOf("_total") === -1)
        .map(record => ({
            name: `Logical processor ${record.Name}`,
            load: normalizeCpuLoad(Number(record.PercentProcessorUtility))
        }));

    return {
        total: normalizeCpuLoad(total),
        cores: cores,
        source: "Windows Processor Utility"
    };
}

export function calculateNetworkRate(previous: NetworkCounters | undefined, current: NetworkCounters): NetworkRate {
    if (!previous) {
        return { rx: 0, tx: 0 };
    }

    let elapsed = Math.max(current.time - previous.time, 1);
    return {
        rx: Math.max(0, (current.rx - previous.rx) * 1000 / elapsed),
        tx: Math.max(0, (current.tx - previous.tx) * 1000 / elapsed)
    };
}

export function formatNetworkRate(bytesPerSecond: number, precision: number): string {
    let unit = Units.None;
    while (bytesPerSecond / unit >= 1024 && unit < Units.G) {
        unit *= 1024;
    }
    let labels: { [unit: number]: string } = { 1: "B/s", 1024: "KB/s", 1048576: "MB/s", 1073741824: "GB/s" };
    return `${(bytesPerSecond / unit).toFixed(precision)} ${labels[unit]}`;
}

export function formatNetworkDisplay(rates: NetworkRate[], precision: number): string {
    let rx = rates.reduce((total, current) => total + current.rx, 0);
    let tx = rates.reduce((total, current) => total + current.tx, 0);
    return `$(arrow-up) ${formatNetworkRate(rx, precision)} $(arrow-down) ${formatNetworkRate(tx, precision)}`;
}
