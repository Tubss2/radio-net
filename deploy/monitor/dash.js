const cards = [
  ['participants', 'Participants', 'sum(livekit_participant_total) or vector(0)', 'count'],
  ['rooms', 'Rooms', 'sum(livekit_room_total) or vector(0)', 'count'],
  ['loss', 'Packet loss p95', 'histogram_quantile(0.95, sum by (le) (rate(livekit_packet_loss_percent_bucket[2m])))', 'pct'],
  ['jitter', 'Jitter p95', 'histogram_quantile(0.95, sum by (le) (rate(livekit_jitter_us_bucket[2m]))) / 1000', 'ms'],
  ['rtt', 'RTT p95', 'histogram_quantile(0.95, sum by (le) (rate(livekit_rtt_ms_bucket[2m])))', 'ms'],
  ['cpu', 'CPU', '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[1m])))', 'pct'],
  ['ram', 'RAM', '100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))', 'pct'],
  ['netIn', 'Bandwidth in', 'sum(rate(node_network_receive_bytes_total{device!~"lo|docker.*|veth.*|br-.*"}[1m]))', 'rate'],
  ['netOut', 'Bandwidth out', 'sum(rate(node_network_transmit_bytes_total{device!~"lo|docker.*|veth.*|br-.*"}[1m]))', 'rate'],
  ['media', 'Voice bytes out', 'sum(rate(livekit_packet_bytes{direction="outgoing"}[1m])) or vector(0)', 'rate'],
  ['retx', 'Retransmit share', '100 * sum(rate(livekit_packet_total{transmission="retransmit"}[2m])) / clamp_min(sum(rate(livekit_packet_total[2m])), 0.001)', 'pct'],
  ['rss', 'LiveKit RAM', 'max(process_resident_memory_bytes{job="livekit"})', 'bytes'],
];

const grid = document.getElementById('grid');
const status = document.getElementById('status');

for (const [id, label] of cards) {
  const el = document.createElement('section');
  el.className = 'card';
  el.id = id;
  el.innerHTML = `<div class="k"></div><div class="v">—</div>`;
  el.querySelector('.k').textContent = label;
  grid.appendChild(el);
}

function format(kind, value) {
  if (value === null || Number.isNaN(value)) return 'no samples';
  if (kind === 'count') return String(Math.round(value));
  if (kind === 'pct') return `${value.toFixed(1)}%`;
  if (kind === 'ms') return `${value.toFixed(0)} ms`;
  if (kind === 'bytes') return `${(value / (1024 * 1024)).toFixed(0)} MB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

function paint(id, kind, value) {
  const el = document.getElementById(id);
  el.querySelector('.v').textContent = format(kind, value);
  el.classList.remove('ok', 'warn', 'bad');
  if (value === null || Number.isNaN(value)) return;
  if (id === 'cpu' || id === 'ram') {
    el.classList.add(value >= 90 ? 'bad' : value >= 70 ? 'warn' : 'ok');
  } else if (id === 'loss' || id === 'retx') {
    el.classList.add(value >= 5 ? 'bad' : value >= 1 ? 'warn' : 'ok');
  }
}

async function query(expr) {
  const res = await fetch(`prom/api/v1/query?query=${encodeURIComponent(expr)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Prometheus ${res.status}`);
  const body = await res.json();
  const row = body.data && body.data.result && body.data.result[0];
  if (!row) return null;
  const value = Number(row.value[1]);
  return Number.isFinite(value) ? value : null;
}

async function tick() {
  try {
    const values = await Promise.all(cards.map((card) => query(card[2])));
    cards.forEach((card, i) => paint(card[0], card[3], values[i]));
    status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : 'Metrics unavailable';
  }
}

void tick();
setInterval(() => { void tick(); }, 5000);
