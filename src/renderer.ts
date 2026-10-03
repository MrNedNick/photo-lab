import { dimensions, MAX_REDACTIONS, straightenScale, type Edit } from './model'
const vertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main() { uv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5); gl_Position = vec4(position, 0, 1); }`
const fragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D photo;
uniform sampler2D mask;
uniform vec2 texSize;
uniform vec4 crop;
uniform int rotation;
uniform vec2 flip;
uniform vec3 straighten; // angle (rad), output aspect, zoom
uniform vec4 adjustment;
uniform float vignette;
uniform int background; // 0 keep, 1 transparent, 2 color, 3 blur
uniform vec3 backgroundColor;
uniform vec4 redact[${MAX_REDACTIONS}];
uniform float redactMode[${MAX_REDACTIONS}];
uniform int redactCount;
uniform float split; // output x below which the original colors show
uniform int blurPasses; // upper bound for the blur loop, see below
const float GOLDEN = 2.39996323;
const int TAPS = 32;
void main() {
  vec2 q = vec2((uv.x - 0.5) * straighten.y, uv.y - 0.5);
  float c = cos(straighten.x), sn = sin(straighten.x);
  vec2 p = vec2((c * q.x - sn * q.y) / straighten.z / straighten.y + 0.5,
                (sn * q.x + c * q.y) / straighten.z + 0.5);
  p = mix(p, 1.0 - p, flip);
  if (rotation == 1) p = vec2(p.y, 1.0-p.x);
  else if (rotation == 2) p = 1.0-p;
  else if (rotation == 3) p = vec2(1.0-p.y, p.x);
  vec2 s = crop.xy + p * crop.zw;
  vec4 source = texture(photo, s);
  if (uv.x < split) { color = source; return; }
  vec3 base = source.rgb;
  float areaBlur = 0.0;
  for (int i = 0; i < ${MAX_REDACTIONS}; i++) {
    if (i >= redactCount) break;
    vec4 r = redact[i];
    if (s.x < r.x || s.y < r.y || s.x > r.x + r.z || s.y > r.y + r.w) continue;
    float extent = max(r.z * texSize.x, r.w * texSize.y);
    if (redactMode[i] > 0.5) {
      vec2 cell = vec2(max(4.0, extent / 14.0)) / texSize;
      base = texture(photo, r.xy + (floor((s - r.xy) / cell) + 0.5) * cell).rgb;
    } else areaBlur = max(6.0, extent / 7.0);
  }
  float m = background == 0 ? 1.0 : smoothstep(0.2, 0.8, texture(mask, s).r);
  float backBlur = background == 3 && m < 1.0 ? max(texSize.x, texSize.y) * 0.018 : 0.0;
  // One blur loop serves both the hidden areas and the background. Its bound
  // is a uniform so the compiler cannot unroll it into two copies, which
  // matters for software GPUs where compile time dominates the first frame.
  vec3 soft = base;
  for (int pass = 0; pass < blurPasses; pass++) {
    float radius = pass == 0 ? areaBlur : backBlur;
    if (radius <= 0.0) continue;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < TAPS; i++) {
      float d = sqrt((float(i) + 0.5) / float(TAPS)) * radius;
      float a = float(i) * GOLDEN;
      sum += texture(photo, s + vec2(cos(a), sin(a)) * d / texSize).rgb;
    }
    if (pass == 0) base = sum / float(TAPS);
    else soft = sum / float(TAPS);
  }
  vec3 col = base * exp2(adjustment.x);
  col = (col - 0.5) * (1.0 + adjustment.y) + 0.5;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, 1.0 + adjustment.z);
  col += adjustment.w * vec3(0.12, 0.02, -0.12);
  col *= 1.0 - vignette * smoothstep(0.15, 0.72, distance(uv, vec2(0.5)));
  col = clamp(col, 0.0, 1.0);
  if (background == 0) color = vec4(col, source.a);
  else if (background == 1) color = vec4(col, source.a * m);
  else if (background == 2) color = vec4(mix(backgroundColor, col, m), 1.0);
  else color = vec4(mix(soft, col, m), 1.0);
}`
const backgrounds = { keep: 0, transparent: 1, color: 2, blur: 3 } as const
function hex(color: string) {
  const n = parseInt(color.replace('#', ''), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [
    number,
    number,
    number,
  ]
}
export class Renderer {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  texture: WebGLTexture
  maskTexture: WebGLTexture
  buffer: WebGLBuffer
  width = 1
  height = 1
  hasMask = false
  private canvas: HTMLCanvasElement | OffscreenCanvas
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null
    if (!gl)
      throw new Error(
        'WebGL2 is unavailable. Enable hardware acceleration or try a current Chrome, Firefox or Safari browser.',
      )
    this.gl = gl
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(
          gl.getShaderInfoLog(shader) || 'Shader compilation failed',
        )
      return shader
    }
    const vs = compile(gl.VERTEX_SHADER, vertex),
      fs = compile(gl.FRAGMENT_SHADER, fragment)
    this.program = gl.createProgram()!
    gl.attachShader(this.program, vs)
    gl.attachShader(this.program, fs)
    gl.linkProgram(this.program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error('Could not initialize the photo renderer.')
    gl.useProgram(this.program)
    const buffer = gl.createBuffer()!
    this.buffer = buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )
    const location = gl.getAttribLocation(this.program, 'position')
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
    const texture = () => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    this.maskTexture = texture()
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    )
    this.texture = texture()
    gl.uniform1i(gl.getUniformLocation(this.program, 'photo'), 0)
    gl.uniform1i(gl.getUniformLocation(this.program, 'mask'), 1)
  }
  /** The largest photo side this GPU can hold as one texture. */
  get maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)
  }
  load(bitmap: ImageBitmap) {
    const gl = this.gl
    if (
      Math.max(bitmap.width, bitmap.height) >
      gl.getParameter(gl.MAX_TEXTURE_SIZE)
    )
      throw new Error(
        'This photo exceeds your GPU texture limit. Try a smaller image.',
      )
    this.width = bitmap.width
    this.height = bitmap.height
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
    if (gl.getError() !== gl.NO_ERROR)
      throw new Error(
        'Your GPU could not load this photo. Try a smaller image.',
      )
  }
  /** The cut-out mask, in original-photo coordinates; null removes it. */
  loadMask(bitmap: ImageBitmap | OffscreenCanvas | null) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture)
    if (bitmap)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bitmap,
      )
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([255, 255, 255, 255]),
      )
    gl.activeTexture(gl.TEXTURE0)
    this.hasMask = !!bitmap
  }
  render(edit: Edit, max = 2048, split = -1) {
    const gl = this.gl,
      size = dimensions(this.width, this.height, edit, max)
    if (this.canvas.width !== size.width) this.canvas.width = size.width
    if (this.canvas.height !== size.height) this.canvas.height = size.height
    gl.viewport(0, 0, size.width, size.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    const loc = (key: string) => gl.getUniformLocation(this.program, key)
    const aspect = size.width / size.height
    gl.uniform2f(loc('texSize'), this.width, this.height)
    gl.uniform4f(
      loc('crop'),
      edit.crop.x,
      edit.crop.y,
      edit.crop.width,
      edit.crop.height,
    )
    gl.uniform1i(loc('rotation'), (((edit.rotation / 90) % 4) + 4) % 4)
    gl.uniform2f(loc('flip'), +edit.flipX, +edit.flipY)
    gl.uniform3f(
      loc('straighten'),
      (edit.straighten * Math.PI) / 180,
      aspect,
      straightenScale(edit.straighten, aspect),
    )
    gl.uniform4f(
      loc('adjustment'),
      edit.exposure,
      edit.contrast,
      edit.saturation,
      edit.temperature,
    )
    gl.uniform1f(loc('vignette'), edit.vignette)
    gl.uniform1i(
      loc('background'),
      this.hasMask ? backgrounds[edit.background] : 0,
    )
    gl.uniform3f(loc('backgroundColor'), ...hex(edit.backgroundColor))
    const areas = edit.redactions.slice(0, MAX_REDACTIONS)
    gl.uniform1i(loc('redactCount'), areas.length)
    if (areas.length) {
      gl.uniform4fv(
        loc('redact'),
        areas.flatMap((r) => [r.x, r.y, r.width, r.height]),
      )
      gl.uniform1fv(
        loc('redactMode'),
        areas.map((r) => (r.mode === 'pixelate' ? 1 : 0)),
      )
    }
    gl.uniform1f(loc('split'), split)
    gl.uniform1i(loc('blurPasses'), 2)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    return size
  }
  pixels() {
    const pixels = new Uint8Array(this.canvas.width * this.canvas.height * 4)
    this.gl.readPixels(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      pixels,
    )
    return pixels
  }
  dispose() {
    this.gl.deleteBuffer(this.buffer)
    this.gl.deleteTexture(this.texture)
    this.gl.deleteTexture(this.maskTexture)
    this.gl.deleteProgram(this.program)
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
