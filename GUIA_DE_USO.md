# Guía de uso — Optimizador de precios

Versión con mejor formato: ver `guia.html` en el sitio publicado. Este archivo se lee
bien directo en github.com; para uso diario, preferí la versión de arriba.

Esta guía es para gestionar tus unidades, no para programar. La aplicación publicada está
en <https://hostmedellin1-del.github.io/Optimizador-de-precios/>.

> Regla principal: todos los valores se ingresan en **USD**. La aplicación no convierte
> COP, no consulta PriceLabs ni las OTAs y no inventa ningún dato pendiente.

## 1. Qué es y qué no es

La herramienta toma el precio por noche que pondrías en PriceLabs y estima cuánto queda
después de descuentos nativos, comisión OTA, comisión bancaria/pasarela, Last-Minute y
Offset por canal. Con esa configuración calcula:

- **Min Price → PriceLabs**: el mínimo que debería cubrir el costo incluso en el escenario
  más exigente que encuentre entre los canales.
- **Base Price → PriceLabs**: una referencia para que el precio base alcance el neto
  objetivo con la configuración real cargada.
- **Offset**: ajuste específico por canal que se aplica después del precio de PriceLabs.

No publica precios, no cambia nada en PriceLabs, Kunas, Airbnb, Booking.com o Expedia, y
no reemplaza la revisión de la extranet, facturas o reglas reales de cada canal.

En Airbnb, la tarifa de aseo (la que cobras aparte por reserva) ahora entra en el cálculo
del Min Price y del Base Price: es un ingreso real, se paga completo por reserva y se
diluye entre las noches de la estadía. Antes el modelo la ignoraba por completo.

En estadías de 28 noches o más, el Min Price deja de asumir que Last-Minute está activo
todo el mes: Dani confirmó que PriceLabs solo baja el precio los últimos días antes del
check-in, nunca durante una reserva de un mes completo hecha el mismo día. El Simulador
(cotización manual de un caso puntual) no cambia — sigue aplicando el Last-Minute
configurado tal cual, sin recortes.

## 2. Primer uso en el sitio publicado

1. Abre la URL publicada.
2. En la barra superior escribe el nombre en **Unidad (ej. Alcázar 902)**.
3. Pulsa **Guardar** para crear la unidad en este navegador.
4. Al principio verás `—` en **Min Price → PriceLabs** y **Base Price → PriceLabs**. Es
   normal y seguro: una unidad nueva trae costos de ejemplo y Last-Minute sin confirmar.
5. No copies esos valores como recomendaciones hasta completar los tres bloqueos de la
   sección 4.

Si en cualquier momento ves `—` en vez de un precio, no significa que algo esté roto:
falta terminar de configurar la unidad. Justo debajo aparece una tarjeta con los pasos
concretos que faltan (por ejemplo "Escribí los costos reales de este apartamento" o
"Decile a la app cómo baja precios PriceLabs cerca del check-in"), cada uno con su propio
botón que te lleva directo a la sección donde se resuelve — ya no hace falta adivinar qué
falta ni leer un párrafo largo para encontrarlo.

La app guarda unidades solo en el almacenamiento local de ese navegador. Antes de empezar
con datos reales, usa **Exportar todo** y guarda el archivo descargado fuera del navegador.

## 3. Crear una propiedad: dos caminos

### Desde cero

Este es el orden recomendado. Aunque hay alrededor de 74 campos configurables entre
costos, descuentos y canales, no hace falta llenar todo a la vez: completa primero lo que
realmente usa cada unidad.

1. En **Resumen → Costos por noche**, ingresa **Fijos** y **Variables**, o abre
   **Calcular a partir de costos detallados**.
2. Si usas el desglose, llena los costos reales y marca **Revisé estos costos reales en
   USD, incluidos los valores en cero.** Sin esa confirmación, el desglose no alimenta las
   recomendaciones. Una vez confirmado, justo ahí aparece una tabla de **cuánto te cuesta
   cada noche según cuántas noches se queda el huésped**: limpieza, lavandería e insumos se
   pagan completos por reserva sin importar la duración, así que una reserva corta sale más
   cara por noche. Caso real de la 902: una reserva de 1 noche cuesta USD 71.50 por noche,
   mientras que una de 4 noches cuesta USD 49.00 — casi la mitad, con el mismo apartamento.
   Si alguna vez ves una alerta **ESTADÍA CORTA**, es justo este problema: netea menos de lo
   que cuesta esa reserva puntual, no un error de la app.
