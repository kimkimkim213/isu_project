<template>
  <div class="recorder">
    <button :class="['record-button', { recording: isRecording }]" @click="onRecordClick">
      <span :class="['icon', { 'is-recording': isRecording }]" @click.stop="onIconClick"></span>
    </button>

    <p v-if="isRecording" class="recording-status-text">녹음중...</p>

    <div v-if="showFilenamePrompt" class="filename-prompt-modal">
      <h3>저장할 파일 이름을 입력해주세요.</h3>
      <input type="text" v-model="filenameInput" @keyup.enter="confirmSaveRecording" />
      <div>
        <button @click="confirmSaveRecording">저장</button>
        <button @click="cancelFilenamePrompt">취소</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';
import { useAudioMeter, blobToBase64, fetchWithTimeout, DEFAULT_FETCH_TIMEOUT } from '@/conposable';

const emit = defineEmits(['recording-finished']);

const filenameInput = ref('');
const isRecording = ref(false);
const mediaRecorder = ref(null);
const audioChunks = ref([]);
const showFilenamePrompt = ref(false);

const { start: startVolumeMeter, stop: stopVolumeMeter, getSampleRate } = useAudioMeter();
let currentStream = null;
const currentMimeType = ref('');
const currentSampleRate = ref(0);

function onIconClick() { toggleRecording(); }
function onRecordClick() { if (!showFilenamePrompt.value) toggleRecording(); }

async function toggleRecording() {
  if (!isRecording.value) {
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startVolumeMeter(currentStream);
      const sr = getSampleRate(); if (sr) currentSampleRate.value = sr;
      const supported = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      currentMimeType.value = supported;
      mediaRecorder.value = new MediaRecorder(currentStream, { mimeType: currentMimeType.value });
      mediaRecorder.value.ondataavailable = (e) => { console.log('Audio chunk size=', e.data?.size); if (e.data && e.data.size) audioChunks.value.push(e.data); };
      mediaRecorder.value.onstop = onRecorderStopped;
      mediaRecorder.value.start();
      isRecording.value = true;
      console.log('녹음 시작됨', currentMimeType.value, currentSampleRate.value);
    } catch (e) {
      console.error('getUserMedia error', e);
      resetRecordingState();
    }
  } else {
    if (mediaRecorder.value && mediaRecorder.value.state === 'recording') {
      try { mediaRecorder.value.stop(); } catch (e) { console.error('stop error', e); }
    }
    showFilenamePrompt.value = true;
  }
}

function onRecorderStopped() {
  console.log('MediaRecorder stopped. chunks=', audioChunks.value.length);
  showFilenamePrompt.value = true;
}

async function confirmSaveRecording() {
  if (audioChunks.value.length === 0) { resetRecordingState(); return; }
  const audioBlob = new Blob(audioChunks.value, { type: currentMimeType.value || 'audio/webm' });
  const filename = (filenameInput.value || '').trim() || `recording-${Date.now()}`;
  let transcription = '';
  try {
    console.log('Sending audio to STT size=', audioBlob.size);
    transcription = await transcribeAudio(audioBlob);
    console.log('STT length=', transcription?.length);
  } catch (e) { transcription = '전환 실패: ' + (e?.message || '오류'); }
  emit('recording-finished', { audioBlob, filename, transcription });
  resetRecordingState();
}

function cancelFilenamePrompt() { audioChunks.value = []; resetRecordingState(); }

function resetRecordingState() {
  isRecording.value = false;
  showFilenamePrompt.value = false;
  filenameInput.value = '';
  audioChunks.value = [];
  try { if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; } } catch (e) { console.error('stop tracks error', e); }
  stopVolumeMeter();
  mediaRecorder.value = null;
}

async function transcribeAudio(blob) {
  const dataUrl = await blobToBase64(blob);
  const base64 = String(dataUrl || '').split(',')[1] || '';
  console.log('Sending to STT (approx bytes)=', base64.length);
  const resp = await fetchWithTimeout('http://localhost:3001/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: base64, sampleRate: currentSampleRate.value, mimeType: currentMimeType.value }) }, DEFAULT_FETCH_TIMEOUT);
  if (!resp.ok) throw new Error('STT error');
  const json = await resp.json();
  return json.transcription || '';
}

onUnmounted(() => { try { if (mediaRecorder.value && mediaRecorder.value.state === 'recording') mediaRecorder.value.stop(); } catch (e) { console.debug('unmount stop error', e); } stopVolumeMeter(); });
</script>

<style scoped>
.recorder { display:flex; align-items:center; justify-content:center; }
.record-button { width:120px; height:120px; border-radius:50%; background:#eee; }
.icon { display:block; width:60px; height:60px; background:#ff1744; border-radius:50%; margin:auto; }
.icon.is-recording { background:#d50000; }
.recording-status-text { margin-top:10px; }
.filename-prompt-modal { position:fixed; left:50%; top:40%; transform:translate(-50%,-40%); background:#fff; padding:16px; border-radius:8px; box-shadow:0 6px 20px rgba(0,0,0,0.2); }
</style>
