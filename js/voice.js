let _recorder  = null;
let _chunks    = [];
let _recording = false;

window.toggleVoiceRecording = async function(btn) {
  if (_recording) {
    _recorder.stop();
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    window.showVoiceError('No se pudo acceder al micrófono. Verificá los permisos.');
    return;
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
  _recorder  = new MediaRecorder(stream, { mimeType });
  _chunks    = [];
  _recording = true;

  btn.innerHTML = '<span class="import-btn-icon">' + icSvg('stop') + '</span><span class="import-btn-label">Detener</span>';
  btn.classList.add('recording');

  _recorder.addEventListener('dataavailable', e => {
    if (e.data.size > 0) _chunks.push(e.data);
  });

  _recorder.addEventListener('stop', async () => {
    _recording = false;
    stream.getTracks().forEach(t => t.stop());
    btn.innerHTML = '<span class="import-btn-icon">' + icSvg('mic') + '</span><span class="import-btn-label">Dictar datos</span>';
    btn.classList.remove('recording');

    const blob   = new Blob(_chunks, { type: mimeType });
    const base64 = await blobToBase64(blob);

    btn.disabled = true;
    btn.querySelector('.import-btn-sub').textContent = 'Procesando…';

    try {
      const result = await extractFromAudio(base64, mimeType);
      window.onVoiceRecorded(result);
    } catch (err) {
      window.showVoiceError(err.message);
    } finally {
      btn.disabled = false;
      btn.querySelector('.import-btn-sub').textContent = 'Reconocimiento de voz';
    }
  });

  _recorder.start();
};

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('No se pudo procesar el audio.'));
    reader.readAsDataURL(blob);
  });
}
