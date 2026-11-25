export type HistoryEntry = {
  id: string;
  ts: number;
  imageBlob: Blob;
  selectedOption: number | null;
  suggestedAnswer: string | null;
  needsClearerImage: boolean;
  confidence: "high" | "medium" | "low";
  actionToAnswerMs: number;
  geminiMs: number;
};

const DB_NAME = "maple-lens-history";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const MAX_ENTRIES = 50;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("INDEXEDDB_UNAVAILABLE"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("ts", "ts", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("INDEXEDDB_OPEN_FAILED"));
  });
}

export async function saveHistoryEntry(entry: Omit<HistoryEntry, "id">): Promise<void> {
  try {
    const db = await openDb();
    try {
      const id = `${entry.ts}-${Math.random().toString(36).slice(2, 8)}`;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put({ ...entry, id });
        const idx = store.index("ts");
        const keysReq = idx.getAllKeys();
        keysReq.onsuccess = () => {
          const keys = keysReq.result;
          if (keys.length > MAX_ENTRIES) {
            const toDelete = keys.slice(0, keys.length - MAX_ENTRIES);
            for (const k of toDelete) store.delete(k);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Never block or surface errors from optional local history storage
  }
}

export async function listHistoryEntries(): Promise<HistoryEntry[]> {
  try {
    const db = await openDb();
    try {
      return await new Promise<HistoryEntry[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const items = (req.result as HistoryEntry[]) || [];
          items.sort((a, b) => b.ts - a.ts);
          resolve(items);
        };
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore
  }
}

export async function clearHistoryEntries(): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore
  }
}
