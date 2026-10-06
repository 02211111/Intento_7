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
      } catch (err) {
        console.warn("No se pudo asignar el fondo de video:", err);
      }
    }

    if (app.renderer) {
      app.renderer.setPixelRatio(1);
    }

    // Buscar la cámara 3D
    let camera3D = null;
    if (app.scene && app.scene.camera) camera3D = app.scene.camera;
    else if (app.camera) camera3D = app.camera;
    else if (app.scene) {
      app.scene.traverse(obj => {
        if (obj.isCamera && !camera3D) camera3D = obj;
      });
    }

    // ✅ Flecha OPTIMIZADA: sin drop-shadow, sin transition,
    //    con will-change y translate3d para forzar aceleración por GPU.
        // ✅ Flecha SVG: más clara, misma performance
    const arrow = document.createElement("div");
    arrow.id = "direction-arrow";
    arrow.style.cssText = `
      position: fixed;
      z-index: 15;
      bottom: 90px;
      left: 50%;
      width: 60px;
      height: 60px;
      pointer-events: none;
      will-change: transform;
      transform: translate3d(-50%, 0, 0) rotate(0deg);
      transform-origin: 50% 50%;
    `;
    arrow.innerHTML = `
      <svg viewBox="0 0 100 100" width="60" height="60" xmlns="http://www.w3.org/2000/svg">
        <!-- Halo/sombra suave sin filter costoso -->
        <circle cx="50" cy="50" r="46" fill="rgba(0,0,0,0.45)"/>
        <!-- Anillo exterior -->
        <circle cx="50" cy="50" r="44" fill="none" stroke="#ffffff" stroke-width="3"/>
        <!-- Flecha: punta -->
        <polygon points="50,12 72,50 60,50 60,88 40,88 40,50 28,50"
                 fill="#00ff00" stroke="#003300" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    `;
    document.body.appendChild(arrow);

    let lastUserLat = null;
    let lastUserLon = null;
    let lastDeg = null;

    const worldQuat = new THREE.Quaternion();
    const forwardVec = new THREE.Vector3();

    // ✅ Solo 10 FPS para la flecha (era 20). Suficiente para una brújula.
    setInterval(() => {
      if (!camera3D || lastUserLat === null) return;

      camera3D.getWorldQuaternion(worldQuat);
      forwardVec.set(0, 0, -1).applyQuaternion(worldQuat);

      let camHeading = Math.atan2(forwardVec.x, forwardVec.z) * 180 / Math.PI;
camHeading = (camHeading + 180 + 360) % 360;  // ✅ +180 de corrección

      const targetBearing = getBearingToTarget(
        lastUserLat, lastUserLon, TARGET.lat, TARGET.lon
      );

      let delta = targetBearing - camHeading;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;

      // ✅ Solo actualizamos el DOM si el ángulo cambió más de 1°.
      //    Evita repintar cuando el teléfono está quieto.
      const roundedDelta = Math.round(delta);
      if (lastDeg === null || Math.abs(roundedDelta - lastDeg) >= 1) {
        lastDeg = roundedDelta;
        arrow.style.transform =
          `translate3d(-50%, 0, 0) rotate(${delta}deg)`;
      }

           // ✅ Cambia el color del polígono de la flecha
      const arrowPath = arrow.querySelector("polygon");
      if (Math.abs(delta) < 15) {
        arrowPath.setAttribute("fill", "#00ff00");
      } else {
        arrowPath.setAttribute("fill", "#aaffaa");
      }

      // Debug
      statusEl.textContent =
        `Flecha→ ${Math.round(targetBearing)}°  Cam→ ${Math.round(camHeading)}°  Δ ${roundedDelta}°`;
    }, 100); // 10 FPS

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
        const targetBox = makeBox(0xff00ff, 5);
        locar.add(targetBox, TARGET.lon, TARGET.lat, 2.5);

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
        setStatus("✅ GPS inicial recibido. Sigue la flecha verde.");
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
