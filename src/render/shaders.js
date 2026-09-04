/* GLSL for the whole pipeline.

   The scene renders into an HDR target with physically-based shading, then a
   bloom chain and a tonemap/FXAA resolve bring it to the canvas. Nothing here
   samples an image texture: every surface is a procedural material selected by
   the per-vertex material id, so the game ships with no texture assets at all
   and still gets carpet fibre, wood grain, brushed metal and fabric weave.

   The realism upgrade over the Blinn-Phong original is four things:
     1. Cook-Torrance GGX with a metallic/roughness parameter set per material.
     2. Real HDR — lights and screens can exceed 1.0 and bleed into bloom.
     3. Surface-gradient bump mapping derived from each material's own height
        function, so relief comes from the same noise that colours the surface.
     4. A cheap analytic sky used for both diffuse irradiance and roughness-
        dependent specular, which is what stops everything looking like plastic
        lit by a single lamp. */

export const NB = 24;    // max bones per draw; bone 0 doubles as the model matrix

export const VS_COMMON = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
layout(location=3) in float aAO;
layout(location=4) in float aFlag;
layout(location=5) in float aBone;
layout(location=6) in vec3 aMatUV;
uniform mat4 uVP, uLightVP;
uniform mat4 uBones[${NB}];
out vec3 vN; out vec3 vC; out float vAO; out float vFlag; out vec3 vW; out vec4 vLS; out float vD;
flat out float vMat; out vec2 vUV;
void main(){
  mat4 M = uBones[int(aBone)];
  vec4 w = M * vec4(aPos,1.0);
  vec3 n = normalize(mat3(M) * aNrm);
  vW = w.xyz; vN = n; vAO = aAO; vFlag = aFlag;
  vMat = aMatUV.x; vUV = aMatUV.yz;
  vC = pow(max(aCol,0.0), vec3(2.2));            // sRGB bytes -> linear
  vLS = uLightVP * vec4(w.xyz + n*0.055, 1.0);   // normal offset kills most acne
  gl_Position = uVP * w;
  vD = gl_Position.w;
}`;

/* Geometry cuts, shared by the colour and depth passes so a hidden wall also
   stops casting its shadow.
     - uCut     dissolves walls standing between the camera and the focus point
     - uFloorY  hides everything above the floor being inspected             */
const CUT_FN = `
uniform vec2 uEyeXZ, uTgtXZ;
uniform float uCut, uFloorY;

