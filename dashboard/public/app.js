'use strict';

const el = {
  ip: document.getElementById('ip'),
  port: document.getElementById('port'),
  interval: document.getElementById('interval'),
  startBtn: document.getElementById('startBtn'),
  resetLatchedBtn: document.getElementById('resetLatchedBtn'),
  runStatus: document.getElementById('runStatus'),
  lastPoll: document.getElementById('lastPoll'),
  lastError: document.getElementById('lastError'),
  freqBig: document.getElementById('freqBig'),
  freqSub: document.getElementById('freqSub'),
  fwdBig: document.getElementById('fwdBig'),
  fwdSub: document.getElementById('fwdSub'),
  rfAlarmKv: document.getElementById('rfAlarmKv'),
  powerKv: document.getElementById('powerKv'),
  audioKv: document.getElementById('audioKv'),
  graph: document.getElementById('graph'),
  vuGraph: document.getElementById('vuGraph'),
};

const graphCtx = el.graph.getContext('2d');
const vuGraphCtx = el.vuGraph.getContext('2d');
const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function fmt(value, digits = 1, suffix = '') {
  if (value == null || Number.isNaN(value)) return '-';
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function fmtInt(value) {
  if (value == null || Number.isNaN(value)) return '-';
  return String(Math.round(Number(value)));
}

function fmtYesNo(value) {
  if (value == null || Number.isNaN(value)) return '-';
  return Number(value) !== 0 ? 'Yes' : 'No';
}

function fmtBinary(value) {
  if (value == null || Number.isNaN(value)) return '-';
  const n = Math.trunc(Number(value)) & 0xFF;
  return n.toString(2).padStart(8, '0');
}

function fmtVuBar(value) {
  if (value == null || Number.isNaN(value)) return '<span class="vu-na">-</span>';
  const n = Math.max(0, Math.min(255, Math.round(Number(value))));
  const percent = (n / 255) * 100;
  return `<div class="vu-bar" role="img" aria-label="VU level ${n} of 255"><div class="vu-fill" style="width:${percent.toFixed(1)}%"></div></div>`;
}

function fmtDateTime(epochMs) {
  return dateTimeFormatter.format(new Date(epochMs));
}

function fmtTime(epochMs) {
  return timeFormatter.format(new Date(epochMs));
}

function fmtUptimeDhm(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '-';
  const total = Math.max(0, Math.floor(Number(seconds)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `${method} ${path} failed`);
  }
  return json;
}

function setKV(container, rows) {
  container.innerHTML = rows
    .map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`)
    .join('');
}

function setAlarmText(code, text) {
  const safeText = text || 'Unknown';
  const cls = Number(code) > 0 ? 'alarm-text red' : 'alarm-text';
  return `<span class="${cls}">${safeText}</span>`;
}

function ampText(text) {
  return `<span class="amp-related">${text}</span>`;
}

function renderGraph(history) {
  const w = el.graph.width;
  const h = el.graph.height;
  graphCtx.clearRect(0, 0, w, h);

  graphCtx.fillStyle = 'rgba(255,255,255,0.04)';
  graphCtx.fillRect(0, 0, w, h);

  const padL = 55;
  const padR = 16;
  const padT = 16;
  const padB = 28;

  const data = Array.isArray(history) ? history : [];
  const points = data.map((p) => {
    const ts = Number(p.ts);
    const forwardValue = Number(p.forwardW);
    const reflectedValue = Number(p.reflectedW);
    const legacyForwardValue = Number(p.value);
    return {
      ts,
      forwardW: Number.isFinite(forwardValue) ? forwardValue : (Number.isFinite(legacyForwardValue) ? legacyForwardValue : null),
      reflectedW: Number.isFinite(reflectedValue) ? reflectedValue : null,
    };
  }).filter((p) => Number.isFinite(p.ts));

  if (points.length < 2) {
    graphCtx.fillStyle = '#b8cad8';
    graphCtx.font = '14px Segoe UI';
    graphCtx.fillText('No history yet', 20, 30);
    return;
  }

  const yValues = [];
  for (const p of points) {
    if (Number.isFinite(p.forwardW)) yValues.push(p.forwardW);
    if (Number.isFinite(p.reflectedW)) yValues.push(p.reflectedW);
  }
  if (yValues.length === 0) {
    graphCtx.fillStyle = '#b8cad8';
    graphCtx.font = '14px Segoe UI';
    graphCtx.fillText('No history yet', 20, 30);
    return;
  }

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const y of yValues) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return;
  }

  if (Math.abs(maxY - minY) < 0.2) {
    maxY += 0.5;
    minY -= 0.5;
  } else {
    const pad = (maxY - minY) * 0.1;
    maxY += pad;
    minY = Math.max(0, minY - pad);
  }

  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  graphCtx.strokeStyle = 'rgba(255,255,255,0.16)';
  graphCtx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = padT + (plotH * i) / 4;
    graphCtx.beginPath();
    graphCtx.moveTo(padL, y);
    graphCtx.lineTo(w - padR, y);
    graphCtx.stroke();
  }

  graphCtx.fillStyle = '#b8cad8';
  graphCtx.font = '12px Segoe UI';
  graphCtx.fillText(`${maxY.toFixed(1)} W`, 8, padT + 4);
  graphCtx.fillText(`${minY.toFixed(1)} W`, 8, padT + plotH);

  const firstTs = points[0].ts;
  const lastTs = points[points.length - 1].ts;
  const span = Math.max(1, lastTs - firstTs);

  const toX = (ts) => padL + ((ts - firstTs) / span) * plotW;
  const toY = (value) => padT + ((maxY - value) / (maxY - minY)) * plotH;

  const forwardPoints = points.filter((p) => Number.isFinite(p.forwardW));
  if (forwardPoints.length >= 2) {
    const g = graphCtx.createLinearGradient(0, padT, 0, padT + plotH);
    g.addColorStop(0, 'rgba(57,255,159,0.25)');
    g.addColorStop(1, 'rgba(57,255,159,0.01)');
    graphCtx.fillStyle = g;
    graphCtx.beginPath();
    graphCtx.moveTo(toX(forwardPoints[0].ts), toY(forwardPoints[0].forwardW));
    for (let i = 1; i < forwardPoints.length; i++) {
      graphCtx.lineTo(toX(forwardPoints[i].ts), toY(forwardPoints[i].forwardW));
    }
    graphCtx.lineTo(toX(forwardPoints[forwardPoints.length - 1].ts), padT + plotH);
    graphCtx.lineTo(toX(forwardPoints[0].ts), padT + plotH);
    graphCtx.closePath();
    graphCtx.fill();
  }

  function drawSeries(selector, color) {
    graphCtx.strokeStyle = color;
    graphCtx.lineWidth = 2;
    graphCtx.beginPath();
    let started = false;
    let drawnPoints = 0;
    for (const p of points) {
      const value = selector(p);
      if (!Number.isFinite(value)) {
        started = false;
        continue;
      }
      const x = toX(p.ts);
      const y = toY(value);
      if (!started) {
        graphCtx.moveTo(x, y);
        started = true;
      } else {
        graphCtx.lineTo(x, y);
      }
      drawnPoints += 1;
    }
    if (drawnPoints >= 2) {
      graphCtx.stroke();
    }
  }

  drawSeries((p) => p.forwardW, '#39ff9f');
  drawSeries((p) => p.reflectedW, '#ffd166');

  graphCtx.font = '12px Segoe UI';
  graphCtx.textBaseline = 'middle';
  graphCtx.fillStyle = '#39ff9f';
  graphCtx.fillRect(w - 220, 14, 10, 3);
  graphCtx.fillStyle = '#b8cad8';
  graphCtx.fillText('Forward', w - 204, 16);
  graphCtx.fillStyle = '#ffd166';
  graphCtx.fillRect(w - 130, 14, 10, 3);
  graphCtx.fillStyle = '#b8cad8';
  graphCtx.fillText('Reflected', w - 114, 16);

  graphCtx.fillStyle = '#b8cad8';
  graphCtx.fillText(fmtTime(firstTs), padL, h - 8);
  const endLabel = fmtTime(lastTs);
  const endWidth = graphCtx.measureText(endLabel).width;
  graphCtx.fillText(endLabel, w - padR - endWidth, h - 8);
}

function renderVuGraph(history) {
  const w = el.vuGraph.width;
  const h = el.vuGraph.height;
  vuGraphCtx.clearRect(0, 0, w, h);

  const bg = vuGraphCtx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#10212f');
  bg.addColorStop(1, '#0c1824');
  vuGraphCtx.fillStyle = bg;
  vuGraphCtx.fillRect(0, 0, w, h);

  const padL = 55;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const midY = padT + plotH / 2;
  const halfH = plotH / 2;

  const points = (Array.isArray(history) ? history : [])
    .map((p) => ({
      ts: Number(p.ts),
      vuLeft: Number(p.vuLeft),
      vuRight: Number(p.vuRight),
    }))
    .filter((p) => Number.isFinite(p.ts));

  if (points.length < 2) {
    vuGraphCtx.fillStyle = '#b8cad8';
    vuGraphCtx.font = '14px Segoe UI';
    vuGraphCtx.fillText('No history yet', 20, 30);
    return;
  }

  const vuPointsCount = points.reduce(
    (count, p) => count + ((Number.isFinite(p.vuLeft) || Number.isFinite(p.vuRight)) ? 1 : 0),
    0,
  );
  if (vuPointsCount < 2) {
    vuGraphCtx.fillStyle = '#b8cad8';
    vuGraphCtx.font = '14px Segoe UI';
    vuGraphCtx.fillText('No history yet', 20, 30);
    return;
  }

  vuGraphCtx.strokeStyle = 'rgba(139, 176, 210, 0.20)';
  vuGraphCtx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = padT + (plotH * i) / 4;
    vuGraphCtx.beginPath();
    vuGraphCtx.moveTo(padL, y);
    vuGraphCtx.lineTo(w - padR, y);
    vuGraphCtx.stroke();
  }

  // Zero reference for split VU view.
  vuGraphCtx.strokeStyle = 'rgba(170, 205, 236, 0.70)';
  vuGraphCtx.lineWidth = 1.5;
  vuGraphCtx.beginPath();
  vuGraphCtx.moveTo(padL, midY);
  vuGraphCtx.lineTo(w - padR, midY);
  vuGraphCtx.stroke();

  vuGraphCtx.fillStyle = '#b6cfe6';
  vuGraphCtx.font = '12px Segoe UI';
  vuGraphCtx.fillText('Left', 12, padT + 4);
  vuGraphCtx.fillText('0', 20, midY + 4);
  vuGraphCtx.fillText('Right', 12, padT + plotH);

  const firstTs = points[0].ts;
  const lastTs = points[points.length - 1].ts;
  const span = Math.max(1, lastTs - firstTs);
  const toX = (ts) => padL + ((ts - firstTs) / span) * plotW;
  const clampVu = (v) => Math.max(0, Math.min(255, Math.round(v)));

  const leftFill = vuGraphCtx.createLinearGradient(0, padT, 0, midY);
  leftFill.addColorStop(0, 'rgba(128, 220, 255, 0.98)');
  leftFill.addColorStop(0.35, 'rgba(74, 181, 236, 0.95)');
  leftFill.addColorStop(1, 'rgba(26, 108, 171, 0.88)');

  const rightFill = vuGraphCtx.createLinearGradient(0, midY, 0, padT + plotH);
  rightFill.addColorStop(0, 'rgba(26, 108, 171, 0.88)');
  rightFill.addColorStop(0.65, 'rgba(74, 181, 236, 0.95)');
  rightFill.addColorStop(1, 'rgba(128, 220, 255, 0.98)');

  const xCoords = points.map((p) => toX(p.ts));
  const boundaries = new Array(points.length + 1);
  boundaries[0] = padL;
  for (let i = 1; i < points.length; i++) {
    boundaries[i] = Math.round((xCoords[i - 1] + xCoords[i]) / 2);
  }
  boundaries[points.length] = w - padR;
  const leftVu = points.map((p) => (Number.isFinite(p.vuLeft) ? clampVu(p.vuLeft) : null));
  const rightVu = points.map((p) => (Number.isFinite(p.vuRight) ? clampVu(p.vuRight) : null));

  function drawSmoothedChannel(vuArray, fillStyle, direction) {
    let segStart = -1;

    for (let i = 0; i <= vuArray.length; i++) {
      const valid = i < vuArray.length && vuArray[i] != null;
      if (valid && segStart < 0) {
        segStart = i;
      }
      if ((!valid || i === vuArray.length) && segStart >= 0) {
        const segEnd = i - 1;
        vuGraphCtx.fillStyle = fillStyle;
        vuGraphCtx.beginPath();
        vuGraphCtx.moveTo(boundaries[segStart], midY);

        for (let b = segStart; b <= segEnd + 1; b++) {
          let h;
          if (b === segStart) {
            h = (vuArray[segStart] / 255) * halfH;
          } else if (b === segEnd + 1) {
            h = (vuArray[segEnd] / 255) * halfH;
          } else {
            const hPrev = (vuArray[b - 1] / 255) * halfH;
            const hNext = (vuArray[b] / 255) * halfH;
            h = (hPrev + hNext) / 2;
          }
          const y = direction === 'up' ? (midY - h) : (midY + h);
          vuGraphCtx.lineTo(boundaries[b], y);
        }

        vuGraphCtx.lineTo(boundaries[segEnd + 1], midY);
        vuGraphCtx.closePath();
        vuGraphCtx.fill();

        segStart = -1;
      }
    }
  }

  drawSmoothedChannel(leftVu, leftFill, 'up');
  drawSmoothedChannel(rightVu, rightFill, 'down');

  vuGraphCtx.fillStyle = '#b8cad8';
  vuGraphCtx.fillText(fmtTime(firstTs), padL, h - 8);
  const endLabel = fmtTime(lastTs);
  const endWidth = vuGraphCtx.measureText(endLabel).width;
  vuGraphCtx.fillText(endLabel, w - padR - endWidth, h - 8);
}

function renderState(s) {
  el.runStatus.textContent = `Status: ${s.running ? 'Polling' : 'Stopped'}`;
  el.startBtn.textContent = s.running ? 'Restart' : 'Start';
  el.lastPoll.textContent = s.lastPollEpochMs ? `Last poll: ${fmtDateTime(s.lastPollEpochMs)}` : 'Last poll: never';
  el.lastError.textContent = `Network error: ${s.lastError || 'none'}`;

  const d = s.data;
  if (!d) {
    renderGraph([]);
    renderVuGraph([]);
    return;
  }

  el.freqBig.textContent = d.rf.txFrequencyMHz == null ? '-' : `${fmt(d.rf.txFrequencyMHz, 3, ' MHz')}`;
  el.freqSub.textContent = 'Carrier frequency';

  el.fwdBig.textContent = d.rf.txForwardPowerW == null ? '-' : `${fmt(d.rf.txForwardPowerW, 1, ' W')}`;
  el.fwdSub.textContent = `Reflected: ${fmt(d.rf.txReflectedPowerW, 1, ' W')} | Setpoint: ${fmtInt(d.rf.txPowerPercent)} %`;

  setKV(el.rfAlarmKv, [
    ['Alarm bits', fmtBinary(d.alarms.txAlarmBits)],
    ['Alarm now', setAlarmText(d.alarms.txAlarmCodeNow, d.alarms.txAlarmCodeNowText)],
    ['Alarm latched', setAlarmText(d.alarms.txAlarmCodeLatched, d.alarms.txAlarmCodeLatchedText)],
    [ampText('PA connected'), ampText(fmtYesNo(d.alarms.txPAConnected))],
    ['Exciter temp', fmt(d.thermal.txInternalTempC, 1, ' C')],
    [ampText('PA temp'), ampText(fmt(d.thermal.txExternalTempC, 1, ' C'))],
  ]);

  setKV(el.powerKv, [
    ['Transmitter uptime', fmtUptimeDhm(d.system.sysUpTimeSec)],
    ['Exciter voltage', fmt(d.powerRail.txExciterVoltageV, 1, ' V')],
    [ampText('PA voltage'), ampText(fmt(d.powerRail.txPAVoltageV, 1, ' V'))],
    [ampText('PA2 voltage'), ampText(fmt(d.powerRail.txPA2VoltageV, 1, ' V'))],
    ['Exciter current', fmt(d.powerRail.txExciterCurrentA, 1, ' A')],
    [ampText('PA current'), ampText(fmt(d.powerRail.txPACurrentA, 1, ' A'))],
  ]);

  setKV(el.audioKv, [
    ['Input source', d.audio.txAudioInputSourceText || '-'],
    ['Audio input gain', fmtInt(d.audio.txAudioGaindB) + ' dB'],
    ['VU left', fmtVuBar(d.audio.txVULeft)],
    ['VU right', fmtVuBar(d.audio.txVURight)],
  ]);

  renderGraph(s.history || []);
  renderVuGraph(s.history || []);
}

async function refresh() {
  try {
    const s = await api('/api/state');
    renderState(s);
  } catch (err) {
    el.lastError.textContent = `Network error: ${err.message}`;
  }
}

function applyDefaults(defaults) {
  if (!defaults || !defaults.config) {
    return;
  }
  const cfg = defaults.config;
  if (cfg.ip != null) {
    el.ip.value = String(cfg.ip);
  }
  if (cfg.snmpPort != null) {
    el.port.value = String(cfg.snmpPort);
  }
  if (cfg.intervalSec != null) {
    el.interval.value = String(cfg.intervalSec);
  }
}

el.startBtn.addEventListener('click', async () => {
  try {
    const current = await api('/api/state');
    await api('/api/start', 'POST', {
      ip: el.ip.value.trim(),
      snmpPort: Number(el.port.value),
      intervalSec: Number(el.interval.value),
      resetHistory: Boolean(current.running),
    });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

el.resetLatchedBtn.addEventListener('click', async () => {
  try {
    await api('/api/reset-alarm-latched', 'POST');
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

async function init() {
  let defaults = null;
  try {
    defaults = await api('/api/defaults');
    applyDefaults(defaults);
  } catch (err) {
    el.lastError.textContent = `Network error: ${err.message}`;
  }

  if (defaults && defaults.autoStart) {
    try {
      await api('/api/start', 'POST', {
        ip: el.ip.value.trim(),
        snmpPort: Number(el.port.value),
        intervalSec: Number(el.interval.value),
      });
    } catch (err) {
      el.lastError.textContent = `Network error: ${err.message}`;
    }
  }

  await refresh();
  setInterval(refresh, 1000);
}

init();
