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
    <!-- Dim overlay for options and filename prompt -->
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
const recorder = ref(null);
const chunks = ref([]);
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

// 아이콘 클릭
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

// 녹음 버튼 클릭
function onRecBtnClick() {
  if (showMsgModal.value || isTranscribing.value) return;

  if (!showOpts.value && !showNamePrompt.value) {
    toggleRec();
  }
}

// 오버레이 클릭
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
  console.log('프: RecorderPanel - AudioContext 샘플레이트:', sampleRate.value);
      startVolMeter(stream, audioContext);

      const supportedMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      mimeType.value = supportedMimeType;
  console.log('프: RecorderPanel - 지원 MIME 타입:', mimeType.value);

      recorder.value = new MediaRecorder(stream, {
        mimeType: mimeType.value,
        audioBitsPerSecond: 64000
      });

      recorder.value.ondataavailable = (event) => {
  console.log('프: RecorderPanel - 오디오 청크 수신. 크기:', event.data.size);
        if (event.data.size > 0) {
          chunks.value.push(event.data);
        }
      };

      recorder.value.onstop = () => {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
        }
        stopVolMeter();
  console.log('프: RecorderPanel - Recorder 중지. 청크 수:', chunks.value.length);
  const finalBlob = new Blob(chunks.value, { type: supportedMimeType });
  console.log('프: RecorderPanel - 최종 Blob 크기:', finalBlob.size);

        if (showOpts.value) {
          if (chunks.value.length === 0) {
              showMsg("녹음 오류", "녹음된 데이터가 없습니다.");
              resetState();
              return;
          }
          nameInput.value = `대화록_${new Date()
            .toLocaleString("ko-KR", { hour12: false })
            .replace(/[.\s:]/g, "-")}`;
          showNamePrompt.value = true;
          showOpts.value = false;
        }
      };

      recorder.value.start();
  isRec.value = true;
  console.log('프: RecorderPanel - 녹음 시작');
    } catch (error) {
      console.error("마이크 접근 오류:", error);
      showMsg("마이크 오류", "마이크 접근 권한이 필요합니다.");
      resetState();
    }
  } else {
  showOpts.value = true;
  console.log('프: RecorderPanel - 녹음 중지 옵션 표시');
  }
}

// 저장하고 종료
async function promptSave() {
  if (recorder.value && recorder.value.state === "recording") {
  recorder.value.stop();
  console.log('프: RecorderPanel - 녹음 중지. onstop 대기.');
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
  console.log('프: RecorderPanel - STT API 전송 Blob 크기:', audioBlob.size);

  const filename = nameInput.value.trim() || `대화록_${new Date().toLocaleString("ko-KR").replace(/[:.]/g, "-")}`;

  isTranscribing.value = true;
  showNamePrompt.value = false;
  
  let transcription = '';
  try {
    transcription = await sendToSTT(audioBlob);
  console.log('프: RecorderPanel - 전사 결과:', transcription);
    showMsg('변환 완료', '음성이 텍스트로 변환되었습니다!');
  } catch (error) {
    console.error('STT 오류:', error);
    showMsg('STT 오류', '음성 변환 중 문제가 발생했습니다.');
    transcription = '텍스트 변환 실패';
  } finally {
    isTranscribing.value = false;
  }

  emit('recording-finished', { audioBlob, filename, transcription }); 
  console.log(`프: RecorderPanel - 녹음 "${filename}" 저장`);
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
    }).catch(e => console.error("오디오 컨텍스트 닫기 오류:", e));
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

// STT API 호출 (간단한 async/await 흐름)
async function sendToSTT(audioBlob) {
  try {
    const base64Audio = await blobToBase64(audioBlob);

    const res = await fetch('http://localhost:3001/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio: base64Audio,
        sampleRate: sampleRate.value,
        mimeType: mimeType.value,
      }),
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
  position: relative;
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
