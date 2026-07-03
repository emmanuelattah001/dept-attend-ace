import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icons (Leaflet + bundlers)
// @ts-ignore
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface Props {
  lat: number | null;
  lng: number | null;
  radius: number;
  onChange: (lat: number, lng: number) => void;
  height?: number;
}

function ClickHandler({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { onChange(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

function Recenter({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null) map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

export function LocationPicker({ lat, lng, radius, onChange, height = 240 }: Props) {
  const center: [number, number] = [lat ?? 9.082, lng ?? 8.6753]; // fallback Nigeria center
  return (
    <div style={{ height }} className="rounded-md overflow-hidden border">
      <MapContainer center={center} zoom={lat != null ? 17 : 6} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{y}/{x}.png"
        />
        <ClickHandler onChange={onChange} />
        <Recenter lat={lat} lng={lng} />
        {lat != null && lng != null && (
          <>
            <Marker position={[lat, lng]} />
            <Circle center={[lat, lng]} radius={radius} pathOptions={{ color: '#2563eb', fillOpacity: 0.1 }} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
