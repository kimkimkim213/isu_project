<template>
  <div class="recorder">
    <button
      :class="['record-button', { 'recording': isRec, 'options-active': showOpts }]"
      @click="onRecBtnClick"
    >
      <span
        :class="['icon', { 'is-recording': isRec, 'shifted-active': showOpts }]
        "
        @click.stop="onIconClick"
      ></span>

      <div v-if="showOpts && !showNamePrompt" class="options-container">
        <button class="option-button" @click.stop="promptSave">녹음본 저장하고 종료하기</button>
        <button class="option-button" @click.stop="discardRec">녹음본 저장하지 않고 종료하기</button>
      </div>
    </button>

    <p v-if="isRec && !showOpts && !showNamePrompt && !isTranscribing" class="recording-status-text">
      녹음중...
    </p>

    <div class="volume-bar-container" v-if="isRec && !showOpts && !isTranscribing">
      <div class="volume-bar" :style="{ width: volume + '%' }"></div>
    </div>
  <!-- 옵션·파일명 입력용 어두운 오버레이 -->
    <div
      v-if="showOpts || showNamePrompt || showMsgModal || isTranscribing"
      class="dim-overlay"
      @click="onOverlayClick"
    ></div>

    <!-- Filename Input Prompt -->
    <div v-if="showNamePrompt" class="filename-prompt-modal">
      <h3>저장할 파일 이름을 입력해주세요.</h3>
      <input
        type="text"
        v-model="nameInput"
        placeholder="예: 2024년 6월 대화록"
        class="filename-input"
        @keyup.enter="confirmSave"
      />
      <div class="prompt-buttons">
        <button class="prompt-button save" @click="confirmSave">저장</button>
        <button class="prompt-button cancel" @click="cancelNamePrompt">취소</button>
      </div>
    </div>

    <!-- Custom Message Modal (instead of alert) -->
    <div v-if="showMsgModal" class="message-modal-overlay">
      <div class="message-modal-content">
        <h3>{{ msgTitle }}</h3>
        <p>{{ msgContent }}</p>
        <button @click="closeMsg">확인</button>
      </div>
    </div>

    
    <div v-if="isTranscribing" class="transcribing-modal-overlay">
      <div class="transcribing-modal-content">
        <div class="spinner"></div>
        <p>음성을 텍스트로 변환 중...</p>
        <p class="small-text">시간이 다소 소요될 수 있습니다.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";

const showNamePrompt = ref(false);
const nameInput = ref("");
const isRec = ref(false);
const recorder = ref(null); // will be a small controller { state, stop }
const chunks = ref([]); // legacy: kept for compatibility but not used for primary WAV
let pcmChunks = []; // Float32Array pieces collected from worklet/scriptprocessor
const lastWavBlob = ref(null);
const emit = defineEmits(["recording-finished"]);

const showOpts = ref(false);
const volume = ref(0);
const isTranscribing = ref(false); // 텍스트 변환 중 상태
const mimeType = ref(''); // 녹음 MIME 타입
const sampleRate = ref(0); // 녹음 샘플링 레이트

let stream = null;
let analyser = null;
let dataArray = null;
let audioContext = null;
let animationFrameId = null;
let workletNode = null;
let scriptNode = null;
let sourceNode = null;

// 아이콘 클릭 처리
function onIconClick() {
  if (showMsgModal.value || isTranscribing.value) return;

  if (showNamePrompt.value) {
    cancelNamePrompt();
  } else if (showOpts.value) {
    cancelOpts();
  } else {
    toggleRec();
  }
}

// 녹음 버튼 클릭 처리
function onRecBtnClick() {
  if (showMsgModal.value || isTranscribing.value) return;

  if (!showOpts.value && !showNamePrompt.value) {
    toggleRec();
  }
}

