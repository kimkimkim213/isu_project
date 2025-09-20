<template>
  <div class="meeting-list">
    <h2>지난 대화 목록</h2>

    <div
      v-for="meeting in meetings"
      :key="meeting.id"
      class="meeting-item"
    >
      <div class="meeting-info">
        <input
          v-if="editingMeetingId === meeting.id"
          type="text"
          v-model="editedFilename"
          @keyup.enter="saveEditedFilename(meeting.id)"
          @blur="saveEditedFilename(meeting.id)"
          class="filename-edit-input"
        />
        <!-- 제목 눌러서 파일명 수정 -->
        <div v-else @click="startEditingFilename(meeting)" class="editable-title-area">
          <h3>{{ meeting.title }}</h3>
          <p>{{ meeting.date }}</p>
        </div>
      </div>

      <!-- 재생바 -->
      <audio
        v-if="meeting.audioUrl"
        :src="meeting.audioUrl"
        controls
        class="audio-player"
      ></audio>

      <div class="meeting-actions">
        <!-- 다운로드 -->
        <a
          v-if="meeting.audioUrl"
          :href="meeting.audioUrl"
          :download="getAudioFileName(meeting)"
          class="action-button download"
        >
          녹음 파일 다운로드
        </a>
        <!--미리보기 -->
        <button
          class="action-button text-preview"
          @click="previewTranscription(meeting)"
        >
          텍스트
        </button>
        <!-- 삭제 -->
        <button
          class="action-button delete"
          @click="confirmDeleteMeeting(meeting.id, meeting.title)"
        >
          삭제
        </button>
      </div>
    </div>
    <p v-if="meetings.length === 0" class="no-meetings-message">저장된 대화가 없습니다.</p>

    <!-- 삭제 확인, 정보 메시지  -->
    <div v-if="showMessageModal" class="message-modal-overlay">
      <div class="message-modal-content">
        <h3>{{ messageModalTitle }}</h3>
        <p>{{ messageModalContent }}</p>
        <div class="modal-buttons" v-if="messageModalType === 'confirmDelete'">
            <button @click="executeDeleteMeeting" class="confirm-button"> 삭제</button>
            <button @click="closeMessageModal" class="cancel-button">취소</button>
        </div>
        <button v-else @click="closeMessageModal" class="ok-button">확인</button>
      </div>
    </div>

    
    <div v-if="showTranscriptionModal" class="transcription-modal-overlay">
      <div class="transcription-modal-content">
        <h3>{{ currentMeeting.title }}</h3>

        <div v-if="!isTextViewerVisible && !internalShowSummary" class="initial-options">
          <div class="option-box view-full" @click="showFullTextView">
            <h4>전체 대화 보기</h4>
          </div>
          <div class="option-box summarize" @click="requestSummary">
            <div v-if="isSummarizing && summarizingMeetingId === currentMeeting.id" class="loader"></div>
            <h4 v-else>요약하기</h4>
          </div>
        </div>

        
        <div v-if="internalShowSummary" class="summary-viewer">
          <div class="summary-text-area">
            <p>{{ summaryText }}</p>
          </div>
        </div>
        <div v-if="isTextViewerVisible && !internalShowSummary" class="text-viewer">
          <div class="transcription-text-area">
            <p>{{ currentTranscriptionText }}</p>
          </div>
          <div class="modal-buttons">
            <button class="prompt-button download" @click="downloadTranscriptionAsFile">
              파일로 다운로드 (.txt)
            </button>
          </div>
        </div>

        
        <button 
          class="prompt-button cancel"
          @click="isTextViewerVisible || internalShowSummary ? goBackToInitialOptions() : closeTranscriptionModal()"
        >
          {{ isTextViewerVisible || internalShowSummary ? '뒤로 가기' : '닫기' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "PastMeetingList",
  props: {
    recordings: {
      type: Array,
      default: () => []
    },
    isSummarizing: {
      type: Boolean,
      default: false
    },
    summarizingMeetingId: {
      type: [String, Number],
      default: null
    },
    summaryText: {
      type: String,
      default: ''
    },
    showSummary: {
      type: Boolean,
      default: false
    }
  },
  emits: ['delete-recording', 'update-recording-filename', 'request-summary', 'close-summary'], // 삭제 및 이름 수정 이벤트 추가

  data() {
    return {
      meetings: [],
      editingMeetingId: null,
      editedFilename: '',
      
      
      showMessageModal: false,
      messageModalTitle: '',
      messageModalContent: '',
      messageModalType: '',
      pendingDeleteId: null,

      
      showTranscriptionModal: false,
      currentTranscriptionText: '',
      currentTranscriptionFilename: '',
      isTextViewerVisible: false,
      currentMeeting: null,
      internalShowSummary: this.showSummary,
    };
  },
  watch: {
    showSummary(newVal) {
      this.internalShowSummary = newVal;
    },
    recordings: {
      immediate: true,
      handler(newRecordings) {
        
        console.log("PastMeetingList: recordings prop 변경 감지. 새로운 녹음본:", newRecordings); 

        // 순서대로 정렬
        const sortedRecordings = [...newRecordings].sort((a, b) => {
          return new Date(b.timestamp) - new Date(a.timestamp); 
        });

        this.meetings = sortedRecordings.map((rec) => {
          const audioUrl = rec.audioBlob ? URL.createObjectURL(rec.audioBlob) : null;
          const date = new Date(rec.timestamp);
          const meetingItem = {
            id: rec.id,
            title: rec.filename || `녹음본 ${date.toLocaleString()}`,
            date: date.toLocaleString(),
            audioUrl: audioUrl,

            originalTimestamp: rec.timestamp, 
            audioBlob: rec.audioBlob, 
            transcription: rec.transcription || '텍스트 변환 결과 없음' // 얘진짜왜자꾸뜸
          };
          console.log(`PastMeetingList: 매핑된 회의 항목 (ID: ${meetingItem.id}), 전사본: '${meetingItem.transcription}'`);
          return meetingItem;
        });
      }
    }
  },
  methods: {
    getAudioFileName(meeting) {//다운로드할 파일명 지정
      
      const baseName = meeting.title.replace(/[\\/:*?"<>|]/g, '_');
      return `${baseName}.webm`;
    },
    
    
    confirmDeleteMeeting(id, title) { // 삭제확인창 출력
        this.pendingDeleteId = id;
        this.displayMessageModal('녹음본 삭제', `'${title}' 녹음본을 삭제하시겠습니까?`, 'confirmDelete');
    },

    
    executeDeleteMeeting() { //삭제확인창에서 삭제버튼 클릭시
        if (this.pendingDeleteId) {
            this.$emit('delete-recording', this.pendingDeleteId);//녹음본 삭제
            this.closeMessageModal();
            this.displayMessageModal('삭제 완료', '녹음본이 삭제되었습니다.');
        }
    },

    
    startEditingFilename(meeting) { //파일명 수정 - 시작
     
      if (this.editingMeetingId === meeting.id) {
        return;
      }
      //수정할 녹음파일 타게팅
      this.editingMeetingId = meeting.id;
      this.editedFilename = meeting.title;
      this.$nextTick(() => {
        
        const input = this.$el.querySelector('.filename-edit-input');
        if (input) {
          input.focus();
          input.select();
        }
      });
    },

    
    saveEditedFilename(id) { //파일명 수정 - 저장
      
      if (this.editingMeetingId !== id) {
        return;
      }
      const originalMeeting = this.meetings.find(m => m.id === id);
      const originalFilename = originalMeeting ? originalMeeting.title : '';

      const newFilenameTrimmed = this.editedFilename.trim();

      if (newFilenameTrimmed === '') {
        this.displayMessageModal('이름 변경 실패', '파일 이름은 비워둘 수 없습니다.');
    
        this.editedFilename = originalFilename;
        this.editingMeetingId = null;
        return;
      }//빈 이름 감지시 뒤로가기
      
      
      if (newFilenameTrimmed === originalFilename) {
        this.editingMeetingId = null;
        return; 
      } // 변경사항 없으면 팝업창 닫기

      this.$emit('update-recording-filename', { id: id, newFilename: newFilenameTrimmed });
      this.editingMeetingId = null;
      this.displayMessageModal('이름 변경 완료', `녹음본 이름이 '${newFilenameTrimmed}'(으)로 변경되었습니다.`);//이름변경 성공
    },

   
    previewTranscription(meeting) { //텍스트화된 녹음본 - 미리보기
      if (!meeting.transcription || meeting.transcription === '텍스트 변환 결과 없음' || meeting.transcription.trim() === '') {
        this.displayMessageModal('텍스트 없음', '이 녹음본에 대한 변환된 텍스트가 없습니다.');//겁나많이뜨던오류
        return;
      }
      this.currentMeeting = meeting;
      this.currentTranscriptionText = meeting.transcription;
      this.currentTranscriptionFilename = `${meeting.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`; 
      this.isTextViewerVisible = false; 
      this.showTranscriptionModal = true;
    },

   
    showFullTextView() { //전체화면
      this.isTextViewerVisible = true;
    },

    
    downloadTranscriptionAsFile() { //텍스트화된 녹음본 - 파일로 다운로드
      if (!this.currentTranscriptionText) {
        this.displayMessageModal('다운로드 오류', '다운로드할 텍스트 내용이 없습니다.');
        return;
      }

      const textBlob = new Blob([this.currentTranscriptionText], { type: 'text/plain;charset=utf-8' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(textBlob);
      link.download = this.currentTranscriptionFilename;
      link.click();
      URL.revokeObjectURL(link.href);
      
      this.displayMessageModal('다운로드 완료', `'${this.currentTranscriptionFilename}' 텍스트 파일이 다운로드되었습니다.`);
    },

    
    closeTranscriptionModal() { // 텍스트화된 녹음본 - 미리보기 닫기,초기화
      this.showTranscriptionModal = false;
      this.currentTranscriptionText = '';
      this.currentTranscriptionFilename = '';
      this.isTextViewerVisible = false;
    },

    // 이전 화면으로 돌아가기
    goBackToInitialOptions() {
      this.isTextViewerVisible = false;
      this.internalShowSummary = false;
    },
    // 요약 요청
    requestSummary() {
      this.$emit('request-summary', this.currentMeeting);
    },

    // 메시지 표시
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
/* 제목수정용으로추가함*/
.editable-title-area {
    cursor: pointer;
    padding: 5px; 
    border-radius: 4px;
    transition: background-color 0.2s ease;
}
.editable-title-area:hover {
    background-color: #f0f0f0;
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
    width: calc(100% - 20px);
    padding: 8px 10px;
    border: 1px solid #007bff;
    border-radius: 4px;
    font-size: 1.2em;
    box-sizing: border-box;
}
.audio-player {
  width: 100%;
  margin-top: 10px;
  accent-color: red;
}
.meeting-actions {
    display: flex;
    gap: 10px; 
    margin-top: 10px;
}
.action-button {
  background-color: #007bff; 
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
.action-button.text-preview {
  background-color: #007bff;
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
  z-index: 1050;
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

.message-modal-content .modal-buttons {
    display: flex;
    justify-content: center;
    gap: 15px;
    margin-top: 10px;
    width: 100%;
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

/*텍스트미리보기*/
.transcription-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1050;
  padding: 20px;
  box-sizing: border-box;
}

.transcription-modal-content {
  background-color: white;
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
  width: 100%;
  max-width: 800px;
  height: 80vh;
  max-height: 90%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.transcription-modal-content h3 {
    margin: 0;
    padding-bottom: 16px;
    border-bottom: 1px solid #e0e0e0;
    text-align: center;
    font-size: 1.5em;
    color: #333;
    flex-shrink: 0;
}

.initial-options {
    flex-grow: 1;
    display: flex;
    gap: 20px;
    overflow: hidden;
}

.option-box {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 12px;
    cursor: pointer;
    transition: background-color 0.3s, transform 0.2s;
    color: white;
}

.option-box:hover {
    transform: translateY(-5px);
}

.option-box.view-full {
    background-color: #007bff;
}
.option-box.view-full:hover {
    background-color: #0056b3;
}

.option-box.summarize {
    background-color: #ff9800;
}
.option-box.summarize:hover {
    background-color: #f57c00;
}

.option-box h4 {
    font-size: 1.8em;
    margin: 0;
}

.summary-viewer {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
}

.summary-text-area {
  flex-grow: 1;
  overflow-y: auto;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  line-height: 1.6;
  color: #333;
}

.summary-text-area p {
  margin: 0;
  white-space: pre-wrap;
}

.text-viewer {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
}

.transcription-text-area {
  flex-grow: 1;
  overflow-y: auto;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  line-height: 1.6;
  color: #333;
}

.transcription-text-area p {
  margin: 0;
  white-space: pre-wrap;
}

.text-viewer .modal-buttons {
  display: flex;
  justify-content: center;
  flex-shrink: 0;
}

.prompt-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: 8px;
  border: none;
  font-size: 1.1em;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s, transform 0.1s;
  color: white;
}

.prompt-button:hover {
    transform: translateY(-2px);
}

.prompt-button.download {
  background-color: #4CAF50;
  flex-grow: 1;
}
.prompt-button.download:hover {
  background-color: #45a049;
}

.transcription-modal-content > .prompt-button.cancel {
  background-color: #6c757d;
  flex-shrink: 0;
  margin-top: auto;
}
.prompt-button.cancel:hover {
  background-color: #5a6268;
}

.loader {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 2s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>


