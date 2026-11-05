# macOS

[한국어 안내](../README.md) · [English guide](README.en.md)

macOS에서는 Tidy가 Electron 데스크톱 앱으로 실행됩니다. GNOME판과 같은 `lib/layouts.js`의 배치와 모니터 탐색 규칙을 사용하며, Swift의 Accessibility API로 창을 이동하고 크기를 조절합니다.

## Requirements

macOS 13 이상에서 Intel과 Apple Silicon을 대상으로 합니다. 설치에는 Node.js 22.12 이상과 npm, Xcode Command Line Tools의 Swift 컴파일러가 필요합니다. 컴파일러가 없다면 `xcode-select --install`을 실행하고 설치를 완료하세요. `tidy doctor`로 설치 도구를 확인할 수 있습니다.

최초 설치는 Electron 런타임을 다운로드하므로 인터넷 연결이 필요합니다. 설치된 앱은 별도의 시스템 Python이나 Node.js 프로세스 없이 실행됩니다.

## Install and run

```sh
npm install -g @hnode/tidy
tidy doctor
tidy install
```

소스의 변경 사항을 사용하려면 저장소에서 실행하세요.

```sh
node bin/tidy.js doctor
node bin/tidy.js install
```

설치 후 앱과 설정이 바로 열립니다. **시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용**에서 Tidy를 허용한 후 앱을 다시 실행하세요. 권한을 주기 전에는 설정과 진단을 사용할 수 있으며 창 배치는 사용할 수 없습니다. 업데이트 후 권한을 다시 요청할 수 있습니다.

메뉴 막대 아이콘의 **배치 선택기 열기**나 단축키로 현재 창을 배치하세요. 창을 화면 상단 중앙으로 끌어도 선택기를 열 수 있습니다. 원하는 칸에 포인터를 두고 놓으면 배치하고, 빈 곳에 놓으면 취소합니다. 단축키로 열었을 때는 칸을 클릭하거나 Tab으로 이동해 Enter를 누르세요. Esc로 닫습니다.

로그인 시 자동 실행은 기본으로 켜져 있으며 설정에서 끌 수 있습니다. 앱과 런타임을 사용자 폴더에 복사하므로 원본 소스와 npm 캐시를 지워도 실행됩니다.

## Shortcuts and settings

기본 조합은 **Control+Option**입니다. 방향키, Enter, U/I/J/K, D/F/G, E/T, C, Space, N의 배치 동작은 GNOME판과 같습니다. 같은 방향키를 반복하면 해당 방향 모니터로 이동하고 양 끝에서 순환합니다. `Control+Option+Space`로 선택기를 엽니다. `Control+Option+Enter`는 사용 가능 영역을 채우거나 이전 크기로 되돌립니다. 별도 Space로 전환하는 전체 화면 모드는 사용하지 않습니다.

`tidy prefs` 또는 메뉴 막대 아이콘으로 설정을 엽니다. 창 간격, 상단 드래그 선택기, 가장자리 배치, 자동 실행, 각 단축키를 바꿀 수 있습니다. 단축키는 `Control+Alt+Left` 같은 형식으로 입력하며 비워 두면 해당 동작을 끕니다. 등록할 수 없는 단축키는 설정에 표시하고, 저장 실패 시 기존 지정을 유지합니다.

macOS 기본 타일링과 시스템 단축키 설정은 변경하지 않습니다. Command 키나 Mission Control 연동, 기본 타일링의 자동 비활성화·복원은 구현하지 않았습니다. 기본 타일링이 켜진 환경에서는 가장자리 드래그 동작이 겹칠 수 있습니다.

## Update and uninstall

```sh
tidy status
npm install -g @hnode/tidy@latest
tidy update
tidy uninstall
```

업데이트는 새 런타임을 준비한 다음 실행 중인 앱을 종료하고 교체합니다. 다운로드·컴파일·시작에 실패하면 기존 설치를 보존하거나 복원합니다. 제거하면 자동 실행 등록과 앱을 삭제하고 사용자 설정을 보관합니다. npm 패키지만 제거하면 데스크톱 앱은 계속 남습니다.

## Feature scope and validation

6가지 배치 선택기, 상단 드래그·가장자리 배치, 사용자 지정 단축키, 다중 모니터 이동·순환, 최대화·복귀, 창 간격, 한국어·영어 설정, 로그인 자동 실행을 제공합니다. Dock과 메뉴 막대를 제외한 작업 영역을 사용합니다.

GNOME의 Super 창 보기 연동, 최대화 버튼 호버, 축소 드래그 애니메이션, 함께 크기 조절, 남은 공간의 앱 선택은 GNOME판 기능입니다. macOS판에는 별도 창 목록이 없습니다. 창 이동·크기 변경을 막는 앱과 전체 화면 창은 배치 대상에서 제외하며, 앱의 최소 크기 때문에 요청한 배치보다 커질 수 있습니다.

Ubuntu 개발 환경에서 공통 계산, macOS 명령 분기, 네이티브 통신 대역, 설치·복구 및 npm 패키지를 검증했습니다. 실제 Chromium에서 선택기와 한국어 설정 UI도 검사했습니다. **실제 Mac에서의 창 조작은 실기 검증 전입니다.** CI는 Ubuntu와 macOS의 Node 테스트·패키지 빌드, macOS Swift 컴파일·읽기 전용 네이티브 프로토콜·UI 검사를 수행하도록 구성되어 있습니다.

## Files and diagnostics

앱은 `~/Library/Application Support/Tidy/desktop/Tidy.app`, 설정은 `~/Library/Application Support/Tidy/config/settings.json`에 저장합니다. 같은 Tidy 폴더의 `status.json`에 프로세스, 권한, 충돌 단축키와 최근 오류를 기록합니다. `tidy status`로 확인하고, 앱을 종료했다면 `tidy prefs`로 다시 실행하세요.

Mac에서 `node scripts/native-smoke.js`로 Swift 컴파일과 읽기 전용 프로토콜 검사를 실행합니다. 이 검사는 권한을 요청하거나 창을 이동하지 않습니다.

API 근거: [Electron 전역 단축키](https://www.electronjs.org/docs/latest/api/global-shortcut), [지원 OS 변경](https://www.electronjs.org/docs/latest/breaking-changes), [macOS AX 위치 좌표](https://developer.apple.com/documentation/applicationservices/kaxpositionattribute).
