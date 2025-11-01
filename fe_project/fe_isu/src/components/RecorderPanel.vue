<template>
  <div class="recorder">
    <button
      :class="['record-button', { 'recording': isRec, 'options-active': showOpts }]"
      @click="onRecBtnClick"
    >
      <span
        :class="['icon', { 'is-recording': isRec, 'options-active': showOpts }]"
        @click.stop="onIconClick"
      ></span>
    </button>
    <div v-if="showOpts && !showNamePrompt" class="options-panel">
      <button class="option-button" @click.stop="promptSave">녹음본 저장하고 종료하기</button>
      <button class="option-button" @click.stop="discardRec">녹음본 저장하지 않고 종료하기</button>
    </div>

    <p v-if="isRec && !showOpts && !showNamePrompt && !isTranscribing" class="recording-status-text">
      녹음중...
    </p>

    <div class="volume-bar-container" v-if="isRec && !showOpts && !isTranscribing">
      <div class="volume-bar" :style="{ width: volume + '%' }"></div>
    </div>
  <!-- 옵션,파일명 입력용 어두운 오버레이 -->
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
        v-model="filenameInput"
        placeholder="예: 2024년 6월 대화록"
        class="filename-input"
        @keyup.enter="confirmSave"
      />
      <div class="prompt-buttons">
        <button class="prompt-button save" @click="confirmSave">저장</button>
        <button class="prompt-button cancel" @click="cancelNamePrompt">취소</button>
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

// 오디오 처리 유틸리티 함수 (인라인)

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

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer); // WAV 헤더 작성

  writeString(view, 0, 'RIFF'); // 청크 ID
  view.setUint32(4, 36 + samples.length * 2, true); // 청크 크기
  writeString(view, 8, 'WAVE'); // 포맷 청크 ID
  writeString(view, 12, 'fmt '); // 서브청크1 ID
  view.setUint32(16, 16, true); // 서브청크1 크기
  view.setUint16(20, 1, true); // 오디오 포맷 (1 = PCM)
  view.setUint16(22, 1, true); // 채널 수
  view.setUint32(24, sampleRate, true); // 샘플링 레이트
  view.setUint32(28, sampleRate * 2, true); // 바이트율
  view.setUint16(32, 2, true);  // 블록 정렬
  view.setUint16(34, 16, true); // 비트 깊이
  writeString(view, 36, 'data'); // 서브청크2 ID
  view.setUint32(40, samples.length * 2, true); // 서브청크2 크기

  // PCM 샘플 작성
  floatTo16BitPCM(view, 44, samples);

  return view;
}

async function to16kWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);// 디코딩

    const targetSampleRate = 16000; // 목표 샘플링 레이트
    const numChannels = 1;
    const length = Math.ceil(audioBuffer.duration * targetSampleRate);
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offlineCtx = new OfflineCtx(numChannels, length, targetSampleRate);

    const source = offlineCtx.createBufferSource();
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
    const chanData = rendered.getChannelData(0);
    const wavBuffer = encodeWav(chanData, targetSampleRate);

    return new Blob([wavBuffer], { type: 'audio/wav' });
  } finally {
    if (decodeCtx && typeof decodeCtx.close === 'function') await decodeCtx.close();
  }
}

