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
    <!--각종 메시지 팝업 시 배경 어둡게-->
    <div
      v-if="showOptions || showFilenamePrompt || showMessageModal || isTranscribing"
      class="dim-overlay"
      @click="handleOverlayClick"
    ></div>

    <!-- 파일명 입력 -->
    <div v-if="showFilenamePrompt" class="filename-prompt-modal">
      <h3>저장할 파일 이름을 입력해주세요.</h3>
      <input
        type="text"
        v-model="filenameInput"
        placeholder="예: 2024년 6월 대화록"
        class="filename-input"
        @keyup.enter="confirmSaveRecording"
      />
      <div class="prompt-buttons">
        <button class="prompt-button save" @click="confirmSaveRecording">저장</button>
        <button class="prompt-button cancel" @click="cancelFilenamePrompt">취소</button>
      </div>
    </div>

    <!-- 인라인 MessageModal -->
    <div v-if="showMessageModal" class="message-modal-overlay">
      <div class="message-modal-content">
        <h3>{{ messageModalTitle }}</h3>
        <p>{{ messageModalContent }}</p>
        <div class="modal-buttons">
          <button @click="closeMessageModal" class="close">확인</button>
        </div>
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
import { ref } from 'vue';
import { useAudioMeter } from '@/conposable';

const showFilenamePrompt = ref(false);
const filenameInput = ref("");
const isRecording = ref(false);
const mediaRecorder = ref(null);
const audioChunks = ref([]);
const emit = defineEmits(["recording-finished"]);

const showOptions = ref(false);
const isTranscribing = ref(false); // 텍스트 변환 중 상태
const currentMimeType = ref(''); 
const currentSampleRate = ref(0);

let currentStream = null;
const { volume, start: startVolumeMeter, stop: stopVolumeMeter, getSampleRate } = useAudioMeter();

function handleIconClick() {
  console.debug('handleIconClick invoked');
  if (showMessageModal.value || isTranscribing.value) return; // 메시지/변환 모달이 떠있으면 다른 동작 방지

  if (showFilenamePrompt.value) {
    // 파일명 팝업 열림 → 취소
    cancelFilenamePrompt();
  } else if (showOptions.value) {
    // 옵션 팝업 열림 → 취소
    cancelOptions();
  } else {
    // 팝업 없음 → 녹음 토글
    toggleRecording();
  }
}

function handleRecordButtonClick() {
  console.debug('handleRecordButtonClick');
  if (showMessageModal.value || isTranscribing.value) return; // 메시지/변환 모달이 떠있으면 다른 동작 방지

  if (!showOptions.value && !showFilenamePrompt.value) {
    toggleRecording();
  }
  
}

