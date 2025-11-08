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
  <!-- 옵션,파일명 입력시 표시될 배경 오버레이 -->
    <div
      v-if="showOpts || showNamePrompt || showMsgModal || isTranscribing"
      class="dim-overlay"
      @click="onOverlayClick"
    ></div>

    <!-- 파일명 입력 프롬프트 -->
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
import { ref, onMounted, onBeforeUnmount } from "vue";
import { encodeWav, safeCloseAudioContext, resample, sendToSTT } from '@/utils/audio';


const showNamePrompt = ref(false);
const filenameInput = ref("");
const isRec = ref(false);
const recorder = ref(null); // 소형 컨트롤러 {state, stop}
// legacy 'chunks' removed: use pcmChunks / lastWavBlob as single source of truth
let pcmChunks = []; // 캡처한 PCM 청크
const lastWavBlob = ref(null);
const emit = defineEmits(["recording-finished"]);

const showOpts = ref(false);
const volume = ref(0);
const isTranscribing = ref(false); // 텍스트 변환 중 상태
// 메시지 모달 표시 플래그 (템플릿에서 참조됨)
const showMsgModal = ref(false);
// 옵션 표시 전의 녹음 상태를 기억하여 닫을 때 복원할지 결정
const wasRecordingBeforeOpts = ref(false);
// 토글(녹음 시작/일시정지/재개) 중복 호출 방지 락
const isToggling = ref(false);
const mimeType = ref(''); // 녹음 MIME 타입
const sampleRate = ref(0); // 녹음 샘플링 레이트

const capture = {
  stream: null,
  analyser: null,
  dataArray: null,
  audioContext: null,
  animationFrameId: null,
  workletNode: null,
  sourceNode: null
};
// pcm 수집 여부
capture.capturing = false;

// 간결화된 unhandledrejection 처리 및 등록
const handleUnhandledRejection = (e) => {
  console.error('프: 잡히지 않은 Promise 거부:', e?.reason);
  isTranscribing.value = false;
  showNamePrompt.value = true;
  try { window.alert('오류가 발생했습니다. 화면을 초기화하고 다시 시도해주세요.'); } catch (_) { void 0; }
  e?.preventDefault?.();
};

onMounted(() => window.addEventListener('unhandledrejection', handleUnhandledRejection));
onBeforeUnmount(() => window.removeEventListener('unhandledrejection', handleUnhandledRejection));

