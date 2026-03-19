const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Stores the latest GPS reading from the ESP32
let latestLocation = null;
let locationHistory = []; // Keep last 100 points for trail

// ─── ESP32 → Server ───────────────────────────────────────
app.post('/location', (req, res) => {
  const { lat, lng, alt, speed, sats } = req.body;

  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat and lng required' });
  }

  latestLocation = {
    lat, lng,
    alt:   alt   ?? 0,
    speed: speed ?? 0,
    sats:  sats  ?? 0,
    time:  new Date().toISOString()
  };

  // Keep a rolling trail (last 100 points)
  locationHistory.push({ lat, lng });
  if (locationHistory.length > 100) locationHistory.shift();

  console.log(`[GPS] ${lat.toFixed(6)}, ${lng.toFixed(6)} | ${speed?.toFixed(1)} km/h | ${sats} sats`);
  res.json({ ok: true });
});

// ─── Browser polls this for live updates ──────────────────
app.get('/api/location', (req, res) => {
  res.json({ location: latestLocation, trail: locationHistory });
});

// ─── Serve the map page ───────────────────────────────────
app.get('/', (req, res) => {
  res.send(getMapHTML());
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🛰  GPS Tracker Server running`);
  console.log(`   Map:    http://localhost:${PORT}`);
  console.log(`   API:    POST http://YOUR_IP:${PORT}/location`);
  console.log(`\n   Set SERVER_URL in your .ino to: http://YOUR_IP:${PORT}/location\n`);
});

// ─── Map HTML (self-contained, served inline) ─────────────
function getMapHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>GPS Tracker</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0c10;
    --panel: #111318;
    --border: #1e2230;
    --accent: #00e5ff;
    --accent2: #7c3aed;
    --text: #e2e8f0;
    --muted: #64748b;
    --green: #10b981;
    --red: #ef4444;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'DM Sans', sans-serif;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    z-index: 100;
  }

  .logo {
    font-family: 'Space Mono', monospace;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--accent);
    text-transform: uppercase;
  }

  .pulse-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 0 0 rgba(16,185,129,0.5);
    animation: pulse 2s infinite;
  }
  .pulse-dot.offline { background: var(--red); animation: none; box-shadow: none; }

  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.6); }
    70%  { box-shadow: 0 0 0 8px rgba(16,185,129,0); }
    100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
  }

  #status-text {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    margin-left: auto;
  }

  .layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  #map { flex: 1; }

  .sidebar {
    width: 240px;
    background: var(--panel);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .card {
    padding: 20px;
    border-bottom: 1px solid var(--border);
  }

  .card-label {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
  }

  .card-value {
    font-family: 'Space Mono', monospace;
    font-size: 22px;
    font-weight: 700;
    color: var(--accent);
    line-height: 1;
  }

  .card-unit {
    font-size: 11px;
    color: var(--muted);
    margin-top: 4px;
    font-family: 'DM Sans', sans-serif;
    font-weight: 300;
  }

  .coords {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    color: var(--text);
    line-height: 1.8;
  }

  .no-fix {
    padding: 20px;
    text-align: center;
    color: var(--muted);
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    line-height: 1.8;
  }

  #timestamp {
    padding: 16px 20px;
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    color: var(--muted);
    margin-top: auto;
    letter-spacing: 0.05em;
    border-top: 1px solid var(--border);
  }

  /* Leaflet dark overrides */
  .leaflet-tile-pane { filter: brightness(0.85) saturate(0.7) hue-rotate(180deg) invert(1); }
  .leaflet-container { background: #0a0c10; }
  .leaflet-control-zoom a {
    background: var(--panel) !important;
    color: var(--text) !important;
    border-color: var(--border) !important;
  }
  .leaflet-control-attribution { display: none; }
</style>
</head>
<body>

<header>
  <div class="pulse-dot" id="pulse"></div>
  <span class="logo">GPS Tracker</span>
  <span id="status-text">WAITING FOR DEVICE…</span>
</header>

<div class="layout">
  <div id="map"></div>
  <div class="sidebar">
    <div id="sidebar-content">
      <div class="no-fix">
        📡<br><br>
        Awaiting<br>GPS fix…<br><br>
        <span style="color:#334155;font-size:9px">Make sure your ESP32<br>is running and connected</span>
      </div>
    </div>
    <div id="timestamp">—</div>
  </div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const map = L.map('map', { zoomControl: true }).setView([0, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  // Custom marker icon
  const icon = L.divIcon({
    className: '',
    html: \`<div style="
      width:16px;height:16px;border-radius:50%;
      background:#00e5ff;
      border:3px solid #fff;
      box-shadow:0 0 0 4px rgba(0,229,255,0.3), 0 0 20px rgba(0,229,255,0.6);
    "></div>\`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  let marker = null;
  let trailLine = null;
  let hasZoomed = false;

  async function fetchLocation() {
    try {
      const res = await fetch('/api/location');
      const data = await res.json();
      const loc = data.location;
      const trail = data.trail || [];

      if (!loc) return;

      // Update marker
      if (!marker) {
        marker = L.marker([loc.lat, loc.lng], { icon }).addTo(map);
      } else {
        marker.setLatLng([loc.lat, loc.lng]);
      }

      // Draw trail
      if (trailLine) map.removeLayer(trailLine);
      if (trail.length > 1) {
        trailLine = L.polyline(trail.map(p => [p.lat, p.lng]), {
          color: '#7c3aed',
          weight: 2,
          opacity: 0.7,
          dashArray: '4 4'
        }).addTo(map);
      }

      // Auto-zoom first time
      if (!hasZoomed) {
        map.setView([loc.lat, loc.lng], 16);
        hasZoomed = true;
      }

      // Update sidebar
      document.getElementById('sidebar-content').innerHTML = \`
        <div class="card">
          <div class="card-label">Coordinates</div>
          <div class="coords">
            <span style="color:var(--muted)">LAT</span> \${loc.lat.toFixed(6)}<br>
            <span style="color:var(--muted)">LNG</span> \${loc.lng.toFixed(6)}
          </div>
        </div>
        <div class="card">
          <div class="card-label">Speed</div>
          <div class="card-value">\${loc.speed.toFixed(1)}</div>
          <div class="card-unit">km/h</div>
        </div>
        <div class="card">
          <div class="card-label">Altitude</div>
          <div class="card-value">\${loc.alt.toFixed(0)}</div>
          <div class="card-unit">meters</div>
        </div>
        <div class="card">
          <div class="card-label">Satellites</div>
          <div class="card-value">\${loc.sats}</div>
          <div class="card-unit">in view</div>
        </div>
      \`;

      document.getElementById('status-text').textContent = 'LIVE';
      document.getElementById('pulse').classList.remove('offline');
      document.getElementById('timestamp').textContent =
        'LAST UPDATE  ' + new Date(loc.time).toLocaleTimeString();

    } catch (e) {
      document.getElementById('status-text').textContent = 'SERVER OFFLINE';
      document.getElementById('pulse').classList.add('offline');
    }
  }

  fetchLocation();
  setInterval(fetchLocation, 3000);
</script>
</body>
</html>`;
}