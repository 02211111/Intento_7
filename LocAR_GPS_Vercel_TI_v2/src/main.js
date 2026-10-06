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

// ⚡ Canvas de etiqueta MÁS PEQUEÑO (256x128 en vez de 512x256)
//    Eso reduce a la mitad el ancho/alto de la textura → 4× menos píxeles → GPU respira.
function makeTextSprite(text, textColor = "#ffffff", borderColor = "#ffffff", scaleX = 8, scaleY = 4) {
  const c = document.createElement("canvas");
  c.width = 256;   // ⚡ antes 512
  c.height = 128;  // ⚡ antes 256
  const ctx = c.getContext("2d");

  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);

  ctx.fillStyle = textColor;
  ctx.font = "bold 55px Arial"; // ⚡ proporcional al nuevo tamaño
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2);

  const texture = new THREE.CanvasTexture(c);
  texture.needsUpdate = true;
  // ⚡ Sin mipmaps ni filtros caros:
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scaleX, scaleY, 1);
  return sprite;
}

// ⚡ Geometrías compartidas (una sola en memoria para todos los cubos)
const SHARED_BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

function makeCubeWithLabel(color, label, labelColor, size = 10) {
  const group = new THREE.Group();

  const box = new THREE.Mesh(
    SHARED_BOX_GEO,
    new THREE.MeshBasicMaterial({ color, fog: false })
  );
  box.scale.set(size, size, size);
  group.add(box);

  // ⚡ Etiqueta con tamaño proporcional más pequeño
  const labelSprite = makeTextSprite(label, "#ffffff", labelColor, 8, 4);
  labelSprite.position.set(0, size * 1.3, 0);
  group.add(labelSprite);
  return group;
}

// ⚡ Marcador del laboratorio SIN esfera (era solo decorativa y añadía triángulos)
function makeTargetMarker() {
  const group = new THREE.Group();

  const box = new THREE.Mesh(
    SHARED_BOX_GEO,
    new THREE.MeshBasicMaterial({ color: 0xff00ff, fog: false })
  );
  box.scale.set(12, 12, 12);
  group.add(box);

  // ⚡ En vez de esfera, un cubo pequeño negro (mucho más barato de renderizar)
  const dot = new THREE.Mesh(
    SHARED_BOX_GEO,
    new THREE.MeshBasicMaterial({ color: 0x000000, fog: false })
  );
  dot.scale.set(4, 4, 4);
  dot.position.set(0, 14, 0);
  group.add(dot);

  const labelSprite = makeTextSprite("LABORATORIO", "#ffffff", "#ff00ff", 18, 9);
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
        near: 0.01,     // ⚡ antes 0.001. Menos rango del depth buffer.
        far: 300        // ⚡ antes 500. La escena es pequeña.
      },
      videoConstraints: {
        video: {
          facingMode: "environment",
          // ⚡ MÁS agresivo: 320×240. El video se sube a la GPU cada frame,
          //    así que bajar la resolución tiene impacto DIRECTAMENTE proporcional.
          width:  { ideal: 320 },
          height: { ideal: 240 },
          frameRate: { ideal: 24, max: 30 } // ⚡ cap a 24 FPS
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

    // ⚡⚡ LA OPTIMIZACIÓN MÁS GRANDE: bajar la resolución de render.
    //    Un pixelRatio de 0.6 reduce el trabajo del GPU a ~36% del original.
    if (app.renderer) {
      app.renderer.setPixelRatio(0.6);
      // Apagar cosas que no usamos:
      app.renderer.shadowMap.enabled = false;
      app.renderer.sortObjects = false;
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

    // ⚡ Cubo brújula
    let compassCube = null;
    if (camera3D) {
      compassCube = new THREE.Mesh(
        SHARED_BOX_GEO,
        new THREE.MeshBasicMaterial({ color: 0xff0000, fog: false, depthTest: false })
      );
      compassCube.scale.set(0.35, 0.35, 0.35);
      compassCube.position.set(0, -0.4, -1.5);
      compassCube.frustumCulled = false;
      camera3D.add(compassCube);
    }

    // ⚡ Actualizar el cubo brújula a 4 FPS (suficiente para cambios de color)
    let lastCardinal = null;
    if (camera3D && compassCube) {
      setInterval(() => {
        const dir = getCardinalFromCamera(camera3D);
        if (dir !== lastCardinal) {
          compassCube.material.color.setHex(DIR_COLORS[dir]);
          lastCardinal = dir;
        }
      }, 250);
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
        setStatus("✅ Listo. Gira 360° y observa el cubo brújula.");
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
