/* VIMECO S.A. — Contenido de los tutoriales (SOLO datos).
 *
 * Para actualizar un tutorial: editá sus `slides`.
 * Cuando agregues funciones nuevas, SUBÍ el número `version` del módulo:
 *   - reaparece el badge "Nuevo" en el menú (☰) de esa pantalla, y
 *   - el tutorial se vuelve a mostrar solo la próxima vez que el usuario entre.
 *
 * `icono` es una clave de js/icons.js (window.ic). Nunca usar emojis.
 */
window.TUTORIALES = {
  compras: {
    titulo: 'Cómo usar Compras',
    version: 1,
    slides: [
      { icono: 'cart', titulo: 'Órdenes de Compra',
        texto: 'Generá una Orden de Compra en PDF a partir de un presupuesto. Al terminar se guarda sola en Google Drive, ordenada por obra y proveedor.' },
      { icono: 'sparkles', titulo: 'Cargá con IA',
        texto: 'Subí una foto, un PDF o grabá un audio del presupuesto. La IA completa proveedor, ítems y totales por vos. Después revisás y corregís lo que haga falta.' },
      { icono: 'user', titulo: 'Proveedor',
        texto: 'El CUIT autocompleta los datos desde la base de proveedores. Si aparece un aviso amarillo, verificá que el proveedor sea el correcto antes de generar.' },
      { icono: 'calc', titulo: 'Ítems, impuestos y totales',
        texto: 'Editá cantidades y precios. Aplicá descuento, no gravado y activá el IVA con el interruptor. El total se recalcula solo.' },
      { icono: 'edit', titulo: 'Tu firma',
        texto: 'Desde el menú superior podés guardar tu firma una vez, para que aparezca automáticamente en las Órdenes de Compra.' },
      { icono: 'userCheck', titulo: 'Pedí autorización',
        texto: 'Si la OC necesita el visto bueno de un responsable, pedís la autorización desde la app. Le aparece en su pantalla de Autorizaciones y, cuando la firma, la Orden queda autorizada.' },
      { icono: 'folder', titulo: 'Generá y archivá',
        texto: 'Al generar, el PDF se sube a Drive automáticamente. No hace falta guardarlo ni ordenarlo a mano.' },
      { icono: 'clip', titulo: 'Adjuntar e Historial',
        texto: 'Sumá comprobantes a una OC existente desde Adjuntar, y volvé a ver o regenerar Órdenes anteriores desde Historial.' },
    ],
  },

  caja: {
    titulo: 'Cómo usar Caja',
    version: 2,
    slides: [
      { icono: 'dollar', titulo: 'Caja Chica',
        texto: 'Registrá ingresos y egresos. Trabajás mes a mes y el saldo arrastra el excedente del mes anterior.' },
      { icono: 'camera', titulo: 'Cargá un gasto',
        texto: 'Registrá un egreso adjuntando la foto del ticket. La app recorta los bordes y mejora la imagen para que quede prolija. Completás el monto, la categoría y la obra.' },
      { icono: 'building', titulo: 'Cada gasto va a una obra',
        texto: 'Elegí a qué obra corresponde el egreso. Es obligatorio: así se sabe cuánto gastó la caja en cada obra. Si el gasto no es de una obra de construcción, imputalo a Taller, Oficina Técnica o Administración - RRHH.' },
      { icono: 'layers', titulo: 'Categorías',
        texto: 'Clasificá cada gasto por categoría para tener el detalle ordenado y facilitar los reportes.' },
      { icono: 'calc', titulo: 'Saldo del mes',
        texto: 'Saldo = excedente anterior + ingresos − egresos del mes. Cambiá de mes para revisar cada período.' },
      { icono: 'plus', titulo: 'Ingresos',
        texto: 'Cuando te entregan plata para la caja, registralo como ingreso con la fecha en que lo recibiste y el monto. Así el saldo refleja lo que tenés disponible.' },
      { icono: 'folder', titulo: 'Todo va a Drive',
        texto: 'Cada movimiento sincroniza un Excel y las fotos a Google Drive automáticamente.' },
    ],
  },

  personal: {
    titulo: 'Cómo usar Personal',
    version: 2,
    slides: [
      { icono: 'users', titulo: 'Personal',
        texto: 'Llevá el parte diario de tu cuadrilla, por obra y por quincena.' },
      { icono: 'building', titulo: 'Elegí la obra',
        texto: 'Cada tarjeta es una obra y te muestra cuánta gente tiene asignada. Entrá para ver la cuadrilla y el calendario de la quincena.' },
      { icono: 'userPlus', titulo: 'Cargá tu cuadrilla',
        texto: 'Tocá "Agregar personal" y vas a ver todo el padrón con un buscador arriba. Elegí a quien necesites y tocá "Asignar". Cada persona muestra en qué obras ya está trabajando. Si es alguien nuevo, usá "Incorporar nuevo" y cargás nombre, apellido, DNI, categoría y la foto del DNI (frente y dorso).' },
      { icono: 'calendar', titulo: 'Parte del día',
        texto: 'Cargá horas, comida y viáticos de cada persona. Usá los estados (F, CM, CC, AC) para feriados, certificados médicos, clima o accidentes.' },
      { icono: 'checkSm', titulo: 'Validá el día',
        texto: 'Cuando el parte del día esté completo, marcalo como validado. Podés des-validarlo mientras la quincena siga abierta.' },
      { icono: 'sheet', titulo: 'Cerrá la quincena',
        texto: 'Con todos los días laborables validados podés cerrar la quincena: se genera el Excel para RRHH y se sube a Drive.' },
    ],
  },
};
