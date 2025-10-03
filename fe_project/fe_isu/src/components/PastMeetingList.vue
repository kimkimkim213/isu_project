<template>
  <div class="meeting-list">
    <h2>지난 대화 목록</h2>

    <div v-for="meeting in meetings" :key="meeting.id" class="meeting-item">
      <div class="meeting-info">
        <input v-if="editingMeetingId === meeting.id" type="text" v-model="editedFilename" @keyup.enter="saveEditedFilename(meeting.id)" @blur="saveEditedFilename(meeting.id)" class="filename-edit-input" />
        <div v-else @click="startEditingFilename(meeting)" class="editable-title-area">
          <h3>{{ meeting.title }}</h3>
          <p>{{ meeting.date }}</p>
        </div>
      </div>

      <audio v-if="meeting.audioUrl" :src="meeting.audioUrl" controls class="audio-player"></audio>

      <div class="meeting-actions">
        <a v-if="meeting.audioUrl" :href="meeting.audioUrl" :download="getAudioFileName(meeting)" class="action-button download">녹음 파일 다운로드</a>
        <button class="action-button text-preview" @click="previewTranscription(meeting)">텍스트</button>
        <button class="action-button delete" @click="confirmDeleteMeeting(meeting.id, meeting.title)">삭제</button>
      </div>
    </div>

    <p v-if="meetings.length === 0" class="no-meetings-message">저장된 대화가 없습니다.</p>

    <!-- 메시지/삭제/전사 모달 -->
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

    <div v-if="showTranscriptionModal" class="transcription-modal-overlay">
      <div class="transcription-modal-content">
        <h3>{{ currentMeeting ? currentMeeting.title : '' }}</h3>
        <div v-if="!isTextViewerVisible && !internalShowSummary" class="initial-options">
          <div class="option-box view-full" @click="showFullTextView"><h4>전체 대화 보기</h4></div>
          <div class="option-box summarize" @click="requestSummary">
            <div v-if="isSummarizing && summarizingMeetingId === currentMeeting?.id" class="loader"></div>
            <h4 v-else>요약하기</h4>
          </div>
        </div>

        <div v-if="internalShowSummary" class="summary-viewer">
          <div class="summary-text-area"><p>{{ summaryText }}</p></div>
        </div>

        <div v-if="isTextViewerVisible && !internalShowSummary" class="text-viewer">
          <div class="transcription-text-area"><p>{{ currentTranscriptionText }}</p></div>
          <div class="modal-buttons"><button class="prompt-button download" @click="downloadTranscription">파일로 다운로드 (.txt)</button></div>
        </div>

        <button class="prompt-button cancel" @click="isTextViewerVisible || internalShowSummary ? goBackToInitialOptions() : closeTranscriptionModal()">
          {{ isTextViewerVisible || internalShowSummary ? '뒤로 가기' : '닫기' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { getObjectUrl, revokeObjectUrl } from '@/utils/objectUrlCache';

export default {
  name: 'PastMeetingList',
  props: {
    recordings: { type: Array, default: () => [] },
    isSummarizing: { type: Boolean, default: false },
    summarizingMeetingId: { type: [String, Number], default: null },
    summaryText: { type: String, default: '' },
    showSummary: { type: Boolean, default: false },
  },
  emits: ['delete-recording', 'update-recording-filename', 'request-summary', 'close-summary'],
  data() {
    return {
      meetings: [],
      editingMeetingId: null,
      editedFilename: '',
      showMessageModal: false,
      messageModalTitle: '',
      messageModalContent: '',
      messageModalType: 'info',
      pendingDeleteId: null,
      showTranscriptionModal: false,
      currentTranscriptionText: '',
      currentTranscriptionFilename: '',
      isTextViewerVisible: false,
      currentMeeting: null,
      internalShowSummary: this.showSummary,
      audioUrlMap: {},
    };
  },
  watch: {
    showSummary(newVal) { this.internalShowSummary = newVal; },
    recordings: {
      immediate: true,
      handler(newRecordings) {
        const sorted = [...newRecordings].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

        // revoke removed urls
        const newIds = new Set(sorted.map(r => r.id));
        Object.keys(this.audioUrlMap).forEach(id => {
          if (!newIds.has(id)) {
            try { revokeObjectUrl(id); } catch (e) { console.debug('revokeObjectUrl fail', e); }
            delete this.audioUrlMap[id];
          }
        });

        this.meetings = sorted.map(rec => {
          const audioUrl = rec.audioBlob ? getObjectUrl(rec.id, rec.audioBlob) : null;
          if (audioUrl) this.audioUrlMap[rec.id] = audioUrl;
          const date = new Date(rec.timestamp || Date.now());
          return {
            id: rec.id,
            title: rec.filename || `녹음본 ${date.toLocaleString()}`,
            date: date.toLocaleString(),
            audioUrl,
            audioBlob: rec.audioBlob,
            transcription: rec.transcription || '텍스트 변환 결과 없음',
            timestamp: rec.timestamp,
          };
        });
      }
    }
  },
  methods: {
    getAudioFileName(meeting) { const base = (meeting && meeting.title ? meeting.title : 'recording').replace(/[\\/:*?"<>|]/g,'_'); return `${base}.webm`; },
    confirmDeleteMeeting(id, title) { this.pendingDeleteId = id; this.displayMessageModal('녹음본 삭제', `'${title}' 녹음본을 삭제하시겠습니까?`, 'confirmDelete'); },
    executeDeleteMeeting() { if (this.pendingDeleteId) { this.$emit('delete-recording', this.pendingDeleteId); this.closeMessageModal(); this.displayMessageModal('삭제 완료','녹음본이 삭제되었습니다.'); } },
    startEditingFilename(meeting) { console.debug('startEditingFilename', meeting && meeting.id); if (this.editingMeetingId === meeting.id) return; this.editingMeetingId = meeting.id; this.editedFilename = meeting.title; this.$nextTick(()=>{ const input = this.$el.querySelector('.filename-edit-input'); if (input) { input.focus(); input.select(); } }); },
    saveEditedFilename(id) {
      if (this.editingMeetingId !== id) { return; }
      const originalMeeting = this.meetings.find(m => m.id === id);
      const originalFilename = originalMeeting ? originalMeeting.title : '';
      const newFilenameTrimmed = this.editedFilename.trim();
      if (newFilenameTrimmed === '') { this.displayMessageModal('이름 변경 실패', '파일 이름은 비워둘 수 없습니다.'); this.editedFilename = originalFilename; this.editingMeetingId = null; return; }
      if (newFilenameTrimmed === originalFilename) { this.editingMeetingId = null; return; }
      this.$emit('update-recording-filename', { id: id, newFilename: newFilenameTrimmed });
      this.editingMeetingId = null;
      this.displayMessageModal('이름 변경 완료', `녹음본 이름이 '${newFilenameTrimmed}'(으)로 변경되었습니다.`);
    },
    previewTranscription(meeting) {
      console.debug('previewTranscription', meeting && meeting.id);
      if (!meeting || !meeting.transcription || meeting.transcription === '텍스트 변환 결과 없음' || meeting.transcription.trim() === '') {
        this.displayMessageModal('텍스트 없음', '이 녹음본에 대한 변환된 텍스트가 없습니다.');
        return;
      }
      this.currentMeeting = meeting;
      this.currentTranscriptionText = meeting.transcription;
      this.currentTranscriptionFilename = `${meeting.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`;
      this.isTextViewerVisible = false;
      this.showTranscriptionModal = true;
    },
    showFullTextView() { console.debug('showFullTextView'); this.isTextViewerVisible = true; },
    downloadTranscription() {
      console.debug('downloadTranscription', this.currentTranscriptionFilename);
      if (!this.currentTranscriptionText) { this.displayMessageModal('다운로드 오류', '다운로드할 텍스트 내용이 없습니다.'); return; }
      const textBlob = new Blob([this.currentTranscriptionText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(textBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = this.currentTranscriptionFilename;
      link.click();
      try { URL.revokeObjectURL(url); } catch (e) { console.debug('revoke url fail', e); }
      this.displayMessageModal('다운로드 완료', `'${this.currentTranscriptionFilename}' 텍스트 파일이 다운로드되었습니다.`);
    },
    closeTranscriptionModal() { this.showTranscriptionModal = false; this.currentTranscriptionText = ''; this.currentTranscriptionFilename = ''; this.isTextViewerVisible = false; },
    goBackToInitialOptions() { this.internalShowSummary = false; this.$emit('close-summary'); },
    requestSummary() { this.$emit('request-summary', this.currentMeeting); },
    displayMessageModal(title, content, type = 'info') { this.messageModalTitle = title; this.messageModalContent = content; this.messageModalType = type; this.showMessageModal = true; },
    closeMessageModal() { this.showMessageModal = false; this.messageModalTitle = ''; this.messageModalContent = ''; this.messageModalType = ''; this.pendingDeleteId = null; }
  },
  beforeUnmount() { Object.keys(this.audioUrlMap||{}).forEach(id=>{ try{ revokeObjectUrl(id); }catch(e){ console.debug('revoke fail', e); } }); }
};
</script>

<style scoped>
/* keep original styles */
.meeting-list { padding: 20px; max-width: 800px; margin: 20px auto; background-color: #f9f9f9; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
h2 { text-align: center; color: #333; margin-bottom: 30px; font-size: 2em; }
.meeting-item { margin-bottom: 20px; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #fff; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.meeting-info { display:flex; flex-direction:column; gap:5px; }
.editable-title-area { cursor:pointer; padding:5px; border-radius:4px; transition:background-color .2s ease; }
.editable-title-area:hover { background-color:#f0f0f0 }
.meeting-info h3 { margin:0; color:#000; font-size:1.5em }
.filename-edit-input { width: calc(100% - 20px); padding:8px 10px; border:1px solid #007bff; border-radius:4px; font-size:1.2em; box-sizing:border-box }
.audio-player { width:100%; margin-top:10px }
.meeting-actions { display:flex; gap:10px; margin-top:10px }
.action-button { background-color:#007bff; color:white; padding:8px 16px; text-decoration:none; border-radius:5px; font-size:.9em; border:none; cursor:pointer }
.action-button.download { background-color:#28a745 }
.action-button.text-preview { background-color:#007bff }
.action-button.delete { background-color:#dc3545 }
.no-meetings-message { text-align:center; color:#999; font-size:1.1em; padding:50px 0 }
.message-modal-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background-color:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:1050 }
.message-modal-content { background:white; padding:30px; border-radius:12px; box-shadow:0 5px 20px rgba(0,0,0,.4); max-width:400px; text-align:center }
.modal-buttons { display:flex; justify-content:center; gap:15px; margin-top:10px }
.confirm-button { background:#dc3545; color:white }
.cancel-button { background:#6c757d; color:white }
.ok-button { background:#007bff; color:white }
.transcription-modal-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background-color:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:1050; padding:20px; box-sizing:border-box }
.transcription-modal-content { background:white; padding:24px; border-radius:12px; width:100%; max-width:800px; height:80vh; display:flex; flex-direction:column; gap:16px }
.transcription-text-area { flex-grow:1; overflow:auto; background:#f9f9f9; border:1px solid #e0e0e0; padding:16px }
.prompt-button { display:flex; align-items:center; justify-content:center; gap:8px; padding:12px 24px; border-radius:8px; border:none; font-size:1.1em; font-weight:500; cursor:pointer; transition:background-color 0.2s, transform 0.1s; color:white; }
.prompt-button.download { background-color:#4CAF50; flex-grow:1 }
.prompt-button.cancel { background-color:#6c757d }
.loader { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; }
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
</style>
    background-color: #dc3545;

    color: white;

