'use strict';

import * as assert from 'assert';
import {
    calculateNetworkRate,
    formatGpuDisplay,
    formatGpuTooltip,
    formatNetworkDisplay,
    formatNetworkRate,
    normalizeCpuLoad,
    normalizeGpuControllers,
    parseWindowsGpuCounters,
    parseWindowsProcessorUtility,
    readCpuCurrentSpeed
} from '../metrics';

describe('CPU metrics', () => {
    it('uses the current CPU-speed API and retains the legacy fallback', async () => {
        let current = await readCpuCurrentSpeed({
            cpuCurrentSpeed: () => Promise.resolve({ avg: 3.5 })
        });
        let legacy = await readCpuCurrentSpeed({
            cpuCurrentspeed: () => Promise.resolve({ avg: 2.5 })
        });
        assert.strictEqual(current.avg, 3.5);
        assert.strictEqual(legacy.avg, 2.5);
    });

    it('clamps CPU load to a valid percentage', () => {
        assert.strictEqual(normalizeCpuLoad(-5), 0);
        assert.strictEqual(normalizeCpuLoad(42.5), 42.5);
        assert.strictEqual(normalizeCpuLoad(105), 100);
        assert.strictEqual(normalizeCpuLoad(NaN), 0);
    });

    it('parses Windows Processor Utility totals and logical processors', () => {
        let sample = parseWindowsProcessorUtility(JSON.stringify([
            { Name: '_Total', PercentProcessorUtility: 37 },
            { Name: '0,_Total', PercentProcessorUtility: 37 },
            { Name: '0,0', PercentProcessorUtility: 25 },
            { Name: '0,1', PercentProcessorUtility: 140 }
        ]));

        assert.strictEqual(sample.total, 37);
        assert.strictEqual(sample.source, 'Windows Processor Utility');
        assert.deepStrictEqual(sample.cores, [
            { name: 'Logical processor 0,0', load: 25 },
            { name: 'Logical processor 0,1', load: 100 }
        ]);
    });

    it('accepts the single-object JSON emitted for one record', () => {
        let sample = parseWindowsProcessorUtility('{"Name":"_Total","PercentProcessorUtility":"12"}');
        assert.strictEqual(sample.total, 12);
        assert.deepStrictEqual(sample.cores, []);
    });

    it('rejects output without a usable total', () => {
        assert.throws(() => parseWindowsProcessorUtility('{"Name":"0,0","PercentProcessorUtility":20}'));
        assert.throws(() => parseWindowsProcessorUtility('not json'));
    });
});

describe('network metrics', () => {
    it('returns zero for the first counter sample', () => {
        assert.deepStrictEqual(calculateNetworkRate(undefined, { rx: 1000, tx: 500, time: 1000 }), { rx: 0, tx: 0 });
    });

    it('calculates bytes per second from counter deltas', () => {
        let rate = calculateNetworkRate(
            { rx: 1000, tx: 500, time: 1000 },
            { rx: 3048, tx: 1524, time: 2000 }
        );
        assert.deepStrictEqual(rate, { rx: 2048, tx: 1024 });
    });

    it('does not report negative rates after a counter reset', () => {
        let rate = calculateNetworkRate(
            { rx: 5000, tx: 4000, time: 1000 },
            { rx: 10, tx: 20, time: 2000 }
        );
        assert.deepStrictEqual(rate, { rx: 0, tx: 0 });
    });

    it('formats rates using binary units and configured precision', () => {
        assert.strictEqual(formatNetworkRate(512, 2), '512.00 B/s');
        assert.strictEqual(formatNetworkRate(1536, 1), '1.5 KB/s');
        assert.strictEqual(formatNetworkRate(2 * 1024 * 1024, 0), '2 MB/s');
    });

    it('aggregates interfaces with the requested arrow directions', () => {
        let display = formatNetworkDisplay([
            { rx: 1024, tx: 2048 },
            { rx: 2048, tx: 1024 }
        ], 2);
        assert.strictEqual(display, '$(arrow-up) 3.00 KB/s $(arrow-down) 3.00 KB/s');
    });

    it('keeps a zero-rate display when no interface sample is available', () => {
        assert.strictEqual(
            formatNetworkDisplay([], 2),
            '$(arrow-up) 0.00 B/s $(arrow-down) 0.00 B/s'
        );
    });
});

