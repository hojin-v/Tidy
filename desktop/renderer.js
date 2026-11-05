const mode = new URLSearchParams(location.search).get('mode');
const root = document.querySelector('#app');
document.body.className = mode;
if (mode === 'preview') document.documentElement.style.background = 'transparent';
else {
    const state = await window.tidy.state();
    document.documentElement.lang = state.language;
    const ko = state.language === 'ko';
    const text = (en, korean) => ko ? korean : en;
    const element = (tag, content, className) => {
        const node = document.createElement(tag);
        if (content) node.textContent = content;
        if (className) node.className = className;
        return node;
    };
    if (mode === 'picker') {
        root.append(element('div', text('Choose a layout · Esc to close', '배치를 고르세요 · Esc로 닫기'), 'hint'));
        const layouts = element('div', '', 'layouts');
        for (const layout of state.layouts) {
            const card = element('div');
            card.append(element('div', state.labels[layout.name] ?? layout.name, 'layout-label'));
            const diagram = element('div', '', 'diagram');
            for (const zone of layout.zones) {
                const [x, y, width, height] = state.zones[zone];
                const button = element('button', '', 'zone');
                button.dataset.zone = zone;
                button.setAttribute('aria-label', `${state.labels[layout.name] ?? layout.name}: ${zone}`);
                Object.assign(button.style, {left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%`});
                button.addEventListener('click', () => window.tidy.choose(zone));
                diagram.append(button);
            }
            card.append(diagram);
            layouts.append(card);
        }
        root.append(layouts);
        const regions = () => window.tidy.regions([...document.querySelectorAll('.zone')].map(node => {
            const {x, y, width, height} = node.getBoundingClientRect();
            return {zone: node.dataset.zone, x, y, width, height};
        }));
        // Prepare hit regions before the picker is shown; a hidden window may
        // not receive its first ResizeObserver notification until it paints.
        regions();
        new ResizeObserver(regions).observe(root);
        window.tidy.hover(zone => document.querySelectorAll('.zone').forEach(node => node.classList.toggle('selected', node.dataset.zone === zone)));
        document.addEventListener('keydown', event => { if (event.key === 'Escape') window.tidy.close(); });
    } else {
        root.append(element('h1', state.labels['Tidy Settings']));
        root.append(element('p', text('Use the menu bar icon or a shortcut to arrange the active window.', '메뉴 막대 아이콘이나 단축키로 현재 창을 배치합니다.')));
        const message = element('p', '', 'message');
        const refresh = async () => {
            const current = await window.tidy.state();
            message.textContent = [current.lastError, current.shortcutFailures.length ?
                `${text('Unavailable shortcuts', '사용할 수 없는 단축키')}: ${current.shortcutFailures.join(', ')}` : '',
            !current.trusted ? text('Allow Tidy in System Settings → Privacy & Security → Accessibility, then restart Tidy.',
                '시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 Tidy를 허용한 후 다시 실행하세요.') : ''].filter(Boolean).join('\n');
        };
        root.append(message);
        await refresh();
        window.tidy.changed(refresh);
        if (!state.trusted) {
            const permission = element('button', text('Open Accessibility permission', '손쉬운 사용 권한 요청'));
            permission.onclick = async () => { await window.tidy.permissions(); await refresh(); };
            root.append(permission);
        }
        const fields = {};
        for (const [key, title, type] of [
            ['gap', text('Window gap (px)', '창 사이 간격 (px)'), 'number'],
            ['dragPicker', text('Show picker when dragging to the top', '상단으로 끌어 배치 선택기 열기'), 'checkbox'],
            ['edgeSnap', text('Snap at screen edges', '화면 가장자리 배치'), 'checkbox'],
            ['openAtLogin', text('Start at login', '로그인 시 자동 실행'), 'checkbox'],
        ]) {
            const label = element('label', title, 'setting');
            const input = element('input');
            input.type = type;
            input.name = key;
            if (type === 'number') { input.min = 0; input.max = 64; input.value = state.settings[key]; }
            else input.checked = state.settings[key];
            fields[key] = input;
            label.append(input); root.append(label);
        }
        root.append(element('p', text('Shortcuts use Electron key names (e.g. Control+Alt+Left). Leave blank to disable.',
            '단축키는 Control+Alt+Left 형식으로 입력합니다. 비워 두면 사용하지 않습니다.')));
        const shortcuts = {};
        for (const action of state.actions) {
            const label = element('label', action.title, 'setting');
            const input = element('input', '', 'shortcut');
            input.type = 'text'; input.value = state.settings.shortcuts[action.id];
            input.spellcheck = false;
            shortcuts[action.id] = input;
            label.append(input); root.append(label);
        }
        const buttons = element('div', '', 'buttons');
        const save = element('button', text('Save', '저장'));
        save.onclick = async () => {
            try {
                save.disabled = true;
                await window.tidy.save({gap: Number(fields.gap.value), dragPicker: fields.dragPicker.checked,
                    edgeSnap: fields.edgeSnap.checked, openAtLogin: fields.openAtLogin.checked,
                    shortcuts: Object.fromEntries(Object.entries(shortcuts).map(([key, input]) => [key, input.value.trim()]))});
                message.textContent = text('Saved.', '저장했습니다.');
            } catch (error) { message.textContent = error.message; }
            finally { save.disabled = false; }
            window.scrollTo(0, 0);
        };
        const reset = element('button', text('Restore defaults', '기본값 불러오기'));
        reset.onclick = () => {
            for (const [key, input] of Object.entries(fields)) {
                if (input.type === 'checkbox') input.checked = state.defaults[key];
                else input.value = state.defaults[key];
            }
            for (const [key, input] of Object.entries(shortcuts)) input.value = state.defaults.shortcuts[key];
        };
        buttons.append(save, reset); root.append(buttons);
    }
}