function handleOverlayClick() {
  console.debug('handleOverlayClick');
  if (showMessageModal.value) {
    closeMessageModal();
  } else if (isTranscribing.value) {
    return; // 변환 중에는 오버레이로 닫지 않음
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
    console.debug('녹음 시작 로직 진입');
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
  startVolumeMeter(currentStream);
  console.debug('startVolumeMeter called');
  currentSampleRate.value = getSampleRate() || currentSampleRate.value;

  // MediaRecorder 생성 전, 지원되는 MIME 타입 확인
      const supportedMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      currentMimeType.value = supportedMimeType; // 실제 MIME 타입 저장
      console.log('Supported MIME Type for MediaRecorder:', currentMimeType.value);

      // 미디어 레코더 옵션 지정
      mediaRecorder.value = new MediaRecorder(currentStream, {
        mimeType: currentMimeType.value, // 감지된 지원 타입 사용
        audioBitsPerSecond: 64000 // 오디오 비트레이트를 명시적으로 64kbps로 설정 (더 안정적)
      });

      mediaRecorder.value.ondataavailable = (event) => {
  // 녹음 데이터 청크가 들어올 때마다 크기를 로그
        console.log('Audio chunk received. Size:', event.data.size, 'bytes');
        if (event.data.size > 0) { // 빈 청크는 무시
          audioChunks.value.push(event.data);
        }
      };

      mediaRecorder.value.onstop = () => {
  // 트랙 중지
        if (currentStream) {
          currentStream.getTracks().forEach((track) => track.stop());
          currentStream = null;
        }
  stopVolumeMeter(); // 녹음 중지 시 볼륨 미터 중지
        console.log('MediaRecorder stopped. Total chunks collected:', audioChunks.value.length);
        const finalBlob = new Blob(audioChunks.value, { type: supportedMimeType }); // 최종 Blob 타입도 supportedMimeType 사용
        console.log('Final Audio Blob size on stop:', finalBlob.size, 'bytes');

        if (showOptions.value) { // 저장하고 종료하기
          if (audioChunks.value.length === 0) {
              console.error("ERROR: No audio chunks were collected after stop! 녹음된 데이터가 없습니다.");
              displayMessageModal("녹음 오류", "녹음된 데이터가 없습니다. 마이크가 제대로 작동하는지 확인해주세요.");
              resetRecordingState();
              return;
          }
          // 기본 파일명 설정
          filenameInput.value = `대화록_${new Date()
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
            .replace(/\.$/, "")}`;
          showFilenamePrompt.value = true;
          showOptions.value = false; // 옵션 팝업 숨김
        } else {
          audioChunks.value = []; // 데이터 버림
          console.log("녹음본 저장하지 않고 종료");
          displayMessageModal("녹음 삭제", "녹음본이 저장되지 않고 삭제되었습니다.");
          resetRecordingState();
        }
      };

      mediaRecorder.value.start();
      isRecording.value = true;
      console.log("녹음 시작됨");
    } catch (error) {
      console.error("마이크 접근 오류:", error);
      displayMessageModal(
        "마이크 접근 오류",
        "마이크 접근 권한 필요"
      );
      resetRecordingState(); // 오류 시 상태 초기화
    }
  } else {
    showOptions.value = true;
    console.log("녹음 중지 옵션 표시");
  }
}

// "녹음본 저장하고 종료하기" 버튼 클릭 시 호출
async function promptForSave() {
  if (mediaRecorder.value && mediaRecorder.value.state === "recording") {
    mediaRecorder.value.stop(); // 녹음 중지 트리거. onstop이 나중에 호출됨
    console.log("녹음 중지 트리거됨. onstop 이벤트 대기.");
  } else {
    // 녹음이 이미 중지된 상태에서 이 버튼이 눌렸다면, 바로 파일명 입력 팝업 띄우기
    if (audioChunks.value.length === 0) {
      console.error("ERROR: Cannot prompt for save. No audio chunks available.");
      displayMessageModal("저장 오류", "저장할 녹음 데이터가 없습니다. 다시 녹음해 주세요.");
      resetRecordingState();
      return;
    }
    // 기본 파일명 설정
    filenameInput.value = `대화록_${new Date()
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
      .replace(/\.$/, "")}`;
    showFilenamePrompt.value = true;
    showOptions.value = false; // 옵션 팝업 숨김
    console.log("파일명 입력 팝업 표시");
  }
}

// 파일 이름 입력 후 "저장" 버튼 클릭 시 호출
async function confirmSaveRecording() {
    // onstop에서 검사했음 — 여기도 방어적으로 검사
    if (audioChunks.value.length === 0) {
    console.error("ERROR: Cannot save. No audio chunks available at confirmSaveRecording.");
    displayMessageModal("저장 오류", "저장할 녹음 데이터가 없습니다. 다시 녹음해 주세요.");
    resetRecordingState();
    return;
  }

  const audioBlob = new Blob(audioChunks.value, { type: 'audio/webm' }); 

  if (audioBlob.size === 0) {
    console.error("Blob 크기 0");
    displayMessageModal(
      "저장 오류",
      "녹음 파일 비어 있음"
    );
    resetRecordingState();
    return;
  }
  console.log('Sending Blob of size:', audioBlob.size, 'bytes to backend for transcription.');


  // 파일명 확정
  const filename = filenameInput.value.trim() || `대화록_${new Date().toLocaleString("ko-KR").replace(/[:.]/g, "-")}`;

  // 텍스트 변환 상태 표시
  isTranscribing.value = true;
  showFilenamePrompt.value = false; // 파일명 입력 팝업 닫기
  
  let transcription = '';
  try {
    transcription = await sendToSpeechAPI(audioBlob);// STT API 호출
    console.log("전사 결과:", transcription);
    displayMessageModal('텍스트 변환 완료');
  } catch (error) {
    console.error('텍스트 변환 오류:', error);
    displayMessageModal('음성 텍스트 변환 중 오류');
    transcription = '텍스트 변환 실패: ' + (error.message || '알 수 없는 오류');
  } finally {
    isTranscribing.value = false; // 성공 여부 관계없이 변환 상태 해제
  }

  // App.vue로 Blob 데이터, 파일명, 전사 결과 전달
  emit('recording-finished', { audioBlob, filename, transcription }); 
  console.log(`녹음본 "${filename}" 저장 및 종료`);
  resetRecordingState(); // 상태 초기화
}

