'use strict';
const $ = (id) => document.getElementById(id);
const number = (value) => new Intl.NumberFormat('en-GB').format(Math.round(value));
const duration = (ms) => ms < 60_000 ? `${Math.round(ms / 1000)}s` :
  ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m ${Math.round(ms % 60_000 / 1000)}s` :
    `${Math.floor(ms / 3_600_000)}h ${Math.floor(ms % 3_600_000 / 60_000)}m`;
const percentage = (a, b) => b ? `${Math.round(a / b * 100)}%` : '—';
const utcLabel = (timestamp, day = false) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', ...(day ? { day: '2-digit', month: 'short' } : { hour: '2-digit', minute: '2-digit' }),
}).format(new Date(timestamp));
let generation = 0;

function drawChart(data) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 190');
  svg.setAttribute('preserveAspectRatio', 'none');
  const make = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    svg.appendChild(el);
    return el;
  };
  const start = Math.floor(data.from / data.resolutionMs) * data.resolutionMs;
  const end = Math.floor(data.to / data.resolutionMs) * data.resolutionMs;
  const rows = new Map(data.series.map((row) => [row.minute, row]));
  const slots = Math.round((end - start) / data.resolutionMs) + 1;
  const width = 940 / slots;
  const maximum = Math.max(1, ...data.series.map((row) => row.pulses));
  for (const fraction of [0, .5, 1]) {
    const y = 150 - fraction * 130;
    make('line', { x1: 48, y1: y, x2: 992, y2: y, class: 'grid' });
    make('text', { x: 39, y: y + 4, 'text-anchor': 'end' }, number(maximum * fraction));
  }
  for (let i = 0; i < slots; i += 1) {
    const time = start + i * data.resolutionMs;
    const row = rows.get(time);
    const height = row ? row.pulses / maximum * 130 : 3;
    const rect = make('rect', { x: 50 + i * width, y: 150 - height, width: Math.max(2, width - 5),
      height, rx: 2, class: row ? 'bar' : 'gap' });
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${new Date(time).toISOString()}: ${row ? number(row.pulses) + ' pulses' : 'no recorded coverage'}`;
    rect.appendChild(title);
    if (i === 0 || i === slots - 1 || i % Math.ceil(slots / 5) === 0) {
      make('text', { x: 50 + i * width, y: 177, 'text-anchor': i === slots - 1 ? 'end' : 'start' }, utcLabel(time, data.resolutionMs > 3_600_000));
    }
  }
  $('chart').replaceChildren(svg);
  $('chart').setAttribute('aria-label', `${number(data.totals.pulses)} accepted pulses. Exact values are in the activity table. Grey marks indicate missing coverage.`);
  $('chart-empty').hidden = data.totals.pulses !== 0;
}

function render(data) {
  const totals = data.totals;
  $('demo-notice').hidden = !data.demo;
  for (const key of ['pageLoads', 'connections', 'pulses', 'peak']) $(key).textContent = number(totals[key]);
  $('live-count').textContent = number(data.liveConnections);
  $('activation').textContent = `${percentage(totals.activeClosed, totals.closed)} (${number(totals.activeClosed)}/${number(totals.closed)})`;
  $('duration').textContent = totals.closed ? duration(totals.durationMs / totals.closed) : '—';
  $('company').textContent = percentage(totals.sharedConnectionMs, totals.connectionMs);
  $('shared').textContent = duration(totals.sharedMs);
  $('reddit').textContent = number(totals.redditPageLoads);
  $('busy').textContent = number(totals.busy);
  $('capacity').textContent = number(totals.capacity);
  $('coverage').textContent = duration(totals.observedMs);
  $('resolution').textContent = data.resolutionMs === 3_600_000 ? 'hour' : 'day';
  $('status').textContent = `Saved ${new Date(data.lastSavedAt).toLocaleTimeString('en-GB')} · refreshes every 30 seconds · chart times are UTC${data.lostMinutes ? ' · Warning: some minutes could not be recorded.' : ''}`;
  $('recording-since').textContent = data.startedAt ? `Recording since ${new Date(data.startedAt).toLocaleString('en-GB')}` : 'No history recorded yet';
  $('table-body').replaceChildren(...data.series.slice().reverse().map((row) => {
    const tr = document.createElement('tr');
    for (const value of [new Date(row.minute).toISOString().slice(0, 16).replace('T', ' '),
      number(row.pageLoads), number(row.connections), number(row.pulses), number(row.peak)]) {
      const td = document.createElement('td'); td.textContent = value; tr.appendChild(td);
    }
    return tr;
  }));
  drawChart(data);
}

async function refresh() {
  const current = ++generation;
  const hours = $('range').value;
  $('export').href = `/admin/export.csv?hours=${hours}`;
  $('refresh').disabled = true;
  try {
    const response = await fetch(`/admin/api/stats?hours=${hours}`, { cache: 'no-store' });
    if (response.status === 401) { window.location.replace('/admin'); return; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load analytics.');
    if (current !== generation) return;
    $('error').hidden = true;
    render(data);
  } catch (problem) {
    if (current !== generation) return;
    $('error').hidden = false;
    $('error').textContent = problem.message || 'Unable to load analytics.';
    $('status').textContent = 'Not updated. Any displayed figures are from the last successful refresh.';
    $('live-count').textContent = '—';
  } finally { if (current === generation) $('refresh').disabled = false; }
}
$('refresh').addEventListener('click', refresh);
$('range').addEventListener('change', refresh);
$('logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/admin/logout', { method: 'POST' });
    if (response.ok || response.status === 401) window.location.replace('/admin');
    else throw new Error();
  } catch { $('error').hidden = false; $('error').textContent = 'Unable to sign out. Please try again.'; }
});
setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
refresh();
