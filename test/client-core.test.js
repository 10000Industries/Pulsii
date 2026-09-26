'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const { encodePulseBatch } = require('../lib/protocol');
const source = fs.readFileSync(require.resolve('../script'), 'utf8');

function browser({ pointer = true } = {}) {
  const elements = new Map();
  const drawing = [];
  const ctx = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'createRadialGradient') return (...args) => {
      drawing.push(['gradient', ...args]);
      return { addColorStop(...stop) { drawing.push(['stop', ...stop]); } };
    };
    return (...args) => drawing.push([key, ...args]);
  } });
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      style: {}, dataset: {}, value: '#123456', hidden: false, listeners: {},
      classList: { add() {}, remove() {} },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      getContext: () => ctx,
      getBoundingClientRect: () => ({left:0, top:0}),
      setPointerCapture() {}, releasePointerCapture() {}, focus() {}, showPicker() {},
    });
    return elements.get(id);
  };
  const sockets = [];
  class Socket {
    static OPEN = 1;
    constructor(url, protocol) { this.url = url; this.protocol = protocol; this.readyState = 0; this.listeners = {}; this.sent = []; sockets.push(this); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.listeners.open(); }
  }
  let clock = 0;
  const timers = [];
  const document = { getElementById: element, hidden:false, listeners:{}, addEventListener(name, fn) { this.listeners[name] = fn; } };
  const window = {location:{protocol:'https:',host:'pulsii-restoration-review.onrender.com',hostname:'pulsii-restoration-review.onrender.com',search:'?diagnostics=1'},devicePixelRatio:2,innerWidth:800,innerHeight:600,PointerEvent:pointer?function(){}:undefined,addEventListener(){},open(){}};
  const context = vm.createContext({document,window,WebSocket:Socket,URLSearchParams,ArrayBuffer,DataView,performance:{now:()=>clock},requestAnimationFrame(){},setTimeout(fn,ms){timers.push({fn,ms}); return timers.length;},clearTimeout(){},setInterval(){},clearInterval(){},console});
  vm.runInContext(source, context);
  return {context,element,ctx,drawing,sockets,timers,document,setTime(t){clock=t;},run(code){return vm.runInContext(code,context);}};
}

test('restored browser draws locally without waiting for an echo and receives peer batches', () => {
  const b = browser(); const socket = b.sockets[0]; socket.open();
  assert.equal(socket.protocol, 'pulsii-immediate-v1');
  assert.ok(socket.url.endsWith('/live'));
  const canvas=b.element('canvas');
  canvas.listeners.pointerdown({target:canvas,clientX:200,clientY:300});
  assert.equal(b.run('pulses.length'),1);
  assert.equal(socket.sent.length,1);
  assert.equal(socket.sent[0].xNorm,0.25);
  assert.equal(socket.sent[0].yNorm,0.5);
  const payload=encodePulseBatch({processEpoch:1,sequence:1,serverTimeMs:1000,pulses:[{type:'pulse',xNorm:0.75,yNorm:0.5,color:'#ab1234'}]});
  socket.listeners.message({data:payload.buffer.slice(payload.byteOffset,payload.byteOffset+payload.byteLength)});
  assert.equal(b.run('pulses.length'),2);
  assert.equal(canvas.dataset.received,'1');
});

test('preserves the original expanding radial glow and trailing fade', () => {
  const b = browser();
  b.run("spawnPulse(0.5,0.5,'#ff0000'); animate(50);");
  assert.equal(b.run('pulses[0].radius'),21);
  assert.equal(b.run('PULSE_LIFETIME'),1.4);
  assert.equal(b.run('MAX_PULSE_ALPHA'),0.22);
  assert.deepEqual(b.drawing.find(x=>x[0]==='gradient'),['gradient',400,300,0,400,300,21]);
  assert.deepEqual(b.drawing.filter(x=>x[0]==='stop'),[
    ['stop',0,'rgba(255, 0, 0, 0.9)'],['stop',0.4,'rgba(255, 0, 0, 0.5)'],['stop',1,'rgba(255, 0, 0, 0)'],
  ]);
  assert.equal(b.ctx.globalCompositeOperation,'source-over');
  assert.ok(Math.abs(b.ctx.globalAlpha - 0.22*Math.sin(Math.PI*0.05/1.4))<1e-12);
  assert.match(source,/rgba\(0, 0, 0, 0\.05\)/);
});

