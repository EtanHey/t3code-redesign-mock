// The app lists every environment other than the primary from its saved connection catalog: one
// JSON document in IndexedDB (database "t3code:connection-runtime", store "catalog", key
// "document"). Each `environment(...)` definition is written there at install, before the app
// boots, as a saved direct connection, so it shows wherever the app lists environments. The mock
// driver then answers its connection with the state the definition names. Idempotent: an entry
// already there is replaced, nothing else in the document is touched. "Reset demo" deletes the
// database, and the next boot writes it again.
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  registerConnectionInCatalog,
} from "@t3tools/client-runtime/platform";
import * as Schema from "effect/Schema";

import type { EnvironmentDefinition } from "./definitions";

const DATABASE_NAME = "t3code:connection-runtime";
const CATALOG_STORE = "catalog";
const CATALOG_KEY = "document";
/** Boot never waits longer than this on a slow or blocked database. */
const SEED_TIMEOUT_MS = 1_500;

const CatalogJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeCatalog = Schema.decodeUnknownOption(CatalogJson);
const encodeCatalog = Schema.encodeSync(CatalogJson);

/** A believable address for the saved connection; the mock driver never contacts it. */
export function mockHostOf(definition: EnvironmentDefinition): string {
  return `https://${definition.environmentId}.example.test`;
}

function registrationOf(definition: EnvironmentDefinition): BearerConnectionRegistration {
  const connectionId = `mock-${definition.environmentId}`;
  const host = mockHostOf(definition);
  return new BearerConnectionRegistration({
    target: new BearerConnectionTarget({ environmentId: definition.environmentId, label: definition.label, connectionId }),
    profile: new BearerConnectionProfile({
      connectionId,
      environmentId: definition.environmentId,
      label: definition.label,
      httpBaseUrl: host,
      wsBaseUrl: host.replace(/^http/, "ws"),
    }),
    credential: new BearerConnectionCredential({ token: "mock-preview-token" }),
  });
}

export function seededCatalog(raw: unknown, definitions: ReadonlyArray<EnvironmentDefinition>): string {
  const existing = decodeCatalog(raw);
  let document: ConnectionCatalogDocument =
    existing._tag === "Some" ? existing.value : EMPTY_CONNECTION_CATALOG_DOCUMENT;
  for (const definition of definitions) {
    document = registerConnectionInCatalog(document, registrationOf(definition));
  }
  return encodeCatalog(document);
}

function seed(definitions: ReadonlyArray<EnvironmentDefinition>): Promise<void> {
  return new Promise((resolve) => {
    if (definitions.length === 0 || typeof indexedDB === "undefined") return resolve();
    // No version: a new database is created at version 1 with only the catalog store, and the
    // app's own upgrade adds its other stores when it opens the database at its version.
    const request = indexedDB.open(DATABASE_NAME);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CATALOG_STORE)) {
        request.result.createObjectStore(CATALOG_STORE);
      }
    };
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (!database.objectStoreNames.contains(CATALOG_STORE)) {
        database.close();
        return resolve();
      }
      const transaction = database.transaction(CATALOG_STORE, "readwrite");
      const store = transaction.objectStore(CATALOG_STORE);
      const read = store.get(CATALOG_KEY);
      read.onsuccess = () => {
        try {
          store.put(seededCatalog(read.result, definitions), CATALOG_KEY);
        } catch (error) {
          console.warn("[redesign-mock] could not seed the connection catalog", error);
        }
      };
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => {
        database.close();
        resolve();
      };
    };
  });
}

/** Writes every extra environment into the app's connection catalog. Never rejects. */
export function seedConnectionCatalog(definitions: ReadonlyArray<EnvironmentDefinition>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SEED_TIMEOUT_MS);
  });
  return Promise.race([seed(definitions).catch(() => undefined), timeout]).finally(() => clearTimeout(timer));
}