// 오버레이 클릭 처리
function onOverlayClick() {
  if (showMsgModal.value) {
    closeMsg();
  } else if (isTranscribing.value) {
    return; 
  } else if (showNamePrompt.value) {
    cancelNamePrompt();
  } else if (showOpts.value) {
    cancelOpts();
  }
}

async function toggleRec() {
  if (showOpts.value || showNamePrompt.value || showMsgModal.value || isTranscribing.value) {
    return;
  }

  if (!isRec.value) {
    // 녹음 시작
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate.value = audioContext.sampleRate;
  console.log('프: RecorderPanel - 샘플레이트:', sampleRate.value);
      startVolMeter(stream, audioContext);
      // Prepare to capture PCM directly (AudioWorklet preferred)
      pcmChunks = [];
      lastWavBlob.value = null;
      const audioTracks = stream.getAudioTracks();
      sourceNode = audioContext.createMediaStreamSource(stream);

      // Try AudioWorklet first
      if (audioContext.audioWorklet) {
        try {
          const processorCode = `class RecorderProcessor extends AudioWorkletProcessor{constructor(){super();}process(inputs){const input = inputs[0];if(input && input[0]){this.port.postMessage(input[0]);}return true;}}registerProcessor('recorder-processor', RecorderProcessor);`;
          const blob = new Blob([processorCode], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          await audioContext.audioWorklet.addModule(url);
          workletNode = new AudioWorkletNode(audioContext, 'recorder-processor');
          workletNode.port.onmessage = (e) => {
            try {
              const float32 = e.data;
              pcmChunks.push(new Float32Array(float32));
            } catch (err) { console.warn('프: RecorderPanel - worklet message error', err); }
          };
          sourceNode.connect(workletNode);
          // do not connect to destination to avoid echo
          console.log('프: RecorderPanel - AudioWorklet 사용, 실시간 PCM 캡처 시작');
        } catch (e) {
          console.warn('프: RecorderPanel - AudioWorklet 초기화 실패, ScriptProcessor로 폴백:', e);
        }
      }

      // Fallback to ScriptProcessor if worklet isn't set up
      if (!workletNode) {
        const bufferSize = 4096;
        const channels = 1;
        scriptNode = audioContext.createScriptProcessor(bufferSize, channels, channels);
        scriptNode.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          pcmChunks.push(new Float32Array(input));
        };
        sourceNode.connect(scriptNode);
        // Connect scriptNode to a muted gain node -> destination to keep processing without audible feedback
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        scriptNode.connect(silentGain);
        silentGain.connect(audioContext.destination);
        console.log('프: RecorderPanel - ScriptProcessor 사용, 실시간 PCM 캡처 시작');
      }

      // create a small controller-like object to mimic MediaRecorder API used elsewhere
      recorder.value = {
        state: 'recording',
        stop: () => stopRecording()
      };
  isRec.value = true;
  console.log('프: RecorderPanel - 녹음 시작');
    } catch (error) {
  console.error('프: RecorderPanel - 마이크 접근 오류:', error);
      showMsg("마이크 오류", "마이크 접근 권한이 필요합니다.");
      resetState();
    }
  } else {
  showOpts.value = true;
  console.log('프: RecorderPanel - 중지 옵션 표시');
  }
}

