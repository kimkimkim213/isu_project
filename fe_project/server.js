const express = require('express');
const cors = require('cors');

const { GoogleGenerativeAI } = require('@google/generative-ai');//전사본 요약용 API
const { SpeechClient } = require('@google-cloud/speech');//음성인식용 API
const { GoogleAuth, JWT } = require('google-auth-library'); // for constructing auth client from service account JSON

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();

// 전역 예외 처리
process.on('uncaughtException', (err) => {
  console.error('백: uncaughtException 발생:', err && err.stack ? err.stack : err);
});//동기 처리중 예외 발생시
process.on('unhandledRejection', (reason, p) => {
  console.error('백: unhandledRejection 발생 - reason:', reason, 'promise:', p);
});//비동기 처리중 예외 발생시

//환경변수 로드 및 확인
require('dotenv').config();
if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  require('dotenv').config({ path: path.join(__dirname, 'fe_isu', '.env') });
}

// GOOGLE_APPLICATION_CREDENTIALS가 .env에 상대경로로 설정되어 있을 수 있으므로
// 실행 디렉터리에 따라 잘못 해석되는 것을 막기 위해 __dirname 기준으로 절대 경로로 정규화합니다.
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (gac && !path.isAbsolute(gac)) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(__dirname, gac);
    }
    console.log('백: GOOGLE_APPLICATION_CREDENTIALS normalized to', process.env.GOOGLE_APPLICATION_CREDENTIALS);
  } catch (e) {
    console.warn('백: GOOGLE_APPLICATION_CREDENTIALS 정규화 실패(무시):', e && e.message ? e.message : e);
  }
}

// GOOGLE_API_KEY는 .env에서 직접 설정되어야 합니다. 필요하면 수동으로 값을 확인하세요.

// PORT 번호 설정 - 기본값 3001
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// 전역 클라이언트 생성
let genAI = null;
let speechClient = null;
try {
  if (process.env.GOOGLE_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY); // API 키 있음
  } else {
    console.warn('백: 환경변수(GOOGLE_API_KEY) 설정되지 않음 - 요약 기능 사용 불가'); //API 키 없음
  }
} catch (e) {
  console.error('백: genAI 초기화 실패:', e && e.message ? e.message : e);//API 키 있는데 오류남
  genAI = null;
}
try {
  // 서비스 계정 인증 방식 처리
  // 우선: 환경변수로 제공된 JSON (base64 또는 raw JSON)을 사용해 credentials 객체를 직접 전달하면
  // 내부적으로 deprecated 메서드를 사용하지 않고 JWT 생성자가 사용됩니다.
  let created = false;
  if (process.env.GOOGLE_CREDENTIALS_B64 || process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      const raw = process.env.GOOGLE_CREDENTIALS_B64
        ? Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString('utf8')
        : process.env.GOOGLE_CREDENTIALS_JSON;
      const creds = JSON.parse(raw);
      if (creds && creds.client_email && creds.private_key) {
        // Construct a JWT client directly to avoid deprecated fromJSON/from-credentials usage.
        const jwtClient = new JWT({
          email: creds.client_email,
          key: creds.private_key,
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
        speechClient = new SpeechClient({ auth: jwtClient });
        console.log('백: SpeechClient initialized from env JSON credentials (auth=JWT)');
        created = true;
      } else {
        console.warn('백: env에 제공된 JSON이 유효한 서비스 계정 형태가 아닙니다. client_email/private_key 확인 필요');
      }
    } catch (e) {
      console.warn('백: env JSON으로 SpeechClient 초기화 실패:', e && e.message ? e.message : e);
    }
  }
  // 둘째: GOOGLE_APPLICATION_CREDENTIALS에 키 파일 경로가 있으면 keyFilename으로 전달
  if (!created && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (fs.existsSync(keyPath) && fs.statSync(keyPath).isFile()) {
        try {
          // 파일을 직접 읽어 credentials 객체로 전달하면 deprecated 경고를 피할 수 있음
          const raw = fs.readFileSync(keyPath, { encoding: 'utf8' });
          const creds = JSON.parse(raw);
          if (creds && creds.client_email && creds.private_key) {
            // Create a JWT client from parsed key file to avoid deprecated APIs
            const jwtClient = new JWT({
              email: creds.client_email,
              key: creds.private_key,
              scopes: ['https://www.googleapis.com/auth/cloud-platform'],
            });
            speechClient = new SpeechClient({ auth: jwtClient });
            console.log('백: SpeechClient initialized from key file (auth=JWT):', keyPath);
            created = true;
          } else {
            // 포맷이 예상과 다르면 GoogleAuth에 keyFilename을 넘겨 auth 인스턴스를 생성한 뒤 전달
            console.warn(
              '백: key file parsed but missing client_email/private_key - falling back to',
              'GoogleAuth with keyFilename',
            );
            try {
              const googleAuthFallback = new GoogleAuth({
                keyFilename: keyPath,
                scopes: ['https://www.googleapis.com/auth/cloud-platform'],
              });
              speechClient = new SpeechClient({ auth: googleAuthFallback });
              console.log('백: SpeechClient initialized from key file (auth=GoogleAuth via keyFilename):', keyPath);
              created = true;
            } catch (e2) {
              console.warn('백: GoogleAuth(keyFilename) 생성 실패, 계속 진행:', e2 && e2.message ? e2.message : e2);
            }
          }
        } catch (e) {
          console.warn('백: key file을 JSON으로 읽는 중 오류, GoogleAuth(keyFilename)으로 시도:', e && e.message ? e.message : e);
          try {
            const googleAuthFallback = new GoogleAuth({
              keyFilename: keyPath,
              scopes: ['https://www.googleapis.com/auth/cloud-platform'],
            });
            speechClient = new SpeechClient({ auth: googleAuthFallback });
            console.log('백: SpeechClient initialized from key file (auth=GoogleAuth via keyFilename):', keyPath);
            created = true;
          } catch (e2) {
            console.warn('백: GoogleAuth(keyFilename) 생성 실패(무시):', e2 && e2.message ? e2.message : e2);
          }
        }
      } else {
        console.warn('백: GOOGLE_APPLICATION_CREDENTIALS에 지정된 파일을 찾을 수 없음:', keyPath);
      }
    } catch (e) {
      console.warn('백: keyFilename으로 SpeechClient 초기화 중 오류(무시):', e && e.message ? e.message : e);
    }
  }
  // 셋째: 아무 것도 없으면 ADC 또는 기본 동작으로 시도
  if (!created) {
    speechClient = new SpeechClient();
    console.log('백: SpeechClient initialized using Application Default Credentials (ADC)');
  }
} catch (e) {
  console.error('백: SpeechClient 초기화 실패:', e && e.message ? e.message : e); //키 파일 설정 실패
  speechClient = null;
}

