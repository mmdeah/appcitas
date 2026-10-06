# Agenda del taller

Calendario de citas de Automotriz Online SD. Más adelante, el bot de WhatsApp agendará aquí solo.

Solo usa Node.js (22.13 o superior). No hay que instalar librerías: el servidor web, la base de datos SQLite y las pruebas vienen con Node.

## Usarla en tu computador

1. Copia `.env.example` como `.env` y pon tu clave en `ADMIN_PASSWORD`.
2. Ejecuta `npm start` y abre http://localhost:3200.

`npm run dev` hace lo mismo y se reinicia solo cuando cambias el código. `npm test` corre las pruebas.

## Qué hace

- Calendario por semana: cada día muestra sus horas, las citas con cliente, servicio, vehículo y placa, y los cupos libres.
- Máximo 2 vehículos por hora. La base de datos no deja guardar una tercera cita en la misma hora, salvo que marques "agendar aunque esté llena".
- Festivos de Colombia cerrados automáticamente.
- Bloquear una hora o un día completo.
- Detalle de cada cita: cambiar estado (confirmada, llegó, no asistió, cancelada) y abrir el WhatsApp del cliente.

## Publicar en Railway

1. Sube esta carpeta a un repositorio de GitHub (el archivo `.env` no se sube) y en Railway crea un proyecto con **Deploy from GitHub repo**.
2. En el servicio agrega un **Volume** montado en `/data`. Ahí vive la base de datos. Sin volumen, las citas se borran en cada despliegue.
3. En **Variables** agrega:
   - `ADMIN_PASSWORD`: la clave para entrar.
   - `SESSION_SECRET`: una cadena larga y aleatoria.
   - `COOKIE_SECURE=true`
   - `DB_PATH=/data/taller.db`

   `PORT` lo pone Railway.
4. En **Settings → Networking** genera un dominio. Esa dirección será también la del webhook de WhatsApp.

Railway arranca la app con `npm start` y revisa que responda en `/salud` (ver `railway.json`).

## Copia de seguridad

Al final del calendario está el enlace **Descargar copia de todas las citas (JSON)**. Descárgala de vez en cuando.

## Cambiar horario, capacidad o servicios

Todo está en `config.js`: horas de citas por día, cuántos vehículos por hora, cuántos días adelante y con cuánta anticipación puede agendar el bot.

## Archivos

- `config.js`: datos del taller.
- `src/agenda.js`: motor de citas (horas libres, reservar sin cruces, cancelar, bloquear). El bot lo usará tal cual.
- `src/festivos.js`: festivos de Colombia.
- `src/server.js`: servidor web y rutas.
- `src/vistas.js`: páginas HTML.
- `data/taller.db`: la base de datos (se crea sola; haz copia de este archivo).

## Siguientes etapas

1. Bot de WhatsApp con un número de prueba de Meta: responde anuncios y agenda usando `src/agenda.js`.
2. Recordatorio el día anterior con plantilla aprobada (Confirmo / Reprogramar / Cancelar).
3. Conectar el número real con coexistencia y apagar el bot de Kommo.
