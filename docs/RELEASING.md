# npm release

Tidy는 **@hnode/tidy**라는 공개 npm 패키지로 배포합니다. `tidy` CLI, GNOME 확장 ZIP과 macOS 데스크톱 앱 소스를 포함합니다. 루트 패키지에는 런타임 npm 의존성이 없고, macOS의 명시적 `tidy install` 시 별도 사용자 폴더에 고정 버전의 Electron을 설치합니다. 확장 ZIP과 데스크톱 설치에는 GPL 소스와 라이선스 파일을 포함합니다.

현재 배포 준비 버전은 **0.20.1**입니다. macOS 설치·업데이트·제거, 메뉴 막대 선택기, Control+Option 단축키와 Swift Accessibility 창 제어를 포함합니다. GNOME의 남은 공간 선택기는 창별 실시간 미리보기와 제목을 표시하며, 확장 내부 버전은 **23**입니다. Mac의 실제 창 조작은 배포본을 받은 뒤 검증하며, 자동 검사 통과와 구분합니다.

## Prepare

Node.js 18 이상과 시스템 Python/PyGObject, GJS, GTK 4/libadwaita, `glib-compile-schemas`가 필요합니다.

```bash
npm test
npm run check
/usr/bin/python3 -m unittest discover -s tests -p 'test_*.py'
npm run test:package
npm pack --dry-run
npm pack --pack-destination dist
node tests/npm-package-smoke.js dist/hnode-tidy-0.20.1.tgz
sha256sum dist/hnode-tidy-0.20.1.tgz
```

`prepack`이 Node.js로 최신 소스의 확장 ZIP을 다시 빌드합니다. GNOME 배포용 tarball은 `glib-compile-schemas`가 있는 Linux에서 빌드해 컴파일한 스키마까지 검증하세요. macOS에서는 GLib 없이 소스 스키마를 포함한 ZIP을 만들 수 있습니다. 공개 파일은 `package.json`의 `files` 목록으로 제한합니다. `desktop/native/macos.swift`, UI와 공통 `lib/layouts.js`가 포함되는지 확인하세요. 로그, 테스트, `.npmrc`, 캐시, `node_modules`는 포함하지 않습니다. npm 패키지 설치 자체는 데스크톱 설정을 바꾸지 않으며 `postinstall`은 사용하지 않습니다.

패키지 테스트는 임시 npm 전역 경로와 XDG 디렉터리를 사용합니다. 실제 tarball에서 명령을 설치한 뒤 읽기 전용 패키지, 한국어·영어 도움말, 의존성 진단과 설치된 복구 도구 호출을 확인합니다. 데스크톱 작업은 격리된 대역으로 호출을 검사합니다. Python 테스트는 실제 ZIP 설치·설정 복구를 수행하고 Shell 통신만 대체합니다.

창 동작을 바꿨다면 별도 GNOME 세션에서도 확인합니다.

```bash
/usr/bin/python3 scripts/test-shell.py
TIDY_TEST_UBUNTU_DOCK=1 /usr/bin/python3 scripts/test-shell.py
```

## Publish

`@hnode` 사용자 계정 또는 해당 조직에 패키지를 게시할 권한이 필요합니다. 검증한 tarball을 그대로 게시합니다.

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish ./dist/hnode-tidy-0.20.1.tgz --access public --tag latest
npm view @hnode/tidy@0.20.1 version os dist.integrity --json
npm view @hnode/tidy dist-tags --json
```

npm이 요청하는 브라우저 로그인·2FA를 완료하세요. 같은 버전이 이미 게시되었으면 `package.json`의 버전을 올리고 다시 검증합니다. GNOME 런타임 JavaScript가 바뀌면 `metadata.json`의 확장 버전도 올립니다. npm CLI·Python 설치 도구·문서만 바뀌면 Shell 버전을 유지할 수 있습니다.

## Test the published package on Mac

Node.js 22.12 이상과 Xcode Command Line Tools가 필요합니다. 컴파일러가 없다면 `xcode-select --install`로 설치를 완료한 다음 진행하세요. 게시한 버전을 명시해 이전 `latest`나 전역 설치본과 혼동하지 않도록 합니다.

```sh
npx --yes @hnode/tidy@0.20.1 --version
npx --yes @hnode/tidy@0.20.1 doctor
npx --yes @hnode/tidy@0.20.1 install
npx --yes @hnode/tidy@0.20.1 status
```

첫 명령은 `0.20.1`을 출력해야 합니다. **시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용**에서 Tidy를 허용하세요. 메뉴 막대에서 Tidy를 종료하고 다음 명령으로 다시 실행하면 새 권한을 적용합니다.

```sh
npx --yes @hnode/tidy@0.20.1 prefs
```

TextEdit나 브라우저 같은 일반 창을 선택한 뒤 확인하세요.

- **Control+Option+←/→/↑/↓**로 절반 배치, **Control+Option+Space**로 선택기 열기, **Control+Option+Enter**로 최대화·이전 크기 복원
- 제목 표시줄을 화면 상단 중앙으로 끌어 배치 선택·취소, 좌우 가장자리 배치
- 외장 모니터가 있다면 같은 방향키 반복과 **Control+Option+N**으로 이동
- 설정의 간격·단축키 변경과 로그인 자동 실행, 다시 로그인한 뒤 동작

업데이트와 제거도 같은 공개 버전으로 확인할 수 있습니다.

```sh
npx --yes @hnode/tidy@0.20.1 update
npx --yes @hnode/tidy@0.20.1 uninstall
```

제거 후 앱과 로그인 자동 실행 등록이 없어지고 설정은 보관돼야 합니다. macOS 기본 타일링과 시스템 단축키는 변경하지 않습니다. 실패 시 `sw_vers`, `uname -m`, `node --version`과 `npx --yes @hnode/tidy@0.20.1 status` 결과를 기록하세요. 설치 실패 시 터미널에 출력된 오류도 함께 확인합니다.

## User commands

```bash
npm install -g @hnode/tidy
tidy install
tidy doctor
tidy prefs
tidy status
```

GNOME에서는 최초 설치·확장 코드 업데이트 후 한 번 다시 로그인합니다. macOS는 설치 후 바로 실행되며 손쉬운 사용 권한을 설정합니다. `npx @hnode/tidy@latest install`도 지원합니다. npm 패키지와 캐시를 삭제해도 설치된 확장·앱은 유지됩니다. macOS판을 게시하기 전에는 실제 Mac에서 창 배치·단축키·자동 실행·업데이트·제거도 검증하세요.

```bash
tidy uninstall
npm uninstall -g @hnode/tidy
```

확장을 먼저 제거해야 변경했던 GNOME 설정과 기존 타일링 확장을 복원할 수 있습니다. npm 패키지만 지우는 명령은 데스크톱 설정을 변경하지 않습니다. CLI가 없어도 README에 나온 설치된 Python 관리 도구로 제거할 수 있습니다.