3. Completa **Margen objetivo total %**, **Ventana de reserva del mercado (días, mediana)**,
   **Estadía promedio (noches)** y **Base que recomienda PriceLabs / mercado**.
4. Configura **Last-Minute de PriceLabs** con el modo que realmente usa esa unidad y marca
   **Confirmé este modo directamente en PriceLabs**.
5. Revisa las pestañas **Airbnb**, **Booking.com**, **Expedia** y **Directo**: allí están
   las comisiones, comisión bancaria/pasarela, Offset y descuentos de cada canal. Los
   valores que ingreses se usan directamente en el cálculo; comprueba que coincidan con
   tu extranet y tus facturas.
7. Revisa **Techo total por ventana** en Resumen. Es el máximo descuento total que estás
   dispuesto a aceptar por ventana; afecta especialmente el modo Last-Minute automático.
8. Cuando los bloqueos se resuelvan, revisa Min Price, Base Price, Offset y Comparación
   antes de copiar una configuración a PriceLabs.

### Duplicar una unidad parecida

1. Carga primero la unidad origen con **Cargar unidad…**.
2. Pulsa **Duplicar**, escribe el nombre de la nueva unidad y confirma.
3. La copia conserva la **configuración operativa**: canales (incluidos comisión, banco,
   Offset y aseo), los 38 descuentos con sus porcentajes/ventanas, techos y parámetros de
   Last-Minute.
4. La copia reinicia Last-Minute sin confirmar, los descuentos quedan sin verificar y los
   costos reales/desglose confirmado vuelven al ejemplo. Por eso Min Price y Base Price
   comienzan bloqueados.
5. Revisa sus costos, LM, comisiones y descuentos propios antes de usar una recomendación.

Duplicar nunca modifica la unidad original. Tampoco permite duplicar otra copia USD que
esté pendiente de revisión manual.

## 4. Cómo desbloquear recomendaciones

Los avisos rojos no son errores técnicos: previenen que una simulación se presente como
una recomendación real. Resuélvelos en este orden.

### A. Costos sin confirmar

- **EJEMPLO**: los valores de fábrica (Fijos 32 y Variables 22) no son costos reales.
  Reemplázalos por los de la unidad, o usa el desglose detallado y confirma la casilla.
- **COSTOS SIN CONFIRMAR**: editaste una línea del desglose, pero no confirmaste que está
  revisado. Marca la casilla de revisión solo después de comprobar todos los valores,
  incluso los ceros.

Cada edición posterior del desglose invalida la confirmación; vuelve a revisarlo y marca
la casilla de nuevo.

### B. LM SIN VERIFICAR

En **Last-Minute de PriceLabs**, el modo predeterminado es **Automático (PriceLabs decide,
no verificable matemáticamente)**. No basta con asumir que el descuento será un porcentaje
fijo.

En PriceLabs confirma qué usa esa unidad y elige aquí el equivalente:

- **Descuento plano (% fijo entre dos días)**.
- **Descuento gradual (decae día a día hasta 0)**.
- **Precio Last-Minute fijo**.
- **Tramos personalizados**.

Después marca **Confirmé este modo directamente en PriceLabs**. Si usas el modo
Automático, la app no puede verificar matemáticamente una curva que PriceLabs decide por
día y las recomendaciones permanecen bloqueadas por diseño.

### C. Datos de cada canal

Las comisiones, la comisión bancaria/pasarela, el Offset y los descuentos que escribas en
cada pestaña se aplican directamente al cálculo. Comprueba esos valores en la extranet,
facturas o contratos del canal antes de usarlos: la aplicación no puede confirmar por sí
sola las reglas de Booking, Airbnb o Expedia y no inventa ningún porcentaje.

### Caso excepcional: revisión de moneda

