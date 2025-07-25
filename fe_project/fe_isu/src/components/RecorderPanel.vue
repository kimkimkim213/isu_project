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
import { onMounted } from 'vue';

// ...existing code...

// Helper function to generate a unique ID
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
function base64ToBlob(base64, mimeType) {
  if (!base64 || typeof base64 !== 'string') {
    console.error('Invalid base64 string provided to base64ToBlob:', base64);
    return null;
  }
  const parts = base64.split(';base64,');
  if (parts.length < 2) {
    console.error('Base64 string format is incorrect:', base64);
    return null;
  }
  const contentType = parts[0].split(':')[1] || mimeType;
  try {
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  } catch (e) {
    console.error('Error decoding base64 to blob:', e, base64);
    return null;
  }
}

const showFilenamePrompt = ref(false);
const filenameInput = ref("");
const isRecording = ref(false);
const mediaRecorder = ref(null);
const audioChunks = ref([]);
const emit = defineEmits(["recording-finished"]);

const showOptions = ref(false);
const volume = ref(0);
const isTranscribing = ref(false); // 텍스트 변환 중 상태
const currentMimeType = ref(''); // 녹음에 사용된 MIME 타입 저장
const currentSampleRate = ref(0); // 녹음에 사용된 샘플링 레이트 저장

