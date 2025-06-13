<template>
  <div class="meeting-list">
    <h2>지난 회의 목록</h2>

    <div
      v-for="meeting in meetings"
      :key="meeting.id"
      class="meeting-item"
    >
      <div class="meeting-info">
        <h3>{{ meeting.title }}</h3>
        <p>{{ meeting.date }}</p>
      </div>

      <!-- 오디오 플레이어 -->
      <audio
        v-if="meeting.audioUrl"
        :src="meeting.audioUrl"
        controls
        class="audio-player"
      ></audio>

      <!-- 다운로드 버튼 -->
      <a
        v-if="meeting.audioUrl"
        :href="meeting.audioUrl"
        :download="getFileName(meeting)"
        class="download-button"
      >
        다운로드
      </a>
    </div>
    <p v-if="meetings.length === 0" class="no-meetings-message">저장된 지난 회의가 없습니다.</p>
  </div>
</template>

<script>
export default {
  name: "PastMeetingList",
  props: {
    recordings: { // App.vue에서 전달받을 recordings prop
      type: Array,
      default: () => []
    }
  },
  data() {
    return {
      meetings: [], // recordings prop을 기반으로 생성될 회의 목록
    };
  },
  watch: {
    recordings: {
      immediate: true, // 컴포넌트 마운트 시 즉시 실행
      handler(newRecordings) {
        // 최신순으로 정렬
        const sortedRecordings = [...newRecordings].sort((a, b) => {
          return new Date(b.timestamp) - new Date(a.timestamp); // 내림차순 정렬 (최신이 위로)
        });

        this.meetings = sortedRecordings.map((rec, index) => {
          const audioUrl = rec.audioBlob ? URL.createObjectURL(rec.audioBlob) : null;
          const date = new Date(rec.timestamp);
          return {
            id: rec.timestamp + '_' + index, // 고유한 ID 생성
            title: rec.filename || `회의 녹음본 ${date.toLocaleString()}`, // 파일명이 있으면 파일명 사용, 없으면 기존 방식 사용
            date: date.toLocaleString(),
            audioUrl: audioUrl,
            originalTimestamp: rec.timestamp, // 파일 이름 생성을 위해 원본 타임스탬프 저장
            audioBlob: rec.audioBlob // 필요시 Blob 자체도 보관 (여기서는 audioUrl만 사용해도 됨)
          };
        });
      }
    }
  },
  methods: {
    getFileName(meeting) {
      // 다운로드 시 사용할 파일 이름 생성 (기본적으로는 title 사용, 없으면 timestamp 기반)
      const baseName = meeting.title.replace(/[\\/:*?"<>|]/g, '_'); // 파일명으로 사용할 수 없는 문자 제거
      return `${baseName}.webm`; // webm 확장자 사용
    },
  },
  // 컴포넌트가 언마운트될 때 생성된 Blob URL 해제
  beforeUnmount() {
    this.meetings.forEach(meeting => {
      if (meeting.audioUrl) {
        URL.revokeObjectURL(meeting.audioUrl);
      }
    });
  }
};
</script>

<style scoped>
.meeting-list {
  padding: 20px;
  max-width: 800px;
  margin: 20px auto;
  background-color: #f9f9f9;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
h2 {
  text-align: center;
  color: #333;
  margin-bottom: 30px;
  font-size: 2em;
}
.meeting-item {
  margin-bottom: 20px;
  padding: 15px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background-color: #fff;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
.meeting-info h3 {
  margin: 0 0 5px 0;
  color: #007bff;
  font-size: 1.5em;
}
.meeting-info p {
  margin: 0;
  color: #666;
  font-size: 0.9em;
}
.audio-player {
  width: 100%;
  margin-top: 10px;
}
.download-button {
  align-self: flex-start; /* 버튼을 왼쪽으로 정렬 */
  background-color: #28a745; /* 다운로드 버튼 색상 변경 */
  color: white;
  padding: 8px 16px;
  text-decoration: none;
  border-radius: 5px;
  font-size: 0.9em;
  transition: background-color 0.2s ease;
}
.download-button:hover {
  background-color: #218838;
}
.no-meetings-message {
  text-align: center;
  color: #999;
  font-size: 1.1em;
  padding: 50px 0;
}
</style>
