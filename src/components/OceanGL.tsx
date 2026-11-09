import { useEffect, useRef, type RefObject } from 'react';
import type { RoundView } from '../game/engine';
import { DiveScene } from '../scene/DiveScene';

interface Props {
  round: RoundView | null;
  swimming: number | null;
  interactive: boolean;
  onPick: (cave: number) => void;
  /** The part of the screen the HUD panels leave free; the camera keeps the play column centred in it. */
  focus: RefObject<HTMLElement>;
  /** Called if the WebGL scene can't start, so the app can switch to the 2D ocean. */
  onFail: () => void;
}

/** The full-screen 3D ocean, drawn behind the HUD. */
export function OceanGL(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<DiveScene | null>(null);
  const onPick = useRef(props.onPick);
  onPick.current = props.onPick;
  const onFail = useRef(props.onFail);
  onFail.current = props.onFail;

  useEffect(() => {
    try {
      scene.current = new DiveScene(host.current!, props.focus.current, (cave) => onPick.current(cave));
    } catch (e) {
      console.warn('WebGL ocean unavailable, using the 2D one', e);
      onFail.current();
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
    // The focus element is fixed for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scene.current?.setState({ round: props.round, swimming: props.swimming, interactive: props.interactive });
  }, [props.round, props.swimming, props.interactive]);

  return <div className="ocean-gl" ref={host} />;
}