let currentStream = null;
let analyser = null;
let dataArray = null;
let audioContext = null;
let animationFrameId = null;

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
      
      // Web Audio API를 사용해 정확한 샘플링 레이트를 얻습니다.
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      currentSampleRate.value = audioContext.sampleRate; // 실제 샘플링 레이트 저장
      console.log('AudioContext Sample Rate:', currentSampleRate.value);
      startVolumeMeter(currentStream, audioContext); // audioContext를 넘겨주도록 수정

      // MediaRecorder 생성 전, 지원되는 MIME 타입 확인 (디버깅)
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
        // 모든 트랙 중지 (마이크 아이콘 끄기)
        if (currentStream) {
          currentStream.getTracks().forEach((track) => track.stop());
          currentStream = null;
        }
        stopVolumeMeter(); // 녹음 중지 시 볼륨 미터 중지
        console.log('MediaRecorder stopped. Total chunks collected:', audioChunks.value.length);
        const finalBlob = new Blob(audioChunks.value, { type: supportedMimeType }); // 최종 Blob 타입도 supportedMimeType 사용
        console.log('Final Audio Blob size on stop:', finalBlob.size, 'bytes');

        // 이 부분이 핵심 변경: onstop이 완료된 후에만 파일명 프롬프트/저장 로직이 진행되도록 여기서 처리
        if (showOptions.value) { // "저장하고 종료하기" 옵션을 선택한 경우
          if (audioChunks.value.length === 0) {
              console.error("ERROR: No audio chunks were collected after stop! 녹음된 데이터가 없습니다.");
              displayMessageModal("녹음 오류", "녹음된 데이터가 없습니다. 마이크가 제대로 작동하는지 확인해주세요.");
              resetRecordingState();
              return;
          }
          // 기본 파일명 설정
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
            .replace(/\.$/, "")}`;
          showFilenamePrompt.value = true;
          showOptions.value = false; // 옵션 팝업 숨김
        } else { 
            // "저장하지 않고 종료하기" 옵션을 선택했거나 다른 방식으로 녹음이 중지된 경우
            // 이 경우는 discardAndStopRecording()에서 이미 처리가 되므로,
            // 추가적인 동작 없이 resetRecordingState()만 호출되도록 합니다.
            // discardAndStopRecording()이 이미 resetRecordingState()를 호출하므로 중복 방지.
        }
      };

      mediaRecorder.value.start();
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
  if (mediaRecorder.value && mediaRecorder.value.state === "recording") {
    mediaRecorder.value.stop(); // 녹음 중지 트리거. onstop이 나중에 호출됨
    console.log("녹음 중지 트리거됨. onstop 이벤트 대기.");
  }
  // 이전의 audioChunks.value.length === 0 검사는 여기서 제거했습니다.
  // 이 검사는 onstop 콜백에서 이루어져야 합니다.
}

// 파일 이름 입력 후 "저장" 버튼 클릭 시 호출
async function confirmSaveRecording() {
  // onstop 이벤트에서 이미 audioChunks 유효성 검사를 했지만, 안전을 위해 여기서도 한번 더 확인
  if (audioChunks.value.length === 0) {
    console.error("ERROR: Cannot save. No audio chunks available at confirmSaveRecording.");
    displayMessageModal("저장 오류", "저장할 녹음 데이터가 없습니다. 다시 녹음해 주세요.");
    resetRecordingState();
    return;
  }

  const audioBlob = new Blob(audioChunks.value, { type: 'audio/webm' }); 

  if (audioBlob.size === 0) {
    console.error("ERROR: Generated audio Blob is empty! Blob 크기가 0입니다.");
    displayMessageModal(
      "저장 오류",
      "녹음 파일이 비어 있습니다. 마이크 입력이 없었을 수 있습니다."
    );
    resetRecordingState();
    return;
  }
  console.log('Sending Blob of size:', audioBlob.size, 'bytes to backend for transcription.');


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

// Custom Message Modal (for errors/information) - replacing alert)
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
function startVolumeMeter(stream, context) { // context 인자 추가
  if (!context) return;
  audioContext = context; // 전달받은 context 사용
  
  // 실제 오디오 컨텍스트의 샘플 레이트 로그
  console.log('AudioContext Sample Rate:', audioContext.sampleRate); 

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
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async () => {
      const base64DataUrl = reader.result;
      const base64Audio = base64DataUrl.split(',')[1];

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
          // 빈 텍스트를 반환할 경우 '변환된 텍스트가 없습니다.' 메시지로 처리
          resolve('변환된 텍스트가 없습니다.'); 
        }
      } catch (error) {
        console.error('sendToSpeechAPI 호출 실패:', error);
        // 네트워크 또는 서버 오류일 경우 상세 메시지 포함
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

// 기존의 저장된 녹음 목록 불러오기 (로컬 스토리지 등에서)
const storedRecordings = ref([]); // 여기에 저장된 녹음 데이터 배열이 들어옵니다.

// recordings 배열: 저장된 녹음 목록
const recordings = ref([]);

// 저장된 녹음 불러오기 함수
function loadStoredRecordings() {
  // 여기서는 예시로 로컬 스토리지에서 불러온다고 가정합니다.
  const stored = localStorage.getItem('recordings');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      storedRecordings.value = parsed;
      // parsed 배열을 recordings 배열에 추가
      parsed.forEach(item => {
        if (item.audioBase64 && item.audioType) {
          const blob = base64ToBlob(item.audioBase64, item.audioType);
          if (blob) {
            recordings.value.push({
              id: item.id || generateUniqueId(),
              timestamp: item.timestamp,
              audioBlob: blob,
              filename: item.filename,
              transcription: item.transcription // 추가
            });
          }
        }
      });
      console.log('Stored recordings loaded:', recordings.value);
    } catch (error) {
      console.error('Error loading stored recordings:', error);
    }
  }
}

// 컴포넌트가 마운트될 때 저장된 녹음 불러오기
onMounted(() => {
  loadStoredRecordings();
});
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
  width: 70vw;   /* 뷰포트 너비의 70% */
  height: 35vh;  /* 뷰포트 높이의 35% */
  max-width: 900px; /* 최대 너비 제한 */
  max-height: 450px; /* 최대 높이 제한 */
  border-radius: 16px; /* 둥근 사각형 */
  background-color: #f0f0f0; /* 배경색 변경 */
  justify-content: flex-start; /* 아이콘을 왼쪽으로 정렬 */
  padding: 0;
  z-index: 10;
  overflow: hidden; /* 내부 요소가 넘치지 않도록 */
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

/* Transcription Loading Modal Styles */
.transcribing-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7); /* 더 어두운 오버레이 */
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40; /* 가장 위에 표시 */
}

.transcribing-modal-content {
  background-color: #222; /* 어두운 배경색 */
  color: #fff; /* 흰색 텍스트 */
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
