import { dimensions, type Edit } from './model'
const vertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main() { uv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5); gl_Position = vec4(position, 0, 1); }`
const fragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D photo;
uniform vec4 crop;
uniform int rotation;
uniform vec2 flip;
uniform vec4 adjustment;
uniform float vignette;
void main() {
 vec2 p = mix(uv, 1.0 - uv, flip);
 if (rotation == 1) p = vec2(p.y, 1.0-p.x);
 else if (rotation == 2) p = 1.0-p;
 else if (rotation == 3) p = vec2(1.0-p.y, p.x);
 vec4 source = texture(photo, crop.xy + p * crop.zw);
 vec3 c = source.rgb * exp2(adjustment.x);
 c = (c - 0.5) * (1.0 + adjustment.y) + 0.5;
 float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
 c = mix(vec3(luma), c, 1.0 + adjustment.z);
 c += adjustment.w * vec3(0.12, 0.02, -0.12);
 c *= 1.0 - vignette * smoothstep(0.15, 0.72, distance(uv, vec2(0.5)));
 color = vec4(clamp(c, 0.0, 1.0), source.a);
}`
export class Renderer {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  texture: WebGLTexture
  buffer: WebGLBuffer
  width = 1
  height = 1
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
    this.texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
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
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
    if (gl.getError() !== gl.NO_ERROR)
      throw new Error(
        'Your GPU could not load this photo. Try a smaller image.',
      )
  }
  render(edit: Edit, max = 2048) {
    const gl = this.gl,
      size = dimensions(this.width, this.height, edit, max)
    if (this.canvas.width !== size.width) this.canvas.width = size.width
    if (this.canvas.height !== size.height) this.canvas.height = size.height
    gl.viewport(0, 0, size.width, size.height)
    gl.useProgram(this.program)
    const loc = (key: string) => gl.getUniformLocation(this.program, key)
    gl.uniform4f(
      loc('crop'),
      edit.crop.x,
      edit.crop.y,
      edit.crop.width,
      edit.crop.height,
    )
    gl.uniform1i(loc('rotation'), (((edit.rotation / 90) % 4) + 4) % 4)
    gl.uniform2f(loc('flip'), +edit.flipX, +edit.flipY)
    gl.uniform4f(
      loc('adjustment'),
      edit.exposure,
      edit.contrast,
      edit.saturation,
      edit.temperature,
    )
    gl.uniform1f(loc('vignette'), edit.vignette)
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
    this.gl.deleteProgram(this.program)
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
