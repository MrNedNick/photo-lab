declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const load: () => {
    HeifDecoder: new () => { decode(data: Uint8Array): never[] }
  }
  export default load
}
