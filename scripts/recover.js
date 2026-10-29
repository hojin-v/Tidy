import Gio from 'gi://Gio';
import {SettingsLease} from '../lib/overrides.js';

new SettingsLease(new Gio.Settings({schema_id: 'org.gnome.shell.extensions.winubun'}));
Gio.Settings.sync();
print('데스크톱 설정 복구 완료');
