import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  LayersControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Geolocation } from "@capacitor/geolocation";

/* =========================================================
   CUSTOM LOCATION MARKER
   ========================================================= */

const NATIVE_PIN_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 384 512"
    width="32"
    height="42"
  >
    <path
      fill="#2563eb"
      stroke="#ffffff"
      stroke-width="20"
      d="M172.268 501.67C26.97 291.031 0 269.413 0 192
      0 85.961 85.961 0 192 0s192 85.961 192 192
      c0 77.413-26.97 99.031-172.268 309.67
      -9.535 13.774-29.93 13.773-39.464 0z
      M192 272c44.183 0 80-35.817 80-80
      s-35.817-80-80-80-80 35.817-80 80
      35.817 80 80 80z"
    />
  </svg>
`)}`;

const verifiedNativeIcon = new L.Icon({
  iconUrl: NATIVE_PIN_SVG,
  iconRetinaUrl: NATIVE_PIN_SVG,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -40],
});

/* =========================================================
   TYPES
   ========================================================= */

interface Props {
  lat: number | null;
  lng: number | null;
  radius: number;
  onChange: (lat: number, lng: number) => void;
  height?: number;
}

/* =========================================================
   MAP CLICK HANDLER
   ========================================================= */

function ClickHandler({
  onChange,
}: {
  onChange: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(event) {
      onChange(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

/* =========================================================
   RECENTER MAP WHEN LOCATION CHANGES
   ========================================================= */

function Recenter({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();

  useEffect(() => {
    if (lat !== null && lng !== null) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 16), {
        duration: 0.8,
      });
    }
  }, [lat, lng, map]);

  return null;
}

/* =========================================================
   CURRENT LOCATION BUTTON
   ========================================================= */

function CurrentLocationButton({
  onLocationFound,
}: {
  onLocationFound: (lat: number, lng: number) => void;
}) {
  const map = useMap();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getCurrentLocation = async () => {
    setLoading(true);
    setError(null);

    try {
      let latitude: number;
      let longitude: number;

      /*
       * Try Capacitor Geolocation first.
       * This is useful when running the app
       * as an Android/iOS Capacitor application.
       */
      try {
        const permission = await Geolocation.checkPermissions();

        if (permission.location !== "granted") {
          await Geolocation.requestPermissions();
        }

        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });

        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      } catch (capacitorError) {
        /*
         * Browser fallback.
         * This allows the component to work during
         * normal Vite development in Chrome.
         */
        if (!navigator.geolocation) {
          throw new Error(
            "Geolocation is not supported by this device or browser.",
          );
        }

        const position = await new Promise<GeolocationPosition>(
          (resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 0,
            });
          },
        );

        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      }

      /*
       * Update parent component.
       */
      onLocationFound(latitude, longitude);

      /*
       * Move map to current location.
       */
      map.flyTo([latitude, longitude], 17, {
        duration: 1,
      });
    } catch (err) {
      console.error("Unable to get current location:", err);

      const message =
        err instanceof Error
          ? err.message
          : "Unable to determine your current location.";

      setError(message);

      /*
       * Automatically hide error after 4 seconds.
       */
      window.setTimeout(() => {
        setError(null);
      }, 4000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Current location button */}
      <button
        type="button"
        onClick={getCurrentLocation}
        disabled={loading}
        title="Use my current location"
        aria-label="Use my current location"
        className="
          absolute
          right-3
          top-3
          z-[1000]
          flex
          h-10
          w-10
          items-center
          justify-center
          rounded-md
          border
          border-slate-200
          bg-white
          text-slate-700
          shadow-md
          transition
          hover:bg-slate-50
          active:scale-95
          disabled:cursor-not-allowed
          disabled:opacity-60
        "
      >
        {loading ? (
          <span
            className="
              h-5
              w-5
              animate-spin
              rounded-full
              border-2
              border-slate-300
              border-t-blue-600
            "
          />
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3" />
            <path d="M12 19v3" />
            <path d="M2 12h3" />
            <path d="M19 12h3" />
          </svg>
        )}
      </button>

      {/* Location error */}
      {error && (
        <div
          className="
            absolute
            left-3
            right-3
            top-3
            z-[1000]
            rounded-md
            border
            border-red-200
            bg-white
            px-3
            py-2
            pr-10
            text-sm
            text-red-700
            shadow-md
          "
        >
          {error}
        </div>
      )}
    </>
  );
}

/* =========================================================
   MAIN LOCATION PICKER
   ========================================================= */

export function LocationPicker({
  lat,
  lng,
  radius,
  onChange,
  height = 400,
}: Props) {
  /*
   * Default campus fallback.

   * This is only used when no location has
   * been selected yet.
   */
  const defaultCampusLat = 9.1538;
  const defaultCampusLng = 7.3204;

  const center: [number, number] = [
    lat ?? defaultCampusLat,
    lng ?? defaultCampusLng,
  ];

  return (
    <div
      style={{ height }}
      className="
        relative
        z-0
        w-full
        overflow-hidden
        rounded-lg
        border
        border-slate-200
        bg-slate-100
        shadow-sm
      "
    >
      <MapContainer
        center={center}
        zoom={lat !== null && lng !== null ? 17 : 14}
        style={{
          height: "100%",
          width: "100%",
        }}
        scrollWheelZoom={true}
        attributionControl={true}
      >
        <LayersControl position="topright">
          {/* =================================================
              STREET MAP
              ================================================= */}

          <LayersControl.BaseLayer checked name="🗺️ Street Map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          {/* =================================================
              SATELLITE MAP
              ================================================= */}

          <LayersControl.BaseLayer name="🛰️ Satellite">
            <TileLayer
              attribution='Tiles &copy; <a href="https://www.esri.com/">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          {/* =================================================
              SATELLITE + LABELS
              ================================================= */}

          <LayersControl.BaseLayer name="🛰️ Satellite + Labels">
            <>
              <TileLayer
                attribution='Tiles &copy; <a href="https://www.esri.com/">Esri</a>'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />

              <TileLayer
                attribution=""
                url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
            </>
          </LayersControl.BaseLayer>
        </LayersControl>

        {/* =================================================
            MAP CLICK SELECTION
            ================================================= */}

        <ClickHandler onChange={onChange} />

        {/* =================================================
            RECENTER WHEN LOCATION CHANGES
            ================================================= */}

        <Recenter lat={lat} lng={lng} />

        {/* =================================================
            CURRENT LOCATION
            ================================================= */}

        <CurrentLocationButton
          onLocationFound={(latitude, longitude) => {
            onChange(latitude, longitude);
          }}
        />

        {/* =================================================
            SELECTED LOCATION + RADIUS
            ================================================= */}

        {lat !== null && lng !== null && (
          <>
            <Marker position={[lat, lng]} icon={verifiedNativeIcon} />

            <Circle
              center={[lat, lng]}
              radius={radius}
              pathOptions={{
                color: "#2563eb",
                fillColor: "#2563eb",
                fillOpacity: 0.12,
                weight: 2,
              }}
            />
          </>
        )}
      </MapContainer>

      {/* =====================================================
          MAP INSTRUCTION
          ===================================================== */}

      <div
        className="
          pointer-events-none
          absolute
          bottom-3
          left-3
          z-[1000]
          rounded-md
          bg-white/95
          px-3
          py-2
          text-xs
          text-slate-600
          shadow-md
          backdrop-blur-sm
        "
      >
        Click anywhere on the map to select attendance location
      </div>
    </div>
  );
}