app.use(cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
//파싱 처리 제한 - 50MB

// JSON 파싱 오류 처리
app.use((err, req, res, next) => {
  if (err && (err instanceof SyntaxError || err.type === 'entity.parse.failed')) {
    console.error('백: JSON 파싱 오류:', err.message);
    return res.status(400).json({ error: '유효하지 않은 JSON 요청' });
  }
  next(err);
});

//클라이언트 데이터 수신용 파일 생성
const UP_DIR = path.join(__dirname, 'fe_isu', 'uploads'); //업로드 디렉토리 설정
// 디렉토리 없으면 생성
try { fs.mkdirSync(UP_DIR, { recursive: true }); }
catch (e) { console.warn('백: 업로드 폴더 생성 실패(무시):', e.message); }
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UP_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
// multer 제한 설정 - >=50MB, 오디오 파일만 허용
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/opus'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('허용되지 않는 파일 형식입니다. 오디오 파일만 업로드하세요.'));
  }
});
app.use('/uploads', express.static(UP_DIR));

// 요약 요청 처리
app.post('/api/summarize', async (req, res) => {
  try {
    const { text } = req.body;//요약할 텍스트
    if (!text) {
      return res.status(400).json({ error: '요약할 텍스트가 없음' });
    }
    if (!genAI) {
      return res.status(500).json({ error: '요약 엔진 초기화되지 않음' });
    }
    // 요약 AI 모델 호출 처리
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `요약문을 제외한 다른 반응이나 말은 모두 출력하지 말고,이 다음에 주어지는 대화의 전문을 핵심을 꼽아 요약해줘. / 대화: ${text}`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();
    res.json({ summary });//요약문 반환
    } catch (error) {
    console.error('백: 요약 오류:', error);
    res.status(500).json({ error: '요약 실패', 사유: error && error.message ? error.message : String(error) });
  }
});

