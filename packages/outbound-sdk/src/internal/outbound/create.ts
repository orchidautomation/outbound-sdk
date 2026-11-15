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
 * The type of an instance built with these plugins, for a function that
 * takes one:
 *
 * ```ts
 * const plugins = [insights(), exporter()];
 * type MyOutbound = OutboundWith<typeof plugins>;
 * const brief = async (outbound: MyOutbound) => outbound.insights.hotLeads({});
 * ```
 *
 * `Outbound` alone is an instance with no plugins.
 */
export type OutboundWith<
  Plugins extends readonly OutboundPlugin[] = [],
  Native extends NativeCatalog = NoNative,
> = Outbound<Native> & ExtensionsOf<Plugins>;

/**
 * Creates the client. One instance wraps one adapter; `combine()` puts
 * several adapters behind one.
 */
// The result is NoInfer: the plugins come from `options`, never from the
// type the result is assigned to, so an instance built without a plugin
// cannot be typed as one with it.
export const createOutbound = <
  const Plugins extends readonly OutboundPlugin[] = [],
  Native extends NativeCatalog = NoNative,
>(
  options: OutboundOptions<Native> & {
    readonly plugins?: Plugins | undefined;
  }
): NoInfer<OutboundWith<Plugins, Native>> => {
  const outbound = new Outbound<Native>(options);

  installExtensions(outbound, options.plugins ?? []);

  // SAFETY: installExtensions() just defined every property the plugins' extensions declare.
  return outbound as OutboundWith<Plugins, Native>;
};