float dither4(){
  const float B[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
  ivec2 p = ivec2(gl_FragCoord.xy) & 3;
  return (B[p.y*4+p.x] + 0.5) / 16.0;
}

bool cutAway(vec3 w, float flag){
  // Flag 4 is site geometry — ground, neighbouring blocks, the parapet. It is
  // outside the building, so neither cut may touch it or the sky shows through.
  if(flag > 3.5) return false;
  // Floors above the one under inspection are removed. The ramp is deliberately
  // narrow: a ceiling slab sits only ~0.6 units above the wall tops, so a wide
  // ramp leaves most of the ceiling standing and it fills the whole frame.
  if(uFloorY < 900.0){
    float t = smoothstep(uFloorY, uFloorY + 0.7, w.y);
    if(t > dither4()) return true;
  }
  bool cuttable = (flag > 0.5 && flag < 2.5);
  if(uCut < 0.5 || !cuttable) return false;
  vec2 v = uEyeXZ - uTgtXZ;
  float L = length(v); if(L < 0.001) return false;
  float side = dot(w.xz - uTgtXZ, v / L);
  float t = smoothstep(0.0, 1.1, side) * smoothstep(3.4, 3.8, w.y - uFloorBase(w.y));
  return t > dither4();
}`;

/* Storey height is fixed, so "height above this floor's slab" is a modulo.
   Declared before CUT_FN uses it. */
const FLOOR_FN = `
uniform float uStorey;
float uFloorBase(float y){ return floor(max(y,0.0)/uStorey)*uStorey; }`;

/* ---- procedural material library ----
   Each material returns a height field used for both bump relief and albedo
   modulation, plus a (roughness, metallic, emissive) parameter triple. */
const NOISE = `
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn2(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y);
}
float fbm2(vec2 p){ return vn2(p)*0.55 + vn2(p*2.1+7.3)*0.28 + vn2(p*4.3+3.1)*0.17; }
float vn3(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float n=dot(i,vec3(1.0,57.0,113.0));
  float a=fract(sin(n)*43758.5453),      b=fract(sin(n+1.0)*43758.5453),
        c=fract(sin(n+57.0)*43758.5453), d=fract(sin(n+58.0)*43758.5453),
        e=fract(sin(n+113.0)*43758.5453),g=fract(sin(n+114.0)*43758.5453),
        h=fract(sin(n+170.0)*43758.5453),k=fract(sin(n+171.0)*43758.5453);
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y), mix(mix(e,g,f.x),mix(h,k,f.x),f.y), f.z);
}`;

/* A live desktop for every monitor in the building, seeded per screen. Screens
   are emissive, so these also drive the bloom that sells a dim office. */
const SCREEN_UI = `
vec3 screenUI(vec2 uv, float seed, float time){
  float kind = floor(seed*3.0);
  vec3 col = vec3(0.86,0.88,0.91);
  if(uv.y > 0.93){                                   // title bar
    col = vec3(0.13,0.26,0.47);
    if(uv.x < 0.05) col = vec3(0.80,0.31,0.25);
    return col;
  }
  if(kind < 0.5){                                    // a task board
    float lane = floor(uv.x*3.0);
    col = mix(vec3(0.90,0.91,0.93), vec3(0.83,0.86,0.90), mod(lane,2.0));
    float card = step(0.12, fract(uv.y*7.0)) * step(0.08, fract(uv.x*3.0)) * step(fract(uv.x*3.0), 0.92);
    vec3 tint = vec3(0.35,0.62,0.85);
    if(lane > 1.5) tint = vec3(0.42,0.76,0.50);
    else if(lane > 0.5) tint = vec3(0.94,0.76,0.36);
    col = mix(col, tint, card*0.85);
  } else if(kind < 1.5){                             // code
    float row = floor(uv.y*22.0);
    float w = h21(vec2(row, seed*31.0));
    col = vec3(0.10,0.11,0.14);
    float ind = 0.04 + 0.06*step(0.5, h21(vec2(row,7.0)));
    if(uv.x > ind && uv.x < ind + 0.25 + w*0.5){
      col = mix(vec3(0.55,0.78,0.98), vec3(0.96,0.72,0.42), step(0.6, w));
    }
    // a caret that actually blinks
    if(row == floor(mod(time*0.7, 22.0)) && abs(uv.x - (ind+0.02)) < 0.006) col = vec3(1.0);
  } else {                                           // a users-over-time chart
    col = vec3(0.96,0.96,0.97);
    float bar = fract(uv.x*11.0);
    float hgt = 0.12 + 0.72*fbm2(vec2(floor(uv.x*11.0)*0.7 + seed*13.0, 0.5));
    if(bar > 0.18 && bar < 0.82 && uv.y < hgt) col = vec3(0.31,0.56,0.86);
    if(uv.y < 0.03) col = vec3(0.55,0.57,0.60);
  }
  return col;
}`;

/* ---- shadowing: 12-tap Poisson, per-pixel rotated so banding becomes noise ----
   Shared by the procedural scene shader and the skinned-monster one, so a
   monster's contact shadow is filtered exactly like the office's. Both read
   `vLS`, so whoever includes this must declare it. */
const SHADOW_FN = `
const vec2 POISSON[12] = vec2[12](
  vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2( 0.962,-0.195), vec2( 0.473,-0.480), vec2( 0.519, 0.767), vec2( 0.185,-0.893),
  vec2( 0.507, 0.064), vec2( 0.896, 0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));

float igNoise(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056,0.00583715)))); }

