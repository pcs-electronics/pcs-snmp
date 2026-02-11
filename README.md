# PCS SNMP Tools

This folder contains SNMP tooling for the PCS Electronics transmitter:
- a web dashboard (`dashboard/`),
- command-line helper scripts (`scripts/`).

SNMP compatibility notice:

- SNMP support requires LCD control panel hardware version `2.xx`.

## Prerequisites

Install the following before use:

- Node.js (recommended: 18+)
- Net-SNMP CLI tools in `PATH`:
  - `snmpget`
  - `snmpset`
  - `snmpwalk`
- Network reachability to the transmitter SNMP endpoint (default UDP port `161`)
- A modern web browser (for the dashboard)

Linux package examples:

- Debian/Ubuntu: `sudo apt install nodejs snmp`
- Fedora/RHEL: `sudo dnf install nodejs net-snmp-utils`
- macOS (Homebrew): `brew install node net-snmp`
- Windows:
  - Node.js LTS: `winget install OpenJS.NodeJS.LTS`
  - Net-SNMP CLI tools (`snmpget`, `snmpset`, `snmpwalk`):
    1. Download and install Net-SNMP Windows binaries (official Net-SNMP website: https://www.net-snmp.org, 
        Windows binaries: https://sourceforge.net/projects/net-snmp/files/net-snmp%20binaries/5.5-binaries/ ).
    2. During/after install, locate the folder containing `snmpget.exe`, `snmpset.exe`, and `snmpwalk.exe` (commonly `C:\usr\bin`).
    3. Add that folder to your user or system `PATH`:
       - Open `System Properties` -> `Advanced` -> `Environment Variables`
       - Edit `Path` -> `New` -> add the Net-SNMP bin folder path
       - Open a new PowerShell window after saving
    4. Verify:
       - `snmpget --version`
       - `snmpset --version`
       - `snmpwalk --version`

Quick verification (all platforms):

```bash
node --version
snmpget --version
```

## Dashboard

Start from the `pcs-snmp` folder:

```bash
node dashboard/server.js
```

or:

```bash
./dashboard/start.sh
```

Then open:

`http://localhost:8080`

Current UI behavior:

- The main button shows `Start` before connection, then `Restart` while running.
- Pressing `Restart` clears chart history and restarts polling.
- `Reset Alarm Latched` writes `0` to the latched-alarm OID to clear the currently latched alarm code.

### Dashboard Environment Variables

- `DASHBOARD_PORT`
  - HTTP port for the dashboard server.
  - Default: `8080`
- `DASHBOARD_DEFAULT_IP`
  - Default value shown in the webpage IP Address field.
  - Default: `192.168.1.140`
- `DASHBOARD_DEFAULT_SNMP_PORT`
  - Default value shown in the webpage SNMP Port field.
  - Valid range: `1..65535`
  - Default: `161`
- `DASHBOARD_DEFAULT_POLL_TIME_SEC`
  - Default value shown in the webpage Poll Time field.
  - Valid range: `5..10000`
  - Default: `5`
- `DASHBOARD_AUTO_START`
  - If enabled (`1`, `true`, `yes`, `on`), webpage polling starts automatically after load.
  - Default: disabled

Example:

```bash
DASHBOARD_PORT=8090 \
DASHBOARD_DEFAULT_IP=192.168.1.140 \
DASHBOARD_DEFAULT_SNMP_PORT=161 \
DASHBOARD_DEFAULT_POLL_TIME_SEC=5 \
DASHBOARD_AUTO_START=1 \
node dashboard/server.js
```

MIB file used by the dashboard:

- `dashboard/pcs-electronics.mib`
- Served by the dashboard at `/pcs-electronics.mib`
- You can also import this MIB file into other SNMP monitoring software (for example: Zabbix, PRTG, LibreNMS, Observium, iReasoning MIB Browser) to resolve PCS OIDs and labels.

## Scripts

All scripts are in `scripts/`.

Run a script from `pcs-snmp` like this:

```bash
./scripts/walk_device_tree.sh
```

Windows note:

- `.sh` helper scripts are intended for a POSIX shell. On Windows, run them from WSL or Git Bash, or run equivalent `snmpget`/`snmpset`/`snmpwalk` commands directly in PowerShell.

---

Coded with GPT-Codex