Si cargas una unidad antigua con una moneda distinta de USD, verás **REQUIERE REVISIÓN
MANUAL**. No hay conversión automática. Puedes corregir los datos manualmente o crear una
copia en USD y revisar cada valor antes de pulsar **Ya revisé manualmente todos los valores
en USD →**. Hasta entonces, los números quedan bloqueados.

## 5. Para qué sirve cada pestaña

### Resumen

Es la pantalla de configuración y decisión principal: costos, KPIs, Last-Minute y techos.
Modifica aquí **Techo total por ventana**; en Comparación solo se muestra.

### ¿Cómo se calcula?

Es el simulador de una reserva concreta. Ingresa **Precio calculado por PriceLabs (antes de
LM/offset)**, **Canal**, **Días antes del check-in** y **Noches de estadía**. Verás el flujo
paso a paso: precio, descuentos, comisiones, neto, margen y markup. Sirve para entender o
probar un caso; una simulación manual puede mostrarse aun cuando la recomendación global
está bloqueada, por lo que debes leer sus avisos de confiabilidad.

### Airbnb, Booking.com, Expedia y Directo

Cada pestaña contiene la configuración de ese canal:

- **Comisión [canal] %** y **Comisión bancaria/pasarela %**.
- **Offset % sobre PriceLabs (tu markup real)**.
- Los porcentajes y reglas que usa ese canal; la aplicación los toma tal como los ingresas.
- En Airbnb, **Tarifa de aseo — reservas 1–2 noches** y **Tarifa de aseo — reservas 3+
  noches**.
- En Booking.com, **Alojamientos preferentes %**, y en Expedia, **Aceleradores %**: son
  comisión ADICIONAL que la OTA te cobra por un programa de visibilidad, no un descuento al
  huésped — no bajan el precio que ve el huésped, pero sí bajan lo que te queda a ti.
  Arrancan en **0%**, nadie inventó un porcentaje: confirma el valor real en tu Extranet de
  Booking o en Expedia Partner Central antes de activarlos.
- **Descuentos activos hoy** y **Ver catálogo completo** para el resto.

No actives un descuento solo porque existe en el catálogo: actívalo únicamente si está
activo para ese listing/canal y usa el porcentaje y la ventana reales.

### Mis apartamentos

Pestaña de portafolio: una fila por cada unidad guardada en este navegador, todas juntas en
una sola vista (antes solo se podía ver una unidad a la vez). Cada fila muestra el Piso, el
costo por noche y un estado (**Lista**, **Faltan costos** o **Falta Last-Minute**) para que
sepas de un vistazo cuáles unidades ya puedes usar como recomendación y cuáles no. Si una
unidad tiene un snapshot de PriceLabs sincronizado (ver sección 6), la fila también muestra
si el Min Price real de PriceLabs cubre o queda por debajo del Piso que calcula esta app.
Click en una fila la abre en Resumen.

### Comparación

**Panel de decisión por ventana de reserva** resume cada ventana. Lee primero
**Veredicto**. Si pide atención, abre **Ver por canal** para ver el detalle. Los veredictos
pueden señalar techo excedido, neto bajo costo, neto bajo objetivo o una configuración
rentable; un aviso de datos pendientes debe resolverse antes de tratar un resultado positivo
como recomendación.

## 6. Gestionar y respaldar propiedades

En la barra superior quedan siempre visibles los botones que se usan a diario:

- **Guardar**: guarda la unidad actual con su nombre. Si es una unidad nueva y ya hay otra
  con el mismo nombre, la aplicación pregunta antes de crear una nueva identidad.
- **Duplicar**: crea una unidad nueva desde una configuración existente; revisa la sección
  3 para saber qué se copia y qué se reinicia.
- **Cargar unidad…**: selecciona una unidad previamente guardada en este navegador.
- **Eliminar**: borra la unidad seleccionada después de pedir confirmación. Exporta antes
  si necesitas conservarla.

El resto — lo que se usa de vez en cuando, no todos los días — vive detrás de **Más
opciones** (un desplegable justo al lado de Eliminar):

- **Exportar todo**: descarga un JSON con las unidades guardadas. Úsalo como respaldo
  periódico, especialmente antes de cambios grandes o de limpiar el navegador.
- **Importar**: restaura un JSON exportado. La app valida y normaliza los datos; si ya
  existe una unidad con la misma clave, se sobrescribe tras confirmación.