float shadowFactor(vec3 n){
  vec3 p = vLS.xyz / vLS.w;
  if(any(greaterThan(abs(p), vec3(1.0)))) return 1.0;
  p = p*0.5 + 0.5;
  // Slope-scaled bias: grazing surfaces need a deeper offset than facing ones.
  float ndl = max(dot(n, -uSun), 0.0);
  float bias = 0.0006 + 0.0022*(1.0 - ndl);
  float ang = igNoise(gl_FragCoord.xy) * 6.2831853;
  float ca = cos(ang), sa = sin(ang);
  mat2 rot = mat2(ca, -sa, sa, ca);
  float s = 0.0;
  for(int i=0;i<12;i++){
    vec2 o = rot * POISSON[i] * 1.35;
    s += texture(uShadow, vec3(p.xy + o*uSTexel, p.z - bias));
  }
  return s / 12.0;
}`;

/* ---- the BRDF and the analytic sky, shared by every lit shader ---- */
const PBR_FN = `
/* ---- surface-gradient bump: perturb N from a scalar height without tangents ---- */
vec3 bumpNormal(vec3 N, vec3 P, float h, float scale){
  vec3 dpdx = dFdx(P), dpdy = dFdy(P);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  if(abs(det) < 1e-8) return N;
  vec3 grad = sign(det) * (dhdx*r1 + dhdy*r2);
  return normalize(abs(det)*N - scale*grad);
}

/* ---- GGX ---- */
float D_GGX(float ndh, float a){
  float a2 = a*a;
  float d = ndh*ndh*(a2-1.0)+1.0;
  return a2 / max(3.14159265*d*d, 1e-7);
}
float V_SmithGGX(float ndv, float ndl, float a){
  float a2 = a*a;
  float gv = ndl * sqrt(ndv*ndv*(1.0-a2)+a2);
  float gl = ndv * sqrt(ndl*ndl*(1.0-a2)+a2);
  return 0.5 / max(gv+gl, 1e-6);
}
vec3 F_Schlick(vec3 f0, float u){ return f0 + (1.0-f0)*pow(1.0-u, 5.0); }

/* Karis' analytic env-BRDF: good enough to skip the usual LUT texture. */
vec3 envBRDF(vec3 f0, float rough, float ndv){
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4( 1.0,  0.0425,  1.04, -0.04);
  vec4 r = rough*c0 + c1;
  float a004 = min(r.x*r.x, exp2(-9.28*ndv))*r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04)*a004 + r.zw;
  return f0*ab.x + ab.y;
}

/* Analytic sky: a horizon band between ground and zenith plus a sun disc.
   Used for diffuse irradiance and, blurred by roughness, for reflections. */
