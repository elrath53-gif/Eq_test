/* eslint-disable @typescript-eslint/no-explicit-any */

interface AndroidBridgeAPI {
  hasMusicPermission?: () => boolean;
  requestMusicPermission?: () => void;
  rescanMusic?: () => void;
  updatePlaybackState?: (
    title: string,
    artist: string,
    isPlaying: boolean,
    positionMs: number,
    durationMs: number
  ) => void;
  vibrate?: (ms: number) => void;
  isIgnoringBatteryOptimizations?: () => boolean;
  openBatterySettings?: () => void;
}

declare global {
  interface Window {
    AndroidBridge?: AndroidBridgeAPI;
    webkitAudioContext?: typeof AudioContext;
    __onNativeTracks?: (tracksInput: unknown, reason?: string) => void;
    __onNativePermission?: (granted: boolean) => void;
    __nativeCmd?: (cmd: string, arg?: number) => void;
    __estudioEqBooted?: boolean;
  }
}

export function bootEstudioEQ(rootEl: HTMLElement): void {
  if (window.__estudioEqBooted) return;
  window.__estudioEqBooted = true;

  const NATIVE = typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge !== null;
  const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = rootEl): T | null =>
    r.querySelector<T>(s) || document.querySelector<T>(s);

  function h(tag: string, props?: Record<string, any> | null, ...kids: any[]): HTMLElement {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = String(v);
        else if (k === 'text') e.textContent = String(v);
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, String(v));
      }
    }
    for (const c of kids.flat()) {
      if (c != null && c !== false) {
        e.append(c.nodeType ? c : document.createTextNode(String(c)));
      }
    }
    return e;
  }

  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
  const dB = (x: number) => Math.pow(10, x / 20);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const fmtF = (f: number) => (f >= 1000 ? +(f / 1000).toFixed(2) + 'k' : String(f));
  const fmtHz = (f: number) => (f >= 1000 ? +(f / 1000).toFixed(2) + ' kHz' : f + ' Hz');
  const sgn = (v: number, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
  const mmss = (t: number) => {
    t = Math.max(0, t | 0);
    return ((t / 60) | 0) + ':' + String(t % 60).padStart(2, '0');
  };
  const normStr = (s: string) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  /* ---------- datos ---------- */
  const BANDS30 = [
    25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
  ];
  const BANDS16 = [40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 5000, 8000, 10000, 12500, 16000];
  const NAMES16 = [
    'Sub', 'Graves', 'Bajos', 'Cuerpo', 'Calidez', 'Barro', 'Medios', 'Voz',
    'Claridad', 'Nitidez', 'Dicción', 'Brillo', 'Agudos', 'Aire', 'Aire +', 'Ultra',
  ];
  const INST: Array<{ grp: string; name: string; items: Array<[string, string, number, number]> }> = [
    {
      grp: 'drums',
      name: 'Batería',
      items: [
        ['kick', 'Bombo', 60, 1.2],
        ['snareB', 'Caja · cuerpo', 200, 1.4],
        ['snareC', 'Caja · chasquido', 5000, 1.2],
        ['tomF', 'Tom de piso', 90, 1.5],
        ['tomM', 'Tom medio', 160, 1.5],
        ['tomH', 'Tom agudo', 250, 1.5],
        ['hat', 'Hi-hat', 9000, 1],
        ['cym', 'Platillos', 12000, 0.8],
      ],
    },
    {
      grp: 'guitar',
      name: 'Guitarras',
      items: [
        ['gBody', 'Guitarra · cuerpo', 250, 1.2],
        ['gPres', 'Guitarra · presencia', 3000, 1.2],
        ['gAc', 'Acústica · brillo', 6000, 1],
      ],
    },
    {
      grp: 'bass',
      name: 'Bajo',
      items: [
        ['bLow', 'Bajo · cuerpo', 80, 1.4],
        ['bAtk', 'Bajo · ataque', 900, 1.4],
      ],
    },
    {
      grp: 'voice',
      name: 'Voces',
      items: [
        ['vWarm', 'Voz · calidez', 200, 1.2],
        ['vPres', 'Voz · presencia', 3500, 1.2],
        ['vSib', 'Voz · sibilancia', 7000, 2],
        ['vAir', 'Voz · aire', 12000, 0.8],
      ],
    },
    {
      grp: 'keys',
      name: 'Teclas y piano',
      items: [
        ['kBody', 'Piano · cuerpo', 300, 1.2],
        ['kBri', 'Piano · brillo', 4500, 1],
      ],
    },
  ];
  const FXN: Record<string, string> = {
    tone: 'Tono y filtros',
    comp: 'Compresor',
    sat: 'Saturación',
    wid: 'Ancho estéreo',
    rev: 'Reverberación',
    dly: 'Eco / Delay',
    sp: 'Sonido 3D',
    sub: 'Subgraves potentes',
    glass: 'Resonancia de vidrios',
    harm: 'Armónicos de graves',
    trem: 'Temblor (trémolo)',
    vibr: 'Vibrato',
    hap: 'Vibración del teléfono',
  };

  function defState(): any {
    const inst: Record<string, { g: number; f: number; q: number }> = {};
    INST.forEach((g) => g.items.forEach(([id, , f, q]) => (inst[id] = { g: 0, f, q })));
    return {
      master: { pre: 0, vol: 0 },
      q30: 4.32,
      r30: 12,
      eq: Array(30).fill(0),
      q16: 2.8,
      r16: 12,
      cl: Array(16).fill(0),
      inst,
      fx: {
        tone: { bass: 0, bassF: 100, treb: 0, trebF: 8000, lc: 20, hc: 20000 },
        comp: { on: false, th: 0, ratio: 1, attack: 3, release: 250, knee: 0, makeup: 0 },
        sat: { on: false, drive: 0, mix: 0 },
        wid: { on: false, w: 0 },
        rev: { on: false, mix: 0, decay: 2, pre: 0, damp: 30, size: 50 },
        dly: { on: false, time: 250, fb: 0, mix: 0, tone: 8000 },
        sp: { on: false, mix: 0, az: 0, el: 0, dist: 1, rot: 0 },
        sub: { on: false, freq: 50, g: 0, q: 1.2 },
        glass: { on: false, freq: 90, g: 0, q: 6 },
        harm: { on: false, freq: 120, drive: 0, mix: 0 },
        trem: { on: false, rate: 5, depth: 0, shape: 0 },
        vibr: { on: false, rate: 5, depth: 0 },
        hap: { on: false, thr: 60, dur: 40, gap: 60, shake: 0 },
      },
      bypass: false,
      locks: {},
    };
  }

  const S = defState();
  const D = defState();

  function merge(t: any, s: any) {
    if (!s || typeof s !== 'object') return;
    for (const k in t) {
      if (!(k in s)) continue;
      if (t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], s[k]);
      else if (typeof t[k] === typeof s[k] && !Array.isArray(t[k])) t[k] = s[k];
    }
  }

  const SEC: Record<string, { n: string; get: (s: any) => any; set: (s: any, d: any) => void }> = {
    master: { n: 'Entrada y salida', get: (s) => clone(s.master), set: (s, d) => merge(s.master, d) },
    eq30: {
      n: 'EQ de 30 bandas',
      get: (s) => ({ eq: s.eq.slice(), q30: s.q30, r30: s.r30 }),
      set: (s, d) => {
        if (d && Array.isArray(d.eq) && d.eq.length === 30) s.eq = d.eq.map((v: any) => clamp(+v || 0, -24, 24));
        if (d && +d.q30) s.q30 = +d.q30;
        if (d && +d.r30) s.r30 = +d.r30;
      },
    },
    cl16: {
      n: '16 bandas de claridad',
      get: (s) => ({ cl: s.cl.slice(), q16: s.q16, r16: s.r16 }),
      set: (s, d) => {
        if (d && Array.isArray(d.cl) && d.cl.length === 16) s.cl = d.cl.map((v: any) => clamp(+v || 0, -24, 24));
        if (d && +d.q16) s.q16 = +d.q16;
        if (d && +d.r16) s.r16 = +d.r16;
      },
    },
  };

  INST.forEach((g) => {
    SEC[g.grp] = {
      n: g.name,
      get: (s) => {
        const o: Record<string, any> = {};
        g.items.forEach(([id]) => (o[id] = clone(s.inst[id])));
        return o;
      },
      set: (s, d) => {
        if (d) g.items.forEach(([id]) => { if (d[id]) merge(s.inst[id], d[id]); });
      },
    };
  });

  Object.keys(FXN).forEach((k) => {
    SEC[k] = { n: FXN[k], get: (s) => clone(s.fx[k]), set: (s, d) => merge(s.fx[k], d) };
  });

  const ORDER = [
    'master', 'eq30', 'cl16', 'drums', 'guitar', 'bass', 'voice', 'keys',
    'tone', 'comp', 'sat', 'wid', 'rev', 'dly', 'sp', 'sub', 'glass', 'harm', 'trem', 'vibr', 'hap',
  ];
  const getFull = () => {
    const o: Record<string, any> = {};
    ORDER.forEach((k) => (o[k] = SEC[k].get(S)));
    return o;
  };
  const resetSec = (k: string) => SEC[k].set(S, SEC[k].get(D));

  /* ---------- almacenamiento ---------- */
  const KEY = 'estudio-eq-v1';
  const LAST_TRACK_KEY = 'estudio-eq-last-track';
  const store: { last: any; presets: any[]; sec: Record<string, any[]> } = { last: null, presets: [], sec: {} };
  try {
    const r = localStorage.getItem(KEY);
    if (r) {
      const o = JSON.parse(r);
      if (o && typeof o === 'object') {
        store.last = o.last || null;
        store.presets = Array.isArray(o.presets) ? o.presets : [];
        store.sec = o.sec && typeof o.sec === 'object' ? o.sec : {};
      }
    }
  } catch (_e) {}

  let toastTimer: any = null;
  function toast(m: string) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = m;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
      return true;
    } catch (_e) {
      toast('Este navegador no permite guardar. Usa Exportar en Presets.');
      return false;
    }
  }

  let saveT: any;
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      store.last = { data: getFull(), bypass: S.bypass, locks: S.locks };
      persist();
    }, 500);
  }

  if (store.last && store.last.data) {
    ORDER.forEach((k) => {
      if (store.last.data[k]) SEC[k].set(S, store.last.data[k]);
    });
    S.bypass = !!store.last.bypass;
    S.locks = store.last.locks && typeof store.last.locks === 'object' ? store.last.locks : {};
  }

  const stamp = () => new Date().toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  /* ---------- audio ---------- */
  let ctx: AudioContext | null = null;
  let audio!: HTMLAudioElement;
  const N: Record<string, any> = {};
  let irKey = '';
  let irT: any = 0;
  let satDrive = -1;
  let harmDrive = -1;
  let vizDirty = true;

  const chain = (...n: AudioNode[]) => {
    for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]);
  };

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    audio = new Audio();
    audio.setAttribute('playsinline', '');
    audio.preload = 'auto';
    if (!AC) {
      toast('Este navegador no admite audio avanzado.');
      return;
    }
    ctx = new AC({ latencyHint: 'playback' });
    ctx.addEventListener('statechange', () => {
      if (audio && !audio.paused && ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    });
    const src = ctx.createMediaElementSource(audio);
    const g = (v = 1) => {
      const n = ctx!.createGain();
      n.gain.value = v;
      return n;
    };
    const bq = (t: BiquadFilterType, f: number, q = 0.7, gn = 0) => {
      const n = ctx!.createBiquadFilter();
      n.type = t;
      n.frequency.value = f;
      n.Q.value = q;
      n.gain.value = gn;
      return n;
    };
    N.pre = g();
    N.pre.channelCount = 2;
    N.pre.channelCountMode = 'explicit';
    N.pre.channelInterpretation = 'speakers';
    N.hp = bq('highpass', 20, 0.707);
    N.lp = bq('lowpass', 20000, 0.707);
    N.eq = BANDS30.map((f) => bq('peaking', f, 4.32));
    N.cl = BANDS16.map((f) => bq('peaking', f, 2.8));
    N.inst = {};
    INST.forEach((gr) => gr.items.forEach(([id, , f, q]) => (N.inst[id] = bq('peaking', f, q))));
    N.bass = bq('lowshelf', 100);
    N.treb = bq('highshelf', 8000);
    N.satDry = g();
    N.shaper = ctx.createWaveShaper();
    N.shaper.oversample = '4x';
    N.satWet = g(0);
    N.satSum = g();
    N.comp = ctx.createDynamicsCompressor();
    N.makeup = g();
    N.split = ctx.createChannelSplitter(2);
    N.mid = g(0.5);
    N.sL = g(0.5);
    N.sR = g(-0.5);
    N.sw = g(1);
    N.inv = g(-1);
    N.merge = ctx.createChannelMerger(2);
    N.spDry = g();
    N.pan = ctx.createPanner();
    N.pan.panningModel = 'HRTF';
    N.pan.distanceModel = 'inverse';
    N.pan.refDistance = 1;
    N.spWet = g(0);
    N.bus = g();
    N.busDry = g();
    N.preD = ctx.createDelay(1);
    N.conv = ctx.createConvolver();
    N.revWet = g(0);
    N.dly = ctx.createDelay(2);
    N.fb = g(0);
    N.dTone = bq('lowpass', 8000);
    N.dWet = g(0);
    N.fxSum = g();
    N.wet = g();
    N.direct = g(0);
    N.master = g();
    N.lim = ctx.createDynamicsCompressor();
    N.lim.threshold.value = -0.5;
    N.lim.knee.value = 0;
    N.lim.ratio.value = 20;
    N.lim.attack.value = 0.002;
    N.lim.release.value = 0.08;
    N.an = ctx.createAnalyser();
    N.an.fftSize = 2048;
    N.an.smoothingTimeConstant = 0.8;
    chain(src, N.pre, N.hp, N.lp, ...N.eq, ...N.cl, ...(Object.values(N.inst) as AudioNode[]), N.bass, N.treb);
    N.vSub = bq('peaking', 50, 1.2);
    N.vRes = bq('peaking', 90, 6);
    N.xIn = g();
    N.xLp = bq('lowpass', 120, 0.707);
    N.xSh = ctx.createWaveShaper();
    N.xSh.oversample = '4x';
    N.xWet = g(0);
    N.xSum = g();
    N.trem = g(1);
    N.tLfo = ctx.createOscillator();
    N.tG = g(0);
    N.vib = ctx.createDelay(0.05);
    N.vib.delayTime.value = 0.01;
    N.vLfo = ctx.createOscillator();
    N.vG = g(0);
    N.vOut = g();
    chain(N.treb, N.vSub, N.vRes, N.xIn, N.xSum);
    N.xIn.connect(N.xLp);
    chain(N.xLp, N.xSh, N.xWet, N.xSum);
    chain(N.xSum, N.trem, N.vib, N.vOut);
    N.tLfo.connect(N.tG);
    N.tG.connect(N.trem.gain);
    N.vLfo.connect(N.vG);
    N.vG.connect(N.vib.delayTime);
    N.tLfo.start();
    N.vLfo.start();
    N.vOut.connect(N.satDry);
    N.satDry.connect(N.satSum);
    N.vOut.connect(N.shaper);
    N.shaper.connect(N.satWet);
    N.satWet.connect(N.satSum);
    chain(N.satSum, N.comp, N.makeup, N.split);
    N.split.connect(N.mid, 0);
    N.split.connect(N.mid, 1);
    N.split.connect(N.sL, 0);
    N.split.connect(N.sR, 1);
    N.sL.connect(N.sw);
    N.sR.connect(N.sw);
    N.sw.connect(N.inv);
    N.mid.connect(N.merge, 0, 0);
    N.sw.connect(N.merge, 0, 0);
    N.mid.connect(N.merge, 0, 1);
    N.inv.connect(N.merge, 0, 1);
    N.merge.connect(N.spDry);
    N.merge.connect(N.pan);
    N.pan.connect(N.spWet);
    N.spDry.connect(N.bus);
    N.spWet.connect(N.bus);
    N.bus.connect(N.busDry);
    N.busDry.connect(N.fxSum);
    chain(N.bus, N.preD, N.conv, N.revWet, N.fxSum);
    N.bus.connect(N.dly);
    chain(N.dly, N.dTone, N.dWet, N.fxSum);
    N.dTone.connect(N.fb);
    N.fb.connect(N.dly);
    chain(N.fxSum, N.wet, N.master);
    src.connect(N.direct);
    N.direct.connect(N.master);
    chain(N.master, N.lim, N.an, ctx.destination);
  }

  const T = (p: AudioParam, v: number) => p.setTargetAtTime(v, ctx!.currentTime, 0.015);
  function curve(d: number) {
    const n = 2048;
    const c = new Float32Array(n);
    const k = 1 + d * 0.25;
    const nr = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      c[i] = Math.tanh(k * x) / nr;
    }
    return c;
  }
  function makeIR(dec: number, damp: number, size: number) {
    const sr = ctx!.sampleRate;
    const len = Math.max(64, Math.floor(sr * Math.max(0.1, dec)));
    const b = ctx!.createBuffer(2, len, sr);
    const a = 1 - (clamp(damp, 0, 100) / 100) * 0.96;
    const ex = 3 - (clamp(size, 0, 100) / 100) * 1.8;
    const att = Math.floor(sr * 0.004);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      let e = 0;
      for (let i = 0; i < len; i++) {
        lp += a * (Math.random() * 2 - 1 - lp);
        const v = lp * Math.pow(1 - i / len, ex) * (i < att ? 0.2 + (0.8 * i) / att : 1);
        d[i] = v;
        e += v * v;
      }
      const sc = 1 / Math.sqrt(e || 1);
      for (let i = 0; i < len; i++) d[i] *= sc;
    }
    return b;
  }

  function applyAll() {
    if (!ctx) return;
    T(N.pre.gain, dB(S.master.pre));
    T(N.master.gain, dB(S.master.vol));
    T(N.wet.gain, S.bypass ? 0 : 1);
    T(N.direct.gain, S.bypass ? 1 : 0);
    const t = S.fx.tone;
    T(N.hp.frequency, t.lc);
    T(N.lp.frequency, t.hc);
    T(N.bass.gain, t.bass);
    T(N.bass.frequency, t.bassF);
    T(N.treb.gain, t.treb);
    T(N.treb.frequency, t.trebF);
    S.eq.forEach((v: number, i: number) => {
      T(N.eq[i].gain, v);
      T(N.eq[i].Q, S.q30);
    });
    S.cl.forEach((v: number, i: number) => {
      T(N.cl[i].gain, v);
      T(N.cl[i].Q, S.q16);
    });
    for (const id in N.inst) {
      const p = S.inst[id];
      const n = N.inst[id];
      T(n.gain, p.g);
      T(n.frequency, p.f);
      T(n.Q, p.q);
    }
    const c = S.fx.comp;
    if (c.on) {
      T(N.comp.threshold, c.th);
      T(N.comp.knee, c.knee);
      T(N.comp.ratio, c.ratio);
      T(N.comp.attack, c.attack / 1000);
      T(N.comp.release, c.release / 1000);
      T(N.makeup.gain, dB(c.makeup));
    } else {
      T(N.comp.threshold, 0);
      T(N.comp.knee, 0);
      T(N.comp.ratio, 1);
      T(N.makeup.gain, 1);
    }
    const s = S.fx.sat;
    if (s.drive !== satDrive) {
      satDrive = s.drive;
      N.shaper.curve = curve(s.drive);
    }
    const sm = s.on ? s.mix / 100 : 0;
    T(N.satWet.gain, sm);
    T(N.satDry.gain, 1 - sm);
    const sb = S.fx.sub;
    T(N.vSub.gain, sb.on ? sb.g : 0);
    T(N.vSub.frequency, sb.freq);
    T(N.vSub.Q, sb.q);
    const gl = S.fx.glass;
    T(N.vRes.gain, gl.on ? gl.g : 0);
    T(N.vRes.frequency, gl.freq);
    T(N.vRes.Q, gl.q);
    const hm = S.fx.harm;
    if (hm.drive !== harmDrive) {
      harmDrive = hm.drive;
      N.xSh.curve = curve(hm.drive * 0.6);
    }
    T(N.xLp.frequency, hm.freq);
    T(N.xWet.gain, hm.on ? hm.mix / 100 : 0);
    const tr = S.fx.trem;
    N.tLfo.type = (['sine', 'triangle', 'square'][tr.shape] || 'sine') as OscillatorType;
    T(N.tLfo.frequency, tr.rate);
    const td = tr.on ? tr.depth / 100 : 0;
    T(N.trem.gain, 1 - td / 2);
    T(N.tG.gain, td / 2);
    const vb = S.fx.vibr;
    T(N.vLfo.frequency, vb.rate);
    T(N.vG.gain, vb.on ? vb.depth / 1000 : 0);
    const w = S.fx.wid;
    T(N.sw.gain, w.on ? clamp(1 + w.w / 100, 0, 3) : 1);
    const sp = S.fx.sp;
    const spm = sp.on ? sp.mix / 100 : 0;
    T(N.spWet.gain, spm);
    T(N.spDry.gain, 1 - spm);
    const r = S.fx.rev;
    T(N.revWet.gain, r.on ? (r.mix / 100) * 1.5 : 0);
    T(N.preD.delayTime, r.pre / 1000);
    const key = r.decay + '|' + r.damp + '|' + r.size;
    if (key !== irKey) {
      const first = !irKey;
      irKey = key;
      clearTimeout(irT);
      irT = setTimeout(() => {
        const q = S.fx.rev;
        N.conv.buffer = makeIR(q.decay, q.damp, q.size);
      }, first ? 0 : 140);
    }
    const d = S.fx.dly;
    T(N.dly.delayTime, d.time / 1000);
    T(N.fb.gain, d.on ? d.fb / 100 : 0);
    T(N.dWet.gain, d.on ? d.mix / 100 : 0);
    T(N.dTone.frequency, d.tone);
  }

  let spAz = 0;
  function placePan(dt: number) {
    if (!ctx) return;
    const sp = S.fx.sp;
    if (sp.on && sp.rot) spAz = (spAz + sp.rot * 6 * dt + 360) % 360;
    else spAz = sp.az;
    const a = (spAz * Math.PI) / 180;
    const e = (sp.el * Math.PI) / 180;
    const d = Math.max(0.1, sp.dist);
    const x = Math.sin(a) * Math.cos(e) * d;
    const y = Math.sin(e) * d;
    const z = -Math.cos(a) * Math.cos(e) * d;
    const p = N.pan;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
  }

  /* ---------- estado → interfaz ---------- */
  const syncers: Array<() => void> = [];
  function syncAll() {
    syncers.forEach((f) => f());
    paintBypass();
    vizDirty = true;
  }
  function commit() {
    applyAll();
    vizDirty = true;
    saveSoon();
  }
  const getP = (p: string) => p.split('.').reduce((o, k) => o[k], S);
  const getD = (p: string) => p.split('.').reduce((o, k) => o[k], D);
  function setP(p: string, v: any) {
    const ks = p.split('.');
    const l = ks.pop()!;
    ks.reduce((o, k) => o[k], S)[l] = v;
  }
  const decs = (st: number) => {
    const s = String(st);
    return s.includes('.') ? s.split('.')[1].length : 0;
  };
  function holdBtn(btn: HTMLElement, fn: () => void) {
    let t: any;
    let iv: any;
    const stop = () => {
      clearTimeout(t);
      clearInterval(iv);
    };
    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button > 0) return;
      e.preventDefault();
      fn();
      t = setTimeout(() => {
        iv = setInterval(fn, 70);
      }, 420);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('click', (e: MouseEvent) => {
      if (e.detail === 0) fn();
    });
  }
  function row(path: string, label: string, o: any) {
    const dec = decs(o.step);
    const fine = o.fine || o.step;
    const num = h('input', {
      type: 'number',
      class: 'num in',
      id: 'n_' + path,
      step: o.step,
      min: o.min,
      max: o.max,
      inputmode: 'decimal',
      'aria-label': label,
    }) as HTMLInputElement;
    const rng = h('input', {
      type: 'range',
      id: 'r_' + path,
      'aria-label': label + ' (deslizador)',
      min: o.log ? 0 : o.min,
      max: o.log ? 1000 : o.max,
      step: o.log ? 1 : o.step,
    }) as HTMLInputElement;
    const toS = (v: number) => (o.log ? Math.round((1000 * Math.log(v / o.min)) / Math.log(o.max / o.min)) : v);
    const fromS = (s: string | number) => {
      if (!o.log) return +s;
      const v = o.min * Math.pow(o.max / o.min, +s / 1000);
      return o.step >= 1 ? Math.round(v) : +v.toFixed(dec);
    };
    const show = () => {
      const v = getP(path);
      num.value = v.toFixed(dec);
      rng.value = String(toS(v));
    };
    const set = (raw: string | number) => {
      let v = clamp(+raw, o.min, o.max);
      if (!isFinite(v)) return show();
      v = +(Math.round(v / o.step) * o.step).toFixed(dec);
      setP(path, v);
      show();
      commit();
    };
    num.addEventListener('change', () => set(num.value));
    rng.addEventListener('input', () => set(fromS(rng.value)));
    const minus = h('button', { class: 'step', 'aria-label': 'Restar ' + label, type: 'button', text: '−' });
    const plus = h('button', { class: 'step', 'aria-label': 'Sumar ' + label, type: 'button', text: '+' });
    holdBtn(minus, () => set(getP(path) - fine));
    holdBtn(plus, () => set(getP(path) + fine));
    const rst = h('button', {
      class: 'rst',
      'aria-label': 'Volver ' + label + ' a su valor inicial',
      type: 'button',
      text: '↺',
      onclick: () => set(getD(path)),
    });
    syncers.push(show);
    show();
    return h(
      'div',
      { class: 'prow' },
      h(
        'div',
        { class: 'ptop' },
        h('label', { class: 'pl', for: 'n_' + path, text: label }),
        h('span', { class: 'pv' }, num, h('span', { class: 'u', text: o.unit || '' }))
      ),
      h('div', { class: 'pctl' }, minus, rng, plus, rst)
    );
  }

  const ICON_LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>';
  const ICON_OPEN = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/></svg>';

  function card(key: string, title: string, opt: { on?: boolean } = {}) {
    const c = h('div', { class: 'card' });
    const body = h('div', { class: 'cbody' }) as HTMLElement & { inert?: boolean };
    const head = h('div', { class: 'chead' }, h('h2', { text: title }));
    let sw: HTMLElement | null = null;
    if (opt.on) {
      sw = h(
        'button',
        {
          class: 'sw',
          role: 'switch',
          type: 'button',
          'aria-label': 'Activar ' + title,
          onclick: () => {
            S.fx[key].on = !S.fx[key].on;
            syncAll();
            commit();
          },
        },
        h('i')
      );
      head.append(sw);
    }
    const lock = h('button', {
      class: 'ib',
      type: 'button',
      onclick: () => {
        S.locks[key] = !S.locks[key];
        if (!S.locks[key]) delete S.locks[key];
        syncAll();
        saveSoon();
        toast(S.locks[key] ? title + ' bloqueado' : title + ' desbloqueado');
      },
    });
    const save = h('button', {
      class: 'ib',
      type: 'button',
      'aria-label': 'Guardar ajuste de ' + title,
      text: 'Guardar',
      onclick: () => saveSection(key),
    });
    const rs = h('button', {
      class: 'ib',
      type: 'button',
      'aria-label': 'Poner ' + title + ' en cero',
      text: 'Cero',
      onclick: () => {
        resetSec(key);
        syncAll();
        commit();
        toast(title + ' en cero');
      },
    });
    head.append(lock, save, rs);
    c.append(head, body);
    syncers.push(() => {
      const l = !!S.locks[key];
      c.classList.toggle('locked', l);
      body.inert = l;
      lock.setAttribute('aria-pressed', String(l));
      lock.setAttribute('aria-label', (l ? 'Desbloquear ' : 'Bloquear ') + title);
      lock.innerHTML = (l ? ICON_LOCK : ICON_OPEN) + '<span>' + (l ? 'Bloqueado' : 'Libre') + '</span>';
      if (sw) sw.setAttribute('aria-checked', String(!!S.fx[key].on));
    });
    return { c, body, head };
  }

  /* ---------- analizador ---------- */
  const cv = $<HTMLCanvasElement>('#viz')!;
  const c2 = cv.getContext('2d')!;
  const FF = Float32Array.from({ length: 200 }, (_, i) => 20 * Math.pow(1000, i / 199));
  let resp: number[] | null = null;
  let accC = '#22F3FF';
  let fgC = '#EDEBF5';
  let freqData: Uint8Array<ArrayBuffer> | null = null;

  function calcResp() {
    if (!ctx) return;
    const mag = new Float32Array(200).fill(1);
    const tmp = new Float32Array(200);
    const ph = new Float32Array(200);
    const list: BiquadFilterNode[] = [
      N.hp, N.lp, ...N.eq, ...N.cl, ...(Object.values(N.inst) as BiquadFilterNode[]), N.bass, N.treb, N.vSub, N.vRes,
    ];
    for (const f of list) {
      f.getFrequencyResponse(FF, tmp, ph);
      for (let i = 0; i < 200; i++) mag[i] *= tmp[i];
    }
    resp = Array.from(mag, (m) => 20 * Math.log10(Math.max(m, 1e-4)));
    vizDirty = false;
  }

  function sampleSpectrum() {
    if (ctx && N.an) {
      if (!freqData) freqData = new Uint8Array(N.an.frequencyBinCount);
      N.an.getByteFrequencyData(freqData);
    }
  }

  function drawViz() {
    sampleSpectrum();
    if (document.hidden) return;
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr);
    const hh = Math.round(r.height * dpr);
    if (!w || !hh) return;
    if (cv.width !== w || cv.height !== hh) {
      cv.width = w;
      cv.height = hh;
    }
    c2.clearRect(0, 0, w, hh);
    c2.strokeStyle = 'rgba(170,167,192,.28)';
    c2.lineWidth = 1;
    c2.beginPath();
    c2.moveTo(0, hh / 2);
    c2.lineTo(w, hh / 2);
    c2.stroke();
    if (ctx && N.an && freqData) {
      const nb = 80;
      const sr = ctx.sampleRate;
      const bw = w / nb;
      c2.fillStyle = accC;
      c2.globalAlpha = 0.55;
      for (let i = 0; i < nb; i++) {
        const f0 = 20 * Math.pow(1000, i / nb);
        const f1 = 20 * Math.pow(1000, (i + 1) / nb);
        const a = Math.floor((f0 / (sr / 2)) * freqData.length);
        const b = Math.max(a + 1, Math.ceil((f1 / (sr / 2)) * freqData.length));
        let m = 0;
        for (let k = a; k < b && k < freqData.length; k++) m = Math.max(m, freqData[k]);
        const bh = (m / 255) * hh * 0.95;
        c2.fillRect(i * bw + 1, hh - bh, Math.max(1, bw - 2), bh);
      }
      c2.globalAlpha = 1;
      if (vizDirty) calcResp();
      if (resp) {
        c2.strokeStyle = fgC;
        c2.lineWidth = 2 * dpr;
        c2.beginPath();
        for (let i = 0; i < 200; i++) {
          const x = (i / 199) * w;
          const y = hh / 2 - (clamp(resp[i], -18, 18) / 18) * (hh / 2) * 0.9;
          if (i) c2.lineTo(x, y);
          else c2.moveTo(x, y);
        }
        c2.stroke();
      }
    }
    c2.fillStyle = 'rgba(170,167,192,.9)';
    c2.font = 10 * dpr + 'px ' + getComputedStyle(document.body).getPropertyValue('--f-num');
    (
      [
        ['100', 100],
        ['1k', 1000],
        ['10k', 10000],
      ] as Array<[string, number]>
    ).forEach(([t, f]) => {
      const x = (Math.log(f / 20) / Math.log(1000)) * w;
      c2.fillText(t, x + 3 * dpr, hh - 4 * dpr);
    });
    c2.fillText('+18 dB', 4 * dpr, 12 * dpr);
    c2.fillText('−18', 4 * dpr, hh - 4 * dpr);
  }

  /* ---------- pestañas EQ (30 y 16 bandas) ---------- */
  function eqTab(cfg: {
    key: string;
    arr: string;
    rk: string;
    qk: string;
    freqs: number[];
    names: string[] | null;
    title: string;
    hint: string;
  }) {
    const { c, body } = card(cfg.key, cfg.title);
    const arr = (): number[] => S[cfg.arr];
    const rg = (): number => S[cfg.rk];
    let sel = 0;
    let fineOn = false;
    body.append(h('p', { class: 'hint', text: cfg.hint }));
    const rchips = h('div', { class: 'chips' });
    [6, 12, 24].forEach((r) => {
      const b = h('button', {
        class: 'chip',
        type: 'button',
        text: '±' + r + ' dB',
        onclick: () => {
          if (arr().some((v) => Math.abs(v) > r)) {
            toast('Hay bandas fuera de ±' + r + ' dB');
            return;
          }
          S[cfg.rk] = r;
          syncAll();
          commit();
        },
      });
      b.dataset.r = String(r);
      rchips.append(b);
    });
    const fineChip = h('button', {
      class: 'chip',
      type: 'button',
      text: 'Precisión ×5',
      'aria-pressed': 'false',
      onclick: () => {
        fineOn = !fineOn;
        fineChip.setAttribute('aria-pressed', String(fineOn));
      },
    });
    body.append(h('div', { class: 'chips' }, rchips.children.length ? [...Array.from(rchips.children)] : [], fineChip));
    const strip = h('div', { class: 'strip', role: 'group', 'aria-label': cfg.title });
    const cols: HTMLElement[] = [];
    const vals: HTMLElement[] = [];
    const fills: HTMLElement[] = [];
    const thumbs: HTMLElement[] = [];

    function paint(i: number) {
      const v = arr()[i];
      const r = rg();
      const p = ((v / r + 1) / 2) * 100;
      thumbs[i].style.top = 100 - p + '%';
      if (v >= 0) {
        fills[i].style.top = 100 - p + '%';
        fills[i].style.height = p - 50 + '%';
      } else {
        fills[i].style.top = '50%';
        fills[i].style.height = 50 - p + '%';
      }
      vals[i].textContent = (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
      const tr = cols[i].querySelector('.btrack')!;
      tr.setAttribute('aria-valuenow', String(v));
      tr.setAttribute('aria-valuemin', String(-r));
      tr.setAttribute('aria-valuemax', String(r));
    }
    function paintAll() {
      arr().forEach((_, i) => paint(i));
      cols.forEach((colEl, i) => colEl.classList.toggle('sel', i === sel));
      body.querySelectorAll<HTMLElement>('[data-r]').forEach((b) =>
        b.setAttribute('aria-pressed', String(+(b.dataset.r || 0) === rg()))
      );
      updFine();
    }
    function setBand(i: number, v: number) {
      arr()[i] = clamp(r1(v), -rg(), rg());
      paint(i);
      updFine();
      commit();
    }
    function select(i: number, scroll?: boolean) {
      sel = clamp(i, 0, cfg.freqs.length - 1);
      cols.forEach((colEl, k) => colEl.classList.toggle('sel', k === sel));
      updFine();
      if (scroll) cols[sel].scrollIntoView({ inline: 'center', block: 'nearest' });
    }

    cfg.freqs.forEach((f, i) => {
      const val = h('span', { class: 'bv num' });
      const fill = h('div', { class: 'bfill' });
      const thumb = h('div', { class: 'bthumb' });
      const bin = h('div', { class: 'bin' }, h('div', { class: 'brail' }), h('div', { class: 'bzero' }), fill, thumb);
      const track = h(
        'div',
        {
          class: 'btrack',
          tabindex: '0',
          role: 'slider',
          'aria-label': 'Banda ' + fmtHz(f) + (cfg.names ? ' ' + cfg.names[i] : ''),
          'aria-orientation': 'vertical',
          'aria-valuetext': '',
        },
        bin
      );
      let drag: { y: number; v: number; h: number } | null = null;
      const fromY = (e: PointerEvent) => {
        const rc = bin.getBoundingClientRect();
        return (1 - clamp((e.clientY - rc.top) / rc.height, 0, 1)) * 2 - 1;
      };
      track.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button > 0) return;
        select(i);
        track.setPointerCapture(e.pointerId);
        drag = { y: e.clientY, v: arr()[i], h: bin.getBoundingClientRect().height };
        if (!fineOn) setBand(i, fromY(e) * rg());
      });
      track.addEventListener('pointermove', (e: PointerEvent) => {
        if (!drag) return;
        if (fineOn) setBand(i, drag.v + (((drag.y - e.clientY) / drag.h) * 2 * rg()) / 5);
        else setBand(i, fromY(e) * rg());
      });
      const end = () => {
        drag = null;
      };
      track.addEventListener('pointerup', end);
      track.addEventListener('pointercancel', end);
      track.addEventListener('keydown', (e: KeyboardEvent) => {
        const st = e.shiftKey ? 1 : 0.1;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault();
          setBand(i, arr()[i] + st);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault();
          setBand(i, arr()[i] - st);
        } else if (e.key === 'Home') {
          e.preventDefault();
          setBand(i, 0);
        }
      });
      const col = h(
        'div',
        { class: 'bcol' },
        val,
        track,
        h('span', { class: 'bf num', text: fmtF(f) }),
        cfg.names ? h('span', { class: 'bn', text: cfg.names[i] }) : null
      );
      cols.push(col);
      vals.push(val);
      fills.push(fill);
      thumbs.push(thumb);
      strip.append(col);
    });
    body.append(strip);

    const fname = h('div', { class: 'fname' });
    const fval = h('div', { class: 'fval num' });
    const prev = h('button', { class: 'btn', type: 'button', 'aria-label': 'Banda anterior', text: '◀', onclick: () => select(sel - 1, true) });
    const next = h('button', { class: 'btn', type: 'button', 'aria-label': 'Banda siguiente', text: '▶', onclick: () => select(sel + 1, true) });
    const fnum = h('input', {
      type: 'number',
      class: 'num in',
      id: 'fn_' + cfg.key,
      step: 0.1,
      inputmode: 'decimal',
      'aria-label': 'Ganancia exacta de la banda seleccionada',
    }) as HTMLInputElement;
    fnum.addEventListener('change', () => {
      const v = parseFloat(fnum.value);
      if (isFinite(v)) setBand(sel, v);
      else updFine();
    });
    const adj = (d: number, t: string) => {
      const b = h('button', { class: 'btn', type: 'button', text: t, 'aria-label': (d > 0 ? 'Subir ' : 'Bajar ') + Math.abs(d) + ' dB' });
      holdBtn(b, () => setBand(sel, arr()[sel] + d));
      return b;
    };
    const frow = h(
      'div',
      { class: 'frow' },
      adj(-1, '−1'),
      adj(-0.1, '−0.1'),
      fnum,
      adj(0.1, '+0.1'),
      adj(1, '+1'),
      h('button', { class: 'btn', type: 'button', text: '0', onclick: () => setBand(sel, 0) })
    );
    function updFine() {
      const f = cfg.freqs[sel];
      fname.textContent = fmtHz(f) + (cfg.names ? ' · ' + cfg.names[sel] : '');
      const v = arr()[sel];
      fval.textContent = sgn(v) + ' dB';
      fnum.value = v.toFixed(1);
      fnum.max = String(rg());
      fnum.min = String(-rg());
    }
    body.append(h('div', { class: 'fine' }, h('div', { class: 'fnav' }, prev, h('div', { class: 'mid' }, fname, fval), next), frow));
    body.append(row(cfg.qk, 'Ancho de banda (Q)', { min: 0.3, max: 20, step: 0.01, fine: 0.01, unit: 'Q' }));
    body.append(
      h(
        'div',
        { class: 'chips', style: 'margin-top:8px' },
        h('button', {
          class: 'btn',
          type: 'button',
          text: 'Aplanar',
          onclick: () => {
            arr().fill(0);
            paintAll();
            commit();
          },
        }),
        h('button', {
          class: 'btn',
          type: 'button',
          text: 'Suavizar curva',
          onclick: () => {
            const a = arr();
            const n = a.map((v, i) => r1((a[i - 1] ?? v) * 0.25 + v * 0.5 + (a[i + 1] ?? v) * 0.25));
            n.forEach((v, i) => (a[i] = v));
            paintAll();
            commit();
          },
        })
      )
    );
    syncers.push(paintAll);
    return c;
  }

  /* ---------- reproductor + biblioteca automática ---------- */
  interface TrackItem {
    id: string | number;
    name: string;
    artist: string;
    duration: number;
    dateAdded: number;
    url: string;
  }

  const PL: TrackItem[] = [];
  let nativeRaw: TrackItem[] = [];
  let cur = -1;
  let repeat = 0;
  let shuffle = false;
  let seeking = false;
  let searchQ = '';
  let sortMode: 'recent' | 'az' = 'recent';
  let hasPerm = !NATIVE;
  let lastNotifSync = 0;

  const REP = ['Repetir: no', 'Repetir: todo', 'Repetir: una'];
  function isAudioFile(f: File) {
    return (f.type && f.type.startsWith('audio')) || /\.(mp3|m4a|aac|wav|flac|ogg|opus|weba|aif|aiff)$/i.test(f.name);
  }
  function addFiles(files: FileList | null) {
    if (!files) return;
    let n = 0;
    for (const f of Array.from(files)) {
      if (!isAudioFile(f)) continue;
      PL.push({
        id: 'local_' + Date.now() + '_' + n,
        name: f.name.replace(/\.[^.]+$/, ''),
        artist: '',
        duration: 0,
        dateAdded: Date.now() / 1000,
        url: URL.createObjectURL(f),
      });
      n++;
    }
    renderList();
    if (!n) {
      toast('No encontré archivos de audio');
      return;
    }
    toast(n + ' pista' + (n > 1 ? 's' : '') + ' añadida' + (n > 1 ? 's' : ''));
    if (cur < 0) loadTrack(0, false);
  }

  function syncMediaSession(force: boolean) {
    const t = PL[cur];
    if (!t || !audio) return;
    const now = performance.now();
    if (!force && now - lastNotifSync < 950) return;
    lastNotifSync = now;
    if (NATIVE && window.AndroidBridge?.updatePlaybackState) {
      try {
        window.AndroidBridge.updatePlaybackState(
          t.name || 'Estudio EQ',
          t.artist || 'Estudio EQ',
          !audio.paused,
          Math.floor((audio.currentTime || 0) * 1000),
          Math.floor((audio.duration || t.duration || 0) * 1000)
        );
      } catch (_e) {}
    }
    if ('mediaSession' in navigator) {
      try {
        if (force || !navigator.mediaSession.metadata || navigator.mediaSession.metadata.title !== t.name) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: t.name || 'Estudio EQ',
            artist: t.artist || 'Estudio EQ',
            album: 'Estudio EQ',
            artwork: [
              { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            ],
          });
        }
        navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
        if (audio.duration && isFinite(audio.duration) && typeof navigator.mediaSession.setPositionState === 'function') {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: Math.min(audio.currentTime || 0, audio.duration),
          });
        }
      } catch (_e) {}
    }
  }

  function loadTrack(i: number, play: boolean) {
    if (!PL[i]) return;
    const sameUrl = cur === i && audio.src === PL[i].url;
    cur = i;
    if (!sameUrl) {
      audio.src = PL[i].url;
    }
    const label = PL[i].artist ? PL[i].name + ' · ' + PL[i].artist : PL[i].name;
    const dTitle = $('#dTitle');
    if (dTitle) dTitle.textContent = label;
    try {
      if (PL[i].id != null) localStorage.setItem(LAST_TRACK_KEY, String(PL[i].id));
    } catch (_e) {}
    renderList();
    if (play) playNow();
    else syncMediaSession(true);
  }

  async function playNow() {
    try {
      if (ctx && ctx.state !== 'running') await ctx.resume();
      await audio.play();
      syncMediaSession(true);
    } catch (_e) {
      toast('No se pudo reproducir esta pista');
    }
  }

  function nextTrack(auto: boolean) {
    if (!PL.length) return;
    let i: number;
    if (shuffle && PL.length > 1) {
      do {
        i = Math.floor(Math.random() * PL.length);
      } while (i === cur);
    } else {
      i = cur + 1;
      if (i >= PL.length) {
        if (auto && repeat !== 1) {
          syncMediaSession(true);
          return;
        }
        i = 0;
      }
    }
    loadTrack(i, true);
  }

  function prevTrack() {
    if (!PL.length) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      syncMediaSession(true);
      return;
    }
    loadTrack((cur - 1 + PL.length) % PL.length, true);
  }

  function applyNativeSortAndRebuild(reason: string) {
    const prevTrackObj = cur >= 0 ? PL[cur] : null;
    const prevCount = PL.length;
    const sorted = nativeRaw.slice().sort((a, b) => {
      if (sortMode === 'az') return String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' });
      return (b.dateAdded || 0) - (a.dateAdded || 0);
    });
    PL.length = 0;
    for (const item of sorted) PL.push(item);
    if (prevTrackObj) {
      const idx = PL.findIndex((x) => String(x.id) === String(prevTrackObj.id) || x.url === prevTrackObj.url);
      cur = idx >= 0 ? idx : PL.length ? 0 : -1;
    } else if (PL.length) {
      let savedId: string | null = null;
      try {
        savedId = localStorage.getItem(LAST_TRACK_KEY);
      } catch (_e) {}
      const savedIdx = savedId ? PL.findIndex((x) => String(x.id) === String(savedId)) : -1;
      loadTrack(savedIdx >= 0 ? savedIdx : 0, false);
    } else {
      cur = -1;
      const dTitle = $('#dTitle');
      if (dTitle) dTitle.textContent = 'Sin pista';
    }
    renderList();
    if (reason === 'observer' && PL.length > prevCount && prevCount > 0) {
      const diff = PL.length - prevCount;
      toast(diff === 1 ? 'Nueva canción detectada y añadida' : '+' + diff + ' canciones nuevas detectadas');
    }
  }

  window.__onNativeTracks = (tracksInput: unknown, reason?: string) => {
    try {
      const arr = typeof tracksInput === 'string' ? JSON.parse(tracksInput) : tracksInput;
      if (!Array.isArray(arr)) return;
      hasPerm = true;
      nativeRaw = arr.map((t: any) => ({
        id: t.id,
        name: t.name || 'Sin título',
        artist: t.artist || '',
        duration: +t.duration || 0,
        dateAdded: +t.dateAdded || 0,
        url: t.url,
      }));
      applyNativeSortAndRebuild(reason || 'init');
      updPermBanner();
    } catch (_e) {}
  };

  window.__onNativePermission = (granted: boolean) => {
    hasPerm = !!granted;
    updPermBanner();
    renderList();
  };

  window.__nativeCmd = (cmd: string, arg?: number) => {
    if (!PL.length) return;
    if (cmd === 'play') {
      if (cur < 0) loadTrack(0, true);
      else playNow();
    } else if (cmd === 'pause') {
      audio.pause();
      syncMediaSession(true);
    } else if (cmd === 'toggle') {
      if (audio.paused) {
        if (cur < 0) loadTrack(0, true);
        else playNow();
      } else {
        audio.pause();
        syncMediaSession(true);
      }
    } else if (cmd === 'next') {
      nextTrack(false);
    } else if (cmd === 'prev') {
      prevTrack();
    } else if (cmd === 'seek') {
      if (arg !== undefined && isFinite(+arg)) {
        audio.currentTime = clamp(+arg / 1000, 0, audio.duration || 0);
        syncMediaSession(true);
      }
    }
  };

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => window.__nativeCmd?.('play'));
      navigator.mediaSession.setActionHandler('pause', () => window.__nativeCmd?.('pause'));
      navigator.mediaSession.setActionHandler('previoustrack', () => window.__nativeCmd?.('prev'));
      navigator.mediaSession.setActionHandler('nexttrack', () => window.__nativeCmd?.('next'));
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if (d && typeof d.seekTime === 'number') {
          audio.currentTime = d.seekTime;
          syncMediaSession(true);
        }
      });
    } catch (_e) {}
  }

  let countBadge: HTMLElement | null = null;
  let permBox: HTMLElement | null = null;
  let batBtn: HTMLElement | null = null;

  function updPermBanner() {
    if (permBox) permBox.hidden = hasPerm;
    if (batBtn && NATIVE && window.AndroidBridge?.isIgnoringBatteryOptimizations) {
      try {
        batBtn.hidden = !!window.AndroidBridge.isIgnoringBatteryOptimizations();
      } catch (_e) {}
    }
  }

  function renderList() {
    const l = $('#plist');
    if (!l) return;
    l.replaceChildren();
    if (countBadge) countBadge.textContent = PL.length ? PL.length + ' pista' + (PL.length === 1 ? '' : 's') : '0 pistas';
    if (NATIVE && !hasPerm) {
      l.append(h('div', { class: 'empty', text: 'Concede permiso de audio para mostrar automáticamente todas tus canciones.' }));
      return;
    }
    if (!PL.length) {
      l.append(
        h('div', {
          class: 'empty',
          text: NATIVE
            ? 'No se encontraron canciones en la memoria del teléfono. Descarga música y aparecerá aquí sola.'
            : 'Añade música para probar aquí en vivo, o descarga abajo tu proyecto APK Nativo.',
        })
      );
      return;
    }
    const q = normStr(searchQ.trim());
    let shown = 0;
    PL.forEach((t, i) => {
      if (q && !normStr(t.name + ' ' + t.artist).includes(q)) return;
      shown++;
      l.append(
        h(
          'button',
          { class: 'pitem', type: 'button', 'aria-current': String(i === cur), onclick: () => loadTrack(i, true) },
          h('span', { class: 'num', text: String(i + 1).padStart(2, '0') }),
          h(
            'span',
            { class: 'pmeta' },
            h('span', { class: 'pt', text: t.name }),
            t.artist ? h('span', { class: 'pa', text: t.artist }) : null
          ),
          t.duration > 0 ? h('span', { class: 'pdur num', text: mmss(t.duration) }) : null
        )
      );
    });
    if (!shown) {
      l.append(h('div', { class: 'empty', text: 'Ninguna canción coincide con “' + searchQ.trim() + '”.' }));
    }
  }

  /* ---------- presets ---------- */
  function applyData(data: Record<string, any>, { reset = false } = {}) {
    ORDER.forEach((k) => {
      if (S.locks[k]) return;
      if (reset) resetSec(k);
      if (data[k]) SEC[k].set(S, data[k]);
    });
    syncAll();
    commit();
  }
  function saveSection(key: string) {
    const list = store.sec[key] || (store.sec[key] = []);
    const name = SEC[key].n + ' · ' + stamp();
    list.unshift({ name, ts: Date.now(), data: SEC[key].get(S) });
    list.length = Math.min(list.length, 40);
    if (persist()) toast('Guardado: ' + name);
    renderPresets();
  }
  function saveAllPreset(name: string) {
    name = (name || '').trim() || 'Ajuste ' + stamp();
    store.presets.unshift({ name, ts: Date.now(), data: getFull() });
    if (persist()) toast('Guardado todo: ' + name);
    renderPresets();
  }
  const ramp = (n: number, fn: (i: number) => number) => Array.from({ length: n }, (_, i) => r1(fn(i)));
  const FACT: Array<[string, string, Record<string, any>]> = [
    ['Plano', 'Todo en cero', {}],
    ['Graves potentes', 'Realce de 25 a 160 Hz', { eq30: { eq: ramp(30, (i) => Math.max(0, 6 - i * 0.42)) }, tone: { bass: 3 } }],
    ['Voz clara', 'Presencia y menos sibilancia', { cl16: { cl: [0, -1, -1, 0, 0, -1.5, 0, 1.5, 2.5, 3, 2, 0.5, 0, 1, 0.5, 0] }, voice: { vPres: { g: 3 }, vSib: { g: -2 }, vWarm: { g: 1 } } }],
    ['Rock en vivo', 'Caja, guitarra y aire', { eq30: { eq: ramp(30, (i) => (Math.abs(i - 14) < 6 ? -1.5 : (Math.abs(i - 14) / 14) * 5)) }, drums: { kick: { g: 2.5 }, snareC: { g: 2 } }, guitar: { gPres: { g: 2.5 } }, comp: { on: true, th: -18, ratio: 3, attack: 12, release: 180, knee: 6, makeup: 3 } }],
    ['Electrónica', 'Curva en V y saturación suave', { eq30: { eq: ramp(30, (i) => (Math.abs(i - 14.5) / 14.5) * 6 - 1) }, tone: { bass: 3, treb: 2 }, sat: { on: true, drive: 18, mix: 15 }, wid: { on: true, w: 30 } }],
    ['Estadio 3D', 'Reverb larga y giro lento', { rev: { on: true, mix: 28, decay: 3.6, size: 72, damp: 40, pre: 20 }, sp: { on: true, mix: 60, rot: 4, dist: 2 }, wid: { on: true, w: 40 } }],
  ];

  const pre = h('div', { class: 'pane' });
  const secSel = h('select', { class: 'field', id: 'secSel', 'aria-label': 'Sección' }) as HTMLSelectElement;
  ORDER.forEach((k) => secSel.append(h('option', { value: k, text: SEC[k].n })));
  const lists = { fact: h('div'), mine: h('div'), sec: h('div') };
  const twoStep = (btn: HTMLElement, label: string, fn: () => void) => {
    let armed: any = 0;
    btn.addEventListener('click', () => {
      if (armed) {
        clearTimeout(armed);
        armed = 0;
        fn();
        return;
      }
      btn.textContent = label;
      armed = setTimeout(() => {
        armed = 0;
        btn.textContent = btn.dataset.t || '';
      }, 3000);
    });
  };
  function prRow(name: string, sub: string, apply: () => void, del?: () => void) {
    const a = h('button', { class: 'btn sm', type: 'button', text: 'Aplicar', onclick: apply });
    const r = h('div', { class: 'prrow' }, h('div', { class: 'prn' }, h('b', { text: name }), sub ? h('small', { text: sub }) : null), a);
    if (del) {
      const d = h('button', { class: 'btn sm ghost', type: 'button', text: 'Borrar' });
      d.dataset.t = 'Borrar';
      twoStep(d, '¿Seguro?', del);
      r.append(d);
    }
    return r;
  }
  function renderPresets() {
    lists.fact.replaceChildren(
      ...FACT.map(([n, s, d]) =>
        prRow(n, s, () => {
          applyData(d, { reset: true });
          toast('Aplicado: ' + n);
        })
      )
    );
    lists.mine.replaceChildren(
      ...(store.presets.length
        ? store.presets.map((p, i) =>
            prRow(
              p.name,
              Object.keys(p.data || {}).length + ' secciones',
              () => {
                applyData(p.data || {});
                toast('Aplicado: ' + p.name);
              },
              () => {
                store.presets.splice(i, 1);
                persist();
                renderPresets();
              }
            )
          )
        : [h('div', { class: 'empty', text: 'Aún no guardaste ajustes completos.' })])
    );
    const k = secSel.value || ORDER[0];
    const ls = store.sec[k] || [];
    lists.sec.replaceChildren(
      ...(ls.length
        ? ls.map((p, i) =>
            prRow(
              p.name,
              SEC[k].n,
              () => {
                if (S.locks[k]) {
                  toast(SEC[k].n + ' está bloqueado');
                  return;
                }
                SEC[k].set(S, p.data);
                syncAll();
                commit();
                toast('Aplicado: ' + p.name);
              },
              () => {
                ls.splice(i, 1);
                persist();
                renderPresets();
              }
            )
          )
        : [h('div', { class: 'empty', text: 'Sin ajustes guardados para esta sección.' })])
    );
  }
  secSel.addEventListener('change', renderPresets);

  /* ---------- construcción de paneles ---------- */
  const main = $('#main')!;
  const panes: Record<string, HTMLElement> = {};
  function mkPane(id: string) {
    const p = h('section', { class: 'pane', role: 'tabpanel' });
    p.dataset.id = id;
    p.hidden = true;
    panes[id] = p;
    main.append(p);
    return p;
  }

  /* Música */
  {
    const p = mkPane('music');
    countBadge = h('span', { class: 'mini num', text: '0 pistas' });
    const sIn = h('input', {
      type: 'search',
      class: 'field',
      placeholder: 'Buscar canción o artista...',
      'aria-label': 'Buscar en tu música',
    }) as HTMLInputElement;
    const sClr = h('button', {
      type: 'button',
      class: 'sclr',
      'aria-label': 'Limpiar búsqueda',
      text: '×',
      hidden: true,
      onclick: () => {
        sIn.value = '';
        searchQ = '';
        sClr.hidden = true;
        renderList();
      },
    });
    sIn.addEventListener('input', () => {
      searchQ = sIn.value;
      sClr.hidden = !searchQ;
      renderList();
    });
    const searchWrap = h('div', { class: 'sbox' }, sIn, sClr);

    const rep = h('button', {
      class: 'chip',
      type: 'button',
      text: REP[0],
      onclick: () => {
        repeat = (repeat + 1) % 3;
        rep.textContent = REP[repeat];
        rep.setAttribute('aria-pressed', String(repeat > 0));
      },
    });
    const shf = h('button', {
      class: 'chip',
      type: 'button',
      text: 'Aleatorio',
      'aria-pressed': 'false',
      onclick: () => {
        shuffle = !shuffle;
        shf.setAttribute('aria-pressed', String(shuffle));
      },
    });
    const sortBtn = h('button', {
      class: 'chip',
      type: 'button',
      text: 'Orden: Recientes',
      'aria-pressed': 'false',
      onclick: () => {
        sortMode = sortMode === 'recent' ? 'az' : 'recent';
        sortBtn.textContent = sortMode === 'recent' ? 'Orden: Recientes' : 'Orden: A–Z';
        sortBtn.setAttribute('aria-pressed', String(sortMode === 'az'));
        if (NATIVE) applyNativeSortAndRebuild('sort');
        else {
          PL.sort((a, b) =>
            sortMode === 'az' ? String(a.name).localeCompare(String(b.name), 'es') : (b.dateAdded || 0) - (a.dateAdded || 0)
          );
          renderList();
        }
      },
    });

    const controlsRow = h('div', { class: 'chips' });
    if (NATIVE) {
      hasPerm = !!(window.AndroidBridge?.hasMusicPermission && window.AndroidBridge.hasMusicPermission());
      permBox = h(
        'div',
        { style: 'margin-bottom:8px', hidden: hasPerm },
        h('button', {
          class: 'btn pri',
          type: 'button',
          text: 'Permitir acceso a tu música',
          onclick: () => {
            try {
              window.AndroidBridge?.requestMusicPermission?.();
            } catch (_e) {}
          },
        })
      );
      batBtn = h('button', {
        class: 'chip',
        type: 'button',
        text: 'Activar 2° plano sin límite',
        onclick: () => {
          try {
            window.AndroidBridge?.openBatterySettings?.();
          } catch (_e) {}
        },
      });
      controlsRow.append(sortBtn, rep, shf, batBtn);
    } else {
      const fileIn = h('input', { type: 'file', id: 'file', accept: 'audio/*', multiple: true, class: 'vh' }) as HTMLInputElement;
      fileIn.addEventListener('change', () => {
        addFiles(fileIn.files);
        fileIn.value = '';
      });
      const add = h('label', { class: 'btn pri', for: 'file', style: 'display:inline-flex;align-items:center' }, 'Añadir música');
      controlsRow.append(fileIn, add, sortBtn, rep, shf);
    }

    const vol = h('input', {
      type: 'range',
      id: 'vol',
      min: 0,
      max: 100,
      step: 1,
      value: 100,
      'aria-label': 'Volumen de reproducción',
      style: 'width:100%;height:44px;accent-color:var(--acc);margin:0',
    }) as HTMLInputElement;
    vol.addEventListener('input', () => {
      audio.volume = +vol.value / 100;
    });
    const c1 = h(
      'div',
      { class: 'card' },
      h('div', { class: 'chead' }, h('h2', { text: 'Tu música' }), countBadge),
      permBox,
      searchWrap,
      controlsRow,
      h('div', { id: 'plist', class: 'plist', style: 'margin-top:8px' }),
      h('div', { class: 'prow', style: 'border:0' }, h('label', { class: 'pl', for: 'vol', text: 'Volumen' }), vol)
    );
    p.append(c1);

    /* Tarjeta exclusiva en vista web para obtener el APK nativo listo */
    if (!NATIVE) {
      const apkCard = h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'chead' },
          h('h2', { text: 'App Nativa Android (.apk)' }),
          h('span', { class: 'apk-badge', text: 'Lista para compilar' })
        ),
        h('p', {
          class: 'hint',
          text: 'Paquete nativo con lectura automática de canciones (MediaStore), detección en vivo de música nueva y reproducción en segundo plano con pantalla apagada.',
        }),
        h(
          'div',
          { class: 'chips' },
          h('a', {
            class: 'btn pri',
            href: '/api/estudio-eq-android.zip',
            download: 'Estudio-EQ-Android-GitHub.zip',
            text: 'Descargar proyecto Android (.zip)',
          })
        ),
        h(
          'details',
          { class: 'adv', style: 'margin-top:8px' },
          h('summary', { text: 'Pasos para obtener tu Estudio-EQ.apk gratis sin instalar nada' }),
          h(
            'ol',
            { class: 'apk-steps' },
            h('li', { text: 'Exporta este proyecto directo a GitHub desde el menú superior de AI Studio (o descomprime el ZIP descargado y súbelo a un repositorio nuevo en github.com).' }),
            h('li', { text: 'GitHub Actions compilará automáticamente la app nativa de Android en ~3 minutos.' }),
            h('li', { text: 'Abre la sección Releases de tu repositorio en tu celular y descarga Estudio-EQ.apk directo para instalar.' })
          )
        )
      );
      p.append(apkCard);
    }

    const io = card('master', 'Entrada y salida');
    io.body.append(
      row('master.pre', 'Preamplificador', { min: -12, max: 12, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('master.vol', 'Salida maestra', { min: -12, max: 12, step: 0.1, fine: 0.1, unit: 'dB' }),
      h('p', { class: 'mini', text: 'Hay un limitador de seguridad al final de la cadena para evitar saturación digital.' })
    );
    p.append(
      io.c,
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Cómo funciona' })),
        h('p', {
          class: 'hint',
          text: 'La música se procesa dentro de este dispositivo; los archivos no se suben a ningún lado. Todos los valores empiezan en 0 y los efectos en apagado.',
        }),
        h('p', {
          class: 'hint',
          text: 'Los ajustes por instrumento realzan o atenúan las frecuencias donde vive cada instrumento en la mezcla. No separan las pistas.',
        })
      )
    );
  }

  /* EQ 30 */
  mkPane('eq30').append(
    eqTab({
      key: 'eq30',
      arr: 'eq',
      rk: 'r30',
      qk: 'q30',
      freqs: BANDS30,
      names: null,
      title: 'EQ de 30 bandas',
      hint: '1/3 de octava, de 25 Hz a 20 kHz. Toca o arrastra una banda; con Precisión ×5 el arrastre se mueve cinco veces más lento. Pasos de 0.1 dB.',
    })
  );

  /* Claridad 16 */
  mkPane('cl16').append(
    eqTab({
      key: 'cl16',
      arr: 'cl',
      rk: 'r16',
      qk: 'q16',
      freqs: BANDS16,
      names: NAMES16,
      title: '16 bandas de claridad',
      hint: 'Pensado para dar nitidez: graves limpios, medios sin barro, agudos con aire.',
    })
  );

  /* Instrumentos */
  {
    const p = mkPane('inst');
    p.append(
      h('p', {
        class: 'hint',
        text: 'Cada fila realza o atenúa la zona de frecuencias del instrumento. Abre “Frecuencia y Q” para afinar el centro y el ancho.',
      })
    );
    INST.forEach((g) => {
      const { c, body } = card(g.grp, g.name);
      g.items.forEach(([id, nm]) => {
        body.append(
          row('inst.' + id + '.g', nm, { min: -18, max: 18, step: 0.1, fine: 0.1, unit: 'dB' }),
          h(
            'details',
            { class: 'adv' },
            h('summary', { text: 'Frecuencia y Q · ' + nm }),
            row('inst.' + id + '.f', 'Frecuencia', { min: 20, max: 20000, step: 1, fine: 1, unit: 'Hz', log: true }),
            row('inst.' + id + '.q', 'Q', { min: 0.3, max: 12, step: 0.05, fine: 0.05, unit: 'Q' })
          )
        );
      });
      p.append(c);
    });
  }

  /* Efectos */
  let reduc: HTMLElement | null = null;
  let radar: HTMLCanvasElement | null = null;
  {
    const p = mkPane('fx');
    const tone = card('tone', FXN.tone);
    tone.body.append(
      row('fx.tone.bass', 'Graves (repisa)', { min: -24, max: 24, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.tone.bassF', 'Frecuencia de graves', { min: 30, max: 400, step: 1, fine: 1, unit: 'Hz', log: true }),
      row('fx.tone.treb', 'Agudos (repisa)', { min: -24, max: 24, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.tone.trebF', 'Frecuencia de agudos', { min: 2000, max: 16000, step: 10, fine: 10, unit: 'Hz', log: true }),
      row('fx.tone.lc', 'Corte de graves (pasa altos)', { min: 20, max: 500, step: 1, fine: 1, unit: 'Hz', log: true }),
      row('fx.tone.hc', 'Corte de agudos (pasa bajos)', { min: 2000, max: 20000, step: 10, fine: 10, unit: 'Hz', log: true })
    );
    const comp = card('comp', FXN.comp, { on: true });
    reduc = h('span', { class: 'mini num', text: 'Reducción 0.0 dB' });
    comp.body.append(
      reduc,
      row('fx.comp.th', 'Umbral', { min: -100, max: 0, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.comp.ratio', 'Proporción', { min: 1, max: 20, step: 0.1, fine: 0.1, unit: ': 1' }),
      row('fx.comp.attack', 'Ataque', { min: 0, max: 1000, step: 1, fine: 1, unit: 'ms' }),
      row('fx.comp.release', 'Liberación', { min: 0, max: 1000, step: 1, fine: 1, unit: 'ms' }),
      row('fx.comp.knee', 'Rodilla', { min: 0, max: 40, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.comp.makeup', 'Ganancia de compensación', { min: 0, max: 24, step: 0.1, fine: 0.1, unit: 'dB' })
    );
    const sat = card('sat', FXN.sat, { on: true });
    sat.body.append(
      row('fx.sat.drive', 'Empuje', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.sat.mix', 'Mezcla', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' })
    );
    const wid = card('wid', FXN.wid, { on: true });
    wid.body.append(
      row('fx.wid.w', 'Ancho', { min: -100, max: 200, step: 1, fine: 1, unit: '%' }),
      h('p', { class: 'mini', text: '0 deja el estéreo original. Negativo lo acerca a mono, positivo lo abre.' })
    );
    const rev = card('rev', FXN.rev, { on: true });
    rev.body.append(
      row('fx.rev.mix', 'Mezcla', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.rev.decay', 'Duración', { min: 0.1, max: 10, step: 0.01, fine: 0.01, unit: 's' }),
      row('fx.rev.pre', 'Pre-retardo', { min: 0, max: 500, step: 1, fine: 1, unit: 'ms' }),
      row('fx.rev.damp', 'Absorción de agudos', { min: 0, max: 100, step: 1, fine: 1, unit: '%' }),
      row('fx.rev.size', 'Tamaño de sala', { min: 0, max: 100, step: 1, fine: 1, unit: '%' })
    );
    const dly = card('dly', FXN.dly, { on: true });
    dly.body.append(
      row('fx.dly.time', 'Tiempo', { min: 1, max: 2000, step: 1, fine: 1, unit: 'ms' }),
      row('fx.dly.fb', 'Repeticiones', { min: 0, max: 95, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.dly.mix', 'Mezcla', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.dly.tone', 'Tono de repeticiones', { min: 500, max: 20000, step: 10, fine: 10, unit: 'Hz', log: true })
    );
    const sp = card('sp', FXN.sp, { on: true });
    radar = h('canvas', {
      class: 'radar',
      width: 264,
      height: 264,
      role: 'img',
      'aria-label': 'Posición del sonido alrededor de ti, vista desde arriba',
    }) as HTMLCanvasElement;
    sp.body.append(
      radar,
      row('fx.sp.mix', 'Mezcla 3D', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.sp.az', 'Ángulo (0° al frente)', { min: -180, max: 180, step: 1, fine: 1, unit: '°' }),
      row('fx.sp.el', 'Altura', { min: -90, max: 90, step: 1, fine: 1, unit: '°' }),
      row('fx.sp.dist', 'Distancia', { min: 0.5, max: 10, step: 0.1, fine: 0.1, unit: 'm' }),
      row('fx.sp.rot', 'Giro automático (8D)', { min: -60, max: 60, step: 0.1, fine: 0.1, unit: 'rpm' }),
      h('p', { class: 'mini', text: 'La capa 3D usa audio posicional con HRTF; para notarla mejor, usa audífonos.' })
    );
    p.append(tone.c, comp.c, sat.c, wid.c, rev.c, dly.c, sp.c);
  }

  /* Vibración */
  const VIBK = ['sub', 'glass', 'harm', 'trem', 'vibr', 'hap'];
  function applyKeys(keys: string[], data: Record<string, any>) {
    keys.forEach((k) => {
      if (S.locks[k]) return;
      resetSec(k);
      if (data[k]) SEC[k].set(S, data[k]);
    });
    syncAll();
    commit();
  }
  {
    const p = mkPane('vib');
    const VP: Array<[string, string, Record<string, any>]> = [
      ['Apagar todo', 'Todo en cero', {}],
      ['Vidrios suaves', 'Vibración leve en ventanas', { sub: { on: true, freq: 55, g: 5, q: 1.2 }, glass: { on: true, freq: 90, g: 3, q: 5 }, harm: { on: true, freq: 100, drive: 15, mix: 10 } }],
      ['Vidrios fuertes', 'Subgraves y resonancia marcados', { sub: { on: true, freq: 48, g: 9, q: 1.4 }, glass: { on: true, freq: 80, g: 6, q: 7 }, harm: { on: true, freq: 110, drive: 30, mix: 22 }, hap: { on: true, thr: 55, dur: 40, gap: 60, shake: 40 } }],
      ['Terremoto', 'Máximo temblor, usar con cuidado', { sub: { on: true, freq: 40, g: 14, q: 1.6 }, glass: { on: true, freq: 70, g: 9, q: 9 }, harm: { on: true, freq: 120, drive: 45, mix: 35 }, trem: { on: true, rate: 7, depth: 25, shape: 0 }, hap: { on: true, thr: 40, dur: 70, gap: 40, shake: 80 } }],
    ];
    p.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Temblor y vibración' })),
        h('p', { class: 'hint', text: 'Graves profundos para hacer vibrar vidrios, puertas y el propio teléfono. Todo empieza apagado y en 0.' }),
        h('p', { class: 'hint', text: 'Precaución: los subgraves fuertes pueden dañar bocinas pequeñas y cansar el oído. Sube el volumen poco a poco.' }),
        h(
          'div',
          { class: 'chips' },
          ...VP.map(([n, d, data]) =>
            h('button', {
              class: 'btn',
              type: 'button',
              text: n,
              title: d,
              onclick: () => {
                applyKeys(VIBK, data);
                toast('Aplicado: ' + n);
              },
            })
          )
        )
      )
    );
    const sub = card('sub', FXN.sub, { on: true });
    sub.body.append(
      row('fx.sub.g', 'Ganancia', { min: -12, max: 24, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.sub.freq', 'Frecuencia central', { min: 20, max: 150, step: 0.1, fine: 0.1, unit: 'Hz' }),
      row('fx.sub.q', 'Ancho (Q)', { min: 0.3, max: 12, step: 0.05, fine: 0.05, unit: 'Q' })
    );
    const glass = card('glass', FXN.glass, { on: true });
    glass.body.append(
      row('fx.glass.g', 'Ganancia', { min: 0, max: 24, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.glass.freq', 'Frecuencia de resonancia', { min: 40, max: 250, step: 0.1, fine: 0.1, unit: 'Hz' }),
      row('fx.glass.q', 'Estrechez (Q)', { min: 1, max: 20, step: 0.1, fine: 0.1, unit: 'Q' }),
      h('p', { class: 'mini', text: 'Cada ventana vibra a una frecuencia distinta. Mueve la resonancia entre 60 y 120 Hz hasta que el vidrio responda.' })
    );
    const harm = card('harm', FXN.harm, { on: true });
    harm.body.append(
      row('fx.harm.freq', 'Corte de graves', { min: 40, max: 250, step: 1, fine: 1, unit: 'Hz' }),
      row('fx.harm.drive', 'Empuje', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.harm.mix', 'Mezcla', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      h('p', { class: 'mini', text: 'Crea armónicos de los graves para que se noten también en bocinas pequeñas y audífonos.' })
    );
    const trem = card('trem', FXN.trem, { on: true });
    trem.body.append(
      row('fx.trem.rate', 'Velocidad', { min: 0.1, max: 20, step: 0.1, fine: 0.1, unit: 'Hz' }),
      row('fx.trem.depth', 'Profundidad', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.trem.shape', 'Forma de onda', { min: 0, max: 2, step: 1, fine: 1, unit: '' }),
      h('p', { class: 'mini', text: '0 senoidal, 1 triangular, 2 cuadrada (corta el volumen a golpes).' })
    );
    const vibr = card('vibr', FXN.vibr, { on: true });
    vibr.body.append(
      row('fx.vibr.rate', 'Velocidad', { min: 0.1, max: 12, step: 0.1, fine: 0.1, unit: 'Hz' }),
      row('fx.vibr.depth', 'Profundidad', { min: 0, max: 3, step: 0.01, fine: 0.01, unit: 'ms' })
    );
    const hap = card('hap', FXN.hap, { on: true });
    hap.body.append(
      row('fx.hap.thr', 'Umbral de graves', { min: 0, max: 100, step: 1, fine: 1, unit: '%' }),
      row('fx.hap.dur', 'Duración del pulso', { min: 5, max: 200, step: 1, fine: 1, unit: 'ms' }),
      row('fx.hap.gap', 'Pausa entre pulsos', { min: 20, max: 500, step: 1, fine: 1, unit: 'ms' }),
      row('fx.hap.shake', 'Temblor de pantalla', { min: 0, max: 100, step: 1, fine: 1, unit: '%' }),
      h('p', { class: 'mini', text: 'El teléfono vibra con cada golpe de graves. Funciona en Android con Chrome; en otros equipos queda el temblor de pantalla.' })
    );
    p.append(sub.c, glass.c, harm.c, trem.c, vibr.c, hap.c);
  }

  let lastVib = 0;
  let warnedVib = false;
  let shakeAmt = 0;
  function hapticTick(now: number) {
    const hp = S.fx.hap;
    const els = [$('#viz'), $('.dock')];
    const clr = () => {
      shakeAmt = 0;
      els.forEach((e) => {
        if (e) e.style.transform = '';
      });
    };
    if (!hp.on || !ctx || !freqData || audio.paused) {
      if (shakeAmt) clr();
      return;
    }
    const bin = ctx.sampleRate / 2 / freqData.length;
    const a = Math.floor(20 / bin);
    const b = Math.ceil(150 / bin);
    let m = 0;
    let n = 0;
    for (let k = a; k <= b && k < freqData.length; k++) {
      m += freqData[k];
      n++;
    }
    const lvl = n ? m / n / 255 : 0;
    const thr = hp.thr / 100;
    if (lvl > thr) {
      const amt = (lvl - thr) / (1 - thr + 1e-6);
      if (!document.hidden && hp.shake > 0) {
        shakeAmt = ((amt * hp.shake) / 100) * 7;
        els.forEach((e) => {
          if (e)
            e.style.transform =
              'translate(' + ((Math.random() * 2 - 1) * shakeAmt).toFixed(1) + 'px,' + ((Math.random() * 2 - 1) * shakeAmt).toFixed(1) + 'px)';
        });
      }
      const durMs = Math.round(hp.dur * (0.5 + amt * 0.5));
      if (NATIVE && window.AndroidBridge?.vibrate) {
        if (now - lastVib > hp.gap + hp.dur) {
          lastVib = now;
          try {
            window.AndroidBridge.vibrate(durMs);
          } catch (_e) {}
        }
      } else if (typeof navigator.vibrate === 'function') {
        if (now - lastVib > hp.gap + hp.dur) {
          lastVib = now;
          try {
            navigator.vibrate(durMs);
          } catch (_e) {}
        }
      } else if (!warnedVib) {
        warnedVib = true;
        toast('Este navegador no permite vibrar el teléfono; queda el temblor de pantalla.');
      }
    } else if (shakeAmt) clr();
  }

  /* Géneros */
  {
    const p = mkPane('gen');
    const ip = (pts: Array<[number, number]>, k: number) =>
      Array.from({ length: 30 }, (_, i) => {
        let v = pts[pts.length - 1][1];
        if (i <= pts[0][0]) v = pts[0][1];
        else
          for (let j = 0; j < pts.length - 1; j++) {
            const [a, x] = pts[j];
            const [b, y] = pts[j + 1];
            if (i >= a && i <= b) {
              v = x + ((y - x) * (i - a)) / (b - a);
              break;
            }
          }
        return clamp(r1(v * k), -24, 24);
      });
    type StyleFn = (k: number, g: (v: number) => number, m: (v: number) => number, w: (v: number) => number) => Record<string, any>;
    const GEN: Array<{ name: string; desc: string; list: Array<[string, string, StyleFn]> }> = [
      {
        name: 'Electrónica',
        desc: 'Subgraves limpios, medios despejados y brillo abierto para clubes y festivales.',
        list: [
          ['EDM / Festival', 'Bombo y bajos grandes, agudos con chispa', (k, g, m, w) => ({ eq30: { eq: ip([[0, 5], [4, 6], [8, 2], [11, -2], [14, -2.5], [18, -0.5], [22, 1.5], [25, 3], [29, 4]], k) }, tone: { bass: g(2), bassF: 70 }, sub: { on: true, freq: 50, g: g(4), q: 1.2 }, sat: { on: true, drive: m(15), mix: m(12) }, wid: { on: true, w: w(35) }, comp: { on: true, th: -16, ratio: 3, attack: 10, release: 120, knee: 4, makeup: g(2) } })],
          ['House', 'Groove cálido con sala suave', (k, g, m, w) => ({ eq30: { eq: ip([[0, 2], [4, 4], [8, 2], [12, -1], [16, 0], [22, 1.5], [26, 3], [29, 3]], k) }, rev: { on: true, mix: m(12), decay: 1.8, size: 55, damp: 40, pre: 12 }, comp: { on: true, th: -18, ratio: 2.5, attack: 15, release: 140, knee: 6, makeup: g(1.5) }, wid: { on: true, w: w(25) } })],
          ['Techno', 'Golpe seco, hi-hats brillantes y eco', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 3], [5, 5], [9, 0], [13, -2], [18, 1], [23, 3], [27, 2], [29, 2]], k) }, sat: { on: true, drive: m(25), mix: m(20) }, dly: { on: true, time: 375, fb: 25, mix: m(10), tone: 6000 }, comp: { on: true, th: -14, ratio: 4, attack: 6, release: 90, knee: 2, makeup: g(2) } })],
          ['Dubstep / Bass', 'Subgraves que hacen vibrar el cuarto', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 8], [4, 9], [7, 3], [11, -3], [15, -2], [22, 2], [27, 3], [29, 3]], k) }, sub: { on: true, freq: 45, g: g(7), q: 1.3 }, glass: { on: true, freq: 85, g: g(4), q: 6 }, harm: { on: true, freq: 110, drive: m(35), mix: m(25) }, comp: { on: true, th: -12, ratio: 5, attack: 4, release: 80, knee: 2, makeup: g(3) } })],
        ],
      },
      {
        name: 'Rock',
        desc: 'Guitarras con presencia, caja con chasquido y bajos firmes.',
        list: [
          ['Rock clásico', 'Equilibrado, con guitarra al frente', (k, g, _m, _w) => ({ eq30: { eq: ip([[0, 0], [3, 2], [7, 2.5], [11, -1], [14, -1], [18, 1], [21, 2.5], [25, 2], [29, 1]], k) }, drums: { kick: { g: g(1.5) }, snareC: { g: g(1.5) } }, guitar: { gPres: { g: g(2) } }, comp: { on: true, th: -20, ratio: 2.5, attack: 20, release: 200, knee: 6, makeup: g(2) } })],
          ['Hard rock / Metal', 'Medios recortados, ataque y distorsión', (k, g, m, _w) => ({ eq30: { eq: ip([[0, -3], [4, 3], [8, 1], [12, -3.5], [15, -2], [20, 2.5], [23, 4], [27, 3], [29, 2]], k) }, sat: { on: true, drive: m(25), mix: m(15) }, guitar: { gBody: { g: g(1) }, gPres: { g: g(3) } }, drums: { kick: { g: g(3) }, snareC: { g: g(2) }, hat: { g: g(1) } }, comp: { on: true, th: -16, ratio: 4, attack: 8, release: 120, knee: 3, makeup: g(2) } })],
          ['Indie / Alternativo', 'Aire, sala corta y estéreo abierto', (k, _g, m, w) => ({ eq30: { eq: ip([[0, 0], [2, 1], [6, 1.5], [12, -0.5], [19, 1.5], [24, 1.5], [28, 2], [29, 2]], k) }, rev: { on: true, mix: m(14), decay: 1.6, size: 55, damp: 45, pre: 15 }, wid: { on: true, w: w(20) } })],
          ['Acústico / Balada', 'Cuerpo de guitarra y voz cálida', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 0], [3, 1], [9, 1.5], [14, 0], [20, 1], [26, 2], [29, 2]], k) }, guitar: { gAc: { g: g(2) } }, voice: { vWarm: { g: g(1) }, vPres: { g: g(1.5) } }, rev: { on: true, mix: m(10), decay: 1.4, size: 45, damp: 50, pre: 10 } })],
        ],
      },
      {
        name: 'Reggaetón',
        desc: 'Bombo profundo, subgraves marcados y voz clara por encima.',
        list: [
          ['Perreo clásico', 'Sub y bombo, voz al frente', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 6], [3, 8], [6, 3], [10, -1.5], [14, -2.5], [19, 0.5], [22, 2.5], [26, 3], [29, 3]], k) }, sub: { on: true, freq: 48, g: g(6), q: 1.4 }, glass: { on: true, freq: 80, g: g(3.5), q: 5 }, drums: { kick: { g: g(3) } }, voice: { vPres: { g: g(2) }, vSib: { g: g(-1.5) } }, comp: { on: true, th: -14, ratio: 4, attack: 6, release: 100, knee: 3, makeup: g(2) }, sat: { on: true, drive: m(10), mix: m(10) } })],
          ['Trap latino', '808 largos, hi-hats y voz con aire', (k, g, m, w) => ({ eq30: { eq: ip([[0, 7], [3, 9], [7, 2], [11, -2], [15, -2], [21, 1.5], [26, 3], [29, 3]], k) }, sub: { on: true, freq: 42, g: g(8), q: 1.5 }, drums: { hat: { g: g(2) } }, voice: { vAir: { g: g(2) } }, dly: { on: true, time: 333, fb: 20, mix: m(8), tone: 7000 }, wid: { on: true, w: w(25) }, comp: { on: true, th: -14, ratio: 4, attack: 6, release: 100, knee: 3, makeup: g(2) } })],
          ['Dembow de club', 'Bombo y caja con pegada', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 4], [4, 6], [8, 2], [12, -1.5], [18, 1], [23, 3], [27, 3], [29, 2]], k) }, sub: { on: true, freq: 52, g: g(5), q: 1.2 }, drums: { kick: { g: g(3) }, snareC: { g: g(2.5) } }, harm: { on: true, freq: 110, drive: m(20), mix: m(15) }, comp: { on: true, th: -14, ratio: 4, attack: 6, release: 100, knee: 3, makeup: g(2) } })],
          ['Urbano suave', 'Romántico: voz cálida y sala corta', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 2], [2, 3], [6, 2], [12, -1], [18, 1.5], [24, 2], [29, 2]], k) }, voice: { vWarm: { g: g(2) }, vPres: { g: g(2) } }, rev: { on: true, mix: m(10), decay: 1.5, size: 50, damp: 50, pre: 12 }, sub: { on: true, freq: 55, g: g(3), q: 1.2 } })],
        ],
      },
      {
        name: 'K-pop',
        desc: 'Voces brillantes y nítidas, graves ajustados y estéreo amplio.',
        list: [
          ['K-pop brillante', 'Voz con aire, agudos pulidos', (k, g, m, w) => ({ eq30: { eq: ip([[0, 1], [4, 2.5], [8, 1], [12, -1.5], [16, 0.5], [20, 2], [23, 3], [26, 3.5], [29, 3]], k) }, voice: { vPres: { g: g(3) }, vAir: { g: g(2.5) }, vSib: { g: g(-1.5) } }, comp: { on: true, th: -18, ratio: 3, attack: 10, release: 130, knee: 5, makeup: g(2) }, wid: { on: true, w: w(40) }, rev: { on: true, mix: m(10), decay: 1.5, size: 50, damp: 45, pre: 10 } })],
          ['Dance-pop', 'Energía, bajo firme y estéreo grande', (k, g, m, w) => ({ eq30: { eq: ip([[0, 2], [3, 4], [6, 3], [12, -1], [17, 0], [22, 2.5], [27, 3.5], [29, 3]], k) }, tone: { bass: g(3) }, comp: { on: true, th: -15, ratio: 4, attack: 8, release: 100, knee: 3, makeup: g(2.5) }, wid: { on: true, w: w(45) }, sat: { on: true, drive: m(8), mix: m(8) } })],
          ['Balada coreana', 'Voz cercana con sala amplia', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 0], [3, 1], [8, 1], [14, -1], [20, 1.5], [26, 2.5], [29, 2.5]], k) }, voice: { vWarm: { g: g(1.5) }, vPres: { g: g(2) }, vAir: { g: g(2) } }, rev: { on: true, mix: m(18), decay: 2.4, size: 65, damp: 40, pre: 20 } })],
          ['Hip hop coreano', 'Graves pesados y voz presente', (k, g, _m, _w) => ({ eq30: { eq: ip([[0, 5], [4, 6], [8, 1], [10, -1.5], [16, 0], [20, 2], [26, 2], [29, 2]], k) }, sub: { on: true, freq: 50, g: g(4), q: 1.3 }, voice: { vPres: { g: g(2.5) } }, drums: { hat: { g: g(1.5) } }, comp: { on: true, th: -15, ratio: 3.5, attack: 8, release: 110, knee: 3, makeup: g(2) } })],
        ],
      },
    ];
    let gSel = 0;
    let gk = 100;
    const gChips = h('div', { class: 'chips' });
    const gDesc = h('p', { class: 'hint' });
    const gList = h('div');
    const gr = h('input', {
      type: 'range',
      id: 'gk',
      min: 0,
      max: 150,
      step: 1,
      value: 100,
      'aria-label': 'Intensidad del género',
      style: 'width:100%;height:44px;accent-color:var(--acc);margin:0',
    }) as HTMLInputElement;
    const gv = h('span', { class: 'num', text: '100%' });
    gr.addEventListener('input', () => {
      gk = +gr.value;
      gv.textContent = gk + '%';
    });
    function gRender() {
      gChips.replaceChildren(
        ...GEN.map((g, i) =>
          h('button', {
            class: 'chip',
            type: 'button',
            text: g.name,
            'aria-pressed': String(i === gSel),
            onclick: () => {
              gSel = i;
              gRender();
            },
          })
        )
      );
      const g = GEN[gSel];
      gDesc.textContent = g.desc;
      gList.replaceChildren(
        ...g.list.map(([n, d, fn]) =>
          prRow(n, d, () => {
            const k = gk / 100;
            const gg = (v: number) => r1(v * k);
            const m = (v: number) => clamp(r1(v * k), 0, 100);
            const w = (v: number) => Math.round(v * k);
            applyData(fn(k, gg, m, w), { reset: true });
            toast(g.name + ' · ' + n + ' al ' + gk + '%');
          })
        )
      );
    }
    p.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Género musical' })),
        gChips,
        gDesc,
        h('div', { class: 'prow', style: 'border:0' }, h('div', { class: 'ptop' }, h('label', { class: 'pl', for: 'gk', text: 'Intensidad' }), gv), gr)
      ),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Estilos' })),
        gList,
        h('p', {
          class: 'mini',
          text: 'Aplicar cambia todo el estudio; las secciones con candado se respetan. Después afina en EQ 30, Instrumentos y Vibración, y guarda el resultado en Presets.',
        })
      )
    );
    gRender();
  }

  function drawRadar() {
    if (!radar || document.hidden) return;
    const g = radar.getContext('2d')!;
    const w = radar.width;
    const c = w / 2;
    g.clearRect(0, 0, w, w);
    g.strokeStyle = 'rgba(170,167,192,.35)';
    g.lineWidth = 2;
    [0.33, 0.66, 0.98].forEach((r) => {
      g.beginPath();
      g.arc(c, c, c * r, 0, 7);
      g.stroke();
    });
    g.beginPath();
    g.moveTo(c, 4);
    g.lineTo(c, w - 4);
    g.moveTo(4, c);
    g.lineTo(w - 4, c);
    g.stroke();
    g.fillStyle = fgC;
    g.beginPath();
    g.arc(c, c, 8, 0, 7);
    g.fill();
    const sp = S.fx.sp;
    const a = (spAz * Math.PI) / 180;
    const r = clamp(sp.dist / 10, 0.05, 1) * c * 0.9;
    g.fillStyle = accC;
    g.globalAlpha = sp.on ? 1 : 0.4;
    g.beginPath();
    g.arc(c + Math.sin(a) * r, c - Math.cos(a) * r, 12, 0, 7);
    g.fill();
    g.globalAlpha = 1;
  }

  /* Presets */
  {
    const nameIn = h('input', {
      class: 'field',
      id: 'pname',
      placeholder: 'Nombre del ajuste (opcional)',
      'aria-label': 'Nombre del ajuste',
      maxlength: 40,
    }) as HTMLInputElement;
    pre.dataset.id = 'pre';
    pre.hidden = true;
    pre.setAttribute('role', 'tabpanel');
    panes.pre = pre;
    main.append(pre);
    pre.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Guardar todo' })),
        h('p', { class: 'hint', text: 'Guarda todas las secciones con un toque. El último estado también se recuerda solo al volver.' }),
        nameIn,
        h(
          'div',
          { class: 'chips', style: 'margin-top:8px' },
          h('button', {
            class: 'btn pri',
            type: 'button',
            text: 'Guardar todo',
            onclick: () => {
              saveAllPreset(nameIn.value);
              nameIn.value = '';
            },
          })
        )
      ),
      h('div', { class: 'card' }, h('div', { class: 'chead' }, h('h2', { text: 'De fábrica' })), lists.fact),
      h('div', { class: 'card' }, h('div', { class: 'chead' }, h('h2', { text: 'Mis ajustes' })), lists.mine),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Por sección' })),
        h('p', { class: 'hint', text: 'Guarda y recupera una sola sección, por ejemplo solo el compresor. Cada tarjeta también tiene su botón Guardar.' }),
        secSel,
        h('div', { style: 'margin-top:6px' }, lists.sec)
      )
    );
    const lk = h('div', { class: 'chips' });
    ORDER.forEach((k) => {
      const b = h('button', {
        class: 'ib',
        type: 'button',
        onclick: () => {
          S.locks[k] = !S.locks[k];
          if (!S.locks[k]) delete S.locks[k];
          syncAll();
          saveSoon();
        },
      });
      syncers.push(() => {
        const l = !!S.locks[k];
        b.setAttribute('aria-pressed', String(l));
        b.innerHTML = (l ? ICON_LOCK : ICON_OPEN) + '<span></span>';
        if (b.lastChild) b.lastChild.textContent = SEC[k].n;
      });
      lk.append(b);
    });
    pre.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Bloqueos' })),
        h('p', { class: 'hint', text: 'Una sección bloqueada no cambia al aplicar un preset, al restablecer ni al editarla.' }),
        lk,
        h(
          'div',
          { class: 'chips', style: 'margin-top:8px' },
          h('button', {
            class: 'btn',
            type: 'button',
            text: 'Desbloquear todo',
            onclick: () => {
              S.locks = {};
              syncAll();
              saveSoon();
            },
          })
        )
      )
    );
    const out = h('textarea', { class: 'field', id: 'exp', readonly: true, 'aria-label': 'Datos para respaldo' }) as HTMLTextAreaElement;
    const inp = h('textarea', { class: 'field', id: 'imp', 'aria-label': 'Pegar datos para importar', placeholder: 'Pega aquí un respaldo para importarlo' }) as HTMLTextAreaElement;
    const copy = h('button', {
      class: 'btn',
      type: 'button',
      text: 'Copiar',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(out.value);
          toast('Copiado');
        } catch (_e) {
          out.focus();
          out.select();
          toast('Selecciona y copia el texto');
        }
      },
    });
    pre.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Respaldo y web' })),
        h('p', { class: 'hint', text: 'Copia tus ajustes para guardarlos en una nota o llevarlos a otro navegador, y pégalos allí para importarlos.' }),
        h(
          'div',
          { class: 'chips' },
          h('button', {
            class: 'btn',
            type: 'button',
            text: 'Exportar',
            onclick: () => {
              out.value = JSON.stringify({ app: 'estudio-eq', v: 1, presets: store.presets, sec: store.sec, current: getFull() }, null, 1);
            },
          }),
          copy
        ),
        out,
        h('div', { style: 'height:8px' }),
        inp,
        h(
          'div',
          { class: 'chips', style: 'margin-top:8px' },
          h('button', {
            class: 'btn',
            type: 'button',
            text: 'Importar',
            onclick: () => {
              try {
                const o = JSON.parse(inp.value);
                let n = 0;
                if (Array.isArray(o.presets))
                  o.presets.forEach((p: any) => {
                    if (p && p.name && p.data) {
                      store.presets.push({ name: String(p.name).slice(0, 40), ts: p.ts || Date.now(), data: p.data });
                      n++;
                    }
                  });
                if (o.sec && typeof o.sec === 'object')
                  for (const k in o.sec)
                    if (SEC[k] && Array.isArray(o.sec[k]))
                      o.sec[k].forEach((p: any) => {
                        if (p && p.name && p.data) {
                          (store.sec[k] || (store.sec[k] = [])).push(p);
                          n++;
                        }
                      });
                if (!n && o.current) {
                  store.presets.push({ name: 'Importado ' + stamp(), ts: Date.now(), data: o.current });
                  n = 1;
                }
                if (!n) {
                  toast('No encontré ajustes en ese texto');
                  return;
                }
                persist();
                renderPresets();
                toast(n + ' ajuste' + (n > 1 ? 's' : '') + ' importado' + (n > 1 ? 's' : ''));
              } catch (_e) {
                toast('El texto no es un respaldo válido');
              }
            },
          })
        )
      )
    );
  }

  /* ---------- pestañas, cabecera y dock ---------- */
  const TABS: Array<[string, string]> = [
    ['music', 'Música'],
    ['eq30', 'EQ 30'],
    ['cl16', 'Claridad 16'],
    ['inst', 'Instrumentos'],
    ['fx', 'Efectos'],
    ['vib', 'Vibración'],
    ['gen', 'Géneros'],
    ['pre', 'Presets'],
  ];
  const tabBar = $('#tabs')!;
  const tabBtns = TABS.map(([id, n]) => {
    const b = h('button', { class: 'tab', type: 'button', role: 'tab', text: n, onclick: () => showTab(id) });
    b.dataset.id = id;
    tabBar.append(b);
    return b;
  });
  let curTab = 'music';
  function showTab(id: string) {
    curTab = id;
    document.body.dataset.tab = id;
    tabBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === id)));
    for (const k in panes) panes[k].hidden = k !== id;
    const cs = getComputedStyle(document.body);
    accC = cs.getPropertyValue('--acc').trim() || accC;
    fgC = cs.getPropertyValue('--fg').trim() || fgC;
    main.scrollTop = 0;
    const t = tabBtns.find((b) => b.dataset.id === id);
    if (t) t.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  const byp = $('#bypass')!;
  function paintBypass() {
    byp.setAttribute('aria-checked', String(!S.bypass));
    byp.setAttribute('aria-label', S.bypass ? 'Procesado desactivado, audio original' : 'Procesado de audio activo');
  }
  byp.addEventListener('click', () => {
    S.bypass = !S.bypass;
    paintBypass();
    commit();
    toast(S.bypass ? 'Audio original, sin procesar' : 'Procesado activo');
  });
  $('#saveAll')!.addEventListener('click', () => saveAllPreset(''));
  {
    const b = $('#resetAll')!;
    b.dataset.t = b.textContent || 'Restablecer';
    let a: any = 0;
    b.addEventListener('click', () => {
      if (a) {
        clearTimeout(a);
        a = 0;
        b.textContent = b.dataset.t || 'Restablecer';
        ORDER.forEach((k) => {
          if (!S.locks[k]) resetSec(k);
        });
        S.bypass = false;
        syncAll();
        commit();
        toast('Todo en cero (menos lo bloqueado)');
        return;
      }
      b.textContent = '¿Seguro?';
      a = setTimeout(() => {
        a = 0;
        b.textContent = b.dataset.t || 'Restablecer';
      }, 3000);
    });
  }

  build();
  $('#bPlay')!.addEventListener('click', () => {
    if (!PL.length) {
      showTab('music');
      if (NATIVE && !hasPerm) {
        try {
          window.AndroidBridge?.requestMusicPermission?.();
        } catch (_e) {}
      } else toast(NATIVE ? 'No hay canciones en el teléfono' : 'Añade música primero');
      return;
    }
    if (cur < 0) loadTrack(0, true);
    else if (audio.paused) playNow();
    else audio.pause();
  });
  $('#bNext')!.addEventListener('click', () => nextTrack(false));
  $('#bPrev')!.addEventListener('click', prevTrack);

  const seek = $<HTMLInputElement>('#seek')!;
  seek.addEventListener('pointerdown', () => {
    seeking = true;
  });
  ['pointerup', 'pointercancel', 'change'].forEach((ev) =>
    seek.addEventListener(ev, () => {
      seeking = false;
      syncMediaSession(true);
    })
  );
  seek.addEventListener('input', () => {
    audio.currentTime = +seek.value;
    const dTime = $('#dTime');
    if (dTime) dTime.textContent = mmss(audio.currentTime) + ' / ' + mmss(audio.duration || 0);
  });

  audio.addEventListener('play', () => {
    const ic = $('#playIcon');
    if (ic) ic.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
    $('#bPlay')!.setAttribute('aria-label', 'Pausar');
    syncMediaSession(true);
  });
  audio.addEventListener('pause', () => {
    const ic = $('#playIcon');
    if (ic) ic.innerHTML = '<path d="M8 5v14l11-7z"/>';
    $('#bPlay')!.setAttribute('aria-label', 'Reproducir');
    syncMediaSession(true);
  });
  audio.addEventListener('loadedmetadata', () => {
    seek.max = String(audio.duration || 1);
    syncMediaSession(true);
  });
  audio.addEventListener('timeupdate', () => {
    if (!seeking) seek.value = String(audio.currentTime);
    const dTime = $('#dTime');
    if (dTime) dTime.textContent = mmss(audio.currentTime) + ' / ' + mmss(audio.duration || 0);
    syncMediaSession(false);
  });
  audio.addEventListener('ended', () => {
    if (repeat === 2) {
      audio.currentTime = 0;
      playNow();
    } else nextTrack(true);
  });
  audio.addEventListener('error', () => {
    if (audio.src) toast('Formato no compatible con este dispositivo');
  });
  document.addEventListener(
    'pointerdown',
    () => {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    { passive: true }
  );

  let bgLast = performance.now();
  setInterval(() => {
    if (!document.hidden || !audio || audio.paused) return;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = performance.now();
    const dt = Math.min(0.15, (now - bgLast) / 1000);
    bgLast = now;
    placePan(dt);
    sampleSpectrum();
    hapticTick(now);
  }, 60);

  document.addEventListener('visibilitychange', () => {
    updPermBanner();
    if (!document.hidden) {
      vizDirty = true;
      bgLast = performance.now();
    }
  });

  renderList();
  renderPresets();
  syncAll();
  applyAll();
  showTab('music');
  updPermBanner();

  if (NATIVE && window.AndroidBridge?.rescanMusic) {
    try {
      window.AndroidBridge.rescanMusic();
    } catch (_e) {}
  }

  let last = performance.now();
  function loop(now: number) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    placePan(dt);
    drawViz();
    hapticTick(now);
    if (curTab === 'fx') {
      drawRadar();
      if (ctx && reduc) {
        const r = N.comp.reduction;
        reduc.textContent = 'Reducción ' + Math.abs(typeof r === 'number' ? r : (r && r.value) || 0).toFixed(1) + ' dB';
      }
    }
  }
  requestAnimationFrame(loop);
}
