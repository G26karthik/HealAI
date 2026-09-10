import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Leaflet + OpenStreetMap tiles — no API key, no billing, nothing to expire
 * the morning of the event.
 *
 * Markers are divIcons (styled HTML) rather than image pins. Leaflet's default
 * marker images break under every bundler unless you re-wire the asset paths;
 * HTML markers sidestep that entirely and let a vehicle carry its own label.
 */

const TIER_COLOR = { T1: '#b91c1c', T2: '#c2410c', T3: '#1d4ed8', T4: '#15803d' };

// GeoJSON is [lng, lat]; Leaflet wants [lat, lng]. Getting this backwards puts
// Hyderabad in the Indian Ocean, so the swap lives in exactly one place.
const toLatLng = (pos) => (Array.isArray(pos) ? [pos[1], pos[0]] : null);

function vehicleIcon({ label, type, moving }) {
  const bg = type === 'ALS' ? '#b91c1c' : '#334155';
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;gap:4px;transform:translate(-50%,-50%)">
      <div style="background:${bg};color:#fff;border-radius:9999px;width:26px;height:26px;
                  display:grid;place-items:center;font-size:14px;box-shadow:0 1px 4px rgba(0,0,0,.4);
                  ${moving ? 'outline:3px solid rgba(185,28,28,.28);' : ''}">🚑</div>
      <span style="background:#fff;border:1px solid #cbd5e1;border-radius:4px;padding:0 4px;
                   font:600 10px system-ui;white-space:nowrap">${label}</span>
    </div>`,
    iconSize: [0, 0],
  });
}

function patientIcon(tier) {
  const c = TIER_COLOR[tier] || '#475569';
  return L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-50%);background:${c};color:#fff;border-radius:6px;
                       min-width:22px;height:22px;display:grid;place-items:center;
                       font:700 10px system-ui;box-shadow:0 1px 4px rgba(0,0,0,.4)">${tier}</div>`,
    iconSize: [0, 0],
  });
}

/** Keeps the viewport sensible without fighting the user for control. */
function FitBounds({ points, follow }) {
  const map = useMap();
  const didFit = useRef(false);

  useEffect(() => {
    const valid = points.filter(Boolean);
    if (valid.length === 0) return;
    // Fit once on load; afterwards only pan if explicitly following a vehicle,
    // so the map does not yank itself away while someone is reading it.
    if (!didFit.current) {
      didFit.current = true;
      if (valid.length === 1) map.setView(valid[0], 14);
      else map.fitBounds(L.latLngBounds(valid).pad(0.25));
    } else if (follow) {
      map.panTo(valid[0], { animate: true, duration: 0.6 });
    }
  }, [points, follow, map]);

  return null;
}

export default function MapView({
  vehicles = [],
  requests = [],
  zones = [],
  runs = [],
  height = 380,
  follow = false,
}) {
  const runByResource = useMemo(
    () => new Map(runs.map((r) => [r.name, r])),
    [runs]
  );

  const focusPoints = useMemo(() => {
    const pts = [];
    for (const r of runs) {
      pts.push(toLatLng(r.pos), toLatLng(r.to));
    }
    if (!pts.length) {
      for (const v of vehicles.slice(0, 12)) pts.push(toLatLng(v.pos));
      for (const r of requests) pts.push(toLatLng(r.pos));
    }
    return pts.filter(Boolean);
  }, [runs, vehicles, requests]);

  return (
    <div className="overflow-hidden rounded-xl border border-line" style={{ height }}>
      <MapContainer
        center={[17.385, 78.4867]}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitBounds points={focusPoints} follow={follow} />

        {/* Congestion, drawn. Redder and larger = slower. */}
        {zones.map((z) => (
          <Circle
            key={z.id}
            center={toLatLng(z.center)}
            radius={2600 + (z.trafficIndex ?? 1) * 700}
            pathOptions={{
              color: (z.trafficIndex ?? 1) > 1.8 ? '#b91c1c' : '#64748b',
              weight: 1,
              fillOpacity: Math.min(0.04 + (z.trafficIndex ?? 1) * 0.035, 0.18),
            }}
          >
            <Popup>
              <strong>{z.name}</strong>
              <br />
              traffic ×{(z.trafficIndex ?? 1).toFixed(2)}
            </Popup>
          </Circle>
        ))}

        {/* Route lines for vehicles currently en route */}
        {runs.map((r) => (
          <Polyline
            key={r.assignmentId}
            positions={[toLatLng(r.pos), toLatLng(r.to)]}
            pathOptions={{ color: '#b91c1c', weight: 2, dashArray: '6 6', opacity: 0.8 }}
          />
        ))}

        {requests.map((r) =>
          toLatLng(r.pos) ? (
            <Marker key={r.id} position={toLatLng(r.pos)} icon={patientIcon(r.tier)}>
              <Popup>
                <strong>{r.tier}</strong> · {r.state?.replace(/_/g, ' ')}
                <br />
                {r.label || 'request'}
                {r.needsHumanReview && (
                  <>
                    <br />
                    <em>awaiting human review</em>
                  </>
                )}
              </Popup>
            </Marker>
          ) : null
        )}

        {vehicles.map((v) => {
          const live = runByResource.get(v.name);
          const pos = toLatLng(live?.pos || v.pos);
          if (!pos) return null;
          return (
            <Marker
              key={v.id || v.name}
              position={pos}
              icon={vehicleIcon({ label: v.name, type: v.type, moving: Boolean(live) })}
              zIndexOffset={live ? 500 : 0}
            >
              <Popup>
                <strong>{v.name}</strong> · {v.type}
                <br />
                {live ? (
                  <>
                    en route — ETA {live.etaP50Min}–{live.etaP90Min} min
                  </>
                ) : (
                  <>{v.status}</>
                )}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
