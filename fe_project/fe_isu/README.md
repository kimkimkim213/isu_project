# fe_isu

## Project setup
```
npm install
```

### Compiles and hot-reloads for development
```
npm run serve
```

### Compiles and minifies for production
```
npm run build
```

### Lints and fixes files
```
npm run lint
```

### Customize configuration
See [Configuration Reference](https://cli.vuejs.org/config/).

### .env 파일
- 프로젝트 루트(src 폴더와 같은 위치)에 .env 파일 생성
- Google Cloud API 키와 인증 키 경로 설정
- .env 파일 내용 예시:
  ```
  GOOGLE_APPLICATION_CREDENTIALS="./credentials/key.json" 
  GOOGLE_API_KEY="AIzaSyC2Lm9v0lvqoIsRr06AezK1mdDuTP9r6k4" 
  ```