function resample(buffer, inSampleRate, outSampleRate) {
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

async function sendToSTT(audioBlob, sampleRate, mimeType) {
  let sendBlob = audioBlob;
  let finalMimeType = mimeType;
  let finalSampleRate = sampleRate;

  const wavBlob = await to16kWav(audioBlob);
  if (wavBlob && wavBlob.size > 0) {
    sendBlob = wavBlob;
    finalSampleRate = 16000;
    finalMimeType = 'audio/wav';
  console.log('프: audio - 16kHz WAV 변환 성공. 크기:', wavBlob.size);
  }

  // FormData로만 전송
  const form = new FormData();
  const filename = finalMimeType === 'audio/wav' ? 'recording.wav' : 'recording.webm';
  form.append('audio', sendBlob, filename);
  form.append('sampleRate', String(finalSampleRate));
  form.append('mimeType', finalMimeType);
  
  const res = await fetch('http://localhost:3001/api/transcribe', { // STT API 엔드포인트
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`STT API 오류: ${res.status} - ${errorText}`);
  }

  const data = await res.json();
  return data.transcription || '변환된 텍스트가 없습니다.';
}


const showNamePrompt = ref(false);
const filenameInput = ref("");
const isRec = ref(false);
const recorder = ref(null); // 소형 컨트롤러 {state, stop}
const chunks = ref([]); // 레거시 호환용
let pcmChunks = []; // 캡처한 PCM 청크
const lastWavBlob = ref(null);
const emit = defineEmits(["recording-finished"]);

const showOpts = ref(false);
const volume = ref(0);
const isTranscribing = ref(false); // 텍스트 변환 중 상태
const mimeType = ref(''); // 녹음 MIME 타입
const sampleRate = ref(0); // 녹음 샘플링 레이트

let stream = null, analyser = null, dataArray = null, audioContext = null, animationFrameId = null, workletNode = null, sourceNode = null;

// 캡처 노드 초기화: worklet 우선, 없으면 script processor로 폴백
function initCapture(s, context) {
  sourceNode = context.createMediaStreamSource(s);

  // AudioWorklet 시도
  if (context.audioWorklet) {
    const processorCode = `class RecorderProcessor extends AudioWorkletProcessor{constructor(){super();}process(inputs){const input = inputs[0];if(input && input[0]){this.port.postMessage(input[0]);}return true;}}registerProcessor('recorder-processor', RecorderProcessor);`;
    const blob = new Blob([processorCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    context.audioWorklet.addModule(url).then(() => {
      workletNode = new AudioWorkletNode(context, 'recorder-processor');
      workletNode.port.onmessage = (e) => {
        pcmChunks.push(new Float32Array(e.data));
      };
      sourceNode.connect(workletNode);
  console.log('프: RecorderPanel - AudioWorklet 사용: 실시간 PCM 캡처 시작');
    });
    return;
  }

  // AudioWorklet이 실패하거나 지원되지 않으면 캡처를 시작하지 않습니다.
  console.warn('프: RecorderPanel - AudioWorklet 초기화 불가: 캡처를 시작하지 않습니다. 브라우저 지원 여부를 확인하세요.');
}

// 캡처 노드 정리 및 스트림 정지
function cleanupCapture() {
  if (workletNode) {
    workletNode.port.close();
    workletNode.disconnect();
    workletNode = null;
  }
  // scriptNode 제거됨: workletNode만 정리
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

// 아이콘 클릭 처리
function onIconClick() {
  if (isTranscribing.value) return;

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
  if (isTranscribing.value) return;

  if (!showOpts.value && !showNamePrompt.value) {
    toggleRec();
  }
}

// 오버레이 클릭 처리
function onOverlayClick() {
  if (isTranscribing.value) {
    return; 
  } else if (showNamePrompt.value) {
    cancelNamePrompt();
  } else if (showOpts.value) {
    cancelOpts();
  }
}

async function toggleRec() {
  if (showOpts.value || showNamePrompt.value || isTranscribing.value) {
    return;
  }

  if (!isRec.value) {
    // 녹음 시작
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    sampleRate.value = audioContext.sampleRate;
  console.log('프: RecorderPanel - 샘플레이트:', sampleRate.value);
    startMeter(stream, audioContext);
    // PCM 직접 캡처 준비(AudioWorklet 우선)
    pcmChunks = [];
    lastWavBlob.value = null;
    // 캡처 노드 일괄 초기화
    initCapture(stream, audioContext);

    recorder.value = {
      state: 'recording',
      stop: () => stopRec()
    };
    isRec.value = true;
    console.log('프: RecorderPanel - 녹음 시작');
  } else {
  showOpts.value = true;
  console.log('프: RecorderPanel - 녹음 중지 옵션 표시');
  }
}

// 캡처 중지 및 WAV Blob 생성
async function stopRec() {
  if (recorder.value) recorder.value.state = 'inactive';
  // 노드 및 트랙 중지
  cleanupCapture(); //노드 정리

  stopMeter();

  // pcmChunks 연결
  let totalLen = 0;
  for (const c of pcmChunks) totalLen += c.length;
  if (totalLen === 0) {
  console.log('프: RecorderPanel - 캡처된 PCM 데이터가 없습니다');
    chunks.value = [];
    lastWavBlob.value = null;
  } else {
    const combined = new Float32Array(totalLen);
    let offset = 0;
    for (const c of pcmChunks) {
      combined.set(c, offset);
      offset += c.length;
    }

    // 필요시 16k로 리샘플
    const origSampleRate = audioContext ? audioContext.sampleRate : sampleRate.value || 48000;
    const targetRate = 16000;
    let outputSamples = combined;
    if (origSampleRate !== targetRate) {
      outputSamples = resample(combined, origSampleRate, targetRate);
    }

    const wavView = encodeWav(outputSamples, targetRate);
    const wavBlob = new Blob([wavView], { type: 'audio/wav' });
    lastWavBlob.value = wavBlob;
    mimeType.value = 'audio/wav';
    sampleRate.value = targetRate;
  console.log('프: RecorderPanel - 생성된 WAV 크기:', wavBlob.size);
    // 하위호환 위해 chunks에 Blob 설정
    chunks.value = [wavBlob];
  }

  // If options menu was open when stopping, show filename prompt
  if (showOpts.value) {
    if (!lastWavBlob.value) {
      window.alert('녹음된 데이터가 없습니다.');
      resetState();
      return;
    }
    filenameInput.value = `대화록_${new Date().toLocaleString('ko-KR', { hour12: false }).replace(/[.\s:]/g, '-')}`;
    showNamePrompt.value = true;
    showOpts.value = false;
  }
}

// 저장하고 종료
async function promptSave() {
  console.warn('프: RecorderPanel - recorder 상태:', recorder.value);
  if (recorder.value && recorder.value.state === "recording") {
  recorder.value.stop();
  console.log('프: RecorderPanel - 녹음 중지 요청: onstop 대기');
  }
}

// 저장 확인
async function confirmSave() {
  if (chunks.value.length === 0) {
    window.alert("저장할 녹음 데이터가 없습니다.");
    resetState();
    return;
  }

  const audioBlob = new Blob(chunks.value, { type: 'audio/webm' }); 

  if (audioBlob.size === 0) {
    window.alert("녹음 파일이 비어 있습니다.");
    resetState();
    return;
  }
  console.log('프: RecorderPanel - STT 전송용 Blob 크기:', audioBlob.size);

  const filename = filenameInput.value.trim() || `대화록_${new Date().toLocaleString("ko-KR").replace(/[:.]/g, "-")}`;

  isTranscribing.value = true;
  showNamePrompt.value = false;
  
  let transcription = '';
  transcription = await sendToSTT(audioBlob, sampleRate.value, mimeType.value);
  console.log('프: RecorderPanel - 전사 결과:', transcription);
  window.alert('음성이 텍스트로 변환되었습니다!');
  isTranscribing.value = false;

  emit('recording-finished', { audioBlob, filename, transcription }); 
  console.log(`프: RecorderPanel - 녹음 저장됨: "${filename}"`);
  resetState();
}

// 저장 안하고 종료
function discardRec() {
  if (recorder.value && recorder.value.state === "recording") {
    recorder.value.stop();
  }
  chunks.value = [];
  console.log('프: RecorderPanel - 녹음 저장 없음');
  window.alert("녹음본이 저장되지 않았습니다.");
  resetState();
}

// 파일명 입력 취소
function cancelNamePrompt() {
  console.log('프: RecorderPanel - 파일명 입력 취소됨');
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
  filenameInput.value = "";
  chunks.value = [];
  isTranscribing.value = false;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  recorder.value = null;
  stopMeter();
}

// 볼륨 미터 시작
function startMeter(stream, context) {
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
function stopMeter() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  if (audioContext) {
    audioContext.close().then(() => {
      audioContext = null;
      analyser = null;
      dataArray = null;
    });
  }
  volume.value = 0;
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
  position: absolute;
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
.record-button .icon .options-active {
  opacity: 1;
  transform: rotate(45deg);
  pointer-events: auto;
}

.options-panel {
  position: absolute;
  top: 50%;
  animation: slideIn 0.3s forwards;
  transition: all 0.3s ease;
  left: calc(50% + 70px);
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 20px;
  width: 350px;
  max-width: 80vw;
  z-index: 11;
  pointer-events: auto;
}



.record-button.options-active {
  opacity: 1;
  pointer-events: auto;

  transform: rotate(45deg);
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
  transform: translateX(25%);
  animation: slideIn 0.3s forwards;
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
