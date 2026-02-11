#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const HOST = '0.0.0.0';
const WEB_PORT = Number(process.env.DASHBOARD_PORT || 8080);

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIB_FILE = path.join(__dirname, 'pcs-electronics.mib');

function readIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return fallback;
  }
  return n;
}

function readBooleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return fallback;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

const DEFAULT_CONFIG = {
  ip: (String(process.env.DASHBOARD_DEFAULT_IP || '192.168.1.140').trim() || '192.168.1.140'),
  snmpPort: readIntegerEnv('DASHBOARD_DEFAULT_SNMP_PORT', 161, 1, 65535),
  intervalSec: readIntegerEnv('DASHBOARD_DEFAULT_POLL_TIME_SEC', 5, 5, 10000),
};
const DASHBOARD_AUTO_START = readBooleanEnv('DASHBOARD_AUTO_START', false);

const OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',
  pcsDeviceObjectId: '1.3.6.1.4.1.65081.1.1.0',

  txForwardPower: '1.3.6.1.4.1.65081.1.2.1.0',
  txReflectedPower: '1.3.6.1.4.1.65081.1.2.2.0',
  txPowerPercent: '1.3.6.1.4.1.65081.1.2.3.0',

  txInternalTemp: '1.3.6.1.4.1.65081.1.3.1.0',
  txExternalTemp: '1.3.6.1.4.1.65081.1.3.2.0',

  txAlarmBits: '1.3.6.1.4.1.65081.1.4.1.0',
  txPAConnected: '1.3.6.1.4.1.65081.1.4.2.0',
  txAlarmCodeNow: '1.3.6.1.4.1.65081.1.4.3.0',
  txAlarmCodeLatched: '1.3.6.1.4.1.65081.1.4.4.0',

  txExciterVoltage: '1.3.6.1.4.1.65081.1.5.1.0',
  txPAVoltage: '1.3.6.1.4.1.65081.1.5.2.0',
  txPA2Voltage: '1.3.6.1.4.1.65081.1.5.3.0',

  txExciterCurrent: '1.3.6.1.4.1.65081.1.6.1.0',
  txPACurrent: '1.3.6.1.4.1.65081.1.6.2.0',

  txAudioInputSource: '1.3.6.1.4.1.65081.1.7.1.0',
  txAudioGain: '1.3.6.1.4.1.65081.1.7.2.0',
  txVULeft: '1.3.6.1.4.1.65081.1.7.3.0',
  txVURight: '1.3.6.1.4.1.65081.1.7.4.0',

  txFrequencykHz: '1.3.6.1.4.1.65081.1.8.1.0',
};

const OID_ENTRIES = Object.entries(OIDS);
// Keep SNMP requests at 5 OIDs max. If POLL_ENTRIES grows, do not increase this cap;
// chunking below will split reads into multiple requests automatically.
const MAX_OIDS_PER_REQUEST = 5;
const POLL_ENTRIES = [
  ['sysUpTime', OIDS.sysUpTime],
  ['txFrequencykHz', OIDS.txFrequencykHz],
  ['txForwardPower', OIDS.txForwardPower],
  ['txReflectedPower', OIDS.txReflectedPower],
  ['txPowerPercent', OIDS.txPowerPercent],
  ['txExciterVoltage', OIDS.txExciterVoltage],
  ['txPAVoltage', OIDS.txPAVoltage],
  ['txPA2Voltage', OIDS.txPA2Voltage],
  ['txExciterCurrent', OIDS.txExciterCurrent],
  ['txPACurrent', OIDS.txPACurrent],
  ['txAudioInputSource', OIDS.txAudioInputSource],
  ['txAudioGain', OIDS.txAudioGain],
  ['txVULeft', OIDS.txVULeft],
  ['txVURight', OIDS.txVURight],
  ['txInternalTemp', OIDS.txInternalTemp],
  ['txExternalTemp', OIDS.txExternalTemp],
  ['txAlarmBits', OIDS.txAlarmBits],
  ['txPAConnected', OIDS.txPAConnected],
  ['txAlarmCodeNow', OIDS.txAlarmCodeNow],
  ['txAlarmCodeLatched', OIDS.txAlarmCodeLatched],
];
const READ_OIDS = POLL_ENTRIES.map(([, oid]) => oid);

const state = {
  running: false,
  config: {
    ...DEFAULT_CONFIG,
  },
  lastPollEpochMs: 0,
  lastError: null,
  data: null,
  history: [],
};

let pollTimer = null;

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function snmpGetBulk(ip, port, community, oids) {
  return new Promise((resolve, reject) => {
    const agent = `${ip}:${port}`;
    const args = ['-m', '', '-v2c', '-c', community, '-Oqv', '-Ot', agent, ...oids];
    execFile('snmpget', args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }

      const values = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (values.length < oids.length) {
        reject(new Error(`Expected ${oids.length} values, got ${values.length}`));
        return;
      }

      resolve(values.slice(0, oids.length));
    });
  });
}

