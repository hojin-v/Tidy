// Build the GNOME payload without Python/PyGObject or a Unix shell. Native installs
// need only desktop sources; Linux also compiles schemas when GLib is available.
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateRawSync} from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const table = Array.from({length: 256}, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});
function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
const compiled = spawnSync('glib-compile-schemas', ['--strict', join(root, 'schemas')], {encoding: 'utf8'});
if (compiled.error?.code !== 'ENOENT' && (compiled.error || compiled.status !== 0))
    throw compiled.error || new Error(compiled.stderr);
const files = ['LICENSE', 'NOTICE', 'metadata.json', 'extension.js', 'prefs.js', 'stylesheet.css',
    ...['lib', 'schemas'].flatMap(directory => readdirSync(join(root, directory)).filter(name =>
        !name.startsWith('.') && (directory !== 'schemas' || name !== 'gschemas.compiled' || !compiled.error))
        .map(name => `${directory}/${name}`)),
    ...['manage.py', 'i18n.py', 'recover.js'].map(name => `scripts/${name}`)];
const local = [], central = [];
let offset = 0;
for (const name of files) {
    const data = readFileSync(join(root, name));
    const compressed = deflateRawSync(data);
    const filename = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); // 1980-01-01; deterministic archives.
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    header.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, filename);
    offset += header.length + filename.length + compressed.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
mkdirSync(join(root, 'dist'), {recursive: true});
const uuid = JSON.parse(readFileSync(join(root, 'metadata.json'), 'utf8')).uuid;
writeFileSync(join(root, 'dist', `${uuid}.shell-extension.zip`), Buffer.concat([...local, directory, end]));
console.error(`Built GNOME payload${compiled.error ? ' (schemas compile during Linux installation)' : ''}.`);