test('registers one input family and dragging the colour control does not send pulses', () => {
  for (const pointer of [true,false]) {
    const b=browser({pointer}); const c=b.element('canvas');
    assert.equal(Boolean(c.listeners.pointerdown),pointer);
    assert.equal(Boolean(c.listeners.touchstart),!pointer);
  }
  const b=browser(); b.sockets[0].open();
  const h=b.element('color-handle');
  const event={clientX:44,clientY:556,pointerId:1,stopPropagation(){},preventDefault(){}};
  h.listeners.pointerdown(event);
  h.listeners.pointermove({...event,clientX:144,clientY:456});
  h.listeners.pointerup({...event,clientX:144,clientY:456});
  assert.equal(h.style.left,'124px');
  assert.equal(h.style.top,'436px');
  assert.equal(b.sockets[0].sent.length,0);
});

test('bounds review sending, reports busy sharing and stops reconnecting at expiry', () => {
  const b=browser(); const s=b.sockets[0]; s.open();
  b.run("sendPulse(0.5,0.5,'#ffffff'); sendPulse(0.5,0.5,'#ffffff');");
  assert.equal(s.sent.length,2, 'no fixed cooldown between taps');
  b.setTime(50); b.run("sendPulse(0.5,0.5,'#ffffff');");
  assert.equal(s.sent.length,3);
  s.listeners.message({data:JSON.stringify({type:'busy',retryAfterMs:1000})});
  assert.match(b.element('connection-status').textContent,/not shared/);
  const before=b.timers.length;
  s.readyState=3; s.listeners.close({code:4000});
  assert.equal(b.timers.length,before);
  assert.equal(b.element('connection-status').textContent,'review ended');
  b.run('connectWebSocket()'); assert.equal(b.sockets.length,1);
});

test('hidden tabs clear stale pulses and malformed binary does not draw', () => {
  const b=browser(); b.sockets[0].open();
  b.run("spawnPulse(0.5,0.5,'#ffffff')");
  b.document.hidden=true; b.document.listeners.visibilitychange();
  assert.equal(b.run('pulses.length'),0);
  b.sockets[0].listeners.message({data:new ArrayBuffer(2)});
  assert.equal(b.run('pulses.length'),0);
});


test('admits twenty simultaneous taps and twenty per second without losing or delaying local pulses', () => {
  const b = browser(); const s = b.sockets[0]; s.open();
  const c = b.element('canvas');
  for (let i = 0; i < 20; i++) c.listeners.pointerdown({target:c,clientX:100+i,clientY:200,pointerId:i,pointerType:'touch'});
  assert.equal(s.sent.length,20);
  assert.equal(b.run('pulses.length'),20);
  // Refill rather than a mandatory cooldown: each 50ms tap is accepted.
  for (let i = 1; i <= 60; i++) {
    b.setTime(i*50);
    c.listeners.pointerdown({target:c,clientX:100+i,clientY:200});
  }
  assert.equal(s.sent.length,80);
  assert.equal(b.run('pulses.length'),80, 'old 64-pulse cap must not truncate this activity');
});

test('bounds scripted flooding and refills without disconnecting the browser', () => {
  const b=browser(); const s=b.sockets[0]; s.open();
  b.run("for(let i=0;i<100;i++) sendPulse(0.5,0.5,'#123456')");
  assert.equal(s.sent.length,20);
  assert.equal(b.run('pulses.length'),20);
  assert.match(b.element('connection-status').textContent,/too quickly/);
  b.setTime(50); b.run("sendPulse(0.5,0.5,'#123456')");
  assert.equal(s.sent.length,21);
  assert.equal(s.readyState,1);
});