async function snmpGetChunked(ip, port, community, oids, maxOidsPerRequest = MAX_OIDS_PER_REQUEST) {
  if (!Array.isArray(oids) || oids.length === 0) {
    return [];
  }

  const allValues = [];
  for (let start = 0; start < oids.length; start += maxOidsPerRequest) {
    const chunk = oids.slice(start, start + maxOidsPerRequest);
    const chunkValues = await snmpGetBulk(ip, port, community, chunk);
    allValues.push(...chunkValues);
  }
  return allValues;
}

function snmpSetInteger(ip, port, community, oid, value) {
  return new Promise((resolve, reject) => {
    const agent = `${ip}:${port}`;
    const args = ['-m', '', '-v2c', '-c', community, agent, oid, 'i', String(value)];
    execFile('snmpset', args, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function parseNumber(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).replace(/^"|"$/g, '');
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parseTimeTicks(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^"|"$/g, '');
  const direct = parseNumber(s);
  if (direct != null) return direct;

  // Net-SNMP often returns: "Timeticks: (123456) 14 days, 6:56:07.89"
  const parenMatch = s.match(/\((\d+)\)/);
  if (parenMatch) {
    return Number(parenMatch[1]);
  }

  // Also support clock-like forms: "14 days, 6:56:07.89" or "6:56:07.89"
  const clockMatch = s.match(/^(?:(\d+)\s+days?,\s*)?(\d+):(\d+):(\d+)(?:\.(\d+))?$/i);
  if (clockMatch) {
    const days = Number(clockMatch[1] || 0);
    const hours = Number(clockMatch[2] || 0);
    const minutes = Number(clockMatch[3] || 0);
    const seconds = Number(clockMatch[4] || 0);
    const frac = String(clockMatch[5] || '0');
    const hundredths = Number(frac.padEnd(2, '0').slice(0, 2));
    return (((((days * 24) + hours) * 60 + minutes) * 60 + seconds) * 100) + hundredths;
  }

  return null;
}

function alarmCodeToText(code) {
  switch (code) {
    case 0: return 'No alarm';
    case 1: return 'External temperature alarm';
    case 2: return 'High SWR alarm';
    case 3: return 'Internal temperature alarm';
    case 4: return 'High current alarm';
    case 5: return 'High voltage alarm';
    case 6: return 'No exciter communication';
    default: return `Unknown alarm code (${code})`;
  }
}

function audioSourceToText(source) {
  switch (source) {
    case 0: return 'Analog input';
    case 1: return 'AES/EBU';
    case 2: return 'I2S #1';
    case 3: return 'I2S #2';
    default: return `Unknown source (${source})`;
  }
}

function decodeValues(values, entries) {
  const map = {};
  entries.forEach(([key], i) => {
    map[key] = values[i];
  });

  const txForwardPowerRaw = parseNumber(map.txForwardPower);
  const txReflectedPowerRaw = parseNumber(map.txReflectedPower);
  const txFrequencykHz = parseNumber(map.txFrequencykHz);
  const txInternalTempRaw = parseNumber(map.txInternalTemp);
  const txExternalTempRaw = parseNumber(map.txExternalTemp);

  const txAlarmCodeNow = parseNumber(map.txAlarmCodeNow);
  const txAlarmCodeLatched = parseNumber(map.txAlarmCodeLatched);
  const txAudioInputSource = parseNumber(map.txAudioInputSource);
  const sysUpTimeTicks = parseTimeTicks(map.sysUpTime);

  return {
    system: {
      sysDescr: String(map.sysDescr || ''),
      sysUpTimeTicks,
      sysUpTimeSec: sysUpTimeTicks == null ? null : Math.floor(sysUpTimeTicks / 100),
      sysName: String(map.sysName || ''),
      sysLocation: String(map.sysLocation || ''),
      pcsDeviceObjectId: String(map.pcsDeviceObjectId || ''),
    },
    rf: {
      txFrequencykHz,
      txFrequencyMHz: txFrequencykHz == null ? null : txFrequencykHz / 1000,
      txForwardPowerRaw,
      txForwardPowerW: txForwardPowerRaw == null ? null : txForwardPowerRaw / 10,
      txReflectedPowerRaw,
      txReflectedPowerW: txReflectedPowerRaw == null ? null : txReflectedPowerRaw / 10,
      txPowerPercent: parseNumber(map.txPowerPercent),
    },
    thermal: {
      txInternalTempRaw,
      txInternalTempC: txInternalTempRaw == null ? null : txInternalTempRaw / 10,
      txExternalTempRaw,
      txExternalTempC: txExternalTempRaw == null ? null : txExternalTempRaw / 10,
    },
    alarms: {
      txAlarmBits: parseNumber(map.txAlarmBits),
      txPAConnected: parseNumber(map.txPAConnected),
      txAlarmCodeNow,
      txAlarmCodeNowText: alarmCodeToText(txAlarmCodeNow),
      txAlarmCodeLatched,
      txAlarmCodeLatchedText: alarmCodeToText(txAlarmCodeLatched),
    },
    powerRail: {
      txExciterVoltageRaw: parseNumber(map.txExciterVoltage),
      txExciterVoltageV: parseNumber(map.txExciterVoltage) == null ? null : parseNumber(map.txExciterVoltage) / 10,
      txPAVoltageRaw: parseNumber(map.txPAVoltage),
      txPAVoltageV: parseNumber(map.txPAVoltage) == null ? null : parseNumber(map.txPAVoltage) / 10,
      txPA2VoltageRaw: parseNumber(map.txPA2Voltage),
      txPA2VoltageV: parseNumber(map.txPA2Voltage) == null ? null : parseNumber(map.txPA2Voltage) / 10,
      txExciterCurrentRaw: parseNumber(map.txExciterCurrent),
      txExciterCurrentA: parseNumber(map.txExciterCurrent) == null ? null : parseNumber(map.txExciterCurrent) / 10,
      txPACurrentRaw: parseNumber(map.txPACurrent),
      txPACurrentA: parseNumber(map.txPACurrent) == null ? null : parseNumber(map.txPACurrent) / 10,
    },
    audio: {
      txAudioInputSource,
      txAudioInputSourceText: audioSourceToText(txAudioInputSource),
      txAudioGaindB: parseNumber(map.txAudioGain),
      txVULeft: parseNumber(map.txVULeft),
      txVURight: parseNumber(map.txVURight),
    },
  };
}

async function pollOnce() {
  const cfg = state.config;
  const values = await snmpGetChunked(cfg.ip, cfg.snmpPort, 'public', READ_OIDS);
  const decoded = decodeValues(values, POLL_ENTRIES);

  state.data = decoded;
  state.lastError = null;
  state.lastPollEpochMs = Date.now();

  const forwardPowerW = decoded.rf.txForwardPowerW;
  const reflectedPowerW = decoded.rf.txReflectedPowerW;
  const vuLeft = decoded.audio.txVULeft;
  const vuRight = decoded.audio.txVURight;
  if ((forwardPowerW != null) || (reflectedPowerW != null) || (vuLeft != null) || (vuRight != null)) {
    state.history.push({
      ts: state.lastPollEpochMs,
      forwardW: forwardPowerW,
      reflectedW: reflectedPowerW,
      vuLeft,
      vuRight,
    });

    const maxPoints = 1000;
    if (state.history.length > maxPoints) {
      state.history.splice(0, state.history.length - maxPoints);
    }
  }
}

function startPolling(configPatch) {
  if (configPatch) {
    state.config = {
      ...state.config,
      ...configPatch,
    };
  }

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  state.running = true;

  pollOnce().catch((err) => {
    state.lastError = err.message;
  });

  const intervalMs = Math.max(5, Math.min(10000, Number(state.config.intervalSec))) * 1000;
  pollTimer = setInterval(() => {
    pollOnce().catch((err) => {
      state.lastError = err.message;
      state.lastPollEpochMs = Date.now();
    });
  }, intervalMs);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  state.running = false;
}

function validateConfig(input) {
  const ip = String(input.ip ?? '').trim();
  const snmpPort = Number(input.snmpPort);
  const intervalSec = Number(input.intervalSec);

  if (!ip) {
    throw new Error('IP address is required');
  }
  if (!Number.isInteger(snmpPort) || snmpPort < 1 || snmpPort > 65535) {
    throw new Error('SNMP port must be 1..65535');
  }
  if (!Number.isFinite(intervalSec) || intervalSec < 5 || intervalSec > 10000) {
    throw new Error('Polling time must be 5..10000 seconds');
  }

  return { ip, snmpPort, intervalSec };
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.mib') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function serveStatic(req, res, urlPath) {
  const safePath = path.normalize(urlPath).replace(/^\/+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath || 'index.html');

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': getContentType(filePath),
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/defaults') {
    sendJson(res, 200, {
      config: DEFAULT_CONFIG,
      autoStart: DASHBOARD_AUTO_START,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    sendJson(res, 200, {
      running: state.running,
      config: state.config,
      lastPollEpochMs: state.lastPollEpochMs,
      lastError: state.lastError,
      data: state.data,
      history: state.history,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/start') {
    try {
      const body = await parseRequestBody(req);
      const cfg = validateConfig(body);
      if (body.resetHistory === true) {
        state.history = [];
      }
      startPolling(cfg);
      sendJson(res, 200, { ok: true, config: state.config });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    stopPolling();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reset-alarm-latched') {
    try {
      const cfg = state.config;
      await snmpSetInteger(cfg.ip, cfg.snmpPort, 'private', OIDS.txAlarmCodeLatched, 0);
      // Refresh immediately so UI reflects new value quickly.
      await pollOnce();
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/pcs-electronics.mib') {
    fs.readFile(MIB_FILE, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': getContentType(MIB_FILE),
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET') {
    const pathName = url.pathname === '/' ? '/index.html' : url.pathname;
    serveStatic(req, res, pathName);
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(WEB_PORT, HOST, () => {
  console.log(`SNMP dashboard listening on http://localhost:${WEB_PORT}`);
});
