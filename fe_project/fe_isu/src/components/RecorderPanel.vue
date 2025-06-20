<template>
  <div class="recorder">
    <button
      :class="['record-button', { 'recording': isRecording, 'options-active': showOptions }]"
      @click="handleRecordButtonClick"
    >
      <span
        :class="['icon', { 'is-recording': isRecording, 'shifted-active': showOptions }]
        "
        @click.stop="handleIconClick"
      ></span>

      <div v-if="showOptions && !showFilenamePrompt" class="options-container">
        <button class="option-button" @click.stop="promptForSave">녹음본 저장하고 종료하기</button>
        <button class="option-button" @click.stop="discardAndStopRecording">녹음본 저장하지 않고 종료하기</button>
      </div>
    </button>

    <p v-if="isRecording && !showOptions && !showFilenamePrompt && !isTranscribing" class="recording-status-text">
      녹음중...
    </p>

    <div class="volume-bar-container" v-if="isRecording && !showOptions && !isTranscribing">
      <div class="volume-bar" :style="{ width: volume + '%' }"></div>
    </div>
    <!-- Dim overlay for options and filename prompt -->
    <div
      v-if="showOptions || showFilenamePrompt || showMessageModal || isTranscribing"
      class="dim-overlay"
      @click="handleOverlayClick"
    ></div>

    <!-- Filename Input Prompt -->
    <div v-if="showFilenamePrompt" class="filename-prompt-modal">
      <h3>저장할 파일 이름을 입력해주세요.</h3>
      <input
        type="text"
        v-model="filenameInput"
        placeholder="예: 2024년 6월 회의록"
        class="filename-input"
        @keyup.enter="confirmSaveRecording"
      />
      <div class="prompt-buttons">
        <button class="prompt-button save" @click="confirmSaveRecording">저장</button>
        <button class="prompt-button cancel" @click="cancelFilenamePrompt">취소</button>
      </div>
    </div>

    <!-- Custom Message Modal (instead of alert) -->
    <div v-if="showMessageModal" class="message-modal-overlay">
      <div class="message-modal-content">
        <h3>{{ messageModalTitle }}</h3>
        <p>{{ messageModalContent }}</p>
        <button @click="closeMessageModal">확인</button>
      </div>
    </div>

    <!-- Transcription Loading Modal -->
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

const showFilenamePrompt = ref(false);
const filenameInput = ref("");
const isRecording = ref(false);
let mediaRecorder = null; // Changed to let to allow null assignment
const audioChunks = ref([]);
const emit = defineEmits(["recording-finished"]);

const showOptions = ref(false);
const volume = ref(0);
const isTranscribing = ref(false); // 텍스트 변환 중 상태

let currentStream = null;
let analyser = null;
let dataArray = null;
let audioContext = null;
let animationFrameId = null;

// App.vue에서 이미 정의된 blobToBase64 헬퍼 함수를 여기에 복사/붙여넣기
// 또는 별도의 유틸리티 파일로 분리하여 import하는 것이 좋습니다.
// 여기서는 RecoderPanel.vue 내부에서만 사용된다고 가정하고 복사합니다.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob); // Read as Base64 Data URL
  });
}

// 붉은 원 (icon) 클릭 시 호출될 함수
function handleIconClick() {
  if (showMessageModal.value || isTranscribing.value) return; // 메시지/변환 모달이 떠있으면 다른 동작 방지

  if (showFilenamePrompt.value) {
    // 파일명 입력 팝업이 떠 있는 상태에서 아이콘 클릭 시: 팝업 닫기 (취소)
    cancelFilenamePrompt();
  } else if (showOptions.value) {
    // 옵션 팝업이 떠 있는 상태에서 아이콘 클릭 시: 팝업 닫기 (취소)
    cancelOptions();
  } else {
    // 팝업이 안 떠 있는 상태에서 아이콘 클릭 시: 녹음 토글 (시작/옵션 팝업 띄우기)
    toggleRecording();
  }
}

// record-button 배경 자체를 클릭 시 호출될 함수
function handleRecordButtonClick() {
  if (showMessageModal.value || isTranscribing.value) return; // 메시지/변환 모달이 떠있으면 다른 동작 방지

  if (!showOptions.value && !showFilenamePrompt.value) {
    toggleRecording();
  }
  // 팝업이 활성화된 상태에서 record-button 배경을 클릭하면
  // dim-overlay가 클릭되면서 handleOverlayClick가 호출되므로 여기서는 아무것도 하지 않습니다.
}