// 팝업 - "녹음본 저장하지 않고 종료하기" (또는 파일명 입력 취소 시)
function discardAndStopRecording() {
  if (mediaRecorder.value && mediaRecorder.value.state === "recording") {
    mediaRecorder.value.stop(); // 녹음 중지
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
  mediaRecorder.value = null; // Recorder 객체도 리셋하여 새 녹음 준비
  stopVolumeMeter(); // 볼륨 미터 중지
}

// Custom Message Modal (for errors/information) implemented via MessageModal component
const showMessageModal = ref(false);
const messageModalTitle = ref('');
const messageModalContent = ref('');

function displayMessageModal(title, content) {
  messageModalTitle.value = title;
  messageModalContent.value = content;
  showMessageModal.value = true;
}

function closeMessageModal() {
  showMessageModal.value = false;
  messageModalTitle.value = '';
  messageModalContent.value = '';
}

// STT API 호출
async function sendToSpeechAPI(audioBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); // Blob을 Base64로 변환
    console.log('sendToSpeechAPI - Blob size:', audioBlob && audioBlob.size);
    
    reader.onload = async () => {
      const base64DataUrl = reader.result;
      const base64Audio = base64DataUrl.split(',')[1];
      console.log('base64 길이:', base64Audio ? base64Audio.length : 0);
      console.log('전송 정보 - sampleRate:', currentSampleRate.value, 'mimeType:', currentMimeType.value);
      
      try {
        const res = await fetch('http://localhost:3001/api/transcribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            audio: base64Audio,
            sampleRate: currentSampleRate.value,
            mimeType: currentMimeType.value 
          }),
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`STT API error: ${res.status} - ${errorText}`);
        }

        const data = await res.json();
        if (data.transcription) {
          resolve(data.transcription);
        } else {
          console.warn('STT API response missing transcription:', data);
          // 빈 텍스트를 반환할 경우
          resolve('변환된 텍스트가 없습니다.'); 
        }
      } catch (error) {
        console.error('sendToSpeechAPI 호출 실패:', error);
        // 네트워크 또는 서버 오류일 경우
        reject(error);
      }
    };

    reader.onerror = (error) => {
      console.error("FileReader 오류:", error);
      reject(error);
    };

    reader.readAsDataURL(audioBlob);
  });
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
  transition: all 0.3s ease; /* 모든 속성에 애니메이션 */
  padding: 0;
  z-index: 10;
  overflow: hidden; 
}

/* 초기 원형-녹음 중 사각형, 팝업 활성화 시 애니메이션 */
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

/* 녹음 진행중 녹음버튼 상태 */
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

/* 애니매이션 진행 후 붉은 아이콘의 최종 상태 */
.record-button.options-active .icon.shifted-active {
  border-radius: 16px; 
  width: 100px;
  height: 100px; 
  background-color: #ff1744;
  margin-left: 25px;
}



.options-container { /*애니매이션이 포함된 녹음버튼 팝업*/
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

/* 팝업 활성화 시 옵션 컨테이너 나타남 */
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
  z-index: 5;
  transition: opacity 0.3s ease;
}

/* 옵션 버튼 */
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

/*파일명 입력 팝업 */
.filename-prompt-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  z-index: 20; /* 맨 뒤에 배치 */
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

/* 로딩중 화면 */
.transcribing-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7); /* 배경 어둡게 */
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
.transcribing-modal-content {
  background-color: #222;
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
