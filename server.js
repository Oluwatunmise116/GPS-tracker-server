const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let latestLocation = null;
let locationHistory = [];
let target = null;
let carStatus = 'idle'; // idle | navigating | arrived

// ─── ESP32 → Server: GPS position ─────────────────────────
app.post('/location', (req, res) => {
  const { lat, lng, alt, speed, sats } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng required' });

  latestLocation = { lat, lng, alt: alt ?? 0, speed: speed ?? 0, sats: sats ?? 0, time: new Date().toISOString() };
  locationHistory.push({ lat, lng });
  if (locationHistory.length > 200) locationHistory.shift();

  if (target && carStatus === 'idle') carStatus = 'navigating';

  console.log(`[GPS] ${lat.toFixed(6)}, ${lng.toFixed(6)} | ${speed?.toFixed(1)} km/h | ${sats} sats`);
  res.json({ ok: true });
});

// ─── ESP32 polls for target ────────────────────────────────
app.get('/api/target', (req, res) => {
  if (target) {
    res.json({ hasTarget: true, lat: target.lat, lng: target.lng });
  } else {
    res.json({ hasTarget: false });
  }
});

// ─── ESP32 notifies arrival ───────────────────────────────
app.post('/arrived', (req, res) => {
  console.log('[NAV] Car arrived at destination!');
  carStatus = 'arrived';
  target = null;
  res.json({ ok: true });
});

