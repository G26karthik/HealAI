import { ZONES, CITY_CENTER } from '../../../shared/enums.js';

const R = 6371000; // metres
const rad = (d) => (d * Math.PI) / 180;

/** Straight-line distance in metres between two [lng, lat] points. */
export function haversineM([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Which zone a point falls in. Zones are circles-by-nearest-centre, not polygons —
 *  accurate enough for a simulation and free of a point-in-polygon dependency. */
export function zoneFor(coords) {
  let best = ZONES[0];
  let bestD = Infinity;
  for (const z of ZONES) {
    const d = haversineM(coords, z.center);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

/** Accept lat/lng from the browser (or nothing) and return a GeoJSON Point. */
export function toPoint(lat, lng) {
  const ok = Number.isFinite(lat) && Number.isFinite(lng);
  return { type: 'Point', coordinates: ok ? [Number(lng), Number(lat)] : [...CITY_CENTER] };
}
