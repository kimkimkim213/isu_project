//  오디오 데이터 변환 관련 함수
export async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64OrDataUrl, fallbackMime) {
  if (typeof base64OrDataUrl !== 'string') return null;

  if (base64OrDataUrl.includes(';base64,')) {
    const parts = base64OrDataUrl.split(';base64,');
    const mime = (parts[0].split(':')[1]) || fallbackMime || 'application/octet-stream';
    const bin = atob(parts[1]);
    const len = bin.length;
    const arr = new Uint8Array(len);
    
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  const bin = atob(base64OrDataUrl);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: fallbackMime || 'application/octet-stream' });
}

// PCM and WAV helpers
export function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    output.setInt16(offset, s, true);
  }
}

export function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  floatTo16BitPCM(view, 44, samples);

  return view;
}

export async function safeCloseAudioContext(Ctxt) {
  if (!Ctxt || typeof Ctxt.close !== 'function') return;
  try {
    if (Ctxt.state !== 'closed') await Ctxt.close();
  } catch (e) {
    console.warn('프: safeCloseAudioContext - close 실패', e && e.message ? e.message : e);
  }
}

export async function to16kWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtxt = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuffer = await decodeCtxt.decodeAudioData(arrayBuffer);

    const targetSampleRate = 16000;
    const numChannels = 1;
    const length = Math.ceil(audioBuffer.duration * targetSampleRate);
    const OfflineCtxt = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offlineCtxt = new OfflineCtxt(numChannels, length, targetSampleRate);
    
    const source = offlineCtxt.createBufferSource();
    if (audioBuffer.numberOfChannels > 1) {
      const tmp = offlineCtxt.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
      const out = tmp.getChannelData(0);
      const chCount = audioBuffer.numberOfChannels;
      for (let c = 0; c < chCount; c++) {
        const inData = audioBuffer.getChannelData(c);
        for (let i = 0; i < inData.length; i++) out[i] = (out[i] || 0) + inData[i] / chCount;
      }
      source.buffer = tmp;
    } else {
      source.buffer = audioBuffer;
    }
    source.connect(offlineCtxt.destination);
    source.start(0);
    const rendered = await offlineCtxt.startRendering();
    const chanData = rendered.getChannelData(0);
    const wavBuffer = encodeWav(chanData, targetSampleRate);

    return new Blob([wavBuffer], { type: 'audio/wav' });
  } finally {
    await safeCloseAudioContext(decodeCtxt);
  }
}

export function resample(buffer, inSampleRate, outSampleRate) {
  if (inSampleRate === outSampleRate) return buffer;
  const ratio = inSampleRate / outSampleRate;
  const outLength = Math.round(buffer.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const interp = i * ratio;
    const i0 = Math.floor(interp);
    const i1 = Math.min(i0 + 1, buffer.length - 1);
    const frac = interp - i0;
    out[i] = buffer[i0] * (1 - frac) + buffer[i1] * frac;
  }
  return out;
}

export async function sendToSTT(audioBlob, sampleRate, mimeType) {
  try {
    let sendBlob = audioBlob;
    let finalMimeType = mimeType;
    let finalSampleRate = sampleRate;

    try {
      const wavBlob = await to16kWav(audioBlob);
      if (wavBlob && wavBlob.size > 0) {
        sendBlob = wavBlob;
        finalSampleRate = 16000;
        finalMimeType = 'audio/wav';
        console.log('프: audio - 16kHz WAV 변환 성공. 크기:', wavBlob.size);
      }
    } catch (e) {
      console.warn('프: to16kWav 실패, 원본 blob 사용', e && e.message ? e.message : e);
    }

    const form = new FormData();
    const filename = finalMimeType === 'audio/wav' ? 'recording.wav' : 'recording.webm';
    form.append('audio', sendBlob, filename);
    form.append('sampleRate', String(finalSampleRate));
    form.append('mimeType', finalMimeType);

    const res = await fetch('http://localhost:3001/api/transcribe', {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '응답 파싱 실패');
      const errMsg = `STT API 오류: ${res.status} - ${errorText}`;
      console.error('프:', errMsg);
      throw new Error(errMsg);
    }

    const data = await res.json().catch(() => ({}));
    return data.transcription || '변환된 텍스트가 없습니다.';
  } catch (err) {
    console.error('프: sendToSTT 처리 중 오류', err && err.stack ? err.stack : err);
    try { window.alert('음성 전송 또는 전사 중 오류가 발생했습니다.다시 시도해주세요.'); } catch (e) { console.warn('alert 실패', e && e.message ? e.message : e); }
    return null;
  }
}
