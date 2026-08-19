// Shim declaration for `three` to keep TypeScript builds stable in CI when the
// package is resolved without bundled declarations.
declare module 'three' {
  const THREE: any;
  export = THREE;
}