- **Sincronizar con PriceLabs**: carga un archivo `.json` de solo lectura que Claude te
  prepara con las herramientas de PriceLabs. Sirve para comparar el Min Price real de
  PriceLabs contra el Piso que calcula esta app — nunca escribe nada de vuelta en
  PriceLabs, ni hace ninguna llamada automática. Si el Min Price real queda por debajo del
  Piso calculado, la tarjeta de Resumen lo avisa explícitamente.
- **Migrar unidades antiguas**: crea copias en el formato actual de las unidades antiguas
  (v2) sin borrar las originales.

Los datos no se sincronizan entre computadores, perfiles de navegador ni modo incógnito.
Guarda los respaldos en una ubicación de confianza, por ejemplo tu almacenamiento habitual
de archivos.

## 7. El repositorio de GitHub y cómo se publican los cambios

Vas a ver dos links distintos y no son lo mismo. [`github.com/hostmedellin1-del/Optimizador-de-precios`](https://github.com/hostmedellin1-del/Optimizador-de-precios)
es donde vive el **CÓDIGO** de la herramienta: es la cocina, no el restaurante; ahí no se
usa la herramienta y no hace falta entrar nunca para el trabajo diario. El sitio publicado
que usas todos los días para calcular precios es el enlace mencionado al principio de esta guía.

Cuando pides un cambio, primero se prueba en un lugar aparte sin afectar el sitio publicado.
Solo se publica cuando tú lo apruebas explícitamente; después de confirmar “sí, publicalo”,
el sitio publicado se actualiza solo, normalmente en menos de un minuto. No necesitas cuenta
de GitHub, saber programar ni tocar nada ahí: solo confirmar cuando te pregunten.

`CHANGELOG.md` es el historial de qué cambió y cuándo. Es un archivo de texto dentro del
repositorio que puedes abrir directamente en github.com, sin instalar nada, si alguna vez
quieres revisar qué se modificó en una fecha puntual.

## 8. Preguntas frecuentes

### ¿Por qué Min Price o Base Price muestran `—`?

Porque falta resolver un bloqueo: costos de ejemplo/sin confirmar, LM sin verificar, revisión
manual de moneda o, en Base Price, un precio
Last-Minute fijo que cubre el día de referencia. Justo debajo de los KPIs aparece una
tarjeta con la lista concreta de lo que falta, cada ítem con su propio botón que te lleva
directo a la sección exacta que debes revisar — no hace falta buscarlo.

### ¿Por qué una unidad duplicada puede tener otro precio?

Porque la copia no hereda hechos confirmados ni costos reales. Aunque conserve descuentos,
canales, techos y parámetros LM, debes validar que esos parámetros y los costos sí aplican
a la nueva unidad. Hasta hacerlo, la app bloquea Min Price y Base Price.

### ¿Puedo ingresar COP?

No. Esta versión es solo USD. No conviertas “cambiando la etiqueta”: convierte y verifica
los valores con tu fuente antes de cargarlos como USD. La multimoneda se hará en una fase
futura, no está activa hoy.

### ¿La app sabe automáticamente lo que está configurado en PriceLabs o las OTAs?

No. No hay integración. Tú debes comparar cada descuento, comisión, Offset y modo
Last-Minute con la cuenta real antes de aplicar una recomendación.

## 9. Límites importantes

- No hay integración automática con PriceLabs, Kunas, Airbnb, Booking.com, Expedia,
  bancos ni pasarelas.
- No hay nube, usuarios múltiples ni sincronización; funciona para tu uso individual en
  el navegador donde guardas las unidades.
- No convierte monedas ni mezcla USD con COP.
- No calcula impuestos, contabilidad, flujo de caja mensual, reparto de utilidad ni
  conciliación automática de reservas: esas funciones no forman parte de esta versión.
- El resultado es una herramienta de decisión de precios, no una garantía de demanda,
  ocupación o liquidación final.

Antes de aplicar una recomendación en PriceLabs: revisa que la unidad tenga costos reales
confirmados, modo LM confirmado y todos los datos financieros aplicables resueltos. Solo
entonces trata Min Price, Base Price y Offset como recomendaciones operativas.
