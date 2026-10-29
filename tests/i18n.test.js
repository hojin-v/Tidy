import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createTranslator, languageFor} from '../lib/i18nCore.js';

const catalogs = JSON.parse(readFileSync(new URL('../lib/translations.json', import.meta.url)));

test('language selection respects locale preference order and falls back to English', () => {
    assert.equal(languageFor(['ko_KR.UTF-8', 'ko', 'C']), 'ko');
    assert.equal(languageFor(['en_US.UTF-8', 'ko', 'C']), 'en');
    assert.equal(languageFor(['fr_FR.UTF-8', 'C']), 'en');
    assert.equal(languageFor(['C.UTF-8']), 'en');
    assert.equal(languageFor([]), 'en');
});

test('settings, actions and messages are translated with safe named placeholders', () => {
    const ko = createTranslator(catalogs, ['ko_KR']);
    const en = createTranslator(catalogs, ['en_GB']);
    assert.equal(ko('Tidy Settings'), 'Tidy 설정');
    assert.equal(en('Tidy Settings'), 'Tidy Settings');
    assert.equal(ko('Top-left quarter'), '왼쪽 위 ¼');
    assert.equal(ko('Fill remaining space · {count} slots', {count: 2}), '남은 공간 채우기 · 2칸');
    const message = 'Conflicts with the system shortcut “{shortcut}”. Choose another combination.';
    assert.equal(ko(message, {shortcut: '$&{name}'}), '시스템 단축키 “$&{name}”와 겹칩니다. 다른 조합을 입력하세요.');
    assert.equal(ko('New untranslated message'), 'New untranslated message');
});

test('translations preserve all interpolation fields', () => {
    const fields = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const [source, translated] of Object.entries(catalogs.ko)) {
        assert.ok(translated.length > 0, source);
        assert.deepEqual(fields(translated), fields(source), source);
    }
});
