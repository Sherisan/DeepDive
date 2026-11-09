/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute origin of the Worldiator API in production builds (e.g. https://gameapi.easygamesdemo.co.za). Empty in dev — relative URLs go through the Vite proxy instead. */
  readonly VITE_API_BASE?: string;
  /** Balance shown when the game is opened without a ?token launch (defaults to 10000, matching the API's RGS:Stub:DefaultBalance). */
  readonly VITE_DEMO_BALANCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
