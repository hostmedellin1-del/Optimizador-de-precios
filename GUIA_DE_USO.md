# Guía de uso — Optimizador de precios

Versión con mejor formato: ver `guia.html` en el sitio publicado. Este archivo se lee
bien directo en github.com; para uso diario, preferí la versión de arriba.

Esta guía es para gestionar tus unidades, no para programar. La aplicación publicada está
en <https://hostmedellin1-del.github.io/Optimizador-de-precios/>.

> Regla principal: todos los valores se ingresan en **USD**. La aplicación no convierte
> COP, no consulta PriceLabs ni las OTAs y no inventa ningún dato pendiente.

## 1. Qué es y qué no es

La herramienta toma el precio **final** que PriceLabs muestra para una noche y estima
cuánto queda después de Offset, descuentos nativos, comisión OTA y comisión
bancaria/pasarela por canal. No vuelve a descontar temporada, demanda, ocupación ni
Last-Minute que PriceLabs ya haya aplicado dentro de ese precio. Con esa configuración calcula:

- **Min Price → PriceLabs**: el precio mínimo final que debes configurar en PriceLabs para
  que, incluso después de las reducciones que aún aplican por canal, cubra el costo en el
  escenario más exigente.
- **Base Price → PriceLabs**: una referencia para que el precio base alcance el neto
  objetivo con la configuración real cargada.
- **Offset**: ajuste específico por canal que se aplica después del precio de PriceLabs.

No publica precios, no cambia nada en PriceLabs, Kunas, Airbnb, Booking.com o Expedia, y
no reemplaza la revisión de la extranet, facturas o reglas reales de cada canal.

## 2. Primer uso en el sitio publicado

1. Abre la URL publicada.
2. En la barra superior escribe el nombre en **Unidad (ej. Alcázar 902)**.
3. Pulsa **Guardar** para crear la unidad en este navegador.
4. Verás un Min Price calculado con los valores cargados. Reemplaza los valores de ejemplo
   por los de tu unidad antes de tomar una decisión de precio.

La app guarda unidades solo en el almacenamiento local de ese navegador. Antes de empezar
con datos reales, usa **Exportar todo** y guarda el archivo descargado fuera del navegador.

## 3. Crear una propiedad: dos caminos

### Desde cero

Este es el orden recomendado. Aunque hay alrededor de 74 campos configurables entre
costos, descuentos y canales, no hace falta llenar todo a la vez: completa primero lo que
realmente usa cada unidad.

1. En **Precio mínimo → Costos por noche**, ingresa **Fijos** y **Variables**, o abre
   **Calcular a partir de costos detallados**.
2. Si usas el desglose, llena los costos y activa **Usar estos costos detallados para
   calcular**. Esa opción reemplaza Fijos/Variables; no es una verificación ni bloquea nada.
3. Completa **Estadía promedio (noches)**. Es lo único adicional del flujo diario que queda
   visible junto a los costos y Min Price.
4. Si vas a definir estrategia de precios, abre **Estrategia de PriceLabs**. Allí están
   **Margen objetivo total %**, **Ventana de reserva del mercado (días, mediana)** y
   **Base que recomienda PriceLabs / mercado**.
5. En esa misma sección configura **Last-Minute de PriceLabs** con el modo que realmente usa
   esa unidad. La herramienta aplica el modo y los valores que tú escribas.
6. Abre **Configuración avanzada** cuando necesites revisar **Airbnb**, **Booking.com**,
   **Expedia** o **Directo**. Allí están las comisiones, comisión bancaria/pasarela,
   Offset y descuentos de cada canal.
7. Revisa **Techo total por ventana** dentro de **Estrategia de PriceLabs**. Es el máximo
   descuento total que estás dispuesto a aceptar por ventana; afecta especialmente el modo
   Last-Minute automático.
8. Revisa Min Price y, si usas estrategia, Base Price, Offset y Diagnóstico completo antes de copiar
   una configuración a PriceLabs.

### Duplicar una unidad parecida

1. Carga primero la unidad origen con **Cargar unidad…**.
2. Pulsa **Duplicar**, escribe el nombre de la nueva unidad y confirma.
3. La copia conserva la **configuración operativa**: canales (incluidos comisión, banco,
   Offset y aseo), los 37 descuentos con sus porcentajes/ventanas, techos y parámetros de
   Last-Minute.
4. La copia mantiene los valores operativos. Revisa sus costos, descuentos, comisiones y LM
   para decidir si realmente aplican a la nueva unidad.

Duplicar nunca modifica la unidad original. Tampoco permite duplicar otra copia USD que
esté pendiente de revisión manual.

## 4. Cómo usar los resultados

La app calcula con los números que tú ingresas; no pide estados de “verificado” ni bloquea
el Min Price por una casilla pendiente. Por eso el cuidado ocurre antes de escribirlos:
completa costos, comisiones, Offset, descuentos y la estrategia Last-Minute que decidiste
usar para esa unidad.