// 음성 전사 처리
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    // 전역 SpeechClient 사용 여부 확인
    if (!speechClient) {
      return res.status(500).json({ error: '음성인식 클라이언트 초기화되지 않음' });
    }
    const startTime = Date.now();
    // 기본 메타데이터
    const contentType = req.headers['content-type'] || '';
    const contentLength = req.get('content-length') || '';
    console.log('백: 전사 요청 수신 - 타입:', contentType, '길이:', contentLength);

    let audioBuffer = null;
    let sampleRate = null;
    let mimeType = null;

    if (!req.file) {
      return res.status(400).json({ error: '오디오 파일 필요' });
    }

      const fp = req.file.path;
      mimeType = req.file.mimetype || 'audio/webm';
      try {
        // 파일 읽기
        audioBuffer = await fs.promises.readFile(fp);
        console.log('백: 업로드된 파일 읽음:', fp);
        console.log(
          '백: 파일 메타 - originalname:',
          req.file.originalname,
          '타입:',
          mimeType,
          '크기:',
          audioBuffer.length,
        );
        try {
          console.log('백: 파일 바이트(선두 64 바이트, hex):', audioBuffer.slice(0, 64).toString('hex'));
        } catch (e) {
          console.warn('백: 파일 바이트 출력 실패(무시):', e && e.message ? e.message : e);
        }
      } catch (e) {
        console.error('백: 업로드 파일 읽기 오류:', e);
        return res.status(500).json({ error: '파일 처리 실패', details: e.message });
      } finally {
        // 임시 파일 삭제
        fs.promises.unlink(fp).catch(err => console.warn('백: 업로드 임시파일 삭제 실패:', err && err.message ? err.message : err));
      }
      sampleRate = req.body.sampleRate ? Number(req.body.sampleRate) : 16000;

    console.log('백: 수신된 오디오 버퍼 크기:', audioBuffer.length, '바이트');
    console.log(`백: 수신된 오디오 속성: 샘플레이트=${sampleRate}, MIME=${mimeType}`);

  const audio = { content: audioBuffer.toString('base64') };

  // 인코딩,샘플레이트 설정
  let encoding = 'ENCODING_UNSPECIFIED';
  if (mimeType && mimeType.includes('webm')) {
    encoding = 'WEBM_OPUS';
  } else if (mimeType && mimeType.includes('wav')) {
  // stt api의 경우 wav는 LINEAR16으로 처리
  encoding = 'LINEAR16';
  }

  // sampleRate 숫자 설정 - 기본 16000
  if (!sampleRate || typeof sampleRate !== 'number' || Number.isNaN(sampleRate)) {
    sampleRate = 16000;
  }

    const config = {
      encoding: encoding,
      sampleRateHertz: sampleRate,
      languageCode: 'ko-KR',
      enableSpeakerDiarization: true,
      diarizationSpeakerCount: 2
    };

    console.log('백: Google 전송 설정:', JSON.stringify(config, null, 2));
    const callStart = Date.now();
    console.log('백:음성 전사 처리시작, 크기:', audioBuffer.length, '바이트');
    const [operation] = await speechClient.longRunningRecognize({ audio, config });//전사 처리 요청
    const [response] = await operation.promise();
    // Google STT가 빈 응답을 반환하는 경우
    if (!response || !response.results || response.results.length === 0) {
      console.warn('백: STT가 결과를 반환하지 않음');
      return res.status(502).json({ error: '음성 인식 결과가 없습니다. 다시 시도하세요.' });
    }
    const callDur = Date.now() - callStart;//STT API 호출 시간 표시
    console.log('백: Google 음성 전사 처리 완료 (ms):', callDur);
  try {
    console.log(
      '백: Google STT 응답 요약:',
      JSON.stringify(response, ['results', 'alternatives', 'transcript'], 2).slice(0, 2000),
    );
  } catch (e) {
    console.warn('백: STT 응답 요약 출력 실패(무시):', e && e.message ? e.message : e);
  }

  const transcription = (response.results || [])
      .map(result => (result.alternatives && result.alternatives[0]) ? result.alternatives[0].transcript : '')
      .filter(t => t)//빈 문자열 제거
      .join('\n'); //줄바꿈으로 구분된 전체 전사 텍스트
    //전사 결과가 비어있는 경우 
    if (!transcription || transcription.trim().length === 0) {
      console.warn('백: STT 결과가 비어 있음');
      return res.status(502).json({ error: '음성 인식 결과가 없습니다. 다시 시도하세요.' });
    }
    const totalDur = Date.now() - startTime;
    console.log('백: 전사 완료 — 문자 길이:', transcription.length, '처리시간(ms):', totalDur);
    //전사 결과 반환
    res.json({ transcription });
  } catch (error) {
    console.error('백: 전사 오류:', error);
    res.status(500).json({ error: '전사 실패', details: error.message });
  }
});

// 업로드 앤드포인트
app.post('/api/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일 없음' });//파일이 없으면 오류400 반환
    const url = `http://localhost:${PORT}/uploads/${req.file.filename}`;//업로드된 파일URL 생성
    console.log('백: 업로드 완료 URL:', url);//업로드된 파일 URL 표시
    res.json({ url });//URL 반환
  } catch (e) {
    console.error('백: 업로드 오류:', e);
    res.status(500).json({ error: '업로드 실패', details: e.message });
  }
});

// 서버 시작 - 포트가 사용 중일 때 자동으로 다음 포트로 재시도
function startServer(port, attemptsLeft = 5) {
  const server = app.listen(port, () => {
    console.log(`백: 서버 실행 중: http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`백: 포트 ${port} 사용 중(EADDRINUSE)`);
      if (attemptsLeft > 1) {
        const nextPort = port + 1;
        console.log(`백: 포트 ${nextPort}으로 재시도합니다... (${attemptsLeft - 1}회 남음)`);
        // 약간의 지연 후 재시도
        setTimeout(() => startServer(nextPort, attemptsLeft - 1), 200);
      } else {
        console.error('백: 사용 가능한 포트를 찾지 못했습니다. 프로세스를 종료합니다.');
        process.exit(1);
      }
    } else {
      console.error('백: 서버 시작 중 오류:', err);
      process.exit(1);
    }
  });
}

startServer(PORT);
