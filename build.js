const fs = require('fs');

// Bump SW cache version so mobile devices detect the update
let sw = fs.readFileSync('sw.js', 'utf8');
sw = sw.replace(/vimeco-oc-v[\w.]+/, 'vimeco-oc-v' + Date.now());
fs.writeFileSync('sw.js', sw);
console.log('SW version updated for this deploy.');

// Inject Gemini API key from environment (stored in GitHub Secrets)
const apiKey = process.env.GEMINI_API_KEY || '';
if (apiKey) {
  let config = fs.readFileSync('js/config.js', 'utf8');
  config = config.replace('%%GEMINI_API_KEY%%', apiKey);
  fs.writeFileSync('js/config.js', config);
  console.log('Gemini API key injected.');
} else {
  console.warn('Warning: GEMINI_API_KEY not set — placeholder left in config.js');
}

// Inject Drive service account from environment (stored in GitHub Secrets)
const saRaw = process.env.DRIVE_SERVICE_ACCOUNT || '';
if (saRaw) {
  try {
    const parsed = JSON.parse(saRaw);
    let config = fs.readFileSync('js/config.js', 'utf8');
    config = config.replace('%%DRIVE_SERVICE_ACCOUNT%%', JSON.stringify(parsed));
    fs.writeFileSync('js/config.js', config);
    console.log('Drive service account injected.');
  } catch (e) {
    console.error('Error parsing DRIVE_SERVICE_ACCOUNT:', e.message);
  }
} else {
  console.warn('Warning: DRIVE_SERVICE_ACCOUNT not set — placeholder left in config.js');
}
