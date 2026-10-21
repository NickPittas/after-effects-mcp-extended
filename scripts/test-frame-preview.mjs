import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/scripts/mcp-bridge-auto.jsx', 'utf8');
const helper = source.slice(source.indexOf('function aeCapturePreview('), source.indexOf('function captureViewerForChat('));
for (const failure of [null, 'template', 'render', 'copy']) {
  const jobs = [{ render: true }, { render: false }];
  const files = [];
  let removedFolder = false;
  class File {
    constructor(name) { this.fsName = name; this.name = name.split('/').at(-1); this.parent = { fsName: '/captures' }; }
    copy(destination) { assert.equal(destination, '/captures/result.png'); if (failure === 'copy') return false; return true; }
    remove() { files.splice(files.indexOf(this), 1); }
  }
  class Folder {
    constructor(name) { this.fsName = name; }
    create() { return true; }
    getFiles() { return [...files]; }
    remove() { removedFolder = true; }
  }
  const comp = { frameDuration: 1 / 25 };
  const outputModule = {
    applyTemplate(name) { assert.equal(name, '_HIDDEN X-Factor 8'); if (failure === 'template') throw Error('template'); },
  };
  const queue = {
    rendering: false,
    get numItems() { return jobs.length; },
    item(index) { return jobs[index - 1]; },
    items: { add(target) {
      assert.equal(target, comp);
      const job = { render: true, outputModule() { return outputModule; }, remove() { jobs.splice(jobs.indexOf(job), 1); } };
      jobs.push(job);
      return job;
    } },
    render() {
      assert.deepEqual(jobs.map(j => j.render), [false, false, true]);
      assert.equal(jobs[2].timeSpanStart, 2);
      assert.equal(jobs[2].timeSpanDuration, comp.frameDuration);
      if (failure === 'render') throw Error('render');
      files.push(new File('/temporary/frame_00050.png'));
    },
  };
  const project = { renderQueue: queue };
  Object.defineProperty(project, 'bitsPerChannel', { get() { return 32; }, set() { throw Error('Must preserve project precision'); } });
  const context = vm.createContext({ app: { project }, Folder, File, Date, Math, Error });
  vm.runInContext(helper, context);
  if (failure) assert.throws(() => context.aeCapturePreview(comp, 2, new File('/captures/result.png')));
  else assert.equal(context.aeCapturePreview(comp, 2, new File('/captures/result.png')), '/captures/result.png');
  assert.deepEqual(jobs.map(j => j.render), [true, false]);
  assert.equal(files.length, 0);
  assert.equal(removedFolder, true);
  queue.rendering = true;
  assert.throws(() => context.aeCapturePreview(comp, 2, new File('/captures/result.png')), /current render/);
}
assert.doesNotMatch(source, /comp\.saveFrameToPng\(/);
console.log('Frame preview: native precision, isolated queue, and failure cleanup passed.');
