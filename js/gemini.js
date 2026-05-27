/* global GEMINI_API_KEY */

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

const EXTRACT_PROMPT = `Sos un asistente especializado en lectura de documentos comerciales argentinos (facturas, presupuestos, cotizaciones, remitos, órdenes de compra).

El documento puede ser una foto tomada con celular, posiblemente con perspectiva, sombras, reflejos o leve distorsión. Hacé tu mejor esfuerzo para leer el contenido aunque la imagen no sea perfecta; inferí los datos por contexto cuando no sean perfectamente legibles.

Analizá el documento adjunto y extraé la siguiente información. Devolvé ÚNICAMENTE un JSON válido, sin bloques de código markdown, sin texto adicional antes o después.

Estructura JSON requerida:
{
  "proveedor": "nombre completo o razón social del proveedor",
  "cuit_proveedor": "CUIT del proveedor en formato XX-XXXXXXXX-X si está disponible, sino null",
  "domicilio_proveedor": "domicilio o dirección del proveedor si está disponible, sino null",
  "telefonos_proveedor": "teléfonos del proveedor si están disponibles, sino null",
  "condicion_iva_proveedor": "condición frente al IVA del proveedor (ej: Responsable Inscripto, Monotributista, etc.), sino null",
  "ref_presupuesto": "número de presupuesto o referencia si está disponible, sino null",
  "condicion_pago": "condición de pago indicada (ej: contado, 30 días, 60 días, etc.), sino null",
  "items": [
    {
      "desc": "descripción detallada del producto o servicio",
      "unidad": "unidad de medida exacta del documento (m², m³, ml, kg, gl, tn, u, etc.)",
      "cant": número_decimal,
      "unitario": número_decimal_sin_moneda_ni_separadores,
      "total": número_decimal_sin_moneda_ni_separadores
    }
  ],
  "subtotal_documento": número_o_null,
  "total_documento": número_o_null,
  "descuento": { "porcentaje": número_o_null, "monto": número_positivo_o_cero },
  "noGravado": { "monto": número_positivo_o_cero },
  "impuestos": [
    {
      "nombre": "nombre del impuesto tal como aparece (ej: 'I.V.A. 21%', 'Perc. IIBB Córdoba', 'Percep. Munic. Cba')",
      "porcentaje": número_o_null,
      "monto": número_decimal_sin_moneda_ni_separadores
    }
  ]
}

FORMATO DE NÚMEROS CRÍTICO:
- En documentos argentinos el punto es separador de miles y la coma es decimal
- Ejemplos: 10.000 = 10000, 72,674 = 72.674, 1.114,20 = 1114.20
- Al extraer cantidades y precios, convertir siempre al formato numérico estándar (punto decimal, sin separador de miles)
- Si ves '10.000' como cantidad es diez mil (10000), no diez
- Si ves '72,674' como precio unitario es 72.674 pesos, no 72674
- Verificar que cantidad × precio unitario = importe declarado en el documento
- Si no coincide, revisar la interpretación de los separadores

Reglas importantes:
- Los precios usan formato ARGENTINO: punto como separador de miles, coma como decimal (ej: 1.500,50 → 1500.50). Convertí siempre a número decimal con punto
- Si el documento tiene IVA discriminado, el unitario debe ser el precio NETO sin IVA
- cant, unitario, total, porcentaje y monto son siempre numbers (no strings)
- Si no encontrás un campo opcional, usá null (no string vacío)
- Incluí TODOS los ítems del documento, sin excepción
- En "items", el campo "total" es el importe total de esa línea (cant × unitario)
- Si una descripción está parcialmente ilegible o cortada, extraé lo que puedas y agregá "..." al final
- Para dígitos ambiguos en precios (1/7, 0/6, 3/8), elegí el que dé un precio más coherente con el contexto del ítem y el resto del documento
- "descuento": si hay descuento, extraerlo como monto POSITIVO. Si tiene porcentaje explícito, completar "porcentaje". Si no hay descuento, devolver null
- "noGravado": si hay ítems no gravados o no sujetos a IVA, extraer su monto total. Si no hay, devolver null
- "impuestos": incluir SOLO los impuestos reales (IVA, percepciones, etc.). NO incluir Subtotal, Neto gravado, Gravado ni TOTAL — esos se calculan automáticamente. Si no hay impuestos, devolver []
- Si el documento es completamente ilegible, devolvé items como [] e impuestos como []
- PRECIO UNITARIO: si el documento tiene columna "P.Neto", "Precio Neto" o similar (precio ya con descuento aplicado), usá ese valor como "unitario". Si tiene "P.Lista" + "%Desc.", calculá el neto: P.Lista × (1 - %Desc / 100). En caso de duda, derivá "unitario" = total_linea ÷ cantidad
- "subtotal_documento": el subtotal tal como figura en el documento (antes de impuestos), null si no aparece
- "total_documento": el total final tal como figura en el documento, null si no aparece`;

