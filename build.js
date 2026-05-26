const fs = require('fs');

// Auto-increment app version in app.html
let appHtml = fs.readFileSync('app.html', 'utf8');
appHtml = appHtml.replace(/(<div class="hdr-drop-version">v)(\d+)(<\/div>)/, (_, pre, num, post) => {
  const next = String(parseInt(num, 10) + 1).padStart(3, '0');
  console.log(`App version bumped: v${num} → v${next}`);
  return `${pre}${next}${post}`;
});
fs.writeFileSync('app.html', appHtml);

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

// Inject Drive OAuth credentials from environment (stored in GitHub Secrets)
const driveClientId     = process.env.DRIVE_CLIENT_ID     || '';
const driveClientSecret = process.env.DRIVE_CLIENT_SECRET || '';
let config = fs.readFileSync('js/config.js', 'utf8');
config = config.replace('%%DRIVE_CLIENT_ID%%',     driveClientId);
config = config.replace('%%DRIVE_CLIENT_SECRET%%', driveClientSecret);
fs.writeFileSync('js/config.js', config);
if (driveClientId && driveClientSecret) {
  console.log('Drive OAuth credentials injected.');
} else {
  console.warn('Warning: DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET not set — Drive upload will fail.');
}