// (이전 구현에서 옵션 열림을 watch하여 자동 pause 했으나,
//  onIconClick에서 명시적으로 pause 후 옵션을 여는 흐름으로 변경합니다.)
// 캡처 노드 초기화
function initCapture(s, context) {
  capture.sourceNode = context.createMediaStreamSource(s);

  // AudioWorklet 사용
  if (context.audioWorklet) {
    const processorCode = `class RecorderProcessor extends AudioWorkletProcessor{constructor(){super();}process(inputs){const input = inputs[0];if(input && input[0]){this.port.postMessage(input[0]);}return true;}}registerProcessor('recorder-processor', RecorderProcessor);`;
    const blob = new Blob([processorCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    context.audioWorklet.addModule(url)
      .then(() => {
    capture.workletNode = new AudioWorkletNode(context, 'recorder-processor');
    capture.workletNode.port.onmessage = (ev) => {
      if (capture.capturing) pcmChunks.push(new Float32Array(ev.data));
    };
  capture.sourceNode.connect(capture.workletNode);
        console.log('프: 실시간 PCM 캡처 시작');
      })
      .catch((err) => console.warn('프: RecorderPanel - AudioWorklet addModule 실패', err?.message || err))
  .finally(() => { try { URL.revokeObjectURL(url); } catch (_) { void 0; } });
    return;
  }

  // AudioWorklet이 실패하거나 지원되지 않으면 캡처를 시작하지 않음
  console.warn('프: RecorderPanel - AudioWorklet 초기화 불가: 브라우저 지원 여부를 확인하세요.');
}

// 캡처 노드 정리 및 스트림 정지
function cleanupCapture() {
  if (capture.workletNode) {
    try { capture.workletNode.port.close(); } catch (_) { void 0; }
    try { capture.workletNode.disconnect(); } catch (_) { void 0; }
    capture.workletNode = null;
  }

  if (capture.sourceNode) {
    try { capture.sourceNode.disconnect(); } catch (_) { void 0; }
    capture.sourceNode = null;
  }
  if (capture.stream) {
    capture.stream.getTracks().forEach((t) => t.stop());
    capture.stream = null;
  }
}

// 아이콘 클릭 처리
async function onIconClick() {
  if (isTranscribing.value) return;

  if (showNamePrompt.value) {
    cancelNamePrompt();
    return;
  }

  if (showOpts.value) {
    // close options
    cancelOpts();
    return;
  }

  if (isRec.value || showOpts.value) {
    wasRecordingBeforeOpts.value = !!isRec.value;
    if (isRec.value) {
      try {
        await pauseRec();
      } catch (e) {
        console.warn('onIconClick pauseRec 실패', e?.message || e);
      }
    }
    showOpts.value = true;
    return;
  }

  toggleRec();
}

// 녹음 버튼 클릭 처리
// 녹음 버튼 클릭 처리
async function onRecBtnClick() {
  if (isTranscribing.value) return;
  // If options or name prompt are active, ignore
  if (showOpts.value || showNamePrompt.value) return;

  // If currently recording, re-clicking should stop recording and open options
  if (isRec.value) {
    await onIconClick();
    return;
  }

  // Otherwise behave as toggle (start or resume)
  toggleRec();
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
  if (showOpts.value || showNamePrompt.value || isTranscribing.value) return;

  if (isToggling.value) return;
  isToggling.value = true;
  try {
  if (!isRec.value && !showOpts.value) {
      // 녹음 시작
      capture.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      capture.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate.value = capture.audioContext.sampleRate;
      console.log('프: RecorderPanel - 샘플레이트:', sampleRate.value);
      capture.capturing = true;
      startMeter(capture.stream, capture.audioContext);
      // PCM 직접 캡처 준비
      pcmChunks = [];
      lastWavBlob.value = null;
      // 캡처 노드 초기화
      initCapture(capture.stream, capture.audioContext);

      recorder.value = { state: 'recording', stop: () => finalizeRecording() };
  isRec.value = true;
  showOpts.value = false;
      console.log('프: RecorderPanel - 녹음 시작');
      return;
    }

    if (isRec.value) {
      await pauseRec();
      return;
    }

    if (showOpts.value) {
      await resumeRec();
      return;
    }
  } finally {
    isToggling.value = false;
  }
}

// 일시정지: 캡처 노드와 미터만 정지, pcmChunks는 유지
async function pauseRec() {
  const already = isToggling.value;
  if (!already) isToggling.value = true;
  try {
    recorder.value && (recorder.value.state = 'paused');
    capture.capturing = false;
    cleanupCapture();
    stopMeter();
    isRec.value = false;
    // unified state: mark options/paused
    showOpts.value = true;
    console.log('프: RecorderPanel - 녹음 일시정지');
  } catch (e) {
    console.warn('프: pauseRec 오류', e?.message || e);
  } finally {
    if (!already) isToggling.value = false;
  }
}

// 재개: 새로운 스트림/노드로 pcmChunks에 이어서 캡처
async function resumeRec() {
  const already = isToggling.value;
  if (!already) isToggling.value = true;
  try {
    capture.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    capture.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    sampleRate.value = capture.audioContext.sampleRate;
    capture.capturing = true;
    startMeter(capture.stream, capture.audioContext);
    initCapture(capture.stream, capture.audioContext);
    recorder.value = { state: 'recording', stop: () => finalizeRecording() };
    isRec.value = true;
    // unified state: clear options/paused flag
    showOpts.value = false;
    console.log('프: RecorderPanel - 녹음 재개');
  } catch (e) {
    console.warn('프: resumeRec 오류', e?.message || e);
  } finally {
    if (!already) isToggling.value = false;
  }
}

// 캡처 중지 후 WAV Blob 생성(최종 종료용)
async function finalizeRecording() {
  if (recorder.value) recorder.value.state = 'inactive';
  // 노드 및 트랙 정리
  cleanupCapture();
  stopMeter();

  // pcmChunks 연결
  let totalLen = 0;
  for (const c of pcmChunks) totalLen += c.length;
    if (totalLen === 0) {
    console.log('프: RecorderPanel - 캡처된 PCM 데이터가 없습니다');
    lastWavBlob.value = null;
  } else {
    const combined = new Float32Array(totalLen);
    let offset = 0;
    for (const c of pcmChunks) {
      combined.set(c, offset);
      offset += c.length;
    }

    // 필요시 16kHz로 리샘플
    const origSampleRate = capture.audioContext ? capture.audioContext.sampleRate : sampleRate.value || 48000;
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
  }

  // 생성된 WAV 유효성 검사 및 파일명 입력 안내
  if (!lastWavBlob.value) {
    window.alert('녹음된 데이터가 없습니다.');
    resetState();
    return;
  }
  const MIN_WAV_BYTES = 1024;
  if (typeof lastWavBlob.value.size === 'number' && lastWavBlob.value.size < MIN_WAV_BYTES) {
    try { window.alert('오디오 파일이 너무 작아 저장할 수 없습니다. 다시 시도해주세요.'); } catch (e) { console.warn('alert 실패', e?.message || e); }
    resetState();
    return;
  }

  // 디코딩 가능 여부 검사
  let _testCtx = null;
  try {
    _testCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ab = await lastWavBlob.value.arrayBuffer();
    await new Promise((resolve, reject) => {
      try {
        _testCtx.decodeAudioData(ab, (buf) => resolve(buf), (err) => reject(err));
      } catch (e) { reject(e); }
    });
  } catch (e) {
    console.warn('프: 생성된 WAV가 유효하지 않음, 저장 취소', e?.message || e);
    try { window.alert('유효하지 않은 오디오 파일입니다. 저장을 취소합니다.'); } catch (err) { console.warn('alert 실패', err?.message || err); }
    try { await safeCloseAudioContext(_testCtx); } catch (err) { console.warn('safeCloseAudioContext 실패', err?.message || err); }
    resetState();
    return;
  } finally {
    try { await safeCloseAudioContext(_testCtx); } catch (err) { console.warn('safeCloseAudioContext 실패', err?.message || err); }
  }

  filenameInput.value = `대화록_${new Date().toLocaleString('ko-KR', { hour12: false }).replace(/[.\s:]/g, '-')}`;
  showNamePrompt.value = true;
  showOpts.value = false;
}

// 저장하고 종료
async function promptSave() {
  console.warn('프: RecorderPanel - recorder 상태:', recorder.value);
  // Ensure capture is stopped before finalizing
  if (isRec.value) {
    await pauseRec();
  }
  await finalizeRecording();
}

// 저장 확인
async function confirmSave() {
  // Use the WAV blob produced during finalizeRecording
  let audioBlob = null;
  if (lastWavBlob.value instanceof Blob) {
    audioBlob = lastWavBlob.value;
  } else {
    window.alert("저장할 녹음 데이터가 없습니다.");
    resetState();
    return;
  }

  if (!audioBlob || audioBlob.size === 0) {
    window.alert("녹음 파일이 비어 있습니다.");
    resetState();
    return;
  }

  console.log('프: RecorderPanel - STT 전송용 Blob 크기:', audioBlob.size, 'type:', audioBlob.type);

  const filename = filenameInput.value.trim() || `대화록_${new Date().toLocaleString("ko-KR").replace(/[:.]/g, "-")}`;

  isTranscribing.value = true;
  showNamePrompt.value = false;

  // Ensure mimeType passed to STT matches the blob type when available
  const sendMime = audioBlob.type || mimeType.value || 'audio/webm';

  let transcription = '';
  transcription = await sendToSTT(audioBlob, sampleRate.value, sendMime);
  console.log('프: RecorderPanel - 전사 결과:', transcription);
  window.alert('음성이 텍스트로 변환되었습니다!');
  isTranscribing.value = false;

  emit('recording-finished', { audioBlob, filename, transcription }); 
  console.log(`프: RecorderPanel - 녹음 저장됨: "${filename}"`);
  resetState();
}

// 저장 안하고 종료
async function discardRec() {
  showOpts.value = false;
  // Stop capture if active, then discard captured PCM
  if (isRec.value) {
    await pauseRec();
  }
  pcmChunks = [];
  lastWavBlob.value = null;
  // legacy 'chunks' removed; no-op
  console.log('프: RecorderPanel - 녹음 저장 없음 (종료)');
  try { window.alert("녹음본이 저장되지 않았습니다."); } catch (_) { void 0; }
  resetState();
}

// 파일명 입력 취소
async function cancelNamePrompt() {
  console.log('프: RecorderPanel - 파일명 입력 취소됨');
  await discardRec();
}

// 옵션 취소: 옵션을 닫고, 옵션 열기 전에 녹음 중이었다면 재개 시도
function cancelOpts() {
  showOpts.value = false;
  if (wasRecordingBeforeOpts.value) {
    resumeRec().catch((e) => console.warn('옵션 닫기 후 resume 실패', e?.message || e));
  }
  wasRecordingBeforeOpts.value = false;
  console.log('프: RecorderPanel - 옵션 닫기(녹음 상태 복원 시도)');
}

// 상태 초기화
function resetState() {
  isRec.value = false;
  showOpts.value = false;
  showNamePrompt.value = false;
  filenameInput.value = "";
  isTranscribing.value = false;
  // 일시정지 상태 및 옵션 이전 상태 초기화
  // unified state: ensure options/paused cleared
  showOpts.value = false;
  wasRecordingBeforeOpts.value = false;
  // 토글 락 및 캡처 플래그 초기화
  isToggling.value = false;
  capture.capturing = false;
  pcmChunks = [];
  if (capture.stream) {
    capture.stream.getTracks().forEach((track) => track.stop());
    capture.stream = null;
  }
  recorder.value = null;
  stopMeter();
}

// 볼륨 미터 시작
function startMeter(stream, context) {
  if (!context) return;
  capture.audioContext = context;

  console.log('프: RecorderPanel - AudioContext 샘플레이트:', capture.audioContext.sampleRate);

  // Reuse existing MediaStreamSource if present to avoid creating duplicate sources
  const source = capture.sourceNode || capture.audioContext.createMediaStreamSource(stream);
  capture.sourceNode = source;
  capture.analyser = capture.audioContext.createAnalyser();
  capture.analyser.fftSize = 256;

  const bufferLength = capture.analyser.frequencyBinCount;
  capture.dataArray = new Uint8Array(bufferLength);

  source.connect(capture.analyser);

  const updateVolume = () => {
    capture.analyser.getByteFrequencyData(capture.dataArray);
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += capture.dataArray[i];
    }
    const avg = sum / bufferLength;
    volume.value = Math.min(100, Math.round((avg / 255) * 100));
    capture.animationFrameId = requestAnimationFrame(updateVolume);
  };

  updateVolume();
}

// 볼륨 미터 중지
function stopMeter() {
  if (capture.animationFrameId) {
    cancelAnimationFrame(capture.animationFrameId);
  }
  if (capture.audioContext) {
    // 비동기로 안전하게 종료하고 정리
    safeCloseAudioContext(capture.audioContext).finally(() => {
      capture.audioContext = null;
      capture.analyser = null;
      capture.dataArray = null;
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
.record-button .icon.options-active,
.record-button .options-active .icon {
  border-radius: 25%;
  width: 60px;
  height: 60px;
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
  z-index: 10;
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
  /* overlay must sit above the record button but below option/modal panels */
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