// 오버레이 클릭 시 팝업 닫기 (옵션 팝업 또는 파일명 입력 팝업 또는 메시지 모달)
function handleOverlayClick() {
  if (showMessageModal.value) {
    closeMessageModal();
  } else if (isTranscribing.value) {
    // 변환 중에는 오버레이 클릭으로 닫히지 않도록 함 (작업 중단 방지)
    return; 
  } else if (showFilenamePrompt.value) {
    cancelFilenamePrompt();
  } else if (showOptions.value) {
    cancelOptions();
  }
}

async function toggleRecording() {
  // 팝업이 활성화된 상태에서는 이 함수가 직접 호출되지 않도록 방어 로직
  if (showOptions.value || showFilenamePrompt.value || showMessageModal.value || isTranscribing.value) {
    return;
  }

  if (!isRecording.value) {
    // 녹음 시작 로직
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startVolumeMeter(currentStream);
      mediaRecorder = new MediaRecorder(currentStream);

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.value.push(event.data);
      };

      mediaRecorder.onstop = () => {
        if (currentStream) {
          currentStream.getTracks().forEach((track) => track.stop());
          currentStream = null;
        }
        stopVolumeMeter(); // 녹음 중지 시 볼륨 미터 중지
      };

      mediaRecorder.start(100);
      isRecording.value = true;
      console.log("녹음 시작됨");
    } catch (error) {
      console.error("마이크 접근 오류:", error);
      displayMessageModal(
        "마이크 접근 오류",
        "마이크 접근 권한이 필요합니다. 브라우저 설정에서 마이크 접근을 허용해주세요."
      );
      resetRecordingState(); // 오류 시 상태 초기화
    }
  } else {
    // 녹음 중일 때 버튼을 누르면 팝업 표시 (저장/취소 옵션)
    showOptions.value = true;
    console.log("녹음 중지 옵션 표시");
  }
}

// "녹음본 저장하고 종료하기" 버튼 클릭 시 호출
async function promptForSave() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop(); // 녹음 중지. ondataavailable 이벤트 발생
    console.log("녹음 중지됨. 파일 이름 입력 대기.");
  }
  
  if (audioChunks.value.length === 0) {
    console.error("ERROR: No audio chunks were collected! 녹음된 데이터가 없습니다.");
    displayMessageModal(
      "녹음 오류",
      "녹음된 데이터가 없습니다. 마이크가 제대로 작동하는지 확인해주세요."
    );
    resetRecordingState();
    return;
  }

  // 기본 파일명 설정 (예: "회의록_2024-06-13_15-30-00")
  filenameInput.value = `회의록_${new Date()
    .toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    .replace(/(\.\s*|\s*:\s*|\s*)/g, "-")
    .replace(/\.$/, "")}`; // 날짜 형식에 따라 조정 필요
  showFilenamePrompt.value = true; // 파일 이름 입력 팝업 표시
  showOptions.value = false; // 옵션 팝업 숨김
}

// 파일 이름 입력 후 "저장" 버튼 클릭 시 호출
async function confirmSaveRecording() {
  if (audioChunks.value.length === 0) {
    console.error("ERROR: Cannot save. No audio chunks available.");
    displayMessageModal("저장 오류", "저장할 녹음 데이터가 없습니다.");
    resetRecordingState();
    return;
  }

  const audioBlob = new Blob(audioChunks.value, { type: "audio/webm" });

  if (audioBlob.size === 0) {
    console.error("ERROR: Generated audio Blob is empty! Blob 크기가 0입니다.");
    displayMessageModal(
      "저장 오류",
      "녹음 파일이 비어 있습니다. 마이크 입력이 없었을 수 있습니다."
    );
    resetRecordingState();
    return;
  }

  // 파일명 확정
  const filename = filenameInput.value.trim() || `회의록_${new Date().toLocaleString("ko-KR").replace(/[:.]/g, "-")}`;

  // 텍스트 변환 시작 알림 및 스피너 표시
  isTranscribing.value = true;
  showFilenamePrompt.value = false; // 파일명 입력 팝업 닫기
  
  let transcription = '';
  try {
    transcription = await sendToSpeechAPI(audioBlob);
    console.log("전사 결과:", transcription);
    displayMessageModal('텍스트 변환 완료', '음성 파일이 텍스트로 성공적으로 변환되었습니다!');
  } catch (error) {
    console.error('텍스트 변환 오류:', error);
    displayMessageModal('텍스트 변환 오류', '음성 텍스트 변환 중 문제가 발생했습니다. 백엔드 서버를 확인해주세요.');
    transcription = '텍스트 변환 실패: ' + (error.message || '알 수 없는 오류');
  } finally {
    isTranscribing.value = false; // 변환 완료 (성공/실패 무관)
  }

  // App.vue로 Blob 데이터, 파일명, 전사 결과 함께 전달
  emit('recording-finished', { audioBlob, filename, transcription }); 
  console.log(`녹음본 "${filename}" 저장 및 종료`);
  resetRecordingState(); // 상태 초기화
}

