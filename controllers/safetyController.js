// controllers/safetyController.js
// Serves the public live-tracking web page and its location API endpoint.

const db = require('../db');
const { validateTrackToken } = require('../utils/liveTrack');
const { WEB_GOOGLE_MAPS_API_KEY } = require('../config/constants');

// ─── HTML helpers ────────────────────────────────────────────────────────────

function expiredPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Tracking Link Expired — SoberFolk</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;flex-direction:column;align-items:center;
         justify-content:center;background:#0f172a;color:#fff;font-family:system-ui,sans-serif;padding:24px;text-align:center}
    .icon{font-size:64px;margin-bottom:24px}
    h1{font-size:24px;font-weight:700;margin-bottom:12px;color:#f59e0b}
    p{color:#94a3b8;font-size:15px;line-height:1.6}
    .brand{margin-top:32px;font-size:13px;color:#475569}
  </style>
</head>
<body>
  <div class="icon">🔒</div>
  <h1>Tracking Link Expired</h1>
  <p>This live tracking link is no longer active.<br/>The ride has ended or the link has expired.</p>
  <div class="brand">SoberFolk — Safe Rides</div>
</body>
</html>`;
}

function rideEndedPage(consumerName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Ride Completed — SoberFolk</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:flex;flex-direction:column;align-items:center;
         justify-content:center;background:#0f172a;color:#fff;font-family:system-ui,sans-serif;padding:24px;text-align:center}
    .icon{font-size:64px;margin-bottom:24px}
    h1{font-size:24px;font-weight:700;margin-bottom:12px;color:#10b981}
    p{color:#94a3b8;font-size:15px;line-height:1.6}
    .brand{margin-top:32px;font-size:13px;color:#475569}
  </style>
</head>
<body>
  <div class="icon">✅</div>
  <h1>Ride Completed Safely</h1>
  <p>${consumerName || 'The rider'} has arrived at their destination safely.<br/>Thank you for using SoberFolk!</p>
  <div class="brand">SoberFolk — Safe Rides</div>
</body>
</html>`;
}

function trackingPage(token, data) {
  const {
    driver_name, consumer_name,
    pickup_address, drop_address,
    pickup_latitude, pickup_longitude,
    drop_latitude, drop_longitude,
  } = data;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Live Tracking — SoberFolk</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#fff;height:100vh;display:flex;flex-direction:column}
    header{background:linear-gradient(135deg,#667eea,#764ba2);padding:14px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0}
    header .logo{font-size:22px;font-weight:800;letter-spacing:-0.5px}
    header .sub{font-size:12px;opacity:0.85}
    #map{flex:1;width:100%}
    .info-bar{background:#1e293b;padding:14px 20px;display:flex;flex-direction:column;gap:6px;flex-shrink:0;border-top:1px solid #334155}
    .info-row{display:flex;align-items:center;gap:10px;font-size:13px;color:#94a3b8}
    .info-row strong{color:#fff;font-size:14px}
    .pulse{width:10px;height:10px;border-radius:50%;background:#10b981;animation:pulse 1.5s infinite}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.4)}}
    .status-badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(16,185,129,.2);color:#10b981;margin-left:auto}
    .addr{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
  </style>
</head>
<body>
  <header>
    <div>
      <div class="logo">🛵 SoberFolk</div>
      <div class="sub">Live Ride Tracking</div>
    </div>
  </header>
  <div id="map"></div>
  <div class="info-bar">
    <div class="info-row">
      <div class="pulse"></div>
      <div><strong>${driver_name || 'Driver'}</strong> is on the way</div>
      <div class="status-badge" id="status-badge">LIVE</div>
    </div>
    <div class="info-row">📍 <span class="addr">${pickup_address}</span></div>
    <div class="info-row">🏁 <span class="addr">${drop_address}</span></div>
    <div class="info-row" id="eta-row" style="color:#667eea;font-weight:600"></div>
  </div>

  <script>
    const TOKEN   = '${token}';
    const API_URL = '/api/live-track/' + TOKEN + '/location';
    const GMAPS_KEY = '${WEB_GOOGLE_MAPS_API_KEY}';

    const PICKUP = { lat: ${parseFloat(pickup_latitude)}, lng: ${parseFloat(pickup_longitude)} };
    const DROP   = { lat: ${parseFloat(drop_latitude)},   lng: ${parseFloat(drop_longitude)}   };

    let map, driverMarker, infoWindow, directionsRenderer;

    function initMap() {
      map = new google.maps.Map(document.getElementById('map'), {
        center: PICKUP,
        zoom: 14,
        styles: [
          {elementType:'geometry',stylers:[{color:'#1e293b'}]},
          {elementType:'labels.text.fill',stylers:[{color:'#94a3b8'}]},
          {featureType:'road',elementType:'geometry',stylers:[{color:'#334155'}]},
          {featureType:'road',elementType:'geometry.stroke',stylers:[{color:'#0f172a'}]},
          {featureType:'road.highway',elementType:'geometry',stylers:[{color:'#475569'}]},
          {featureType:'water',elementType:'geometry',stylers:[{color:'#0f172a'}]},
          {featureType:'poi',stylers:[{visibility:'off'}]},
        ],
        disableDefaultUI: true,
        zoomControl: true,
      });

      // Pickup marker (green)
      new google.maps.Marker({
        position: PICKUP, map,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10,
                fillColor:'#10b981', fillOpacity:1, strokeColor:'#fff', strokeWeight:2 },
        title: 'Pickup',
        zIndex: 1,
      });

      // Drop marker (red)
      new google.maps.Marker({
        position: DROP, map,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10,
                fillColor:'#ef4444', fillOpacity:1, strokeColor:'#fff', strokeWeight:2 },
        title: 'Drop',
        zIndex: 1,
      });

      // Driver marker (car icon — starts at pickup until first update)
      driverMarker = new google.maps.Marker({
        position: PICKUP, map,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">' +
            '<circle cx="20" cy="20" r="18" fill="#667eea" stroke="#fff" stroke-width="3"/>' +
            '<text x="20" y="26" font-size="18" text-anchor="middle" fill="white">🛵</text>' +
            '</svg>'
          ),
          scaledSize: new google.maps.Size(44, 44),
          anchor: new google.maps.Point(22, 22),
        },
        title: '${driver_name || 'Driver'}',
        zIndex: 10,
      });

      directionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        polylineOptions: { strokeColor: '#667eea', strokeWeight: 5, strokeOpacity: 0.8 },
      });
      directionsRenderer.setMap(map);

      fetchLocation(); // first fetch immediately
      setInterval(fetchLocation, 5000);
    }

    function haversine(lat1, lon1, lat2, lon2) {
      const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    let lastLat = null, lastLng = null;

    async function fetchLocation() {
      try {
        const res  = await fetch(API_URL);
        const data = await res.json();

        if (!res.ok || !data.success) {
          document.getElementById('status-badge').textContent = 'ENDED';
          document.getElementById('status-badge').style.background = 'rgba(239,68,68,.2)';
          document.getElementById('status-badge').style.color = '#ef4444';
          document.getElementById('eta-row').textContent = 'Ride has ended.';
          return;
        }

        const { latitude: lat, longitude: lng } = data.location;
        const pos = { lat: parseFloat(lat), lng: parseFloat(lng) };

        // Smooth-move marker only if position changed
        if (lat !== lastLat || lng !== lastLng) {
          driverMarker.setPosition(pos);
          lastLat = lat; lastLng = lng;

          // Draw directions route driver → current destination
          const dest = data.rideStatus === 'in_progress' ? DROP : PICKUP;
          const ds   = new google.maps.DirectionsService();
          ds.route({ origin: pos, destination: dest, travelMode: 'DRIVING' },
            (result, status) => { if (status === 'OK') directionsRenderer.setDirections(result); }
          );

          // ETA
          const dist = haversine(lat, lng, dest.lat, dest.lng);
          const eta  = Math.round((dist / 25) * 60);
          document.getElementById('eta-row').textContent =
            (data.rideStatus === 'in_progress' ? '🏁 ETA to drop: ~' : '📍 ETA to pickup: ~') + eta + ' min';

          // Pan map to show driver + destination
          const bounds = new google.maps.LatLngBounds();
          bounds.extend(pos);
          bounds.extend(dest);
          map.fitBounds(bounds, { top: 60, bottom: 80, left: 40, right: 40 });
        }
      } catch(e) {
        console.warn('Location fetch error:', e);
      }
    }

    // Load Google Maps JS API
    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + GMAPS_KEY + '&callback=initMap';
    script.async = true;
    document.head.appendChild(script);
  </script>
</body>
</html>`;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/**
 * GET /live-track/:token
 * Public — serves the HTML live tracking page (no auth needed).
 */
const getLiveTrackPage = async (req, res) => {
  const { token } = req.params;
  try {
    const data = await validateTrackToken(token);
    if (!data) return res.send(expiredPage());
    if (['completed', 'cancelled'].includes(data.ride_status)) {
      return res.send(rideEndedPage(data.consumer_name));
    }
    res.setHeader('Content-Type', 'text/html');
    return res.send(trackingPage(token, data));
  } catch (err) {
    console.error('Live track page error:', err);
    return res.status(500).send(expiredPage());
  }
};

/**
 * GET /api/live-track/:token/location
 * Public — returns JSON with driver's current lat/lng (called by the tracking page JS every 5s).
 */
const getLiveTrackLocation = async (req, res) => {
  const { token } = req.params;
  try {
    const data = await validateTrackToken(token);
    if (!data) return res.status(404).json({ success: false, error: 'Token expired or invalid' });

    const locResult = await db.query(
      `SELECT latitude, longitude FROM driver_locations WHERE user_id = $1`,
      [data.driver_id]
    );

    if (locResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Driver location not available yet' });
    }

    return res.json({
      success: true,
      rideStatus: data.ride_status,
      location: {
        latitude:  parseFloat(locResult.rows[0].latitude),
        longitude: parseFloat(locResult.rows[0].longitude),
      },
      driverName:    data.driver_name,
      pickup: {
        lat: parseFloat(data.pickup_latitude),
        lng: parseFloat(data.pickup_longitude),
        address: data.pickup_address,
      },
      drop: {
        lat: parseFloat(data.drop_latitude),
        lng: parseFloat(data.drop_longitude),
        address: data.drop_address,
      },
    });
  } catch (err) {
    console.error('Live track location error:', err);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
};

module.exports = { getLiveTrackPage, getLiveTrackLocation };
