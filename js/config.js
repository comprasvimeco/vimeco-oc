// Clave de API de Google Gemini
const GEMINI_API_KEY = "%%GEMINI_API_KEY%%";

// Configuración de Google Drive (OAuth — credenciales inyectadas por build.js)
var DRIVE_CONFIG = {
  folderId:     "1TIYO5bNg7Dxbqo1pxGkpGbR_LK9C3NEL",
  clientId:     "%%DRIVE_CLIENT_ID%%",
  clientSecret: "%%DRIVE_CLIENT_SECRET%%"
};

// Configuración de Firebase — completar con los valores del proyecto
var FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCdKQ0QPeJY29TItGyCRLOJFTVnrU0zTlo",
  authDomain:        "vimeco-oc-1a978.firebaseapp.com",
  databaseURL:       "https://vimeco-oc-1a978-default-rtdb.firebaseio.com",
  projectId:         "vimeco-oc-1a978",
  storageBucket:     "vimeco-oc-1a978.firebasestorage.app",
  messagingSenderId: "80245022316",
  appId:             "1:80245022316:web:f83bab4d1b47b406664249"
};

// Notificaciones push (js/push.js). Vacío = desactivadas. Cómo obtener los dos
// valores: apps-script/README.md.
var PUSH_CONFIG = {
  vapidKey: "BNHd0t_GUog6iNCICKhqt7TF44694QfSn2eG21grU33H_Zvuts4XHxWp_cjILDAMjDakMBmiyW4FP2f0nMiOjTo",
  relayUrl: "https://script.google.com/macros/s/AKfycby2PDZmHgsrxFM0LwNZTCJCgDWkoJe6qIYpzGlSeK92mX94pR-QFXR_oSek_GID3e1p/exec"
};