vec3 skyColor(vec3 d, float rough){
  float t = clamp(d.y*0.5+0.5, 0.0, 1.0);
  float horiz = pow(1.0 - abs(d.y), 4.0);
  vec3 c = mix(uGndCol, uSkyCol, smoothstep(0.35, 0.72, t));
  c = mix(c, uHorizCol, horiz*0.7);
  float sd = max(dot(d, -uSun), 0.0);
  c += uSunCol * pow(sd, mix(220.0, 4.0, rough)) * mix(2.4, 0.18, rough);
  return c;
}`;

export const FS_SCENE = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vN; in vec3 vC; in float vAO; in float vFlag; in vec3 vW; in vec4 vLS; in float vD;
flat in float vMat; in vec2 vUV;

uniform vec3 uSun, uSunCol, uSkyCol, uGndCol, uHorizCol, uFogCol, uEye;
uniform float uAmb, uFogFar, uHL, uTime, uExposure;
uniform vec2 uRes, uSTexel;
uniform float uGlassMode;
uniform sampler2DShadow uShadow;

${FLOOR_FN}
${CUT_FN}
${NOISE}
${SCREEN_UI}
${SHADOW_FN}
${PBR_FN}

layout(location=0) out vec4 outColor;

struct Surf { vec3 albedo; float rough; float metal; vec3 emis; };

void main(){
  if(cutAway(vW, vFlag)) discard;

  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vW);
  if(!gl_FrontFacing) N = -N;

  int mat = int(vMat + 0.5);
  Surf s;
  s.albedo = vC; s.rough = 0.72; s.metal = 0.0; s.emis = vec3(0.0);
  float wrap = 0.0;          // subsurface-ish light wrap for skin and leaves
  float sheen = 0.0;         // retroreflective rim for cloth
  float height = 0.0, bump = 0.0;

  if(mat == 1){                                    // carpet: looped fibre
    float c = fbm2(vW.xz*26.0) + 0.35*vn2(vW.xz*90.0);
    height = c; bump = 0.055;
    s.albedo *= 0.86 + 0.24*c;
    s.albedo *= 1.0 + (fbm2(vW.xz*0.9)-0.5)*0.08;
    s.rough = 0.97; sheen = 0.12;
  } else if(mat == 2){                             // wood / laminate grain
    float g = fbm2(vec2(vW.x*1.6 + vW.y*3.0, vW.z*26.0 + vW.y*9.0));
    float ring = 0.5 + 0.5*sin((vW.x*2.4 + vW.z*0.7 + g*5.0)*3.0);
    height = g*0.7 + ring*0.3; bump = 0.02;
    s.albedo *= 0.86 + 0.16*g + 0.06*ring;
    s.rough = 0.34 + 0.10*g;
  } else if(mat == 3){                             // painted drywall: orange peel
    float o = vn2(vW.xz*7.0 + vW.y*9.0);
    height = o; bump = 0.006;
    s.albedo *= 1.0 + (o-0.5)*0.05;
    s.rough = 0.90;
  } else if(mat == 4){                             // brushed metal, anisotropic-ish
    float br = vn2(vec2(vW.y*80.0, (vW.x+vW.z)*3.0));
    height = br; bump = 0.008;
    s.albedo *= 0.86 + 0.14*br;
    s.rough = 0.26 + 0.14*br; s.metal = 0.92;
  } else if(mat == 5){                             // upholstery weave
    float wv = 0.5 + 0.25*sin(vW.x*72.0)*sin(vW.z*72.0) + 0.25*sin(vW.y*72.0 + vW.x*10.0);
    height = wv; bump = 0.03;
    s.albedo *= 0.92 + 0.12*wv;
    s.albedo *= 1.0 + (vn3(vW*6.0)-0.5)*0.06;
    s.rough = 0.94; sheen = 0.22;
  } else if(mat == 6){                             // monitor: emissive desktop
    float seed = h21(floor(vW.xz*3.0) + floor(vW.y*3.0));
    vec3 ui = screenUI(clamp(vUV,0.0,1.0), seed, uTime);
    s.albedo = ui*0.06;
    s.emis = pow(ui, vec3(2.2)) * 2.6;
    // scanline + a faint grid, so a screen never reads as a flat slab
    s.emis *= 0.92 + 0.08*sin(vUV.y*420.0);
    s.rough = 0.16;
  } else if(mat == 7){                             // acoustic ceiling tile
    float d = step(0.80, h21(floor(vW.xz*42.0)));
    height = d; bump = 0.006;
    s.albedo *= 1.0 - 0.07*d;
    s.rough = 0.95;
  } else if(mat == 8){                             // skin
    float pores = vn3(vW*140.0);
    height = pores; bump = 0.0016;
    s.albedo *= 1.0 + (vn3(vW*11.0)-0.5)*0.05;
    s.rough = 0.48 + 0.10*pores; wrap = 0.42;
  } else if(mat == 9){                             // floor tile with grout
    vec2 gt = fract(vW.xz);
    float grout = clamp(step(gt.x,0.03)+step(gt.y,0.03), 0.0, 1.0);
    height = -grout; bump = 0.05;
    s.albedo *= 1.0 - 0.12*grout;
    s.albedo *= 1.0 + (vn2(vW.xz*30.0)-0.5)*0.05;
    s.rough = mix(0.18, 0.80, grout);
  } else if(mat == 10){                            // glossy plastic, eyes
    s.rough = 0.11;
  } else if(mat == 11){                            // whiteboard / signage
    s.rough = 0.22;
  } else if(mat == 12){                            // paper
    if(N.y > 0.9){
      float ln = step(0.55, fract(vW.z*22.0))*step(0.08, fract(vW.x*0.9));
      s.albedo *= 1.0 - 0.10*ln;
    }
    s.rough = 0.88;
  } else if(mat == 13){                            // foliage
    float lv = vn3(vW*9.0);
    height = lv; bump = 0.02;
    s.albedo *= 0.84 + 0.32*lv;
    s.rough = 0.60; wrap = 0.55;
  } else if(mat == 14){                            // hair: strand sheen
    float st = 0.5 + 0.5*sin(vW.y*90.0 + vn3(vW*4.0)*5.0);
    height = st; bump = 0.006;
    s.albedo *= 0.84 + 0.24*st;
    s.rough = 0.34;
  } else if(mat == 15){                            // clothing: fine weave
    float wv = 0.5 + 0.5*sin(vW.x*110.0 + vW.z*90.0)*sin(vW.y*110.0);
    height = wv; bump = 0.012;
    s.albedo *= 0.96 + 0.05*wv;
    s.albedo *= 1.0 + (vn3(vW*8.0)-0.5)*0.05;
    s.rough = 0.86; sheen = 0.30;
  } else {
    float g = (vn3(vW*2.3)-0.5)*0.055 + (vn3(vW*9.0)-0.5)*0.035;
    height = vn3(vW*2.3); bump = 0.006;
    s.albedo *= 1.0 + g;
    s.rough = 0.66;
  }

  if(bump > 0.0) N = bumpNormal(N, vW, height, bump);

  // Glass is drawn in its own blended pass: thin, reflective, barely tinted.
  float alpha = 1.0;
  if(uGlassMode > 0.5){
    s.rough = 0.05; s.metal = 0.0;
    alpha = 0.20;
  }

  float ndv = clamp(dot(N, V), 1e-4, 1.0);
  float a = max(s.rough*s.rough, 0.0015);
  vec3 f0 = mix(vec3(0.04), s.albedo, s.metal);
  vec3 kd = s.albedo * (1.0 - s.metal);

  // ---- sun ----
  vec3 L = -uSun;
  float ndlRaw = dot(N, L);
  float ndl = max((ndlRaw + wrap) / (1.0 + wrap), 0.0);
  float sh = shadowFactor(N);
  vec3 H = normalize(L + V);
  float ndh = max(dot(N,H), 0.0), vdh = max(dot(V,H), 0.0);
  vec3 spec = F_Schlick(f0, vdh) * D_GGX(ndh, a) * V_SmithGGX(ndv, max(ndlRaw,1e-4), a);
  vec3 lit = (kd/3.14159265 + spec) * uSunCol * ndl * sh;

  // ---- sky: diffuse irradiance + roughness-blurred specular ----
  vec3 irr = mix(uGndCol, uSkyCol, N.y*0.5 + 0.5);
  irr = mix(irr, uHorizCol, pow(1.0-abs(N.y), 3.0)*0.45);
  lit += kd * irr * uAmb * vAO;

  vec3 R = reflect(-V, N);
  // Specular occlusion: a crevice that hides the sky should not mirror it.
  float so = clamp(pow(ndv + vAO, exp2(-16.0*s.rough - 1.0)) - 1.0 + vAO, 0.0, 1.0);
  lit += skyColor(R, s.rough) * envBRDF(f0, s.rough, ndv) * uAmb * so;

  // ---- overhead fluorescents: a soft downward fill the sun cannot provide.
  // Kept low: at any strength that reads as "lit", it flattens every floor and
  // desktop into the same pale value and the room loses its shape. ----
  float tube = max(N.y, 0.0);
  lit += kd * vec3(0.96,0.98,1.0) * tube * 0.085 * vAO;

  // ---- cloth sheen: grazing retroreflection, the thing that reads as fabric ----
  if(sheen > 0.0){
    float f = pow(1.0 - ndv, 4.0);
    lit += s.albedo * f * sheen * (uAmb*0.6 + ndl*sh*0.5);
  }

  lit += s.emis;

  // interaction highlight (the desk you are about to click)
  lit += vec3(1.0,0.72,0.26) * pow(1.0-ndv, 2.2) * uHL * 2.4;

  // depth fog toward the window light
  float fogA = 1.0 - exp(-vD/uFogFar * 1.35);
  lit = mix(lit, uFogCol, fogA*fogA*0.55);

  outColor = vec4(lit * uExposure, alpha);
}`;

