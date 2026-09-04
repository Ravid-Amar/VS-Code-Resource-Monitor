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