// ─── Dashboard sets target (click on map) ─────────────────
app.post('/api/target', (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng required' });
  target = { lat, lng, setAt: new Date().toISOString() };
  carStatus = 'navigating';
  console.log(`[TARGET] Set to: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  res.json({ ok: true });
});

// ─── Dashboard cancels target ─────────────────────────────
app.delete('/api/target', (req, res) => {
  target = null;
  carStatus = 'idle';
  console.log('[TARGET] Cancelled');
  res.json({ ok: true });
});

// ─── Dashboard polls full state ───────────────────────────
app.get('/api/state', (req, res) => {
  res.json({ location: latestLocation, trail: locationHistory, target, carStatus });
});

// ─── Serve dashboard ──────────────────────────────────────
app.get('/', (req, res) => res.send(getDashboardHTML()));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚗 Autonomous Car Server`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   GPS POST:  POST /location`);
  console.log(`   Target:    GET/POST/DELETE /api/target\n`);
});

// ─── Dashboard HTML ───────────────────────────────────────
function getDashboardHTML() {
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Autonomous Car</title>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Roboto',sans-serif; height:100vh; overflow:hidden; }
  #map { position:absolute; inset:0; z-index:0; }

  /* ── Top bar ── */
  .top-bar {
    position:absolute; top:16px; left:50%; transform:translateX(-50%);
    z-index:1000; display:flex; gap:10px; align-items:center;
  }
  .search-box {
    display:flex; align-items:center; gap:10px;
    background:#fff; border-radius:24px; padding:10px 20px 10px 16px;
    box-shadow:0 2px 6px rgba(0,0,0,0.25); min-width:360px;
  }
  .search-title {
    font-family:'Google Sans',sans-serif; font-size:15px; font-weight:500; color:#202124; flex:1;
  }
  .status-pill {
    display:flex; align-items:center; gap:5px;
    font-size:11px; font-weight:500; padding:4px 10px; border-radius:12px;
  }
  .status-pill.idle       { background:#f1f3f4; color:#5f6368; }
  .status-pill.navigating { background:#e8f0fe; color:#1967d2; }
  .status-pill.arrived    { background:#e6f4ea; color:#1e8e3e; }
  .status-pill.waiting    { background:#fce8e6; color:#d93025; }

  .status-dot {
    width:7px; height:7px; border-radius:50%;
  }
  .idle .status-dot       { background:#5f6368; }
  .navigating .status-dot { background:#1967d2; animation:blink 1s infinite; }
  .arrived .status-dot    { background:#1e8e3e; }
  .waiting .status-dot    { background:#d93025; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }

  /* ── Hint toast ── */
  .hint {
    position:absolute; top:70px; left:50%; transform:translateX(-50%);
    z-index:1000; background:rgba(32,33,36,0.85); color:#fff;
    border-radius:20px; padding:6px 16px; font-size:12px;
    white-space:nowrap; pointer-events:none;
  }

  /* ── Cancel button ── */
  .cancel-btn {
    position:absolute; top:16px; right:16px; z-index:1000;
    background:#fff; border:none; border-radius:24px;
    padding:10px 20px; font-family:'Google Sans',sans-serif;
    font-size:14px; font-weight:500; color:#d93025;
    box-shadow:0 2px 6px rgba(0,0,0,0.25); cursor:pointer;
    display:none; align-items:center; gap:8px;
    transition:background .15s;
  }
  .cancel-btn:hover { background:#fce8e6; }
  .cancel-btn.visible { display:flex; }

  /* ── Recenter ── */
  .recenter-btn {
    position:absolute; right:16px; bottom:200px; z-index:1000;
    width:40px; height:40px; background:#fff; border:none; border-radius:4px;
    box-shadow:0 2px 6px rgba(0,0,0,0.3); cursor:pointer;
    display:flex; align-items:center; justify-content:center;
  }
  .recenter-btn:hover { background:#f1f3f4; }

  /* ── Bottom info card ── */
  .info-card {
    position:absolute; bottom:24px; left:50%; transform:translateX(-50%);
    z-index:1000; background:#fff; border-radius:16px;
    box-shadow:0 4px 16px rgba(0,0,0,0.2); padding:16px 24px;
    min-width:460px; display:none; flex-direction:column; gap:14px;
  }

  .info-row { display:flex; align-items:center; gap:12px; }

  .loc-icon {
    width:40px; height:40px; border-radius:50%; background:#1a73e8;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
  }
  .dest-icon {
    width:40px; height:40px; border-radius:50%; background:#d93025;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
  }

  .info-label { font-family:'Google Sans',sans-serif; font-size:13px; font-weight:500; color:#202124; }
  .info-sub   { font-size:11px; color:#5f6368; margin-top:2px; font-family:monospace; }

  .divider { height:1px; background:#e8eaed; }

  .stats { display:flex; }
  .stat { flex:1; display:flex; flex-direction:column; align-items:center; gap:2px; padding:4px 0; border-right:1px solid #e8eaed; }
  .stat:last-child { border-right:none; }
  .stat-val  { font-family:'Google Sans',sans-serif; font-size:20px; font-weight:500; color:#202124; line-height:1; }
  .stat-unit { font-size:10px; color:#80868b; }
  .stat-lbl  { font-size:11px; color:#5f6368; text-transform:uppercase; letter-spacing:.4px; }

  /* ── Waiting card ── */
  .waiting-card {
    position:absolute; bottom:24px; left:50%; transform:translateX(-50%);
    z-index:1000; background:#fff; border-radius:16px;
    box-shadow:0 4px 16px rgba(0,0,0,0.2);
    padding:20px 28px; display:flex; align-items:center; gap:16px; min-width:320px;
  }
  .spinner {
    width:26px; height:26px; border:3px solid #e8eaed; border-top-color:#1a73e8;
    border-radius:50%; animation:spin .8s linear infinite; flex-shrink:0;
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  .wait-title { font-family:'Google Sans',sans-serif; font-size:14px; color:#202124; }
  .wait-sub   { font-size:12px; color:#5f6368; margin-top:3px; }
</style>
</head>
<body>

<!-- Top bar -->
<div class="top-bar">
  <div class="search-box">
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z" fill="#1a73e8"/>
    </svg>
    <span class="search-title">Autonomous Car</span>
    <div class="status-pill idle" id="status-pill">
      <div class="status-dot"></div>
      <span id="status-text">Waiting for car…</span>
    </div>
  </div>
</div>

<!-- Hint -->
<div class="hint" id="hint">Click anywhere on the map to set a destination</div>

<!-- Cancel -->
<button class="cancel-btn" id="cancel-btn" onclick="cancelTarget()">
  <svg width="16" height="16" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="#d93025"/></svg>
  Cancel Navigation
</button>

<div id="map"></div>

<!-- Recenter -->
<button class="recenter-btn" id="recenter">
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" fill="#5f6368"/>
  </svg>
</button>

<!-- Info card (shown when car has fix) -->
<div class="info-card" id="info-card">
  <!-- Car position row -->
  <div class="info-row">
    <div class="loc-icon">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      </svg>
    </div>
    <div>
      <div class="info-label">Car Position</div>
      <div class="info-sub" id="car-coords">—</div>
    </div>
    <div style="margin-left:auto;text-align:right">
      <div class="info-sub" id="dist-to-target" style="font-size:13px;color:#1a73e8;font-weight:500"></div>
    </div>
  </div>

  <!-- Destination row (only when target set) -->
  <div class="info-row" id="dest-row" style="display:none">
    <div class="dest-icon">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      </svg>
    </div>
    <div>
      <div class="info-label">Destination</div>
      <div class="info-sub" id="dest-coords">—</div>
    </div>
  </div>

  <div class="divider"></div>

  <div class="stats">
    <div class="stat">
      <div class="stat-val" id="s-speed">—</div>
      <div class="stat-unit">km/h</div>
      <div class="stat-lbl">Speed</div>
    </div>
    <div class="stat">
      <div class="stat-val" id="s-alt">—</div>
      <div class="stat-unit">m</div>
      <div class="stat-lbl">Altitude</div>
    </div>
    <div class="stat">
      <div class="stat-val" id="s-sats">—</div>
      <div class="stat-unit">&nbsp;</div>
      <div class="stat-lbl">Satellites</div>
    </div>
  </div>
</div>

<!-- Waiting card -->
<div class="waiting-card" id="waiting-card">
  <div class="spinner"></div>
  <div>
    <div class="wait-title">Waiting for car GPS signal…</div>
    <div class="wait-sub">Make sure ESP32 is on and has sky view</div>
  </div>
</div>

<script>
  let map, carMarker, destMarker, trailPolyline, routeLine;
  let hasZoomed = false, currentPos = null, currentTarget = null;

  const GMAPS_KEY = 'AIzaSyDUFtPg_U7UrD4kr0qiKLrZ5-_ADOdsedk';

  function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: 0, lng: 0 },
      zoom: 2,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
      gestureHandling: 'greedy',
      clickableIcons: false
    });

    // Click on map → set destination
    map.addListener('click', (e) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      setTarget(lat, lng);
    });

    document.getElementById('recenter').addEventListener('click', () => {
      if (currentPos) map.panTo(currentPos);
    });

    fetchState();
    setInterval(fetchState, 3000);
  }

  // ── Set destination ──
  async function setTarget(lat, lng) {
    await fetch('/api/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng })
    });
    updateDestMarker({ lat, lng });
    document.getElementById('cancel-btn').classList.add('visible');
  }

  // ── Cancel navigation ──
  async function cancelTarget() {
    await fetch('/api/target', { method: 'DELETE' });
    if (destMarker) { destMarker.setMap(null); destMarker = null; }
    if (routeLine)  { routeLine.setMap(null);  routeLine  = null; }
    currentTarget = null;
    document.getElementById('cancel-btn').classList.remove('visible');
    document.getElementById('dest-row').style.display = 'none';
    document.getElementById('dist-to-target').textContent = '';
    setStatus('idle', 'Idle — click map to navigate');
  }

  // ── Poll server state ──
  async function fetchState() {
    try {
      const { location: loc, trail, target, carStatus } = await fetch('/api/state').then(r => r.json());

      if (!loc) return;
      currentPos = { lat: loc.lat, lng: loc.lng };

      // Car marker (blue dot)
      if (!carMarker) {
        carMarker = new google.maps.Marker({
          position: currentPos, map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#1a73e8', fillOpacity: 1,
            strokeColor: '#ffffff', strokeWeight: 2.5
          },
          zIndex: 999, title: 'Car'
        });
      } else {
        carMarker.setPosition(currentPos);
      }

      // Trail
      const trailPath = trail.map(p => ({ lat: p.lat, lng: p.lng }));
      if (trailPolyline) trailPolyline.setPath(trailPath);
      else if (trailPath.length > 1) {
        trailPolyline = new google.maps.Polyline({
          path: trailPath, geodesic: true,
          strokeColor: '#1a73e8', strokeOpacity: 0.5, strokeWeight: 3, map
        });
      }

      // Auto-zoom first fix
      if (!hasZoomed) { map.setCenter(currentPos); map.setZoom(18); hasZoomed = true; }

      // Update target if server has one
      if (target) {
        currentTarget = target;
        updateDestMarker(target);
        document.getElementById('cancel-btn').classList.add('visible');
        document.getElementById('dest-row').style.display = 'flex';
        document.getElementById('dest-coords').textContent = target.lat.toFixed(6) + ', ' + target.lng.toFixed(6);

        // Draw straight route line
        const routePath = [currentPos, { lat: target.lat, lng: target.lng }];
        if (routeLine) routeLine.setPath(routePath);
        else routeLine = new google.maps.Polyline({
          path: routePath, geodesic: true,
          strokeColor: '#d93025', strokeOpacity: 0.6,
          strokeWeight: 3, strokeDashArray: [8, 6], map
        });

        // Distance
        const dist = haversine(loc.lat, loc.lng, target.lat, target.lng);
        document.getElementById('dist-to-target').textContent =
          dist > 1000 ? (dist/1000).toFixed(2) + ' km away' : dist.toFixed(0) + ' m away';
      } else {
        currentTarget = null;
      }

      // Status
      if (carStatus === 'navigating') setStatus('navigating', 'Navigating…');
      else if (carStatus === 'arrived') setStatus('arrived', 'Arrived! ✓');
      else setStatus('idle', 'Click map to set destination');

      // UI
      document.getElementById('car-coords').textContent = loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6);
      document.getElementById('s-speed').textContent = loc.speed.toFixed(1);
      document.getElementById('s-alt').textContent   = loc.alt.toFixed(0);
      document.getElementById('s-sats').textContent  = loc.sats;

      document.getElementById('info-card').style.display    = 'flex';
      document.getElementById('waiting-card').style.display = 'none';
      document.getElementById('hint').textContent = target
        ? 'Click elsewhere to change destination'
        : 'Click anywhere on the map to set a destination';

    } catch(e) {
      setStatus('waiting', 'Server offline');
    }
  }

  function updateDestMarker(pos) {
    if (destMarker) { destMarker.setPosition(pos); return; }
    destMarker = new google.maps.Marker({
      position: pos, map,
      icon: {
        url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
        scaledSize: new google.maps.Size(40, 40),
        anchor: new google.maps.Point(20, 40)
      },
      title: 'Destination', zIndex: 998,
      animation: google.maps.Animation.DROP
    });
  }

  function setStatus(cls, text) {
    const pill = document.getElementById('status-pill');
    pill.className = 'status-pill ' + cls;
    document.getElementById('status-text').textContent = text;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
</script>

<script async src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDUFtPg_U7UrD4kr0qiKLrZ5-_ADOdsedk&callback=initMap"></script>
</body>
</html>`;
}
