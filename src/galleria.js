/*!
 * GalleriaBallroom engine v0.1.0
 * Galleria Thanksgiving Ball RSVP page, Pyper Publishing.
 * Scene 0: the velvet curtain in WebGL, the projector, the cord, the three knocks,
 * the tableau opening and the settled frame.
 * Readable source. dist/galleria.min.js is this file run through terser.
 * Loaded by the page's first block, which creates window.GXB. No font files live here.
 */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var B = window.GXB;
  var doc = document;
  var root = doc.documentElement;
  if (!B || window.GX) return;

  var GX = window.GX = {
    v: VERSION,
    debug: { mode: null, swapped: false, knocks: 0, heavy: 0, sounds: 0, events: [] }
  };
  var DIST = ((doc.currentScript && doc.currentScript.src) || '').replace(/[^/]*$/, '');
  var GSAP = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/';

  var curtain = doc.getElementById('gx-c');
  if (!curtain) return;
  var halves = [].slice.call(curtain.querySelectorAll('.gx-h'));
  var cord = curtain.querySelector('.gx-cord');
  var sway = curtain.querySelector('.gx-sw');
  var pull = curtain.querySelector('.gx-pull');

  /* ------------------------------------------------------------ helpers */

  function log(k) { GX.debug.events.push([k, Math.round(performance.now())]); }
  function emit(name, detail) { doc.dispatchEvent(new CustomEvent(name, { detail: detail })); }
  function js(url) {
    return new Promise(function (ok, no) {
      var s = doc.createElement('script');
      s.src = url;
      s.onload = function () { ok(); };
      s.onerror = function () { no(new Error('load ' + url)); };
      doc.head.appendChild(s);
    });
  }
  // CSS only counts once a sentinel variable reads back (MD 12.4): onload is not enough in WebKit.
  function cssApplied() {
    return Promise.resolve(B.ecss).then(function () {
      return new Promise(function (ok) {
        var n = 0;
        (function f() {
          if (getComputedStyle(root).getPropertyValue('--gx-v').trim() === '"' + VERSION + '"') ok(true);
          else if (++n < 120) requestAnimationFrame(f);
          else ok(false);
        })();
      });
    });
  }
  function px(name) { return parseFloat(curtain.style.getPropertyValue(name)) || 0; }

  /* ------------------------------------------------------------ tableau geometry
     One half of the curtain, in half-local units: u from the centre seam (0) to the
     outer edge (1), v from the top (0) to the floor (1). The inner bottom corner
     travels up and out along the diagonal; the inner edge goes from a straight line
     (the inverted V of the first moment) to an elliptical arch (the proscenium), and
     the fabric left below the pick-up point hangs as a side leg. */

  function frameEnd(w, h) { return w < h ? [0.90, 0.30, 0.045] : [0.86, 0.42, 0.06]; }

  function edgeAt(v, t, F) {
    if (t <= 0) return 0;
    var Px = F[0] * Math.pow(t, 0.85), Py = 1 - (1 - F[1]) * t, a = F[2] * t;
    if (v < a) return 0;
    if (v < Py) {
      var s = (v - a) / Math.max(Py - a, 1e-4);
      var arch = Math.sqrt(Math.max(0, 1 - (1 - s) * (1 - s)));
      return Px * (s + (arch - s) * Math.min(t, 1));
    }
    return Px;
  }

  function polygonAt(t, F) {
    var Py = 1 - (1 - F[1]) * t, a = F[2] * t;
    var p = ['0 0', '100% 0', '100% 100%'];
    function pt(v) { p.push((edgeAt(v, t, F) * 100).toFixed(3) + '% ' + (v * 100).toFixed(3) + '%'); }
    pt(1);
    for (var i = 0; i <= 24; i++) pt(a + (Py - a) * (1 - i / 24));
    return 'polygon(' + p.join(',') + ')';
  }

  /* ------------------------------------------------------------ scene state */

  var S = { open: 0, lift: 0, live: 0, grain: 0, proj: 0 };
  var sparks = [{ w: 0 }, { w: 0 }, { w: 0 }];
  var kicks = [];
  var VW = { w: 0, h: 0 };
  var PW = [64, 173];
  var mode = null;          // 'webgl' | 'css'
  var drag = null;
  var swayTween = null;
  var lastSeg = 0;
  var lastPointer = 0;
  var revealed = false;

  // A knock gives the bar a jolt and sends a ripple through the folds; both decay.
  function kick(s) { kicks.push([performance.now() / 1000, s]); if (kicks.length > 16) kicks.shift(); }
  function shake(T) {
    var j = 0, r = 0;
    for (var i = 0; i < kicks.length; i++) {
      var dt = T - kicks[i][0];
      if (dt < 0 || dt > 2.5) continue;
      j += kicks[i][1] * Math.exp(-dt * 9) * Math.sin(dt * 52);
      r += kicks[i][1] * Math.exp(-dt * 6);
    }
    return [j, r];
  }

  /* ------------------------------------------------------------ WebGL velvet
     The rest frame (live = grain = projector = open = lift = 0) reproduces the
     first-frame CSS of block 1 exactly: same stops, same sRGB interpolation,
     premultiplied like CSS gradients, same layer order. That is what makes the
     CSS to WebGL swap invisible. Everything else fades in after the swap. */

  var VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform vec2 R;uniform vec2 V;uniform float T;uniform vec2 P;uniform float O;uniform float L;',
    'uniform vec2 K;uniform float LV;uniform float GR;uniform float PJ;uniform vec3 F;',
    'uniform sampler2D S0;uniform sampler2D S1;uniform vec4 SP[3];',
    'const vec3 C0=vec3(42.,12.,16.)/255.;',   // velvet in shadow #2A0C10
    'const vec3 C1=vec3(100.,13.,22.)/255.;',  // oxblood #640D16
    'const vec3 C2=vec3(138.,30.,38.)/255.;',  // velvet in light #8A1E26
    'const vec3 CH=vec3(211.,182.,156.)/255.;',// champagne #D3B69C
    'const vec3 FO=vec3(245.,231.,179.)/255.;',// high foil #F5E7B3
    // one pleat: valley, oxblood, a narrow crest of sheen, oxblood, valley
    'vec3 pl(float p){if(p<.4)return mix(C0,C1,p/.4);if(p<.5)return mix(C1,C2,(p-.4)/.1);',
    'if(p<.62)return mix(C2,C1,(p-.5)/.12);return mix(C1,C0,(p-.62)/.38);}',
    'vec3 ov(vec3 b,vec3 c,float a){return c*a+b*(1.-a);}',
    'float hs(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}',
    'void main(){',
    ' float W=V.x,H=V.y;',
    ' float x=gl_FragCoord.x*W/R.x,y=(R.y-gl_FragCoord.y)*H/R.y;',
    ' float ux=abs(x-W*.5),u=ux/(W*.5),v=y/H;',
    // tableau: covered when u lies outside the inner edge
    ' float e=0.,cov=1.;',
    ' if(O>0.){float Px=F.x*pow(O,.85),Py=1.-(1.-F.y)*O,a=F.z*O;',
    '  if(v>=a){if(v<Py){float s=(v-a)/max(Py-a,1e-4);e=Px*mix(s,sqrt(max(0.,1.-(1.-s)*(1.-s))),min(O,1.));}else e=Px;}',
    '  float aa=.9/(W*.5);cov=smoothstep(e-aa,e+aa,u);}',
    ' float hem=H*(1.-L)-K.x*H*.004;',
    ' if(L>0.||K.x!=0.)cov*=1.-smoothstep(hem-.8,hem+.8,y);',
    // fabric coordinate: the strip of cloth that hung here before the lines gathered it
    ' float uf=e>0.?clamp((u-e)/(1.-e),0.,1.):u;',
    ' float xf=uf*W*.5;',
    ' xf+=LV*1.4*sin(y*.0045+T*.75+xf*.0021)+K.y*6.*sin(y*.031-T*31.);',
    ' float ph=fract(xf/P.x);',
    ' vec3 c=pl(ph);',
    ' float b1=fract(xf/P.y);c=ov(c,C0,(102./255.)*(1.-abs(2.*b1-1.)));',
        // gathered cloth: deeper folds, a rolled edge in shadow with a thread of sheen
    ' if(e>0.){float k=1./(1.-e);c=clamp(mix(C1,c,min(1.+.45*(k-1.),1.8)),0.,1.);',
    '  float dp=(u-e)*W*.5;c=mix(C0,c,.2+.8*smoothstep(0.,18.,dp));',
    '  c+=(C2-C0)*.55*exp(-pow((dp-10.)/4.5,2.))*smoothstep(0.,.12,O);}',
    // light layers, bottom to top, as in the CSS: vignette, pelmet shadow, footlights
    ' float r=length(vec2(ux/(1.24*W*.5),(y-.42*H)/(.62*H)));',
    ' float A1=158./255.,A2=217./255.;float va=r<.32?0.:(r<.8?A1*(r-.32)/.48:(r<1.?mix(A1,A2,(r-.8)/.2):A2));',
    ' c=ov(c,C0,va);',
    ' c=ov(c,C0,v<.16?(191./255.)*(1.-v/.16):0.);',
    ' float by=(hem-y)/H;vec4 rb=vec4(0.);',
    ' if(by<.016){float s=max(by,0.)/.016;float q0=66./255.,q1=128./255.;rb=vec4(mix(CH*q0,C2*q1,s),mix(q0,q1,s));}',
    ' else if(by<.07){float a2=mix(128./255.,46./255.,(by-.016)/.054);rb=vec4(C2*a2,a2);}',
    ' else if(by<.22){float a3=mix(46./255.,0.,(by-.07)/.15);rb=vec4(C2*a3,a3);}',
    ' c=rb.rgb+c*(1.-rb.a);',
    // the projector: the title lands on the pleats, bent by their depth, brighter on the crests
    ' if(PJ>0.){float dep=-cos(6.28318*ph);float fc=.52+.48*(.5+.5*dep);',
    '  vec2 q=vec2((x+dep*P.x*.075*LV)/W,y/H);float sh=texture2D(S0,q).a,hl=texture2D(S1,q).a;',
    '  c+=PJ*(CH*sh*fc*1.05+FO*sh*sh*fc*.22+vec3(.55,.16,.14)*hl*.85*fc);',
    '  for(int i=0;i<3;i++){vec4 s=SP[i];if(s.w>0.){vec2 d=vec2(x,y)-s.xy;float z=s.z;',
    '   float st=exp(-pow(d.y/(z*.07),2.))*max(0.,1.-abs(d.x)/z)+exp(-pow(d.x/(z*.07),2.))*max(0.,1.-abs(d.y)/z);',
    '   st=st*.9+exp(-dot(d,d)/(z*z*.02));c+=FO*st*s.w*PJ;}}}',
    // grain: monochrome, per pixel, stronger in the light (moodboard p1)
    ' float lum=dot(c,vec3(.299,.587,.114));',
    ' float n=hs(floor(gl_FragCoord.xy)+mod(floor(T*24.),97.)*vec2(37.,17.))-.5;',
    ' c=clamp(c+n*GR*(.07+.22*lum),0.,1.);',
    ' gl_FragColor=vec4(c*cov,cov);',
    '}'
  ].join('\n');

  var GL = null;

  function initGL() {
    // Block 1 ships an empty canvas: WebKit paints the first frame only once the page counts as
    // visually non-empty, and CSS gradients do not count; a canvas does. The engine draws into it.
    var cv = curtain.querySelector('canvas') || doc.createElement('canvas');
    cv.className = 'gx-gl';
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;pointer-events:none';
    var g = null;
    try {
      g = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    } catch (e) { g = null; }
    if (!g) return null;
    function sh(type, src) {
      var o = g.createShader(type);
      g.shaderSource(o, src);
      g.compileShader(o);
      if (!g.getShaderParameter(o, g.COMPILE_STATUS)) { GX.debug.glError = g.getShaderInfoLog(o); return null; }
      return o;
    }
    var vs = sh(g.VERTEX_SHADER, VERT), fs = sh(g.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    var pr = g.createProgram();
    g.attachShader(pr, vs);
    g.attachShader(pr, fs);
    g.linkProgram(pr);
    if (!g.getProgramParameter(pr, g.LINK_STATUS)) { GX.debug.glError = g.getProgramInfoLog(pr); return null; }
    g.useProgram(pr);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    var ap = g.getAttribLocation(pr, 'p');
    g.enableVertexAttribArray(ap);
    g.vertexAttribPointer(ap, 2, g.FLOAT, false, 0, 0);
    var U = {};
    ['R', 'V', 'T', 'P', 'O', 'L', 'K', 'LV', 'GR', 'PJ', 'F', 'S0', 'S1'].forEach(function (n) { U[n] = g.getUniformLocation(pr, n); });
    U.SP = g.getUniformLocation(pr, 'SP[0]');
    function tex(unit) {
      var t = g.createTexture();
      g.activeTexture(g.TEXTURE0 + unit);
      g.bindTexture(g.TEXTURE_2D, t);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4));
      return t;
    }
    var tx = [tex(0), tex(1)];
    g.uniform1i(U.S0, 0);
    g.uniform1i(U.S1, 1);
    cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); GX.debug.lost = true; toCSS(); });
    return { cv: cv, g: g, U: U, tx: tx };
  }

  function upload(unit, canvas) {
    var g = GL.g;
    g.activeTexture(g.TEXTURE0 + unit);
    g.bindTexture(g.TEXTURE_2D, GL.tx[unit]);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, canvas);
  }

  function fit() {
    VW.w = curtain.clientWidth;
    VW.h = curtain.clientHeight;
    PW = [px('--w') || 64, px('--b1') || 173];
    if (!GL) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    GL.cv.width = Math.round(VW.w * dpr);
    GL.cv.height = Math.round(VW.h * dpr);
    GL.g.viewport(0, 0, GL.cv.width, GL.cv.height);
  }

  var spData = new Float32Array(12);
  function drawGL(T) {
    var g = GL.g, U = GL.U, sk = shake(T), F = frameEnd(VW.w, VW.h);
    g.uniform2f(U.R, GL.cv.width, GL.cv.height);
    g.uniform2f(U.V, VW.w, VW.h);
    g.uniform1f(U.T, T % 1000);
    g.uniform2f(U.P, PW[0], PW[1]);
    g.uniform1f(U.O, S.open);
    g.uniform1f(U.L, S.lift);
    g.uniform2f(U.K, sk[0], sk[1]);
    g.uniform1f(U.LV, S.live);
    g.uniform1f(U.GR, S.grain);
    g.uniform1f(U.PJ, S.proj);
    g.uniform3f(U.F, F[0], F[1], F[2]);
    for (var i = 0; i < 3; i++) {
      var s = sparks[i];
      spData[i * 4] = s.x || 0; spData[i * 4 + 1] = s.y || 0; spData[i * 4 + 2] = s.z || 1; spData[i * 4 + 3] = s.w || 0;
    }
    g.uniform4fv(U.SP, spData);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  }

  /* ------------------------------------------------------------ CSS curtain (no WebGL)
     Same geometry as the shader, applied as a clip-path on the two CSS halves. */

  function drawCSS(T) {
    var sk = shake(T);
    var ty = (sk[0] * 2.2).toFixed(2), sx = (sk[1] * 0.35).toFixed(3);
    var cp = S.open > 0 ? polygonAt(S.open, frameEnd(VW.w, VW.h)) : '';
    halves.forEach(function (h) {
      h.style.transform = (h.classList.contains('gx-l') ? 'scaleX(-1) ' : '') + 'translateY(' + ty + 'px) skewX(' + sx + 'deg)';
      if (cp) h.style.clipPath = h.style.webkitClipPath = cp;
    });
  }

  function toCSS() {
    if (mode === 'css') return;
    mode = GX.debug.mode = 'css';
    if (GL && GL.cv.parentNode) GL.cv.parentNode.removeChild(GL.cv);
    GL = null;
    halves.forEach(function (h) { h.style.visibility = ''; });
    curtain.style.background = '';
  }

  function tick() {
    var T = performance.now() / 1000;
    if (mode === 'webgl' && GL) drawGL(T); else if (mode === 'css') drawCSS(T);
  }

  var ticking = false;
  function run(on) {
    if (on === ticking) return;
    ticking = on;
    if (on) gsap.ticker.add(tick); else gsap.ticker.remove(tick);
  }

  /* ------------------------------------------------------------ projector */

  var LOGO = /*@LOGOS*/null;

  function drawLogo(x, key, cx, top, width) {
    var L = LOGO && LOGO[key];
    if (!L) return 0;
    var k = width / L.w;
    x.save();
    x.translate(cx - width / 2, top);
    x.scale(k, k);
    L.d.forEach(function (d) { x.fill(new Path2D(d)); });
    x.restore();
    return L.h * k;
  }

  function wrap(x, text, max) {
    var words = text.split(' '), lines = [], line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (x.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }

  // Credits in the order of section 7.4: GALLERIA, THANKSGIVING BALL, (purpose line),
  // PRESENTED BY + Beau Monde, NOVEMBER 19, 6 PM.
  var PURPOSE = 'A NIGHT TO CELEBRATE THE RELEASE OF THE NEWEST ISSUE OF GALLERIA MAGAZINE';
  var proj = { pts: [], purpose: window.GX_PURPOSE === true };

  function buildProjection(tt) {
    var W = VW.w, H = VW.h, por = W < H, cx = W / 2;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cv = doc.createElement('canvas');
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    var x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#fff';
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    var disp = tt ? 'tt-modernoir' : '"Lexend Peta"';
    var dw = tt ? 300 : 400;
    var FT = por ? W * 0.15 : Math.min(W * 0.08, H * 0.14);
    var fs = por ? 10 : Math.max(11, Math.min(13, W * 0.0085));
    var gW = por ? W * 0.36 : FT * 2.1;
    var bW = por ? W * 0.3 : FT * 1.45;
    var FD = FT * 0.46;
    var title = por ? ['THANKSGIVING', 'BALL'] : ['THANKSGIVING BALL'];
    x.font = '400 ' + fs + 'px "Lexend Peta", sans-serif';
    var pl = proj.purpose ? wrap(x, PURPOSE, por ? W * 0.7 : FT * 6.4) : [];
    var gH = LOGO ? gW * LOGO.galleria.h / LOGO.galleria.w : FT * 0.7;
    var bH = LOGO ? bW * LOGO.beau.h / LOGO.beau.w : fs * 2;
    var parts = [
      ['logo', gH, 0], ['title', FT * 0.7 * title.length + FT * 0.3 * (title.length - 1), FT * 0.5],
      ['purpose', pl.length ? fs * 0.7 * pl.length + fs * 0.9 * (pl.length - 1) : 0, pl.length ? FT * 0.4 : 0],
      ['pres', fs * 0.72, FT * 0.48], ['beau', bH, FT * 0.12], ['date', FD * 0.7, FT * 0.42], ['time', fs * 0.75, FD * 0.42]
    ];
    var total = parts.reduce(function (s, p) { return s + p[1] + p[2]; }, 0);
    var y = H * (por ? 0.43 : 0.45) - total / 2;
    var box = { x0: W, x1: 0, y0: y, y1: y + total };
    parts.forEach(function (p) {
      y += p[2];
      if (p[0] === 'logo') { if (LOGO) drawLogo(x, 'galleria', cx, y, gW); else { x.font = dw + ' ' + FT * 0.7 + 'px ' + disp; x.fillText('GALLERIA', cx, y + gH); } }
      if (p[0] === 'title') {
        x.font = dw + ' ' + FT + 'px ' + disp;
        title.forEach(function (t, i) {
          var by = y + FT * 0.7 + i * FT;
          x.fillText(t, cx, by);
          var mw = x.measureText(t).width;
          box.x0 = Math.min(box.x0, cx - mw / 2); box.x1 = Math.max(box.x1, cx + mw / 2);
        });
      }
      if (p[0] === 'purpose') { x.font = '400 ' + fs + 'px "Lexend Peta", sans-serif'; pl.forEach(function (t, i) { x.fillText(t, cx, y + fs * 0.7 + i * fs * 1.6); }); }
      if (p[0] === 'pres') { x.font = '500 ' + fs + 'px "Lexend Peta", sans-serif'; x.fillText('PRESENTED BY', cx, y + fs * 0.72); }
      if (p[0] === 'beau') { if (LOGO) drawLogo(x, 'beau', cx, y, bW); else { x.font = '400 ' + fs + 'px "Lexend Peta", sans-serif'; x.fillText('BEAU MONDE BUILDERS', cx, y + fs); } }
      if (p[0] === 'date') { x.font = dw + ' ' + FD + 'px ' + disp; x.fillText('NOVEMBER 19', cx, y + FD * 0.7); }
      if (p[0] === 'time') { x.font = '400 ' + fs * 1.05 + 'px "Lexend Peta", sans-serif'; x.fillText('6 PM', cx, y + fs * 0.75); }
      y += p[1];
    });
    // halo: the same light, blurred, at a quarter of the size
    var hw = Math.max(2, Math.round(W / 4)), hh = Math.max(2, Math.round(H / 4));
    var hc = doc.createElement('canvas');
    hc.width = hw; hc.height = hh;
    var hx = hc.getContext('2d');
    hx.shadowColor = '#fff';
    hx.shadowBlur = 7;
    hx.shadowOffsetX = 10000;
    hx.drawImage(cv, -10000, 0, hw, hh);
    hx.drawImage(cv, -10000, 0, hw, hh);
    // points on the letters of the title, where the four-point glints land
    proj.pts = [];
    try {
      var bx = Math.max(0, Math.floor(box.x0 * dpr)), byy = Math.floor((box.y0) * dpr);
      var bw = Math.max(1, Math.ceil((box.x1 - box.x0) * dpr)), bh = Math.max(1, Math.ceil((parts[0][1] + parts[1][1] + parts[1][2]) * dpr));
      var im = x.getImageData(bx, byy, bw, bh).data, step = Math.max(2, Math.round(3 * dpr));
      for (var j = 0; j < bh; j += step) for (var i = 0; i < bw; i += step) {
        if (im[(j * bw + i) * 4 + 3] > 220) proj.pts.push([(bx + i) / dpr, (byy + j) / dpr]);
      }
    } catch (e) { proj.pts = []; }
    upload(0, cv);
    upload(1, hc);
    proj.size = Math.max(9, FT * 0.16);
    proj.ready = true;
    GX.debug.projection = { tt: !!tt, purpose: proj.purpose, pts: proj.pts.length };
  }

  function sparkle() {
    if (B.state || !proj.pts.length || S.proj < 0.5) return;
    [0, 1].forEach(function (k) {
      var s = sparks[k], p = proj.pts[(Math.random() * proj.pts.length) | 0];
      s.x = p[0]; s.y = p[1]; s.z = proj.size * (0.8 + Math.random() * 0.5); s.w = 0;
      gsap.timeline({ delay: k * 0.14 }).to(s, { w: 1, duration: 0.22, ease: 'power2.out' }).to(s, { w: 0, duration: 0.5, ease: 'power2.in' });
    });
  }

  function warmProjector() {
    if (B.state || !GL) return;
    log('projector');
    gsap.timeline({ onComplete: function () { gsap.delayedCall(1.2, sparkle); gsap.delayedCall(4, function loop() { sparkle(); if (!B.state) gsap.delayedCall(4, loop); }); } })
      .to(S, { proj: 0.55, duration: 0.08, ease: 'none' })
      .to(S, { proj: 0.1, duration: 0.09, ease: 'none' })
      .to(S, { proj: 0.85, duration: 0.09, ease: 'none' })
      .to(S, { proj: 0.3, duration: 0.1, ease: 'none' })
      .to(S, { proj: 1, duration: 0.24, ease: 'power2.out' });
  }

  function projector() {
    var fontsLoaded = Promise.all([B.kit, B.lex]).then(function () {
      return Promise.all([
        doc.fonts.load('300 80px tt-modernoir'),
        doc.fonts.load('400 16px "Lexend Peta"'),
        doc.fonts.load('500 16px "Lexend Peta"')
      ]);
    });
    fontsLoaded.then(function (r) {
      if (B.state || !GL) return;
      buildProjection(r[0].length > 0);
      if (window.GX_HOLD && !GX.going) return;
      warmProjector();
    }, function () {});
  }

  /* ------------------------------------------------------------ sound
     Only sounds that would exist in the room, short and low. Nothing is created or
     scheduled before a gesture; with sound off the page does exactly the same. */

  var A = {};
  var VOL = 0.55;

  function noiseBuf(c, dur) {
    var n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function impulse(c, dur, decay) {
    var n = Math.floor(c.sampleRate * dur), b = c.createBuffer(2, n, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var i = 0; i < n; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.35; d[i] = lp * Math.pow(1 - i / n, decay); }
    }
    return b;
  }
  function audio() {
    if (!B.snd) return null;
    try {
      if (!A.ctx) {
        var C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        var c = A.ctx = new C();
        GX.debug.audioAt = Math.round(performance.now());
        A.master = c.createGain(); A.master.gain.value = VOL; A.master.connect(c.destination);
        A.lp = c.createBiquadFilter(); A.lp.type = 'lowpass'; A.lp.frequency.value = 2600; A.lp.Q.value = 0.5;
        var dry = c.createGain(); dry.gain.value = 0.85;
        var wet = c.createGain(); wet.gain.value = 0.32;
        var room = c.createConvolver(); room.buffer = impulse(c, 1.2, 4.2);
        A.lp.connect(dry); A.lp.connect(room); room.connect(wet);
        dry.connect(A.master); wet.connect(A.master);
        A.noise = noiseBuf(c, 2.5);
      }
      if (A.ctx.state !== 'running') A.ctx.resume();
    } catch (e) { return null; }
    return A.ctx;
  }
  function live() { return B.snd && A.ctx && A.ctx.state === 'running' ? A.ctx : null; }

  // A knock of the brigadier on the boards: a falling thump and a woody click, muffled.
  function knock(heavy) {
    var c = live();
    if (!c) return;
    var t = c.currentTime + 0.004, dur = heavy ? 0.26 : 0.07, jit = heavy ? 1 : 0.94 + Math.random() * 0.12;
    var o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime((heavy ? 150 : 300) * jit, t);
    o.frequency.exponentialRampToValueAtTime((heavy ? 62 : 160) * jit, t + (heavy ? 0.1 : 0.035));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(heavy ? 0.95 : 0.3, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.lp);
    o.start(t); o.stop(t + dur + 0.02);
    var n = c.createBufferSource(), bp = c.createBiquadFilter(), g2 = c.createGain();
    n.buffer = A.noise;
    bp.type = 'bandpass'; bp.frequency.value = (heavy ? 1250 : 2100) * jit; bp.Q.value = heavy ? 1.1 : 1.6;
    g2.gain.setValueAtTime(heavy ? 0.55 : 0.22, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + (heavy ? 0.06 : 0.028));
    n.connect(bp); bp.connect(g2); g2.connect(A.lp);
    n.start(t, Math.random() * 2, 0.1);
    GX.debug.sounds += 2;
  }

  // Velvet running over the boards and the pulleys turning, for the length of the rise.
  function velvetSound(D) {
    var c = live();
    if (!c) return;
    var t = c.currentTime + 0.01;
    var n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    n.buffer = A.noise; n.loop = true;
    bp.type = 'bandpass'; bp.Q.value = 0.6;
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.linearRampToValueAtTime(1100, t + D * 0.5);
    bp.frequency.linearRampToValueAtTime(600, t + D);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.45);
    g.gain.linearRampToValueAtTime(0.12, t + D * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + D + 0.3);
    n.connect(bp); bp.connect(g); g.connect(A.lp);
    n.start(t, Math.random()); n.stop(t + D + 0.35);
    GX.debug.sounds++;
    // pulley ticks follow the speed of the rise (power2.inOut)
    for (var i = 1; i < 16; i++) {
      var p = i / 16, f = p < 0.5 ? Math.sqrt(p / 2) : 1 - Math.sqrt((1 - p) / 2), tt = t + D * f;
      var o = c.createOscillator(), og = c.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(820 + Math.random() * 120, tt);
      o.frequency.exponentialRampToValueAtTime(560, tt + 0.04);
      og.gain.setValueAtTime(0.0001, tt);
      og.gain.exponentialRampToValueAtTime(0.03, tt + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, tt + 0.05);
      o.connect(og); og.connect(A.lp);
      o.start(tt); o.stop(tt + 0.06);
      GX.debug.sounds++;
    }
  }

  /* ------------------------------------------------------------ the cord */

  var MAX = 180, THR = 90, STEP = 22;

  function startSway() {
    if (B.rm || !sway) return;
    if (swayTween) swayTween.kill();
    gsap.set(sway, { transformOrigin: '24px ' + (-cord.offsetTop) + 'px' });
    swayTween = gsap.fromTo(sway, { rotation: -0.55 }, { rotation: 0.55, duration: 1.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  }
  function stopSway() {
    if (swayTween) { swayTween.kill(); swayTween = null; }
    gsap.to(sway, { rotation: 0, duration: 0.3, ease: 'power2.out' });
  }

  // The bar follows the finger; every stretch of rope gives one quick knock (the roll).
  function dragFx(y) {
    S.lift = Math.max(0, y) / MAX * 0.045;
    var seg = Math.floor(y / STEP);
    if (seg > lastSeg) {
      for (var i = lastSeg; i < seg; i++) { knock(false); kick(0.28); GX.debug.knocks++; }
      lastSeg = seg;
    } else if (seg < lastSeg) lastSeg = seg;
  }
  function back() {
    lastSeg = 0;
    gsap.to(cord, { y: 0, duration: 0.7, ease: 'elastic.out(1,.35)' });
    gsap.to(S, { lift: 0, duration: 0.45, ease: 'power2.out' });
    startSway();
  }
  // After the opening the cord hangs with the gathered cloth, over the right leg of the frame,
  // and never past the edge of the screen.
  function legOffset() {
    var r = cord.getBoundingClientRect(), F = frameEnd(VW.w || innerWidth, VW.h || innerHeight), w = VW.w || innerWidth;
    var centre = Math.min(w - (1 - F[0]) * w / 4, w - 17);
    return centre - (r.left + r.width / 2) + (gsap.getProperty(cord, 'x') || 0);
  }
  function heavy() { knock(true); kick(1); GX.debug.heavy++; log('knock'); }

  function setupCord() {
    cord.addEventListener('pointerdown', function () { lastPointer = Date.now(); }, true);
    drag = Draggable.create(cord, {
      type: 'y',
      bounds: { minY: 0, maxY: MAX },
      dragClickables: true,
      minimumMovement: 3,
      cursor: 'grab',
      activeCursor: 'grabbing',
      onPress: function () { audio(); stopSway(); },
      onDrag: function () { dragFx(this.y); },
      onRelease: function () { audio(); if (this.y > THR) open('drag'); else if (!B.state) back(); },
      onClick: function () { open('tap'); }
    })[0];
    // keyboard Space or Enter on the focused tassel; pointer clicks belong to Draggable
    B.tap = function () { if (Date.now() - lastPointer < 800) return; open('tap'); };
    B.eng = open;
    startSway();
  }

  /* ------------------------------------------------------------ the opening */

  function open(src) {
    if (B.state) return;
    B.state = 'opening';
    GX.debug.openedBy = src;
    log('open:' + src);
    audio();
    if (drag) drag.disable();
    stopSway();
    if (mode === 'css') curtain.style.background = 'transparent';
    gsap.killTweensOf(S, 'proj');
    gsap.to(pull, { opacity: 0, duration: 0.4 });
    var tl = GX.tl = gsap.timeline();
    if (src !== 'drag') {
      lastSeg = 0;
      tl.to(cord, { y: 128, duration: 0.5, ease: 'power2.in', onUpdate: function () { dragFx(gsap.getProperty(cord, 'y')); } });
    }
    tl.addLabel('rel');
    tl.to(cord, { y: 0, duration: 1.1, ease: 'elastic.out(1,.32)' }, 'rel');
    tl.to(S, { lift: 0, duration: 0.3, ease: 'power2.out' }, 'rel');
    [0.08, 0.53, 0.98].forEach(function (t) { tl.call(heavy, null, 'rel+=' + t); });
    tl.to(S, { proj: 0, duration: 0.9, ease: 'power1.in' }, 'rel+=1.15');
    tl.call(velvetSound, [2.0], 'rel+=1.2');
    tl.to(cord, { x: legOffset(), duration: 2.0, ease: 'power2.inOut' }, 'rel+=1.2');
    tl.call(function () { log('rise'); emit('gx:rise'); }, null, 'rel+=1.2');
    tl.to(S, { open: 1, duration: 2.0, ease: 'power2.inOut', onUpdate: function () {
      if (!revealed && S.open > 0.4) { revealed = true; log('reveal'); emit('gx:reveal'); }
    } }, 'rel+=1.2');
    tl.to(S, { open: 1.03, duration: 0.26, ease: 'sine.out' });
    tl.to(S, { open: 1, duration: 0.4, ease: 'sine.inOut' });
    tl.call(settled);
  }

  function settled() {
    log('settled');
    if (mode === 'css') { drawCSS(performance.now() / 1000); }
    B.settle();
    startSway();
    // after the opening the frame only breathes while it is on screen
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { run(en[0].isIntersecting); }).observe(curtain);
    }
  }

  /* ------------------------------------------------------------ hero art (static, iteration 1) */

  function svgLogo(L) {
    return '<svg viewBox="0 0 ' + L.w + ' ' + L.h + '" aria-hidden="true" focusable="false">' +
      L.d.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>';
  }
  function heroArt() {
    var hero = doc.getElementById('gx-hero');
    if (!hero) return;
    [].forEach.call(hero.querySelectorAll('[data-gx-art]'), function (el) {
      var L = LOGO && LOGO[el.getAttribute('data-gx-art')];
      if (!L || el.querySelector('svg')) return;
      el.insertAdjacentHTML('afterbegin', svgLogo(L));
      el.classList.add('gx-has-art');
    });
    var slot = hero.querySelector('.gx-hero__art'), R = window.GX_ART && window.GX_ART.rococos;
    if (slot && R && !slot.firstChild) {
      // dry emboss: a lit copy toward the light (top left), a shadow copy away from it, the base on top
      slot.innerHTML = '<svg viewBox="0 0 ' + R.w + ' ' + R.h + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
        '<defs><path id="gx-rc" d="' + R.d + '"/></defs>' +
        '<use href="#gx-rc" class="gx-rl"/><use href="#gx-rc" class="gx-rs"/><use href="#gx-rc" class="gx-rb"/></svg>';
    }
    log('hero-art');
  }

  /* ------------------------------------------------------------ boot */

  function swap() {
    fit();
    drawGL(performance.now() / 1000);
    requestAnimationFrame(function () {
      drawGL(performance.now() / 1000);
      halves.forEach(function (h) { h.style.visibility = 'hidden'; });
      curtain.style.background = 'transparent';
      GX.debug.swapped = true;
      log('swap');
      run(true);
      var go = function () {
        GX.going = true;
        gsap.to(S, { live: 1, grain: 1, duration: 1.4, ease: 'sine.inOut', delay: 0.15 });
        if (proj.ready) warmProjector();
      };
      if (window.GX_HOLD) GX.go = go; else go();
      projector();
    });
  }

  function takeOver() {
    GL = initGL();
    fit();
    if (GL) {
      mode = GX.debug.mode = 'webgl';
      if (GL.cv.parentNode !== curtain) curtain.insertBefore(GL.cv, curtain.firstChild);
      if (window.GX_HOLD) GX.release = swap; else swap();
    } else {
      mode = GX.debug.mode = 'css';
      run(true);
    }
    setupCord();
    var rt = 0;
    if ('ResizeObserver' in window) {
      new ResizeObserver(function () {
        clearTimeout(rt);
        rt = setTimeout(function () {
          fit();
          if (GL && proj.ready && !B.state) buildProjection(GX.debug.projection.tt);
        }, 150);
      }).observe(curtain);
    }
  }

  var libs = Promise.all([js(GSAP + 'gsap.min.js'), js(GSAP + 'Draggable.min.js')]);
  var art = js(DIST + 'galleria-art.js').catch(function () {});
  var domReady = new Promise(function (ok) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ok); else ok();
  });

  libs.then(cssApplied).then(function (cssOk) {
    if (B.fail) { GX.debug.mode = 'late-fail'; return; }
    if (!cssOk) { GX.debug.mode = 'no-css'; return; } // block 1 falls back on its own timer
    gsap.registerPlugin(Draggable);
    if (!B.state && !B.rm) takeOver();
    else {
      GX.debug.mode = B.rm ? 'reduced' : (B.seen ? 'seen' : 'late');
      fit();
      var place = function () { gsap.set(cord, { x: legOffset() }); if (!B.rm) startSway(); };
      if (B.state === 'open') place(); else doc.addEventListener('gx:open', place);
    }
    B.onsnd = function (on) {
      if (on) audio();
      if (A.master) A.master.gain.setTargetAtTime(on ? VOL : 0, A.ctx.currentTime, 0.03);
    };
    root.classList.add('gx-ready');
    log('ready');
  }, function (e) { GX.debug.error = String(e && e.message || e); });

  Promise.all([art, domReady]).then(heroArt);
})();
