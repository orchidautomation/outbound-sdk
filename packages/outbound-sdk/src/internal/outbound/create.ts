import { OutboundError } from "../errors.ts";
import { Outbound } from "./outbound.ts";
import type { OutboundOptions } from "./outbound.ts";
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

const isExtension = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const install = (outbound: Outbound, plugin: OutboundPlugin): void => {
  const extension = plugin.extend?.(outbound);

  if (!isExtension(extension)) {
    return;
  }

  for (const [name, value] of Object.entries(extension)) {
    if (name in outbound) {
      throw new OutboundError(
        "Invalid",
        `The ${plugin.name} plugin adds "${name}", which already exists on the instance`
      );
    }

    Object.defineProperty(outbound, name, { enumerable: true, value });
  }
};

/**
 * Creates the client. One instance wraps one adapter; `combine()` puts
 * several adapters behind one.
 */
export const createOutbound = <
  const Plugins extends readonly OutboundPlugin[] = [],
>(
  options: OutboundOptions & { readonly plugins?: Plugins | undefined }
): Outbound & ExtensionsOf<Plugins> => {
  const outbound = new Outbound(options);

  for (const plugin of options.plugins ?? []) {
    install(outbound, plugin);
  }

  // SAFETY: install() just defined every property the plugins' extensions declare.
  return outbound as Outbound & ExtensionsOf<Plugins>;
};
