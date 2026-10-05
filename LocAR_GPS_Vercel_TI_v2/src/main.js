import * as THREE from "three";
import { App } from "locar";

const btn = document.getElementById("start");
const statusEl = document.getElementById("status");
const coordsEl = document.getElementById("coords");
const accuracyEl = document.getElementById("accuracy");
const distanceEl = document.getElementById("distance");
const canvas = document.getElementById("ar-canvas");

const TARGET = {
  lat: -2.291122,
  lon: -78.1141843,
  name: "LABORATORIO DE REDES"
};

function setStatus(msg) {
  statusEl.textContent = msg;
  console.log("[ESTADO]", msg);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const p1 = toRad(lat1), p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp/2)**2 +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function makeBox(color, size = 10) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshBasicMaterial({ color })
  );
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  btn.textContent = "INICIANDO...";
  setStatus("Solicitando cámara y sensores...");

  try {
    const app = new App({
      canvas,
      // ✅ FIX 1: Forzar el video de fondo desde el constructor
      showVideoBackground: true,
      cameraOptions: {
        hFov: 80,
        near: 0.001,
        far: 500            // ✅ FIX 2: antes 2000. Reduce carga del GPU.
      },
      videoConstraints: {
        video: {
          facingMode: "environment",
          // ✅ FIX 3: Forzar resolución baja para que vaya fluido
          width:  { ideal: 640 },
          height: { ideal: 480 }
        }
      }
    });

    // ✅ FIX 4: Backup. Si el evento existe, asignamos la textura manualmente.
    app.on("webcamstarted", (ev) => {
      console.log("Cámara iniciada (evento).");
      if (ev && ev.texture) {
        app.scene.background = ev.texture;
      }
    });

    app.on("webcamerror", (err) => {
      console.error("Error de cámara:", err);
      setStatus(`Error de cámara: ${err.message || err.code}`);
    });

    const locar = await app.start();

    // ✅ FIX 5: Si después de arrancar existe el elemento <video>, forzamos el fondo.
    if (app.video) {
      try {
        const videoTexture = new THREE.VideoTexture(app.video);
        videoTexture.minFilter = THREE.LinearFilter;
        videoTexture.magFilter = THREE.LinearFilter;
        videoTexture.generateMipmaps = false;
        app.scene.background = videoTexture;
        console.log("Fondo de video asignado manualmente.");
      } catch (err) {
        console.warn("No se pudo asignar el fondo de video:", err);
      }
    }

    // ✅ FIX 6: Reducir el pixel ratio a 1 para acelerar el render en móvil.
    if (app.renderer) {
      app.renderer.setPixelRatio(1);
      console.log("Pixel ratio ajustado a 1.");
    }

    locar.setGpsOptions({
      enableHighAccuracy: false,
      maximumAge: 0,
      timeout: 30000
    });

    let objectsAdded = false;

    locar.on("gpserror", (err) => {
      const code = err?.code ?? "";
      const msg = err?.message ?? "Error desconocido";
      setStatus(`Error GPS ${code}: ${msg}`);
      btn.disabled = false;
      btn.textContent = "REINTENTAR";
    });

    locar.on("gpsupdate", (ev) => {
      const c = ev.position.coords;

      coordsEl.textContent =
        `GPS: ${c.latitude.toFixed(7)}, ${c.longitude.toFixed(7)}`;
      accuracyEl.textContent =
        `Precisión: ${Math.round(c.accuracy)} m`;

      const dist = haversineMeters(
        c.latitude, c.longitude, TARGET.lat, TARGET.lon
      );
      distanceEl.textContent =
        `Distancia al Laboratorio: ${Math.round(dist)} m`;

      if (!objectsAdded) {
        const targetBox = makeBox(0xff00ff, 12);
        locar.add(targetBox, TARGET.lon, TARGET.lat, 6);

        const offset = 0.0001;

        const refs = [
          { dLat:  offset, dLon:  0,      color: 0xff0000 },
          { dLat: -offset, dLon:  0,      color: 0xffff00 },
          { dLat:  0,      dLon: -offset, color: 0x00ffff },
          { dLat:  0,      dLon:  offset, color: 0x00ff00 }
        ];

        for (const r of refs) {
          const box = makeBox(r.color, 10);
          locar.add(box, c.longitude + r.dLon, c.latitude + r.dLat, 5);
        }

        objectsAdded = true;
        setStatus("✅ GPS inicial recibido. Gira lentamente 360° y busca los cubos.");
        btn.style.display = "none";
      }
    });

    setStatus("Cámara iniciada. Solicitando ubicación GPS...");
    await locar.startGps();

  } catch (e) {
    console.error("Error fatal:", e);
    const msg = e?.message || String(e);
    setStatus(`❌ No se pudo iniciar AR: ${msg}`);
    btn.disabled = false;
    btn.textContent = "REINTENTAR";
  }
});
