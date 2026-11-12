// Minimal WebGL2 renderer: premultiplied-alpha textured meshes, off-screen targets
// with mipmapped down-sampling, weighted (additive) compositing for cross-fades.

const VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform vec4 u_view;      // (2/w, -2/h, -1, 1): pixel space -> clip space, y down
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos.x * u_view.x + u_view.z, a_pos.y * u_view.y + u_view.w, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_alpha;
uniform float u_bias;
out vec4 o;
void main() {
  o = texture(u_tex, v_uv, u_bias) * u_alpha;
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'default' });
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.bindAttribLocation(prog, 1, 'a_uv');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.u = { view: gl.getUniformLocation(prog, 'u_view'), tex: gl.getUniformLocation(prog, 'u_tex'), alpha: gl.getUniformLocation(prog, 'u_alpha'), bias: gl.getUniformLocation(prog, 'u_bias') };
    gl.useProgram(prog);
    gl.uniform1i(this.u.tex, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Shared dynamic quad
    this.quadVao = gl.createVertexArray();
    this.quadPos = gl.createBuffer();
    this.quadUv = gl.createBuffer();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadPos);
    gl.bufferData(gl.ARRAY_BUFFER, 8 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUv);
    gl.bufferData(gl.ARRAY_BUFFER, 8 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.qp = new Float32Array(8);
    this.qu = new Float32Array(8);
    this.maxAniso = 1;
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) { this.aniso = aniso; this.maxAniso = Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)); }
    this.width = 1; this.height = 1;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
  }

  resize(cssW, cssH, dpr) {
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    this.width = w; this.height = h;
  }

  /** Upload an ImageBitmap that is already premultiplied. */
  texture(bitmap, { mipmap = false } = {}) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    this.#params(mipmap);
    if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
    return { tex, w: bitmap.width, h: bitmap.height, mipmap };
  }

  updateTexture(t, bitmap) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (t.w === bitmap.width && t.h === bitmap.height) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap); t.w = bitmap.width; t.h = bitmap.height; }
    if (t.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  }

  #params(mipmap) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mipmap && this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, this.maxAniso);
  }

  deleteTexture(t) { if (t?.tex) this.gl.deleteTexture(t.tex); }

  /** Off-screen render target with a mipmappable colour texture. */
  target(w, h, old) {
    const gl = this.gl;
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (old && old.w === w && old.h === h) return old;
    if (old) { gl.deleteFramebuffer(old.fbo); gl.deleteTexture(old.tex); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA8, w, h);
    this.#params(true);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h, mipmap: true, isTarget: true };
  }

  /** Begin drawing into a target (null = screen). Coordinates are target pixels. */
  begin(target, clear = true) {
    const gl = this.gl;
    const w = target ? target.w : this.width, h = target ? target.h : this.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.uniform4f(this.u.view, 2 / w, -2 / h, -1, 1);
    gl.uniform1f(this.u.bias, 0);
    gl.disable(gl.SCISSOR_TEST);
    if (clear) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    // screen drawing can be cut off below a horizontal line (css px), e.g. the taskbar edge
    if (!target && this.clipY != null) {
      const keep = Math.max(0, Math.min(h, Math.round(this.clipY * this.dpr)));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, h - keep, w, keep);
    }
    this.current = target;
  }

  end(target) {
    if (target) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  }

  blend(mode) {
    const gl = this.gl;
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Mesh created once per layer piece: static uv/index buffers, dynamic positions. */
  mesh(uvs, indices) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const pos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, uvs.length * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uv = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uv);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, pos, count: indices.length };
  }

  drawMesh(m, positions, tex, alpha = 1) {
    const gl = this.gl;
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.uniform1f(this.u.alpha, alpha);
    gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
  }

  /**
   * Draw a texture through an affine map. corners = [x0,y0, x1,y1, x2,y2, x3,y3] (TL, TR, BL, BR)
   * in target pixels; uv = [u0,v0,u1,v1] (top-left / bottom-right in texture space).
   */
  drawQuad(tex, corners, uv, alpha = 1, bias = 0) {
    const gl = this.gl;
    const p = this.qp, q = this.qu;
    p.set(corners);
    q[0] = uv[0]; q[1] = uv[1]; q[2] = uv[2]; q[3] = uv[1]; q[4] = uv[0]; q[5] = uv[3]; q[6] = uv[2]; q[7] = uv[3];
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUv);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, q);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.uniform1f(this.u.alpha, alpha);
    gl.uniform1f(this.u.bias, bias);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform1f(this.u.bias, 0);
  }

  /** Alpha (0..1) of the default framebuffer at css coords; call right after drawing. */
  readAlpha(cssX, cssY) {
    const gl = this.gl;
    const x = Math.round(cssX * this.dpr), y = this.height - 1 - Math.round(cssY * this.dpr);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const px = this._px || (this._px = new Uint8Array(4 * 9));
    const x0 = Math.max(0, x - 1), y0 = Math.max(0, y - 1);
    gl.readPixels(x0, y0, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let a = 0;
    for (let i = 3; i < px.length; i += 4) a = Math.max(a, px[i]);
    return a / 255;
  }
}

// ---------------------------------------------------------------- 2D affine helpers
// Matrix as [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f
export const mat = {
  identity: () => [1, 0, 0, 1, 0, 0],
  mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  },
  translate: (x, y) => [1, 0, 0, 1, x, y],
  scale: (x, y = x) => [x, 0, 0, y, 0, 0],
  rotate(r) { const c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; },
  /** rotation r and scale (sx, sy) about pivot (px, py), then translate (tx, ty) */
  about(px, py, r = 0, sx = 1, sy = 1, tx = 0, ty = 0) {
    const c = Math.cos(r), s = Math.sin(r);
    const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
    return [a, b, cc, d, px - a * px - cc * py + tx, py - b * px - d * py + ty];
  },
  apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
  invert(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return mat.identity();
    const i = 1 / det;
    return [m[3] * i, -m[1] * i, -m[2] * i, m[0] * i, (m[2] * m[5] - m[3] * m[4]) * i, (m[1] * m[4] - m[0] * m[5]) * i];
  },
};