// Stop capture and produce WAV Blob
async function stopRecording() {
  try {
    if (recorder.value) recorder.value.state = 'inactive';
    // stop nodes and tracks
    try {
      if (workletNode) {
        try { workletNode.port.close(); } catch (e) {}
        try { workletNode.disconnect(); } catch (e) {}
        workletNode = null;
      }
      if (scriptNode) {
        try { scriptNode.disconnect(); } catch (e) {}
        scriptNode = null;
      }
      if (sourceNode) {
        try { sourceNode.disconnect(); } catch (e) {}
        sourceNode = null;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    } catch (e) { console.warn('프: RecorderPanel - stop nodes error', e); }

    stopVolMeter();

    // Concatenate pcmChunks
    let totalLen = 0;
    for (const c of pcmChunks) totalLen += c.length;
    if (totalLen === 0) {
      console.log('프: RecorderPanel - 캡처된 PCM 데이터 없음');
      chunks.value = [];
      lastWavBlob.value = null;
    } else {
      const combined = new Float32Array(totalLen);
      let offset = 0;
      for (const c of pcmChunks) {
        combined.set(c, offset);
        offset += c.length;
      }

      // Resample if needed to 16k
      const origSampleRate = audioContext ? audioContext.sampleRate : sampleRate.value || 48000;
      const targetRate = 16000;
      let outputSamples = combined;
      if (origSampleRate !== targetRate) {
        outputSamples = resampleBuffer(combined, origSampleRate, targetRate);
      }

      const wavView = encodeWAV(outputSamples, targetRate);
      const wavBlob = new Blob([wavView], { type: 'audio/wav' });
      lastWavBlob.value = wavBlob;
      mimeType.value = 'audio/wav';
      sampleRate.value = targetRate;
      console.log('프: RecorderPanel - 생성된 WAV 크기:', wavBlob.size);
      // For backwards compatibility also set chunks as single blob
      chunks.value = [wavBlob];
    }

    // If options menu was open when stopping, show filename prompt
    if (showOpts.value) {
      if (!lastWavBlob.value) {
        showMsg('녹음 오류', '녹음된 데이터가 없습니다.');
        resetState();
        return;
      }
      nameInput.value = `대화록_${new Date().toLocaleString('ko-KR', { hour12: false }).replace(/[.\s:]/g, '-')}`;
      showNamePrompt.value = true;
      showOpts.value = false;
    }
  } catch (err) {
    console.error('프: RecorderPanel - stopRecording 오류:', err);
    resetState();
  }
}

// Simple linear resampler for Float32Array
function resampleBuffer(buffer, inSampleRate, outSampleRate) {
  if (inSampleRate === outSampleRate) return buffer;
  const ratio = inSampleRate / outSampleRate;
  const outLength = Math.round(buffer.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const interp = i * ratio;
    const i0 = Math.floor(interp);
    const i1 = Math.min(i0 + 1, buffer.length - 1);
    const frac = interp - i0;
    out[i] = buffer[i0] * (1 - frac) + buffer[i1] * frac;
  }
  return out;
}

// 저장하고 종료
async function promptSave() {
  if (recorder.value && recorder.value.state === "recording") {
  recorder.value.stop();
  console.log('프: RecorderPanel - 녹음 중지 요청. onstop 대기');
  }
}

// 저장 확인
async function confirmSave() {
  if (chunks.value.length === 0) {
    showMsg("저장 오류", "저장할 녹음 데이터가 없습니다.");
    resetState();
    return;
  }

  const audioBlob = new Blob(chunks.value, { type: 'audio/webm' }); 

  if (audioBlob.size === 0) {
    showMsg("저장 오류", "녹음 파일이 비어 있습니다.");
    resetState();
    return;
  }
  console.log('프: RecorderPanel - STT 전송 Blob 크기:', audioBlob.size);

  const filename = nameInput.value.trim() || `대화록_${new Date().toLocaleString("ko-KR").replace(/[:.]/g, "-")}`;

  isTranscribing.value = true;
  showNamePrompt.value = false;
  
  let transcription = '';
  try {
    transcription = await sendToSTT(audioBlob);
  console.log('프: RecorderPanel - 전사 결과:', transcription);
    showMsg('변환 완료', '음성이 텍스트로 변환되었습니다!');
  } catch (error) {
  console.error('프: RecorderPanel - STT 오류:', error);
    showMsg('STT 오류', '음성 변환 중 문제가 발생했습니다.');
    transcription = '텍스트 변환 실패';
  } finally {
    isTranscribing.value = false;
  }

  emit('recording-finished', { audioBlob, filename, transcription }); 
  console.log(`프: RecorderPanel - 녹음 저장: "${filename}"`);
  resetState();
}

// 저장 안하고 종료
function discardRec() {
  if (recorder.value && recorder.value.state === "recording") {
    recorder.value.stop();
  }
  chunks.value = [];
  console.log('프: RecorderPanel - 녹음 저장 안함');
  showMsg("녹음 삭제", "녹음본이 저장되지 않았습니다.");
  resetState();
}

// 파일명 입력 취소
function cancelNamePrompt() {
  console.log('프: RecorderPanel - 파일명 입력 취소');
  discardRec();
}

// 옵션 취소
function cancelOpts() {
  showOpts.value = false;
  console.log('프: RecorderPanel - 녹음 계속');
}

// 상태 초기화
function resetState() {
  isRec.value = false;
  showOpts.value = false;
  showNamePrompt.value = false;
  nameInput.value = "";
  chunks.value = [];
  isTranscribing.value = false;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  recorder.value = null;
  stopVolMeter();
}

// 메시지 모달
const showMsgModal = ref(false);
const msgTitle = ref("");
const msgContent = ref("");

function showMsg(title, content) {
  msgTitle.value = title;
  msgContent.value = content;
  showMsgModal.value = true;
}

function closeMsg() {
  showMsgModal.value = false;
  msgTitle.value = "";
  msgContent.value = "";
}

// 볼륨 미터 시작
function startVolMeter(stream, context) {
  if (!context) return;
  audioContext = context;
  
  console.log('프: RecorderPanel - AudioContext 샘플레이트:', audioContext.sampleRate);

  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;

  const bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);

  source.connect(analyser);

  const updateVolume = () => {
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const avg = sum / bufferLength;
    volume.value = Math.min(100, Math.round((avg / 255) * 100));

    animationFrameId = requestAnimationFrame(updateVolume);
  };

  updateVolume();
}

