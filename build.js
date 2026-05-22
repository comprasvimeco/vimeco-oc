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
