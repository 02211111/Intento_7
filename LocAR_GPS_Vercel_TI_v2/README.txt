LocAR GPS Vercel TI - v2

CORRECCIÓN PRINCIPAL
La versión anterior agregaba objetos con locar.add() antes de que LocAR
tuviera una posición GPS inicial. LocAR necesita una primera lectura GPS
para poder convertir latitud/longitud a coordenadas 3D.

En esta versión:
1. Se inicia App/cámara.
2. Se configuran eventos GPS.
3. Se inicia GPS.
4. Se espera el primer evento gpsupdate.
5. Solo entonces se agregan los objetos georreferenciados.

DESPLIEGUE EN VERCEL
- Subir la carpeta completa.
- Framework: Vite
- Build command: npm run build
- Output directory: dist

PRUEBA EN ANDROID
- Usar Chrome.
- Permitir cámara, ubicación y sensores.
- Probar al aire libre.
- Esperar una primera lectura GPS.
- Girar lentamente 360 grados.
