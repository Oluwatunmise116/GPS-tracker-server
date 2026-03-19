const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let latestLocation = null;
let locationHistory = [];

// ─── ESP32 → Server ───────────────────────────────────────
app.post('/location', (req, res) => {
  const { lat, lng, alt, speed, sats } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng required' });

  latestLocation = { lat, lng, alt: alt ?? 0, speed: speed ?? 0, sats: sats ?? 0, time: new Date().toISOString() };
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
app.get('/', (req, res) => res.send(getMapHTML()));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n GPS Tracker Server running`);
  console.log(`   Map : http://localhost:${PORT}`);
  console.log(`   POST: http://YOUR_IP:${PORT}/location\n`);
});

// ─── Map HTML ─────────────────────────────────────────────
function getMapHTML() {
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>GPS Tracker</title>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Roboto',sans-serif; height:100vh; overflow:hidden; }

  #map { position:absolute; inset:0; z-index:0; }

  /* Top search bar */
  .top-bar {
    position:absolute; top:16px; left:50%; transform:translateX(-50%); z-index:1000;
  }
  .search-box {
    display:flex; align-items:center; gap:12px;
    background:#fff; border-radius:24px; padding:10px 20px 10px 16px;
    box-shadow:0 2px 6px rgba(0,0,0,0.25),0 0 0 1px rgba(0,0,0,0.05);
    min-width:340px;
  }
  .search-title {
    font-family:'Google Sans',sans-serif; font-size:16px; font-weight:500; color:#202124; flex:1;
  }
  .live-badge {
    display:flex; align-items:center; gap:5px;
    background:#e6f4ea; color:#1e8e3e;
    font-size:11px; font-weight:500; padding:4px 10px; border-radius:12px;
  }
  .live-badge.waiting { background:#fce8e6; color:#d93025; }
  .live-dot { width:7px; height:7px; border-radius:50%; background:#1e8e3e; animation:blink 1.5s infinite; }
  .live-dot.waiting  { background:#d93025; animation:none; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

  /* Timestamp pill */
  .update-pill {
    position:absolute; top:70px; left:50%; transform:translateX(-50%); z-index:1000;
    background:rgba(255,255,255,0.95); border-radius:20px; padding:5px 14px;
    font-size:11px; color:#5f6368; box-shadow:0 1px 4px rgba(0,0,0,0.15);
    white-space:nowrap; display:none;
  }

  /* Recenter FAB */
  .recenter-btn {
    position:absolute; right:56px; bottom:160px; z-index:1000;
    width:40px; height:40px; background:#fff; border:none; border-radius:4px;
    box-shadow:0 2px 6px rgba(0,0,0,0.3); cursor:pointer;
    display:flex; align-items:center; justify-content:center; transition:background .15s;
  }
  .recenter-btn:hover { background:#f1f3f4; }

  /* Bottom info card */
  .info-card {
    position:absolute; bottom:24px; left:50%; transform:translateX(-50%); z-index:1000;
    background:#fff; border-radius:16px;
    box-shadow:0 4px 16px rgba(0,0,0,0.2),0 1px 4px rgba(0,0,0,0.1);
    padding:16px 24px; min-width:420px;
    display:none; flex-direction:column; gap:14px;
  }
  .info-header { display:flex; align-items:center; gap:14px; }
  .loc-icon {
    width:42px; height:42px; border-radius:50%; background:#1a73e8;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
  }
  .info-title { font-family:'Google Sans',sans-serif; font-size:15px; font-weight:500; color:#202124; }
  .info-coords { font-size:12px; color:#5f6368; margin-top:3px; font-family:monospace; }
  .divider { height:1px; background:#e8eaed; }
  .stats { display:flex; }
  .stat {
    flex:1; display:flex; flex-direction:column; align-items:center; gap:2px;
    padding:4px 0; border-right:1px solid #e8eaed;
  }
  .stat:last-child { border-right:none; }
  .stat-val { font-family:'Google Sans',sans-serif; font-size:22px; font-weight:500; color:#202124; line-height:1; }
  .stat-unit { font-size:10px; color:#80868b; }
  .stat-lbl  { font-size:11px; color:#5f6368; text-transform:uppercase; letter-spacing:.4px; }

  /* Waiting card */
  .waiting-card {
    position:absolute; bottom:24px; left:50%; transform:translateX(-50%); z-index:1000;
    background:#fff; border-radius:16px; box-shadow:0 4px 16px rgba(0,0,0,0.2);
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
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#1a73e8"/>
    </svg>
    <span class="search-title">Live GPS Tracker</span>
    <div class="live-badge waiting" id="badge">
      <div class="live-dot waiting" id="dot"></div>
      <span id="badge-text">Waiting…</span>
    </div>
  </div>
</div>

<!-- Timestamp pill -->
<div class="update-pill" id="pill"></div>

<!-- Map -->
<div id="map"></div>

<!-- Recenter button -->
<button class="recenter-btn" id="recenter" title="Re-center">
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" fill="#5f6368"/>
  </svg>
</button>

<!-- Info card (shown when fix received) -->
<div class="info-card" id="info-card">
  <div class="info-header">
    <div class="loc-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      </svg>
    </div>
    <div>
      <div class="info-title">Current Location</div>
      <div class="info-coords" id="coords">—</div>
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
    <div class="wait-title">Waiting for GPS signal…</div>
    <div class="wait-sub">Make sure ESP32 is on and has sky view</div>
  </div>
</div>

<script>
  let map, marker, trailPolyline, hasZoomed = false, currentPos = null;

  function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: 0, lng: 0 },
      zoom: 2,
      mapId: 'gps_tracker',
      disableDefaultUI: true,        // Remove all default controls
      zoomControl: true,             // Re-add just zoom
      zoomControlOptions: {
        position: google.maps.ControlPosition.RIGHT_BOTTOM
      },
      gestureHandling: 'greedy',
      clickableIcons: false
    });

    // Recenter button
    document.getElementById('recenter').addEventListener('click', () => {
      if (currentPos) map.panTo(currentPos);
    });

    fetchLocation();
    setInterval(fetchLocation, 3000);
  }

  async function fetchLocation() {
    try {
      const { location: loc, trail } = await fetch('/api/location').then(r => r.json());
      if (!loc) return;

      currentPos = { lat: loc.lat, lng: loc.lng };

      // ── Marker (Google Maps blue dot style) ──
      if (!marker) {
        marker = new google.maps.Marker({
          position: currentPos,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#1a73e8',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2.5
          },
          title: 'ESP32 Location',
          zIndex: 999
        });
      } else {
        marker.setPosition(currentPos);
      }

      // ── Trail polyline ──
      const trailPath = trail.map(p => ({ lat: p.lat, lng: p.lng }));
      if (trailPolyline) {
        trailPolyline.setPath(trailPath);
      } else if (trailPath.length > 1) {
        trailPolyline = new google.maps.Polyline({
          path: trailPath,
          geodesic: true,
          strokeColor: '#1a73e8',
          strokeOpacity: 0.8,
          strokeWeight: 4,
          map
        });
      }

      // ── Auto-zoom on first fix ──
      if (!hasZoomed) {
        map.setCenter(currentPos);
        map.setZoom(17);
        hasZoomed = true;
      }

      // ── Update UI ──
      document.getElementById('coords').textContent   = loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6);
      document.getElementById('s-speed').textContent  = loc.speed.toFixed(1);
      document.getElementById('s-alt').textContent    = loc.alt.toFixed(0);
      document.getElementById('s-sats').textContent   = loc.sats;

      document.getElementById('info-card').style.display    = 'flex';
      document.getElementById('waiting-card').style.display = 'none';
      document.getElementById('badge').className            = 'live-badge';
      document.getElementById('dot').className              = 'live-dot';
      document.getElementById('badge-text').textContent     = 'Live';

      const pill = document.getElementById('pill');
      pill.style.display = 'block';
      pill.textContent   = 'Updated ' + new Date(loc.time).toLocaleTimeString();

    } catch (e) {
      document.getElementById('badge').className        = 'live-badge waiting';
      document.getElementById('dot').className          = 'live-dot waiting';
      document.getElementById('badge-text').textContent = 'Offline';
    }
  }
</script>

<!-- Load real Google Maps -->
<script async
  src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDUFtPg_U7UrD4kr0qiKLrZ5-_ADOdsedk&callback=initMap">
</script>

</body>
</html>`;
}
