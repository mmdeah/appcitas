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

## Agendar desde el bot de Kommo

La app recibe las consultas del Salesbot en `/kommo/bot` y le responde a Kommo por su API.

1. Arma el widget con `npm run widget`. Queda en `dist/agenda-del-taller-widget.zip`.
2. En Kommo (**Ajustes → Integraciones**), crea la integración privada:
   - **URL de redirección:** `https://appcitas.up.railway.app/kommo`
   - **Archivo del widget:** sube el `.zip`.
3. En la pestaña **Llaves y alcances** copia la clave secreta y genera un token de larga duración. En Railway ponlos como `KOMMO_SECRET` y `KOMMO_TOKEN`.
4. Instala el widget. La dirección de la agenda puede quedar vacía.
5. En el Salesbot aparece el paso **Agenda del taller → Agendar cita**:
   - En **Servicio** escribe `REVISION` o `SINCRONIZACION`.
   - Tiene dos salidas: **Cita agendada** y **Pasar a asesor**.

La conversación es: día → hora → nombre → vehículo y placa → (celular, si Kommo no lo tiene) → cita guardada. Además, la app deja una nota en el lead.

Si algo falla, en los logs de Railway aparece una línea que empieza con `Kommo:`.

### Agendar por texto libre (con IA)

Si el paso **Agendar cita** se pone con **Paso = `seguir`** justo después del mensaje que pide los datos, el cliente responde como quiera ("soy Juan, Spark 2015 ABC123, el jueves a las 10"). La app hace esto:

- Junta los datos.
- Pregunta solo lo que falta.
- Revisa la agenda: si la hora o el día no tienen cupo, propone opciones reales.
- Muestra un resumen y pide "¿Confirmo?".
- Con un "sí", guarda la cita.

La IA de OpenRouter (`OPENROUTER_API_KEY` y `OPENROUTER_MODEL` en Railway) solo ayuda a leer el mensaje; nunca decide cupos. Sin IA, la app lee con reglas la placa, el día y la hora, y pregunta el resto dato por dato. El JSON del bot principal con este recorrido queda en `dist/bot-principal-sin-boton.json` (y `dist/bot-principal-con-boton.json` si Kommo exige un botón para esperar). Ahí la agenda se llama con `widget_request` directo, porque los bloques de widget solo funcionan si se crean en el editor visual.

## Copia de seguridad

Al final del calendario está el enlace **Descargar copia de todas las citas (JSON)**. Descárgala de vez en cuando.

## Cambiar horario, capacidad o servicios

Todo está en `config.js`: horas de citas por día, cuántos vehículos por hora, cuántos días adelante y con cuánta anticipación puede agendar el bot.

## Archivos

- `config.js`: datos del taller.
- `src/agenda.js`: motor de citas (horas libres, reservar sin cruces, cancelar, bloquear).
- `src/bot.js`: la conversación de agendamiento por WhatsApp.
- `src/kommo.js` y `src/atencion.js`: conexión con el Salesbot de Kommo.
- `kommo-widget/`: el widget que se sube a Kommo (`npm run widget` lo empaqueta).
- `src/festivos.js`: festivos de Colombia.
- `src/server.js`: servidor web y rutas.
- `src/vistas.js`: páginas HTML.
- `data/taller.db`: la base de datos (se crea sola; haz copia de este archivo).

## Siguientes etapas

1. Recordatorio el día anterior desde Kommo, con plantilla aprobada (Confirmo / Reprogramar / Cancelar).
2. Cuando terminen los 6 meses de Kommo, evaluar la API oficial de WhatsApp con un proveedor. El motor de citas sirve igual.
