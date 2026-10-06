import * as THREE from "three";
import { App } from "locar";

const btn = document.getElementById("start");
const statusEl = document.getElementById("status");
const coordsEl = document.getElementById("coords");
const accuracyEl = document.getElementById("accuracy");
const distanceEl = document.getElementById("distance");
const canvas = document.getElementById("ar-canvas");

// Coordenada del Laboratorio de Redes
const TARGET = {
  lat: -2.291135,
  lon: -78.114209,
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
  const a = Math.sin(dp / 2) ** 2 +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function makeBox(color, size = 10) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshBasicMaterial({ color })
  );
}

// Rumbo (bearing) desde el usuario hacia el objetivo
// 0=Norte, 90=Este, 180=Sur, 270=Oeste
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
    // ============================================================
    // 1) INICIALIZAR LOCAR
    // ============================================================
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
      if (ev && ev.texture) app.scene.background = ev.texture;
    });

    app.on("webcamerror", (err) => {
      console.error("Error de cámara:", err);
      setStatus(`Error de cámara: ${err.message || err.code}`);
    });

    const locar = await app.start();

    // Fondo de video manual (respaldo)
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

    // ============================================================
    // 2) BUSCAR LA CÁMARA 3D DE THREE.JS
    // ============================================================
    let camera3D = null;
    if (app.scene && app.scene.camera) camera3D = app.scene.camera;
    else if (app.camera) camera3D = app.camera;
    else if (app.scene) {
      app.scene.traverse(obj => {
        if (obj.isCamera && !camera3D) camera3D = obj;
      });
    }

    // ============================================================
    // 3) COMPÁS HUD: 4 CUADROS ALREDEDOR DE LA FLECHA
    // ============================================================
    const compassWrap = document.createElement("div");
    compassWrap.style.cssText = `
      position: fixed;
      z-index: 15;
      bottom: 40px;
      left: 50%;
      width: 220px;
      height: 220px;
      pointer-events: none;
      transform: translate3d(-50%, 0, 0);
    `;

    const CARDINALS = [
      { key: "N", label: "N", color: "#ff0000", angle: 0   },
      { key: "E", label: "E", color: "#00ff00", angle: 90  },
      { key: "S", label: "S", color: "#ffff00", angle: 180 },
      { key: "W", label: "W", color: "#00ffff", angle: 270 }
    ];
    const RADIUS = 82;

    CARDINALS.forEach(c => {
      const box = document.createElement("div");
      box.style.cssText = `
        position: absolute;
        left: 50%;
        top: 50%;
        width: 38px;
        height: 38px;
        margin-left: -19px;
        margin-top: -19px;
        background: ${c.color};
        border: 2px solid #ffffff;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 18px;
        color: #000000;
        will-change: transform;
        transform: translate(0px, -${RADIUS}px);
        box-shadow: 0 0 8px rgba(0,0,0,0.8);
      `;
      box.textContent = c.label;
      compassWrap.appendChild(box);
      c.el = box;
    });

    // Flecha central
    const arrow = document.createElement("div");
    arrow.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      width: 60px;
      height: 60px;
      margin-left: -30px;
      margin-top: -30px;
      pointer-events: none;
      will-change: transform;
      transform: rotate(0deg);
      transform-origin: 50% 50%;
    `;
    arrow.innerHTML = `
      <svg viewBox="0 0 100 100" width="60" height="60" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="46" fill="rgba(0,0,0,0.5)"/>
        <circle cx="50" cy="50" r="44" fill="none" stroke="#ffffff" stroke-width="3"/>
        <polygon points="50,14 70,52 58,52 58,86 42,86 42,52 30,52"
                 fill="#00ff00" stroke="#003300" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    `;
    compassWrap.appendChild(arrow);
    document.body.appendChild(compassWrap);

    // ============================================================
    // 4) ESTADO Y VARIABLES
    // ============================================================
    let lastUserLat = null;
    let lastUserLon = null;
    let lastDeg = null;
    let lastHeading = null;

    const worldQuat = new THREE.Quaternion();
    const forwardVec = new THREE.Vector3();

    // ============================================================
    // 5) BUCLE DE ACTUALIZACIÓN DEL COMPÁS Y LA FLECHA (10 FPS)
    // ============================================================
    setInterval(() => {
      if (!camera3D || lastUserLat === null) return;

      // 5a) Heading de la cámara (rotación de los cuadros)
      camera3D.getWorldQuaternion(worldQuat);
      forwardVec.set(0, 0, -1).applyQuaternion(worldQuat);
      let camHeading = Math.atan2(forwardVec.x, -forwardVec.z) * 180 / Math.PI;
      camHeading = (camHeading + 360) % 360;

      if (lastHeading === null || Math.abs(camHeading - lastHeading) >= 0.5) {
        lastHeading = camHeading;
        CARDINALS.forEach(c => {
          const screenAngle = c.angle - camHeading;
          const rad = (screenAngle - 90) * Math.PI / 180;
          const x = Math.cos(rad) * RADIUS;
          const y = Math.sin(rad) * RADIUS;
          c.el.style.transform = `translate(${x}px, ${y}px)`;
        });
      }

      // 5b) Ángulo de la flecha respecto al cubo 3D real
      let delta = 0;

      if (window.__targetBox && window.__targetBox.parent) {
        const targetWorld = new THREE.Vector3();
        window.__targetBox.getWorldPosition(targetWorld);

        const camPos = new THREE.Vector3();
        camera3D.getWorldPosition(camPos);

        const toTarget = targetWorld.clone().sub(camPos);
        toTarget.y = 0;

        const camFwd = new THREE.Vector3();
        camera3D.getWorldDirection(camFwd);
        camFwd.y = 0;

        if (toTarget.lengthSq() > 0.0001 && camFwd.lengthSq() > 0.0001) {
          toTarget.normalize();
          camFwd.normalize();
          const cross = camFwd.x * toTarget.z - camFwd.z * toTarget.x;
          const dot   = camFwd.x * toTarget.x + camFwd.z * toTarget.z;
          delta = Math.atan2(cross, dot) * 180 / Math.PI;
          delta = -delta;
        }
      } else {
        // Fallback si el cubo aún no está
        const targetBearing = getBearingToTarget(
          lastUserLat, lastUserLon, TARGET.lat, TARGET.lon
        );
        delta = targetBearing - camHeading;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
      }

      const roundedDelta = Math.round(delta);
      if (lastDeg === null || Math.abs(roundedDelta - lastDeg) >= 1) {
        lastDeg = roundedDelta;
        arrow.style.transform = `rotate(${delta}deg)`;
      }

      const arrowPath = arrow.querySelector("polygon");
      if (Math.abs(delta) < 15) {
        arrowPath.setAttribute("fill", "#00ff00");
      } else {
        arrowPath.setAttribute("fill", "#aaffaa");
      }

      // Debug
      statusEl.textContent =
        `LAB→ ${Math.round(getBearingToTarget(lastUserLat, lastUserLon, TARGET.lat, TARGET.lon))}°  Cam→ ${Math.round(camHeading)}°  Δ ${roundedDelta}°`;
    }, 100);

    // ============================================================
    // 6) CONFIGURAR GPS
    // ============================================================
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

    // ============================================================
    // 7) EN CADA ACTUALIZACIÓN DE GPS
    // ============================================================
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
        // ---- Primera vez: crear los cubos con espejado E-O ----
        const mirroredLon = 2 * c.longitude - TARGET.lon;

        // Cubo magenta del LAB
        const targetBox = makeBox(0xff00ff, 6);
        targetBox.frustumCulled = false;
        window.__targetBox = targetBox;
        locar.add(targetBox, mirroredLon, TARGET.lat, 2);

        // Cubo azul de referencia cercano (~5 m al norte)
        const nearBox = makeBox(0x00aaff, 3);
        nearBox.frustumCulled = false;
        window.__nearBox = nearBox;
        locar.add(nearBox, c.longitude, c.latitude + 0.00005, 1.5);

        // Guardar la posición con la que se calculó
        window.__lastUserLon = c.longitude;
        window.__lastUserLat = c.latitude;

        objectsAdded = true;
        setStatus("✅ Cubos añadidos. Esperando a que el GPS se estabilice…");
        btn.style.display = "none";

      } else {
        // ---- Actualizaciones posteriores: re-anclar si el GPS se movió ----
        // Umbral 0.00003° ≈ 3.3 m
        if (window.__targetBox && Math.abs(c.longitude - window.__lastUserLon) > 0.00003) {
          const newMirroredLon = 2 * c.longitude - TARGET.lon;

          locar.remove(window.__targetBox);
          locar.add(window.__targetBox, newMirroredLon, TARGET.lat, 2);

          if (window.__nearBox) {
            locar.remove(window.__nearBox);
            locar.add(window.__nearBox, c.longitude, c.latitude + 0.00005, 1.5);
          }

          window.__lastUserLon = c.longitude;
          window.__lastUserLat = c.latitude;

          console.log("[FIX] Cubo re-anclado con nueva posición GPS");
        }
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
