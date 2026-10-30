# npm release

Tidy는 **@hnode/tidy**라는 공개 npm 패키지로 배포합니다. `tidy` CLI와 미리 빌드한 GNOME 확장 ZIP을 포함하며 런타임 npm 의존성은 없습니다. 확장 ZIP에는 GPL 소스와 복구 도구가 포함됩니다.

## Prepare

Node.js 18 이상과 시스템 Python/PyGObject, GJS, GTK 4/libadwaita, `glib-compile-schemas`가 필요합니다.

```bash
npm test
npm run check
/usr/bin/python3 -m unittest discover -s tests -p 'test_*.py'
npm run test:package
npm pack --dry-run
npm pack --pack-destination dist
node tests/npm-package-smoke.js dist/hnode-tidy-0.18.1.tgz
```

`prepack`이 최신 소스로 확장 ZIP을 다시 빌드합니다. 공개 파일은 `package.json`의 `files` 목록으로 제한합니다. 로그, 테스트, `.npmrc`, 캐시가 포함되지 않는지 확인하세요. npm 패키지 설치 자체는 데스크톱 설정을 바꾸지 않으며 `postinstall`은 사용하지 않습니다.

패키지 테스트는 임시 npm 전역 경로와 XDG 디렉터리를 사용합니다. 실제 tarball에서 명령을 설치한 뒤 읽기 전용 패키지, 한국어·영어 도움말, 의존성 진단과 설치된 복구 도구 호출을 확인합니다. 데스크톱 작업은 격리된 대역으로 호출을 검사합니다. Python 테스트는 실제 ZIP 설치·설정 복구를 수행하고 Shell 통신만 대체합니다.

창 동작을 바꿨다면 별도 GNOME 세션에서도 확인합니다.

```bash
/usr/bin/python3 scripts/test-shell.py
```

## Publish

`@hnode` 사용자 계정 또는 해당 조직에 패키지를 게시할 권한이 필요합니다. 검증한 tarball을 그대로 게시합니다.

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish ./dist/hnode-tidy-0.18.1.tgz --access public --tag latest
npm view @hnode/tidy version dist-tags --json
```

npm이 요청하는 브라우저 로그인·2FA를 완료하세요. 같은 버전이 이미 게시되었으면 `package.json`의 버전을 올리고 다시 검증합니다. GNOME 런타임 JavaScript가 바뀌면 `metadata.json`의 확장 버전도 올립니다. npm CLI·Python 설치 도구·문서만 바뀌면 Shell 버전을 유지할 수 있습니다.

## User commands

```bash
npm install -g @hnode/tidy
tidy install
tidy doctor
tidy prefs
tidy status
```

최초 설치·확장 코드 업데이트 후에는 한 번 다시 로그인합니다. `npx @hnode/tidy@latest install`도 지원합니다. npm 패키지와 캐시를 삭제해도 설치된 GNOME 확장은 유지됩니다.

```bash
tidy uninstall
npm uninstall -g @hnode/tidy
```

확장을 먼저 제거해야 변경했던 GNOME 설정과 기존 타일링 확장을 복원할 수 있습니다. npm 패키지만 지우는 명령은 데스크톱 설정을 변경하지 않습니다. CLI가 없어도 README에 나온 설치된 Python 관리 도구로 제거할 수 있습니다.