// 팝업 - "녹음본 저장하지 않고 종료하기" (또는 파일명 입력 취소 시)
function discardAndStopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
  audioChunks.value = []; // 데이터 버림
  console.log("녹음본 저장하지 않고 종료");
  displayMessageModal("녹음 삭제", "녹음본이 저장되지 않고 삭제되었습니다.");
  resetRecordingState();
}

// 파일명 입력 팝업에서 "취소" 버튼 클릭 시
function cancelFilenamePrompt() {
  console.log("파일명 입력 취소. 녹음본 삭제 처리.");
  discardAndStopRecording(); // 파일명 입력을 취소하면 해당 녹음본은 버려짐
}

// 팝업 - "취소" (녹음을 계속하고 팝업 닫기)
function cancelOptions() {
  showOptions.value = false;
  console.log("녹음 중지 옵션 취소, 녹음 계속");
  // 녹음 자체는 mediaRecorder.stop()이 호출되기 전까지 계속됨.
  // 이 함수는 단순히 옵션 팝업만 닫음.
}

// 모든 상태를 초기화하는 헬퍼 함수
function resetRecordingState() {
  isRecording.value = false;
  showOptions.value = false;
  showFilenamePrompt.value = false;
  filenameInput.value = "";
  audioChunks.value = [];
  isTranscribing.value = false; // 변환 상태도 초기화
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }
  mediaRecorder = null; // Recorder 객체도 리셋하여 새 녹음 준비
  stopVolumeMeter(); // 볼륨 미터 중지
}

// Custom Message Modal (for errors/information) - replacing alert()
const showMessageModal = ref(false);
const messageModalTitle = ref("");
const messageModalContent = ref("");

function displayMessageModal(title, content) {
  messageModalTitle.value = title;
  messageModalContent.value = content;
  showMessageModal.value = true;
}

function closeMessageModal() {
  showMessageModal.value = false;
  messageModalTitle.value = "";
  messageModalContent.value = "";
}

// ===== Web Audio API for Volume Meter =====
function startVolumeMeter(stream) {
  if (audioContext) { // 기존 컨텍스트가 있으면 닫기
    audioContext.close().catch(e => console.error("Error closing existing audio context:", e));
  }
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
    volume.value = Math.min(100, Math.round((avg / 255) * 100)); // 0-100% 스케일

    animationFrameId = requestAnimationFrame(updateVolume);
  };

  updateVolume();
}

function stopVolumeMeter() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  if (audioContext) {
    audioContext.close().then(() => {
        audioContext = null;
        analyser = null;
        dataArray = null;
    }).catch(e => console.error("Error closing audio context:", e));
  }
  volume.value = 0;
}