async function compressImageIfNeeded(file) {
  const LIMIT = 4 * 1024 * 1024;
  if (file.type === 'application/pdf' || file.size <= LIMIT) return file;

  const img = await new Promise((resolve, reject) => {
    const i   = new Image();
    const url = URL.createObjectURL(file);
    i.onload  = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo cargar la imagen para comprimir.')); };
    i.src = url;
  });

  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');
  let scale    = 0.7;

  while (scale >= 0.1) {
    canvas.width  = Math.round(img.naturalWidth  * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
    if (!blob) break;
    if (blob.size <= LIMIT) {
      return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
    }
    scale *= 0.7;
  }
  return file;
}

async function extractFromFile(file) {
  const apiKey = typeof GEMINI_API_KEY !== 'undefined' ? GEMINI_API_KEY : null;
  if (!apiKey || apiKey === 'AQUI_VA_LA_KEY') {
    throw new Error('No hay API Key configurada. Editá js/config.js con tu clave de Gemini.');
  }

  file = await compressImageIfNeeded(file);

  const base64   = await fileToBase64(file);
  const mimeType = normalizeMimeType(file.type, file.name);

  const body = {
    contents: [{
      parts: [
        { text: EXTRACT_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.05,
      maxOutputTokens: 4096
    }
  };

  let response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(60000)
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('La solicitud a Gemini tardó demasiado. Intentá con una imagen más pequeña.');
    }
    throw err;
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Error de API Gemini: ${msg}`);
  }

  const data = await response.json();

  if (!data.candidates?.length) {
    throw new Error('Gemini no devolvió candidatos. Intentá con otra imagen o PDF.');
  }

  const rawText = data.candidates[0]?.content?.parts?.[0]?.text || '';
  return parseGeminiResponse(rawText);
}

function parseGeminiResponse(text) {
  let clean = text.trim();
  // Strip markdown code fences
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No se encontró JSON en la respuesta de Gemini.');
  }

  let parsed;
  try {
    parsed = JSON.parse(clean.slice(start, end + 1));
  } catch {
    throw new Error('La respuesta de Gemini no es JSON válido. Intentá con otra imagen.');
  }

  return {
    proveedor:              trimOrNull(parsed.proveedor),
    cuit_proveedor:         trimOrNull(parsed.cuit_proveedor),
    domicilio_proveedor:    trimOrNull(parsed.domicilio_proveedor),
    telefonos_proveedor:    trimOrNull(parsed.telefonos_proveedor),
    condicion_iva_proveedor: trimOrNull(parsed.condicion_iva_proveedor),
    ref_presupuesto:        trimOrNull(parsed.ref_presupuesto),
    condicion_pago:         trimOrNull(parsed.condicion_pago),
    items: (parsed.items || []).map(it => ({
      descripcion:     String(it.desc || it.descripcion || '').trim(),
      unidad:          String(it.unidad || 'u').trim(),
      cantidad:        parseFloatSafe(it.cant  ?? it.cantidad),
      precio_unitario: parseFloatSafe(it.unitario ?? it.precio_unitario),
      total_documento: parseFloatSafe(it.total)
    })),
    subtotal_documento: parseFloatSafe(parsed.subtotal_documento) || null,
    total_documento:    parseFloatSafe(parsed.total_documento)    || null,
    descuento: parsed.descuento ? {
      porcentaje: parseFloatSafe(parsed.descuento.porcentaje) || null,
      monto:      parseFloatSafe(parsed.descuento.monto)
    } : null,
    noGravado: parsed.noGravado ? {
      monto: parseFloatSafe(parsed.noGravado.monto)
    } : null,
    impuestos: (parsed.impuestos || []).map(imp => ({
      nombre:     String(imp.nombre || '').trim(),
      porcentaje: parseFloatSafe(imp.porcentaje) || null,
      monto:      parseFloatSafe(imp.monto)
    })).filter(imp => imp.nombre !== '' && imp.monto > 0)
  };
}

function trimOrNull(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === '' || s === 'null' ? null : s;
}

function parseFloatSafe(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    // Handle Argentine format "1.500,50" → 1500.50
    const n = parseFloat(val.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function normalizeMimeType(type, filename) {
  if (type && type !== 'application/octet-stream') return type;
  const ext = (filename || '').split('.').pop().toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',  webp: 'image/webp',
    pdf: 'application/pdf'
  };
  return map[ext] || 'image/jpeg';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

// ---- Voice extraction ----

const VOICE_PROMPT = `Sos un asistente especializado en registrar órdenes de compra para la empresa VIMECO S.A.

El usuario va a dictar por voz los datos de una orden de compra. Puede mencionar proveedor, ítems, cantidades, precios, condiciones, obra, etc.

Extraé toda la información y devolvé ÚNICAMENTE un JSON válido, sin bloques de código markdown, sin texto adicional.

Estructura JSON requerida:
{
  "proveedor": "nombre del proveedor o null",
  "cuit_proveedor": "CUIT en formato XX-XXXXXXXX-X o null",
  "domicilio_proveedor": "domicilio o null",
  "telefonos_proveedor": "teléfonos o null",
  "condicion_iva_proveedor": "condición IVA o null",
  "ref_presupuesto": "número de presupuesto o null",
  "condicion_pago": "condición de pago o null",
  "ubicacion": "nombre de la obra o proyecto o null",
  "plazo_entrega": "plazo de entrega o null",
  "lugar_entrega": "lugar de entrega o null",
  "items": [
    {
      "desc": "descripción del ítem",
      "unidad": "unidad de medida (m², m³, kg, u, gl, etc.)",
      "cant": número_decimal,
      "unitario": número_decimal
    }
  ]
}

Reglas:
- Los números son siempre numbers, no strings
- Si un campo no fue mencionado, usá null
- Si no hay ítems claros, devolvé items como []`;

async function extractFromAudio(base64, mimeType) {
  const apiKey = typeof GEMINI_API_KEY !== 'undefined' ? GEMINI_API_KEY : null;
  if (!apiKey || apiKey === 'AQUI_VA_LA_KEY') {
    throw new Error('No hay API Key configurada. Editá js/config.js con tu clave de Gemini.');
  }

  const body = {
    contents: [{
      parts: [
        { text: VOICE_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0.05, maxOutputTokens: 2048 }
  };

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Error de API Gemini: ${msg}`);
  }

  const data = await response.json();
  if (!data.candidates?.length) {
    throw new Error('Gemini no pudo procesar el audio. Intentá de nuevo.');
  }

  const rawText = data.candidates[0]?.content?.parts?.[0]?.text || '';
  return parseVoiceResponse(rawText);
}

function parseVoiceResponse(text) {
  let clean = text.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No se encontró JSON en la respuesta de voz.');

  let parsed;
  try {
    parsed = JSON.parse(clean.slice(start, end + 1));
  } catch {
    throw new Error('La respuesta de voz no es JSON válido.');
  }

  return {
    proveedor:               trimOrNull(parsed.proveedor),
    cuit_proveedor:          trimOrNull(parsed.cuit_proveedor),
    domicilio_proveedor:     trimOrNull(parsed.domicilio_proveedor),
    telefonos_proveedor:     trimOrNull(parsed.telefonos_proveedor),
    condicion_iva_proveedor: trimOrNull(parsed.condicion_iva_proveedor),
    ref_presupuesto:         trimOrNull(parsed.ref_presupuesto),
    condicion_pago:          trimOrNull(parsed.condicion_pago),
    ubicacion:               trimOrNull(parsed.ubicacion),
    plazo_entrega:           trimOrNull(parsed.plazo_entrega),
    lugar_entrega:           trimOrNull(parsed.lugar_entrega),
    items: (parsed.items || []).map(it => ({
      descripcion:     String(it.desc || it.descripcion || '').trim(),
      unidad:          String(it.unidad || 'u').trim(),
      cantidad:        parseFloatSafe(it.cant  ?? it.cantidad),
      precio_unitario: parseFloatSafe(it.unitario ?? it.precio_unitario)
    })),
    descuento: null,
    noGravado: null,
    impuestos: []
  };
}
