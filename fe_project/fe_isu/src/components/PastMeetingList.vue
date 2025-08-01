<template>
  <div class="meeting-list">
    <h2>지난 회의 목록</h2>

    <div
      v-for="meeting in meetings"
      :key="meeting.id"
      class="meeting-item"
    >
      <div class="meeting-info">
        <!-- 수정 모드일 때 입력 필드, 아닐 때 제목 표시 -->
        <input
          v-if="editingMeetingId === meeting.id"
          type="text"
          v-model="editedFilename"
          @keyup.enter="saveEditedFilename(meeting.id)"
          @blur="saveEditedFilename(meeting.id)"
          class="filename-edit-input"
        />
        <!-- 제목을 클릭하면 수정 모드로 진입 -->
        <div v-else @click="startEditingFilename(meeting)" class="editable-title-area">
          <h3>{{ meeting.title }}</h3>
          <p>{{ meeting.date }}</p>
        </div>
      </div>

      <!-- 오디오 플레이어 -->
      <audio
        v-if="meeting.audioUrl"
        :src="meeting.audioUrl"
        controls
        class="audio-player"
      ></audio>

      <div class="meeting-actions">
        <!-- 오디오 다운로드 버튼 -->
        <a
          v-if="meeting.audioUrl"
          :href="meeting.audioUrl"
          :download="getAudioFileName(meeting)"
          class="action-button download"
        >
          녹음 파일 다운로드
        </a>
        <!-- 텍스트 미리보기 버튼 -->
        <button
          class="action-button text-preview"
          @click="previewTranscription(meeting)"
        >
          텍스트
        </button>
        <!-- 삭제 버튼 -->
        <button
          class="action-button delete"
          @click="confirmDeleteMeeting(meeting.id, meeting.title)"
        >
          삭제
        </button>
      </div>
    </div>
    <p v-if="meetings.length === 0" class="no-meetings-message">저장된 지난 회의가 없습니다.</p>

    <!-- Custom Message Modal (삭제 확인, 정보 메시지 등) -->
    <div v-if="showMessageModal" class="message-modal-overlay">
      <div class="message-modal-content">
        <h3>{{ messageModalTitle }}</h3>
        <p>{{ messageModalContent }}</p>
        <div class="modal-buttons" v-if="messageModalType === 'confirmDelete'">
            <button @click="executeDeleteMeeting" class="confirm-button">삭제</button>
            <button @click="closeMessageModal" class="cancel-button">취소</button>
        </div>
        <button v-else @click="closeMessageModal" class="ok-button">확인</button>
      </div>
    </div>

    <!-- Transcription Preview Modal -->
    <div v-if="showTranscriptionModal" class="transcription-modal-overlay">
      <div class="transcription-modal-content">
        <h3>전사본 미리보기</h3>
        <div class="transcription-text-area">
          <p>{{ currentTranscriptionText }}</p>
        </div>
        <div class="modal-buttons">
          <button class="prompt-button download" @click="downloadTranscriptionAsFile">
            파일로 다운로드 (.txt)
          </button>
          <button class = "prompt-button">
            요약본으로 정리
          </button>
          <button class="prompt-button cancel" @click="closeTranscriptionModal">
            닫기
          </button>
        </div>
      </div>
    </div>
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
  emits: ['delete-recording', 'update-recording-filename'], // 삭제 및 이름 수정 이벤트 추가

  data() {
    return {
      meetings: [], // recordings prop을 기반으로 생성될 회의 목록
      editingMeetingId: null, // 현재 수정 중인 회의의 ID
      editedFilename: '', // 수정 중인 파일명
      
      // Custom Message Modal 상태
      showMessageModal: false,
      messageModalTitle: '',
      messageModalContent: '',
      messageModalType: '', // 'info' or 'confirmDelete'
      pendingDeleteId: null, // 삭제 대기 중인 항목의 ID

      // Transcription Preview Modal 상태
      showTranscriptionModal: false,
      currentTranscriptionText: '',
      currentTranscriptionFilename: '', // 다운로드 시 사용할 파일명
    };
  },
  watch: {
    recordings: {
      immediate: true, // 컴포넌트 마운트 시 즉시 실행
      handler(newRecordings) {
        // 수정된 부분: 'newRecords'를 'newRecordings'로 변경
        console.log("PastMeetingList: recordings prop 변경 감지. 새로운 녹음본:", newRecordings); // Debug log 1

        // 최신순으로 정렬
        const sortedRecordings = [...newRecordings].sort((a, b) => {
          return new Date(b.timestamp) - new Date(a.timestamp); // 내림차순 정렬 (최신이 위로)
        });

        this.meetings = sortedRecordings.map((rec) => {
          const audioUrl = rec.audioBlob ? URL.createObjectURL(rec.audioBlob) : null;
          const date = new Date(rec.timestamp);
          const meetingItem = { // 새로 생성될 meeting 객체
            id: rec.id, // App.vue에서 전달받은 고유 ID 사용
            title: rec.filename || `회의 녹음본 ${date.toLocaleString()}`, // 파일명이 있으면 파일명 사용, 없으면 기존 방식 사용
            date: date.toLocaleString(),
            audioUrl: audioUrl,
            originalTimestamp: rec.timestamp, // 파일 이름 생성을 위해 원본 타임스탬프 저장
            audioBlob: rec.audioBlob, // 필요시 Blob 자체도 보관 (여기서는 audioUrl만 사용해도 됨)
            transcription: rec.transcription || '텍스트 변환 결과 없음' // 텍스트 변환 결과도 추가
          };
          console.log(`PastMeetingList: 매핑된 회의 항목 (ID: ${meetingItem.id}), 전사본: '${meetingItem.transcription}'`); // Debug log 2
          return meetingItem;
        });
      }
    }
  },
  methods: {
    getAudioFileName(meeting) { // 오디오 파일명 얻기 함수 (이름 변경)
      // 다운로드 시 사용할 파일 이름 생성 (기본적으로는 title 사용, 없으면 timestamp 기반)
      const baseName = meeting.title.replace(/[\\/:*?"<>|]/g, '_'); // 파일명으로 사용할 수 없는 문자 제거
      return `${baseName}.webm`; // webm 확장자 사용
    },
    
    // 녹음본 삭제 확인 모달 표시
    confirmDeleteMeeting(id, title) {
        this.pendingDeleteId = id;
        this.displayMessageModal('녹음본 삭제', `'${title}' 녹음본을 삭제하시겠습니까?`, 'confirmDelete');
    },

    // 실제 녹음본 삭제 로직
    executeDeleteMeeting() {
        if (this.pendingDeleteId) {
            this.$emit('delete-recording', this.pendingDeleteId);
            this.closeMessageModal();
            this.displayMessageModal('삭제 완료', '녹음본이 삭제되었습니다.');
        }
    },

    // 파일명 수정 모드 시작
    startEditingFilename(meeting) {
      // 이미 수정 모드라면 다시 시작하지 않음
      if (this.editingMeetingId === meeting.id) {
        return;
      }
      this.editingMeetingId = meeting.id;
      this.editedFilename = meeting.title; // 현재 제목을 편집 필드에 로드
      this.$nextTick(() => {
        // 입력 필드에 포커스
        const input = this.$el.querySelector('.filename-edit-input');
        if (input) {
          input.focus();
          input.select(); // 텍스트 전체 선택
        }
      });
    },

    // 파일명 수정 저장
    saveEditedFilename(id) {
      // 수정 중인 항목이 아니라면 저장하지 않음 (blur 이벤트 중복 방지 등)
      if (this.editingMeetingId !== id) {
        return;
      }

      const originalMeeting = this.meetings.find(m => m.id === id);
      const originalFilename = originalMeeting ? originalMeeting.title : '';
      const newFilenameTrimmed = this.editedFilename.trim();

      if (newFilenameTrimmed === '') {
        this.displayMessageModal('이름 변경 실패', '파일 이름은 비워둘 수 없습니다.');
        // 기존 이름으로 되돌리기
        this.editedFilename = originalFilename;
        this.editingMeetingId = null; // 수정 모드 종료
        return;
      }
      
      // 파일 이름이 변경되지 않았거나 기존과 같은 경우에는 알림 팝업을 띄우지 않고 취소
      if (newFilenameTrimmed === originalFilename) {
        this.editingMeetingId = null; // 수정 모드 종료
        return; 
      }

      this.$emit('update-recording-filename', { id: id, newFilename: newFilenameTrimmed });
      this.editingMeetingId = null; // 수정 모드 종료
      this.displayMessageModal('이름 변경 완료', `녹음본 이름이 '${newFilenameTrimmed}'(으)로 변경되었습니다.`);
    },

    // 텍스트 미리보기 버튼 클릭 시
    previewTranscription(meeting) {
      console.log("PastMeetingList: previewTranscription 호출. 회의 항목:", meeting); // Debug log 3
      console.log(`PastMeetingList: 미리보기 텍스트: '${meeting.transcription}' (타입: ${typeof meeting.transcription})`); // Debug log 4

      if (!meeting.transcription || meeting.transcription === '텍스트 변환 결과 없음' || meeting.transcription.trim() === '') {
        this.displayMessageModal('텍스트 없음', '이 녹음본에 대한 변환된 텍스트가 없습니다.');
        return;
      }
      this.currentTranscriptionText = meeting.transcription;
      // 다운로드 시 사용할 파일명도 미리 저장
      this.currentTranscriptionFilename = `${meeting.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`; 
      this.showTranscriptionModal = true;
    },

    // 미리보기 모달에서 파일 다운로드 버튼 클릭 시
    downloadTranscriptionAsFile() {
      if (!this.currentTranscriptionText) {
        this.displayMessageModal('다운로드 오류', '다운로드할 텍스트 내용이 없습니다.');
        return;
      }

      const textBlob = new Blob([this.currentTranscriptionText], { type: 'text/plain;charset=utf-8' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(textBlob);
      link.download = this.currentTranscriptionFilename; // 미리 저장해둔 파일명 사용
      link.click();
      URL.revokeObjectURL(link.href); // URL 해제
      
      this.displayMessageModal('다운로드 완료', `'${this.currentTranscriptionFilename}' 텍스트 파일이 다운로드되었습니다.`);
      this.closeTranscriptionModal(); // 다운로드 후 모달 닫기
    },

    // 미리보기 모달 닫기
    closeTranscriptionModal() {
      this.showTranscriptionModal = false;
      this.currentTranscriptionText = '';
      this.currentTranscriptionFilename = '';
    },



    // Custom Message Modal (for errors/information) - replacing alert()
    displayMessageModal(title, content, type = 'info') {
      this.messageModalTitle = title;
      this.messageModalContent = content;
      this.messageModalType = type;
      this.showMessageModal = true;
    },

    closeMessageModal() {
      this.showMessageModal = false;
      this.messageModalTitle = '';
      this.messageModalContent = '';
      this.messageModalType = '';
      this.pendingDeleteId = null;
    }
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
.meeting-info {
    display: flex;
    flex-direction: column;
    gap: 5px;
}
/* 클릭 가능한 제목 영역 스타일 */
.editable-title-area {
    cursor: pointer;
    padding: 5px; /* 클릭 영역을 좀 더 넓게 */
    border-radius: 4px;
    transition: background-color 0.2s ease;
}
.editable-title-area:hover {
    background-color: #f0f0f0; /* 호버 효과 */
}

.meeting-info h3 {
  margin: 0;
  color: #000000;
  font-size: 1.5em;
}
.meeting-info p {
  margin: 0;
  color: #515151;
  font-size: 0.9em;
}
.filename-edit-input {
    width: calc(100% - 20px); /* Adjust width to fit */
    padding: 8px 10px;
    border: 1px solid #007bff;
    border-radius: 4px;
    font-size: 1.2em;
    box-sizing: border-box;
}
.audio-player {
  width: 100%;
  margin-top: 10px;
  accent-color: red; /* 재생바 색상을 빨간색으로 변경 */
}
.meeting-actions {
    display: flex;
    gap: 10px; /* 버튼 간 간격 */
    margin-top: 10px;
}
.action-button {
  background-color: #007bff; /* 기본 버튼 색상 */
  color: white;
  padding: 8px 16px;
  text-decoration: none;
  border-radius: 5px;
  font-size: 0.9em;
  transition: background-color 0.2s ease;
  border: none;
  cursor: pointer;
}
.action-button.download {
  background-color: #28a745;
}
.action-button.download:hover {
  background-color: #218838;
}
.action-button.text-preview { /* 텍스트 미리보기 버튼 스타일 추가 */
  background-color: #007bff; /* 파란색 계열 */
}
.action-button.text-preview:hover {
  background-color: #0056b3;
}
.action-button.delete {
  background-color: #dc3545;
}
.action-button.delete:hover {
  background-color: #c82333;
}
.no-meetings-message {
  text-align: center;
  color: #999;
  font-size: 1.1em;
  padding: 50px 0;
}

/* Custom Message Modal Styles - Reused from RecorderPanel for consistency */
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

.modal-buttons {
    display: flex;
    justify-content: center;
    gap: 15px;
    margin-top: 10px;
}

.modal-buttons button, .ok-button {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1.1em;
  transition: background-color 0.2s ease;
}

.ok-button {
    background-color: #007bff;
    color: white;
}
.ok-button:hover {
    background-color: #0056b3;
}
.confirm-button {
    background-color: #dc3545;
    color: white;
}
.confirm-button:hover {
    background-color: #c82333;
}
.cancel-button {
    background-color: #6c757d;
    color: white;
}
.cancel-button:hover {
    background-color: #5a6268;
}

/* Transcription Preview Modal Styles */
.transcription-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7); /* 어둡게 할 오버레이 */
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 35; /* 기존 메시지 모달보다 위에 */
}

.transcription-modal-content {
  background-color: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.5);
  max-width: 600px; /* 더 넓게 */
  width: 90%;
  max-height: 80vh; /* 높이 제한 */
  overflow-y: auto; /* 내용이 길면 스크롤 */
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.transcription-modal-content h3 {
  margin: 0;
  color: #333;
  font-size: 1.8em;
  text-align: center;
}

.transcription-text-area {
  background-color: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 20px;
  white-space: pre-wrap; /* 줄 바꿈 유지 */
  word-wrap: break-word; /* 긴 단어 강제 줄 바꿈 */
  font-size: 1.1em;
  color: #333;
  flex-grow: 1; /* 남은 공간 차지 */
  overflow-y: auto; /* 텍스트가 길어지면 스크롤 */
  min-height: 150px; /* 최소 높이 */
  max-height: 40vh; /* 최대 높이 */
}

.transcription-text-area p {
  margin: 0; /* p 태그의 기본 마진 제거 */
}

/* 미리보기 모달 내 버튼 스타일 */
.transcription-modal-content .prompt-button {
  /* prompt-button 스타일 재사용 */
  width: auto; /* 기본 prompt-button의 90% 대신 자동 너비 */
  min-width: 120px; /* 최소 너비 지정 */
}
.transcription-modal-content .prompt-button.download {
  background-color: #28a745; /* 다운로드 버튼은 녹색 */
}
.transcription-modal-content .prompt-button.download:hover {
  background-color: #218838;
}
.transcription-modal-content .prompt-button.cancel {
  background-color: #6c757d; /* 닫기 버튼은 회색 */
}
.transcription-modal-content .prompt-button.cancel:hover {
  background-color: #5a6268;
}
</style>
