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

// ✅ NUEVO: Rumbo (bearing) desde el usuario hacia el objetivo
//    0 = Norte, 90 = Este, 180 = Sur, 270 = Oeste
function getBearingToTarget(userLat, userLon, targetLat, targetLon) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLon = toRad(targetLon - userLon);
  const lat1 = toRad(userLat);
  const lat2 = toRad(targetLat);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  btn.textContent = "INICIANDO...";
  setStatus("Solicitando cámara y sensores...");

  try {
    const app = new App({
      canvas,
      showVideoBackground: true,
      cameraOptions: {
        hFov: 80,
        near: 0.001,
        far: 500
      },
      videoConstraints: {
        video: {
          facingMode: "environment",
          width:  { ideal: 640 },
          height: { ideal: 480 }
        }
      }
    });

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

    if (app.renderer) {
      app.renderer.setPixelRatio(1);
      console.log("Pixel ratio ajustado a 1.");
    }

    // ✅ NUEVO: Buscar la cámara 3D de Three.js (para leer hacia dónde miras)
    let camera3D = null;
    if (app.scene && app.scene.camera) camera3D = app.scene.camera;
    else if (app.camera) camera3D = app.camera;
    else if (app.scene) {
      app.scene.traverse(obj => {
        if (obj.isCamera && !camera3D) camera3D = obj;
      });
    }
    console.log("Cámara 3D encontrada:", !!camera3D);

    // ✅ NUEVO: Crear el punto indicador (elemento HTML, cero costo GPU)
    const dot = document.createElement("div");
    dot.id = "direction-dot";
    dot.style.cssText = `
      position: fixed;
      z-index: 15;
      bottom: 80px;
      left: 50%;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #000;
      border: 3px solid #fff;
      transform: translateX(-50%);
      pointer-events: none;
      box-shadow: 0 0 12px rgba(0,0,0,0.7);
      transition: left 0.15s linear, background 0.2s;
    `;
    document.body.appendChild(dot);

    // ✅ NUEVO: Guardar la última posición GPS del usuario
    let lastUserLat = null;
    let lastUserLon = null;

    // ✅ NUEVO: Actualizar el punto 5 veces por segundo (nada de carga)
    setInterval(() => {
      if (!camera3D || lastUserLat === null) return;

      // 1) Dirección en la que mira la cámara (en grados, 0=Norte, 90=Este)
      const forward = new THREE.Vector3();
      camera3D.getWorldDirection(forward);
      let camHeading = Math.atan2(forward.x, forward.z) * 180 / Math.PI;
      camHeading = (camHeading + 360) % 360;
      // En Three.js mirar hacia -Z da heading 180; sumamos 180 para que Norte = 0
      // camHeading = (camHeading + 180) % 360;  // ← antes
      camHeading = camHeading;                    // ← ahora (sin el +180)

      // 2) Rumbo hacia el laboratorio
      const targetBearing = getBearingToTarget(
        lastUserLat, lastUserLon, TARGET.lat, TARGET.lon
      );

      // 3) Diferencia (cuánto hay que girar)
      //    0 = el objetivo está al frente
      //    +90 = hay que girar a la derecha
      //    -90 = hay que girar a la izquierda
      //    ±180 = el objetivo está detrás
      let delta = targetBearing - camHeading;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;

      // 4) Colocar el punto en pantalla
      //    Cuando delta=0 el punto va al centro (50%)
      //    Cuando delta=±90 el punto va al 10% o al 90%
      const angleRad = delta * Math.PI / 180;
      const xPercent = 50 + Math.sin(angleRad) * 40;
      dot.style.left = xPercent + "%";

      // 5) Color: verde si ya estás mirando hacia el objetivo, negro si no
      if (Math.abs(delta) < 15) {
        dot.style.background = "#00ff00";
      } else {
        dot.style.background = "#000";
      }
    }, 200); // 5 Hz

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

      // ✅ NUEVO: guardar la posición para el punto indicador
      lastUserLat = c.latitude;
      lastUserLon = c.longitude;

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
        const targetBox = makeBox(0xff00ff, 4);
        locar.add(targetBox, TARGET.lon, TARGET.lat, 2);

        const offset = 0.0001;

        const refs = [
          { dLat:  offset, dLon:  0,      color: 0xff0000 },
          { dLat: -offset, dLon:  0,      color: 0xffff00 },
          { dLat:  0,      dLon: -offset, color: 0x00ffff },
          { dLat:  0,      dLon:  offset, color: 0x00ff00 }
        ];

        for (const r of refs) {
        const box = makeBox(r.color, 3);
        locar.add(box, c.longitude + r.dLon, c.latitude + r.dLat, 1.5);
      }

        objectsAdded = true;
        setStatus("✅ GPS inicial recibido. El punto indica dónde está el Laboratorio.");
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
