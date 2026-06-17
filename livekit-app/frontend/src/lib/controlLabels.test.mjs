import assert from 'node:assert/strict';
import { controlLabel } from './controlLabels.js';

assert.equal(controlLabel('fr', 'camera'), 'Caméra');
assert.equal(controlLabel('de', 'camera'), 'Kamera');
assert.equal(controlLabel('pt', 'microphone'), 'Microfone');
assert.equal(controlLabel('ja', 'camera'), 'カメラ');
assert.equal(controlLabel('zh-CN', 'microphone'), '麦克风');
assert.equal(controlLabel('ru', 'camera'), 'Camera');
