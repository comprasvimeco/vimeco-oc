// Ejecutado por Netlify antes de cada deploy.
// Reemplaza la versión del service worker con un timestamp
// para que los móviles detecten el cambio automáticamente.

const fs = require('fs');
let sw = fs.readFileSync('sw.js', 'utf8');
sw = sw.replace(/vimeco-oc-v[\w.]+/, 'vimeco-oc-v' + Date.now());
fs.writeFileSync('sw.js', sw);
console.log('SW version updated for this deploy.');
