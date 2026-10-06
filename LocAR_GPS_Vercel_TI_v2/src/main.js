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

// --- Sprites de texto (ya los teníamos) ---
function makeTextSprite(text, textColor = "#ffffff", borderColor = "#ffffff", scaleX = 8, scaleY = 4) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d");

  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, c.width - 12, c.height - 12);

  ctx.fillStyle = textColor;
  ctx.font = "bold 110px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2);

  const texture = new THREE.CanvasTexture(c);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scaleX, scaleY, 1);
  return sprite;
}

function makeCubeWithLabel(color, label, labelColor, size = 10) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshBasicMaterial({ color })
  );
  group.add(box);

  const labelSprite = makeTextSprite(label, "#ffffff", labelColor, 10, 5);
  labelSprite.position.set(0, size * 1.3, 0);
  group.add(labelSprite);
  return group;
}

function makeTargetMarker() {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(12, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff00ff })
  );
  group.add(box);

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(3.5, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  dot.position.set(0, 14, 0);
  group.add(dot);

  const labelSprite = makeTextSprite("LABORATORIO", "#ffffff", "#ff00ff", 22, 11);
  labelSprite.position.set(0, 26, 0);
  group.add(labelSprite);
  return group;
}

// ✅ NUEVO: Colores por dirección (mismo código que los cubos de calibración)
const DIR_COLORS = {
  NORTE: 0xff0000,   // rojo
  SUR:   0xffff00,   // amarillo
  ESTE:  0x00ff00,   // verde
  OESTE: 0x00ffff    // celeste
};

// ✅ NUEVO: Determina la dirección cardinal a partir del yaw de la cámara
function getCardinalFromCamera(camera3D) {
  const forward = new THREE.Vector3();
  camera3D.getWorldDirection(forward);

  // Ángulo en grados (0-360)
  let heading = Math.atan2(forward.x, forward.z) * 180 / Math.PI;
  heading = (heading + 360) % 360;

  // Calibración: en Three.js, mirar hacia -Z da heading=180 con atan2(x,z).
  // Restamos 180 para que el Norte quede en 0.
  heading = (heading + 180) % 360;

  if (heading >= 315 || heading < 45)  return "NORTE";
  if (heading >= 45  && heading < 135) return "ESTE";
  if (heading >= 135 && heading < 225) return "SUR";
  return "OESTE";
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
      if (ev && ev.texture) app.scene.background = ev.texture;
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

    // ✅ NUEVO: Localizar la cámara de Three.js
    let camera3D = null;
    if (app.scene && app.scene.camera) camera3D = app.scene.camera;
    else if (app.camera) camera3D = app.camera;
    else {
      app.scene.traverse(obj => {
        if (obj.isCamera && !camera3D) camera3D = obj;
      });
    }
    console.log("Cámara 3D encontrada:", camera3D);

    // ✅ NUEVO: Crear el cubo brújula como hijo de la cámara (HUD fijo)
    let compassCube = null;
    if (camera3D) {
      compassCube = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.35, 0.35),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      // 1.5m al frente, un poco abajo del centro
      compassCube.position.set(0, -0.4, -1.5);
      camera3D.add(compassCube);
      console.log("Cubo brújula añadido a la cámara.");
    }

    // ✅ NUEVO: Bucle de actualización de color
    if (camera3D && compassCube) {
      const tick = () => {
        const dir = getCardinalFromCamera(camera3D);
        compassCube.material.color.setHex(DIR_COLORS[dir]);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
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
        const targetMarker = makeTargetMarker();
        locar.add(targetMarker, TARGET.lon, TARGET.lat, 6);

        const offset = 0.0001;
        const refs = [
          { dLat:  offset, dLon:  0,      color: 0xff0000, label: "NORTE", labelColor: "#ff0000" },
          { dLat: -offset, dLon:  0,      color: 0xffff00, label: "SUR",   labelColor: "#ffff00" },
          { dLat:  0,      dLon: -offset, color: 0x00ffff, label: "OESTE", labelColor: "#00ffff" },
          { dLat:  0,      dLon:  offset, color: 0x00ff00, label: "ESTE",  labelColor: "#00ff00" }
        ];

        for (const r of refs) {
          const cubeGroup = makeCubeWithLabel(r.color, r.label, r.labelColor, 10);
          locar.add(cubeGroup, c.longitude + r.dLon, c.latitude + r.dLat, 5);
        }

        objectsAdded = true;
        setStatus("✅ GPS inicial recibido. Gira 360° y observa el cubo brújula.");
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
