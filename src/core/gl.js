/* The WebGL2 context and the few helpers everything else builds on.

   The context is a module singleton: initGL() is called once by main.js before
   any other render module is touched, and `gl` is read through getGL() so an
   import-order mistake fails loudly instead of silently binding to null. */

let _gl = null;

export function initGL(canvas) {
  _gl = canvas.getContext('webgl2', {
    antialias: false,           // we resolve through FXAA instead
    alpha: false,
    powerPreference: 'high-performance',
    depth: true,
  });
  if (!_gl) throw new Error('WebGL2 unavailable');

  // Float render targets are what make HDR + bloom possible. Linear filtering
  // on them is what makes the bloom blur chain cheap. Both are optional
  // extensions; the renderer degrades to RGBA8 if they are missing.
  const caps = {
    colorFloat: !!_gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!_gl.getExtension('OES_texture_float_linear'),
    aniso: _gl.getExtension('EXT_texture_filter_anisotropic'),
  };
  _gl.__caps = caps;
  return _gl;
}

export function getGL() {
  if (!_gl) throw new Error('initGL() has not run yet');
  return _gl;
}

export function caps() { return getGL().__caps; }

export function shader(src, type) {
  const gl = getGL();
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    // Number the source so a reported line maps to something findable.
    console.error(log, src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
    throw new Error('shader compile failed: ' + log);
  }
  return s;
}

export function program(vs, fs) {
  const gl = getGL();
  const p = gl.createProgram();
  gl.attachShader(p, shader(vs, gl.VERTEX_SHADER));
  gl.attachShader(p, shader(fs, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    console.error(log);
    throw new Error('program link failed: ' + log);
  }
  return p;
}

/* Grab every named uniform in one go. Missing names come back null, which is
   harmless to pass to gl.uniform*. */
export function uniforms(p, names) {
  const gl = getGL();
  const o = { p };
  for (const n of names) o[n] = gl.getUniformLocation(p, n);
  return o;
}

/* Upload a MeshBuilder (or the plain objects splitGlass returns) to a VAO.
   Attribute slots are fixed and mirrored in shaders.js VS_COMMON. */
export function upload(mb) {
  const gl = getGL();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffers = [];
  function buf(loc, arr, size) {
    const b = gl.createBuffer();
    buffers.push(b);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  buf(0, mb.p, 3);    // position
  buf(1, mb.n, 3);    // normal
  buf(2, mb.c, 3);    // sRGB colour
  buf(3, mb.a, 1);    // baked AO
  buf(4, mb.f, 1);    // flag (wall-cut / glass / floor id)
  buf(5, mb.b, 1);    // bone index
  buf(6, mb.m, 3);    // material id + uv
  gl.bindVertexArray(null);
  return { vao, count: mb.count(), buffers };
}

export function disposeMesh(mesh) {
  const gl = getGL();
  if (!mesh) return;
  if (mesh.buffers) for (const b of mesh.buffers) gl.deleteBuffer(b);
  if (mesh.vao) gl.deleteVertexArray(mesh.vao);
  mesh.vao = null; mesh.count = 0; mesh.buffers = null;
}