export const FS_DEPTH = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vC; in float vAO; in float vFlag; in vec3 vW; in vec4 vLS; in float vD;
flat in float vMat; in vec2 vUV;
${FLOOR_FN}
${CUT_FN}
out vec4 outColor;
void main(){
  if(cutAway(vW, vFlag)) discard;
  outColor = vec4(1.0);
}`;

/* ═══════════════════════ skinned glTF (the boss monsters) ═══════════════════

   The office is procedural and rigid-skinned: one bone index per vertex, bones
   in a uniform array. An imported character is neither — it wants four weighted
   joints per vertex and, at 43 joints for the orc, more matrices than a uniform
   array can be relied on to hold on a phone. So this path keeps the joints in a
   float texture read with texelFetch, which has no size ceiling worth worrying
   about and needs no filtering extension.

   Colour comes from the pack's own atlas rather than a procedural material,
   which is the whole reason these are separate programs and not a branch. */

export const VS_SKIN = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aJoint;
layout(location=4) in vec4 aWeight;
uniform mat4 uVP, uLightVP, uModel;
uniform sampler2D uJoints;      // one 4x1 texel row per joint matrix
uniform float uSkinned;
out vec3 vN; out vec3 vW; out vec2 vUV; out vec4 vLS; out float vD;

mat4 jointAt(int i){
  return mat4(texelFetch(uJoints, ivec2(0,i), 0), texelFetch(uJoints, ivec2(1,i), 0),
              texelFetch(uJoints, ivec2(2,i), 0), texelFetch(uJoints, ivec2(3,i), 0));
}

void main(){
  mat4 S = mat4(1.0);
  if(uSkinned > 0.5){
    S = jointAt(int(aJoint.x)) * aWeight.x + jointAt(int(aJoint.y)) * aWeight.y
      + jointAt(int(aJoint.z)) * aWeight.z + jointAt(int(aJoint.w)) * aWeight.w;
  }
  mat4 M = uModel * S;
  vec4 w = M * vec4(aPos, 1.0);
  vec3 n = normalize(mat3(M) * aNrm);
  vW = w.xyz; vN = n; vUV = aUV;
  vLS = uLightVP * vec4(w.xyz + n*0.055, 1.0);
  gl_Position = uVP * w;
  vD = gl_Position.w;
}`;

