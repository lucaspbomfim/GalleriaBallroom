/*!
 * GalleriaBallroom engine v0.5.2
 * Galleria Thanksgiving Ball RSVP page, Pyper Publishing.
 * Scene 0: the velvet curtain in WebGL, the projector, the cord and its tassel, a sax overture,
 * the tableau opening and the settled frame. Scene 1: the open tableau, with the follow spot
 * (desktop), the house light coming up on the emboss and a pass of foil over the type. Scene 2:
 * the carnet de bal, a cream card hung on a cord (its emboss, its swing). Scene 3: the box office.
 * Scene 4: the dance floor (marquee, mirror ball, reflections) and the footer.
 * Readable source. dist/galleria.min.js is this file run through terser.
 * Loaded by the page's first block, which creates window.GXB. No font files live here.
 * Hash switches for review: #curtain (show the curtain again), #purpose (purpose line in the
 * projection). They combine: #curtain-purpose.
 */
(function () {
  'use strict';

  var VERSION = '0.5.2';
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
    var G = glOn(cv);
    if (!G) return null;
    cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); GX.debug.lost = true; toCSS(); });
    return G;
  }

  // one curtain program on a canvas: the hero's, and the stage's (scene 3)
  function glOn(cv) {
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
    return { cv: cv, g: g, U: U, tx: tx };
  }

  function upload(unit, canvas, G) {
    G = G || GL;
    var g = G.g;
    g.activeTexture(g.TEXTURE0 + unit);
    g.bindTexture(g.TEXTURE_2D, G.tx[unit]);
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
    // the sax alone goes through its own door: open in the hero and on the dance floor, muffled between
    var ov = c.createBiquadFilter(); ov.type = 'lowpass'; ov.frequency.value = 18000; ov.Q.value = 0.5;
    var ovg = c.createGain(); ovg.gain.value = 1;
    ov.connect(ovg); ovg.connect(lp);
    return { c: c, out: lp, master: master, noise: noiseBuf(c, 2.5), ov: ov, ovg: ovg };
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
      src.connect(g); g.connect(X.ov || X.out);
      roomApply(true);
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
    var C = { th: 0, vth: 0, ph: 0, vph: 0, ps: 0, vps: 0, yo: 0, vyo: 0, T: null, y: scrollY, vis: false, run: false, grab: null };
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
      var g = C.grab && C.grab.on ? C.grab : null, target = g ? g.th : 0;
      if (DESK && !C.grab && dt > 0) target = clamp(-(scrollY - C.y) / dt * 0.0012, -1.6, 1.6);   // the page moving under it
      C.y = scrollY;
      // held: the grabbed point stays under the pointer (stiff, critically damped); free: a slow pendulum
      var w = g ? 26 : W, z = g ? 0.95 : 0.11, wy = g ? 26 : 10, zy = g ? 0.95 : 0.3, ytgt = g ? g.y : 0;
      for (var n = 0, st = dt / 4; n < 4 && dt > 0; n++) {
        var a = -w * w * (C.th - target) - 2 * z * w * C.vth;
        C.vth += a * st; C.th += C.vth * st;
        var ya = -wy * wy * (C.yo - ytgt) - 2 * zy * wy * C.vyo;
        C.vyo += ya * st; C.yo += C.vyo * st;
        var pa = -49 * (C.ph - 0.35 * C.th) - 4.2 * C.vph;
        C.vph += pa * st; C.ph += C.vph * st;
        var sa = -64 * (C.ps + 0.12 * C.vph) - 2.9 * C.vps;
        C.vps += sa * st; C.ps += C.vps * st;
      }
      hang.style.transform = 'translateY(' + C.yo.toFixed(2) + 'px) rotate(' + C.th.toFixed(3) + 'deg)';
      card.style.transform = 'rotate(' + C.ph.toFixed(3) + 'deg)';
      if (tas) tas.style.transform = 'rotate(' + C.ps.toFixed(3) + 'deg)';
      var e = Math.abs(C.th) + Math.abs(C.vth) * 0.2 + Math.abs(C.ph) + Math.abs(C.vph) * 0.2 + Math.abs(C.ps) + Math.abs(C.yo) * 0.1 + Math.abs(C.vyo) * 0.02;
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
    // Desktop: brush it with the pointer, or take hold of it. Held, the point you grabbed stays under
    // the pointer: aside up to about 12 degrees, up and down up to 40 px against the give of the cord.
    // Let go and the speed of your hand goes into the swing; the cord brings it back.
    var moved = false;
    function hold(x, y) {
      var sr = sec.getBoundingClientRect();
      C.grab = { x0: x, y0: y, Lg: Math.max(160, y - sr.top), th0: C.th, th: C.th, y: C.yo, on: false, t: clock(), vth: 0, vy: 0 };
      moved = false; wake();
    }
    function pull(x, y) {
      var g = C.grab;
      if (!g) return;
      var dx = x - g.x0, dy = y - g.y0;
      if (!g.on && Math.sqrt(dx * dx + dy * dy) > 4) { g.on = true; moved = true; card.classList.add('gx-grabbing'); }
      if (!g.on) return;
      // a positive CSS rotation about the top carries the card to the left, so the angle is the negative of the pull
      var th = clamp(g.th0 - Math.atan2(dx, g.Lg) * 180 / Math.PI, -12, 12), yy = 40 * Math.tanh(dy / 120);
      var T = clock(), dt = Math.max(0.004, T - g.t);
      g.vth = 0.5 * g.vth + 0.5 * (th - g.th) / dt; g.vy = 0.5 * g.vy + 0.5 * (yy - g.y) / dt;
      g.th = th; g.y = yy; g.t = T;
    }
    function release() {
      var g = C.grab;
      if (!g) return;
      C.grab = null; card.classList.remove('gx-grabbing');
      if (g.on && clock() - g.t < 0.08) { C.vth = clamp(g.vth, -50, 50); C.vyo = clamp(g.vy, -400, 400); }   // a throw, kept within about 12 degrees of swing
    }
    card.addEventListener('pointermove', function (e) {
      if (C.grab || e.pointerType !== 'mouse') return;
      C.vth -= clamp((e.movementX || 0) * 0.06, -2.5, 2.5); wake();
    });
    card.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.pointerType !== 'mouse') return;
      e.preventDefault();   // no text selection; a click on the address still goes through
      hold(e.clientX, e.clientY);
      try { card.setPointerCapture(e.pointerId); } catch (er) {}
    });
    addEventListener('pointermove', function (e) { if (C.grab && e.pointerType === 'mouse') pull(e.clientX, e.clientY); });
    addEventListener('pointerup', release); addEventListener('pointercancel', release);
    card.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);   // a pull is not a click on the address
    addEventListener('resize', origin);
    GX.debug.carnetHold = hold; GX.debug.carnetPull = pull; GX.debug.carnetRelease = release;
  }

  /* ------------------------------------------------------------ scene 3: the box office
     Three tickets built over the native Products block, which stays hidden and keeps doing the
     selling: our Reserve clicks its button and the MailerLite checkout opens (MD 15, proven by P4).
     The current lot is the lowest one present in the native block; its name and price are read from
     it. The others come from the table below. Each state is a print technique: the current ticket
     is printed on cream stock in oxblood ink; a closed one is a blind emboss on oxblood stock; the
     next one is engraved in line. Sales close by the clock at the end of November 10 in Orlando.
     Passage: on desktop velvet drapes, tied back, come down beside the checkout like a box-office
     window; on a phone a curtain closes and opens again in about 1.25 s. Thanks: when the checkout reports a
     completed purchase, a curtain closes on "Your place is confirmed." and opens again by itself.
     Review hashes: #closed (sales closed), #lot2, #lot3 (another lot current). */

  var LOTS = [
    { n: 1, roman: 'I', key: 'first', name: 'First Release', price: '$65' },
    { n: 2, roman: 'II', key: 'second', name: 'Second Release', price: '$85' },
    { n: 3, roman: 'III', key: 'final', name: 'Final Release', price: '$115' }
  ];
  var CLOSE_AT = Date.UTC(2026, 10, 11, 4, 59, 0);   // 11:59 PM, November 10, Orlando (EST)
  var PSEL = { card: '[data-type="product-wrapper"]', btn: '[data-button-type="mailerlite-checkout"]', title: 'h1,h2,h3,h4', price: '.font-bold' };
  function salesClosed() { return /closed/.test(HASH) || Date.now() >= CLOSE_AT; }

  function readProducts() {
    return [].map.call(doc.querySelectorAll(PSEL.card), function (w) {
      var t = ((w.querySelector(PSEL.title) || {}).textContent || '').trim(), pr = ((w.querySelector(PSEL.price) || {}).textContent || '').trim();
      var lot = LOTS.filter(function (L) { return new RegExp(L.key + ' release', 'i').test(t); })[0];
      return lot ? { lot: lot, price: pr.replace(/\.00$/, ''), open: function () { var b = w.querySelector(PSEL.btn); if (b) b.click(); } } : null;
    }).filter(Boolean).sort(function (a, b) { return a.lot.n - b.lot.n; });
  }

  function ticketHTML(L, state, price) {
    var name = L.name.split(' ');
    return '<article class="gx-ticket" data-state="' + state + '" aria-label="' + L.name + ', ' + price + (state === 'closed' ? ', closed' : '') + '">' +
      '<div class="gx-ticket__main"><p class="gx-ticket__num" aria-hidden="true">' + L.roman + '</p>' +
      '<p class="gx-ticket__admit">Admit one</p>' +
      '<h3 class="gx-ticket__name">' + name[0] + '<br>' + name[1] + '</h3>' +
      '<p class="gx-ticket__price">' + price + '</p>' + (state === 'closed' ? '<p class="gx-ticket__flag">Closed</p>' : '') + '</div>' +
      '<div class="gx-ticket__stub"><p class="gx-ticket__compact" aria-hidden="true">' + L.roman + ' ' + L.name + ' ' + price + '</p><p class="gx-ticket__when">November 19<br>6 PM</p>' +
      (state === 'current' ? '<button type="button" class="gx-ticket__reserve">Reserve</button>' : '') + '</div></article>';
  }

  function boxOffice() {
    var sec = doc.getElementById('gx-tickets'), row = sec && sec.querySelector('.gx-tix__row');
    if (!row || row.firstChild) return;
    var prods = readProducts(), force = (HASH.match(/lot([23])/) || [])[1], cur = prods[0] || null;
    if (force) cur = prods.filter(function (p) { return p.lot.n === +force; })[0] || cur;
    var closedNow = salesClosed() || !cur;
    row.innerHTML = LOTS.map(function (L) {
      var state = closedNow ? 'closed' : (L.n < cur.lot.n ? 'closed' : (L.n === cur.lot.n ? 'current' : 'next'));
      return ticketHTML(L, state, L.n === (cur && cur.lot.n) && cur.price ? cur.price : L.price);
    }).join('');
    GX.debug.box = { current: cur ? cur.lot.name : null, closed: closedNow, found: prods.map(function (p) { return p.lot.n; }) };
    if (closedNow) {
      var note = sec.querySelector('.gx-tix__note');
      if (note) note.textContent = 'Sales are closed.';
      [].forEach.call(doc.querySelectorAll('a[href="#gx-tickets"]'), function (a) {   // a call to action must never contradict the closing
        var sp = doc.createElement('span'); sp.className = a.className + ' gx-cta-closed'; sp.textContent = 'Sales are closed.'; a.parentNode.replaceChild(sp, a);
      });
      return;
    }
    var btn = row.querySelector('.gx-ticket__reserve'), tk = row.querySelector('[data-state="current"]');
    btn.addEventListener('click', function () { passage(cur.open); });
    [].forEach.call(doc.querySelectorAll('a[href="#gx-tickets"]'), function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); sec.scrollIntoView({ behavior: B.rm ? 'auto' : 'smooth', block: 'center' }); });
    });
    // the cue: on desktop the follow spot is struck on the ticket you can buy; on a phone, one pass of foil
    var cued = false;
    new IntersectionObserver(function (en) {
      if (!en[0].isIntersecting || cued) return;
      cued = true; log('box-cue');
      if (B.rm) return;
      if (DESK) spotOn(sec, tk); else tk.classList.add('gx-foilpass');
    }, { threshold: 0.45 }).observe(tk);
    modalWatch();
  }

  // a second follow spot, held on the current ticket
  function spotOn(sec, tk) {
    var el = doc.createElement('div'); el.className = 'gx-spot gx-spot--tix'; el.setAttribute('aria-hidden', 'true'); sec.appendChild(el);
    var P = { k: 0 };
    function place() {
      var s = sec.getBoundingClientRect(), r = tk.getBoundingClientRect();
      el.style.transform = 'translate3d(' + (r.left + r.width / 2 - s.left - el.offsetWidth / 2).toFixed(1) + 'px,' + (r.top + r.height * 0.42 - s.top - el.offsetHeight / 2).toFixed(1) + 'px,0)';
    }
    place(); addEventListener('resize', place);
    // softer than the hero's: on cream stock the full lamp burns the ticket to yellow
    gsap.timeline({ onUpdate: function () { el.style.opacity = (P.k * 0.55).toFixed(3); } })
      .to(P, { k: 0.5, duration: 0.05, ease: 'none' }).to(P, { k: 0.12, duration: 0.07, ease: 'none' })
      .to(P, { k: 0.72, duration: 0.05, ease: 'none' }).to(P, { k: 0.38, duration: 0.08, ease: 'none' })
      .to(P, { k: 1, duration: 0.6, ease: 'power2.out' });
  }

  /* ------------------------------------------------------------ the stage
     The same curtain, elsewhere: a second canvas fixed over the window, drawn by the hero's own
     shader (same velvet, same tableau, same projector). It frames the checkout as a tableau on
     desktop, crosses the screen on a phone, and carries the thanks. It draws only while something
     on it moves; at rest it keeps its last frame. */

  var STG = null;
  function stageGet() {
    if (STG !== null) return STG || null;
    var cv = doc.createElement('canvas');
    cv.className = 'gx-stage'; cv.setAttribute('aria-hidden', 'true');
    var G = glOn(cv);
    if (!G) { STG = false; return null; }
    STG = { G: G, cv: cv, st: { open: 0, lift: 1, live: 0, grain: 1, proj: 0, sag: 0, swing: 0 }, F: [0.86, 0.42, 0.06], sp: [{}, {}, {}], n: 0, W: 0, H: 0, pts: [], size: 12 };
    cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); cv.remove(); STG = false; });
    return STG;
  }
  function stageShow(z) {
    var S2 = stageGet();
    if (!S2) return null;
    S2.cv.style.zIndex = z;
    var dpr = Math.min(window.devicePixelRatio || 1, DESK ? 2 : 1.5);
    S2.W = innerWidth; S2.H = innerHeight;
    S2.cv.style.width = S2.W + 'px'; S2.cv.style.height = S2.H + 'px';
    S2.cv.width = Math.round(S2.W * dpr); S2.cv.height = Math.round(S2.H * dpr);
    S2.G.g.viewport(0, 0, S2.cv.width, S2.cv.height);
    if (!S2.cv.parentNode) doc.body.appendChild(S2.cv);
    return S2;
  }
  var spStage = new Float32Array(12);
  function stageDraw() {
    var S2 = STG;
    if (!S2) return;
    var g = S2.G.g, U = S2.G.U, T = clock(), f = flicker(T), st = S2.st;
    g.uniform2f(U.R, S2.cv.width, S2.cv.height); g.uniform2f(U.V, S2.W, S2.H); g.uniform1f(U.T, T % 1000);
    g.uniform2f(U.P, PW[0], PW[1]); g.uniform1f(U.O, st.open); g.uniform1f(U.L, st.lift); g.uniform2f(U.K, 0, 0);
    g.uniform1f(U.LV, st.live); g.uniform1f(U.GR, st.grain); g.uniform1f(U.PJ, st.proj);
    g.uniform3f(U.F, S2.F[0], S2.F[1], S2.F[2]); g.uniform2f(U.SG, st.sag, st.swing); g.uniform4f(U.PF, f[0], f[1], f[2], f[3]);
    for (var i = 0; i < 3; i++) { var p = S2.sp[i]; spStage[i * 4] = p.x || 0; spStage[i * 4 + 1] = p.y || 0; spStage[i * 4 + 2] = p.z || 1; spStage[i * 4 + 3] = p.w || 0; }
    g.uniform4fv(U.SP, spStage);
    g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  }
  function stageHold() { if (STG && !STG.n++) gsap.ticker.add(stageDraw); }
  function stageFree() { if (STG && STG.n > 0 && !--STG.n) { gsap.ticker.remove(stageDraw); stageDraw(); } }
  function stageHide() { if (!STG) return; STG.n = 0; gsap.ticker.remove(stageDraw); STG.sp.forEach(function (p) { p.w = 0; }); if (STG.cv.parentNode) STG.cv.remove(); }
  addEventListener('resize', function () { if (STG && STG.cv.parentNode) { stageShow(STG.cv.style.zIndex); stageDraw(); } });

  /* the passage to the checkout */
  var pass = null, thanking = false;
  function velvet(cls) { var d = doc.createElement('div'); d.className = 'gx-velvet ' + cls; d.setAttribute('aria-hidden', 'true'); return d; }
  function passage(openNative) {
    var X = audio();
    if (X && live()) swish(X, X.c.currentTime + 0.01, DESK ? 0.9 : 0.6, 0.05);
    if (B.rm && !DESK) { openNative(); return; }
    if (!DESK) {
      var P2 = stageShow(10002);
      if (P2) {
        // the curtain comes down over the page, the checkout opens behind it, the curtain flies out
        P2.F = frameEnd(P2.W, P2.H); P2.st.open = 0; P2.st.lift = 1; P2.st.live = 0.5; P2.st.proj = 0;
        stageHold();
        gsap.timeline({ onComplete: function () { stageFree(); stageHide(); } })
          .to(P2.st, { lift: 0, duration: 0.5, ease: 'power2.in' }, 0)
          .call(openNative, null, 0.52)
          .to(P2.st, { lift: 1, duration: 0.7, ease: 'power2.inOut' }, 0.68);
        return;
      }
      var L = doc.createElement('div'); L.className = 'gx-pass gx-pass--phone';
      var a = velvet('gx-pass__half'), b = velvet('gx-pass__half gx-pass__half--r'); L.appendChild(a); L.appendChild(b); doc.body.appendChild(L);
      gsap.timeline({ onComplete: function () { L.remove(); } })
        .fromTo(a, { xPercent: -101 }, { xPercent: 0, duration: 0.45, ease: 'power2.inOut' }, 0)
        .fromTo(b, { xPercent: 101 }, { xPercent: 0, duration: 0.45, ease: 'power2.inOut' }, 0)
        .call(openNative, null, 0.47)
        .to(a, { xPercent: -101, duration: 0.6, ease: 'power2.inOut' }, 0.65)
        .to(b, { xPercent: 101, duration: 0.6, ease: 'power2.inOut' }, 0.65);
      return;
    }
    // desktop: a dark house, then the curtain comes down already drawn into a tableau around the
    // checkout, its opening sized to the box, like a box-office window
    if (pass) pass.remove();
    pass = doc.createElement('div'); pass.className = 'gx-pass gx-pass--desk'; doc.body.appendChild(pass);
    var D = stageShow(10000);
    openNative();
    if (!D) return;
    var half = Math.min(384, innerWidth * 0.45) / (innerWidth / 2);
    D.F = [Math.min(0.9, half + 0.07), 0.5, 0.05];
    D.st.open = 1; D.st.lift = 1; D.st.live = 0.7; D.st.proj = 0; D.st.grain = 1;
    if (B.rm) { D.st.lift = 0; D.st.live = 0; stageDraw(); return; }
    gsap.fromTo(pass, { opacity: 0 }, { opacity: 1, duration: 0.3 });
    stageHold(); stageHold();
    gsap.to(D.st, { lift: 0, duration: 1.15, ease: 'power3.out', onComplete: stageFree });
    gsap.to(D.st, { live: 0, duration: 2.6, ease: 'sine.out', onComplete: stageFree });   // the sway settles, then it holds still
  }
  function passOut() {
    var p = pass;
    pass = null;
    if (p) gsap.to(p, { opacity: 0, duration: thanking ? 0.01 : 0.45, delay: thanking ? 0 : 0.3, onComplete: function () { p.remove(); } });
    if (thanking || !STG || !STG.cv.parentNode || !DESK) return;
    stageHold();
    gsap.to(STG.st, { lift: 1, duration: 0.75, ease: 'power2.in', onComplete: function () { stageFree(); stageHide(); } });
  }

  function modalWatch() {
    var dlg = doc.getElementById('ml-checkout-modal');
    if (!dlg || dlg.gxWatched) return;
    dlg.gxWatched = true;
    var close = doc.createElement('button');
    close.type = 'button'; close.className = 'gx-close'; close.textContent = 'Close';
    close.addEventListener('click', function (e) { e.stopPropagation(); if (window.nblCloseCheckoutModal) window.nblCloseCheckoutModal(); });
    dlg.appendChild(close);
    var was = dlg.classList.contains('modal-open');
    new MutationObserver(function () {
      var now = dlg.classList.contains('modal-open');
      if (was && !now) passOut();
      was = now;
    }).observe(dlg, { attributes: true, attributeFilter: ['class'] });
    addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg.classList.contains('modal-open') && window.nblCloseCheckoutModal) window.nblCloseCheckoutModal(); });
    addEventListener('message', function (e) {
      if (!/(^|\.)mailerlite\.com$/.test((e.origin || '').replace(/^https?:\/\//, ''))) return;
      var d = e.data || {};
      if (d.type === 'checkout_complete') { log('checkout_complete'); gsap.delayedCall(1.2, thanks); }
      if (d.groot && d.groot.checkout_close) passOut();
    });
  }

  /* thanks: the reward for buying. The same curtain closes (on desktop the tableau that framed the
     checkout closes over it), and the opening's projector lights the confirmation on its pleats, with
     the lamp's flicker and the glints. Then the curtain flies out as it did at the start. It opens by
     itself after a few seconds, or sooner on a click, a tap, Escape or Continue. Nobody is held. */
  function thanksCard(S2) {
    var W = S2.W, H = S2.H, por = W < H, cx = W / 2, dpr = Math.min(window.devicePixelRatio || 1, DESK ? 2 : 1.5);
    var cv = doc.createElement('canvas'); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.fillStyle = '#fff'; x.textAlign = 'center';
    var FT = por ? W * 0.118 : Math.min(W * 0.066, H * 0.12), fs = por ? 11 : Math.max(11, Math.min(15, W * 0.0095));
    x.font = '300 ' + FT + 'px tt-modernoir, "Lexend Peta", sans-serif';
    var lines = x.measureText('YOUR PLACE IS CONFIRMED.').width < W * 0.84 ? ['YOUR PLACE IS CONFIRMED.'] : ['YOUR PLACE', 'IS CONFIRMED.'];
    var tH = FT * 0.7 * lines.length + FT * 0.3 * (lines.length - 1), total = tH + FT * 0.55 + fs;
    var y0 = H * (por ? 0.44 : 0.46) - total / 2, x0 = W, x1 = 0;
    lines.forEach(function (t, i) { x.fillText(t, cx, y0 + FT * 0.7 + i * FT); var mw = x.measureText(t).width; x0 = Math.min(x0, cx - mw / 2); x1 = Math.max(x1, cx + mw / 2); });
    x.font = '400 ' + fs + 'px "Lexend Peta", sans-serif';
    x.fillText('SEE YOU ON NOVEMBER 19.', cx, y0 + tH + FT * 0.55 + fs * 0.75);
    var hw = Math.max(2, Math.round(W / 4)), hh = Math.max(2, Math.round(H / 4)), hc = doc.createElement('canvas');
    hc.width = hw; hc.height = hh;
    var hx = hc.getContext('2d'); hx.shadowColor = '#fff'; hx.shadowBlur = 7; hx.shadowOffsetX = 10000;
    hx.drawImage(cv, -10000, 0, hw, hh); hx.drawImage(cv, -10000, 0, hw, hh);
    S2.pts = [];
    try {
      var bx = Math.max(0, Math.floor(x0 * dpr)), by = Math.floor(y0 * dpr), bw = Math.max(1, Math.ceil((x1 - x0) * dpr)), bh = Math.max(1, Math.ceil(tH * dpr));
      var im = x.getImageData(bx, by, bw, bh).data, step = Math.max(2, Math.round(3 * dpr));
      for (var j = 0; j < bh; j += step) for (var i = 0; i < bw; i += step) if (im[(j * bw + i) * 4 + 3] > 220) S2.pts.push([(bx + i) / dpr, (by + j) / dpr]);
    } catch (e) { S2.pts = []; }
    S2.size = Math.max(9, FT * 0.16);
    upload(0, cv, S2.G); upload(1, hc, S2.G);
  }
  function thanksGlints(S2) {
    if (!S2.pts.length || S2.st.proj < 0.5) return;
    [0, 1].forEach(function (k) {
      var q = S2.sp[k], pt = S2.pts[(Math.random() * S2.pts.length) | 0];
      q.x = pt[0]; q.y = pt[1]; q.z = S2.size * (0.8 + Math.random() * 0.5); q.w = 0;
      gsap.timeline({ delay: k * 0.14 }).to(q, { w: 1, duration: 0.22, ease: 'power2.out' }).to(q, { w: 0, duration: 0.5, ease: 'power2.in' });
    });
  }
  function thanks() {
    if (doc.querySelector('.gx-thanks') || thanking) return;
    var fromPass = !!pass && DESK && STG && STG.cv.parentNode;
    var S2 = stageShow(10003);
    if (!S2) return thanksCSS();
    thanking = true;
    var T = doc.createElement('div'); T.className = 'gx-thanks gx-thanks--stage'; T.setAttribute('role', 'status');
    T.innerHTML = '<p class="gx-sr">Your place is confirmed. See you on November 19.</p><button type="button" class="gx-thanks__go">Continue</button>';
    doc.body.appendChild(T);
    if (!fromPass) { S2.F = frameEnd(S2.W, S2.H); S2.st.open = 0; S2.st.lift = 1; }
    S2.st.proj = 0; S2.st.live = 0.7; S2.st.grain = 1;
    thanksCard(S2);
    var X = live(); if (X) swish(X, X.c.currentTime + 0.01, 1.0, 0.06);
    stageHold();
    var done = false, glint = null, out = null;
    function reopen() {
      if (done) return; done = true;
      log('thanks-reopen');
      out && out.kill(); glint && glint.kill();
      var Y = live(); if (Y) swish(Y, Y.c.currentTime + 0.25, 1.3, 0.05);
      gsap.to(T.querySelector('.gx-thanks__go'), { opacity: 0, duration: 0.3 });
      gsap.timeline({ onComplete: function () { stageFree(); stageHide(); T.remove(); thanking = false; } })
        .to(S2.st, { proj: 0, duration: B.rm ? 0 : 0.6, ease: 'power1.in' }, 0)
        .to(S2.st, { lift: 1, duration: B.rm ? 0 : 1.5, ease: 'power2.inOut' }, B.rm ? 0 : 0.35);
    }
    var tl = gsap.timeline();
    if (fromPass) tl.to(S2.st, { open: 0, duration: B.rm ? 0 : 1.1, ease: 'power2.inOut' }, 0);
    else tl.to(S2.st, { lift: 0, duration: B.rm ? 0 : 1.0, ease: 'power2.out' }, 0);
    tl.call(function () { if (window.nblCloseCheckoutModal) window.nblCloseCheckoutModal(); passOut(); }, null, B.rm ? 0 : 1.1)
      .to(S2.st, { live: 0.25, duration: 1.2, ease: 'sine.out' }, 1.1);
    if (B.rm) tl.set(S2.st, { proj: 1 }, 0);
    else tl.add(gsap.timeline()   // the lamp catches as it did at the opening, in one breath
      .to(S2.st, { proj: 0.55, duration: 0.08, ease: 'none' })
      .to(S2.st, { proj: 0.1, duration: 0.09, ease: 'none' })
      .to(S2.st, { proj: 0.85, duration: 0.09, ease: 'none' })
      .to(S2.st, { proj: 0.3, duration: 0.1, ease: 'none' })
      .to(S2.st, { proj: 1, duration: 0.24, ease: 'power2.out' }), 1.35);
    tl.call(function () {
      T.querySelector('.gx-thanks__go').focus({ preventScroll: true });
      if (!B.rm) (function loop() { thanksGlints(S2); glint = gsap.delayedCall(1.1 + Math.random() * 0.6, loop); })();
    }, null, B.rm ? 0 : 2.0);
    out = gsap.delayedCall(7.5, reopen);
    T.addEventListener('click', reopen);
    addEventListener('keydown', function k(e) { if (e.key === 'Escape') { reopen(); removeEventListener('keydown', k); } });
  }

  /* thanks: the reward for buying. The curtain closes, the confirmation is projected on it, then it
     opens again by itself, or sooner on a click, a tap or Escape. Nobody is held behind it. */
  function thanksCSS() {
    if (doc.querySelector('.gx-thanks')) return;
    var T = doc.createElement('div'); T.className = 'gx-thanks'; T.setAttribute('role', 'status');
    var a = velvet('gx-thanks__half'), b = velvet('gx-thanks__half gx-thanks__half--r');
    var msg = doc.createElement('div'); msg.className = 'gx-thanks__msg';
    msg.innerHTML = '<p class="gx-thanks__big">Your place is confirmed.</p><p class="gx-thanks__small">See you on November 19.</p><button type="button" class="gx-thanks__go">Continue</button>';
    T.appendChild(a); T.appendChild(b); T.appendChild(msg); doc.body.appendChild(T);
    var X = live(); if (X) swish(X, X.c.currentTime + 0.01, 0.9, 0.06);
    var done = false, out;
    function reopen() {
      if (done) return; done = true; out && out.kill();
      var Y = live(); if (Y) swish(Y, Y.c.currentTime + 0.01, 1.1, 0.05);
      gsap.timeline({ onComplete: function () { T.remove(); } })
        .to(msg, { opacity: 0, duration: 0.3 }, 0)
        .to(a, { xPercent: -101, duration: B.rm ? 0 : 1.1, ease: 'power2.inOut' }, 0.15)
        .to(b, { xPercent: 101, duration: B.rm ? 0 : 1.1, ease: 'power2.inOut' }, 0.15);
    }
    gsap.timeline()
      .fromTo(a, { xPercent: -101 }, { xPercent: 0, duration: B.rm ? 0 : 0.9, ease: 'power2.inOut' }, 0)
      .fromTo(b, { xPercent: 101 }, { xPercent: 0, duration: B.rm ? 0 : 0.9, ease: 'power2.inOut' }, 0)
      .call(function () { if (window.nblCloseCheckoutModal) window.nblCloseCheckoutModal(); passOut(); }, null, 0.9)
      .fromTo(msg, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'none' }, 0.95)
      .call(function () { msg.classList.add('gx-thanks__msg--lit'); msg.querySelector('.gx-thanks__go').focus({ preventScroll: true }); }, null, 1.2);
    out = gsap.delayedCall(6.5, reopen);
    T.addEventListener('click', reopen);
    addEventListener('keydown', function k(e) { if (e.key === 'Escape') { reopen(); removeEventListener('keydown', k); } });
  }
  GX.debug.thanks = thanks;
  GX.debug.stage = function () { return STG ? STG.st : null; };

  /* ------------------------------------------------------------ the next room
     After the hero, the sax goes on as if from the next room (lowpass, a little lower); when the dance
     floor comes into view the door opens. Only the overture passes this door. */
  var ROOM = { hero: true, pista: false };
  function roomApply(now) {
    var X = A;
    if (!X || !X.ov) return;
    var open = ROOM.hero || ROOM.pista, t = X.c.currentTime;
    if (now) { X.ov.frequency.setValueAtTime(open ? 18000 : 750, t); X.ovg.gain.setValueAtTime(open ? 1 : 0.6, t); return; }
    X.ov.frequency.setTargetAtTime(open ? 18000 : 750, t, open ? 0.45 : 0.6);
    X.ovg.gain.setTargetAtTime(open ? 1 : 0.6, t, open ? 0.45 : 0.6);
    log(open ? 'room-open' : 'room-muffled');
  }
  GX.debug.room = function () { return A && A.ov ? { hz: Math.round(A.ov.frequency.value), gain: +A.ovg.gain.value.toFixed(2) } : null; };
  function roomWatch() {
    var hero = doc.getElementById('gx-hero'), pi = doc.getElementById('gx-pista');
    if (!('IntersectionObserver' in window)) return;
    if (hero) new IntersectionObserver(function (en) { ROOM.hero = en[0].intersectionRatio > 0.2; roomApply(); }, { threshold: [0, 0.2, 0.4] }).observe(hero);
    if (pi) new IntersectionObserver(function (en) { ROOM.pista = en[0].intersectionRatio > 0.3; roomApply(); }, { threshold: [0, 0.3, 0.6] }).observe(pi);
  }

  /* ------------------------------------------------------------ scene 4: the dance floor
     A mirror ball in WebGL, tile by tile: each facet is a mirror set a little askew, reflecting the
     room (velvet, footlights, stage lamps), with grout, a darker limb and four-point glints where a
     facet catches a lamp. It turns in a seamless loop (one turn every 40 s). Its reflections are
     computed, not scattered: each facet sends the key lamp onto the wall behind, so the little squares
     of light sweep the room together, with the ball. Around the words, an Art Deco crown: stepped
     arches in champagne line, lit from the feet to the crown by running heads of light that leave the
     line lit behind them. #beams adds searchlights crossing behind it (a variant under test). */
  var BALL_FRAG = [
    'precision highp float;',
    'uniform vec2 R;uniform float S;uniform float RB;uniform float ROT;uniform float K;uniform float NL;uniform vec4 FL[5];uniform vec3 LA;uniform float BR;',
    'const vec3 OX=vec3(100.,13.,22.)/255.;const vec3 SH=vec3(42.,12.,16.)/255.;const vec3 CH=vec3(211.,182.,156.)/255.;const vec3 FO=vec3(245.,231.,179.)/255.;',
    'float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'vec3 env(vec3 d){',
    ' float up=d.y,az=atan(d.x,d.z);',
    ' vec3 c=mix(OX*1.5,SH*.9,smoothstep(-.25,.75,up));',           // the room: oxblood walls lit warm, the ceiling in shadow
    ' c*=.62+.38*(.5+.5*sin(az*38.));',                             // velvet pleats round the room
    ' c+=CH*.85*exp(-pow((up+.16)/.05,2.))*(.6+.4*sin(az*9.));',     // the footlights, a warm band below the horizon
    ' c+=CH*.35*exp(-pow((up-.42)/.08,2.))*(.5+.5*sin(az*5.+1.));',  // the crown's lit lines, above
    ' vec3 L1=LA,L2=normalize(vec3(.62,.28,.73)),L3=normalize(vec3(.05,.65,.75));',
    ' c+=FO*(pow(max(dot(d,L1),0.),300.)*3.4+pow(max(dot(d,L2),0.),360.)*2.8+pow(max(dot(d,L3),0.),600.)*2.2)+CH*(pow(max(dot(d,L1),0.),30.)*.45+pow(max(dot(d,L2),0.),30.)*.3);',
    ' for(int k=0;k<6;k++){float a=float(k)*1.047+.4;vec3 Lk=normalize(vec3(sin(a)*.9,-.05+.25*cos(a*2.),cos(a)*.9));c+=FO*pow(max(dot(d,Lk),0.),900.)*1.6;}',
    ' return c;}',
    'void main(){',
    ' vec2 pc=(gl_FragCoord.xy/R-.5)*S;vec2 d=pc/RB;float q=dot(d,d);vec4 col=vec4(0.);',
    ' if(q<1.){',
    '  vec3 n=vec3(d,sqrt(1.-q));float cr=cos(ROT),sr=sin(ROT);',
    '  vec3 o=vec3(cr*n.x-sr*n.z,n.y,sr*n.x+cr*n.z);',
    '  float lat=asin(clamp(o.y,-1.,1.)),lon=atan(o.x,o.z);',
    '  float fi=(lat+1.5707963)/3.1415927*NL,i=floor(fi),latc=(i+.5)/NL*3.1415927-1.5707963;',
    '  float NO=max(6.,floor(2.*NL*cos(latc)+.5)),fj=(lon/6.2831853+.5)*NO,j=floor(fj),lonc=((j+.5)/NO-.5)*6.2831853;',
    '  vec3 tn=vec3(cos(latc)*sin(lonc),sin(latc),cos(latc)*cos(lonc));',
    '  tn=normalize(tn+(vec3(h21(vec2(i,j)),h21(vec2(j,i+7.)),h21(vec2(i+3.,j+5.)))-.5)*.1);',
    '  vec3 vn=vec3(cr*tn.x+sr*tn.z,tn.y,-sr*tn.x+cr*tn.z);',
    '  vec3 c=env(reflect(vec3(0.,0.,-1.),vn))*(.8+.4*h21(vec2(i*1.7,j*3.1)));',
    '  vec2 f=vec2(fract(fi),fract(fj));vec2 g=min(f,1.-f);',
    '  float gx=g.y*(6.2831853*cos(latc)/NO)/(3.1415927/NL);',     // the grout, the same width both ways
    '  float gm=smoothstep(.035,.11,min(g.x,gx));',
    '  c=mix(SH*.3,c,gm);',
    '  c*=(.45+.55*smoothstep(0.,.55,n.z))*BR;',                          // the limb falls into shadow
    '  float a=1.-smoothstep(1.-1.6/RB,1.,sqrt(q));',
    '  col=vec4(c*a,a);}',
    ' for(int k=0;k<5;k++){vec4 F=FL[k];if(F.w>0.){vec2 e=pc-F.xy;float z=F.z;',
    '  float st=exp(-pow(e.y/(z*.05),2.))*max(0.,1.-abs(e.x)/z)+exp(-pow(e.x/(z*.05),2.))*max(0.,1.-abs(e.y)/z);',
    '  st=st*.9+exp(-dot(e,e)/(z*z*.012));col.rgb+=FO*st*F.w;col.a=max(col.a,clamp(st*F.w,0.,1.));}}',
    ' gl_FragColor=vec4(col.rgb*K,col.a*K);}'
  ].join('\n');
  function h21(x, y) { var v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); }
  function logoSVG(key, cls) {
    var L = LOGO && LOGO[key];
    if (!L) return '';
    return '<svg class="' + cls + '" viewBox="0 0 ' + L.w + ' ' + L.h + '" aria-hidden="true" focusable="false">' + L.d.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>';
  }
  function pista() {
    var sec = doc.getElementById('gx-pista');
    if (!sec) return;
    var sig = sec.querySelector('.gx-pista__sig');
    if (sig && LOGO && LOGO.galleria && LOGO.beau) {
      sig.setAttribute('aria-label', 'Galleria × Beau Monde Builders');
      sig.innerHTML = logoSVG('galleria', 'gx-sig__g') + '<span class="gx-sig__x" aria-hidden="true">×</span>' + logoSVG('beau', 'gx-sig__b');
    }
    var stage = sec.querySelector('.gx-pista__stage'), fx = doc.createElement('canvas'), bc = doc.createElement('canvas');
    fx.className = 'gx-pista__fx'; bc.className = 'gx-pista__ball'; fx.setAttribute('aria-hidden', 'true'); bc.setAttribute('aria-hidden', 'true');
    sec.insertBefore(bc, sec.firstChild); sec.insertBefore(fx, sec.firstChild);
    var x = fx.getContext('2d');
    if (!x || !stage) return;
    var PI = Math.PI, NL = DESK ? 22 : 16, LK = [-0.55, 0.45, 0.7];
    var P = { W: 0, H: 0, dpr: 1, cx: 0, by: 0, rb: 0, S: 0, rings: [], lit: 0, k: 0, on: false, seen: false, rot: 0.6, spin: 0, T: null, sy: scrollY, ig: 0, flash: 0, ray: 0, ignited: false, ttop: 0, hw0: 0 };
    (function () { var l = Math.sqrt(LK[0] * LK[0] + LK[1] * LK[1] + LK[2] * LK[2]); LK = LK.map(function (v) { return v / l; }); })();
    // the ball's own WebGL canvas
    var G = null;
    try {
      var g = bc.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
      if (g) {
        var sh = function (t, src) { var o = g.createShader(t); g.shaderSource(o, src); g.compileShader(o); if (!g.getShaderParameter(o, g.COMPILE_STATUS)) { GX.debug.ballError = g.getShaderInfoLog(o); return null; } return o; };
        var vs = sh(g.VERTEX_SHADER, VERT), fs = sh(g.FRAGMENT_SHADER, BALL_FRAG);
        if (vs && fs) {
          var pr = g.createProgram(); g.attachShader(pr, vs); g.attachShader(pr, fs); g.linkProgram(pr); g.useProgram(pr);
          g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer()); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
          var ap = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(ap); g.vertexAttribPointer(ap, 2, g.FLOAT, false, 0, 0);
          var U = {}; ['R', 'S', 'RB', 'ROT', 'K', 'NL', 'LA', 'BR'].forEach(function (n) { U[n] = g.getUniformLocation(pr, n); }); U.FL = g.getUniformLocation(pr, 'FL[0]');
          G = { g: g, U: U, fl: new Float32Array(20) };
        }
      }
    } catch (e) { G = null; }
    // the crown: stepped arches, each side a path from the foot to the crown
    function layout() {
      var r = sec.getBoundingClientRect(), s = stage.getBoundingClientRect();
      P.W = r.width; P.H = r.height; P.dpr = Math.min(window.devicePixelRatio || 1, DESK ? 2 : 1.5);
      fx.width = Math.round(P.W * P.dpr); fx.height = Math.round(P.H * P.dpr);
      P.cx = s.left - r.left + s.width / 2; P.rb = DESK ? 74 : 46;
      var top = s.top - r.top, pad = DESK ? 64 : 24;
      P.by = Math.max(P.rb + (DESK ? 70 : 40), top - (DESK ? 120 : 96));
      P.S = Math.round(P.rb * 4.2);
      bc.style.left = (P.cx - P.S / 2) + 'px'; bc.style.top = (P.by - P.S / 2) + 'px'; bc.style.width = bc.style.height = P.S + 'px';
      bc.width = bc.height = Math.round(P.S * P.dpr);
      if (G) G.g.viewport(0, 0, bc.width, bc.height);
      var n = DESK ? 3 : 2, gap = DESK ? 16 : 11, st = DESK ? 30 : 18, sh2 = DESK ? 34 : 22;
      var hw0 = Math.min(P.W * (DESK ? 0.36 : 0.43), s.width / 2 + pad), bot = s.bottom - r.top + pad;
      P.hw0 = hw0; P.ttop = top;
      P.rings = [];
      for (var k = 0; k < n; k++) {
        var hw = hw0 + k * gap, yt = P.by + P.rb * 0.25 - k * gap, y1 = yt + sh2 * 2.2, y2 = yt + sh2;
        [-1, 1].forEach(function (sd) {
          var X = function (dx) { return P.cx + sd * dx; };
          var pts = [[X(hw), bot], [X(hw), y1], [X(hw - st), y1], [X(hw - st), y2], [X(hw - 2 * st), y2], [X(hw - 2 * st), yt], [P.cx, yt]];
          var L = [0];
          for (var m = 1; m < pts.length; m++) L.push(L[m - 1] + Math.hypot(pts[m][0] - pts[m - 1][0], pts[m][1] - pts[m - 1][1]));
          P.rings.push({ pts: pts, L: L, len: L[L.length - 1], k: k, d: k * 0.22 });
        });
      }
    }
    function pathTo(rg, len) {   // stroke a ring from its foot up to length len
      var p = rg.pts; x.beginPath(); x.moveTo(p[0][0], p[0][1]);
      for (var m = 1; m < p.length; m++) {
        if (rg.L[m] <= len) { x.lineTo(p[m][0], p[m][1]); continue; }
        var f = (len - rg.L[m - 1]) / (rg.L[m] - rg.L[m - 1]); x.lineTo(p[m - 1][0] + (p[m][0] - p[m - 1][0]) * f, p[m - 1][1] + (p[m][1] - p[m - 1][1]) * f); break;
      }
    }
    function at(rg, len) {
      for (var m = 1; m < rg.pts.length; m++) if (rg.L[m] >= len) { var f = (len - rg.L[m - 1]) / (rg.L[m] - rg.L[m - 1]); return [rg.pts[m - 1][0] + (rg.pts[m][0] - rg.pts[m - 1][0]) * f, rg.pts[m - 1][1] + (rg.pts[m][1] - rg.pts[m - 1][1]) * f]; }
      return rg.pts[rg.pts.length - 1];
    }
    var HEAD = (function () { var c = doc.createElement('canvas'); c.width = c.height = 48; var q = c.getContext('2d'), gr = q.createRadialGradient(24, 24, 0, 24, 24, 24); gr.addColorStop(0, 'rgba(255,251,236,1)'); gr.addColorStop(0.18, 'rgba(250,238,200,.9)'); gr.addColorStop(0.5, 'rgba(245,231,179,.2)'); gr.addColorStop(1, 'rgba(245,231,179,0)'); q.fillStyle = gr; q.fillRect(0, 0, 48, 48); return c; })();
    // the key lamp, reflected by each facet onto the wall behind
    function shards(rot, k) {
      if (P.ig <= 0) return;
      // each facet throws a small patch of the key lamp onto the wall behind: sharp-edged, aligned with
      // the facet grid, stretched sideways where the light rakes the wall, brighter where the facet faces the lamp
      var cr = Math.cos(rot), sr = Math.sin(rot), D = P.H * 0.62, step = DESK ? 1 : 2, d = P.dpr;
      x.globalCompositeOperation = 'lighter';
      for (var i = 0; i < NL; i++) {
        var latc = (i + 0.5) / NL * PI - PI / 2, NO = Math.max(6, Math.floor(2 * NL * Math.cos(latc) + 0.5)), cl = Math.cos(latc);
        for (var j = 0; j < NO; j += step) {
          var lonc = ((j + 0.5) / NO - 0.5) * PI * 2;
          var tx = cl * Math.sin(lonc) + (h21(i, j) - 0.5) * 0.1, ty = Math.sin(latc) + (h21(j, i + 7) - 0.5) * 0.1, tz = cl * Math.cos(lonc) + (h21(i + 3, j + 5) - 0.5) * 0.1;
          var nl = Math.sqrt(tx * tx + ty * ty + tz * tz); tx /= nl; ty /= nl; tz /= nl;
          var vx = cr * tx + sr * tz, vy = ty, vz = -sr * tx + cr * tz, dl = vx * LK[0] + vy * LK[1] + vz * LK[2];
          if (dl <= 0.05) continue;
          var rx = 2 * dl * vx - LK[0], ry = 2 * dl * vy - LK[1], rz = 2 * dl * vz - LK[2];
          if (rz > -0.1) continue;
          var t = D / -rz, px = P.cx + rx * t, py = P.by - ry * t;
          if (px < -20 || px > P.W + 20 || py < -20 || py > P.H + 20) continue;
          if ((px - P.cx) * (px - P.cx) + (py - P.by) * (py - P.by) < P.rb * P.rb * 1.5) continue;
          var band = Math.exp(-Math.pow((py - P.by - P.H * 0.12) / (P.H * 0.42), 2));
          if (band < 0.06) continue;
          var h = Math.max(3, Math.min(DESK ? 8 : 6, (PI / NL) * t * 0.045 + 2.4)), w = h * Math.min(2.4, 1 / Math.sqrt(Math.max(0.18, -rz)));
          var a = k * P.ig * band * (0.3 + 0.55 * dl) * Math.min(1, 1.6 / (0.4 + t / D));
          // snapped to device pixels so the edges stay crisp; a one-pixel feather softens them
          var X0 = Math.round((px - w / 2) * d) / d, Y0 = Math.round((py - h / 2) * d) / d, Wd = Math.round(w * d) / d, Hd = Math.round(h * d) / d;
          x.globalAlpha = a * 0.3; x.fillStyle = '#E9D3B4'; x.fillRect(X0 - 1 / d, Y0 - 1 / d, Wd + 2 / d, Hd + 2 / d);
          x.globalAlpha = a; x.fillStyle = '#FFF4DA'; x.fillRect(X0, Y0, Wd, Hd);
        }
      }
    }
    function bloom() {   // the ball comes on: a warm halo breathes once behind it, in the room's canvas, never clipped
      if (P.flash <= 0.01) return;
      var R = P.rb * 3.4, g = x.createRadialGradient(P.cx, P.by, P.rb * 0.6, P.cx, P.by, R);
      g.addColorStop(0, 'rgba(245,231,179,' + (0.32 * P.flash).toFixed(3) + ')'); g.addColorStop(0.45, 'rgba(211,182,156,' + (0.1 * P.flash).toFixed(3) + ')'); g.addColorStop(1, 'rgba(211,182,156,0)');
      x.globalCompositeOperation = 'lighter'; x.globalAlpha = 1; x.fillStyle = g; x.beginPath(); x.arc(P.cx, P.by, R, 0, PI * 2); x.fill();
    }
    function flares(rot) {
      if (!G) return;
      var cr = Math.cos(rot), sr = Math.sin(rot), best = [], L1 = LK.slice(), L2 = [0.62, 0.28, 0.73];
      [L1, L2].forEach(function (L) { var l = Math.sqrt(L[0] * L[0] + L[1] * L[1] + L[2] * L[2]); L[0] /= l; L[1] /= l; L[2] /= l; });
      for (var i = 0; i < NL; i++) {
        var latc = (i + 0.5) / NL * PI - PI / 2, NO = Math.max(6, Math.floor(2 * NL * Math.cos(latc) + 0.5)), cl = Math.cos(latc);
        for (var j = 0; j < NO; j++) {
          var lonc = ((j + 0.5) / NO - 0.5) * PI * 2, cx0 = cl * Math.sin(lonc), cz0 = cl * Math.cos(lonc);
          var pz = -sr * cx0 + cr * cz0;
          if (pz < 0.15) continue;
          var tx = cx0 + (h21(i, j) - 0.5) * 0.1, ty = Math.sin(latc) + (h21(j, i + 7) - 0.5) * 0.1, tz = cz0 + (h21(i + 3, j + 5) - 0.5) * 0.1;
          var nl = Math.sqrt(tx * tx + ty * ty + tz * tz); tx /= nl; ty /= nl; tz /= nl;
          var vx = cr * tx + sr * tz, vy = ty, vz = -sr * tx + cr * tz, rx = 2 * vz * vx, ry = 2 * vz * vy, rz = 2 * vz * vz - 1;
          var I = Math.pow(Math.max(0, rx * L1[0] + ry * L1[1] + rz * L1[2]), 300) * 3.4 + Math.pow(Math.max(0, rx * L2[0] + ry * L2[1] + rz * L2[2]), 360) * 2.8;
          if (I > 0.35) best.push([(cr * cx0 + sr * cz0) * P.rb, Math.sin(latc) * P.rb, I]);
        }
      }
      best.sort(function (a, b) { return b[2] - a[2]; });
      for (var m = 0; m < 5; m++) { var b = best[m]; G.fl[m * 4] = b ? b[0] : 0; G.fl[m * 4 + 1] = b ? b[1] : 0; G.fl[m * 4 + 2] = b ? Math.min(P.rb * (0.6 + 0.4 * Math.min(1, b[2])), P.S / 2 - 2 - Math.max(Math.abs(b[0]), Math.abs(b[1]))) : 1; G.fl[m * 4 + 3] = b ? Math.min(1, b[2]) * 0.9 : 0; }
    }
    function rays() {   // the fan lit at the ignition, from the ball to the sides, clear of the words
      if (P.ray <= 0) return;
      x.globalCompositeOperation = 'lighter'; x.strokeStyle = '#F5E7B3';
      for (var sd = -1; sd <= 1; sd += 2) for (var m = 0; m < 7; m++) {
        var a = (10 + m * 5.5) * PI / 180, ca = Math.cos(a), sa = Math.sin(a), r0 = P.rb * 1.25;
        var lim = Math.min(P.hw0 * 0.92 / ca, (P.ttop - 14 - P.by) / sa), len = r0 + (lim - r0) * P.ray;
        if (lim <= r0) continue;
        x.globalAlpha = 0.07; x.lineWidth = 5; x.beginPath(); x.moveTo(P.cx + sd * ca * r0, P.by + sa * r0); x.lineTo(P.cx + sd * ca * len, P.by + sa * len); x.stroke();
        x.globalAlpha = 0.42 - m * 0.03; x.lineWidth = 1; x.stroke();
      }
    }
    function crown(T) {
      var lw = DESK ? 1.2 : 1;
      P.rings.forEach(function (rg) {
        var prog = Math.max(0, Math.min(1, (P.lit - rg.d) / 0.78)), len = rg.len * prog;
        if (len <= 0) return;
        x.globalCompositeOperation = 'lighter'; x.lineJoin = 'miter';
        x.globalAlpha = 0.09; x.lineWidth = lw * 7; x.strokeStyle = '#F5E7B3'; pathTo(rg, len); x.stroke();
        x.globalAlpha = 0.75 - 0.18 * rg.k; x.lineWidth = lw; x.strokeStyle = '#E9D3B4'; pathTo(rg, len); x.stroke();
        if (prog < 1) {   // the running head, its trail brighter than the lit line behind it
          for (var m = 0; m < 6; m++) { var tl = Math.max(0, len - m * 9); var hp = at(rg, tl); x.globalAlpha = 0.5 * (1 - m / 6); x.drawImage(HEAD, hp[0] - 9, hp[1] - 9, 18, 18); }
          var h = at(rg, len); x.globalAlpha = 1; x.drawImage(HEAD, h[0] - 16, h[1] - 16, 32, 32);
        } else if (!B.rm) {   // now and then a pulse runs up the lit line
          var per = 9, ph = ((T + rg.k * 0.7 + (rg.pts[0][0] < P.cx ? 0 : 0.35)) % per) / 2.2;
          if (ph < 1) { var hp2 = at(rg, rg.len * ph); x.globalAlpha = 0.55 * Math.sin(PI * ph); x.drawImage(HEAD, hp2[0] - 12, hp2[1] - 12, 24, 24); }
        }
      });
    }
    function draw() {
      var T = B.rm ? 0 : clock(), dt = P.T == null ? 0 : clamp(T - P.T, 0, 0.05);
      P.T = T;
      if (dt > 0) {
        if (!DESK) { var vy = (scrollY - P.sy) / dt; P.spin = Math.min(3, Math.max(P.spin, Math.abs(vy) * 0.0016)); }
        P.sy = scrollY;
        P.rot = (P.rot + (PI * 2 / 40 + P.spin) * dt) % (PI * 2);   // accumulated: the turn never jumps
        P.spin *= Math.exp(-dt * 0.9);
      }
      var rot = P.rot;
      x.setTransform(P.dpr, 0, 0, P.dpr, 0, 0); x.clearRect(0, 0, P.W, P.H);
      shards(rot, P.k);
      bloom();
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 0.55 * P.k; x.strokeStyle = '#D3B69C'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(P.cx, 0); x.lineTo(P.cx, P.by - P.rb); x.stroke();
      crown(T);
      rays();
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      if (G) {
        flares(rot);
        var g2 = G.g, U2 = G.U;
        g2.uniform2f(U2.R, bc.width, bc.height); g2.uniform1f(U2.S, P.S); g2.uniform1f(U2.RB, P.rb); g2.uniform1f(U2.ROT, rot); g2.uniform1f(U2.K, P.k); g2.uniform1f(U2.NL, NL); g2.uniform3f(U2.LA, LK[0], LK[1], LK[2]); g2.uniform1f(U2.BR, 0.42 + 0.58 * P.ig);
        g2.uniform4fv(U2.FL, G.fl); g2.clearColor(0, 0, 0, 0); g2.clear(g2.COLOR_BUFFER_BIT); g2.drawArrays(g2.TRIANGLE_STRIP, 0, 4);
      }
    }
    var line = sec.querySelector('.gx-pista__line');
    // the climax: the lines meet at the ball, it flares, its light bursts into the room, the fan lights, the words catch it
    function ignite() {
      P.ignited = true; log('pista-ignite');
      gsap.timeline().to(P, { flash: 1, duration: 0.35, ease: 'sine.out' }).to(P, { flash: 0, duration: 1.8, ease: 'sine.inOut' });
      gsap.to(P, { ig: 1, duration: 1.6, ease: 'sine.inOut' });
      gsap.to(P, { ray: 1, duration: 0.9, ease: 'power2.out', delay: 0.08 });
      P.spin = 1.4;
      if (line) line.classList.add('gx-lit');
    }
    // a click or a tap on the ball gives it a turn; the light always answers the ball, never the pointer
    sec.addEventListener('pointerdown', function (e) {
      var r = sec.getBoundingClientRect(), dx = e.clientX - r.left - P.cx, dy = e.clientY - r.top - P.by;
      if (dx * dx + dy * dy < P.rb * P.rb * 1.4) { P.spin = Math.min(4, P.spin + 2.4); log('pista-spin'); }
    });
    layout();
    function run(on) { if (on === P.on) return; P.on = on; if (on && !B.rm) gsap.ticker.add(draw); else gsap.ticker.remove(draw); draw(); }
    new IntersectionObserver(function (en) {
      var e = en[0];
      run(e.isIntersecting);
      if (e.intersectionRatio >= 0.3 && !P.seen) {
        P.seen = true; log('pista');
        if (B.rm) { P.lit = 2; P.k = 1; P.ig = 1; P.ray = 1; P.ignited = true; line.classList.add('gx-lit'); draw(); return; }
        gsap.to(P, { lit: 1.5, duration: 3.2, ease: 'power1.inOut', onUpdate: function () { if (!P.ignited && P.lit >= 0.8) ignite(); } });
        gsap.to(P, { k: 1, duration: 1.2, ease: 'sine.out', delay: 0.6 });
      }
    }, { threshold: [0, 0.3] }).observe(sec);
    addEventListener('resize', function () { layout(); draw(); });
    GX.debug.pista = P; GX.debug.ignite = ignite;
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

  var readyFn, readyP = new Promise(function (ok) { readyFn = ok; });
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
    readyFn();
  }, function (e) { GX.debug.error = String(e && e.message || e); });

  Promise.all([art, domReady, libs.catch(function () {})]).then(function () { heroArt(); carnet(); });
  // the box office is built only once the engine stylesheet is confirmed; otherwise the native block sells on its own
  Promise.all([art, domReady, readyP]).then(function () { boxOffice(); pista(); roomWatch(); });
})();