describe('GPU metrics', () => {
    it('parses Windows GPU engine and adapter-memory counters', () => {
        let output = JSON.stringify({
            Engines: [
                { Name: 'pid_100_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D', UtilizationPercentage: 20 },
                { Name: 'pid_200_luid_0x00000000_0x00000001_phys_0_eng_0_engtype_3D', UtilizationPercentage: 15 },
                { Name: 'pid_100_luid_0x00000000_0x00000001_phys_0_eng_1_engtype_Copy', UtilizationPercentage: 60 },
                { Name: 'pid_300_luid_0x00000000_0x00000002_phys_0_eng_0_engtype_3D', UtilizationPercentage: 12 }
            ],
            Memory: [
                {
                    Name: 'luid_0x00000000_0x00000001_phys_0',
                    DedicatedUsage: 1073741824,
                    SharedUsage: 536870912
                }
            ]
        });
        let gpus = parseWindowsGpuCounters(output, [
            { vendor: 'AMD', model: 'Radeon 780M', vram: 4096 },
            { vendor: 'Intel', model: 'Arc A380', vram: 6144 }
        ]);

        assert.deepStrictEqual(gpus, [
            {
                name: 'AMD Radeon 780M', utilization: 60,
                memoryUsedMb: 1024, memoryTotalMb: 4096, temperatureC: null
            },
            {
                name: 'Intel Arc A380', utilization: 12,
                memoryUsedMb: null, memoryTotalMb: 6144, temperatureC: null
            }
        ]);
    });

    it('returns no Windows GPU metrics when performance counters are absent', () => {
        assert.deepStrictEqual(parseWindowsGpuCounters('{"Engines":[],"Memory":[]}', []), []);
    });

    it('filters phantom Windows adapters and uses shared memory for Intel GPUs', () => {
        let output = JSON.stringify({
            Engines: [{
                Name: 'pid_2516_luid_0x00000000_0x0001163A_phys_0_eng_0_engtype_3D',
                UtilizationPercentage: 1
            }],
            Memory: [
                {
                    Name: 'luid_0x00000000_0x00011A37_phys_0',
                    DedicatedUsage: 0, SharedUsage: 8192
                },
                {
                    Name: 'luid_0x00000000_0x0001163A_phys_0',
                    DedicatedUsage: 0, SharedUsage: 1990815744
                }
            ],
            SystemMemoryTotal: 17179869184
        });
        let gpus = parseWindowsGpuCounters(output, [{
            vendor: 'Intel', model: 'Iris Xe Graphics', vram: 1024, vramDynamic: true
        }]);

        assert.strictEqual(gpus.length, 1);
        assert.strictEqual(gpus[0].name, 'Intel Iris Xe Graphics');
        assert.strictEqual(gpus[0].utilization, 1);
        assert.ok(Math.abs((gpus[0].memoryUsedMb as number) - 1898.59) < 0.01);
        assert.strictEqual(gpus[0].memoryTotalMb, 8192);
    });

    it('normalizes supported live metrics and preserves valid zero values', () => {
        let gpus = normalizeGpuControllers([
            {
                vendor: 'NVIDIA',
                name: 'GeForce RTX 4070',
                utilizationGpu: 0,
                memoryUsed: 2048,
                memoryTotal: 8192,
                temperatureGpu: 55
            }
        ]);

        assert.deepStrictEqual(gpus, [{
            name: 'NVIDIA GeForce RTX 4070',
            utilization: 0,
            memoryUsedMb: 2048,
            memoryTotalMb: 8192,
            temperatureC: 55
        }]);
    });

    it('omits controllers that expose only static hardware information', () => {
        assert.deepStrictEqual(normalizeGpuControllers([
            { vendor: 'Intel', model: 'Integrated Graphics', vram: 128 }
        ]), []);
    });

    it('formats a multi-GPU summary using peak load and aggregate memory', () => {
        let gpus = normalizeGpuControllers([
            {
                vendor: 'NVIDIA', name: 'GPU A', utilizationGpu: 25,
                memoryUsed: 2048, memoryTotal: 8192, temperatureGpu: 60
            },
            {
                vendor: 'NVIDIA', name: 'GPU B', utilizationGpu: 75,
                memoryUsed: 1024, memoryTotal: 4096, temperatureGpu: 67
            }
        ]);

        assert.strictEqual(
            formatGpuDisplay(gpus, 2),
            '$(circuit-board) GPU 75.00% 3.00 GB/12.00 GB 67.00 C'
        );
        let tooltip = formatGpuTooltip(gpus, 1);
        assert.ok(tooltip.indexOf('NVIDIA GPU A') !== -1);
        assert.ok(tooltip.indexOf('NVIDIA GPU B') !== -1);
        assert.ok(tooltip.indexOf('Utilization: 75.0%') !== -1);
    });

    it('shows only metrics that are available', () => {
        let gpus = normalizeGpuControllers([
            { model: 'Temperature-only GPU', temperatureGpu: 48, vram: 4096 }
        ]);
        assert.strictEqual(formatGpuDisplay(gpus, 0), '$(circuit-board) GPU 48 C');
        assert.ok(formatGpuTooltip(gpus, 0).indexOf('usage unavailable') !== -1);
    });
});