/* Shared by both skinned passes: hide a monster standing on a floor the player
   is not looking at, using the same dithered threshold the office uses so the
   two dissolve together instead of one popping. */
const SKIN_CUT = `
uniform float uFloorY;
float dither4s(){
  const float B[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
  ivec2 p = ivec2(gl_FragCoord.xy) & 3;
  return (B[p.y*4+p.x] + 0.5) / 16.0;
}
bool skinCut(vec3 w){
  if(uFloorY >= 900.0) return false;
  return smoothstep(uFloorY, uFloorY + 0.7, w.y) > dither4s();
}`;

export const FS_SKIN = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vN; in vec3 vW; in vec2 vUV; in vec4 vLS; in float vD;

uniform vec3 uSun, uSunCol, uSkyCol, uGndCol, uHorizCol, uFogCol, uEye;
uniform float uAmb, uFogFar, uTime, uExposure;
uniform vec2 uSTexel;
uniform sampler2DShadow uShadow;
uniform sampler2D uAlbedo;
uniform vec3 uTint;             // damage flash / death fade, multiplied in
uniform float uEmis;            // rim glow while the idea is "hot"
uniform float uAlpha;

${SKIN_CUT}
${SHADOW_FN}
${PBR_FN}

out vec4 outColor;

void main(){
  if(skinCut(vW)) discard;

  vec4 tex = texture(uAlbedo, vUV);
  if(tex.a < 0.35) discard;                      // the packs use cutout alpha

  vec3 N = normalize(vN);
  if(!gl_FrontFacing) N = -N;                    // the packs are double sided
  vec3 V = normalize(uEye - vW);

  vec3 albedo = pow(tex.rgb, vec3(2.2)) * uTint;
  float rough = 0.68, metal = 0.0;

  float ndv = clamp(dot(N, V), 1e-4, 1.0);
  float a = max(rough*rough, 0.0015);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 kd = albedo * (1.0 - metal);

  vec3 L = -uSun;
  float ndlRaw = dot(N, L);
  // A little light wrap: these are stylised characters, and a hard terminator
  // across a flat-shaded low-poly face reads as a modelling error.
  float ndl = max((ndlRaw + 0.25) / 1.25, 0.0);
  float sh = shadowFactor(N);
  vec3 H = normalize(L + V);
  vec3 spec = F_Schlick(f0, max(dot(V,H),0.0)) * D_GGX(max(dot(N,H),0.0), a)
            * V_SmithGGX(ndv, max(ndlRaw,1e-4), a);
  vec3 lit = (kd/3.14159265 + spec) * uSunCol * ndl * sh;

  vec3 irr = mix(uGndCol, uSkyCol, N.y*0.5 + 0.5);
  irr = mix(irr, uHorizCol, pow(1.0-abs(N.y), 3.0)*0.45);
  lit += kd * irr * uAmb;
  lit += skyColor(reflect(-V, N), rough) * envBRDF(f0, rough, ndv) * uAmb * 0.6;
  lit += kd * vec3(0.96,0.98,1.0) * max(N.y, 0.0) * 0.085;

  // Fresnel rim, driven by how much fight the idea has left in it.
  lit += mix(vec3(1.0,0.42,0.22), vec3(0.45,0.72,1.0), 0.5) * pow(1.0-ndv, 2.6) * uEmis * 3.0;

  float fogA = 1.0 - exp(-vD/uFogFar * 1.35);
  lit = mix(lit, uFogCol, fogA*fogA*0.55);

  outColor = vec4(lit * uExposure, uAlpha);
}`;

export const FS_SKIN_DEPTH = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vW; in vec2 vUV; in vec4 vLS; in float vD;
uniform sampler2D uAlbedo;
${SKIN_CUT}
out vec4 outColor;
void main(){
  if(skinCut(vW)) discard;
  if(texture(uAlbedo, vUV).a < 0.35) discard;
  outColor = vec4(1.0);
}`;

