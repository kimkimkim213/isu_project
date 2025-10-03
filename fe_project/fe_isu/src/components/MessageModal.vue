<template>
  <div v-if="show" class="message-modal-overlay">
    <div class="message-modal-content">
      <h3>{{ title }}</h3>
      <p>{{ content }}</p>
      <div class="modal-buttons">
        <button v-if="type === 'confirm'" @click="$emit('confirm')" class="confirm">확인</button>
        <button @click="$emit('close')" class="close">{{ type === 'confirm' ? '취소' : '확인' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  content: { type: String, default: '' },
  type: { type: String, default: 'info' } // 'info' or 'confirm'
});
defineEmits(['close', 'confirm']);
</script>

<!--단순 메시지/확인 모달 컴포넌트-->

<style scoped>
.message-modal-overlay { position: fixed; inset: 0; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,0.4); z-index:2000 }
.message-modal-content { background:#fff; padding:20px; border-radius:8px; max-width:420px; width:90% }
.modal-buttons { margin-top:12px; display:flex; justify-content:flex-end; gap:8px }
.modal-buttons .confirm { background:#dc3545; color:white; border:none; padding:8px 12px; border-radius:6px }
.modal-buttons .close { background:#6c757d; color:white; border:none; padding:8px 12px; border-radius:6px }
</style>
