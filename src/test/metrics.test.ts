'use strict';

import * as assert from 'assert';
import {
    calculateNetworkRate,
    formatNetworkDisplay,
    formatNetworkRate,
    normalizeCpuLoad,
    parseWindowsProcessorUtility
} from '../metrics';

describe('CPU metrics', () => {
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