/* ---- fullscreen triangle, no vertex buffer ---- */
export const VS_POST = `#version 300 es
out vec2 vT;
void main(){
  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);
  vT = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

/* Bright pass with Karis average: weighting each tap by 1/(1+luma) stops a
   single blown pixel from producing a flickering star during camera motion. */
export const FS_BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThreshold, uKnee;
in vec2 vT; out vec4 outColor;
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
vec3 tap(vec2 uv){
  vec3 c = texture(uTex, uv).rgb;
  return c / (1.0 + luma(c));
}
void main(){
  vec3 c = tap(vT)
         + tap(vT + vec2( uTexel.x,  uTexel.y))
         + tap(vT + vec2(-uTexel.x,  uTexel.y))
         + tap(vT + vec2( uTexel.x, -uTexel.y))
         + tap(vT + vec2(-uTexel.x, -uTexel.y));
  c *= 0.2;
  c = c / max(1.0 - luma(c), 1e-3);              // undo the Karis weighting
  float l = luma(c);
  // soft knee so the bloom fades in rather than switching on
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0*uKnee);
  soft = soft*soft / (4.0*uKnee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  outColor = vec4(c*w, 1.0);
}`;

export const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexel;
in vec2 vT; out vec4 outColor;
void main(){
  // 13-tap "dual filter" box, the Call of Duty / Jimenez downsample
  vec3 a = texture(uTex, vT + uTexel*vec2(-2,-2)).rgb;
  vec3 b = texture(uTex, vT + uTexel*vec2( 0,-2)).rgb;
  vec3 c = texture(uTex, vT + uTexel*vec2( 2,-2)).rgb;
  vec3 d = texture(uTex, vT + uTexel*vec2(-2, 0)).rgb;
  vec3 e = texture(uTex, vT).rgb;
  vec3 f = texture(uTex, vT + uTexel*vec2( 2, 0)).rgb;
  vec3 g = texture(uTex, vT + uTexel*vec2(-2, 2)).rgb;
  vec3 h = texture(uTex, vT + uTexel*vec2( 0, 2)).rgb;
  vec3 i = texture(uTex, vT + uTexel*vec2( 2, 2)).rgb;
  vec3 j = texture(uTex, vT + uTexel*vec2(-1,-1)).rgb;
  vec3 k = texture(uTex, vT + uTexel*vec2( 1,-1)).rgb;
  vec3 l = texture(uTex, vT + uTexel*vec2(-1, 1)).rgb;
  vec3 m = texture(uTex, vT + uTexel*vec2( 1, 1)).rgb;
  vec3 o = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
  outColor = vec4(o, 1.0);
}`;

export const FS_UP = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uRadius;
in vec2 vT; out vec4 outColor;
void main(){
  vec2 r = uTexel*uRadius;
  vec3 o = texture(uTex, vT + vec2(-r.x, -r.y)).rgb
         + texture(uTex, vT + vec2( 0.0, -r.y)).rgb*2.0
         + texture(uTex, vT + vec2( r.x, -r.y)).rgb
         + texture(uTex, vT + vec2(-r.x,  0.0)).rgb*2.0
         + texture(uTex, vT).rgb*4.0
         + texture(uTex, vT + vec2( r.x,  0.0)).rgb*2.0
         + texture(uTex, vT + vec2(-r.x,  r.y)).rgb
         + texture(uTex, vT + vec2( 0.0,  r.y)).rgb*2.0
         + texture(uTex, vT + vec2( r.x,  r.y)).rgb;
  outColor = vec4(o/16.0, 1.0);
}`;

