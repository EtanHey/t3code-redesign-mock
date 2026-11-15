// Collects every lane's definitions by glob. Lanes add files; nobody edits a shared index.
// Two definitions that claim the same thing (thread id, project id, RPC method, command
// reaction) stop the boot with both file paths named, instead of one silently winning.
import type {
  AnyCommandReaction,
  AnyStreamHandler,
  AnyUnaryHandler,
  EnvironmentDefinition,
  MockDefinition,
  ProjectDefinition,
  ProviderDefinition,
  ThreadDefinition,
} from "./definitions";

export interface Sourced<A> {
  readonly source: string;
  readonly definition: A;
}

export interface Registry {
  readonly threads: ReadonlyArray<Sourced<ThreadDefinition>>;
  readonly projects: ReadonlyArray<Sourced<ProjectDefinition>>;
  readonly providers: ReadonlyArray<Sourced<ProviderDefinition>>;
  readonly environments: ReadonlyArray<Sourced<EnvironmentDefinition>>;
  readonly unary: ReadonlyMap<string, Sourced<AnyUnaryHandler>>;
  readonly streams: ReadonlyMap<string, Sourced<AnyStreamHandler>>;
  readonly reactions: ReadonlyMap<string, Sourced<AnyCommandReaction>>;
}

export function conflictError(what: string, first: string, second: string): Error {
  return new Error(`redesign-mock: ${what} is defined twice: in ${first} and in ${second}`);
}

type ModuleExports = { readonly default?: MockDefinition | ReadonlyArray<MockDefinition> };

const fixtureModules = import.meta.glob<ModuleExports>("../fixtures/*/*.fixture.ts", { eager: true });
const handlerModules = import.meta.glob<ModuleExports>("../handlers/*/*.handler.ts", { eager: true });

function definitionsOf(modules: Record<string, ModuleExports>): Array<Sourced<MockDefinition>> {
  return Object.entries(modules)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([path, module]) => {
      const source = path.replace(/^\.\.\//, "redesignMock/");
      const exported = module.default;
      if (exported === undefined) {
        throw new Error(`redesign-mock: ${source} has no default export`);
      }
      const list: ReadonlyArray<MockDefinition> = Array.isArray(exported) ? exported : [exported as MockDefinition];
      return list.map((definition) => ({ source, definition }));
    });
}

function claim<A>(map: Map<string, Sourced<A>>, key: string, what: string, entry: Sourced<A>): void {
  const existing = map.get(key);
  if (existing) throw conflictError(what, existing.source, entry.source);
  map.set(key, entry);
}

export function buildRegistry(
  entries: ReadonlyArray<Sourced<MockDefinition>> = [
    ...definitionsOf(fixtureModules),
    ...definitionsOf(handlerModules),
  ],
): Registry {
  const threads = new Map<string, Sourced<ThreadDefinition>>();
  const projects = new Map<string, Sourced<ProjectDefinition>>();
  const providers = new Map<string, Sourced<ProviderDefinition>>();
  const environments = new Map<string, Sourced<EnvironmentDefinition>>();
  const unary = new Map<string, Sourced<AnyUnaryHandler>>();
  const streams = new Map<string, Sourced<AnyStreamHandler>>();
  const reactions = new Map<string, Sourced<AnyCommandReaction>>();

  for (const { source, definition } of entries) {
    switch (definition.kind) {
      case "thread": {
        const key = `${definition.environmentId ?? ""}/${definition.projection.thread.id}`;
        claim(threads, key, `thread "${definition.projection.thread.id}"`, { source, definition });
        if (definition.scenario) {
          for (const other of threads.values()) {
            if (other.definition !== definition && other.definition.scenario?.id === definition.scenario.id) {
              throw conflictError(`scenario "${definition.scenario.id}"`, other.source, source);
            }
          }
        }
        break;
      }
      case "project":
        claim(projects, `${definition.environmentId ?? ""}/${definition.project.id}`, `project "${definition.project.id}"`, {
          source,
          definition,
        });
        break;
      case "provider":
        claim(
          providers,
          `${definition.environmentId ?? ""}/${definition.provider.instanceId}`,
          `provider "${definition.provider.instanceId}"`,
          { source, definition },
        );
        break;
      case "environment":
        claim(environments, definition.environmentId, `environment "${definition.environmentId}"`, {
          source,
          definition,
        });
        break;
      case "rpc":
        if (streams.has(definition.method)) {
          throw conflictError(`RPC "${definition.method}"`, streams.get(definition.method)!.source, source);
        }
        claim(unary, definition.method, `RPC "${definition.method}"`, { source, definition });
        break;
      case "stream":
        if (unary.has(definition.method)) {
          throw conflictError(`RPC "${definition.method}"`, unary.get(definition.method)!.source, source);
        }
        claim(streams, definition.method, `RPC "${definition.method}"`, { source, definition });
        break;
      case "command":
        claim(reactions, definition.type, `reaction to "${definition.type}"`, { source, definition });
        break;
    }
  }

  return {
    threads: [...threads.values()],
    projects: [...projects.values()],
    providers: [...providers.values()],
    environments: [...environments.values()],
    unary,
    streams,
    reactions,
  };
}
