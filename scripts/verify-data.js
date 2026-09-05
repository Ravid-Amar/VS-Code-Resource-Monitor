'use strict';

const si = require('systeminformation');

function requireFinite(name, value, minimum, maximum) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${name} is outside the expected range: ${value}`);
    }
}

function optionalMetric(value, minimum, maximum) {
    let metric = Number(value);
    return value === null || value === undefined || !Number.isFinite(metric) || metric < minimum || metric > maximum
        ? null
        : metric;
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function verify() {
    // currentLoad and networkStats are delta-based, so establish a baseline
    // before validating the second sample.
    await si.currentLoad();
    let interfaces = await si.networkInterfaces();
    let interfaceNames = interfaces
        .map(networkInterface => networkInterface.iface)
        .filter((name, index, names) => name && names.indexOf(name) === index);
    await Promise.all(interfaceNames.map(name => si.networkStats(name)));
    await wait(1100);

    let cpu = await si.currentLoad();
    let cpuLoad = cpu.currentLoad !== undefined ? cpu.currentLoad : cpu.currentload;
    requireFinite('CPU load', Number(cpuLoad), 0, 100);
    (cpu.cpus || []).forEach((core, index) => requireFinite(`CPU core ${index + 1}`, Number(core.load), 0, 100));

    let memory = await si.mem();
    requireFinite('Total memory', Number(memory.total), 1, Number.MAX_SAFE_INTEGER);
    requireFinite('Active memory', Number(memory.active), 0, Number(memory.total));
    requireFinite('Free memory', Number(memory.free), 0, Number(memory.total));

    let fileSystems = (await si.fsSize()).filter(fileSystem => Number(fileSystem.size) > 0);
    if (fileSystems.length === 0) {
        throw new Error('No usable file systems were reported');
    }
    fileSystems.forEach(fileSystem => {
        requireFinite(`Disk usage for ${fileSystem.mount || fileSystem.fs}`, Number(fileSystem.use), 0, 100);
    });

    let network = [];
    for (let name of interfaceNames) {
        let rawStats = await si.networkStats(name);
        let stats = Array.isArray(rawStats) ? rawStats[0] : rawStats;
        if (stats) {
            requireFinite(`${name} received bytes`, Number(stats.rx_bytes), 0, Number.MAX_SAFE_INTEGER);
            requireFinite(`${name} transmitted bytes`, Number(stats.tx_bytes), 0, Number.MAX_SAFE_INTEGER);
            network.push({
                interface: name,
                inboundBytesPerSecond: Math.max(0, Number(stats.rx_sec) || 0),
                outboundBytesPerSecond: Math.max(0, Number(stats.tx_sec) || 0)
            });
        }
    }
    if (network.length === 0) {
        throw new Error('No usable network interfaces were reported');
    }

    let graphics = await si.graphics();
    let gpus = (graphics.controllers || []).map((controller, index) => ({
        name: controller.name || controller.model || `GPU ${index + 1}`,
        utilizationPercent: optionalMetric(controller.utilizationGpu, 0, 100),
        memoryUsedMb: optionalMetric(controller.memoryUsed, 0, Number.MAX_SAFE_INTEGER),
        memoryTotalMb: optionalMetric(controller.memoryTotal, 0, Number.MAX_SAFE_INTEGER),
        temperatureC: optionalMetric(controller.temperatureGpu, 0, 200)
    }));

    console.log(JSON.stringify({
        cpuPercent: Number(Number(cpuLoad).toFixed(2)),
        logicalProcessors: (cpu.cpus || []).length,
        memory: {
            activeBytes: memory.active,
            totalBytes: memory.total
        },
        disks: fileSystems.map(fileSystem => ({
            volume: fileSystem.mount || fileSystem.fs,
            usedPercent: fileSystem.use
        })),
        network: network,
        gpus: gpus
    }, null, 2));
}

verify().catch(error => {
    console.error(`Data verification failed: ${error.message}`);
    process.exitCode = 1;
});