/* Composite: HDR + bloom -> ACES -> grain, vignette, subtle chromatic
   aberration at the very edge. Output is sRGB-encoded for FXAA to read. */
export const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uHDR, uBloom;
uniform vec2 uTexel;
uniform float uBloomAmt, uTime, uGrain, uVignette, uAberr;
in vec2 vT; out vec4 outColor;

vec3 aces(vec3 x){
  // Narkowicz fit of the ACES filmic curve
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }

void main(){
  vec2 d = vT - 0.5;
  float r2 = dot(d,d);

  // The lens smears colour only near the frame edge; the centre stays clean.
  vec2 off = d * r2 * uAberr;
  vec3 hdr;
  hdr.r = texture(uHDR, vT + off).r;
  hdr.g = texture(uHDR, vT).g;
  hdr.b = texture(uHDR, vT - off).b;

  hdr += texture(uBloom, vT).rgb * uBloomAmt;

  vec3 col = aces(hdr);

  float vig = 1.0 - uVignette*r2*1.9;
  col *= clamp(vig, 0.0, 1.0);

  col = pow(max(col,0.0), vec3(1.0/2.2));

  // Grain after the transfer curve, so it stays perceptually even.
  float g = h21(gl_FragCoord.xy + fract(uTime)*137.0) - 0.5;
  col += g * uGrain;

  outColor = vec4(col, 1.0);
}`;

export const FS_FXAA = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexel;
in vec2 vT; out vec4 outColor;
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
void main(){
  vec3 rgbM  = texture(uTex, vT).rgb;
  vec3 rgbNW = texture(uTex, vT + vec2(-1.0,-1.0)*uTexel).rgb;
  vec3 rgbNE = texture(uTex, vT + vec2( 1.0,-1.0)*uTexel).rgb;
  vec3 rgbSW = texture(uTex, vT + vec2(-1.0, 1.0)*uTexel).rgb;
  vec3 rgbSE = texture(uTex, vT + vec2( 1.0, 1.0)*uTexel).rgb;
  float lNW=luma(rgbNW), lNE=luma(rgbNE), lSW=luma(rgbSW), lSE=luma(rgbSE), lM=luma(rgbM);
  float lMin=min(lM,min(min(lNW,lNE),min(lSW,lSE)));
  float lMax=max(lM,max(max(lNW,lNE),max(lSW,lSE)));
  vec2 dir=vec2(-((lNW+lNE)-(lSW+lSE)), ((lNW+lSW)-(lNE+lSE)));
  float dirReduce=max((lNW+lNE+lSW+lSE)*(0.25*(1.0/8.0)), 1.0/128.0);
  float rcpDirMin=1.0/(min(abs(dir.x),abs(dir.y))+dirReduce);
  dir=clamp(dir*rcpDirMin, vec2(-8.0), vec2(8.0))*uTexel;
  vec3 rgbA=0.5*(texture(uTex, vT+dir*(1.0/3.0-0.5)).rgb + texture(uTex, vT+dir*(2.0/3.0-0.5)).rgb);
  vec3 rgbB=rgbA*0.5 + 0.25*(texture(uTex, vT+dir*-0.5).rgb + texture(uTex, vT+dir*0.5).rgb);
  float lB=luma(rgbB);
  outColor=vec4((lB<lMin||lB>lMax)? rgbA : rgbB, 1.0);
}`;
