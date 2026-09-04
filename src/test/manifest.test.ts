'use strict';

import * as assert from 'assert';

let extensionPackage: any = require('../../package.json');

describe('extension manifest', () => {
    it('uses the maintained fork extension identity', () => {
        assert.strictEqual(extensionPackage.publisher, 'RavidAmar');
        assert.strictEqual(extensionPackage.name, 'resourcemonitor');
    });

    it('points users to the maintained repository', () => {
        assert.strictEqual(
            extensionPackage.repository.url,
            'https://github.com/Ravid-Amar/VS-Code-Resource-Monitor.git'
        );
    });

    it('contributes the settings command to the Command Palette', () => {
        let command = extensionPackage.contributes.commands.filter((candidate: any) => {
            return candidate.command === 'resmon.openSettings';
        })[0];

        assert.ok(command);
        assert.strictEqual(command.title, 'Resource Monitor: Open Settings');
        assert.ok(extensionPackage.activationEvents.indexOf('onCommand:resmon.openSettings') !== -1);
    });

    it('declares every implemented resource setting', () => {
        let properties = extensionPackage.contributes.configuration.properties;
        [
            'resmon.show.cpuusage',
            'resmon.show.cpufreq',
            'resmon.show.mem',
            'resmon.show.battery',
            'resmon.show.disk',
            'resmon.show.net',
            'resmon.show.cputemp'
        ].forEach(setting => assert.ok(properties[setting], `Missing ${setting}`));
        assert.ok(properties['resmon.mem.unit']);
        assert.ok(properties['resmon.freq.unit']);
    });
});