El **Min Price** es el precio final mínimo de PriceLabs. No vuelve a descontar temporada,
demanda, ocupación ni LM que PriceLabs ya hubiera aplicado; sí protege contra Offset de
Kunas, descuentos OTA, comisiones y costos. Si eliges un precio fijo Last-Minute, revisa
que no quede por debajo del Min Price.

### Caso excepcional: revisión de moneda

Si cargas una unidad antigua con una moneda distinta de USD, verás **REQUIERE REVISIÓN
MANUAL**. No hay conversión automática. Puedes corregir los datos manualmente o crear una
copia en USD y revisar cada valor antes de pulsar **Ya revisé manualmente todos los valores
en USD →**. Hasta entonces, los números quedan bloqueados.

## 5. Para qué sirve cada sección

### Precio mínimo

Es la pantalla de decisión diaria. Primero verás **Lo que debes configurar**: el
**Costo por noche** y el **Min Price → PriceLabs**. Copia ese Min Price en PriceLabs.
Los avisos técnicos, el respaldo, los costos detallados y el **Simulador de descuento
máximo** quedan plegados para no distraerte. Este último muestra, por OTA, el grupo de
huésped que podría recibir el mayor descuento real; combina solo promociones compatibles.
Ábrelo cuando quieras revisar una estrategia y usa **Configurar [OTA]** para cambiar sus
promociones o Offset.

### Configuración avanzada

Agrupa las herramientas que no se usan todos los días: el ejemplo de reserva, la
configuración de cada OTA y el diagnóstico completo. Al abrir una de esas secciones puedes
revisar comisiones, descuentos, Offset, Last-Minute y techos sin llenar la pantalla diaria.

### ¿Cómo se calcula?

Es el simulador de una reserva concreta. Ingresa **Precio FINAL mostrado por PriceLabs**,
**Canal**, **Días antes del check-in** y **Noches de estadía**. Verás el flujo
paso a paso: precio, descuentos, comisiones, neto, margen y markup. Sirve para entender o
probar un caso. El simulador no vuelve a aplicar factores internos de PriceLabs a un precio
que ya es final.

### Configurar Airbnb, Booking.com, Expedia y Directo

Cada pestaña contiene la configuración de ese canal:

- **Comisión [canal] %** y **Comisión bancaria/pasarela %**.
- **Offset % sobre PriceLabs (tu markup real)**.
- En Airbnb, **Tarifa de aseo — reservas 1–2 noches** y **Tarifa de aseo — reservas 3+
  noches**.
- **Descuentos activos hoy** y **Ver catálogo completo** para el resto.

No actives un descuento solo porque existe en el catálogo: actívalo únicamente si está
activo para ese listing/canal y usa el porcentaje y la ventana reales.

### Diagnóstico completo

**Panel de decisión por ventana de reserva** resume cada ventana. Lee primero
**Veredicto**. Si pide atención, abre **Ver por canal** para ver el detalle. Los veredictos
pueden señalar techo excedido, neto bajo costo, neto bajo objetivo o una configuración
rentable.

## 6. Gestionar y respaldar propiedades

- **Guardar**: guarda la unidad actual con su nombre. Si es una unidad nueva y ya hay otra
  con el mismo nombre, la aplicación pregunta antes de crear una nueva identidad.
- **Cargar unidad…**: selecciona una unidad previamente guardada en este navegador.
- **Eliminar**: borra la unidad seleccionada después de pedir confirmación. Exporta antes
  si necesitas conservarla.
- **Duplicar**: crea una unidad nueva desde una configuración existente; revisa la sección
  3 para saber qué se copia y qué se reinicia.
- **Exportar todo**: descarga un JSON con las unidades guardadas. Úsalo como respaldo
  periódico, especialmente antes de cambios grandes o de limpiar el navegador.
- **Importar**: restaura un JSON exportado. La app valida y normaliza los datos; si ya
  existe una unidad con la misma clave, se sobrescribe tras confirmación.
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

Porque hay un dato matemáticamente inválido, la unidad no está en USD o, en Base Price,
un precio Last-Minute fijo cubre el día de referencia. Min Price normalmente se calcula de
inmediato con los valores cargados.

### ¿Por qué una unidad duplicada puede tener otro precio?

Porque la copia conserva los parámetros del origen. Revisa que sus costos, descuentos,
canales, techos y LM sí apliquen a la nueva unidad antes de usar el resultado.

### ¿Puedo ingresar COP?

No. Esta versión es solo USD. No conviertas “cambiando la etiqueta”: convierte y verifica
los valores con tu fuente antes de cargarlos como USD. La multimoneda se hará en una fase
futura, no está activa hoy.

### ¿La app sabe automáticamente lo que está configurado en PriceLabs o las OTAs?

No. No hay integración. Tú decides y cargas los descuentos, comisiones, Offset y modo
Last-Minute que correspondan a la cuenta real.

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

Antes de aplicar un precio en PriceLabs: revisa que los costos, descuentos, comisiones,
Offset y estrategia LM cargados correspondan a esa unidad. La app calcula exactamente con
esos valores.
