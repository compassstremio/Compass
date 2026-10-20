import { migrateHarborStorage } from "./harbor-migration";

// Imported first by main.tsx: stores read their keys while their modules load, so the
// Harbor keys must carry Compass names before any other module is evaluated.
try {
  migrateHarborStorage(localStorage);
} catch {
  void 0;
}
