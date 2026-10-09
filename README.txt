웹페이지 실행 방법

1. ZIP 압축을 해제하고 index.html이 있는 폴더를 엽니다.
2. 탐색기 주소창에 cmd를 입력하고 Enter를 누릅니다.
3. 명령 프롬프트에서 다음을 실행합니다.

   py -m http.server 8000

   (py를 사용할 수 없으면 python -m http.server 8000)

4. 브라우저에서 http://localhost:8000 에 접속합니다.
5. 서버 종료: 명령 프롬프트에서 Ctrl + C

※ index.html을 더블클릭(file://)하면 3D 파일 로딩이 차단될 수 있습니다.
