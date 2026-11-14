import type { NativeCatalog, NoNative } from "../native.ts";
import { Outbound } from "./outbound.ts";
import type { OutboundOptions } from "./outbound.ts";
import { installExtensions } from "./plugins.ts";
import type { OutboundPlugin } from "./plugins.ts";

type ExtensionOf<Plugin> =
  Plugin extends OutboundPlugin<infer Extension>
    ? unknown extends Extension
      ? Record<never, never>
      : Extension
    : never;

type UnionToIntersection<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

/** The methods a list of plugins adds to the instance. */
export type ExtensionsOf<Plugins extends readonly OutboundPlugin[]> =
  UnionToIntersection<ExtensionOf<Plugins[number]>>;

/**
 * Creates the client. One instance wraps one adapter; `combine()` puts
 * several adapters behind one.
 */
export const createOutbound = <
  const Plugins extends readonly OutboundPlugin[] = [],
  Native extends NativeCatalog = NoNative,
>(
  options: OutboundOptions<Native> & {
    readonly plugins?: Plugins | undefined;
  }
): Outbound<Native> & ExtensionsOf<Plugins> => {
  const outbound = new Outbound<Native>(options);

  installExtensions(outbound, options.plugins ?? []);

  // SAFETY: installExtensions() just defined every property the plugins' extensions declare.
  return outbound as Outbound<Native> & ExtensionsOf<Plugins>;
};
