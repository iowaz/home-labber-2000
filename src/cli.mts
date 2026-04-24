import "reflect-metadata";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { buildContainer } from "./container/build-container.ts";
import { TYPES } from "./container/identifiers.ts";
import type { CliCommand } from "./commands/types.ts";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultConfigDirectory = path.resolve(currentDirectory, "../config");
const defaultEnvPath = path.resolve(currentDirectory, "../.env");

try {
  process.loadEnvFile(defaultEnvPath);
} catch (error) {
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code !== "ENOENT") {
    throw error;
  }
}

const container = buildContainer(defaultConfigDirectory);

const program = new Command();

program
  .name("home-lab-machine-syncer")
  .description("Syncs homelab service publications into Caddy API targets.")
  .showHelpAfterError();

const applyCommand = container.get<CliCommand>(TYPES.ApplyCommand);
applyCommand.register(program);

await program.parseAsync(process.argv);
