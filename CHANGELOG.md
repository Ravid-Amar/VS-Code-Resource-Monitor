# Change Log

## [Unreleased]
- Replaced the deprecated `vscode` development package and its network-dependent postinstall step with VS Code 1.25 type definitions.

## [1.0.12]
- Added network inbound/outbound rates with per-interface hover details.
- Added a Command Palette command to open Resource Monitor settings.
- Changed Windows CPU usage to the Processor Utility counter used by Task Manager, with a processor-time fallback.
- Reused one CPU sample for the status bar and tooltip to prevent back-to-back sampling from distorting load values.
- Added automated unit tests for CPU and network metric calculations and wired them into CI.
- Added live CPU, memory, disk, and network data verification.
- Fixed the memory-unit setting lookup and refreshed repository metadata, CI, and screenshots.

## [1.0.11]
- Added hover drilldowns for each status-bar resource, including per-core CPU details and all detected disks and partitions.

## [1.0.10]
- Added a Linux CPU-frequency fallback for systems where systeminformation reports zero.

## [1.0.9]
- Disk monitoring now shows the used percentage for the partition containing the current workspace by default.

## [1.0.8]
- Added enabled-by-default disk-usage reporting in the status bar.
- Disk filters now accept either drive identifiers or mount points, and no indicator is shown when no selected volume is available.
- Retained the VS Code `^1.25.0` compatibility target.

## [1.0.7]
- Changed underlying CPU frequency API, added hiding battery/CPU temp information if the device lacks a battery/doesn't support CPU temp sensing, added some clarifications about CPU frequency behavior on Windows.

## [1.0.6]
- Added DiskSpace, CPU Temperature. Adjusted battery icon.

## [1.0.5]
- Refactored code heavily, addressed Github issue with memory.used versus memory.active.

## [1.0.4]
- Added icon for store.

## [1.0.3]
- Changed icons. Added choosable units.

## [1.0.2]
- Actually properly added systeminformation as a real dependency.

## [1.0.1]
- Properly added systeminformation as a real dependency

## [1.0.0]
- Initial release
