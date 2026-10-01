/*!
 * GalleriaBallroom engine v0.3.0
 * Galleria Thanksgiving Ball RSVP page, Pyper Publishing.
 * Scene 0: the velvet curtain in WebGL, the projector, the cord and its tassel, a sax overture,
 * the tableau opening and the settled frame. Scene 1: the open tableau, with the follow spot
 * (desktop), the house light coming up on the emboss and a pass of foil over the type. Scene 2:
 * the carnet de bal, a cream card hung on a cord (its emboss, its swing).
 * Readable source. dist/galleria.min.js is this file run through terser.
 * Loaded by the page's first block, which creates window.GXB. No font files live here.
 * Hash switches for review: #curtain (show the curtain again), #purpose (purpose line in the
 * projection). They combine: #curtain-purpose.
 */
(function () {
  'use strict';

  var VERSION = '0.3.0';
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
  var HASH = location.hash || '';

  var curtain = doc.getElementById('gx-c');
  if (!curtain) return;
  var halves = [].slice.call(curtain.querySelectorAll('.gx-h'));
  var cord = curtain.querySelector('.gx-cord');
  var sway = curtain.querySelector('.gx-sw');
  var bulb = curtain.querySelector('.gx-tas b');
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
  // One clock for the shader, the knocks and the springs. Review renders freeze it (GX_CLOCK) to step frames.
  function clock() { return window.GX_CLOCK != null ? window.GX_CLOCK : performance.now() / 1000; }
  function hz(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  /* ------------------------------------------------------------ tableau geometry
     One half of the curtain, in half-local units: u from the centre seam (0) to the outer
     edge (1), v from the top (0) to the floor (1). The inner bottom corner travels up and out
     along the diagonal; the inner edge goes from a straight line (the inverted V of the first
     moment) to an elliptical arch (the proscenium); the cloth below the pick-up point hangs as
     a leg. While it moves, the middle of the edge lags behind the lines (sag); when it stops,
     the legs swing and settle (swing). */

  function frameEnd(w, h) { return w < h ? [0.90, 0.30, 0.045] : [0.86, 0.42, 0.06]; }

  function edgeAt(v, t, F, sag, swing) {
    if (t <= 0) return 0;
    var Px = F[0] * Math.pow(t, 0.85), Py = 1 - (1 - F[1]) * t, a = F[2] * t;
    if (v < a) return 0;
    if (v < Py) {
      var s = (v - a) / Math.max(Py - a, 1e-4);
      var arch = Math.sqrt(Math.max(0, 1 - (1 - s) * (1 - s)));
      return Math.max(0, Px * (s + (arch - s) * Math.min(t, 1)) - (sag || 0) * Px * 0.16 * Math.sin(Math.PI * s));
    }
    return Px * (1 + (swing || 0) * (v - Py) / Math.max(1 - Py, 1e-4));
  }

  function polygonAt(t, F, sag, swing) {
    var Py = 1 - (1 - F[1]) * t, a = F[2] * t;
    var p = ['0 0', '100% 0', '100% 100%'];
    function pt(v) { p.push((edgeAt(v, t, F, sag, swing) * 100).toFixed(3) + '% ' + (v * 100).toFixed(3) + '%'); }
    pt(1);
    for (var i = 0; i <= 24; i++) pt(a + (Py - a) * (1 - i / 24));
    return 'polygon(' + p.join(',') + ')';
  }

  /* ------------------------------------------------------------ scene state */

  var S = { open: 0, lift: 0, live: 0, grain: 0, proj: 0, sag: 0, swing: 0 };
  var sparks = [{ w: 0 }, { w: 0 }, { w: 0 }];
  var kicks = [];
  var VW = { w: 0, h: 0 };
  var PW = [64, 173];
  var mode = null;          // 'webgl' | 'css'
  var drag = null;
  var dragging = false;
  var swayTween = null;
  var lastSeg = 0;
  var lastPointer = 0;
  var revealed = false;

  // A tap gives the bar a small jolt and sends a ripple through the folds; both decay.
  function kick(s) { kicks.push([clock(), s]); if (kicks.length > 16) kicks.shift(); }
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

  /* ------------------------------------------------------------ springs
     The cloth follows the hand through springs, so it lags, overshoots a little and settles
     instead of being glued to the finger. The cord comes back on its own spring when let go,
     and the tassel skirt has a looser one: it swings and its threads flare with speed.
     Each spring is [value, velocity, target]. */

  var SP = { o: [0, 0, 0], l: [0, 0, 0], c: [0, 0, 0], k: [0, 0, 0], f: [1, 0, 1], s: [1, 0, 1], T: null, y: 0, x: 0, landed: true };
  function spring(s, w, z, dt) { var a = -w * w * (s[0] - s[2]) - 2 * z * w * s[1]; s[1] += a * dt; s[0] += s[1] * dt; }

  function follow(T) {
    var dt = SP.T == null ? 0 : clamp(T - SP.T, 0, 0.05);
    SP.T = T;
    if (!cord) return;
    var y = gsap.getProperty(cord, 'y') || 0, x = gsap.getProperty(cord, 'x') || 0;
    var vy = dt > 0 ? (y - SP.y) / dt : 0, vx = dt > 0 ? (x - SP.x) / dt : 0;
    SP.y = y; SP.x = x;
    SP.k[2] = clamp(-vx * 0.09 + vy * 0.006, -12, 12);          // sideways motion swings it
    SP.f[2] = 1 + clamp(Math.abs(vy) * 0.0004, 0, 0.18);         // speed fans the threads out
    SP.s[2] = 1 + clamp(-vy * 0.0005, -0.06, 0.14);              // going up, the skirt trails and stretches
    var st = dt / 4;
    for (var n = 0; n < 4 && dt > 0; n++) {      // substeps keep the springs stable at low frame rates
      if (!B.state) {
        spring(SP.o, 12, 0.5, st);
        spring(SP.l, 12, 0.5, st);
        if (!dragging) spring(SP.c, 17, 0.2, st);
      }
      spring(SP.k, 8, 0.2, st);
      spring(SP.f, 12, 0.3, st);
      spring(SP.s, 14, 0.28, st);
    }
    if (!B.state) {
      if (!dragging && dt > 0) { gsap.set(cord, { y: SP.c[0] }); SP.y = SP.c[0]; }
      if (SP.o[0] < 0 && SP.o[1] < -0.05 && !SP.landed) { kick(0.25); SP.landed = true; }   // the hem lands
      if (SP.o[0] > 0.01) SP.landed = false;
      S.open = Math.max(0, SP.o[0]);
      S.lift = Math.max(0, SP.l[0]);
    }
    if (bulb) {
      bulb.style.setProperty('--sk', SP.k[0].toFixed(2) + 'deg');
      bulb.style.setProperty('--sf', SP.f[0].toFixed(3));
      bulb.style.setProperty('--sy', SP.s[0].toFixed(3));
    }
  }

  /* ------------------------------------------------------------ WebGL velvet
     The rest frame (live = grain = projector = open = lift = 0) reproduces the first-frame CSS
     of block 1 exactly: same stops, same alphas in /255, premultiplied like CSS gradients, same
     layer order. That keeps the CSS to WebGL swap invisible. Everything else fades in after it. */

  var VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform vec2 R;uniform vec2 V;uniform float T;uniform vec2 P;uniform float O;uniform float L;',
    'uniform vec2 K;uniform float LV;uniform float GR;uniform float PJ;uniform vec3 F;uniform vec2 SG;uniform vec4 PF;',
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
    '  if(v>=a){if(v<Py){float s=(v-a)/max(Py-a,1e-4);e=Px*mix(s,sqrt(max(0.,1.-(1.-s)*(1.-s))),min(O,1.));',
    '   e=max(0.,e-SG.x*Px*.16*sin(3.14159*s));}',
    '  else e=Px*(1.+SG.y*(v-Py)/max(1.-Py,1e-4));}',
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
    // the projector: the title lands on the pleats, bent by their depth, brighter on the crests;
    // PF carries the lamp flicker (x), the halo flicker (y) and the gate weave (z, w)
    ' if(PJ>0.){float dep=-cos(6.28318*ph);float fc=.52+.48*(.5+.5*dep);',
    '  vec2 q=vec2((x+dep*P.x*.075*LV+PF.z)/W,(y+PF.w)/H);float sh=texture2D(S0,q).a,hl=texture2D(S1,q).a;',
    '  float tr=.72+.28*clamp(dot(c,vec3(.299,.587,.114))*4.,0.,1.);',
    '  c+=PJ*(PF.x*tr*(CH*sh*fc*1.05+FO*sh*sh*fc*.22)+PF.y*vec3(.55,.16,.14)*hl*.85*fc);',
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
    ['R', 'V', 'T', 'P', 'O', 'L', 'K', 'LV', 'GR', 'PJ', 'F', 'SG', 'PF', 'S0', 'S1'].forEach(function (n) { U[n] = g.getUniformLocation(pr, n); });
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

  // A film projector: the shutter breathes at 24 frames a second, the lamp sags now and then,
  // a frame drops out, the gate weaves a fraction of a pixel. Light and halo flicker apart.
  function flicker(T) {
    var fr = Math.floor(T * 24), a = hz(fr), b = hz(fr + 911), c = hz(Math.floor(T * 2.5) + 77);
    var k = 0.9 + 0.1 * a - 0.05 * (0.5 + 0.5 * Math.sin(T * 1.9));
    if (b > 0.972) k *= 0.6 + 0.15 * a;
    if (c > 0.9) k *= 0.86;
    return [k, 0.7 + 0.45 * hz(fr + 31) * (0.6 + 0.4 * k), (hz(Math.floor(T * 12) + 5) - 0.5) * 0.7, (hz(Math.floor(T * 12) + 9) - 0.5) * 0.5];
  }

  var spData = new Float32Array(12);
  function drawGL(T) {
    var g = GL.g, U = GL.U, sk = shake(T), F = frameEnd(VW.w, VW.h), f = flicker(T);
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
    g.uniform2f(U.SG, S.sag, S.swing);
    g.uniform4f(U.PF, f[0], f[1], f[2], f[3]);
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
    var cp = S.open > 0 ? polygonAt(S.open, frameEnd(VW.w, VW.h), S.sag, S.swing) : '';
    halves.forEach(function (h) {
      h.style.transform = (h.classList.contains('gx-l') ? 'scaleX(-1) ' : '') + 'translateY(' + ty + 'px) skewX(' + sx + 'deg)';
      h.style.clipPath = h.style.webkitClipPath = cp;
    });
  }

  function toCSS() {
    if (mode === 'css') return;
    mode = GX.debug.mode = 'css';
    if (GL && GL.cv.parentNode) GL.cv.style.display = 'none';
    GL = null;
    halves.forEach(function (h) { h.style.visibility = ''; });
    curtain.style.background = '';
  }

  var lastTick = [0, 0];   // [GSAP global time, wall clock] at the last frame
  function tick() {
    var T = clock();
    lastTick = [gsap.globalTimeline.time(), performance.now()];
    follow(T);
    if (spot) spotTick(T);
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
  var proj = { pts: [], purpose: window.GX_PURPOSE === true || /purpose/.test(HASH) };

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
    var fs = por ? 10 : Math.max(11, Math.min(14, W * 0.0085));
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
      var bx = Math.max(0, Math.floor(box.x0 * dpr)), byy = Math.floor(box.y0 * dpr);
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
     The overture: "Mystery Sax" by Kevin MacLeod (incompetech.com, CC BY 4.0; credit at the foot
     of the hero, details in dist/audio/CREDITS.md). It starts with the gesture that opens the
     curtain, on the low drone of its first seconds; the three shivers run over the drone and the
     sax's first note lands on the first moment of the rise. The file is fetched and decoded ahead
     of time in an OfflineAudioContext (which plays nothing), so the entry is not late. Besides the
     music, only the velvet makes a sound. Nothing is created or played before a gesture; with sound
     off the page does exactly the same. */

  var VOL = 1;
  var OV = { entry: 1.967, gain: 0.6 };   // seconds into overture.mp3 where the sax enters
  var ov = { started: false, ab: null, buf: null, loading: null };
  function riseEase(p) { return 1 - Math.pow(1 - Math.pow(clamp(p, 0, 1), 1.6), 2.4); }

  function noiseBuf(c, dur) {
    var n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function impulse(c, dur, decay) {
    var n = Math.floor(c.sampleRate * dur), b = c.createBuffer(2, n, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var i = 0; i < n; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.5; d[i] = lp * Math.pow(1 - i / n, decay); }
    }
    return b;
  }
  // a ballroom: a long, soft room behind a gentle lowpass
  function graph(c) {
    var master = c.createGain(); master.gain.value = VOL; master.connect(c.destination);
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 8500; lp.Q.value = 0.4;
    var dry = c.createGain(); dry.gain.value = 0.8;
    var wet = c.createGain(); wet.gain.value = 0.38;
    var room = c.createConvolver(); room.buffer = impulse(c, 1.8, 3.4);
    lp.connect(dry); lp.connect(room); room.connect(wet);
    dry.connect(master); wet.connect(master);
    return { c: c, out: lp, master: master, noise: noiseBuf(c, 2.5) };
  }
  function swish(X, t, D, g) {
    var n = X.c.createBufferSource(), bp = X.c.createBiquadFilter(), e = X.c.createGain();
    n.buffer = X.noise; n.loop = true;
    bp.type = 'bandpass'; bp.Q.value = 0.6;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.linearRampToValueAtTime(1200, t + D * 0.45);
    bp.frequency.linearRampToValueAtTime(700, t + D);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(g, t + D * 0.3);
    e.gain.exponentialRampToValueAtTime(0.0001, t + D + 0.2);
    n.connect(bp); bp.connect(e); e.connect(X.out);
    n.start(t, Math.random()); n.stop(t + D + 0.3);
    GX.debug.sounds++;
  }

  var A = null;
  function audio() {
    if (!B.snd) return null;
    try {
      if (!A) {
        var C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        A = graph(new C());
        GX.debug.audioAt = Math.round(performance.now());
      }
      if (A.c.state !== 'running') A.c.resume();
    } catch (e) { return null; }
    return A;
  }
  function live() { return B.snd && A && A.c.state === 'running' ? A : null; }

  function loadOverture() {
    if (!ov.loading) {
      ov.loading = fetch(DIST + 'audio/overture.mp3')
        .then(function (r) { if (!r.ok) throw new Error('overture ' + r.status); return r.arrayBuffer(); })
        .then(function (ab) {
          ov.ab = ab;
          var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
          if (!OC) return;
          return new Promise(function (ok) {
            try { new OC(2, 1, 44100).decodeAudioData(ab.slice(0), function (buf) { ov.buf = buf; ok(); }, function () { ok(); }); } catch (e) { ok(); }
          });
        })
        .catch(function () {});
    }
    return ov.loading;
  }

  // riseIn: seconds from now until the curtain starts to rise (null when the curtain is not opening).
  function music(riseIn) {
    var X = audio();
    if (!X || ov.started) return;
    var t0 = performance.now();
    if (X.c.state !== 'running') {
      X.c.resume().then(function () {
        if (X.c.state === 'running') music(riseIn == null ? null : riseIn - (performance.now() - t0) / 1000);
      }, function () {});
      return;
    }
    ov.started = true;
    loadOverture().then(function () {
      if (ov.buf) return ov.buf;
      if (!ov.ab) throw 0;
      return new Promise(function (ok, no) { X.c.decodeAudioData(ov.ab.slice(0), ok, no); });
    }).then(function (buf) {
      if (!live()) throw 0;
      var spent = (performance.now() - t0) / 1000;
      var lead = riseIn == null ? OV.entry : riseIn - spent;          // seconds until the sax should sound
      var off = Math.max(0, OV.entry - lead), wait = Math.max(0, lead - OV.entry);
      var src = X.c.createBufferSource(), g = X.c.createGain(), t = X.c.currentTime + 0.02 + wait;
      src.buffer = buf;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(OV.gain, t + 0.5);
      src.connect(g); g.connect(X.out);
      src.start(t, off);
      GX.debug.sounds++;
      GX.debug.overture = { offset: +off.toFixed(3), wait: +wait.toFixed(3), saxAt: Math.round(performance.now() + (0.02 + wait + OV.entry - off) * 1000) };
      log('overture');
    }).catch(function () { ov.started = false; });
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

  // While the cord is pulled the tableau lines take up slack: the inner bottom corners begin to
  // rise, a sliver of light opens at the seam, the hem lifts a little. Each stretch of rope plays
  // one small note.
  function dragFx(y) {
    var k = clamp(y / MAX, 0, 1);
    SP.o[2] = Math.pow(k, 1.4) * 0.055;
    SP.l[2] = k * 0.012;
    var seg = Math.floor(y / STEP);
    if (seg > lastSeg) {
      for (var i = lastSeg; i < seg; i++) { kick(0.18); GX.debug.knocks++; }
      lastSeg = seg;
    } else if (seg < lastSeg) lastSeg = seg;
  }
  // the label steps aside while the cord is pulled, so the tassel never sits on it
  function label(on) {
    if (!pull || B.state) return;
    gsap.to(pull, on ? { opacity: 1, duration: 0.6, delay: 0.5, onComplete: function () { gsap.set(pull, { clearProps: 'opacity' }); } } : { opacity: 0, duration: 0.25 });
  }
  function back() {
    lastSeg = 0;
    label(true);
    SP.c[0] = gsap.getProperty(cord, 'y') || 0;
    SP.c[1] = 0; SP.c[2] = 0;
    SP.o[2] = 0; SP.l[2] = 0;
    startSway();
  }

  // After the opening the cord hangs with the gathered cloth, over the right leg of the frame,
  // and never past the edge of the screen.
  function legOffset() {
    var r = cord.getBoundingClientRect(), F = frameEnd(VW.w || innerWidth, VW.h || innerHeight), w = VW.w || innerWidth;
    var centre = Math.min(w - (1 - F[0]) * w / 4, w - 17);
    return centre - (r.left + r.width / 2) + (gsap.getProperty(cord, 'x') || 0);
  }
  function cue() { kick(0.55); GX.debug.heavy++; log('cue'); }

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
      onDragStart: function () { dragging = true; label(false); },
      onDrag: function () { dragFx(this.y); },
      onRelease: function () { dragging = false; audio(); release(this.y); },
      onClick: function () { open('tap'); }
    })[0];
    // keyboard Space or Enter on the focused tassel; pointer clicks belong to Draggable
    B.tap = function () { if (Date.now() - lastPointer < 800) return; open('tap'); };
    B.eng = open;
    startSway();
  }
  function release(y) { if (y > THR) open('drag'); else if (!B.state) back(); }

  // Review hooks: hold the cord at y and let go, without a pointer.
  GX.debug.hold = function (y) { if (!dragging) label(false); dragging = true; stopSway(); gsap.set(cord, { y: y }); dragFx(y); };
  GX.debug.letGo = function (y) { dragging = false; release(y); };

  /* ------------------------------------------------------------ the opening
     Release: the cord springs back and the lifted corners fall to the floor. Three shivers run
     through the cloth. Then the lines take the curtain up: a slow, heavy start, a long sweep, the middle
     of the cloth trailing the lines, and a soft overshoot as it stops, the legs swinging once or
     twice before they hang still. */

  var RISE_D = 2.3, RISE_T = 3.6;

  function riseAt(t) {
    var p = clamp(t / RISE_D, 0, 1), base = riseEase(p);
    var vel = (riseEase(p + 0.004) - riseEase(p - 0.004)) / 0.008;
    var u = Math.max(0, t - (RISE_D - 0.3)), env = smooth(u / 0.35) * Math.exp(-2.6 * u);
    S.open = base + 0.03 * env * Math.sin(6.9 * u);
    S.swing = 0.045 * env * Math.sin(5.6 * u + 0.5);
    S.sag = clamp(vel / 1.6, 0, 1) * (1 - 0.3 * p);
    if (!revealed && S.open > 0.4) { revealed = true; log('reveal'); emit('gx:reveal'); }
  }

  function open(src) {
    if (B.state) return;
    B.state = 'opening';
    dragging = false;
    GX.debug.openedBy = src;
    log('open:' + src);
    audio();
    if (drag) drag.disable();
    stopSway();
    if (mode === 'css') curtain.style.background = 'transparent';
    gsap.killTweensOf(S, 'proj');
    gsap.to(pull, { opacity: 0, duration: 0.4 });
    S.open = Math.max(0, SP.o[0]);
    S.lift = Math.max(0, SP.l[0]);
    var tl = GX.tl = gsap.timeline();
    if (src !== 'drag') {
      lastSeg = 0;
      tl.to(cord, { y: 128, duration: 0.5, ease: 'power2.in', onUpdate: function () {
        var y = gsap.getProperty(cord, 'y'), k = clamp(y / MAX, 0, 1);
        dragFx(y); S.open = Math.pow(k, 1.4) * 0.055; S.lift = k * 0.012;
      } });
    }
    tl.addLabel('rel');
    tl.to(cord, { y: 0, duration: 0.9, ease: 'elastic.out(1,.42)' }, 'rel');
    tl.to(S, { open: 0, lift: 0, duration: 0.42, ease: 'power2.in' }, 'rel');
    tl.call(kick, [0.3], 'rel+=0.42');
    [0.45, 0.9, 1.35].forEach(function (t, i) { tl.call(cue, [i], 'rel+=' + t); });
    tl.to(S, { proj: 0, duration: 0.9, ease: 'power1.in' }, 'rel+=1.5');
    tl.call(function () { var X = live(); if (X) swish(X, X.c.currentTime + 0.01, RISE_D, 0.06); log('rise'); emit('gx:rise'); }, null, 'rel+=1.6');
    tl.to(cord, { x: legOffset(), duration: RISE_D, ease: 'power2.inOut' }, 'rel+=1.6');
    var R = { t: 0 };
    tl.to(R, { t: RISE_T, duration: RISE_T, ease: 'none', onUpdate: function () { riseAt(R.t); } }, 'rel+=1.6');
    tl.add(houseLight(true), 'rel+=1.6');
    tl.add(strike(), 'rel+=' + (1.6 + RISE_D - 0.1));
    tl.add(sheen(), 'rel+=' + (1.6 + RISE_D + 0.35));
    tl.call(settled, null, 'rel+=' + (1.6 + RISE_T));   // the foil pass runs on after it; scrolling is not held for it
    // The sax's first note lands on the first frame of the rise. A new timeline counts from the last
    // frame drawn, not from now, so the rise time is read off the GSAP clock and anchored to that frame.
    var riseT = tl.startTime() + tl.labels.rel + 1.6;
    music(Math.max(0, riseT - lastTick[0] - (performance.now() - lastTick[1]) / 1000));
  }

  function settled() {
    log('settled');
    S.sag = 0; S.swing = 0; S.open = 1;
    if (mode === 'css') drawCSS(clock());
    B.settle();
    startSway();
    // after the opening the frame only breathes while it is on screen
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { run(en[0].isIntersecting); }).observe(curtain);
    }
  }

  /* ------------------------------------------------------------ scene 1: the open tableau
     House light: while the curtain is closed the emboss sits in half light; it comes up with the
     rise. Follow spot (desktop only, where there is a mouse to follow): a theatre lamp struck on
     the title when the curtain settles, then following the pointer as an operator would, a beat
     behind and overshooting a little; back to the title when the pointer leaves the stage. Its
     light is a colour-dodge gain, so it lifts what it falls on in proportion, like light on a
     surface: the oxblood warms toward velvet in light, the relief deepens, the champagne type
     catches it and reads as foil. No flicker: a lamp, not film. Foil pass: one sweep of light
     over the type and the GALLERIA logo after the spot is struck. */

  // Scene 1 belongs to the desktop. On phones the hero stays exactly as it was (v0.1.3): the emboss
  // filter is expensive there, and animating it during the rise made the curtain stutter.
  var DESK = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var spot = null;
  function setupSpot() {
    var hero = doc.getElementById('gx-hero');
    if (spot || !hero || !DESK) return;
    var el = doc.createElement('div');
    el.className = 'gx-spot';
    el.setAttribute('aria-hidden', 'true');
    hero.appendChild(el);
    var P = spot = { el: el, hero: hero, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, k: 0, iris: 0, home: true, T: null, placed: false };
    hero.addEventListener('pointermove', function (e) {
      if (B.rm || (e.pointerType && e.pointerType !== 'mouse')) return;
      var h = hero.getBoundingClientRect();
      P.tx = e.clientX - h.left; P.ty = e.clientY - h.top; P.home = false;
    });
    hero.addEventListener('pointerleave', function () { P.home = true; });
    GX.debug.spot = P;
  }
  function spotHome() {
    var h = spot.hero.getBoundingClientRect(), t = spot.hero.querySelector('.gx-hero__title'), r = t ? t.getBoundingClientRect() : h;
    return [r.left + r.width / 2 - h.left, r.top + r.height / 2 - h.top];
  }
  function spotTick(T) {
    var P = spot, dt = P.T == null ? 0 : clamp(T - P.T, 0, 0.05);
    P.T = T;
    if (P.home || !P.placed) { var a = spotHome(); P.tx = a[0]; P.ty = a[1]; }
    // the operator keeps the light on the stage: the drapes stand in front of it and take none
    var hw = P.hero.clientWidth, hh = P.hero.clientHeight;
    P.tx = clamp(P.tx, hw * 0.2, hw * 0.8); P.ty = clamp(P.ty, hh * 0.16, hh * 0.86);
    if (!P.placed || B.rm) { P.x = P.tx; P.y = P.ty; P.placed = true; }
    for (var n = 0, st = dt / 4; n < 4 && dt > 0; n++) {   // the operator: a spring, slightly underdamped
      P.vx += (-36 * (P.x - P.tx) - 8.6 * P.vx) * st; P.vy += (-36 * (P.y - P.ty) - 8.6 * P.vy) * st;
      P.x += P.vx * st; P.y += P.vy * st;
    }
    var w = P.el.offsetWidth, h = P.el.offsetHeight;
    P.el.style.transform = 'translate3d(' + (P.x - w / 2).toFixed(1) + 'px,' + (P.y - h / 2).toFixed(1) + 'px,0) scale(' + (0.72 + 0.28 * P.iris).toFixed(3) + ')';
    P.el.style.opacity = P.k.toFixed(3);
  }
  // The lamp catching: the iris opens smoothly while the light stutters twice and then holds.
  function strike() {
    if (!spot) return gsap.timeline();
    if (B.rm) return gsap.to(spot, { k: 1, iris: 1, duration: 0 });
    return gsap.timeline()
      .to(spot, { k: 0.5, duration: 0.05, ease: 'none' })
      .to(spot, { k: 0.12, duration: 0.07, ease: 'none' })
      .to(spot, { k: 0.72, duration: 0.05, ease: 'none' })
      .to(spot, { k: 0.38, duration: 0.08, ease: 'none' })
      .to(spot, { k: 1, duration: 0.6, ease: 'power2.out' })
      .to(spot, { iris: 1, duration: 1.1, ease: 'power2.out' }, 0);
  }

  function sheen() {
    var tl = gsap.timeline(), hero = doc.getElementById('gx-hero');
    if (!hero || B.rm || !DESK) return tl;
    [].forEach.call(hero.querySelectorAll('.gx-hero__title,.gx-hero__line,.gx-hero__pres,.gx-hero__date,.gx-hero__time'), function (el, i) {
      var o = { p: 100 };
      tl.to(o, { p: 0, duration: 1.5, ease: 'power1.inOut',
        onStart: function () { el.classList.add('gx-sheen'); },
        onUpdate: function () { el.style.setProperty('--sx', o.p.toFixed(1) + '%'); },
        onComplete: function () { el.classList.remove('gx-sheen'); el.style.removeProperty('--sx'); },
        onReverseComplete: function () { el.classList.remove('gx-sheen'); } }, i * 0.07);
    });
    var g = hero.querySelector('#gx-foil');
    if (g) {
      var stops = g.querySelectorAll('stop'), logo = g.ownerSVGElement, q = { p: -0.15 };
      tl.to(q, { p: 1.15, duration: 1.5, ease: 'power1.inOut',
        onStart: function () { logo.style.fill = 'url(#gx-foil)'; },
        onUpdate: function () { [q.p - 0.12, q.p, q.p + 0.12].forEach(function (v, i) { stops[i + 1].setAttribute('offset', clamp(v, 0, 1).toFixed(3)); }); },
        onComplete: function () { logo.style.fill = ''; } }, 0);
    }
    return tl;
  }
  // Opacity only, on its own layer while it moves, so the emboss filter is drawn once and not per frame.
  function houseLight(on) {
    var a = doc.querySelector('.gx-hero__art');
    if (!a || !DESK) return gsap.timeline();
    if (!on) { gsap.set(a, { opacity: 0.22 }); return gsap.timeline(); }
    return gsap.to(a, { opacity: 1, duration: 2.8, ease: 'power2.out',
      onStart: function () { a.style.willChange = 'opacity'; }, onComplete: function () { a.style.willChange = ''; } });
  }

  /* ------------------------------------------------------------ hero art (static, iteration 1) */

  function svgLogo(L, foil) {
    return '<svg viewBox="0 0 ' + L.w + ' ' + L.h + '" aria-hidden="true" focusable="false">' +
      (foil ? '<defs><linearGradient id="gx-foil" x1="0" y1="0" x2="1" y2=".25"><stop offset="0" stop-color="#D3B69C"/><stop offset="0" stop-color="#D3B69C"/><stop offset="0" stop-color="#FFFCD9"/><stop offset="0" stop-color="#D3B69C"/><stop offset="1" stop-color="#D3B69C"/></linearGradient></defs>' : '') +
      L.d.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>';
  }
  // L is the lit height map: 0.5 on flat ground. Above that becomes light on the edges, below it shadow.
  // The bevel is kept about 1.25 screen pixels wide whatever the size of the cartouche: in SVG units it
  // would turn soft and blurry on a large desktop. On big screens the light and shadow get 15% more.
  var BEVEL = 1.25;
  // pal: colours of the light and of the shadow. Oxblood paper by default; the carnet is cream.
  var OXB = { hi: '.62 .22 .22', sh: '.16 .03 .04' }, CREAM = { hi: '1 1 1', sh: '.4 .27 .18' };
  function emboss(id, azimuth, pal) {
    pal = pal || OXB;
    return '<filter id="' + id + '" data-hi="' + pal.hi + '" data-sh="' + pal.sh + '" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">' +
      '<feGaussianBlur in="SourceAlpha" stdDeviation="1.8" result="h"/>' +
      '<feDiffuseLighting in="h" surfaceScale="4" diffuseConstant="1" lighting-color="#fff" result="l">' +
      '<feDistantLight azimuth="' + azimuth + '" elevation="30"/></feDiffuseLighting>' +
      '<feColorMatrix in="l" type="matrix" values="0 0 0 0 .62 0 0 0 0 .22 0 0 0 0 .22 1.05 0 0 0 -.525" result="hi"/>' +
      '<feColorMatrix in="l" type="matrix" values="0 0 0 0 .16 0 0 0 0 .03 0 0 0 0 .04 -1.2 0 0 0 .6" result="sh"/>' +
      '<feMerge><feMergeNode in="sh"/><feMergeNode in="hi"/></feMerge></filter>';
  }
  function fitEmboss(slot, R) {
    var k = (slot.offsetWidth || 1) / R.w, sig = BEVEL / k, boost = 1 + 0.15 * clamp((k - 0.8) / 0.7, 0, 1);
    [].forEach.call(slot.querySelectorAll('filter'), function (f) {
      f.querySelector('feGaussianBlur').setAttribute('stdDeviation', sig.toFixed(3));
      f.querySelector('feDiffuseLighting').setAttribute('surfaceScale', (4 * sig / 1.8).toFixed(3));
      var m = f.querySelectorAll('feColorMatrix'), h = 1.05 * boost, d = 1.2 * boost;
      var hi = f.getAttribute('data-hi').split(' '), sh = f.getAttribute('data-sh').split(' ');
      m[0].setAttribute('values', '0 0 0 0 ' + hi[0] + ' 0 0 0 0 ' + hi[1] + ' 0 0 0 0 ' + hi[2] + ' ' + h.toFixed(3) + ' 0 0 0 ' + (-h / 2).toFixed(3));
      m[1].setAttribute('values', '0 0 0 0 ' + sh[0] + ' 0 0 0 0 ' + sh[1] + ' 0 0 0 0 ' + sh[2] + ' ' + (-d).toFixed(3) + ' 0 0 0 ' + (d / 2).toFixed(3));
    });
    if (slot.classList.contains('gx-hero__art')) GX.debug.emboss = { k: +k.toFixed(3), sigma: +sig.toFixed(3) };
  }
  function heroArt() {
    var hero = doc.getElementById('gx-hero');
    if (!hero) return;
    [].forEach.call(hero.querySelectorAll('[data-gx-art]'), function (el) {
      var L = LOGO && LOGO[el.getAttribute('data-gx-art')];
      if (!L || el.querySelector('svg')) return;
      el.insertAdjacentHTML('afterbegin', svgLogo(L, el.getAttribute('data-gx-art') === 'galleria'));
      el.classList.add('gx-has-art');
    });
    var slot = hero.querySelector('.gx-hero__art'), R = window.GX_ART && window.GX_ART.rococos;
    if (slot && R && !slot.firstChild) {
      // Blind emboss, as on the save the date: the ornament has the colour of the paper; only light
      // and shadow on its rounded edges show it. The softened outline is a height map lit from
      // above and a little to the left; flat ground and flat faces stay untouched.
      slot.innerHTML = '<svg viewBox="0 0 ' + R.w + ' ' + R.h + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
        '<defs><path id="gx-rc" d="' + R.d + '"/>' + emboss('gx-emb-l', 250) + emboss('gx-emb-p', 160) + '</defs>' +
        '<use href="#gx-rc" class="gx-emb"/></svg>';
      var use = slot.querySelector('use'), mq = matchMedia('(orientation: portrait)');
      // in portrait the cartouche is turned a quarter, so the light turns the other way to stay on top
      var orient = function () { use.setAttribute('filter', 'url(#gx-emb-' + (mq.matches ? 'p' : 'l') + ')'); };
      orient();
      if (mq.addEventListener) mq.addEventListener('change', orient); else if (mq.addListener) mq.addListener(orient);
      fitEmboss(slot, R);
      if ('ResizeObserver' in window) new ResizeObserver(function () { fitEmboss(slot, R); }).observe(slot);
    }
    log('hero-art');
  }

  /* ------------------------------------------------------------ scene 2: the carnet de bal
     A cream card hung from a cord, with a small blind-embossed cartouche on top, like a seal (white
     light, warm shadow, as on paper). It moves like a hanging card: a pendulum from the top of the
     section, the card a beat behind the cord, the tassel behind the card. When it comes into view it
     is given one push, as if just hung (phones too). On desktop the page's scroll moves it, the
     pointer brushes it, and it can be taken and pulled aside; let go, it swings back. The springs
     run only while it is on screen or moving, transform only. */

  function carnet() {
    var sec = doc.getElementById('gx-carnet');
    if (!sec) return;
    var card = sec.querySelector('.gx-carnet__card'), orn = sec.querySelector('.gx-carnet__orn'), R = window.GX_ART && window.GX_ART.rococos;
    if (orn && R && !orn.firstChild) {
      orn.innerHTML = '<svg viewBox="0 0 ' + R.w + ' ' + R.h + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><defs>' +
        (doc.getElementById('gx-rc') ? '' : '<path id="gx-rc" d="' + R.d + '"/>') + emboss('gx-emb-c', 250, CREAM) + '</defs>' +
        '<use href="#gx-rc" filter="url(#gx-emb-c)"/></svg>';
      fitEmboss(orn, R);
      if ('ResizeObserver' in window) new ResizeObserver(function () { fitEmboss(orn, R); }).observe(orn);
    }
    if (B.rm || !card || !window.gsap) return;
    var hang = sec.querySelector('.gx-carnet__hang'), tas = sec.querySelector('.gx-carnet__tas b');
    // Three coupled springs, in degrees. th: cord and card swing together from the top of the section
    // (a pendulum of about 1.4 s that loses its energy slowly). ph: the card tilts a little more than
    // the cord, a beat late. ps: the tassel answers the card's motion.
    var C = { th: 0, vth: 0, ph: 0, vph: 0, ps: 0, vps: 0, T: null, y: scrollY, vis: false, run: false, grab: null, tgt: 0 };
    var W = 2 * Math.PI / 1.4;
    function origin() {
      var sr = sec.getBoundingClientRect(), hr = hang.getBoundingClientRect(), cr = card.getBoundingClientRect();
      hang.style.transformOrigin = '50% ' + Math.round(sr.top - hr.top) + 'px';
      C.L = Math.max(240, cr.top + cr.height / 2 - sr.top);
    }
    origin();
    card.style.transformOrigin = '50% 0';
    if (tas) tas.style.transformOrigin = '50% 0';
    function step() {
      var T = clock(), dt = C.T == null ? 0 : clamp(T - C.T, 0, 0.05);
      C.T = T;
      var target = C.grab ? C.grab.th : 0;
      if (DESK && !C.grab && dt > 0) target = clamp(-(scrollY - C.y) / dt * 0.0012, -1.6, 1.6);   // the page moving under it
      C.y = scrollY;
      var z = C.grab ? 0.9 : 0.11;
      for (var n = 0, st = dt / 4; n < 4 && dt > 0; n++) {
        var a = -W * W * (C.th - target) - 2 * z * W * C.vth;
        C.vth += a * st; C.th += C.vth * st;
        var pa = -49 * (C.ph - 0.35 * C.th) - 4.2 * C.vph;
        C.vph += pa * st; C.ph += C.vph * st;
        var sa = -64 * (C.ps + 0.12 * C.vph) - 2.9 * C.vps;
        C.vps += sa * st; C.ps += C.vps * st;
      }
      hang.style.transform = 'rotate(' + C.th.toFixed(3) + 'deg)';
      card.style.transform = 'rotate(' + C.ph.toFixed(3) + 'deg)';
      if (tas) tas.style.transform = 'rotate(' + C.ps.toFixed(3) + 'deg)';
      var e = Math.abs(C.th) + Math.abs(C.vth) * 0.2 + Math.abs(C.ph) + Math.abs(C.vph) * 0.2 + Math.abs(C.ps);
      if (e < 0.004 && !C.grab && !(DESK && C.vis)) sleep();   // settled: stop spending frames
    }
    function wake() { if (!C.run && !B.rm) { C.run = true; C.T = null; C.y = scrollY; gsap.ticker.add(step); } }
    function sleep() { if (C.run) { C.run = false; gsap.ticker.remove(step); } }
    var hung = false;
    new IntersectionObserver(function (en) {
      C.vis = en[0].isIntersecting;
      if (C.vis) { origin(); wake(); if (!hung) { hung = true; C.vth = 5.6; log('carnet'); } }   // just hung on its hook
      else if (!C.grab) sleep();
    }, { threshold: 0.3 }).observe(card);
    GX.debug.carnet = C;
    if (!DESK) return;
    // Desktop: brush it with the pointer, or take it and pull it aside; let go and it swings back.
    var moved = false;
    card.addEventListener('pointermove', function (e) {
      if (C.grab || e.pointerType !== 'mouse') return;
      C.vth += clamp((e.movementX || 0) * 0.06, -2.5, 2.5); wake();
    });
    card.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.pointerType !== 'mouse') return;
      C.grab = { x0: e.clientX, th: C.th, on: false, id: e.pointerId }; moved = false; wake();
    });
    addEventListener('pointermove', function (e) {
      var g = C.grab;
      if (!g || e.pointerId !== g.id) return;
      var dx = e.clientX - g.x0;
      if (!g.on && Math.abs(dx) > 4) { g.on = true; moved = true; card.classList.add('gx-grabbing'); try { card.setPointerCapture(g.id); } catch (er) {} }
      if (g.on) { g.th = clamp(Math.atan2(dx, C.L) * 180 / Math.PI, -7, 7); e.preventDefault(); }
    });
    var drop = function (e) { if (!C.grab || (e && e.pointerId !== C.grab.id)) return; C.grab = null; card.classList.remove('gx-grabbing'); };
    addEventListener('pointerup', drop); addEventListener('pointercancel', drop);
    card.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);   // a pull is not a click on the address
    addEventListener('resize', origin);
    GX.debug.carnetGrab = function (x0, dx) { C.grab = { x0: x0, th: clamp(Math.atan2(dx, C.L) * 180 / Math.PI, -7, 7), on: true, id: -1 }; wake(); };
    GX.debug.carnetDrop = function () { C.grab = null; };
  }

  /* ------------------------------------------------------------ boot */

  function swap() {
    fit();
    drawGL(clock());
    requestAnimationFrame(function () {
      drawGL(clock());
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
    houseLight(false);
    setupSpot();
    setTimeout(loadOverture, 3000);   // fetch the overture once the curtain is up, out of the way of first paint
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
    gsap.ticker.lagSmoothing(0);   // keep the timeline on the wall clock, which the music follows
    if (!B.state && !B.rm) takeOver();
    else {
      GX.debug.mode = B.rm ? 'reduced' : (B.seen ? 'seen' : 'late');
      fit();
      setupSpot();
      var place = function () { gsap.set(cord, { x: legOffset() }); if (!B.rm) startSway(); if (spot) { run(true); strike(); } if (!B.rm) gsap.delayedCall(0.4, function () { sheen(); }); };
      if (B.state === 'open') place(); else doc.addEventListener('gx:open', place);
    }
    B.onsnd = function (on) {
      if (on && B.state === 'open') music(null); else if (on) audio();
      if (A) A.master.gain.setTargetAtTime(on ? VOL : 0, A.c.currentTime, 0.03);
    };
    root.classList.add('gx-ready');
    log('ready');
  }, function (e) { GX.debug.error = String(e && e.message || e); });

  Promise.all([art, domReady, libs.catch(function () {})]).then(function () { heroArt(); carnet(); });
})();
