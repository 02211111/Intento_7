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

// ✅ PERF: BoxGeometry reutilizable (comparte geometría entre cubos)
const SHARED_BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

function makeCubeWithLabel(color, label, labelColor, size = 10) {
  const group = new THREE.Group();

  // ✅ PERF: usamos la geometría compartida y escalamos
  const box = new THREE.Mesh(
    SHARED_BOX_GEO,
    new THREE.MeshBasicMaterial({ color })
  );
  box.scale.set(size, size, size);
  group.add(box);

  const labelSprite = makeTextSprite(label, "#ffffff", labelColor, 10, 5);
  labelSprite.position.set(0, size * 1.3, 0);
  group.add(labelSprite);
  return group;
}

// ✅ PERF: Esfera con muy pocos segmentos (antes 20x20 = 800 triángulos, ahora 8x6 = ~100)
const SHARED_SPHERE_GEO = new THREE.SphereGeometry(1, 8, 6);

function makeTargetMarker() {
  const group = new THREE.Group();

  const box = new THREE.Mesh(
    SHARED_BOX_GEO,
    new THREE.MeshBasicMaterial({ color: 0xff00ff })
  );
  box.scale.set(12, 12, 12);
  group.add(box);

  // ✅ PERF: Esfera negra low-poly
  const dot = new THREE.Mesh(
    SHARED_SPHERE_GEO,
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  dot.scale.set(3.5, 3.5, 3.5);
  dot.position.set(0, 14, 0);
  group.add(dot);

  const labelSprite = makeTextSprite("LABORATORIO", "#ffffff", "#ff00ff", 22, 11);
  labelSprite.position.set(0, 26, 0);
  group.add(labelSprite);
  return group;
}

const DIR_COLORS = {
  NORTE: 0xff0000,
  SUR:   0xffff00,
  ESTE:  0x00ff00,
  OESTE: 0x00ffff
};

function getCardinalFromCamera(camera3D) {
  const forward = new THREE.Vector3();
  camera3D.getWorldDirection(forward);

  let heading = Math.atan2(forward.x, forward.z) * 180 / Math.PI;
  heading = (heading + 360) % 360;
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
          // ✅ PERF: resolución aún más baja para máxima fluidez
          width:  { ideal: 480 },
          height: { ideal: 360 }
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

    // Localizar cámara de Three.js
    let camera3D = null;
    if (app.scene && app.scene.camera) camera3D = app.scene.camera;
    else if (app.camera) camera3D = app.camera;
    else {
      app.scene.traverse(obj => {
        if (obj.isCamera && !camera3D) camera3D = obj;
      });
    }

    // ✅ PERF: Cubo brújula con geometría compartida
    let compassCube = null;
    if (camera3D) {
      compassCube = new THREE.Mesh(
        SHARED_BOX_GEO,
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      compassCube.scale.set(0.35, 0.35, 0.35);
      compassCube.position.set(0, -0.4, -1.5);
      // ✅ PERF: deshabilitar frustum culling, ya que está pegado a la cámara
      compassCube.frustumCulled = false;
      camera3D.add(compassCube);
    }

    // ✅ PERF: setInterval a 8 FPS en vez de requestAnimationFrame a 60 FPS.
    //    El color cambia igual de bien y no compite con el render de LocAR.
    let lastCardinal = null;
    if (camera3D && compassCube) {
      setInterval(() => {
        const dir = getCardinalFromCamera(camera3D);
        if (dir !== lastCardinal) {
          compassCube.material.color.setHex(DIR_COLORS[dir]);
          lastCardinal = dir;
        }
      }, 125); // 8 veces por segundo
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
