import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { Ticket } from '../types';
import { SurveyCustomerRow } from '../services/collectionService';

interface AppMapProps {
    tickets?: Ticket[];
    // All-customers GPS map mode — show every customer with GPS as a nav pin
    gpsCustomers?: SurveyCustomerRow[];
    // Survey GPS map mode — show a single location pin
    surveyMode?: boolean;
    surveyLat?: number;
    surveyLng?: number;
}

const FALLBACK_CENTER = [12.8342, 79.7036]; // Kanchipuram

function statusColor(status: string): string {
    switch (status) {
        case 'Ongoing': return '#3b82f6';
        case 'Resolved': return '#22c55e';
        case 'Closed': return '#94a3b8';
        default: return '#f59e0b';
    }
}

export default function AppMap({ tickets = [], gpsCustomers, surveyMode, surveyLat, surveyLng }: AppMapProps) {
    const router = useRouter();

    const html = useMemo(() => {
        const geoTickets = tickets.filter(t => t.customer?.geo_lat && t.customer?.geo_long);

        const center = surveyMode && surveyLat && surveyLng
            ? [surveyLat, surveyLng]
            : geoTickets.length > 0
                ? [geoTickets[0].customer!.geo_lat!, geoTickets[0].customer!.geo_long!]
                : gpsCustomers && gpsCustomers.length > 0
                    ? [gpsCustomers[0].gps_lat ?? FALLBACK_CENTER[0], gpsCustomers[0].gps_lng ?? FALLBACK_CENTER[1]]
                    : FALLBACK_CENTER;

        // Build ticket markers
        const ticketMarkersJs = JSON.stringify(
            geoTickets.map(t => ({
                lat: t.customer!.geo_lat!,
                lng: t.customer!.geo_long!,
                color: statusColor(t.status),
                title: `#${t.id} – ${t.issue_type}`,
                name: [t.customer?.first_name, t.customer?.last_name].filter(Boolean).join(' '),
                status: t.status,
                id: t.id,
                type: 'ticket',
            }))
        );

        // Build customer GPS markers (for all-customers map view)
        const customerMarkersJs = gpsCustomers ? JSON.stringify(
            gpsCustomers
                .filter(c => c.gps_lat != null && c.gps_lng != null)
                .map(c => ({
                    lat: c.gps_lat!,
                    lng: c.gps_lng!,
                    color: c.item_type === 'pg_building' ? '#f97316' : '#6366f1',
                    title: c.item_type === 'pg_building'
                        ? (c.building_name || c.first_name || c.username)
                        : ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.username),
                    name: c.item_type === 'pg_building'
                        ? (c.building_name || c.first_name || c.username)
                        : ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.username),
                    username: c.username,
                    item_type: c.item_type || 'customer',
                    building_id: c.building_id || null,
                    building_type: c.building_type || null,
                    floor_count: c.floor_count || 0,
                    room_count: c.room_count || 0,
                    customer_count: c.customer_count || 0,
                    type: 'customer',
                }))
        ) : '[]';

        // Single survey pin
        const surveyMarkerJs = surveyMode && surveyLat && surveyLng
            ? JSON.stringify([{ lat: surveyLat, lng: surveyLng, color: '#22c55e', title: 'Customer Location', type: 'survey' }])
            : '[]';

        return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      onerror="document.getElementById('err').textContent='CSS load failed'"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body, #map { height:100%; width:100%; }
  #err { position:fixed; top:8px; left:8px; right:8px; background:#fee; color:#c00;
         font:bold 12px system-ui; padding:6px; border-radius:4px; display:none; z-index:9999; }
  .tm {
    width:28px; height:28px; border-radius:50%;
    border:2px solid white;
    box-shadow:0 2px 6px rgba(0,0,0,0.25);
    display:flex; align-items:center; justify-content:center;
    color:white; font-weight:800; font-size:11px; font-family:system-ui;
  }
  .cm {
    width:22px; height:22px; border-radius:50%;
    border:2px solid white;
    box-shadow:0 1px 4px rgba(0,0,0,0.2);
    display:flex; align-items:center; justify-content:center;
    color:white; font-weight:700; font-size:9px; font-family:system-ui;
  }
  .pgm {
    width:30px; height:30px; border-radius:6px;
    border:2px solid white;
    box-shadow:0 2px 7px rgba(0,0,0,0.28);
    display:flex; align-items:center; justify-content:center;
    color:white; font-weight:900; font-size:10px; font-family:system-ui;
  }
  .popup-content { font-family:system-ui; min-width:140px; }
  .popup-title { font-size:13px; font-weight:700; margin-bottom:3px; color:#1e293b; }
  .popup-sub { font-size:11px; color:#475569; margin-bottom:6px; }
  .popup-btn {
    background:#6366f1; color:white; border:none; border-radius:5px;
    padding:5px 10px; font-size:11px; font-weight:700; cursor:pointer; width:100%;
  }
</style>
</head>
<body>
<div id="map"></div>
<div id="err"></div>
<script>
function showErr(msg) {
  var el = document.getElementById('err');
  el.textContent = msg; el.style.display = 'block';
}
</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        onerror="showErr('Leaflet failed to load — check network'); document.getElementById('map').style.background='#f1f5f9';">
</script>
<script>
  function initMap() {
    if (typeof L === 'undefined') { showErr('Leaflet not loaded'); return; }
  var map = L.map('map', { center: ${JSON.stringify(center)}, zoom: 13 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OSM'
  }).addTo(map);

  var ticketMarkers = ${ticketMarkersJs};
  var customerMarkers = ${customerMarkersJs};
  var surveyMarkers = ${surveyMarkerJs};
  var allMarkers = [];

  // Render customer GPS pins first (bottom layer)
  customerMarkers.forEach(function(m) {
    var icon = L.divIcon({
      className: '',
      iconSize: m.item_type === 'pg_building' ? [30,30] : [22,22],
      iconAnchor: m.item_type === 'pg_building' ? [15,15] : [11,11],
      popupAnchor: [0,-14],
      html: '<div class="' + (m.item_type === 'pg_building' ? 'pgm' : 'cm') + '" style="background:' + m.color + '">' +
              (m.item_type === 'pg_building' ? 'PG' : (m.name ? m.name[0].toUpperCase() : '?')) +
            '</div>'
    });
    var marker = L.marker([m.lat, m.lng], { icon: icon }).addTo(map);
    marker.bindPopup(
      '<div class="popup-content">' +
        '<div class="popup-title">' + (m.name || m.username) + '</div>' +
        '<div class="popup-sub">' + (m.item_type === 'pg_building' ? ((m.building_type || 'PG') + ' · ' + m.floor_count + ' floors · ' + m.room_count + ' rooms · ' + m.customer_count + ' customers') : m.username) + '</div>' +
        '<button class="popup-btn" onclick="' + (m.item_type === 'pg_building' ? 'openPG(\\'' + m.building_id + '\\')' : 'openCustomer(\\'' + m.username + '\\')') + '">' + (m.item_type === 'pg_building' ? 'Open Building' : 'View Customer') + '</button>' +
      '</div>'
    );
    allMarkers.push([m.lat, m.lng]);
  });

  // Render ticket markers (top layer)
  ticketMarkers.forEach(function(m) {
    var icon = L.divIcon({
      className: '',
      iconSize: [28,28],
      iconAnchor: [14,14],
      popupAnchor: [0,-18],
      html: '<div class="tm" style="background:' + m.color + '">' +
              (m.name ? m.name[0].toUpperCase() : '?') +
            '</div>'
    });
    var marker = L.marker([m.lat, m.lng], { icon: icon }).addTo(map);
    marker.bindPopup(
      '<div class="popup-content">' +
        '<div class="popup-title">' + m.title + '</div>' +
        '<div class="popup-sub">' + (m.name || '') + '</div>' +
        '<button class="popup-btn" onclick="openTicket(' + m.id + ')">Open Ticket</button>' +
      '</div>'
    );
    allMarkers.push([m.lat, m.lng]);
  });

  // Survey mode single pin
  surveyMarkers.forEach(function(m) {
    var icon = L.divIcon({
      className: '',
      iconSize: [28,28],
      iconAnchor: [14,14],
      popupAnchor: [0,-18],
      html: '<div class="tm" style="background:' + m.color + '">★</div>'
    });
    L.marker([m.lat, m.lng], { icon: icon }).addTo(map)
      .bindPopup('<div class="popup-content"><div class="popup-title">' + m.title + '</div></div>')
      .openPopup();
    allMarkers.push([m.lat, m.lng]);
  });

  if (allMarkers.length > 1) {
    var bounds = L.latLngBounds(allMarkers);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  function openTicket(id) {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'openTicket', id: id }));
  }
  function openCustomer(username) {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'openCustomer', username: username }));
  }
  function openPG(buildingId) {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'openPG', buildingId: buildingId }));
  }
  } // end initMap

  // Leaflet is loaded via <script> tag above. Call initMap once DOM + Leaflet are ready.
  if (typeof L !== 'undefined') {
    initMap();
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      var tries = 0;
      var interval = setInterval(function() {
        tries++;
        if (typeof L !== 'undefined') { clearInterval(interval); initMap(); }
        else if (tries > 40) { clearInterval(interval); showErr('Map load timeout'); }
      }, 250);
    });
  }
</script>
</body>
</html>`;
    }, [tickets, gpsCustomers, surveyMode, surveyLat, surveyLng]);

    const handleMessage = (event: any) => {
        try {
            const msg = JSON.parse(event.nativeEvent.data);
            if (msg.type === 'openTicket' && msg.id) {
                router.push({ pathname: '/ticket/[id]', params: { id: msg.id } });
            } else if (msg.type === 'openCustomer' && msg.username) {
                router.push({ pathname: '/customer/[id]' as any, params: { id: msg.username } });
            } else if (msg.type === 'openPG' && msg.buildingId) {
                router.push({ pathname: '/pg/[id]' as any, params: { id: msg.buildingId } });
            }
        } catch {}
    };

    return (
        <View style={styles.container}>
            <WebView
                source={{ html, baseUrl: 'https://unpkg.com/' }}
                style={styles.map}
                onMessage={handleMessage}
                javaScriptEnabled
                domStorageEnabled
                originWhitelist={['*', 'https://*', 'http://*']}
                mixedContentMode="always"
                allowUniversalAccessFromFileURLs
                allowFileAccess
                allowFileAccessFromFileURLs
                onError={(e) => console.warn('[AppMap] WebView error:', e.nativeEvent)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    map: { flex: 1 },
});
