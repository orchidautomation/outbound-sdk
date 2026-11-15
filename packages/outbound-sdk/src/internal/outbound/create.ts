import type { Adapter } from "../adapter.ts";
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
 * The native catalog of an adapter type. A union of adapters, as from
 * `cond ? smartlead() : instantly()`, gives the union of their catalogs, so
 * only the reads they share are typed.
 */
export type NativeOf<Given> =
  Given extends Adapter<infer Native> ? Native : NoNative;

/**
 * Creates the client. One instance wraps one adapter; `combine()` puts
 * several adapters behind one.
 */
// The result is NoInfer: the plugins come from `options`, never from the
// type the result is assigned to, so an instance built without a plugin
// cannot be typed as one with it. The adapter is inferred as a whole rather
// than through its catalog, so a union of two adapters is accepted.
export const createOutbound = <
  const Plugins extends readonly OutboundPlugin[] = [],
  const Given extends Adapter<NativeCatalog> = Adapter,
>(
  options: Omit<OutboundOptions, "adapter"> & {
    readonly adapter: Given;
    // The array form accepts a list TypeScript infers as a tuple but types
    // as an array, such as one with a conditional spread.
    readonly plugins?: Plugins | readonly Plugins[number][] | undefined;
  }
): NoInfer<OutboundWith<Plugins, NativeOf<Given>>> => {
  const outbound = new Outbound<NativeCatalog>(options);

  installExtensions(outbound, options.plugins ?? []);

  // SAFETY: installExtensions() just defined every property the plugins'
  // extensions declare, and the adapter's catalog is `NativeOf<Given>` by
  // that type's definition, which TypeScript cannot see through.
  return outbound as OutboundWith<Plugins, NativeOf<Given>>;
};