// 볼륨 미터 중지
function stopVolMeter() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  if (audioContext) {
    audioContext.close().then(() => {
        audioContext = null;
        analyser = null;
        dataArray = null;
  }).catch(e => console.error('프: RecorderPanel - 오디오 컨텍스트 닫기 오류:', e));
  }
  volume.value = 0;
}

// Blob -> base64 변환(간단한 async 래퍼)
async function blobToBase64(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const base64DataUrl = reader.result;
        const base64Audio = base64DataUrl.split(',')[1];
        resolve(base64Audio);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
}

// 녹음 Blob을 16kHz mono PCM WAV로 변환
async function convertTo16kHzWav(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    // Decode using a short-lived AudioContext
    const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
    // Create OfflineAudioContext for resampling to 16kHz mono
    const targetSampleRate = 16000;
    const numChannels = 1;
    const length = Math.ceil(audioBuffer.duration * targetSampleRate);
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offlineCtx = new OfflineCtx(numChannels, length, targetSampleRate);

    // Create buffer source and copy channels (mix to mono)
    const source = offlineCtx.createBufferSource();
    // If original has multiple channels, mix them down to mono in a temporary buffer
    if (audioBuffer.numberOfChannels > 1) {
      const tmp = offlineCtx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
      const out = tmp.getChannelData(0);
      const chCount = audioBuffer.numberOfChannels;
      for (let c = 0; c < chCount; c++) {
        const inData = audioBuffer.getChannelData(c);
        for (let i = 0; i < inData.length; i++) out[i] = (out[i] || 0) + inData[i] / chCount;
      }
      source.buffer = tmp;
    } else {
      source.buffer = audioBuffer;
    }

    source.connect(offlineCtx.destination);
    source.start(0);
    const rendered = await offlineCtx.startRendering();

    // Get mono channel data
    const chanData = rendered.getChannelData(0);
    // Encode WAV (16-bit PCM)
    const wavBuffer = encodeWAV(chanData, targetSampleRate);
    // Close decoders to free resources
    try { decodeCtx.close(); } catch (e) {}

    return new Blob([wavBuffer], { type: 'audio/wav' });
  } catch (err) {
    console.warn('프: RecorderPanel - convertTo16kHzWav 실패:', err);
    throw err;
  }
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */ writeString(view, 0, 'RIFF');
  /* file length */ view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */ writeString(view, 8, 'WAVE');
  /* format chunk identifier */ writeString(view, 12, 'fmt ');
  /* format chunk length */ view.setUint32(16, 16, true);
  /* sample format (raw) */ view.setUint16(20, 1, true);
  /* channel count */ view.setUint16(22, 1, true);
  /* sample rate */ view.setUint32(24, sampleRate, true);
  /* byte rate (sampleRate * blockAlign) */ view.setUint32(28, sampleRate * 2, true);
  /* block align (channelCount * bytesPerSample) */ view.setUint16(32, 2, true);
  /* bits per sample */ view.setUint16(34, 16, true);
  /* data chunk identifier */ writeString(view, 36, 'data');
  /* data chunk length */ view.setUint32(40, samples.length * 2, true);

  // Write the PCM samples
  floatTo16BitPCM(view, 44, samples);

  return view;
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    output.setInt16(offset, s, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// STT API 호출 (간단한 async/await 흐름)
async function sendToSTT(audioBlob) {
  try {
    // Ensure we send a consistent 16kHz mono PCM WAV to the server to avoid
    // encoding/sampleRate mismatch. Try converting the recorded blob first.
    let sendBlob = audioBlob;
    try {
      const wavBlob = await convertTo16kHzWav(audioBlob);
      if (wavBlob && wavBlob.size > 0) {
        sendBlob = wavBlob;
        // server expects sampleRate metadata; set to 16000 for converted wav
        sampleRate.value = 16000;
        mimeType.value = 'audio/wav';
        console.log('프: RecorderPanel - 변환된 WAV 사용 (16kHz). 크기:', wavBlob.size);
      }
    } catch (e) {
      console.warn('프: RecorderPanel - WAV 변환 실패, 원본 Blob 사용:', e);
    }
    // 우선 FormData로 전송 시도(메모리 절약)
    try {
  const form = new FormData();
  // Use converted WAV when available, fallback to original
  const filename = mimeType.value === 'audio/wav' ? 'recording.wav' : 'recording.webm';
  form.append('audio', sendBlob, filename);
  form.append('sampleRate', String(sampleRate.value));
  form.append('mimeType', mimeType.value);
      const resForm = await fetch('http://localhost:3001/api/transcribe', {
        method: 'POST',
        body: form,
      });
      if (resForm.ok) {
        const data = await resForm.json();
        return data.transcription || '변환된 텍스트가 없습니다.';
      }
      console.warn('프: RecorderPanel - form 전송 실패, base64 폴백');
    } catch (e) {
      console.warn('프: RecorderPanel - form 전송 예외, base64 폴백:', e);
    }

    // FormData 실패 시 base64 폴백
    const base64Audio = await blobToBase64(sendBlob);
    const res = await fetch('http://localhost:3001/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64Audio, sampleRate: sampleRate.value, mimeType: mimeType.value }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`STT API 오류: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
    return data.transcription || '변환된 텍스트가 없습니다.';
  } catch (error) {
    console.error('프: RecorderPanel - sendToSTT 실패:', error);
    throw error; // 호출자에서 처리
  }
}
</script>

<style scoped>
.recorder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.record-button {
  position: 뮤;
  width: 200px;
  height: 200px;
  border: 1px solid #ccc;
  border-radius: 50%;
  background-color: #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
  padding: 0;
  z-index: 10;
  overflow: hidden;
}

.record-button .icon {
  width: 80px;
  height: 80px;
  background-color: #ff1744;
  border-radius: 50%;
  transition: all 0.3s ease;
  flex-shrink: 0;
  position: relative;
  left: 0;
  margin-left: 0;
}

.record-button .icon.is-recording {
  border-radius: 16px;
  width: 60px;
  height: 60px;
  background-color: #d50000;
}

.record-button.options-active {
  width: 70vw;
  height: 35vh;
  max-width: 900px;
  max-height: 450px;
  border-radius: 16px;
  background-color: #f0f0f0;
  justify-content: flex-start;
  padding: 0;
  z-index: 10;
  overflow: hidden;
}

.record-button.options-active .icon.shifted-active {
  border-radius: 16px;
  width: 100px;
  height: 100px;
  background-color: #ff1744;
  margin-left: 25px;
}


.options-container {
  display: flex;
  flex-direction: column;
  gap: 15px;
  flex-grow: 1;
  align-items: center;
  justify-content: center;
  padding: 20px;
  opacity: 0;
  transform: translateX(20px);
  transition: opacity 0.3s ease 0.1s, transform 0.3s ease 0.1s;
  z-index: 11;
}

.record-button.options-active .options-container {
  opacity: 1;
  transform: translateX(0);
}


.recording-status-text {
  position: absolute;
  bottom: 10%;
  left: 50%;
  transform: translateX(-50%);
  font-size: 2em;
  color: #333;
  text-align: center;
  width: 100%;
  z-index: 5;
}

.dim-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.4);
  z-index: 5;
  transition: opacity 0.3s ease;
}