// ===== Google Speech-to-Text API 호출 (백엔드 프록시를 통해) =====
async function sendToSpeechAPI(audioBlob) {
  // `String.fromCharCode(...new Uint8Array(arrayBuffer))` 대신
  // App.vue에 있는 blobToBase64 헬퍼 함수를 사용하여 Base64로 안전하게 변환
  const base64Audio = await blobToBase64(audioBlob);

  try {
    const res = await fetch('http://localhost:3001/api/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audio: base64Audio }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`STT API error: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
    if (data.transcription) {
      return data.transcription;
    } else {
      console.warn('STT API response missing transcription:', data);
      return '변환된 텍스트가 없습니다.';
    }
  } catch (error) {
    console.error('sendToSpeechAPI 호출 실패:', error);
    throw error; // 에러를 다시 던져서 상위 호출자에서 처리하도록 함
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
  width: 200px; /* 초기 원형 버튼 크기 */
  height: 200px; /* 초기 원형 버튼 크기 */
  border: 1px solid #ccc;
  border-radius: 50%; /* 초기 원형 */
  background-color: #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: center; /* 초기에는 내부 아이콘 중앙 정렬 */
  cursor: pointer;
  transition: all 0.3s ease; /* 모든 속성에 애니메이션 */
  padding: 0;
  z-index: 10;
  overflow: hidden; /* 내부 요소가 넘치지 않도록 */
}

/* 붉은 아이콘: 초기엔 원형, 녹음 중엔 사각형, 팝업 활성화 시 왼쪽으로 이동하는 사각형 */
.record-button .icon {
  width: 80px; /* 초기 원형 아이콘 크기 */
  height: 80px; /* 초기 원형 아이콘 크기 */
  background-color: #ff1744;
  border-radius: 50%; /* 초기 원형 */
  transition: all 0.3s ease; /* 모든 속성에 애니메이션 */
  flex-shrink: 0; /* flex 컨테이너 안에서 줄어들지 않도록 */
  position: relative; /* transform 적용을 위해 */
  left: 0; /* 초기 위치 */
  margin-left: 0; /* 초기 마진 없음 */
}

/* 녹음 중일 때의 아이콘 (작은 붉은 사각형) */
.record-button .icon.is-recording {
  border-radius: 16px; /* 사각형 */
  width: 60px;
  height: 60px;
  background-color: #d50000;
}

/* record-button 자체가 팝업 형태로 확장될 때 */
.record-button.options-active {
  /* --- 팝업 크기 및 비율 조절 --- */
  width: 70vw; /* 뷰포트 너비의 70% */
  height: 35vh; /* 뷰포트 높이의 35% */
  max-width: 900px; /* 최대 너비 제한 */
  max-height: 450px; /* 최대 높이 제한 */
  border-radius: 16px; /* 둥근 사각형 */
  background-color: #f0f0f0; /* 배경색 변경 */
  justify-content: flex-start; /* 아이콘을 왼쪽으로 정렬 */
  padding: 0;
}

/* 팝업 활성화 시 붉은 아이콘의 최종 상태 (사각형 + 왼쪽 이동) */
.record-button.options-active .icon.shifted-active {
  border-radius: 16px; /* 사각형 */
  width: 100px; /* 이미지에 맞게 크기 유지 */
  height: 100px; /* 이미지에 맞게 크기 유지 */
  background-color: #ff1744; /* 이미지처럼 다시 밝은 붉은색 */
  margin-left: 25px; /* 이미지처럼 왼쪽 여백 */
}

/* 팝업 내용 컨테이너 (오른쪽에 나타날 요소) */
.options-container {
  display: flex;
  flex-direction: column;
  gap: 15px; /* 버튼 간 간격 */
  flex-grow: 1; /* 남은 공간 모두 차지 */
  align-items: center; /* 버튼 수평 중앙 정렬 */
  justify-content: center; /* 버튼 수직 중앙 정렬 */
  padding: 20px; /* 컨테이너 내부 패딩 */
  opacity: 0; /* 초기에는 숨김 */
  transform: translateX(20px); /* 오른쪽에서 나타나는 애니메이션 시작점 */
  transition: opacity 0.3s ease 0.1s, transform 0.3s ease 0.1s; /* 지연 후 나타남 */
  z-index: 11; /* record-button 내 다른 요소보다 위 */
}

/* 팝업 활성화 시 options-container 나타남 */
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

/* 팝업 배경을 어둡게 하는 오버레이 */
.dim-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.4);
  z-index: 5; /* record-button 보다 아래에 */
  transition: opacity 0.3s ease;
}

/* 옵션 버튼 스타일 */
.option-button {
  width: 90%; /* 컨테이너 내에서 너비 조정 */
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

/* Filename Input Modal Styles */
.filename-prompt-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  z-index: 20; /* Overlays everything else */
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

/* Custom Message Modal */
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
  z-index: 30; /* Ensure it's on top of other modals */
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
</style>
