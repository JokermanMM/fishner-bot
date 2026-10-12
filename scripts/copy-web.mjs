import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = `${root}web`;
const destination = `${root}dist/web`;

await rm(destination, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });
await cp(source, destination, { recursive: true });
await mkdir(`${destination}/vendor/images`, { recursive: true });
await cp(`${root}node_modules/leaflet/dist/leaflet.js`, `${destination}/vendor/leaflet-1.9.4.js`);
await cp(`${root}node_modules/leaflet/dist/leaflet.css`, `${destination}/vendor/leaflet-1.9.4.css`);
await cp(`${root}node_modules/leaflet/dist/images`, `${destination}/vendor/images`, { recursive: true });