.option-button {
  width: 90%;
  padding: 15px 20px;
  font-size: 1.2em;
  font-weight: 500;
  color: #333;
  background-color: #e0e0e0;
  border: 1px solid #ccc;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.option-button:hover {
  background-color: #d0d0d0;
  border-color: #aaa;
}

.filename-prompt-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 90%;
  max-width: 450px;
  text-align: center;
}

.filename-prompt-modal h3 {
  margin: 0;
  font-size: 1.5em;
  color: #333;
}

.filename-input {
  width: calc(100% - 20px);
  padding: 12px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 1.1em;
  box-sizing: border-box;
}

.filename-input::placeholder {
  color: #aaa;
}

.prompt-buttons {
  display: flex;
  justify-content: center;
  gap: 15px;
  margin-top: 10px;
}

.prompt-button {
  padding: 12px 25px;
  border: none;
  border-radius: 8px;
  font-size: 1.1em;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;
}

.prompt-button.save {
  background-color: #007bff;
  color: white;
}

.prompt-button.save:hover {
  background-color: #0056b3;
  transform: translateY(-1px);
}

.prompt-button.cancel {
  background-color: #6c757d;
  color: white;
}

.prompt-button.cancel:hover {
  background-color: #5a6268;
  transform: translateY(-1px);
}

.message-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}

.message-modal-content {
  background-color: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
  max-width: 400px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.message-modal-content h3 {
  margin: 0;
  color: #333;
  font-size: 1.6em;
}

.message-modal-content p {
  margin: 0;
  color: #555;
  font-size: 1.1em;
  line-height: 1.5;
}

.message-modal-content button {
  padding: 10px 20px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1.1em;
  transition: background-color 0.2s ease;
}

.message-modal-content button:hover {
  background-color: #0056b3;
}

.volume-bar-container {
  position: absolute;
  bottom: 27.5%;
  left: 25%;
  width: 50%;
  height: 12px;
  background-color: #ddd;
  border-radius: 6px;
  overflow: hidden;
  z-index: 10;
}

.volume-bar {
  height: 100%;
  background-color: #4caf50;
  transition: width 0.1s linear;
}

.transcribing-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
}

.transcribing-modal-content {
  background-color: #222;
  color: #fff;
  padding: 40px;
  border-radius: 12px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.5);
  max-width: 350px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-items: center;
}

.spinner {
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top: 4px solid #fff;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.transcribing-modal-content p {
  margin: 0;
  font-size: 1.2em;
}

.transcribing-modal-content .small-text {
  font-size: 0.9em;
  color: #bbb;
}
</style>
