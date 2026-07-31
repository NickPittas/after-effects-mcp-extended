import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target) {
  throw new Error("Usage: node set-windows-gui-subsystem.mjs <executable>");
}

const executable = readFileSync(target);
const peHeaderOffset = executable.readUInt32LE(0x3c);

if (executable.toString("ascii", peHeaderOffset, peHeaderOffset + 4) !== "PE\0\0") {
  throw new Error(`${target} is not a valid PE executable.`);
}

const optionalHeaderOffset = peHeaderOffset + 24;
const optionalHeaderMagic = executable.readUInt16LE(optionalHeaderOffset);
if (optionalHeaderMagic !== 0x10b && optionalHeaderMagic !== 0x20b) {
  throw new Error(`${target} has an unsupported PE optional header.`);
}

// IMAGE_OPTIONAL_HEADER.Subsystem: 2 = IMAGE_SUBSYSTEM_WINDOWS_GUI.
// The companion has no console UI; making that explicit prevents File.execute
// from asking Windows Terminal to host it when launched by After Effects.
executable.writeUInt16LE(2, optionalHeaderOffset + 68);
writeFileSync(target, executable);

console.log(`Set Windows GUI subsystem on ${target}`);
