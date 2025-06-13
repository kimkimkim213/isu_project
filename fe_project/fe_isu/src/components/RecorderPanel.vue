<template>
  <div class="recorder">
    <button
      :class="['record-button', { recording: isRecording, 'options-active': showOptions }]"
      @click="handleRecordButtonClick"
    >
      <span
        :class="['icon', { 'is-recording': isRecording, 'shifted-active': showOptions }]"
        @click.stop="handleIconClick"
      ></span>

      <div v-if="showOptions" class="options-container">
        <button class="option-button" @click.stop="saveAndStopRecording">
          녹음본 저장하고 종료하기
        </button>
        <button class="option-button" @click.stop="discardAndStopRecording">
          녹음본 저장하지 않고 종료하기
        </button>
      </div>
    </button>

    <p v-if="isRecording && !showOptions" class="recording-status-text">녹음중...</p>

    <!-- ✅ 실시간 볼륨 바 -->
    <div v-if="isRecording && !showOptions" class="volume-bar-container">
      <div class="volume-bar" :style="{ width: volume + '%' }"></div>
    </div>

    <div v-if="showOptions" class="dim-overlay" @click="cancelOptions"></div>
  </div>
</template>

<script setup>
import { ref } from "vue";

const isRecording = ref(false);
const mediaRecorder = ref(null);
const audioChunks = ref([]);
const emit = defineEmits(["recording-finished"]);

const showOptions = ref(false);
const volume = ref(0);

let currentStream = null;
let analyser = null;
let dataArray = null;
let audioContext = null;
let animationFrameId = null;

function handleIconClick() {
  if (showOptions.value) {
    cancelOptions();
  } else {
    toggleRecording();
  }
}

function handleRecordButtonClick() {
  if (!showOptions.value) {
    toggleRecording();
  }
}

async function toggleRecording() {
  if (showOptions.value) return;

  if (!isRecording.value) {
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startVolumeMeter(currentStream); // ✅ 볼륨 측정 시작

      mediaRecorder.value = new MediaRecorder(currentStream);
      mediaRecorder.value.ondataavailable = (event) => {
        console.log("ondataavailable fired:", event.data);
        audioChunks.value.push(event.data);
      };

      mediaRecorder.value.onstop = () => {
        if (currentStream) {
          currentStream.getTracks().forEach((track) => track.stop());
          currentStream = null;
        }
      };

      mediaRecorder.value.start(100);
      isRecording.value = true;
      console.log("녹음 시작됨");
    } catch (error) {
      console.error("마이크 접근 오류:", error);
      alert("마이크 접근 권한이 필요합니다.");
    }
  } else {
    showOptions.value = true;
    console.log("녹음 중지 옵션 표시");
  }
}

function saveAndStopRecording() {
  if (mediaRecorder.value && mediaRecorder.value.state === "recording") {
    mediaRecorder.value.stop();
    stopVolumeMeter(); // ✅ 측정 종료

    console.log("Audio chunks collected:", audioChunks.value);
    if (audioChunks.value.length === 0) {
      alert("녹음된 데이터가 없습니다.");
      resetRecordingState();
      return;
    }

    const audioBlob = new Blob(audioChunks.value, { type: "audio/webm" });
    if (audioBlob.size === 0) {
      alert("녹음 파일이 비어 있습니다.");
      resetRecordingState();
      return;
    }

    const audioUrl = URL.createObjectURL(audioBlob);
    emit("recording-finished", { audioUrl, audioBlob });
    audioChunks.value = [];
    console.log("녹음본 저장 및 종료");
  } else {
    console.warn("녹음 중이 아니므로 저장할 수 없습니다.");
  }
  resetRecordingState();
}

function discardAndStopRecording() {
  if (mediaRecorder.value && mediaRecorder.value.state === "recording") {
    mediaRecorder.value.stop();
    audioChunks.value = [];
    stopVolumeMeter(); // ✅ 측정 종료
    console.log("녹음본 저장하지 않고 종료");
  } else {
    console.warn("녹음 중이 아니므로 버릴 녹음본이 없습니다.");
  }
  resetRecordingState();
}

function cancelOptions() {
  showOptions.value = false;
  console.log("녹음 중지 취소, 녹음 계속");
}

function resetRecordingState() {
  isRecording.value = false;
  showOptions.value = false;
  volume.value = 0;
}

function startVolumeMeter(stream) {
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
    volume.value = Math.min(100, Math.round((avg / 255) * 100));
    animationFrameId = requestAnimationFrame(updateVolume);
  };

  updateVolume();
}

function stopVolumeMeter() {
  cancelAnimationFrame(animationFrameId);
  if (audioContext) {
    audioContext.close();
    audioContext = null;
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
</style>
