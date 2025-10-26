/**
 * 오디오 처리 관련 유틸리티 함수
 */

// Blob을 Base64 데이터 URL로 변환
export async function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const base64DataUrl = reader.result;
        const base64Audio = base64DataUrl.split(',')[1];
        resolve(base64Audio);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
}

// Float32Array를 16-bit PCM WAV로 인코딩
export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer); // WAV 헤더 작성

  writeString(view, 0, 'RIFF'); // 청크 ID
  view.setUint32(4, 36 + samples.length * 2, true); // 청크 크기
  writeString(view, 8, 'WAVE'); // 포맷 청크 ID
  writeString(view, 12, 'fmt '); // 서브청크1 ID
  view.setUint32(16, 16, true); // 서브청크1 크기
  view.setUint16(20, 1, true); // 오디오 포맷 (1 = PCM)
  view.setUint16(22, 1, true); // 채널 수
  view.setUint32(24, sampleRate, true); // 샘플링 레이트
  view.setUint32(28, sampleRate * 2, true); // 바이트율
  view.setUint16(32, 2, true);  // 블록 정렬
  view.setUint16(34, 16, true); // 비트 깊이
  writeString(view, 36, 'data'); // 서브청크2 ID
  view.setUint32(40, samples.length * 2, true); // 서브청크2 크기

  // PCM 샘플 작성
  floatTo16BitPCM(view, 44, samples);

  return view;
}

// 오디오 Blob을 16kHz 모노 WAV로 변환
export async function to16kWav(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);// 디코딩
    
    const targetSampleRate = 16000; // 목표 샘플링 레이트
    const numChannels = 1;
    const length = Math.ceil(audioBuffer.duration * targetSampleRate);
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offlineCtx = new OfflineCtx(numChannels, length, targetSampleRate);

    const source = offlineCtx.createBufferSource();
    if (audioBuffer.numberOfChannels > 1) {
      const tmp = offlineCtx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
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

    source.connect(offlineCtx.destination);
    source.start(0);
    const rendered = await offlineCtx.startRendering();
    const chanData = rendered.getChannelData(0);
    const wavBuffer = encodeWav(chanData, targetSampleRate);
    
    try { decodeCtx.close(); } catch (e) { console.warn('프: audio.js - decodeCtx.close 실패(무시):', e); }

    return new Blob([wavBuffer], { type: 'audio/wav' });
  } catch (err) {
    console.warn('프: audio.js - to16kWav 실패:', err);
    throw err;
  }
}

// 간단한 선형 리샘플러 (Float32Array)
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

// STT API 호출
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
        console.log('프: audio.js - 변환된 WAV 사용 (16kHz). 크기:', wavBlob.size);
      }
    } catch (e) {
      console.warn('프: audio.js - WAV 변환 실패, 원본 Blob 사용:', e);
    }

    // FormData로만 전송
    const form = new FormData();
    const filename = finalMimeType === 'audio/wav' ? 'recording.wav' : 'recording.webm';
    form.append('audio', sendBlob, filename);
    form.append('sampleRate', String(finalSampleRate));
    form.append('mimeType', finalMimeType);
    
    const res = await fetch('http://localhost:3001/api/transcribe', { // STT API 엔드포인트
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`STT API 오류: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
    return data.transcription || '변환된 텍스트가 없습니다.';

  } catch (error) {
    console.error('프: audio.js - sendToSTT 실패:', error);
    throw error; // 호출자에서 처리
  }
}

// Helper for encodeWav
function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    output.setInt16(offset, s, true);
  }
}

// Helper for encodeWav
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
