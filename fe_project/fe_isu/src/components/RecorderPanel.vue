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
import { resample, encodeWav, sendToSTT } from '../utils/audio.js';

const showNamePrompt = ref(false);
const filenameInput = ref("");
const isRec = ref(false);
const recorder = ref(null); // 소형 컨트롤러 {state, stop}
const chunks = ref([]); // 레거시 호환용(주 사용 아님)
let pcmChunks = []; // worklet/scriptprocessor에서 수집된 Float32Array
const lastWavBlob = ref(null);
const emit = defineEmits(["recording-finished"]);

const showOpts = ref(false);
const volume = ref(0);
const isTranscribing = ref(false); // 텍스트 변환 중 상태
const mimeType = ref(''); // 녹음 MIME 타입
const sampleRate = ref(0); // 녹음 샘플링 레이트

let stream = null, analyser = null, dataArray = null, audioContext = null, animationFrameId = null, workletNode = null, scriptNode = null, sourceNode = null;

// 캡처 노드 초기화: worklet 우선, 없으면 script processor로 폴백
function initCapture(s, context) {
  sourceNode = context.createMediaStreamSource(s);

  // AudioWorklet 시도
  if (context.audioWorklet) {
    try {
      const processorCode = `class RecorderProcessor extends AudioWorkletProcessor{constructor(){super();}process(inputs){const input = inputs[0];if(input && input[0]){this.port.postMessage(input[0]);}return true;}}registerProcessor('recorder-processor', RecorderProcessor);`;
      const blob = new Blob([processorCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      context.audioWorklet.addModule(url).then(() => {
        workletNode = new AudioWorkletNode(context, 'recorder-processor');
        workletNode.port.onmessage = (e) => {
          try { pcmChunks.push(new Float32Array(e.data)); } catch (err) { console.warn('프: RecorderPanel - worklet message error', err); }
        };
        sourceNode.connect(workletNode);
        console.log('프: RecorderPanel - AudioWorklet 사용, 실시간 PCM 캡처 시작');
      }).catch((e) => {
        console.warn('프: RecorderPanel - AudioWorklet 초기화 실패, ScriptProcessor로 폴백:', e);
        workletNode = null;
      });
      return;
    } catch (e) {
      console.warn('프: RecorderPanel - AudioWorklet 처리 중 오류, ScriptProcessor로 폴백:', e);
    }
  }

  // ScriptProcessor 폴백
  const bufferSize = 4096;
  const channels = 1;
  scriptNode = context.createScriptProcessor(bufferSize, channels, channels);
  scriptNode.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    pcmChunks.push(new Float32Array(input));
  };
  sourceNode.connect(scriptNode);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  scriptNode.connect(silentGain);
  silentGain.connect(context.destination);
  console.log('프: RecorderPanel - ScriptProcessor 사용, 실시간 PCM 캡처 시작');
}

// 캡처 노드 정리 및 스트림 정지
function cleanupCapture() {
  try {
    if (workletNode) {
      try { workletNode.port.close(); } catch (e) { console.warn('프: RecorderPanel - worklet port close 에러(무시):', e); }
      try { workletNode.disconnect(); } catch (e) { console.warn('프: RecorderPanel - worklet disconnect 에러(무시):', e); }
      workletNode = null;
    }
    if (scriptNode) {
      try { scriptNode.disconnect(); } catch (e) { console.warn('프: RecorderPanel - scriptNode disconnect 에러(무시):', e); }
      scriptNode = null;
    }
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch (e) { console.warn('프: RecorderPanel - sourceNode disconnect 에러(무시):', e); }
      sourceNode = null;
    }
    if (stream) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { console.warn('프: RecorderPanel - stream stop 에러(무시):', e); }
      stream = null;
    }
  } catch (e) { console.warn('프: RecorderPanel - cleanupCaptureNodes 오류:', e); }
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
    try {
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

      // create a small controller-like object to mimic MediaRecorder API used elsewhere
      recorder.value = {
        state: 'recording',
        stop: () => stopRec()
      };
  isRec.value = true;
  console.log('프: RecorderPanel - 녹음 시작');
    } catch (error) {
  console.error('프: RecorderPanel - 마이크 접근 오류:', error);
      window.alert("마이크 접근 권한이 필요합니다.");
      resetState();
    }
  } else {
  showOpts.value = true;
  console.log('프: RecorderPanel - 중지 옵션 표시');
  }
}

// 캡처 중지 및 WAV Blob 생성
async function stopRec() {
  try {
    if (recorder.value) recorder.value.state = 'inactive';
    // 노드 및 트랙 중지
      // 캡처 노드 및 스트림 정리
      cleanupCapture();

    stopMeter();

  // pcmChunks 연결
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
  } catch (err) {
    console.error('프: RecorderPanel - stopRec 오류:', err);
    resetState();
  }
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
  console.log('프: RecorderPanel - STT 전송 Blob 크기:', audioBlob.size);

  const filename = filenameInput.value.trim() || `대화록_${new Date().toLocaleString("ko-KR").replace(/[:.]/g, "-")}`;

  isTranscribing.value = true;
  showNamePrompt.value = false;
  
  let transcription = '';
  try {
    transcription = await sendToSTT(audioBlob, sampleRate.value, mimeType.value);
  console.log('프: RecorderPanel - 전사 결과:', transcription);
    window.alert('음성이 텍스트로 변환되었습니다!');
  } catch (error) {
  console.error('프: RecorderPanel - STT 오류:', error);
    window.alert('음성 변환 중 문제가 발생했습니다.');
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
  window.alert("녹음본이 저장되지 않았습니다.");
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
  }).catch(e => console.error('프: RecorderPanel - 오디오 컨텍스트 닫기 오류:', e));
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
