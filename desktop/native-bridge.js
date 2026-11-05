import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {join} from 'node:path';

export class NativeBridge {
    constructor(directory, {launch = spawn, ignorePid = process.pid} = {}) {
        this.ignorePid = ignorePid;
        this.pending = new Map();
        this.sequence = 0;
        this.child = launch(join(directory, 'tidy-native'), [], {stdio: ['pipe', 'pipe', 'pipe']});
        this.failure = null;
        this.stderr = '';
        this.child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-4000); });
        createInterface({input: this.child.stdout}).on('line', line => {
            let response;
            try { response = JSON.parse(line); } catch { return; }
            const pending = this.pending.get(response.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(response.id);
            if (response.error) pending.reject(new Error(response.error));
            else pending.resolve(response.result);
        });
        const fail = error => {
            this.failure = error;
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer);
                pending.reject(error);
            }
            this.pending.clear();
        };
        this.child.on('error', fail);
        this.child.stdin.on('error', fail);
        this.child.on('exit', () => fail(new Error(`Native window helper stopped. ${this.stderr}`)));
    }

    request(op, values = {}) {
        if (this.failure) return Promise.reject(this.failure);
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Native window helper timed out.'));
            }, 15000);
            this.pending.set(id, {resolve, reject, timer});
            this.child.stdin.write(`${JSON.stringify({id, op, ignorePid: this.ignorePid, ...values})}\n`);
        });
    }

    snapshot() { return this.request('snapshot'); }

    place(window, rect) {
        return this.request('place', {window: {id: window.id, pid: window.pid}, rect});
    }

    close() {
        if (this.closing) return this.closing;
        this.closing = new Promise(resolve => {
            if (this.failure) { resolve(); return; }
            const timer = setTimeout(() => { this.child.kill(); resolve(); }, 5000);
            this.child.once('exit', () => { clearTimeout(timer); resolve(); });
            // Let the native helper finish its requests before exiting on EOF.
            this.child.stdin.end();
        });
        return this.closing;
    }
}
