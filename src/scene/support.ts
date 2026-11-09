/** True if this browser can create a WebGL2 context (the 3D ocean needs it). Add ?svg to force the 2D ocean. */
export function webglAvailable() {
  if (new URLSearchParams(window.location.search).has('svg')) return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}
