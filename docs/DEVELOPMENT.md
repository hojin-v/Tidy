# Development

[한국어 안내](../README.md) · [English guide](README.en.md)

Tidy는 GNOME Shell 확장과 설치·복구를 담당하는 Python 도구로 구성됩니다. 설치 및 실행에 npm 패키지는 필요하지 않습니다.

## Build and checks

순수 계산 테스트와 JavaScript 구문 검사에는 Node.js가 필요합니다. 스키마 검사와 패키지 생성에는 `glib-compile-schemas`, 설치·복구 테스트에는 시스템 Python의 PyGObject와 GJS가 필요합니다.

```bash
npm test
npm run check
/usr/bin/python3 -m unittest discover -s tests -p 'test_*.py'
/usr/bin/python3 scripts/manage.py build
npm run test:package
```

빌드 결과는 `dist/winubun@winubun.local.shell-extension.zip`입니다. 런타임 소스, 컴파일한 스키마, 설치·복구 도구와 GPL 라이선스 파일을 포함합니다.

npm 배포 이름은 `@hnode/tidy`이고 실행 파일은 `bin/tidy.js`입니다. `npm pack`은 `prepack`에서 확장 ZIP을 빌드합니다. 사용자 설치 시에는 이 ZIP을 사용하므로 npm 패키지 경로가 읽기 전용이어도 됩니다. 게시 절차와 tarball 검증은 [Releasing](RELEASING.md)을 참고하세요.

```bash
GSETTINGS_BACKEND=memory GSETTINGS_SCHEMA_DIR="$PWD/schemas" gjs -m tests/lease-smoke.js
/usr/bin/python3 scripts/test-shell.py
```

Shell 통합 테스트는 GNOME 50의 `gnome-shell-test-tool`과 가상 모니터를 지원하는 그래픽 환경이 필요합니다. 별도 D-Bus, 런타임 디렉터리, 설정 저장소와 헤드리스 Wayland 세션에서 동작합니다.

## Test coverage

- 화면 분할 경계, 창 사이 간격, 음수 좌표와 방향별 모니터 탐색
- 한국어·영어 설정 화면과 실제 가상 키보드 입력, 사용자 지정 단축키
- 배치 애니메이션의 실제 시작 위치·크기, 연속 배치와 모니터 간 이동
- 양 끝 모니터의 순환 이동, 모니터별 클리핑을 적용한 나가기·들어오기 모션과 연속 입력 정리
- 실제 가상 모니터를 위아래로 재배치한 상태에서 상하 단축키 이동·순환과 원래 모니터 구성 복원
- 좌우·상단 미리보기의 연속 표시·불투명도 유지, 선택기 옵션을 켜거나 꺼도 동일한 표시와 취소
- 최대화·복귀, 창·앱 보기의 드래그 배치와 화면 전환
- 모니터별 선택기 크기, 고해상도 배율, 타일 창의 공유 경계 조절
- Ubuntu Dock 설정을 따르는 선택기 슬라이드, 드래그 안내와 선택기 너비에 맞춘 감지 영역
- 실제 창 크기를 유지하는 축소 미리보기, 이동 추적·취소와 배치 애니메이션 연결
- 창·앱 보기의 드래그 즉시 축소, 포인터 고정·복귀와 작은 상태에서의 배치 전환
- 남은 공간의 앱 선택, 빈 곳 클릭·Esc 취소와 최소화된 창 복원
- 원본 소스 폴더를 삭제한 뒤 설치 도구 실행·설정 복구·제거
- npm tarball 전역 설치, 읽기 전용 패키지, CLI 언어·의존성 검사와 설치된 복구 도구 연결
- 확장 재활성화, 예약 작업 취소와 데스크톱 설정 복원

헤드리스 백엔드에서는 실제 마우스 제스처 대신 잡기 신호·포인터 좌표·Shell 드래그 콜백을 주입합니다. 실제 마우스 조작은 데스크톱에서 별도로 확인해야 합니다. GNOME 46–49와 X11은 실기 검증 전입니다.

## Diagnostics

기본 경로이며 XDG 디렉터리 설정을 따릅니다.

| 경로 | 용도 |
| --- | --- |
| `~/.local/share/gnome-shell/extensions/winubun@winubun.local/` | 확장과 설치된 관리 도구 |
| `~/.local/share/applications/winubun.desktop` | Tidy 실행기 |
| `~/.local/state/winubun/launcher.log` | 실행 오류 |
| `~/.local/state/winubun/preferences.log` | 설정 앱 로그 |
| `~/.local/state/winubun/handover.json` | 기존 타일링 확장 복원 기록 |

```bash
gnome-shell --version
gnome-extensions info winubun@winubun.local
journalctl --user -b --no-pager -g 'Tidy|winubun|JS ERROR'
```

GNOME은 세션 중 읽은 확장 JavaScript를 캐시합니다. 실행 코드 업데이트 시 `metadata.json`의 버전을 올리고 다시 로그인해 검증하세요. Python 설치 도구만 바뀐 경우에는 확장 코드 버전을 그대로 유지할 수 있습니다.

## References

- [GNOME extension anatomy](https://gjs.guide/extensions/overview/anatomy.html)
- [GNOME extension preferences](https://gjs.guide/extensions/development/preferences.html)
- [Mutter window API](https://gnome.pages.gitlab.gnome.org/mutter/meta/class.Window.html)
